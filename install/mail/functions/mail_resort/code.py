#input_type_name: MailResortInput
#output_type_name: MailResortResult
#function_name: mail_resort

"""Send recent open conversations back to be sorted, after categories change,
so a new category gets the mail it should have had.

Only what is still open (needs a reply, waiting, for reading, not sure) from
the last `days` days: anything the person marked done, muted or moved by hand
stays where they put it. Drafts already written are kept.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class MailResortInput(BaseModel):
    days: int = 14


class MailResortResult(BaseModel):
    queued: int


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def mail_resort(ctx: FunctionContext, data: MailResortInput) -> MailResortResult:
    pod = ctx.pod
    days = max(1, min(int(data.days), 60))
    rows = _rows(pod.query(
        "SELECT c.id FROM conversation c JOIN mail_thread t ON t.id = c.id "
        "WHERE c.source = 'mail' AND c.state IN ('needs_reply', 'waiting', 'fyi') AND t.sorted_by IS DISTINCT FROM 'person' "
        f"AND t.muted IS NOT TRUE AND c.last_message_at > NOW() - INTERVAL '{days} days' LIMIT 1000"))
    ids = [r["id"] for r in rows]
    for start in range(0, len(ids), 100):
        chunk = ids[start : start + 100]
        pod.records.bulk_update("conversation", [{"id": i, "state": "new"} for i in chunk])
        pod.records.bulk_update("mail_thread", [{"id": i, "claimed_at": None} for i in chunk])
    if ids:
        pod.table("mail_activity").create({"kind": "category", "text": f"Sorting {len(ids)} recent conversations again into your categories",
                                           "count": len(ids)})
    return MailResortResult(queued=len(ids))
