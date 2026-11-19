#input_type_name: MailThreadActionInput
#output_type_name: MailThreadActionResult
#function_name: mail_thread_action

"""One action on one or more conversations, here and in the provider.

Mail is updated first and always; Gmail labels or Outlook folders follow,
best effort, so a slow provider never leaves the inbox half-changed. Provider
failures are reported back, never raised.

  done       handled: leaves the inbox here and in Gmail or Outlook
  restore    back into the inbox
  read       mark read (both sides)          unread   mark unread
  snooze     hide until `until`; new mail from them brings it back early
  unsnooze   bring back now
  mute       never comes back, even on new replies
  move       put it in another category (`category`), and optionally say what
             it needs (`state`). A correction: kept, and sent with every later
             read as a worked example, so the sort learns.
  state      say what it needs (`state`): also a correction
  draft      ask for a draft now, with an optional `hint` ("say no kindly")
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

STATES = ("needs_reply", "waiting", "fyi", "done")
EVIDENCE_TAIL = 900
EVIDENCE_MAX = 1600


class MailThreadActionInput(BaseModel):
    conversation_ids: list[str]
    action: str
    until: str | None = None
    state: str | None = None
    category: str | None = None
    hint: str | None = None
    kind: str | None = None


class MailThreadActionResult(BaseModel):
    updated: int
    corrections: int
    provider_errors: list[str]
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _result(response: Any) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    result = (payload or {}).get("result", payload) or {}
    return result if isinstance(result, dict) else {}


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _evidence(conv: dict, person: dict | None, text: str, zone: ZoneInfo) -> str:
    """What the sort saw, in the sort's own shape, shorter: a worked example."""
    who = conv.get("counterpart_name") or conv.get("counterpart_handle") or "someone"
    last = _parse(conv.get("last_message_at"))
    lines = [
        f"Where: {conv.get('source') or 'mail'}" + (f", {conv['place']}" if conv.get("place") else ""),
        f"Kind: {'people talking' if conv.get('kind') == 'people' else 'a broadcast (a list, a service, a notification, a bot)'}",
        f"Subject: {conv.get('subject') or '(no subject)'}",
        f"Other side: {who} <{conv.get('counterpart_handle') or 'unknown'}>",
        f"Messages: {conv.get('message_count') or 1}; newest from {'the owner (You)' if conv.get('last_direction') == 'outbound' else 'them'}"
        + (f", {last.astimezone(zone).strftime('%a %d %b %H:%M')}" if last else ""),
    ]
    if person:
        lines.append(f"Their history: {'VIP. ' if person.get('is_vip') else ''}{int(person.get('conversation_count') or 0)} conversations")
    if conv.get("provider_category"):
        lines.append(f"The provider filed it under: {conv['provider_category']}")
    body = text[-EVIDENCE_TAIL:] if text else (conv.get("snippet") or "")[:400]
    lines += ["", "Newest messages:" if conv.get("kind") == "people" else "Preview:", ("…" if text and len(text) > EVIDENCE_TAIL else "") + body]
    return "\n".join(lines)[:EVIDENCE_MAX]


def _outlook_inbox_ids(pod: Any, account: str, conversation: str) -> list[str]:
    result = _result(pod.connectors.execute("outlook", "OUTLOOK_LIST_MESSAGES", {
        "user_id": "me", "folder": "inbox", "top": 50, "select": ["id"],
        "filter": f"conversationId eq '{conversation}'",
    }, account_id=account))
    data = result.get("data") if isinstance(result.get("data"), dict) else result
    return [m["id"] for m in (data.get("value") or []) if m.get("id")]


