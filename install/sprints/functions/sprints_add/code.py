#input_type_name: SprintsAddInput
#output_type_name: SprintsAddResult
#function_name: sprints_add

"""Put team tasks into a sprint: from the app's plan and run screens, and from
chat ("add #444 to this sprint").

`sprint` is a number, "current" (the running sprint) or "next" (the one being
planned); without it, the running sprint if there is one, else the next.
Tasks are ids or numbers ("#444", "444"). Only team tasks: a person's own
private task has to be shared from Tasks first, and this says so.

Before a sprint starts its tasks are its plan. After the start an added task is
marked added after the start (`in_at_start` false) and the scope graph steps up;
"in at start" is never changed. A task in another sprint that is not closed
moves here. Which sprint this is for the task ("2nd sprint") counts the earlier
sprints it was in and did not finish. `assign` sets who does it, as the plan
screen's draft does. A pull-in suggestion for an added task is marked taken.
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


class SprintsAddInput(BaseModel):
    tasks: list[str]
    sprint: str | int | None = None
    # task id -> {"user_id", "name"} for a person, or {"agent": "pod_default"}
    assign: dict | None = None
    via: str = "app"


class SprintsAddResult(BaseModel):
    sprint_number: int | None
    added: list[str]
    skipped: list[str]
    message: str


def _sprint(pod, s: dict, which) -> dict | None:
    sprints = q(pod, "SELECT * FROM sprints_sprint ORDER BY number")
    running = next((x for x in sprints if x["state"] in ("running", "closing")), None)
    planned = next((x for x in sprints if x["state"] == "planned"), None)
    if which in (None, "", "current", "now"):
        if running or which in (None, ""):
            return running or planned or _open_next(pod, s, sprints)
        return None
    if which in ("next", "plan"):
        return planned or _open_next(pod, s, sprints)
    try:
        n = int(str(which).lstrip("#"))
    except ValueError:
        return None
    return next((x for x in sprints if int(x["number"]) == n), None)


def _open_next(pod, s: dict, sprints: list) -> dict:
    last = sprints[-1] if sprints else None
    if last:
        start = day(last["starts_on"]) + _timedelta(days=7 * s["length_weeks"])
        n = int(last["number"]) + 1
    else:
        start, n = next_start(today_in(s["timezone"]), s["start_weekday"]), 1
    first, end = sprint_bounds(start, s["length_weeks"])
    row = {"id": sid("sprint", n), "number": n, "starts_on": first.isoformat(), "ends_on": end.isoformat(), "state": "planned"}
    pod.records.bulk_create("sprints_sprint", [row], upsert=True)
    return row


def sprints_add(ctx: FunctionContext, data: SprintsAddInput) -> SprintsAddResult:
    pod = ctx.pod
    s = settings_of(pod)
    sprint = _sprint(pod, s, data.sprint)
    if not sprint:
        return SprintsAddResult(sprint_number=None, added=[], skipped=data.tasks, message="No such sprint, or none is running.")
    if sprint["state"] == "closed":
        return SprintsAddResult(sprint_number=sprint["number"], added=[], skipped=data.tasks,
                                message=f"Sprint {sprint['number']} is closed.")
    ids, numbers, skipped = [], [], []
    for t in data.tasks:
        ref = str(t).strip().lstrip("#")
        (numbers if ref.isdigit() else ids).append(ref)
    where = []
    if ids:
        where.append(f"id IN ({lits(ids)})")
    if numbers:
        where.append(f"number IN ({', '.join(numbers)})")
    tasks = q(pod, f"SELECT id, number, title, status, source, source_id FROM task WHERE {' OR '.join(where)}") if where else []
    found = {str(t["id"]) for t in tasks} | {str(t["number"]) for t in tasks}
    missing = [r for r in ids + numbers if r not in found]
    if missing:
        private = q(pod, f"SELECT id FROM personal_task WHERE id IN ({lits([m for m in missing if not m.isdigit()])})") \
            if any(not m.isdigit() for m in missing) else []
        for m in missing:
            skipped.append(m)
        if private:
            return SprintsAddResult(sprint_number=sprint["number"], added=[], skipped=skipped,
                                    message="That task is on someone's private list. Share it with the team from Tasks first.")
    if not tasks:
        return SprintsAddResult(sprint_number=sprint["number"], added=[], skipped=skipped, message="No team task found.")

    est = {r["id"]: float(r["points"]) for r in q(pod, f"SELECT id, points FROM sprints_estimate WHERE id IN ({lits([t['id'] for t in tasks])})")}
    history = q(pod, "SELECT i.id, i.task_id, i.sprint_id, i.outcome, i.removed_at, s.number, s.state FROM sprints_item i "
                     f"JOIN sprints_sprint s ON s.id = i.sprint_id WHERE i.task_id IN ({lits([t['id'] for t in tasks])})")
    now = now_iso()
    running = sprint["state"] in ("running", "closing")
    who = ctx.user_name or (ctx.user_email or "").split("@")[0] or None
    actor = {"actor_kind": "person" if ctx.user_id else "lemma", "actor_name": who,
             "actor_user_id": str(ctx.user_id) if ctx.user_id else None}
    via = data.via if data.via in ("app", "chat", "close", "start") else "app"
    items, events, moved_out, added = [], [], [], []
    for t in tasks:
        mine = [h for h in history if h["task_id"] == t["id"]]
        here = next((h for h in mine if h["sprint_id"] == sprint["id"]), None)
        if here and not here.get("removed_at") and here.get("outcome") == "open":
            skipped.append(tag(t))
            continue
        # Out of any other sprint that is not closed.
        for h in mine:
            if h["sprint_id"] != sprint["id"] and h["state"] != "closed" and not h.get("removed_at") and h["outcome"] == "open":
                moved_out.append(h)
        earlier = [h for h in mine if int(h["number"]) < int(sprint["number"]) and h["outcome"] != "done"]
        last = max(earlier, key=lambda h: int(h["number"])) if earlier else None
        row = {"id": sid(sprint["id"], t["id"]), "sprint_id": sprint["id"], "task_id": t["id"],
               "in_at_start": False, "added_at": now, "added_by": who, "removed_at": None, "removed_by": None,
               "outcome": "done" if t.get("status") == "done" else "open", "nth": len({h["sprint_id"] for h in earlier}) + 1,
               "carried_from": last["sprint_id"] if last and last["outcome"] in ("carried", "split") else None,
               "points_at_add": est.get(t["id"]) if s["measure"] == "points" else 1.0}
        items.append(row)
        added.append(tag(t))
        if running:
            events.append({"id": sid("event", row["id"], "added", now), "sprint_id": sprint["id"], "task_id": t["id"],
                           "kind": "added", "at": now, "via": via, **actor,
                           "detail": {"points": row["points_at_add"], "source": t.get("source"), "source_id": t.get("source_id")}})
    for h in moved_out:
        h_sprint = q(pod, f"SELECT state FROM sprints_sprint WHERE id = {lit(h['sprint_id'])}")
        if h_sprint and h_sprint[0]["state"] == "planned":
            pod.records.bulk_delete("sprints_item", [h["id"]])
        else:
            pod.records.update("sprints_item", h["id"], {"removed_at": now, "removed_by": who, "outcome": "backlog"})
            events.append({"id": sid("event", h["id"], "removed", now), "sprint_id": h["sprint_id"], "task_id": h["task_id"],
                           "kind": "removed", "at": now, "via": via, **actor, "detail": {"to": f"Sprint {sprint['number']}"}})
    if items:
        pod.records.bulk_create("sprints_item", items, upsert=True)
    if events:
        pod.records.bulk_create("sprints_event", events, upsert=True)
    for task_id, who_does in (data.assign or {}).items():
        target = next((t for t in tasks if str(t["id"]) == str(task_id) or str(t["number"]) == str(task_id).lstrip("#")), None)
        if not target or not isinstance(who_does, dict):
            continue
        if who_does.get("agent"):
            pod.records.update("task", target["id"], {"assignee_kind": "agent", "assignee_agent": who_does["agent"],
                                                      "assignee_user_id": None, "assignee_name": None})
        elif who_does.get("name") or who_does.get("user_id"):
            pod.records.update("task", target["id"], {"assignee_kind": "person", "assignee_user_id": who_does.get("user_id"),
                                                      "assignee_name": who_does.get("name"), "assignee_agent": None})
    pulled = [r for r in q(pod, "SELECT id, task_ids FROM sprints_suggestion WHERE kind = 'pull_in' AND state = 'open'")
              if (json_list(r.get("task_ids")) or [None])[0] in {t["id"] for t in tasks}]
    for r in pulled:
        pod.records.update("sprints_suggestion", r["id"], {"state": "taken", "decided_by": who, "decided_at": now})
    if pulled:
        try:
            pod.functions.run("sprints_needs_you", {})
        except Exception:  # noqa: BLE001
            pass
    if running and items:
        try:
            pod.functions.run("sprints_tick", {"only": "risks"})
        except Exception:  # noqa: BLE001
            pass
    when = "after the start" if running else "to the plan"
    message = f"Added {joined(added)} to Sprint {sprint['number']} {when}." if added else "Nothing new to add."
    return SprintsAddResult(sprint_number=int(sprint["number"]), added=added, skipped=skipped, message=message)
