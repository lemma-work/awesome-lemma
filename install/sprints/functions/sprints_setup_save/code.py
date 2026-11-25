#input_type_name: SprintsSetupSaveInput
#output_type_name: SprintsSetupSaveResult
#function_name: sprints_setup_save

"""Sprints' set-up, done once by whoever opens it first (the lead): how long a
sprint is, the day it starts, the time zone, points or a task count, and who
plans and closes sprints. Run again from Settings to change any of it.

Keeps the one settings row, makes Sprint 1 on the next start day when there is
no sprint yet (with `sample`, none: the app loads the sample sprint next, with
sprints_sample_data, which takes a minute), and tells
this Lemma's agents Sprints is here (`sprints_memory`). The lead's own daily
06:00 run is made by the app as the lead (a schedule runs as whoever made it),
the way Tasks makes each person's.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# sprints:common
# Shared by every Sprints function, word for word: bin/common.py copies it in.
# Edit it there, never here.
import math as _math
import uuid as _uuid
from datetime import date as _date, datetime as _datetime, time as _time, timedelta as _timedelta, timezone as _tz
from zoneinfo import ZoneInfo as _Zone

SPRINTS_NS = _uuid.UUID("2f6b8c1e-7d4a-4b9e-9c3f-5e1a7d2b8c64")
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DEFAULT_SCALE = [1, 2, 3, 5, 8]
DEFAULT_SOURCES = ["incidents", "triage", "pr_review"]
SOURCE_NAMES = {"incidents": "Incidents", "triage": "Triage", "pr_review": "PR review", "tasks": "Tasks",
                "chat": "chat", "promise": "a promise", "sprints": "Sprints", "linear": "Linear", "jira": "Jira"}
PRIORITY_ORDER = {"urgent": 4, "high": 3, "medium": 2, "low": 1, "none": 0}
ZONE_ALIASES = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu",
                "Europe/Kiev": "Europe/Kyiv", "US/Eastern": "America/New_York", "US/Pacific": "America/Los_Angeles"}
SETTINGS_ID = str(_uuid.uuid5(SPRINTS_NS, "settings"))
ASSISTANT = "pod_default"


def sid(*parts) -> str:
    """A stable id from its parts: an item is sid(sprint id, task id)."""
    return str(_uuid.uuid5(SPRINTS_NS, ":".join(str(p) for p in parts)))


def rows(response) -> list:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def q(pod, sql: str) -> list:
    return rows(pod.query(sql))


def lit(value) -> str:
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def lits(values) -> str:
    return ", ".join(lit(v) for v in values) or "NULL"


def as_dict(obj) -> dict:
    if obj is None:
        return {}
    if hasattr(obj, "to_dict"):
        obj = obj.to_dict()
    return obj if isinstance(obj, dict) else {}


def now_iso() -> str:
    return _datetime.now(_tz.utc).isoformat()


def zone(name) -> _Zone:
    try:
        return _Zone(ZONE_ALIASES.get(name or "", name or "UTC"))
    except Exception:  # noqa: BLE001
        return _Zone("UTC")


def today_in(name) -> _date:
    return _datetime.now(_tz.utc).astimezone(zone(name)).date()


def day(value):
    if not value:
        return None
    if isinstance(value, _date) and not isinstance(value, _datetime):
        return value
    try:
        return _date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def stamp(value):
    if not value:
        return None
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def local_day(value, zone_name):
    moment = stamp(value)
    return moment.astimezone(zone(zone_name)).date() if moment else None


def at_local(on, hour: int, zone_name) -> str:
    return _datetime.combine(on, _time(hour, 0), zone(zone_name)).astimezone(_tz.utc).isoformat()


def working_days(start, end) -> list:
    out, d = [], start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += _timedelta(days=1)
    return out


def sprint_bounds(starts_on, weeks: int):
    """A sprint's first day and its last working day before the next starts."""
    nxt = starts_on + _timedelta(days=7 * max(1, min(4, int(weeks or 2))))
    end = nxt - _timedelta(days=1)
    while end.weekday() >= 5 and end > starts_on:
        end -= _timedelta(days=1)
    return starts_on, end


def next_start(today, weekday: str):
    """The next start day: today when today is one."""
    want = WEEKDAYS.index(weekday) if weekday in WEEKDAYS else 0
    return today + _timedelta(days=(want - today.weekday()) % 7)


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM sprints_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM sprints_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s.setdefault("length_weeks", 2)
    s["length_weeks"] = int(s.get("length_weeks") or 2)
    s["start_weekday"] = s.get("start_weekday") or "mon"
    s["timezone"] = s.get("timezone") or "UTC"
    s["measure"] = s.get("measure") or "points"
    s["scale"] = json_list(s.get("scale")) or DEFAULT_SCALE
    s["watch_sources"] = json_list(s.get("watch_sources")) or DEFAULT_SOURCES
    return s


