#input_type_name: BookingProposeInput
#output_type_name: BookingProposeResult
#function_name: booking_propose

"""Set-up: propose when this person takes calls, from how their calendar is
actually used. Counted, never asked: no model is called.

It reads the meetings Meetings already read from the calendars the person
chose (the last month and the next two weeks) and proposes:

    days         the weekdays they meet on
    hours        from about their earliest usual start to their latest usual end
    call length  their usual meeting with people from outside, to 15/20/30/45/60
    buffer       more room when their meetings run back to back
    notice       a day when their days are full, else twelve hours
    how far      two weeks, as far as Meetings reads ahead
    daily limit  one more than their usual number of outside meetings a day

each with the sentence that says why. Too few meetings to read gives the
usual working week, and says so.
"""

from __future__ import annotations

import json
import math
import re
import statistics
from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
LENGTHS = [15, 20, 30, 45, 60]
RESERVED = {"setup", "settings", "upcoming", "about", "api", "app", "admin", "help", "new", "b", "s", "page", "pages"}


class BookingProposeInput(BaseModel):
    calendar_ids: list[str] | None = None
    timezone: str | None = None


class BookingProposeResult(BaseModel):
    calendars: list[dict]
    chosen: list[str]
    days: list[int]
    day_starts: str
    day_ends: str
    minutes: int
    buffer_minutes: int
    notice_hours: int
    days_ahead: int
    max_per_day: int
    reasons: dict
    counted: dict
    handle: str
    name: str
    timezone: str
    event_calendar: str | None
    video: str
    message: str


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


def _hhmm(minutes: int) -> str:
    minutes = max(0, min(24 * 60 - 1, minutes))
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _days_text(days: list[int]) -> str:
    if days == [0, 1, 2, 3, 4]:
        return "Monday to Friday"
    if len(days) > 2 and days == list(range(days[0], days[-1] + 1)):
        return f"{DAY_NAMES[days[0]]} to {DAY_NAMES[days[-1]]}"
    return ", ".join(SHORT[d] for d in days)


def _percentile(values: list[float], share: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round(share * (len(ordered) - 1))))
    return ordered[index]


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")[:40]


