#input_type_name: TodaySweepInput
#output_type_name: TodaySweepResult
#function_name: today_sweep

"""The morning check: the day in a few lines, from the shared `needs_you` list
(whichever plugins wrote it), kept on `today_settings.day_note` as the morning
note would say it. Lemma cannot yet send it to the person at their time (see
the README), so the app shows the page instead.

Run by `today-sweep` at the person's morning time (their own schedule, made by
the app when they answer "when do you want your day?"), once right after that,
and when they press Check again. "Worth a nudge yet?" is not here: it is the
item's own plugin's to ask (Mail, with the person's meetings as evidence);
Today only passes on the person's own request for one (`request = nudge`).
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

NO_DATE_DAYS = 5
ZONE_ALIASES = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu",
                "Asia/Rangoon": "Asia/Yangon", "Europe/Kiev": "Europe/Kyiv", "US/Eastern": "America/New_York",
                "US/Central": "America/Chicago", "US/Mountain": "America/Denver", "US/Pacific": "America/Los_Angeles"}

VERB_WORDS = {"answer": "to answer", "decide": "to decide", "attend": "meeting", "do": "to do",
              "waiting": "waiting on others", "drifting": "drifting"}


class TodaySweepInput(BaseModel):
    pass


class TodaySweepResult(BaseModel):
    items: int
    counts: dict
    note: str
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


def _clip(text: Any, size: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= size else text[: size - 1] + "…"


def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(ZONE_ALIASES.get(name or "", name or "UTC"))
    except Exception:  # noqa: BLE001 — an unknown zone reads as UTC
        return ZoneInfo("UTC")


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _days_late(item: dict, now: datetime, zone: ZoneInfo) -> int:
    """Whole days past its due day (the app's `due()`); with no date, days waiting past NO_DATE_DAYS."""
    due = _parse(item.get("due_at"))
    if due:
        return (now.astimezone(zone).date() - due.astimezone(zone).date()).days
    since = _parse(item.get("since_at")) or _parse(item.get("created_at"))
    return ((now - since).days - NO_DATE_DAYS + 1) if since else 0


def _note(items: list[dict], now: datetime, zone: ZoneInfo) -> tuple[str, dict]:
    today = now.astimezone(zone).date()
    counts: dict[str, int] = {}
    meetings = []
    for it in items:
        verb = it.get("verb")
        if verb == "attend":
            start = _parse(it.get("due_at"))
            if start and start.astimezone(zone).date() == today:
                meetings.append((start, it.get("title")))
                counts["attend"] = counts.get("attend", 0) + 1
            continue
        counts[verb] = counts.get(verb, 0) + 1
    late = sum(1 for it in items if it.get("verb") in ("do", "waiting") and _parse(it.get("due_at")) and _days_late(it, now, zone) > 0)
    parts = [f"Your day, {now.astimezone(zone).strftime('%A %d %B')}."]
    for verb in ("answer", "decide", "do", "waiting", "drifting"):
        if counts.get(verb):
            parts.append(f"{counts[verb]} {VERB_WORDS[verb]}.")
    if late:
        parts.append(f"{late} late.")
    if meetings:
        meetings.sort()
        first = ", ".join(f"{s.astimezone(zone).strftime('%H:%M')} {_clip(t, 60)}" for s, t in meetings[:3])
        parts.append(f"{_plural(len(meetings), 'meeting')} today: {first}" + ("…" if len(meetings) > 3 else "."))
    if len(parts) == 1:
        parts.append("Nothing needs you.")
    counts["late"] = late
    return " ".join(parts)[:1200], counts


def today_sweep(ctx: FunctionContext, data: TodaySweepInput) -> TodaySweepResult:
    pod = ctx.pod
    began = time.monotonic()
    now = datetime.now(timezone.utc)
    settings = (_rows(pod.query("SELECT id, timezone FROM today_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    zone = _zone(settings.get("timezone"))
    items = _rows(pod.query(
        "SELECT verb, title, due_at, since_at, created_at FROM needs_you "
        f"WHERE state = 'open' OR (state = 'snoozed' AND snoozed_until <= {_sql(_iso(now))}) LIMIT 2000"))
    note, counts = _note(items, now, zone)
    if settings.get("id"):
        pod.table("today_settings").update(settings["id"], {"last_swept_at": _iso(now), "last_sweep": {"at": _iso(now), "counts": counts},
                                                            "day_note": note, "day_note_at": _iso(now)})
    return TodaySweepResult(items=len(items), counts=counts, note=note,
                            message=f"{len(items)} item(s) on the day ({round(time.monotonic() - began, 1)} s)")
