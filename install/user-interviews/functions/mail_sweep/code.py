#input_type_name: MailSweepInput
#output_type_name: MailSweepResult
#function_name: mail_sweep

"""The hourly pass: what should happen because time went by.

  snoozed conversations whose time came   back into the inbox
  waiting ones whose follow-up came       back as "needs a reply", with a nudge
                                          being written (draft_state wanted)
  approved drafts whose send time came    returned for the workflow to send;
                                          a person approved every one of them

Nudges are capped per pass: twenty landing at 9:00 on a Monday is a chore
list, not help. The rest come in the next hour.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

MAX_NUDGES = 6


class MailSweepInput(BaseModel):
    pass


class MailSweepResult(BaseModel):
    unsnoozed: int
    nudges: int
    due_sends: list[str]
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _when(value: Any) -> str:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%b %-d")
    except (TypeError, ValueError):
        return "a while"


def mail_sweep(ctx: FunctionContext, data: MailSweepInput) -> MailSweepResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    woke = [r["id"] for r in _rows(pod.query(
        f"SELECT id FROM mail_thread WHERE snoozed_until IS NOT NULL AND snoozed_until <= '{now}' LIMIT 200"))]
    if woke:
        pod.records.bulk_update("mail_thread", [{"id": i, "snoozed_until": None, "in_inbox": True} for i in woke])
        pod.table("mail_activity").create({"kind": "snooze", "text": f"{len(woke)} snoozed conversation(s) are back", "count": len(woke)})

    due = _rows(pod.query(
        "SELECT c.id, c.counterpart_name, c.counterpart_handle, t.waiting_since FROM conversation c "
        "JOIN mail_thread t ON t.id = c.id WHERE c.state = 'waiting' AND t.muted IS NOT TRUE "
        f"AND t.follow_up_at <= '{now}' AND t.draft_state IN ('none', 'failed') "
        f"ORDER BY c.priority DESC, t.follow_up_at LIMIT {MAX_NUDGES}"))
    if due:
        pod.records.bulk_update("conversation", [
            {"id": r["id"], "state": "needs_reply", "ask": f"No reply since {_when(r.get('waiting_since'))}. Send the nudge?"}
            for r in due])
        pod.records.bulk_update("mail_thread", [
            {"id": r["id"], "in_inbox": True, "draft_state": "wanted", "draft_kind": "follow_up"} for r in due])
        names = ", ".join((r.get("counterpart_name") or r.get("counterpart_handle") or "?") for r in due[:3])
        pod.table("mail_activity").create({"kind": "follow_up", "text": f"Follow-ups due: {names}" + (" and more" if len(due) > 3 else ""),
                                           "count": len(due)})

    sends = [r["id"] for r in _rows(pod.query(
        "SELECT d.id FROM draft d JOIN mail_mailbox m ON m.id::text = d.source_account WHERE d.source = 'mail' AND d.state = 'approved' "
        f"AND m.account_id <> 'sample' AND (d.send_at IS NULL OR d.send_at <= '{now}') "
        "AND d.updated_at < NOW() - INTERVAL '20 seconds' LIMIT 20"))]
    return MailSweepResult(unsnoozed=len(woke), nudges=len(due), due_sends=sends,
                           message=f"{len(woke)} back from snooze, {len(due)} nudge(s), {len(sends)} scheduled send(s)")