def _mirror(pod: Any, mailbox: dict, conv: dict, action: str) -> None:
    """Make the provider agree with what just happened here."""
    account = mailbox["account_id"]
    key = conv["source_id"]
    if mailbox["provider"] == "gmail":
        add, remove = [], []
        if action in ("done", "mute"):
            remove = ["INBOX"]
        elif action == "restore":
            add = ["INBOX"]
        elif action == "read":
            remove = ["UNREAD"]
        elif action == "unread":
            add = ["UNREAD"]
        if add or remove:
            pod.connectors.execute("gmail", "GMAIL_MODIFY_THREAD_LABELS", {
                "user_id": "me", "thread_id": key, "add_label_ids": add, "remove_label_ids": remove,
            }, account_id=account)
        return
    if action in ("done", "mute"):
        ids = _outlook_inbox_ids(pod, account, key)
        for start in range(0, len(ids), 20):
            pod.connectors.execute("outlook", "OUTLOOK_BATCH_MOVE_MESSAGES", {
                "user_id": "me", "message_ids": ids[start : start + 20], "destination_id": "archive",
            }, account_id=account)
    elif action in ("read", "unread"):
        ids = _outlook_inbox_ids(pod, account, key)
        for start in range(0, len(ids), 20):
            pod.connectors.execute("outlook", "OUTLOOK_BATCH_UPDATE_MESSAGES", {
                "user_id": "me",
                "updates": [{"message_id": i, "is_read": action == "read"} for i in ids[start : start + 20]],
            }, account_id=account)
    elif action == "restore" and conv.get("latest_message_id"):
        pod.connectors.execute("outlook", "OUTLOOK_MOVE_MESSAGE", {
            "user_id": "me", "message_id": conv["latest_message_id"], "destination_id": "inbox",
        }, account_id=account)


