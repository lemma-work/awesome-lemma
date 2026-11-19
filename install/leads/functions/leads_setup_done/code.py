#input_type_name: LeadsSetupDoneInput
#output_type_name: LeadsSetupDoneResult
#function_name: leads_setup_done

"""Set-up: the person has seen who it would look up. Everyone still proposed
joins the queue (leads_claim gives the first of them today's places, best
first, and the rest wait for the next day's), and the set-up is done."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class LeadsSetupDoneInput(BaseModel):
    looked: bool = True


class LeadsSetupDoneResult(BaseModel):
    queued: int
    skipped: int
    unsure: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def leads_setup_done(ctx: FunctionContext, data: LeadsSetupDoneInput) -> LeadsSetupDoneResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    settings = (_rows(pod.query("SELECT id FROM leads_settings ORDER BY created_at LIMIT 1")) or [None])[0]
    # Done first, so the claims the queue starts find the set-up finished.
    if settings:
        pod.table("leads_settings").update(settings["id"], {"setup_step": "done", "setup_done_at": now})
    proposed = [r["id"] for r in _rows(pod.query("SELECT id FROM leads_person WHERE state = 'proposed' LIMIT 5000"))]
    for i in range(0, len(proposed), 100):
        pod.records.bulk_update("leads_person", [{"id": pid, "state": "queued"} for pid in proposed[i : i + 100]])
    counts = {r["state"]: int(r["n"]) for r in _rows(pod.query(
        "SELECT state, COUNT(*) AS n FROM leads_person GROUP BY state"))}
    return LeadsSetupDoneResult(
        queued=len(proposed), skipped=counts.get("skipped", 0), unsure=counts.get("unsure", 0),
        message=f"{len(proposed)} to look up, best first, within the daily limit.")
