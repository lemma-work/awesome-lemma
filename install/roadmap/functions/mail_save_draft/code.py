#input_type_name: MailSaveDraftInput
#output_type_name: MailSaveDraftResult
#function_name: mail_save_draft

"""Store what the writer produced and tell the conversation its draft is ready.

The writer can decline ("they already have what they asked for"); that
leaves no draft and the reason where the person will see it. A newer draft
replaces an older one never touched: two proposals for one reply is one too
many. The writer's one line on what they want becomes the conversation's ask.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class MailSaveDraftInput(BaseModel):
    conversation_id: str
    kind: str = "reply"
    draft: dict = {}


class MailSaveDraftResult(BaseModel):
    draft_id: str | None = None
    skipped: bool
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _clean(addresses: Any) -> list[str]:
    out: list[str] = []
    for address in addresses or []:
        text = str(address).strip().lower()
        if "@" in text and text not in out:
            out.append(text)
    return out


def mail_save_draft(ctx: FunctionContext, data: MailSaveDraftInput) -> MailSaveDraftResult:
    pod = ctx.pod
    cid = data.conversation_id
    conv = pod.table("conversation").get(cid)
    draft = data.draft or {}
    who = conv.get("counterpart_name") or conv.get("counterpart_handle") or "them"
    ask = " ".join(str(draft.get("ask") or "").split())[:300] or None
    if ask:
        pod.table("conversation").update(cid, {"ask": ask})

    body = (draft.get("body") or "").strip()
    if draft.get("skip") or not body:
        reason = (draft.get("skip_reason") or "The writer decided no reply is needed.")[:300]
        pod.table("mail_thread").update(cid, {"draft_state": "none", "draft_hint": None, "reason": reason})
        pod.table("mail_activity").create({"kind": "draft", "text": f"No draft for {who}: {reason}"[:400], "conversation_id": cid})
        return MailSaveDraftResult(skipped=True, message=reason)

    stale = _rows(pod.query(f"SELECT id FROM draft WHERE conversation_id = {_sql(cid)} AND state = 'proposed'"))
    if stale:
        pod.records.bulk_update("draft", [{"id": r["id"], "state": "discarded"} for r in stale])
    subject = (draft.get("subject") or conv.get("subject") or "").strip()
    if subject and not subject.lower().startswith("re:") and data.kind != "new":
        subject = f"Re: {subject}"
    row = pod.table("draft").create({
        "conversation_id": cid,
        "source": conv.get("source") or "mail",
        "source_account": conv["source_account"],
        "kind": data.kind if data.kind in ("reply", "follow_up", "schedule", "new") else "reply",
        "to_handles": _clean(draft.get("to")) or ([conv["counterpart_handle"]] if conv.get("counterpart_handle") else []),
        "cc_handles": _clean(draft.get("cc")),
        "subject": subject[:500] or None,
        "body": body,
        "original_body": body,
        "state": "proposed",
        "rationale": (draft.get("rationale") or "")[:800] or None,
        "built_from": draft.get("used") or [],
    })
    pod.table("mail_thread").update(cid, {"draft_state": "ready", "draft_hint": None})
    label = {"follow_up": "Nudge ready", "schedule": "Times offered"}.get(data.kind, "Reply drafted")
    pod.table("mail_activity").create({"kind": "draft", "text": f"{label} for {who}"[:400], "conversation_id": cid, "ref_id": row["id"]})
    return MailSaveDraftResult(draft_id=row["id"], skipped=False, message=f"{label} for {who}")