def mail_thread_action(ctx: FunctionContext, data: MailThreadActionInput) -> MailThreadActionResult:
    pod = ctx.pod
    ids = [str(t) for t in data.conversation_ids[:100]]
    if not ids:
        return MailThreadActionResult(updated=0, corrections=0, provider_errors=[], message="Nothing to do.")
    convs = _rows(pod.query(
        "SELECT c.id, c.source, c.source_account, c.source_id, c.place, c.kind, c.subject, c.snippet, c.counterpart_handle, "
        "c.counterpart_name, c.message_count, c.last_direction, c.last_message_at, c.document_path, c.state, "
        "c.category, t.latest_message_id, t.provider_category, t.draft_state "
        f"FROM conversation c JOIN mail_thread t ON t.id = c.id WHERE c.id IN ({_in(ids)})"))
    mailboxes = {m["id"]: m for m in _rows(pod.query("SELECT id, provider, account_id FROM mail_mailbox"))}
    now = datetime.now(timezone.utc).isoformat()
    action = data.action

    conv_patch: dict[str, Any] = {}
    thread_patch: dict[str, Any] = {}
    if action == "done":
        conv_patch = {"state": "done"}
        thread_patch = {"in_inbox": False, "snoozed_until": None, "follow_up_at": None}
    elif action == "restore":
        conv_patch = {"state": "fyi"}
        thread_patch = {"in_inbox": True, "muted": False}
    elif action == "read":
        thread_patch = {"unread": False}
    elif action == "unread":
        thread_patch = {"unread": True}
    elif action == "snooze":
        if not _parse(data.until):
            raise ValueError("snooze needs `until` (ISO 8601).")
        thread_patch = {"snoozed_until": data.until}
    elif action == "unsnooze":
        thread_patch = {"snoozed_until": None}
    elif action == "mute":
        conv_patch = {"state": "done"}
        thread_patch = {"muted": True, "in_inbox": False, "follow_up_at": None}
    elif action in ("move", "state"):
        known = {r["key"]: r["name"] for r in _rows(pod.query("SELECT key, name FROM mail_category WHERE state = 'active'"))}
        if action == "move" and data.category not in known:
            raise ValueError(f"No active category '{data.category}'.")
        if data.state is not None and data.state not in STATES:
            raise ValueError("state must be needs_reply, waiting, fyi or done.")
        if action == "state" and not data.state:
            raise ValueError("state needs `state`.")
        if data.category:
            conv_patch["category"] = data.category
        if data.state:
            conv_patch["state"] = data.state
        conv_patch["sorted_at"] = now
        thread_patch = {"unsure": False, "sorted_by": "person", "claimed_at": None,
                        "reason": f"Moved to {known.get(data.category)} by you" if data.category else "Set by you"}
    elif action == "draft":
        thread_patch = {"draft_state": "wanted", "draft_kind": data.kind if data.kind in ("reply", "follow_up", "schedule") else "reply",
                        "draft_hint": (data.hint or None)}
    else:
        raise ValueError(f"Unknown action '{action}'.")

    corrections: list[dict] = []
    if action in ("move", "state"):
        settings = (_rows(pod.query("SELECT timezone FROM mail_settings LIMIT 1")) or [{}])[0]
        try:
            zone = ZoneInfo(settings.get("timezone") or "UTC")
        except Exception:  # noqa: BLE001
            zone = ZoneInfo("UTC")
        handles = sorted({(c.get("counterpart_handle") or "").lower() for c in convs if c.get("counterpart_handle")})
        people = {p["handle"]: p for p in _rows(pod.query(
            "SELECT h.handle, p.is_vip, p.conversation_count FROM person_handle h JOIN person p ON p.id = h.person_id "
            f"WHERE h.kind = 'email' AND h.handle IN ({_in(handles)})"))}
        for conv in convs:
            changed_category = data.category and data.category != conv.get("category")
            changed_state = data.state and data.state != conv.get("state")
            if not (changed_category or changed_state):
                continue
            text = ""
            if conv.get("document_path"):
                try:
                    text = pod.files.download(conv["document_path"]).decode("utf-8", "replace")
                except Exception:  # noqa: BLE001 — the preview will do
                    text = ""
            corrections.append({
                "conversation_id": conv["id"],
                "from_category": conv.get("category"), "to_category": data.category if changed_category else None,
                "from_state": conv.get("state"), "to_state": data.state if changed_state else None,
                "evidence": _evidence(conv, people.get((conv.get("counterpart_handle") or "").lower()), text, zone),
            })

    if conv_patch:
        pod.records.bulk_update("conversation", [{"id": c["id"], **conv_patch} for c in convs])
    if thread_patch:
        if action == "draft":
            # Already wanted: step through none so the trigger sees it become
            # wanted again (it fires on the change, not the value).
            again = [c["id"] for c in convs if c.get("draft_state") == "wanted"]
            if again:
                pod.records.bulk_update("mail_thread", [{"id": i, "draft_state": "none"} for i in again])
        pod.records.bulk_update("mail_thread", [{"id": c["id"], **thread_patch} for c in convs])
    if corrections:
        pod.records.bulk_create("mail_correction", corrections)

    errors: list[str] = []
    if action in ("done", "restore", "read", "unread", "mute"):
        for conv in convs:
            mailbox = mailboxes.get(conv["source_account"])
            if not mailbox or mailbox.get("account_id") == "sample":
                continue
            try:
                _mirror(pod, mailbox, conv, action)
            except Exception as exc:  # noqa: BLE001 — Mail is already right; report the provider
                errors.append(f"{conv.get('counterpart_handle') or conv['id']}: {exc}"[:300])

    if corrections:
        pod.table("mail_activity").create({
            "kind": "correction",
            "text": f"You moved {len(corrections)} conversation(s); the sort will use {'it' if len(corrections) == 1 else 'them'} as examples",
            "count": len(corrections), "conversation_id": corrections[0]["conversation_id"],
        })
    elif action == "snooze" and convs:
        pod.table("mail_activity").create({"kind": "snooze", "text": f"Snoozed {len(convs)} conversation(s) until {data.until}",
                                           "count": len(convs)})
    return MailThreadActionResult(
        updated=len(convs), corrections=len(corrections), provider_errors=errors,
        message=f"{action}: {len(convs)} conversation(s)" + (f", {len(errors)} provider error(s)" if errors else ""),
    )
