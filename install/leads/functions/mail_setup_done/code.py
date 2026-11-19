#input_type_name: MailSetupDoneInput
#output_type_name: MailSetupDoneResult
#function_name: mail_setup_done

"""The end of set-up: count what the first sort found and open the inbox on
it. Promises and drafts keep arriving for a minute after this (their writers
run on their own); the app reads them live.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class MailSetupDoneInput(BaseModel):
    pass


class MailSetupDoneResult(BaseModel):
    summary: dict
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def mail_setup_done(ctx: FunctionContext, data: MailSetupDoneInput) -> MailSetupDoneResult:
    pod = ctx.pod
    counts = (_rows(pod.query(
        "SELECT COUNT(*) FILTER (WHERE c.sorted_at IS NOT NULL) AS sorted, "
        "COUNT(*) FILTER (WHERE c.state = 'needs_reply') AS needs_reply, "
        "COUNT(*) FILTER (WHERE c.state = 'waiting') AS waiting, "
        "COUNT(*) FILTER (WHERE t.unsure IS TRUE) AS not_sure, "
        "COUNT(*) FILTER (WHERE t.draft_state IN ('wanted', 'writing', 'ready')) AS drafts, "
        "COUNT(*) FILTER (WHERE t.promise_state IN ('wanted', 'reading', 'done')) AS promise_conversations, "
        "COUNT(*) FILTER (WHERE c.state = 'new') AS still_new "
        "FROM conversation c JOIN mail_thread t ON t.id = c.id WHERE c.source = 'mail'")) or [{}])[0]
    summary = {k: int(v or 0) for k, v in counts.items()}
    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    settings = (_rows(pod.query("SELECT id FROM mail_settings LIMIT 1")) or [None])[0]
    if settings:
        pod.table("mail_settings").update(settings["id"], {"setup_step": "done", "setup_summary": summary})
    message = (f"Sorted {summary['sorted']} conversations: {summary['needs_reply']} need a reply, "
               f"{summary['waiting']} waiting on others, {summary['not_sure']} not sure")
    pod.table("mail_activity").create({"kind": "setup", "text": message[:400], "count": summary["sorted"]})
    return MailSetupDoneResult(summary=summary, message=message)