def booking_propose(ctx: FunctionContext, data: BookingProposeInput) -> BookingProposeResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    meetings_settings = (rows_of(pod.query("SELECT display_name, timezone FROM meetings_settings LIMIT 1")) or [{}])[0]
    mine = (rows_of(pod.query("SELECT id, display_name, timezone FROM booking_settings LIMIT 1")) or [{}])[0]
    zone = zone_of(data.timezone or mine.get("timezone") or meetings_settings.get("timezone"))
    calendars = rows_of(pod.query(
        "SELECT id, provider, account_id, email, state, last_read_at FROM meetings_calendar "
        "WHERE state <> 'stopped' ORDER BY connected_at"))
    chosen = [c["id"] for c in calendars if not data.calendar_ids or c["id"] in data.calendar_ids]

    rows = rows_of(pod.query(
        "SELECT start_at, end_at, outside FROM meeting "
        f"WHERE source = 'calendar' AND source_account IN ({sql_in(chosen)}) AND status <> 'cancelled' "
        f"AND start_at >= {sql_str(utc_key(now - timedelta(days=30)))} "
        f"AND start_at <= {sql_str(utc_key(now + timedelta(days=14)))} LIMIT 3000")) if chosen else []
    meetings = []
    for r in rows:
        s, e = parse_at(r.get("start_at")), parse_at(r.get("end_at"))
        if s and e and e > s and (e - s) < timedelta(hours=8):
            meetings.append((s.astimezone(zone), e.astimezone(zone), bool(r.get("outside"))))
    meetings.sort()
    reasons: dict[str, str] = {}
    enough = len(meetings) >= 6

    # Days.
    by_day = [0] * 7
    for s, _e, _o in meetings:
        by_day[s.weekday()] += 1
    if enough:
        floor = max(2, math.ceil(0.08 * len(meetings)))
        days = [d for d in range(7) if by_day[d] >= floor] or [0, 1, 2, 3, 4]
        weekend = by_day[5] + by_day[6]
        if 5 in days or 6 in days:
            reasons["days"] = f"You meet {_days_text(days)}."
        elif weekend:
            reasons["days"] = f"You meet {_days_text(days)}; {weekend} at weekends, too few to count."
        else:
            reasons["days"] = f"You meet {_days_text(days)}; nothing at weekends."
    else:
        days = [0, 1, 2, 3, 4]
        reasons["days"] = f"Only {len(meetings)} meetings to go on, so the usual working week."

    # Hours.
    on_days = [(s, e) for s, e, _o in meetings if s.weekday() in days]
    if len(on_days) >= 6:
        starts = [s.hour * 60 + s.minute for s, _e in on_days]
        ends = [e.hour * 60 + e.minute if e.date() == s.date() else 24 * 60 - 1 for s, e in on_days]
        first = int(_percentile(starts, 0.1)) // 30 * 30
        last = -(-int(_percentile(ends, 0.9)) // 30) * 30
        first = max(7 * 60, min(11 * 60, first))
        last = max(first + 4 * 60, min(20 * 60, last))
        day_starts, day_ends = _hhmm(first), _hhmm(last)
        reasons["hours"] = f"Most of your meetings fall between {day_starts} and {day_ends}, your time."
    else:
        day_starts, day_ends = "09:30", "17:30"
        reasons["hours"] = "Too few meetings to read your day, so 09:30 to 17:30."

    # Call length.
    outside = [int((e - s).total_seconds() // 60) for s, e, o in meetings if o]
    if len(outside) >= 3:
        usual = statistics.median(outside)
        minutes = min(LENGTHS, key=lambda n: (abs(n - usual), n))
        reasons["minutes"] = f"Your meetings with people from outside usually run {minutes} minutes ({len(outside)} counted)."
    else:
        minutes = 30
        reasons["minutes"] = "Thirty minutes, the usual first call."

    # Buffer: how often meetings run back to back.
    gaps = []
    for (s1, e1, _o1), (s2, _e2, _o2) in zip(meetings, meetings[1:]):
        if s1.date() == s2.date():
            gap = (s2 - e1).total_seconds() / 60
            if 0 <= gap < 180:
                gaps.append(gap)
    back_to_back = sum(1 for g in gaps if g < 5) / len(gaps) if gaps else 0.0
    if gaps and back_to_back >= 0.4:
        buffer = 15
        reasons["buffer"] = f"{round(back_to_back * 100)}% of your meetings run straight into the next, so 15 minutes are kept clear either side."
    elif gaps and back_to_back >= 0.15:
        buffer = 10
        reasons["buffer"] = f"Some of your meetings run straight into the next ({round(back_to_back * 100)}%), so 10 minutes either side."
    else:
        buffer = 10 if gaps else 15
        reasons["buffer"] = ("You usually leave room between meetings; 10 minutes either side keeps it."
                             if gaps else "Fifteen minutes either side of anything on your calendar.")

    # Notice: how full the days are.
    past = [s for s, _e, _o in meetings if s < now]
    active_days = {s.date() for s in past}
    per_active = len(past) / len(active_days) if active_days else 0.0
    if per_active >= 4:
        notice = 24
        reasons["notice"] = f"Your days hold about {per_active:.0f} meetings, so a day's notice."
    else:
        notice = 12
        usual = max(1, round(per_active))
        reasons["notice"] = ("Twelve hours' notice, so nothing lands on you the same morning."
                             if not active_days else
                             f"About {usual} {'meeting' if usual == 1 else 'meetings'} on a day you meet; twelve hours' notice is enough.")

    days_ahead = 14
    reasons["days_ahead"] = "Two weeks ahead, as far as Meetings reads your calendar."

    # Daily limit: one more than the usual number of outside meetings on a day with any.
    outside_days: dict[Any, int] = {}
    for s, _e, o in meetings:
        if o and s < now:
            outside_days[s.date()] = outside_days.get(s.date(), 0) + 1
    if len(outside_days) >= 3:
        usual_day = statistics.median(outside_days.values())
        limit = int(max(2, min(5, round(usual_day) + 1)))
        usual_n = max(1, round(usual_day))
        reasons["max_per_day"] = (f"On a day you meet people from outside it's usually {usual_n} "
                                  f"{'meeting' if usual_n == 1 else 'meetings'}; at most {limit} bookings keeps a day like your busier ones.")
    else:
        limit = 3
        reasons["max_per_day"] = "At most three bookings a day."

    # The page: a handle nobody has, from their name or address.
    name = (mine.get("display_name") or meetings_settings.get("display_name") or "").strip()
    email = (ctx.user_email or "").lower()
    base = _slug(name) or _slug(email.split("@")[0]) or "me"
    if base in RESERVED:
        base = f"{base}-page"
    taken = {r["handle"] for r in rows_of(pod.query(
        f"SELECT handle FROM booking_page WHERE handle LIKE {sql_str(base + '%')} LIMIT 500"))}
    mine_page = rows_of(pod.query(
        "SELECT p.handle FROM booking_page p JOIN booking_settings s ON s.page_id = p.id LIMIT 1"))
    handle = mine_page[0]["handle"] if mine_page else base
    n = 2
    while not mine_page and handle in taken:
        handle, n = f"{base}-{n}", n + 1

    picked = [c for c in calendars if c["id"] in chosen]
    real = [c for c in picked if c.get("provider") != "sample"]
    event = (real or picked or [None])[0]
    video = {"google": "google_meet", "outlook": "teams"}.get((event or {}).get("provider"), "none")

    proposal = {"days": days, "day_starts": day_starts, "day_ends": day_ends, "minutes": minutes,
                "buffer_minutes": buffer, "notice_hours": notice, "days_ahead": days_ahead, "max_per_day": limit,
                "reasons": reasons, "counted": {"meetings": len(meetings), "outside": len(outside),
                                                "days_met": len(active_days), "back_to_back": round(back_to_back, 2)}}
    if mine.get("id"):
        pod.table("booking_settings").update(mine["id"], {"proposal": proposal, "timezone": zone.key})
    return BookingProposeResult(
        calendars=[{"id": c["id"], "provider": c.get("provider"), "email": c.get("email"), "state": c.get("state")}
                   for c in calendars],
        chosen=chosen, days=days, day_starts=day_starts, day_ends=day_ends, minutes=minutes, buffer_minutes=buffer,
        notice_hours=notice, days_ahead=days_ahead, max_per_day=limit, reasons=reasons,
        counted=proposal["counted"], handle=handle, name=name or email.split("@")[0], timezone=zone.key,
        event_calendar=(event or {}).get("id"), video=video,
        message=f"Read {len(meetings)} meetings from {len(chosen)} calendars.",
    )
