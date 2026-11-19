#input_type_name: DealsSetupPrepareInput
#output_type_name: DealsSetupPrepareResult
#function_name: deals_setup_prepare

"""Set-up, first step: what to propose.

The team's stages and currency are set once, by the first person to set Deal
tracker up; anyone after them goes straight to bringing in their own deals
(`team_ready`). Proposed: Lead, Talking, Proposal, Negotiating, Won and Lost,
each with what reaching it means, and a currency guessed from the person's
time zone. The person edits both in the app.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

SETTINGS_ID = "7d6c2f1e-5a40-4b8e-9c13-2f0e8a6b4d51"
STAGES = [
    {"name": "Lead", "kind": "open", "meaning": "They have shown interest; nothing is discussed in detail yet."},
    {"name": "Talking", "kind": "open", "meaning": "In conversation about what they need: calls, demos, questions."},
    {"name": "Proposal", "kind": "open", "meaning": "A price, a quote or a proposal has been asked for or sent."},
    {"name": "Negotiating", "kind": "open", "meaning": "Terms, price or paperwork are being agreed."},
    {"name": "Won", "kind": "won", "meaning": "They said yes: signed, ordered, paid or agreed to start."},
    {"name": "Lost", "kind": "lost", "meaning": "They said no, chose someone else, or it stopped."},
]
ZONE_CURRENCY = {
    "Europe/London": "GBP", "Europe/Dublin": "EUR", "Europe/Zurich": "CHF", "Europe/Stockholm": "SEK",
    "Europe/Oslo": "NOK", "Europe/Copenhagen": "DKK", "Europe/Warsaw": "PLN", "Europe/Prague": "CZK",
    "Europe/Budapest": "HUF", "Europe/Istanbul": "TRY", "Asia/Kolkata": "INR", "Asia/Calcutta": "INR",
    "Asia/Tokyo": "JPY", "Asia/Singapore": "SGD", "Asia/Dubai": "AED", "Asia/Hong_Kong": "HKD",
    "Asia/Shanghai": "CNY", "Asia/Seoul": "KRW", "America/Toronto": "CAD", "America/Vancouver": "CAD",
    "America/Sao_Paulo": "BRL", "America/Mexico_City": "MXN", "Africa/Lagos": "NGN", "Africa/Johannesburg": "ZAR",
    "Africa/Nairobi": "KES", "Pacific/Auckland": "NZD",
}


class DealsSetupPrepareInput(BaseModel):
    timezone: str | None = None


class DealsSetupPrepareResult(BaseModel):
    team_ready: bool
    set_up_by: str | None = None
    stages: list[dict]
    currency: str
    review_day: str
    review_time: str
    timezone: str
    people_ready: bool
    deals: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _guess(zone: str) -> str:
    if zone in ZONE_CURRENCY:
        return ZONE_CURRENCY[zone]
    if zone.startswith("Europe/"):
        return "EUR"
    if zone.startswith("Australia/"):
        return "AUD"
    return "USD"


def deals_setup_prepare(ctx: FunctionContext, data: DealsSetupPrepareInput) -> DealsSetupPrepareResult:
    pod = ctx.pod
    member = (_rows(pod.query("SELECT id, timezone FROM deals_member ORDER BY created_at LIMIT 1")) or [{}])[0]
    zone = data.timezone or member.get("timezone") or "UTC"
    settings = (_rows(pod.query(
        "SELECT currency, review_day, review_time, timezone, set_up_at, set_up_by, set_up_by_name FROM deals_settings LIMIT 1")) or [{}])[0]
    stages = _rows(pod.query("SELECT id, name, kind, meaning FROM deals_stage ORDER BY position, name"))
    # Whoever set the team's stages sees them again on a second set-up, to change.
    team_ready = bool(settings.get("set_up_at")) and len(stages) >= 2 and str(settings.get("set_up_by") or "") != str(ctx.user_id or "")
    people = (_rows(pod.query("SELECT setup_step FROM people_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    deals = int((_rows(pod.query("SELECT COUNT(*) AS n FROM deal")) or [{}])[0].get("n") or 0)
    if member.get("id"):
        pod.table("deals_member").update(member["id"], {
            "setup_step": "existing" if team_ready else "stages", "timezone": zone})
    return DealsSetupPrepareResult(
        team_ready=team_ready, set_up_by=settings.get("set_up_by_name"),
        stages=[{"id": s["id"], "name": s["name"], "kind": s["kind"], "meaning": s.get("meaning")} for s in stages] if stages else STAGES,
        currency=settings.get("currency") or _guess(zone),
        review_day=settings.get("review_day") or "monday", review_time=settings.get("review_time") or "08:00",
        timezone=settings.get("timezone") or zone, people_ready=people.get("setup_step") == "done", deals=deals,
        message=("The team's stages are set; bring in your own deals." if team_ready else "Proposing stages and a currency."),
    )
