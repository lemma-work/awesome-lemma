#input_type_name: BookingSlotsInput
#output_type_name: BookingSlotsResult
#function_name: booking_slots

"""Work out the open times on the person's booking page, from their live
calendars, and put them on the page.

A time is open when it is on one of their days, inside their hours, after the
notice, within how far ahead they take bookings, keeps their buffer clear of
anything busy on every calendar they chose (read live, never from a copy), does
not overlap a booking still being handled, and its day has fewer bookings than
their daily limit. Runs as the person: every 15 minutes on their own schedule,
after each booking, and when they change their settings.

A calendar that cannot be read leaves the page's times as they were and says
so: the page never offers a time nobody could check, and each booking is
checked again, live, before it is taken.
"""

from __future__ import annotations

import json
from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

LIVE = ("requested", "confirmed")


class BookingSlotsInput(BaseModel):
    # Work them out even while the page is off (the settings screen's preview).
    force: bool = False


class BookingSlotsResult(BaseModel):
    open: int
    days: int
    busy: int
    held: int
    calendars: int
    errors: list[str]
    message: str
    first: str | None = None


# shared:calendar
# The same in every Booking function that reads a calendar (bin/share.py copies
# it in; edit it in bin/shared/calendar.py, never in a function).
ZONE_ALIASES = {
    "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Rangoon": "Asia/Yangon", "Europe/Kiev": "Europe/Kyiv", "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
    "Atlantic/Faeroe": "Atlantic/Faroe", "US/Eastern": "America/New_York", "US/Central": "America/Chicago",
    "US/Mountain": "America/Denver", "US/Pacific": "America/Los_Angeles", "GMT": "UTC", "Etc/UTC": "UTC",
}
SAMPLE_ROOT = "/meetings-sample"
OUTLOOK_BLOCKS = {"busy", "tentative", "oof", "workingelsewhere"}


def zone_of(name: str | None) -> ZoneInfo:
    """A zone the functions' database knows; browsers still send old names."""
    try:
        return ZoneInfo(ZONE_ALIASES.get(name or "", name or "") or "UTC")
    except Exception:  # noqa: BLE001 — an unknown name is UTC, said so by the caller
        return ZoneInfo("UTC")


def parse_at(value: Any, zone_name: str | None = None) -> datetime | None:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    if "." in text:
        head, _, tail = text.partition(".")
        digits = "".join(ch for ch in tail if ch.isdigit())
        text = f"{head}.{digits[:6]}{tail[len(digits):]}"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=zone_of(zone_name) if zone_name else timezone.utc)
    return parsed.astimezone(timezone.utc)


