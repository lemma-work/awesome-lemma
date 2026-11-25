#input_type_name: SprintsOnTaskInput
#output_type_name: SprintsOnTaskResult
#function_name: sprints_on_task

"""A team task changed, or a new one came in. The target of both of Sprints'
triggers on the shared `task` table (`sprints-task-changed`, UPDATE;
`sprints-task-added`, INSERT).

A change, for a task in the running sprint: what moved, written to
`sprints_event` with the value before (the trigger passes `previous` and
`changed`): started, done, reopened or another status, and assigned. Done and
reopened also set the item's `outcome` and `done_at`, and the first start its
`started_at`, which the scope graph reads. A trigger on the team's table does
not say who wrote the row; when Tasks' app made the change it logged it in
`tasks_activity` a moment before, and that names the person.

A new task: if it came from a source the lead watches (Incidents, Triage, PR
review), at high or urgent priority, while a sprint is running, the Lemma
suggests pulling it in (`sprints_suggestion`, kind pull_in), with what that
does to capacity and what could move out to make room, and the lead gets a
"decide" item in Today. Nothing is added to the sprint without a person.
"""

from __future__ import annotations

import time

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

TASK_COLUMNS = ("id, number, title, status, priority, source, source_id, source_url, assignee_kind, assignee_user_id, "
                "assignee_name, assignee_agent, parent_id, done_at, created_at, updated_at")
ASSIGNEE = {"assignee_kind", "assignee_user_id", "assignee_agent", "assignee_name"}


class SprintsOnTaskInput(BaseModel):
    task_id: str | None = None
    # insert or update (what the trigger saw)
    op: str = "update"
    changed: list[str] | None = None
    previous: dict | None = None
    at: str | None = None


class SprintsOnTaskResult(BaseModel):
    events: int
    suggested: bool
    message: str


def _actor(pod, task_id: str, at: str) -> dict:
    """Who made a change, when Tasks' app logged it on the task's timeline."""
    moment = stamp(at) or stamp(now_iso())
    since = (moment - _timedelta(seconds=45)).isoformat()
    for attempt in range(2):
        try:
            found = q(pod, "SELECT actor_kind, actor_name, actor_user_id FROM tasks_activity "
                           f"WHERE task_id = {lit(task_id)} AND kind IN ('status', 'assign') AND created_at >= {lit(since)} "
                           "ORDER BY created_at DESC LIMIT 1")
        except Exception:  # noqa: BLE001 — Tasks' timeline may not be there
            return {"actor_kind": "unknown"}
        if found:
            a = found[0]
            kind = a.get("actor_kind") if a.get("actor_kind") in ("person", "agent", "lemma") else "unknown"
            return {"actor_kind": kind, "actor_name": a.get("actor_name"), "actor_user_id": a.get("actor_user_id")}
        if attempt == 0:
            time.sleep(1.5)
    return {"actor_kind": "unknown"}


def _name(row: dict) -> str | None:
    kind = row.get("assignee_kind")
    if kind == "agent":
        return "The Lemma's assistant" if (row.get("assignee_agent") or ASSISTANT) == ASSISTANT else row.get("assignee_agent")
    if kind == "person":
        return row.get("assignee_name") or "someone"
    return None


def sprints_on_task(ctx: FunctionContext, data: SprintsOnTaskInput) -> SprintsOnTaskResult:
    pod = ctx.pod
    if not data.task_id:
        return SprintsOnTaskResult(events=0, suggested=False, message="No task.")
    found = q(pod, f"SELECT {TASK_COLUMNS} FROM task WHERE id = {lit(data.task_id)}")
    if not found:
        return SprintsOnTaskResult(events=0, suggested=False, message="The task is gone.")
    task = found[0]
    s = settings_of(pod)
    if not s.get("setup_done_at"):
        return SprintsOnTaskResult(events=0, suggested=False, message="Sprints is not set up.")
    at = data.at or now_iso()

    if data.op == "insert":
        return _came_in(ctx, s, task)

    changed = set(data.changed or [])
    if not changed & ({"status"} | ASSIGNEE):
        return SprintsOnTaskResult(events=0, suggested=False, message="Nothing Sprints follows changed.")
    prev = data.previous or {}
    items = q(pod, "SELECT i.id, i.sprint_id, i.outcome, i.started_at, i.done_at FROM sprints_item i "
                   "JOIN sprints_sprint s ON s.id = i.sprint_id "
                   f"WHERE i.task_id = {lit(task['id'])} AND i.removed_at IS NULL AND s.state IN ('running', 'closing')")
    if not items:
        return SprintsOnTaskResult(events=0, suggested=False, message="Not in a running sprint.")
    actor = _actor(pod, task["id"], at)
    events, updates = [], []
    for item in items:
        base = {"sprint_id": item["sprint_id"], "task_id": task["id"], "at": at, "via": "trigger", **actor}
        if "status" in changed:
            old, new = prev.get("status"), task.get("status")
            patch = {"id": item["id"]}
            if new == "done":
                kind = "done"
                patch.update(outcome="done", done_at=task.get("done_at") or at)
                if not item.get("started_at"):
                    patch["started_at"] = at
            elif old == "done":
                kind = "reopened"
                patch.update(outcome="open", done_at=None)
            elif new in ("in_progress", "waiting") and old in ("todo", None):
                kind = "started"
                if not item.get("started_at"):
                    patch["started_at"] = at
            else:
                kind = "status"
            events.append(dict(base, id=sid("event", item["id"], "status", at), kind=kind,
                               detail={"from": old, "to": new}))
            if len(patch) > 1:
                updates.append(patch)
        if changed & ASSIGNEE:
            before = {k: prev.get(k, task.get(k)) for k in ASSIGNEE}
            events.append(dict(base, id=sid("event", item["id"], "assigned", at), kind="assigned",
                               detail={"from": _name(before), "to": _name(task)}))
    if events:
        pod.records.bulk_create("sprints_event", events, upsert=True)
    if updates:
        pod.records.bulk_update("sprints_item", updates)
    # What may slip changes with every move: refresh it.
    try:
        pod.functions.run("sprints_tick", {"only": "risks"})
    except Exception:  # noqa: BLE001 — the daily run refreshes it anyway
        pass
    return SprintsOnTaskResult(events=len(events), suggested=False,
                               message=f"Recorded {len(events)} change(s) to {tag(task)}.")


