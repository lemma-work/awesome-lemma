#input_type_name: MailPromiseContextInput
#output_type_name: MailPromiseContextResult
#function_name: mail_promise_context

"""What the promise reader needs for one conversation: the newest messages,
which way the sort heard a promise, and the promises already open on it.

Started by a trigger when the sort sets promise_state = wanted. Marks the
conversation `reading` so the app can show it is on its way.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

TAIL_CHARS = 5000


class MailPromiseContextInput(BaseModel):
    conversation_id: str


class MailPromiseContextResult(BaseModel):
    conversation_id: str
    me: dict
    directions: list[str]
    conversation: dict
    open_promises: list[dict]


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def mail_promise_context(ctx: FunctionContext, data: MailPromiseContextInput) -> MailPromiseContextResult:
    pod = ctx.pod
    cid = data.conversation_id
    conv = pod.table("conversation").get(cid)
    thread = pod.table("mail_thread").get(cid)
    pod.table("mail_thread").update(cid, {"promise_state": "reading"})
    settings = (_rows(pod.query("SELECT display_name, timezone FROM mail_settings LIMIT 1")) or [{}])[0]
    try:
        zone = ZoneInfo(settings.get("timezone") or "UTC")
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("UTC")
    text = ""
    if conv.get("document_path"):
        try:
            text = pod.files.download(conv["document_path"]).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            text = ""
    if len(text) > TAIL_CHARS:
        cut = text[-TAIL_CHARS:]
        boundary = cut.find("\n## ")
        text = "…\n" + cut[boundary + 1 :] if 0 <= boundary < TAIL_CHARS // 2 else "…" + cut
    promises = _rows(pod.query(
        f"SELECT id, direction, text, due_at FROM promise WHERE state = 'open' AND conversation_id = {_sql(cid)}"))
    addresses = [r["email"] for r in _rows(pod.query("SELECT email FROM mail_mailbox"))]
    return MailPromiseContextResult(
        conversation_id=cid,
        me={"name": settings.get("display_name"), "addresses": addresses, "timezone": str(zone),
            "now_local": datetime.now(timezone.utc).astimezone(zone).strftime("%A %Y-%m-%d %H:%M %Z")},
        directions=[d for d in (thread.get("promise_directions") or []) if d in ("i_owe", "owed_to_me")] or ["i_owe", "owed_to_me"],
        conversation={"subject": conv.get("subject"), "other_side": {"name": conv.get("counterpart_name"),
                      "handle": conv.get("counterpart_handle")}, "text": text or (conv.get("snippet") or "")},
        open_promises=promises,
    )
