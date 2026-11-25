#input_type_name: SprintsRemoveInput
#output_type_name: SprintsRemoveResult
#function_name: sprints_remove

"""Take team tasks out of a sprint: back to the backlog, or (`to` next) into
the sprint being planned, which is what "Move both to Sprint 48" does.

Before a sprint starts this only changes the plan, and leaves no trace. After
the start the task stays on the sprint's record as taken out (`removed_at`,
who, when) and the scope graph steps down; what was in at the start is never
changed. A move-out suggestion naming these tasks is marked taken.
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


class SprintsRemoveInput(BaseModel):
    tasks: list[str]
    sprint: str | int | None = None
    # backlog, or next: into the sprint being planned
    to: str = "backlog"
    via: str = "app"


class SprintsRemoveResult(BaseModel):
    sprint_number: int | None
    removed: list[str]
    message: str


def sprints_remove(ctx: FunctionContext, data: SprintsRemoveInput) -> SprintsRemoveResult:
    pod = ctx.pod
    sprints = q(pod, "SELECT * FROM sprints_sprint ORDER BY number")
    which = data.sprint
    if which in (None, "", "current"):
        sprint = next((x for x in sprints if x["state"] in ("running", "closing")), None) or \
            next((x for x in sprints if x["state"] == "planned"), None)
    elif which == "next":
        sprint = next((x for x in sprints if x["state"] == "planned"), None)
    else:
        sprint = next((x for x in sprints if str(x["number"]) == str(which).lstrip("#")), None)
    if not sprint or sprint["state"] == "closed":
        return SprintsRemoveResult(sprint_number=None, removed=[], message="No open sprint to take it out of.")
    ids = [str(t).lstrip("#") for t in data.tasks]
    nums = [i for i in ids if i.isdigit()]
    uuids = [i for i in ids if not i.isdigit()]
    where = " OR ".join(([f"t.id IN ({lits(uuids)})"] if uuids else []) + ([f"t.number IN ({', '.join(nums)})"] if nums else []))
    if not where:
        return SprintsRemoveResult(sprint_number=sprint["number"], removed=[], message="No task named.")
    items = q(pod, "SELECT i.id, i.task_id, i.points_at_add, t.number FROM sprints_item i JOIN task t ON t.id = i.task_id "
                   f"WHERE i.sprint_id = {lit(sprint['id'])} AND i.removed_at IS NULL AND ({where})")
    if not items:
        return SprintsRemoveResult(sprint_number=sprint["number"], removed=[], message="Those tasks are not in the sprint.")
    now = now_iso()
    who = ctx.user_name or (ctx.user_email or "").split("@")[0] or None
    actor = {"actor_kind": "person" if ctx.user_id else "lemma", "actor_name": who,
             "actor_user_id": str(ctx.user_id) if ctx.user_id else None}
    via = data.via if data.via in ("app", "chat") else "app"
    removed = [f"#{i['number']}" for i in items]
    if sprint["state"] == "planned":
        pod.records.bulk_delete("sprints_item", [i["id"] for i in items])
    else:
        pod.records.bulk_update("sprints_item", [{"id": i["id"], "removed_at": now, "removed_by": who, "outcome": "backlog"}
                                                 for i in items])
        est = {r["id"]: float(r["points"]) for r in q(pod, f"SELECT id, points FROM sprints_estimate WHERE id IN ({lits([i['task_id'] for i in items])})")}
        pod.records.bulk_create("sprints_event", [{
            "id": sid("event", i["id"], "removed", now), "sprint_id": sprint["id"], "task_id": i["task_id"], "kind": "removed",
            "at": now, "via": via, **actor, "detail": {"points": est.get(i["task_id"]), "to": data.to}} for i in items], upsert=True)
    moved = ""
    if data.to == "next":
        out = as_dict(as_dict(pod.functions.run("sprints_add", {"tasks": [i["task_id"] for i in items], "sprint": "next",
                                                                "via": via})).get("output_data"))
        moved = f" Moved to Sprint {out.get('sprint_number')}." if out.get("sprint_number") else ""
    taken = {i["task_id"] for i in items}
    for r in q(pod, f"SELECT id, task_ids FROM sprints_suggestion WHERE kind = 'move_out' AND state = 'open' AND sprint_id = {lit(sprint['id'])}"):
        if set(json_list(r.get("task_ids"))) <= taken:
            pod.records.update("sprints_suggestion", r["id"], {"state": "taken", "decided_by": who, "decided_at": now})
    if sprint["state"] != "planned":
        try:
            pod.functions.run("sprints_tick", {"only": "risks"})
        except Exception:  # noqa: BLE001
            pass
    where_to = "" if data.to == "next" else " Back in the backlog."
    return SprintsRemoveResult(sprint_number=int(sprint["number"]), removed=removed,
                               message=f"Took {joined(removed)} out of Sprint {sprint['number']}.{moved}{where_to}")