def _came_in(ctx, s: dict, task: dict) -> SprintsOnTaskResult:
    pod = ctx.pod
    source = (task.get("source") or "").lower()
    if source not in [str(x).lower() for x in s["watch_sources"]] or task.get("priority") not in ("high", "urgent") \
            or task.get("parent_id") or task.get("status") in ("done", "canceled"):
        return SprintsOnTaskResult(events=0, suggested=False, message="Not urgent work from a watched source.")
    running = q(pod, "SELECT id, number, capacity_total FROM sprints_sprint WHERE state IN ('running', 'closing') "
                     "ORDER BY number LIMIT 1")
    if not running:
        return SprintsOnTaskResult(events=0, suggested=False, message="No sprint is running; it waits for planning.")
    sprint = running[0]
    if q(pod, f"SELECT id FROM sprints_item WHERE id = {lit(sid(sprint['id'], task['id']))} AND removed_at IS NULL"):
        return SprintsOnTaskResult(events=0, suggested=False, message="Already in the sprint.")
    sug_id = sid(sprint["id"], "pull_in", task["id"])
    have = q(pod, f"SELECT state FROM sprints_suggestion WHERE id = {lit(sug_id)}")
    if have and have[0].get("state") != "open":
        return SprintsOnTaskResult(events=0, suggested=False, message="Already decided.")

    points_on = s["measure"] == "points"
    est = {r["id"]: float(r["points"]) for r in q(pod, "SELECT id, points FROM sprints_estimate")}
    items = q(pod, "SELECT i.task_id, i.points_at_add, t.number, t.status, t.priority, t.title FROM sprints_item i "
                   f"JOIN task t ON t.id = i.task_id WHERE i.sprint_id = {lit(sprint['id'])} AND i.removed_at IS NULL")
    unit = (lambda tid: est.get(tid)) if points_on else (lambda tid: 1.0)
    scope = sum(unit(i["task_id"]) or 0 for i in items)
    mine = unit(task["id"])
    cap = sprint.get("capacity_total")
    where = SOURCE_NAMES.get(source, source)
    ref = f" ({task['source_id']})" if task.get("source_id") and len(str(task["source_id"])) <= 24 else ""
    word = "pts" if points_on else "tasks"
    size = (f", {num(mine)} pts" if mine is not None else ", not estimated") if points_on else ""
    text = f"{tag(task)} came in from {where}{ref}, {task['priority']}{size}."
    move: list[dict] = []
    if cap is not None and (mine or 0) > 0:
        over = scope + (mine or 0) - float(cap)
        if over > 0:
            # What could make room: work not started, lowest priority first.
            spare = sorted([i for i in items if i.get("status") == "todo" and (unit(i["task_id"]) or 0) > 0],
                           key=lambda i: (PRIORITY_ORDER.get(i.get("priority") or "none", 0), -(unit(i["task_id"]) or 0)))
            room = 0.0
            for i in spare:
                if room >= over:
                    break
                move.append(i)
                room += unit(i["task_id"]) or 0
            text += f" Pulled in, the sprint is {num(over)} {word} over its capacity of {num(cap)}."
            if move:
                text += f" {joined(['#' + str(i['number']) for i in move])} ({num(room)} {word}, not started) could move out."
        else:
            text += f" It fits: {num(-over)} {word} of capacity left after it."
    elif cap is None and points_on:
        text += " The sprint has no capacity yet to weigh it against."
    pod.records.bulk_create("sprints_suggestion", [{
        "id": sug_id, "sprint_id": sprint["id"], "kind": "pull_in", "task_ids": [task["id"]] + [i["task_id"] for i in move],
        "text": text[:1000], "choice": "pull_in", "state": "open",
        "detail": {"tag": tag(task), "number": task.get("number"), "title": task.get("title"), "source": source,
                   "source_id": task.get("source_id"), "source_url": task.get("source_url"), "priority": task.get("priority"),
                   "points": mine, "scope": scope, "capacity": cap, "move_out": [i["task_id"] for i in move]},
    }], upsert=True)
    if ctx.user_id and str(ctx.user_id) == str(s.get("lead_user_id") or ""):
        try:
            pod.functions.run("sprints_needs_you", {})
        except Exception:  # noqa: BLE001 — the lead's own trigger and daily run write it too
            pass
    return SprintsOnTaskResult(events=0, suggested=True, message=text)
