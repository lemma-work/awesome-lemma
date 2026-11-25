#input_type_name: SprintsCapacityInput
#output_type_name: SprintsCapacityResult
#function_name: sprints_capacity

"""How much each person can take in a sprint, worked out, never guessed.

- A person's **usual** is the mean of what they finished in their last 3
  closed sprints (the last 3 they had work in), in points, or in tasks when
  the Lemma counts tasks.
- Their **cap** for this sprint is usual × the share of its working days
  (Monday to Friday) they are here: days off typed in Sprints
  (`sprints_away`), a half day counting half.
- With no closed sprint behind them there is no usual and no cap: "No
  capacity yet". Nothing is filled in from team size or a default.
- Agents are counted in tasks, never in points capacity: their lane says how
  many tasks they have, and how many of theirs got done last sprint.

The app shows the same numbers, worked out the same way in the page; the start
of a sprint freezes this function's answer on the sprint (`capacity`).
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


class SprintsCapacityInput(BaseModel):
    # A number, "current" or "next"; the running sprint, else the next, when empty.
    sprint: str | int | None = None


class SprintsCapacityResult(BaseModel):
    sprint_number: int | None
    measure: str
    days: int
    people: list[dict]
    agents: list[dict]
    total: float | None
    planned: float
    message: str


# sprints:capacity
# Each person's capacity, shared word for word by sprints_capacity (where it is
# edited), sprints_start, sprints_close and the sample: bin/common.py copies it.
def capacity(pod, s: dict, sprint: dict) -> dict:
    measure = s["measure"]
    start, end = day(sprint["starts_on"]), day(sprint["ends_on"])
    days = working_days(start, end)
    closed = q(pod, "SELECT number, stats FROM sprints_sprint WHERE state = 'closed' "
                    f"AND number < {int(sprint['number'])} ORDER BY number DESC LIMIT 24")
    field = "points" if measure == "points" else "tasks"
    hist: dict[str, list] = {}
    names: dict[str, str] = {}
    users: dict[str, str | None] = {}
    for c in closed:
        for key, p in (json_obj(c.get("stats")).get("by_person") or {}).items():
            if not isinstance(p, dict):
                continue
            hist.setdefault(key, []).append({"sprint": int(c["number"]), "value": float(p.get(field) or 0)})
            names.setdefault(key, p.get("name") or "Someone")
            users.setdefault(key, p.get("user_id"))
    est = {r["id"]: float(r["points"]) for r in q(pod, "SELECT id, points FROM sprints_estimate")}
    items = q(pod, "SELECT i.task_id, t.number, t.assignee_kind, t.assignee_user_id, t.assignee_name, t.assignee_agent, t.status "
                   f"FROM sprints_item i JOIN task t ON t.id = i.task_id WHERE i.sprint_id = {lit(sprint['id'])} "
                   "AND i.removed_at IS NULL")
    unit = (lambda tid: est.get(tid) or 0.0) if measure == "points" else (lambda tid: 1.0)
    planned: dict[str, float] = {}
    tasks_of: dict[str, int] = {}
    agents: dict[str, int] = {}
    nobody = 0.0
    for i in items:
        a = assignee_of(i)
        if a["kind"] == "person":
            planned[a["key"]] = planned.get(a["key"], 0.0) + unit(i["task_id"])
            tasks_of[a["key"]] = tasks_of.get(a["key"], 0) + 1
            names[a["key"]] = a["name"]
            users[a["key"]] = a.get("user_id")
        elif a["kind"] == "agent":
            agents[a["agent"]] = agents.get(a["agent"], 0) + 1
        else:
            nobody += unit(i["task_id"])
    away = q(pod, "SELECT member_id, name, day, part FROM sprints_away "
                  f"WHERE day >= {lit(start.isoformat())} AND day <= {lit(end.isoformat())}")
    off: dict[str, list] = {}
    for a in away:
        on = day(a["day"])
        if on and on.weekday() < 5:
            key = person_key(a.get("member_id"), a.get("name"))
            off.setdefault(key, []).append({"day": on.isoformat(), "part": a.get("part") or "full"})
            names.setdefault(key, a.get("name") or "Someone")
            users.setdefault(key, a.get("member_id"))
    # The team: whoever had work in the last 3 closed sprints, has work here, or is away here.
    recent = {key for c in closed[:3] for key in (json_obj(c.get("stats")).get("by_person") or {})}
    keys = sorted(recent | set(planned) | set(off), key=lambda k: names.get(k, ""))
    people, total, any_cap = [], 0.0, False
    for key in keys:
        if key.startswith("agent:") or key == "none":
            continue
        last3 = (hist.get(key) or [])[:3]
        usual = sum(h["value"] for h in last3) / len(last3) if last3 else None
        days_off = sum(0.5 if o["part"] == "half" else 1.0 for o in off.get(key, []))
        present = max(0.0, len(days) - days_off)
        cap = usual * present / len(days) if usual is not None and days else None
        if cap is not None:
            total += cap
            any_cap = True
        people.append({"key": key, "name": names.get(key, "Someone"), "user_id": users.get(key), "usual": usual,
                       "history": last3, "days": len(days), "days_off": days_off, "present_days": present,
                       "away": off.get(key, []), "cap": cap, "planned": planned.get(key, 0.0),
                       "tasks": tasks_of.get(key, 0)})
    last = closed[0] if closed else None
    agent_last = (json_obj(last.get("stats")).get("agents") or {}) if last else {}
    agent_rows = [{"agent": name, "tasks": n, "last": agent_last.get(name)} for name, n in sorted(agents.items())]
    for name, was in agent_last.items():
        if name not in agents:
            agent_rows.append({"agent": name, "tasks": 0, "last": was})
    return {"days": len(days), "people": people, "agents": agent_rows, "total": total if any_cap else None,
            "planned": sum(planned.values()), "nobody": nobody}
# end sprints:capacity


def sprints_capacity(ctx: FunctionContext, data: SprintsCapacityInput) -> SprintsCapacityResult:
    pod = ctx.pod
    s = settings_of(pod)
    sprints = q(pod, "SELECT * FROM sprints_sprint ORDER BY number")
    which = data.sprint
    if which in (None, "", "current"):
        sprint = next((x for x in sprints if x["state"] in ("running", "closing")), None)
        if not sprint and which in (None, ""):
            sprint = next((x for x in sprints if x["state"] == "planned"), None)
    elif which == "next":
        sprint = next((x for x in sprints if x["state"] == "planned"), None)
    else:
        sprint = next((x for x in sprints if str(x["number"]) == str(which).lstrip("#")), None)
    if not sprint:
        return SprintsCapacityResult(sprint_number=None, measure=s["measure"], days=0, people=[], agents=[], total=None,
                                     planned=0.0, message="No such sprint.")
    c = capacity(pod, s, sprint)
    word = "pts" if s["measure"] == "points" else "tasks"
    if c["total"] is None:
        message = f"Sprint {sprint['number']}: no capacity yet. Nobody has a closed sprint behind them to go on."
    else:
        message = f"Sprint {sprint['number']}: {num(c['planned'])} of {num(c['total'])} {word} planned for people."
    return SprintsCapacityResult(sprint_number=int(sprint["number"]), measure=s["measure"], days=c["days"],
                                 people=c["people"], agents=c["agents"], total=c["total"], planned=c["planned"],
                                 message=message)
