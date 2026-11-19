#input_type_name: DealsSetupDoneInput
#output_type_name: DealsSetupDoneResult
#function_name: deals_setup_done

"""Set-up, last step: keep the team's review day (when this person was the
one asked), count what set-up found, and start listening for this person:
from now on their new conversations and meeting notes are read as they come.
The app makes the weekly review's schedule when the day is new or changed.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


class DealsSetupDoneInput(BaseModel):
    review_day: str | None = None
    review_time: str | None = None


class DealsSetupDoneResult(BaseModel):
    summary: dict
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def deals_setup_done(ctx: FunctionContext, data: DealsSetupDoneInput) -> DealsSetupDoneResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    settings = (_rows(pod.query("SELECT id, review_day, review_time FROM deals_settings LIMIT 1")) or [None])[0]
    if settings and data.review_day:
        day = data.review_day.strip().lower()
        if day not in DAYS:
            raise ValueError("The review day is a day of the week.")
        patch = {"review_day": day}
        if data.review_time and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", data.review_time.strip()):
            patch["review_time"] = data.review_time.strip()
        pod.table("deals_settings").update(settings["id"], patch)
    counted = (_rows(pod.query(
        "SELECT COUNT(*) FILTER (WHERE state = 'proposed') AS waiting, COUNT(*) FILTER (WHERE state = 'kept') AS kept, "
        "COUNT(*) FILTER (WHERE state = 'dismissed') AS dismissed FROM deals_change")) or [{}])[0]
    reads = (_rows(pod.query(
        "SELECT COUNT(*) AS reads, COUNT(*) FILTER (WHERE changes_deal = 'yes') AS yes, COALESCE(SUM(calls), 0) AS calls "
        "FROM deals_read WHERE trigger = 'find'")) or [{}])[0]
    deals = int((_rows(pod.query("SELECT COUNT(*) AS n FROM deal")) or [{}])[0].get("n") or 0)
    summary = {"deals": deals, "waiting": int(counted.get("waiting") or 0), "kept": int(counted.get("kept") or 0),
               "dismissed": int(counted.get("dismissed") or 0), "read": int(reads.get("reads") or 0),
               "yes": int(reads.get("yes") or 0), "calls": int(reads.get("calls") or 0)}
    member = (_rows(pod.query("SELECT id FROM deals_member ORDER BY created_at LIMIT 1")) or [{}])[0]
    if member.get("id"):
        pod.table("deals_member").update(member["id"], {"setup_step": "done", "setup_done_at": now, "listening": True,
                                                        "setup_summary": summary})
    return DealsSetupDoneResult(summary=summary, message=f"{deals} deals; {summary['waiting']} changes waiting for you.")
