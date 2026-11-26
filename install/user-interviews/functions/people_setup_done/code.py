#input_type_name: PeopleSetupDoneInput
#output_type_name: PeopleSetupDoneResult
#function_name: people_setup_done

"""Set-up, last step: count what the first read found and open the list."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class PeopleSetupDoneInput(BaseModel):
    pass


class PeopleSetupDoneResult(BaseModel):
    summary: dict
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def people_setup_done(ctx: FunctionContext, data: PeopleSetupDoneInput) -> PeopleSetupDoneResult:
    pod = ctx.pod
    rows = _rows(pod.query(
        "SELECT deal_with, kind, unsure, quiet, waiting_on_me, company_id FROM people_person WHERE in_scope IS TRUE LIMIT 20000"))
    dealt = [r for r in rows if r.get("deal_with") is True and r.get("kind") != "colleague"]
    kinds: dict[str, int] = {}
    for r in dealt:
        kinds[r.get("kind") or "not sure"] = kinds.get(r.get("kind") or "not sure", 0) + 1
    summary = {
        "people": len(dealt),
        "noise": sum(1 for r in rows if r.get("deal_with") is False),
        "unsure": sum(1 for r in rows if r.get("unsure")),
        "quiet": sum(1 for r in dealt if r.get("quiet")),
        "waiting_on_you": sum(1 for r in dealt if r.get("waiting_on_me")),
        "companies": len({r["company_id"] for r in dealt if r.get("company_id")}),
        "kinds": kinds,
    }
    settings = (_rows(pod.query("SELECT id FROM people_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    if settings.get("id"):
        pod.table("people_settings").update(settings["id"], {
            "setup_step": "done", "setup_done_at": datetime.now(timezone.utc).isoformat(), "setup_summary": summary})
    return PeopleSetupDoneResult(summary=summary, message=f"{summary['people']} people at {summary['companies']} companies.")
