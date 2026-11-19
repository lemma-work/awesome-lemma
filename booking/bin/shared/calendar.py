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
