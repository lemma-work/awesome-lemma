#input_type_name: LeadsClaimInput
#output_type_name: LeadsClaimResult
#function_name: leads_claim

"""Give queued people a place in today's look-ups, best first, up to the
person's daily limit (leads_settings.daily_limit, 10 by default). A place is
taken when a row becomes `wanted` and `wanted_at` is stamped; that is what the
limit counts, in the person's own day. Everyone past it stays queued until
tomorrow's pass (leads-daily).

Best first: a meeting ahead, then someone who wrote to them, then the most
recent contact. Run as the owner by leads-claim (one run at a time, so two
places are never given out at once) whenever someone is queued, and by the
daily pass. A look-up the person asked for past the limit (`forced`) is
theirs on purpose and takes no place."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class LeadsClaimInput(BaseModel):
    pass


class LeadsClaimResult(BaseModel):
    claimed: int
    used_today: int
    limit: int
    queued: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _zone(name: str | None) -> ZoneInfo:
    aliases = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv"}
    try:
        return ZoneInfo(aliases.get(name or "", name or "UTC"))
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def leads_claim(ctx: FunctionContext, data: LeadsClaimInput) -> LeadsClaimResult:
    pod = ctx.pod
    settings = (_rows(pod.query(
        "SELECT timezone, daily_limit, setup_step FROM leads_settings ORDER BY created_at LIMIT 1")) or [None])[0]
    if not settings or settings.get("setup_step") != "done":
        return LeadsClaimResult(claimed=0, used_today=0, limit=0, queued=0, message="Not set up yet.")
    limit = max(1, int(settings.get("daily_limit") or 10))
    now = datetime.now(timezone.utc)
    local = now.astimezone(_zone(settings.get("timezone")))
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    used = int((_rows(pod.query(
        f"SELECT COUNT(*) AS n FROM leads_person WHERE wanted_at >= '{day_start}' AND sample IS NOT TRUE AND forced IS NOT TRUE")) or [{}])[0].get("n") or 0)
    left = max(0, limit - used)
    queued = _rows(pod.query(
        "SELECT lp.id FROM leads_person lp LEFT JOIN people_person pp ON pp.id = lp.id WHERE lp.state = 'queued' "
        f"ORDER BY (pp.next_meeting_at IS NOT NULL AND pp.next_meeting_at > '{now.isoformat()}') DESC, "
        "pp.last_inbound_at DESC NULLS LAST, pp.last_contact_at DESC NULLS LAST, lp.created_at LIMIT 500"))
    take = queued[:left]
    if take:
        pod.records.bulk_update("leads_person", [
            {"id": r["id"], "state": "wanted", "wanted_at": now.isoformat(), "lookup_error": None} for r in take])
    waiting = len(queued) - len(take)
    message = f"{len(take)} looked up now, {used + len(take)} of {limit} today" + (f"; {waiting} wait for tomorrow" if waiting else "")
    return LeadsClaimResult(claimed=len(take), used_today=used + len(take), limit=limit, queued=waiting, message=message)
