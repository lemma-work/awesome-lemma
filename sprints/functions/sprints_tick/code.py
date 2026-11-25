#input_type_name: SprintsTickInput
#output_type_name: SprintsTickResult
#function_name: sprints_tick

"""The lead's daily run (sprints-daily, 06:00 in the set-up's zone, a schedule
the app makes as the lead), and the risk refresh after every change.

Daily:
1. Opens what is due: Sprint 1 if there is none; starts a planned sprint on its
   first day if nobody pressed Start; opens the next one for planning.
2. Reconciles: a trigger can skip changes when it falls behind
   (LAG_EXCEEDED), so every task in the running sprint is compared with the
   `task` table, and whatever was missed is written as an event via
   reconcile; urgent work from a watched source that came in with no pull-in
   suggestion gets one.
3. On the sprint's last day, prepares the close (sprints_close_prepare): a
   suggestion per unfinished task and the summary's draft.
4. Refreshes what may slip, and writes the lead's "decide" items.

`only: risks` does step 4's risks alone (after each change in the sprint).

What may slip is worked out from the numbers, no model involved:
- a task in its 3rd sprint or later that is not done;
- someone with more here than their capacity for this sprint;
- a task waiting on a person since before today;
- at this pace (done so far ÷ working days gone × working days), what gets
  done, and which tasks not started could move to the next sprint to close the
  gap (a move-out suggestion), saying plainly when moving them is not enough.
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


class SprintsTickInput(BaseModel):
    only: str | None = None


class SprintsTickResult(BaseModel):
    opened: list[str]
    reconciled: int
    risks: int
    message: str


def _first_sprint(pod, s: dict) -> str:
    first, last = sprint_bounds(next_start(today_in(s["timezone"]), s["start_weekday"]), s["length_weeks"])
    pod.records.bulk_create("sprints_sprint", [{"id": sid("sprint", 1), "number": 1, "starts_on": first.isoformat(),
                                                "ends_on": last.isoformat(), "state": "planned"}], upsert=True)
    return "Sprint 1"


def sprints_tick(ctx: FunctionContext, data: SprintsTickInput) -> SprintsTickResult:
    pod = ctx.pod
    s = settings_of(pod)
    if not s.get("setup_done_at"):
        return SprintsTickResult(opened=[], reconciled=0, risks=0, message="Sprints is not set up.")
    today = today_in(s["timezone"])
    opened: list[str] = []
    fixed = 0
    if data.only != "risks":
        sprints = q(pod, "SELECT * FROM sprints_sprint ORDER BY number")
        if not sprints:
            opened.append(_first_sprint(pod, s))
            sprints = q(pod, "SELECT * FROM sprints_sprint ORDER BY number")
        running = next((x for x in sprints if x["state"] in ("running", "closing")), None)
        planned = next((x for x in sprints if x["state"] == "planned"), None)
        if not running and planned and day(planned["starts_on"]) <= today:
            out = as_dict(as_dict(pod.functions.run("sprints_start", {"sprint": int(planned["number"]), "via": "tick"})).get("output_data"))
            if out.get("started"):
                opened.append(f"started Sprint {planned['number']}")
            sprints = q(pod, "SELECT * FROM sprints_sprint ORDER BY number")
            running = next((x for x in sprints if x["state"] in ("running", "closing")), None)
        if running:
            fixed = _reconcile(ctx, s, running)
            if running["state"] == "running" and day(running["ends_on"]) <= today:
                pod.functions.run("sprints_close_prepare", {"sprint": int(running["number"])})
                opened.append(f"prepared the close of Sprint {running['number']}")
    risks = _risks(pod, s, today)
    if data.only != "risks" and ctx.user_id and str(ctx.user_id) == str(s.get("lead_user_id") or ""):
        try:
            pod.functions.run("sprints_needs_you", {})
        except Exception:  # noqa: BLE001
            pass
    bits = opened + ([f"reconciled {fixed}"] if fixed else []) + [f"{risks} thing(s) may slip"]
    return SprintsTickResult(opened=opened, reconciled=fixed, risks=risks, message="; ".join(bits) + ".")


def _reconcile(ctx, s: dict, sprint: dict) -> int:
    pod = ctx.pod
    items = q(pod, "SELECT i.id, i.task_id, i.outcome, i.started_at, i.done_at, t.id AS tid, t.status, t.done_at AS t_done "
                   f"FROM sprints_item i LEFT JOIN task t ON t.id = i.task_id WHERE i.sprint_id = {lit(sprint['id'])} "
                   "AND i.removed_at IS NULL")
    now = now_iso()
    events, updates = [], []
    for i in items:
        base = {"sprint_id": sprint["id"], "task_id": i["task_id"], "at": now, "via": "reconcile", "actor_kind": "unknown"}
        if not i.get("tid"):
            updates.append({"id": i["id"], "removed_at": now, "removed_by": "deleted in Tasks", "outcome": "backlog"})
            events.append(dict(base, id=sid("event", i["id"], "removed", now), kind="removed", detail={"why": "deleted"}))
            continue
        status = i.get("status")
        if status == "done" and i["outcome"] == "open":
            updates.append({"id": i["id"], "outcome": "done", "done_at": i.get("t_done") or now,
                            "started_at": i.get("started_at") or i.get("t_done") or now})
            events.append(dict(base, id=sid("event", i["id"], "done", now), kind="done", detail={"to": "done"}))
        elif status != "done" and i["outcome"] == "done":
            updates.append({"id": i["id"], "outcome": "open", "done_at": None})
            events.append(dict(base, id=sid("event", i["id"], "reopened", now), kind="reopened", detail={"to": status}))
        elif status in ("in_progress", "waiting") and not i.get("started_at"):
            updates.append({"id": i["id"], "started_at": now})
            events.append(dict(base, id=sid("event", i["id"], "started", now), kind="started", detail={"to": status}))
    if updates:
        pod.records.bulk_update("sprints_item", updates)
    if events:
        pod.records.bulk_create("sprints_event", events, upsert=True)
    # Urgent work that came in while a trigger was behind.
    watched = lits([str(x).lower() for x in s["watch_sources"]])
    since = sprint.get("started_at") or now
    missed = q(pod, "SELECT t.id FROM task t WHERE t.priority IN ('high', 'urgent') AND t.status NOT IN ('done', 'canceled') "
                    f"AND t.parent_id IS NULL AND LOWER(t.source) IN ({watched}) AND t.created_at >= {lit(since)} "
                    f"AND NOT EXISTS (SELECT 1 FROM sprints_item i WHERE i.task_id = t.id AND i.sprint_id = {lit(sprint['id'])}) "
                    "AND NOT EXISTS (SELECT 1 FROM sprints_suggestion g WHERE g.kind = 'pull_in' "
                    f"AND g.sprint_id = {lit(sprint['id'])} AND g.task_ids::text LIKE '%' || t.id::text || '%')")
    for m in missed:
        pod.functions.run("sprints_on_task", {"task_id": m["id"], "op": "insert"})
    return len(events) + len(missed)


def _risks(pod, s: dict, today) -> int:
    running = q(pod, "SELECT * FROM sprints_sprint WHERE state IN ('running', 'closing') ORDER BY number LIMIT 1")
    if not running:
        return 0
    sprint = running[0]
    points_on = s["measure"] == "points"
    word = "pts" if points_on else "tasks"
    start, end = day(sprint["starts_on"]), day(sprint["ends_on"])
    days = working_days(start, end)
    gone = len([d for d in days if d < today])
    est = {r["id"]: float(r["points"]) for r in q(pod, "SELECT id, points FROM sprints_estimate")}
    unit = (lambda tid: est.get(tid) or 0.0) if points_on else (lambda tid: 1.0)
    items = q(pod, "SELECT i.id, i.task_id, i.nth, i.outcome, i.in_at_start, t.number, t.title, t.status, t.priority, "
                   "t.updated_at, t.assignee_kind, t.assignee_user_id, t.assignee_name, t.assignee_agent "
                   f"FROM sprints_item i JOIN task t ON t.id = i.task_id WHERE i.sprint_id = {lit(sprint['id'])} "
                   "AND i.removed_at IS NULL")
    history = {}
    if items:
        for h in q(pod, "SELECT i.task_id, s.number FROM sprints_item i JOIN sprints_sprint s ON s.id = i.sprint_id "
                        f"WHERE i.task_id IN ({lits([i['task_id'] for i in items])}) ORDER BY s.number"):
            history.setdefault(h["task_id"], []).append(int(h["number"]))
    last_event = {r["task_id"]: r for r in q(pod, "SELECT task_id, MAX(at) AS at FROM sprints_event "
                                                  f"WHERE sprint_id = {lit(sprint['id'])} GROUP BY task_id")}
    found: list[dict] = []
    tz = s["timezone"]
    for i in items:
        if i["outcome"] == "done" or i.get("status") == "done":
            continue
        nth = int(i.get("nth") or 1)
        if nth >= 3:
            moments = [m for m in (i.get("updated_at"), (last_event.get(i["task_id"]) or {}).get("at")) if m]
            changed = max((local_day(m, tz) for m in moments), default=None)
            since = f", and hasn't changed since {short_day(changed)}" if changed and changed < today else ""
            found.append({"id": sid(sprint["id"], "risk", "nth", i["task_id"]), "kind": "risk", "choice": f"{ordinal(nth)} sprint",
                          "task_ids": [i["task_id"]],
                          "text": f"#{i['number']} has been in Sprints {joined([str(n) for n in history.get(i['task_id'], [])])}{since}."})
        if i.get("status") == "waiting":
            ev = q(pod, f"SELECT at FROM sprints_event WHERE task_id = {lit(i['task_id'])} AND kind IN ('started', 'status') "
                        "ORDER BY at DESC LIMIT 1")
            since = local_day((ev[0]["at"] if ev else None) or i.get("updated_at"), tz)
            if since and since < today:
                found.append({"id": sid(sprint["id"], "risk", "waiting", i["task_id"]), "kind": "risk", "choice": "Waiting",
                              "task_ids": [i["task_id"]], "text": f"#{i['number']} is waiting on a person since {short_day(since)}."})
    cap = as_dict(json_obj(sprint.get("capacity")))
    added_by_person: dict[str, float] = {}
    planned_by_person: dict[str, float] = {}
    for i in items:
        a = assignee_of(i)
        if a["kind"] != "person":
            continue
        planned_by_person[a["key"]] = planned_by_person.get(a["key"], 0.0) + unit(i["task_id"])
        if not i.get("in_at_start"):
            added_by_person[a["key"]] = added_by_person.get(a["key"], 0.0) + unit(i["task_id"])
    for p in cap.get("people") or []:
        key, have, mine = p.get("key"), p.get("cap"), planned_by_person.get(p.get("key"), 0.0)
        if have is None or mine <= float(have) + 1e-9:
            continue
        off = float(p.get("days_off") or 0)
        why = f" (usual {num(p.get('usual'))}, out {num(off)} day{'s' if off != 1 else ''})" if off else \
            f"; their last {len(p.get('history') or [])} sprints averaged {num(p.get('usual'))}"
        late = added_by_person.get(key, 0.0)
        tail = f" {num(late)} of them came in after the start." if late else ""
        found.append({"id": sid(sprint["id"], "risk", "over", key), "kind": "risk", "choice": "Over", "task_ids": [],
                      "text": f"{p.get('name')} has {num(mine)} {word} here against {num(have)} for this sprint{why}.{tail}",
                      "detail": {"person": key, "name": p.get("name"), "planned": mine, "cap": have}})
    scope = sum(unit(i["task_id"]) for i in items)
    done = sum(unit(i["task_id"]) for i in items if i["outcome"] == "done" or i.get("status") == "done")
    if 2 <= gone < len(days) and scope > 0:
        pace = done / gone * len(days)
        if pace + 1e-9 < scope:
            gap = scope - pace
            spare = sorted([i for i in items if i.get("status") == "todo" and i["outcome"] == "open" and unit(i["task_id"]) > 0],
                           key=lambda i: (PRIORITY_ORDER.get(i.get("priority") or "none", 0), -unit(i["task_id"])))
            pick, room = [], 0.0
            for i in spare:
                if room >= gap:
                    break
                pick.append(i)
                room += unit(i["task_id"])
            if pick:
                rest = "leaves the rest on track." if room + 1e-9 >= gap else f"still leaves {num(gap - room)} {word} at risk."
                found.append({"id": sid(sprint["id"], "move_out", *sorted(i["task_id"] for i in pick)), "kind": "move_out",
                              "choice": "Suggestion", "task_ids": [i["task_id"] for i in pick],
                              "text": (f"At this pace {num(pace)} of {num(scope)} {word} get done. Moving "
                                       f"{joined(['#' + str(i['number']) for i in pick])} to Sprint {int(sprint['number']) + 1} "
                                       f"({num(room)} {word}, not started) {rest}"),
                              "detail": {"pace": pace, "scope": scope, "done": done, "gone": gone, "days": len(days)}})
    old = {r["id"]: r for r in q(pod, "SELECT id, state FROM sprints_suggestion WHERE kind IN ('risk', 'move_out') "
                                      f"AND sprint_id = {lit(sprint['id'])}")}
    fresh = [dict({"detail": None}, **f, sprint_id=sprint["id"], state="open") for f in found
             if f["id"] not in old or old[f["id"]].get("state") == "open"]
    if fresh:
        pod.records.bulk_create("sprints_suggestion", fresh, upsert=True)
    stale = [i for i, r in old.items() if r.get("state") == "open" and i not in {f["id"] for f in found}]
    if stale:
        pod.records.bulk_delete("sprints_suggestion", stale)
    return len(found)