def json_list(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip().startswith("["):
        import json as _json
        try:
            got = _json.loads(value)
            return got if isinstance(got, list) else []
        except ValueError:
            return []
    return []


def json_obj(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip().startswith("{"):
        import json as _json
        try:
            got = _json.loads(value)
            return got if isinstance(got, dict) else {}
        except ValueError:
            return {}
    return {}


def num(value) -> str:
    """A number as said on screen and in a summary: never rounded up (cut to
    one decimal), and without a trailing .0."""
    if value is None:
        return "0"
    cut = _math.floor(float(value) * 10 + 1e-9) / 10
    return str(int(cut)) if cut == int(cut) else f"{cut:.1f}"


def ordinal(n: int) -> str:
    n = int(n or 1)
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def person_key(user_id, name) -> str:
    return str(user_id) if user_id else "name:" + " ".join(str(name or "").lower().split())


def assignee_of(task: dict) -> dict:
    """Who a task is on: {kind, key, name} with kind person, agent or none."""
    kind = task.get("assignee_kind") or "none"
    if kind == "agent":
        agent = task.get("assignee_agent") or ASSISTANT
        return {"kind": "agent", "key": "agent:" + agent, "name": "The Lemma's assistant" if agent == ASSISTANT else agent,
                "agent": agent}
    if kind == "person" and (task.get("assignee_user_id") or task.get("assignee_name")):
        return {"kind": "person", "key": person_key(task.get("assignee_user_id"), task.get("assignee_name")),
                "name": task.get("assignee_name") or "Someone", "user_id": task.get("assignee_user_id")}
    return {"kind": "none", "key": "none", "name": "Nobody yet"}


def tag(task: dict) -> str:
    return f"#{task.get('number')}" if task.get("number") is not None else "a task"


def joined(words: list) -> str:
    words = [w for w in words if w]
    if len(words) <= 1:
        return "".join(words)
    return ", ".join(words[:-1]) + " and " + words[-1]


def short_day(on) -> str:
    return f"{WEEKDAYS[on.weekday()].capitalize()} {on.day}" if on else ""


def month_day(on) -> str:
    return on.strftime("%b ") + str(on.day) if on else ""
# end sprints:common


class SprintsSetupSaveInput(BaseModel):
    length_weeks: int = 2
    start_weekday: str = "mon"
    timezone: str | None = None
    measure: str = "points"
    # The lead; the person running set-up when not given.
    lead_user_id: str | None = None
    lead_name: str | None = None
    scale: list[float] | None = None
    watch_sources: list[str] | None = None
    # Look around with a sample sprint instead of an empty Sprint 1.
    sample: bool = False


class SprintsSetupSaveResult(BaseModel):
    settings_id: str
    sprint_number: int | None
    starts_on: str | None
    sample: bool
    memory: str
    message: str


def sprints_setup_save(ctx: FunctionContext, data: SprintsSetupSaveInput) -> SprintsSetupSaveResult:
    pod = ctx.pod
    old = settings_of(pod)
    weeks = max(1, min(4, int(data.length_weeks or 2)))
    weekday = data.start_weekday if data.start_weekday in WEEKDAYS else "mon"
    measure = data.measure if data.measure in ("points", "tasks") else "points"
    tz = data.timezone or old.get("timezone") or "UTC"
    lead_id = data.lead_user_id or old.get("lead_user_id") or (str(ctx.user_id) if ctx.user_id else None)
    lead_name = data.lead_name or (old.get("lead_name") if lead_id == old.get("lead_user_id") else None) or ctx.user_name \
        or (ctx.user_email or "").split("@")[0] or None
    scale = [float(x) for x in (data.scale or old.get("scale") or DEFAULT_SCALE) if float(x) > 0][:5] or DEFAULT_SCALE
    row = {
        "id": SETTINGS_ID, "length_weeks": weeks, "start_weekday": weekday, "timezone": tz, "measure": measure,
        "lead_user_id": lead_id, "lead_name": lead_name,
        "scale": [int(x) if float(x).is_integer() else x for x in scale],
        "watch_sources": data.watch_sources or old.get("watch_sources") or DEFAULT_SOURCES,
        "setup_done_at": old.get("setup_done_at") or now_iso(),
    }
    if old.get("id") and old["id"] != SETTINGS_ID:
        row["id"] = old["id"]
    pod.records.bulk_create("sprints_settings", [row], upsert=True)

    number, starts = None, None
    sprints = q(pod, "SELECT id, number, state, starts_on FROM sprints_sprint ORDER BY number")
    if data.sample and not sprints:
        # The sample takes longer than one call should wait: the app runs
        # sprints_sample_data next, on its own, and shows it as it arrives.
        message = "Saved. Load the sample with sprints_sample_data."
    elif not sprints:
        first, last = sprint_bounds(next_start(today_in(tz), weekday), weeks)
        pod.records.create("sprints_sprint", {"id": sid("sprint", 1), "number": 1, "starts_on": first.isoformat(),
                                              "ends_on": last.isoformat(), "state": "planned"})
        number, starts = 1, first.isoformat()
        message = f"Sprint 1 starts {short_day(first)} {month_day(first)}."
    else:
        # Later sprints follow the new length; a planned one moves to the new start day.
        planned = [s for s in sprints if s["state"] == "planned"]
        for s in planned:
            first = day(s["starts_on"])
            first, last = sprint_bounds(next_start(first, weekday), weeks)
            pod.records.update("sprints_sprint", s["id"], {"starts_on": first.isoformat(), "ends_on": last.isoformat()})
        message = "Saved. Sprints already here keep their dates; the next one follows the new set-up."

    try:
        memory = as_dict(as_dict(pod.functions.run("sprints_memory", {})).get("output_data")).get("message") or "done"
    except Exception as exc:  # noqa: BLE001 — set-up goes on without it
        memory = f"Could not write the memory block: {type(exc).__name__}"
    try:
        pod.functions.run("sprints_needs_you", {})
    except Exception:  # noqa: BLE001
        pass
    return SprintsSetupSaveResult(settings_id=row["id"], sprint_number=number, starts_on=starts, sample=data.sample,
                                  memory=memory, message=message)