def utc_key(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def rows_of(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def result_of(response: Any) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    result = (payload or {}).get("result", payload) or {}
    if isinstance(result, dict) and isinstance(result.get("data"), dict) and not (
        "items" in result or "value" in result or "calendars" in result or "id" in result
    ):
        return result["data"]
    return result if isinstance(result, dict) else {}


def sql_str(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def sql_in(values) -> str:
    return ", ".join(sql_str(v) for v in values) or "NULL"


def read_fixture(pod: Any, calendar_id: str) -> dict:
    """The sample calendar: Meetings' fixture, in Google's event shape."""
    return json.loads(pod.files.download(f"{SAMPLE_ROOT}/{calendar_id}.json").decode("utf-8"))


def busy_times(pod: Any, cal: dict, start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    """What blocks time on one of Meetings' calendars, read live.

    Google: its free/busy answer. Outlook: the calendar view, counting what is
    shown as busy, tentative, away or working elsewhere. The sample: its
    fixture, as Google would answer for it (anything not declined, not free,
    not all-day). Raises when the calendar cannot be read: a page must never
    offer a time it could not check.
    """
    provider = cal.get("provider")
    periods: list[tuple[datetime, datetime]] = []
    if provider == "sample":
        for event in read_fixture(pod, cal["id"]).get("events") or []:
            s = parse_at((event.get("start") or {}).get("dateTime"))
            e = parse_at((event.get("end") or {}).get("dateTime"))
            if not s or not e or event.get("status") == "cancelled" or event.get("transparency") == "transparent":
                continue
            mine = next((a for a in event.get("attendees") or [] if a.get("self")), None)
            if mine and mine.get("responseStatus") == "declined":
                continue
            if s < end and e > start:
                periods.append((s, e))
        return periods
    if provider == "google":
        result = result_of(pod.connectors.execute(
            "google_calendar", "GOOGLECALENDAR_FREE_BUSY_QUERY",
            {"timeMin": utc_key(start), "timeMax": utc_key(end), "items": ["primary"], "timeZone": "UTC"},
            account_id=cal.get("account_id")))
        for calendar_id, info in (result.get("calendars") or {}).items():
            if (info or {}).get("errors"):
                raise ValueError(f"Google Calendar could not read {calendar_id}: {info['errors']}")
            for b in (info or {}).get("busy") or []:
                s, e = parse_at(b.get("start")), parse_at(b.get("end"))
                if s and e:
                    periods.append((s, e))
        return periods
    if provider == "outlook":
        token = None
        for _ in range(20):
            payload = {"user_id": "me", "start_datetime": utc_key(start), "end_datetime": utc_key(end), "top": 100,
                       "select": ["start", "end", "showAs", "isCancelled", "isAllDay"]}
            if token:
                payload["page_token"] = token
            result = result_of(pod.connectors.execute("outlook", "OUTLOOK_GET_CALENDAR_VIEW", payload,
                                                      account_id=cal.get("account_id")))
            for event in result.get("value") or []:
                if event.get("isCancelled") or str(event.get("showAs") or "").lower() not in OUTLOOK_BLOCKS:
                    continue
                s = parse_at((event.get("start") or {}).get("dateTime"), (event.get("start") or {}).get("timeZone"))
                e = parse_at((event.get("end") or {}).get("dateTime"), (event.get("end") or {}).get("timeZone"))
                if s and e:
                    periods.append((s, e))
            token = result.get("next_page_token") or result.get("@odata.nextLink")
            if not token:
                break
        return periods
    raise ValueError(f"Unknown calendar provider {provider!r}")


def clock_of(value: str | None, fallback: str) -> time:
    try:
        hours, minutes = str(value or fallback).strip().split(":")[:2]
        return time(int(hours), int(minutes))
    except (ValueError, TypeError):
        hours, minutes = fallback.split(":")
        return time(int(hours), int(minutes))


def grid_step(minutes: int) -> int:
    return 15 if minutes < 30 else 30


def grid(settings: dict, zone: ZoneInfo, now: datetime) -> list[tuple[datetime, datetime]]:
    """Every start the rules allow, in the person's own day, oldest first.

    Starts sit on a grid from the day's first time: every 30 minutes, or every
    15 for calls shorter than half an hour.
    """
    length = timedelta(minutes=int(settings.get("minutes") or 30))
    step = timedelta(minutes=grid_step(int(settings.get("minutes") or 30)))
    days = {int(d) for d in (settings.get("days") or [0, 1, 2, 3, 4])}
    earliest = now + timedelta(hours=int(settings.get("notice_hours") or 0))
    today = now.astimezone(zone).date()
    last = today + timedelta(days=int(settings.get("days_ahead") or 14))
    out: list[tuple[datetime, datetime]] = []
    day = today
    while day <= last:
        if day.weekday() in days:
            cursor = datetime.combine(day, clock_of(settings.get("day_starts"), "09:30"), zone)
            close = datetime.combine(day, clock_of(settings.get("day_ends"), "17:30"), zone)
            while cursor + length <= close:
                if cursor >= earliest:
                    out.append((cursor.astimezone(timezone.utc), (cursor + length).astimezone(timezone.utc)))
                cursor += step
        day += timedelta(days=1)
    return out
# end shared


def booking_slots(ctx: FunctionContext, data: BookingSlotsInput) -> BookingSlotsResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    settings = (rows_of(pod.query("SELECT * FROM booking_settings LIMIT 1")) or [None])[0]
    if not settings or not settings.get("page_id"):
        return BookingSlotsResult(open=0, days=0, busy=0, held=0, calendars=0, errors=[],
                                  message="No booking page yet: finish its set-up first.")
    page = (rows_of(pod.query(f"SELECT id, state, slots FROM booking_page WHERE id = {sql_str(settings['page_id'])}")) or [None])[0]
    if not page:
        return BookingSlotsResult(open=0, days=0, busy=0, held=0, calendars=0, errors=[],
                                  message="This person's page is gone.")
    zone = zone_of(settings.get("timezone"))
    keep = {"minutes": int(settings.get("minutes") or 30), "notice_hours": int(settings.get("notice_hours") or 0),
            "timezone": zone.key, "video": settings.get("video") or "none"}
    if page.get("state") != "on" and not data.force:
        pod.table("booking_page").update(page["id"], keep)
        return BookingSlotsResult(open=0, days=0, busy=0, held=0, calendars=0, errors=[],
                                  message="The page is off; its times were left as they were.")

    ids = [str(c) for c in (settings.get("calendars") or [])]
    calendars = rows_of(pod.query(
        f"SELECT id, provider, account_id, email FROM meetings_calendar WHERE id IN ({sql_in(ids)})")) if ids else []
    candidates = grid(settings, zone, now)
    window_end = (candidates[-1][1] if candidates else now) + timedelta(hours=2)
    buffer = timedelta(minutes=int(settings.get("buffer_minutes") or 0))

    busy: list[tuple[datetime, datetime]] = []
    errors: list[str] = []
    for cal in calendars:
        try:
            busy += busy_times(pod, cal, now - timedelta(hours=2), window_end)
        except Exception as exc:  # noqa: BLE001 — said back, and the old times kept
            errors.append(f"{cal.get('email') or cal['id']}: {exc}"[:300])
    if ids and not calendars:
        errors.append("None of the chosen calendars is connected any more.")
    if errors:
        return BookingSlotsResult(open=len((page.get("slots") or [])), days=0, busy=len(busy), held=0,
                                  calendars=len(calendars), errors=errors,
                                  message="A calendar could not be read, so the page's times were left as they were.")

    held: list[tuple[datetime, datetime]] = []
    per_day: dict[Any, int] = {}
    length = timedelta(minutes=keep["minutes"])
    for row in rows_of(pod.query(
            "SELECT starts_at, ends_at, state FROM booking_request "
            f"WHERE page_id = {sql_str(page['id'])} AND state IN ({sql_in(LIVE)}) "
            f"AND starts_at >= {sql_str(utc_key(now - timedelta(days=1)))} LIMIT 2000")):
        s = parse_at(row.get("starts_at"))
        if not s:
            continue
        e = parse_at(row.get("ends_at")) or s + length
        held.append((s, e))
        local = s.astimezone(zone).date()
        per_day[local] = per_day.get(local, 0) + 1

    limit = int(settings.get("max_per_day") or 0)

    def free(s: datetime, e: datetime) -> bool:
        if any(s < b_end + buffer and b_start - buffer < e for b_start, b_end in busy):
            return False
        if any(s < h_end and h_start < e for h_start, h_end in held):
            return False
        return not limit or per_day.get(s.astimezone(zone).date(), 0) < limit

    open_times = [utc_key(s) for s, e in candidates if free(s, e)]
    days = {parse_at(t).astimezone(zone).date() for t in open_times}
    pod.table("booking_page").update(page["id"], {**keep, "slots": open_times, "slots_at": now.isoformat()})
    return BookingSlotsResult(
        open=len(open_times), days=len(days), busy=len(busy), held=len(held), calendars=len(calendars), errors=[],
        first=open_times[0] if open_times else None,
        message=f"{len(open_times)} open times over {len(days)} days, from {len(calendars)} calendars "
                f"({len(busy)} busy periods, {len(held)} bookings held).",
    )
