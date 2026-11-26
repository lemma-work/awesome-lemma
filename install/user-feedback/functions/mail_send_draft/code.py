#input_type_name: MailSendDraftInput
#output_type_name: MailSendDraftResult
#function_name: mail_send_draft

"""Deliver an approved draft from the mailbox its conversation belongs to.

Nothing here decides to send. A person moves a draft to `approved` in the app;
this refuses anything else, refuses to send twice, and holds a draft whose
`send_at` is still in the future (the sweep delivers it later, and the app uses
a ten-second send_at as its Undo window).

Replies stay in their conversation. The sample mailbox has no account and is refused.
 Gmail: GMAIL_REPLY_TO_THREAD, which keeps the
subject and In-Reply-To (GMAIL_SEND_EMAIL would start an orphan conversation).
Outlook: create a reply draft from the newest message (Graph threads it and
quotes the history), set the recipients exactly, then send that draft.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class MailSendDraftInput(BaseModel):
    draft_id: str


class MailSendDraftResult(BaseModel):
    sent: bool
    draft_id: str
    provider_message_id: str | None = None
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _result(response: Any) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    result = (payload or {}).get("result", payload) or {}
    if isinstance(result, dict) and isinstance(result.get("data"), dict):
        merged = dict(result["data"])
        merged.update({k: v for k, v in result.items() if k != "data"})
        return merged
    return result if isinstance(result, dict) else {}


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _reason(exc: Exception) -> str:
    """The provider's own words when there are any. "Connector rejected the
    operation request" alone told a tester nothing; the detail underneath says
    which field or which id was wrong."""
    details = getattr(exc, "details", None)
    detail = details.get("error") if isinstance(details, dict) else details
    base = getattr(exc, "message", None) or str(exc)
    return f"{base} {detail}".strip() if detail else str(exc)


def _recipients(addresses: list[str]) -> list[dict]:
    # Composio's shape, not Graph's: {"address": …}, not {"emailAddress": {"address": …}}.
    # The Graph shape is rejected as a validation error (422) before Outlook sees it.
    return [{"address": a} for a in addresses]


def _send_gmail(pod: Any, mailbox: dict, thread: dict | None, draft: dict, to: list[str], cc: list[str]) -> str | None:
    account = mailbox["account_id"]
    if thread:
        payload: dict[str, Any] = {
            "user_id": "me",
            "thread_id": thread["source_id"],
            "recipient_email": to[0],
            "message_body": draft["body"],
            "is_html": False,
        }
        if to[1:]:
            payload["extra_recipients"] = to[1:]
        if cc:
            payload["cc"] = cc
        result = _result(pod.connectors.execute("gmail", "GMAIL_REPLY_TO_THREAD", payload, account_id=account))
    else:
        payload = {"user_id": "me", "recipient_email": to[0], "subject": draft.get("subject") or "",
                   "body": draft["body"], "is_html": False}
        if to[1:]:
            payload["extra_recipients"] = to[1:]
        if cc:
            payload["cc"] = cc
        result = _result(pod.connectors.execute("gmail", "GMAIL_SEND_EMAIL", payload, account_id=account))
    return result.get("id") or result.get("messageId")


def _send_outlook(pod: Any, mailbox: dict, thread: dict | None, draft: dict, to: list[str], cc: list[str]) -> str | None:
    account = mailbox["account_id"]

    def call(operation: str, payload: dict) -> dict:
        return _result(pod.connectors.execute("outlook", operation, payload, account_id=account))

    if not thread or not thread.get("latest_message_id"):
        call("OUTLOOK_SEND_EMAIL", {
            "user_id": "me", "to": ", ".join(to), "subject": draft.get("subject") or "",
            "body": draft["body"], "is_html": False, "cc_emails": cc, "save_to_sent_items": True,
        })
        return None
    created = call("OUTLOOK_CREATE_DRAFT_REPLY", {
        "user_id": "me", "message_id": thread["latest_message_id"], "comment": draft["body"],
    })
    draft_id = created.get("id")
    if not draft_id:
        raise RuntimeError(f"Outlook did not return a reply draft: {str(created)[:300]}")
    try:
        # Graph addresses a reply to the newest message's sender. When that sender
        # is you (a nudge on your own last message) it would go to yourself, so
        # the recipients are always set explicitly from the draft.
        call("OUTLOOK_UPDATE_EMAIL", {
            "user_id": "me", "message_id": draft_id,
            "to_recipients": _recipients(to), "cc_recipients": _recipients(cc),
        })
        call("OUTLOOK_SEND_DRAFT", {"user_id": "me", "message_id": draft_id})
    except Exception:
        # Don't leave a half-made reply sitting in the person's Outlook Drafts.
        try:
            call("OUTLOOK_MOVE_MESSAGE", {"user_id": "me", "message_id": draft_id, "destination_id": "deleteditems"})
        except Exception:  # noqa: BLE001 — the send error is the one to report
            pass
        raise
    return draft_id


def mail_send_draft(ctx: FunctionContext, data: MailSendDraftInput) -> MailSendDraftResult:
    pod = ctx.pod
    drafts = pod.table("draft")
    draft = drafts.get(data.draft_id)
    now = datetime.now(timezone.utc)

    if draft.get("state") == "sent":
        return MailSendDraftResult(sent=False, draft_id=data.draft_id,
                               provider_message_id=draft.get("source_message_id"),
                               message="Already sent; refusing to send twice.")
    if draft.get("state") != "approved":
        return MailSendDraftResult(sent=False, draft_id=data.draft_id,
                               message=f"Draft is '{draft.get('state')}', not 'approved'. A person approves; this only delivers.")
    send_at = _parse(draft.get("send_at"))
    if send_at and send_at > now + timedelta(seconds=2):
        return MailSendDraftResult(sent=False, draft_id=data.draft_id,
                               message=f"Scheduled for {send_at.isoformat()}; the sweep will send it.")

    to = [a for a in (draft.get("to_handles") or []) if "@" in str(a)]
    cc = [a for a in (draft.get("cc_handles") or []) if "@" in str(a) and a not in to]
    if not to:
        drafts.update(data.draft_id, {"state": "failed", "error": "No recipient."})
        return MailSendDraftResult(sent=False, draft_id=data.draft_id, message="Draft has no recipient.")

    if draft.get("source") != "mail":
        return MailSendDraftResult(sent=False, draft_id=data.draft_id,
                                   message=f"A {draft.get('source')} draft is delivered by that source's own plugin.")
    mailbox = pod.table("mail_mailbox").get(draft["source_account"])
    if mailbox.get("account_id") == "sample":
        drafts.update(data.draft_id, {"state": "proposed", "send_at": None})
        return MailSendDraftResult(sent=False, draft_id=data.draft_id,
                                   message="This is the sample mailbox: nothing can be sent from it.")
    drafts.update(data.draft_id, {"state": "sending"})
    thread = pod.table("conversation").get(draft["conversation_id"]) if draft.get("conversation_id") else None
    if thread:
        thread = {**thread, "latest_message_id": (pod.table("mail_thread").get(thread["id"]) or {}).get("latest_message_id")}
    try:
        sender = _send_gmail if mailbox["provider"] == "gmail" else _send_outlook
        provider_id = sender(pod, mailbox, thread, draft, to, cc)
    except Exception as exc:  # noqa: BLE001 — record why, so the app can offer a retry
        reason = _reason(exc)
        drafts.update(data.draft_id, {"state": "failed", "error": reason[:2000]})
        pod.table("mail_activity").create({"kind": "error", "text": f"Could not send to {to[0]}: {reason}"[:400],
                                           "conversation_id": draft.get("conversation_id"), "ref_id": data.draft_id})
        return MailSendDraftResult(sent=False, draft_id=data.draft_id, message=f"Send failed: {reason}"[:500])

    drafts.update(data.draft_id, {"state": "sent", "sent_at": now.isoformat(), "source_message_id": provider_id,
                                  "error": None})
    who = (thread or {}).get("counterpart_name") or to[0]
    if thread:
        profile = (_rows(pod.query("SELECT timezone, follow_up_days FROM mail_settings LIMIT 1")) or [{}])[0]
        try:
            zone = ZoneInfo(profile.get("timezone") or "UTC")
        except Exception:  # noqa: BLE001
            zone = ZoneInfo("UTC")
        local = now.astimezone(zone) + timedelta(days=int(profile.get("follow_up_days") or 3))
        while local.weekday() >= 5:
            local += timedelta(days=1)
        follow = datetime.combine(local.date(), time(9, 0), zone)
        # The ball is theirs now; the next read of the conversation refines it.
        pod.table("conversation").update(thread["id"], {
            "state": "waiting", "last_direction": "outbound", "last_outbound_at": now.isoformat(), "ask": None,
        })
        pod.table("mail_thread").update(thread["id"], {
            "waiting_since": now.isoformat(), "follow_up_at": follow.isoformat(),
            "draft_state": "none", "document_filled": False, "unread": False,
        })
    label = {"follow_up": "Nudged", "schedule": "Offered times to"}.get(draft.get("kind"), "Replied to")
    pod.table("mail_activity").create({"kind": "send", "text": f"{label} {who}"[:400],
                                       "conversation_id": draft.get("conversation_id"), "ref_id": data.draft_id})
    return MailSendDraftResult(sent=True, draft_id=data.draft_id, provider_message_id=provider_id,
                           message=f"{label} {who}")
