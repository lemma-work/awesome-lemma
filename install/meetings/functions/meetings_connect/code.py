#input_type_name: MeetingsConnectInput
#output_type_name: MeetingsConnectResult
#function_name: meetings_connect

"""Set-up step one, after the person connected in the app: hold the calendar.

The app does the connecting (the provider's own sign-in) and submits the
set-up form with the provider, the connected account and its address; this
records the calendar, or, for the sample, finds the one meetings_sample_data
made. The person's settings are made here too, with the kinds of meeting that
get a brief to start with: customers, investors, candidates and partners on,
internal and anything else off.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com",
            "me.com", "proton.me", "protonmail.com", "aol.com"}
KINDS_ON = ["customer", "investor", "candidate", "partner"]
# Browsers still report some zones by their old names (Chrome says
# Asia/Calcutta); the functions' time zone database knows only the current
# ones, so an old name would quietly become UTC.
ZONE_ALIASES = {
    "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Rangoon": "Asia/Yangon", "Europe/Kiev": "Europe/Kyiv", "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
    "Atlantic/Faeroe": "Atlantic/Faroe", "US/Eastern": "America/New_York", "US/Central": "America/Chicago",
    "US/Mountain": "America/Denver", "US/Pacific": "America/Los_Angeles", "GMT": "UTC", "Etc/UTC": "UTC",
}


def _zone_name(name: str | None) -> str | None:
    return ZONE_ALIASES.get(name or "", name) if name else None


class MeetingsConnectInput(BaseModel):
    provider: str
    account_id: str | None = None
    email: str | None = None
    display_name: str | None = None
    timezone: str | None = None


class MeetingsConnectResult(BaseModel):
    calendar_id: str
    provider: str
    email: str
    sample: bool
    kinds_on: list[str]
    # The sort's passes for the set-up's LOOP; each returns at once when
    # nothing is left.
    passes: list[int] = [1, 2, 3, 4]


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def meetings_connect(ctx: FunctionContext, data: MeetingsConnectInput) -> MeetingsConnectResult:
    pod = ctx.pod
    data.timezone = _zone_name(data.timezone)
    now = datetime.now(timezone.utc).isoformat()
    me = (ctx.user_email or "").lower()

    settings = (_rows(pod.query("SELECT * FROM meetings_settings ORDER BY created_at LIMIT 1")) or [None])[0]
    if settings is None:
        domain = me.split("@", 1)[1] if "@" in me else ""
        settings = pod.table("meetings_settings").create({
            "display_name": data.display_name, "timezone": data.timezone or "UTC",
            "my_domains": [domain] if domain and domain not in FREEMAIL else [],
            "kinds_on": KINDS_ON, "brief_when": "evening_before", "notes_from": "notes",
            "setup_step": "reading",
        })
    else:
        patch: dict[str, Any] = {"setup_step": "reading"}
        if data.timezone and (settings.get("timezone") in (None, "", "UTC") or settings.get("timezone") in ZONE_ALIASES):
            patch["timezone"] = data.timezone
        if data.display_name and not settings.get("display_name"):
            patch["display_name"] = data.display_name
        if settings.get("kinds_on") is None:
            patch["kinds_on"] = KINDS_ON
        if settings.get("my_domains") is None:
            domain = me.split("@", 1)[1] if "@" in me else ""
            patch["my_domains"] = [domain] if domain and domain not in FREEMAIL else []
        pod.table("meetings_settings").update(settings["id"], patch)
        settings = {**settings, **patch}

    if data.provider == "sample":
        found = _rows(pod.query("SELECT id, email FROM meetings_calendar WHERE provider = 'sample' LIMIT 1"))
        if not found:
            raise ValueError("No sample calendar: run meetings_sample_data with mode load first.")
        calendar, provider, email, sample = found[0], "sample", found[0]["email"], True
    else:
        if data.provider not in ("google", "outlook"):
            raise ValueError("provider is google, outlook or sample")
        if not data.account_id or not data.email or "@" not in data.email:
            raise ValueError("Connect the calendar first: the form needs its account id and address.")
        email = data.email.strip().lower()
        found = _rows(pod.query(
            f"SELECT id FROM meetings_calendar WHERE account_id = {_sql(data.account_id)} AND email = {_sql(email)} LIMIT 1"))
        domain = email.split("@", 1)[1]
        calendar = found[0] if found else pod.table("meetings_calendar").create({
            "provider": data.provider, "account_id": data.account_id, "email": email,
            "own_domains": [domain] if domain not in FREEMAIL else [], "state": "reading", "connected_at": now,
        })
        provider, sample = data.provider, False
    return MeetingsConnectResult(calendar_id=calendar["id"], provider=provider, email=email, sample=sample,
                                 kinds_on=list(settings.get("kinds_on") or KINDS_ON))
