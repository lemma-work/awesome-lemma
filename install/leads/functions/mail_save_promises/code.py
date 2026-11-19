#input_type_name: MailSavePromisesInput
#output_type_name: MailSavePromisesResult
#function_name: mail_save_promises

"""Store what the promise reader found: new promises with their sentence and
date, and the open ones a newer message kept. Validated here, so a confused
reader leaves fewer promises rather than wrong ones.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class MailSavePromisesInput(BaseModel):
    conversation_id: str
    found: dict = {}


class MailSavePromisesResult(BaseModel):
    created: int
    closed: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _clip(value: Any, size: int) -> str | None:
    text = " ".join(str(value or "").replace("—", ",").split())
    return text[:size] or None


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def mail_save_promises(ctx: FunctionContext, data: MailSavePromisesInput) -> MailSavePromisesResult:
    pod = ctx.pod
    cid = data.conversation_id
    conv = pod.table("conversation").get(cid)
    found = data.found or {}
    existing = _rows(pod.query(f"SELECT id, text, state FROM promise WHERE conversation_id = {_sql(cid)}"))
    latest = (pod.table("mail_thread").get(cid) or {}).get("latest_message_id")
    known = {(r.get("text") or "").lower() for r in existing}
    fresh = []
    for item in (found.get("promises") or [])[:4]:
        text = _clip(item.get("text"), 400)
        if not text or item.get("direction") not in ("i_owe", "owed_to_me") or text.lower() in known:
            continue
        known.add(text.lower())
        due = _parse(item.get("due_at"))
        fresh.append({
            "conversation_id": cid,
            "source": conv.get("source") or "mail",
            "source_id": latest,
            "person_handle": (conv.get("counterpart_handle") or "").lower() or None,
            "person_name": conv.get("counterpart_name"),
            "direction": item["direction"],
            "text": text,
            "quote": _clip(item.get("quote"), 600),
            "due_at": due.isoformat() if due else None,
            "state": "open",
        })
    if fresh:
        pod.records.bulk_create("promise", fresh)
    open_ids = {r["id"] for r in existing if r.get("state") == "open"}
    closing = [str(i) for i in (found.get("kept_ids") or []) if str(i) in open_ids]
    if closing:
        pod.records.bulk_update("promise", [{"id": i, "state": "done"} for i in closing])
    pod.table("mail_thread").update(cid, {"promise_state": "done"})
    who = conv.get("counterpart_name") or conv.get("counterpart_handle") or "them"
    if fresh or closing:
        parts = []
        mine = sum(1 for p in fresh if p["direction"] == "i_owe")
        theirs = len(fresh) - mine
        if mine:
            parts.append(f"you promised {who} {mine} thing{'s' if mine != 1 else ''}")
        if theirs:
            parts.append(f"{who} promised you {theirs} thing{'s' if theirs != 1 else ''}")
        if closing:
            parts.append(f"{len(closing)} kept")
        message = "Promises: " + ", ".join(parts)
        pod.table("mail_activity").create({"kind": "promise", "text": message[:400], "conversation_id": cid,
                                           "count": len(fresh)})
    else:
        message = "No promise to note."
    return MailSavePromisesResult(created=len(fresh), closed=len(closing), message=message)
