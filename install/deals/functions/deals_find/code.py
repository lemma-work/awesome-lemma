#input_type_name: DealsFindInput
#output_type_name: DealsFindResult
#function_name: deals_find

"""Set-up: how much of the last 30 days there is to read for deals, as
passes for the workflow's loop. Counts the person's conversations with
people and their meetings with someone from outside that have notes; each
pass of `deals_read` takes the next ones with a company in them, so a pass
past the end reads nothing and costs one query.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PER_PASS = 10
MAX_PASSES = 12


class DealsFindInput(BaseModel):
    days: int = 30


class DealsFindResult(BaseModel):
    conversations: int
    meetings: int
    passes: list[int]
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def deals_find(ctx: FunctionContext, data: DealsFindInput) -> DealsFindResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=max(1, min(data.days, 90)))).isoformat()
    convs = int((_rows(pod.query(
        f"SELECT COUNT(*) AS n FROM conversation WHERE kind = 'people' AND last_message_at >= {_sql(since)}")) or [{}])[0].get("n") or 0)
    meets = int((_rows(pod.query(
        "SELECT COUNT(*) AS n FROM meeting WHERE status <> 'cancelled' AND outside IS TRUE "
        f"AND start_at >= {_sql(since)} AND start_at <= {_sql(now.isoformat())} "
        "AND (document_path IS NOT NULL OR summary IS NOT NULL)")) or [{}])[0].get("n") or 0)
    member = (_rows(pod.query("SELECT id FROM deals_member ORDER BY created_at LIMIT 1")) or [{}])[0]
    if member.get("id"):
        pod.table("deals_member").update(member["id"], {"setup_step": "finding"})
    passes = list(range(1, min(MAX_PASSES, max(1, math.ceil((convs + meets) / PER_PASS))) + 1))
    return DealsFindResult(conversations=convs, meetings=meets, passes=passes,
                           message=f"{convs} conversations and {meets} meetings with notes in the last {data.days} days.")
