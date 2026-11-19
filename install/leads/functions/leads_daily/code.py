#input_type_name: LeadsDailyInput
#output_type_name: LeadsDailyResult
#function_name: leads_daily

"""The person's daily pass (leads-daily, their own schedule): a look-up that
has been running for over half an hour broke somewhere, so it is marked
failed (it can be asked again); then leads_claim gives today's places to the
queue, and leads_needs_you brings the day's list up to date."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class LeadsDailyInput(BaseModel):
    pass


class LeadsDailyResult(BaseModel):
    failed: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def leads_daily(ctx: FunctionContext, data: LeadsDailyInput) -> LeadsDailyResult:
    pod = ctx.pod
    stuck_before = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    stuck = [r["id"] for r in _rows(pod.query(
        f"SELECT id FROM leads_person WHERE state IN ('wanted', 'looking') AND updated_at < '{stuck_before}' LIMIT 500"))]
    for i in range(0, len(stuck), 100):
        pod.records.bulk_update("leads_person", [
            {"id": x, "state": "failed", "lookup_error": "The look-up stopped partway. Ask again."} for x in stuck[i : i + 100]])
    return LeadsDailyResult(failed=len(stuck), message=f"{len(stuck)} stuck look-up(s) marked failed.")
