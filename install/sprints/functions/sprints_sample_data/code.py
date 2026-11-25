#input_type_name: SprintsSampleDataInput
#output_type_name: SprintsSampleDataResult
#function_name: sprints_sample_data

"""A made-up team's sprints, so Sprints can be seen working before a real one
has run: "Look around with a sample sprint" at set-up.

`load` makes, around today:

- Sprints 42 to 46, closed, two weeks each: the work each person finished
  (which is where everyone's usual comes from), and the tasks that slipped;
- Sprint 47, running since Monday last week: 12 tasks in at the start, three
  that came in after it (one from Incidents, two from Triage), one taken out,
  some done, one in its 3rd sprint, one waiting on a person;
- Sprint 48, planned, starting next Monday, with a few days off;
- a backlog, and an urgent task from Incidents that came in this morning, so
  the lead gets "pull it into Sprint 47?".

The people are made up (Ravi Menon, Asha Iyer, Tomás Ruiz); the work of the
person who loads it is theirs. Tasks are written as an import, so Tasks'
"could an agent do this?" call and Sprints' own triggers leave them alone;
the pull-in, the risks and every closed sprint's numbers and summary are then
made by Sprints' own functions, the same way as for real work. Every row made
is marked in `sprints_sample_row`.

`clear` removes only what the sample made, with anything added to the sample's
sprints since (events, suggestions, a task split at close), and Tasks' own
timeline rows on the sample's tasks; then resolves the lead's items and opens
Sprint 1 if no sprint is left.
"""

from __future__ import annotations

import uuid

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

# sprints:numbers
# A sprint's numbers and its summary's sentences, shared word for word by
# sprints_close_prepare (where it is edited), sprints_close and the sample:
# bin/common.py copies it.
CHOICES = ["carry", "split", "backlog", "drop"]
BANNED = ("great", "amazing", "awesome", "excellent", "fantastic", "crushed", "nailed", "stellar", "impressive", "solid work",
          "well done", "kudos", "congrat")


def _load(pod, s: dict, sprint: dict) -> dict:
    """Everything the numbers come from."""
    items = q(pod, "SELECT i.*, t.number, t.title, t.status, t.priority, t.source, t.source_id, t.assignee_kind, "
                   "t.assignee_user_id, t.assignee_name, t.assignee_agent, t.updated_at AS t_updated, t.id AS tid "
                   f"FROM sprints_item i LEFT JOIN task t ON t.id = i.task_id WHERE i.sprint_id = {lit(sprint['id'])} "
                   "ORDER BY t.number")
    ids = [i["task_id"] for i in items]
    est = {r["id"]: float(r["points"]) for r in q(pod, f"SELECT id, points FROM sprints_estimate WHERE id IN ({lits(ids)})")} if ids else {}
    history: dict[str, list] = {}
    if ids:
        for h in q(pod, "SELECT i.task_id, s.number FROM sprints_item i JOIN sprints_sprint s ON s.id = i.sprint_id "
                        f"WHERE i.task_id IN ({lits(ids)}) ORDER BY s.number"):
            history.setdefault(h["task_id"], []).append(int(h["number"]))
    return {"items": items, "est": est, "history": history}


def stats_of(s: dict, sprint: dict, data: dict, choices: dict) -> dict:
    points_on = s["measure"] == "points"
    est = data["est"]

    def pts(i):
        if not points_on:
            return 1.0
        if i.get("closed_points") is not None and sprint.get("state") == "closed":
            return float(i["closed_points"])
        return est.get(i["task_id"]) or 0.0

    def block(group):
        return {"points": sum(pts(i) for i in group), "tasks": len(group), "tags": [f"#{i['number']}" for i in group]}

    items = data["items"]
    present = [i for i in items if not i.get("removed_at")]
    planned = [i for i in items if i.get("in_at_start")]
    added = [i for i in items if not i.get("in_at_start")]
    removed = [i for i in items if i.get("removed_at")]
    done = [i for i in present if i.get("outcome") == "done" or i.get("status") == "done"]
    open_ = [i for i in present if i not in done]
    by_choice = {c: [i for i in open_ if (choices.get(i["task_id"]) or {}).get("choice") == c] for c in CHOICES}
    planned_points = sum(float(i.get("points_at_add") or 0) if points_on else 1.0 for i in planned)
    by_person: dict[str, dict] = {}
    agents: dict[str, dict] = {}
    for i in present:
        a = assignee_of(i)
        if a["kind"] == "person":
            p = by_person.setdefault(a["key"], {"name": a["name"], "user_id": a.get("user_id"), "points": 0.0, "tasks": 0,
                                                "had_points": 0.0, "had_tasks": 0, "added_points": 0.0})
            p["had_points"] += pts(i)
            p["had_tasks"] += 1
            if not i.get("in_at_start"):
                p["added_points"] += pts(i)
            if i in done:
                p["points"] += pts(i)
                p["tasks"] += 1
        elif a["kind"] == "agent":
            g = agents.setdefault(a["agent"], {"tasks": 0, "done": 0, "tags": [], "done_tags": []})
            g["tasks"] += 1
            g["tags"].append(f"#{i['number']}")
            if i in done:
                g["done"] += 1
                g["done_tags"].append(f"#{i['number']}")
    reestimated = sum(pts(i) - float(i.get("points_at_add") or 0) for i in planned if not i.get("removed_at")) if points_on else 0.0
    return {
        "measure": s["measure"],
        "planned": {"points": planned_points, "tasks": len(planned), "tags": [f"#{i['number']}" for i in planned]},
        "added": block(added), "added_done": block([i for i in added if i in done]),
        "removed": block(removed), "done": block(done), "done_of_plan": block([i for i in done if i.get("in_at_start")]),
        "not_done": block(open_), "scope": block(present),
        "carried": block(by_choice["carry"]), "split": block(by_choice["split"]),
        "backlog": block(by_choice["backlog"]), "dropped": block(by_choice["drop"]),
        "undecided": block([i for i in open_ if not (choices.get(i["task_id"]) or {}).get("choice")]),
        "slipped_twice": [f"#{i['number']}" for i in open_ if int(i.get("nth") or 1) >= 2],
        "not_estimated": [f"#{i['number']}" for i in present if points_on and i["task_id"] not in est],
        "reestimated": reestimated,
        "by_person": by_person, "agents": agents,
    }


def _sources(group: list) -> str:
    by: dict[str, list] = {}
    for i in group:
        src = (i.get("source") or "tasks").lower()
        by.setdefault(src, []).append(i)
    parts = []
    for src, grp in by.items():
        tags = joined([f"#{i['number']}" for i in grp])
        if src in ("tasks", "chat", "sprints"):
            parts.append(tags)
            continue
        refs = [str(i["source_id"]) for i in grp if i.get("source_id") and len(str(i["source_id"])) <= 24]
        ref = f" ({joined(refs)})" if refs and len(refs) == len(grp) else ""
        parts.append(f"{tags} from {SOURCE_NAMES.get(src, src)}{ref}")
    return "; ".join(parts)


def statements(s: dict, sprint: dict, data: dict, st: dict, choices: dict, next_info: dict) -> tuple[list, list]:
    """(always, optional): lists of (key, text)."""
    points_on = s["measure"] == "points"
    word = "points" if points_on else "tasks"
    n = int(sprint["number"])
    items = {i["task_id"]: i for i in data["items"]}
    always, optional = [], []
    p, dp = st["planned"], st["done_of_plan"]
    plan_n = num(p["points"]) if points_on else str(p["tasks"])
    done_n = num(dp["points"]) if points_on else str(dp["tasks"])
    always.append(("plan", f"We planned {plan_n} {word} and finished {done_n} of them."))
    added_list = [i for i in data["items"] if not i.get("in_at_start")]
    if added_list:
        a, ad = st["added"], st["added_done"]
        a_n = num(a["points"]) if points_on else str(a["tasks"])
        ad_n = num(ad["points"]) if points_on else str(ad["tasks"])
        always.append(("added", f"{a_n} {word} came in after we started: {_sources(added_list)}. {ad_n} of those got done."))
    removed = [i for i in data["items"] if i.get("removed_at")]
    if removed:
        tags = joined([f"#{i['number']}" for i in removed])
        always.append(("removed", f"{tags} {'was' if len(removed) == 1 else 'were'} taken out during the sprint."))
    if st["not_estimated"]:
        k = len(st["not_estimated"])
        optional.append(("unestimated", f"{k} task{'s' if k != 1 else ''} had no estimate and count as 0 points: "
                                        f"{joined(st['not_estimated'])}."))
    if points_on and abs(st["reestimated"]) >= 0.1:
        sign = "+" if st["reestimated"] > 0 else "−"
        optional.append(("reestimated", f"Estimates on planned work changed by {sign}{num(abs(st['reestimated']))} points after the start."))
    for tid, i in items.items():
        if i.get("removed_at") or i.get("outcome") == "done" or i.get("status") == "done":
            continue
        nth = int(i.get("nth") or 1)
        c = choices.get(tid) or {}
        choice = c.get("choice")
        carry = f"{num(c['carry_points'])} points carry" if c.get("carry_points") is not None else "part of it carries"
        rest = f"is {c['rest_tag']} in the backlog" if c.get("rest_tag") else "goes to the backlog"
        if nth >= 2:
            what = {"carry": f" It carries into Sprint {n + 1}.",
                    "split": f" It was split: {carry} into Sprint {n + 1}, the rest {rest}.",
                    "backlog": " It goes back to the backlog.", "drop": " It was dropped."}.get(choice, "")
            optional.append((f"slip:{tid}", f"#{i['number']}, {i.get('title')}, was in its {ordinal(nth)} sprint.{what}"))
        elif choice == "split":
            optional.append((f"split:{tid}", f"#{i['number']} was split: {carry} into Sprint {n + 1}, the rest {rest}."))
    if st["carried"]["tasks"] or st["split"]["tasks"]:
        group = st["carried"]["tags"] + st["split"]["tags"]
        size = f", {num(st['carried']['points'] + st['split']['points'])} pts before any split" if points_on and st["split"]["tasks"] \
            else (f", {num(st['carried']['points'])} pts" if points_on else "")
        optional.append(("carried", f"Carried into {n + 1}: {joined(group)}{size}."))
    if st["backlog"]["tasks"]:
        k = st["backlog"]["tasks"]
        optional.append(("backlog", f"{joined(st['backlog']['tags'])} {'goes' if k == 1 else 'go'} back to the backlog."))
    if st["dropped"]["tasks"]:
        k = st["dropped"]["tasks"]
        optional.append(("dropped", f"{joined(st['dropped']['tags'])} {'was' if k == 1 else 'were'} dropped."))
    usual = {p.get("key"): p for p in (json_obj(sprint.get("capacity")).get("people") or [])}
    for key, p in st["by_person"].items():
        u = usual.get(key) or {}
        mine = p["had_points"] if points_on else p["had_tasks"]
        if u.get("usual") is not None and mine > float(u["usual"]) + 1e-9:
            extra = f", {num(p['added_points'])} of them from work added after the start" if points_on and p["added_points"] else ""
            optional.append((f"load:{key}", f"{p['name']} ended with {num(mine)} {word} against a usual of {num(u['usual'])}{extra}."))
    for agent, g in st["agents"].items():
        who = "The Lemma's assistant" if agent == ASSISTANT else agent
        done_tags = f": {joined(g['done_tags'])}" if g["done_tags"] else ""
        optional.append((f"agent:{agent}", f"{who} finished {g['done']} of its {g['tasks']} task{'s' if g['tasks'] != 1 else ''}{done_tags}."))
    if next_info.get("number"):
        cap = next_info.get("capacity")
        cap_text = f" with {num(cap)} {word} of capacity" if cap is not None else ""
        line = f"Sprint {next_info['number']} starts {next_info['starts']}{cap_text}."
        for who, days in next_info.get("away") or []:
            line += f" {who} is out {days}."
        optional.append(("next", line))
    return always, optional


SECTIONS = [("What slipped.", ("slip:",)), ("", ("carried", "split:", "backlog", "dropped")),
            ("Load.", ("load:", "agent:")), ("Next.", ("next",))]


def compose(s: dict, sprint: dict, st: dict, always: list, optional: list, picked: list) -> str:
    points_on = s["measure"] == "points"
    unit = (lambda b: num(b["points"])) if points_on else (lambda b: str(b["tasks"]))
    start, end = day(sprint["starts_on"]), day(sprint["ends_on"])
    lines = [f"# Sprint {sprint['number']} · {month_day(start)} – {month_day(end)}", "",
             f"Planned {unit(st['planned'])} · Added {unit(st['added'])} · Taken out {unit(st['removed'])} · "
             f"Done {unit(st['done'])} · Not done {unit(st['not_done'])}" + ("" if points_on else " (tasks)"), ""]
    first = [t for k, t in always] + [t for k, t in optional if k in picked and k in ("unestimated", "reestimated")]
    lines += [" ".join(first), ""]
    chosen = [(k, t) for k, t in optional if k in picked]
    for head, prefixes in SECTIONS:
        group = [t for k, t in chosen if any(k == p or (p.endswith(":") and k.startswith(p)) for p in prefixes)]
        if not group:
            continue
        if not head:
            carried = [t for k, t in chosen if k == "carried"]
            rest = [t for t in group if t not in carried]
            if carried:
                text = carried[0]
                lead, _, tail = text.partition(":")
                lines += [f"**{lead}:**{tail}" + (" " + " ".join(rest) if rest else ""), ""]
            else:
                lines += ["**Not carried.** " + " ".join(rest), ""]
            continue
        lines += [f"**{head}** " + " ".join(group), ""]
    text = "\n".join(lines).strip() + "\n"
    low = text.lower()
    assert not any(word in low for word in BANNED), "a praise word got into the summary"
    return text


def _next_info(pod, s: dict, sprint: dict, capacity: float | None) -> dict:
    nxt = q(pod, f"SELECT id, number, starts_on, ends_on FROM sprints_sprint WHERE number = {int(sprint['number']) + 1}")
    if nxt:
        start, end = day(nxt[0]["starts_on"]), day(nxt[0]["ends_on"])
    else:
        start, end = sprint_bounds(day(sprint["starts_on"]) + _timedelta(days=7 * s["length_weeks"]), s["length_weeks"])
    away: dict[str, list] = {}
    for a in q(pod, f"SELECT name, day FROM sprints_away WHERE day >= {lit(start.isoformat())} AND day <= {lit(end.isoformat())} ORDER BY day"):
        on = day(a["day"])
        if on and on.weekday() < 5:
            away.setdefault(a["name"], []).append(on)
    said = []
    for who, days in away.items():
        runs, cur = [], [days[0]]
        for d in days[1:]:
            if (d - cur[-1]).days == 1 or (d - cur[-1]).days == 3 and cur[-1].weekday() == 4:
                cur.append(d)
            else:
                runs.append(cur)
                cur = [d]
        runs.append(cur)
        text = ", ".join((f"{month_day(r[0])}–{r[-1].day}" if r[0].month == r[-1].month else f"{month_day(r[0])}–{month_day(r[-1])}")
                         if len(r) > 1 else f"on {month_day(r[0])}" for r in runs)
        said.append((who, text))
    weekday = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][start.weekday()]
    return {"number": int(sprint["number"]) + 1, "starts": f"{weekday} {month_day(start)}", "capacity": capacity, "away": said}


def final_numbers(pod, s: dict, sprint: dict, choices: dict, next_capacity) -> tuple[dict, str]:
    """A closed sprint's stats and summary: the statements picked when it was
    drafted, worked out again with the final numbers (and any statement that
    only exists now, such as a split made at the close)."""
    loaded = _load(pod, s, sprint)
    st = stats_of(s, sprint, loaded, choices)
    for key, p in st["by_person"].items():
        p["key"] = key
    always, optional = statements(s, sprint, loaded, st, choices, _next_info(pod, s, sprint, next_capacity))
    draft = json_obj(sprint.get("summary_draft"))
    picked = list(draft.get("picked") or []) + [k for k, _ in optional if k not in (draft.get("keys") or [])]
    return st, compose(s, sprint, st, always, optional, picked)
# end sprints:numbers

SAMPLE_NS = uuid.UUID("8d4e2a71-3b6c-4f19-a2d8-6c1e9b7f3a52")
PEOPLE = {"ravi": "Ravi Menon", "asha": "Asha Iyer", "tomas": "Tomás Ruiz"}

# What each person finished in the closed sprints, in points (their usual is
# the mean of the last three: 45, 46 and the one before).
DONE = {
    42: {"me": 8, "ravi": 8, "asha": 6, "tomas": 6},
    43: {"me": 9, "ravi": 8, "asha": 7, "tomas": 7},
    44: {"me": 9, "ravi": 8, "asha": 7, "tomas": 6},
    45: {"me": 10, "ravi": 7, "asha": 8, "tomas": 7},
    46: {"me": 8, "ravi": 9, "asha": 6, "tomas": 8},
}
SPLITS = {6: [3, 2, 1], 7: [5, 2], 8: [5, 3], 9: [5, 3, 1], 10: [5, 3, 2]}
POOL = {
    "me": ["Session timeout setting for admins", "Invite flow: resend an expired invite", "Two-factor reminder banner",
           "Workspace rename keeps old links working", "Audit log CSV download", "Search members by email domain",
           "Billing page: next invoice preview", "Faster first load of the dashboard", "Trial end email",
           "Owner transfer flow", "Remember the last workspace on sign-in", "Admin: list of active sessions",
           "Explain plan limits on the upgrade page", "Sort projects by last activity", "Copy edits on settings pages"],
    "ravi": ["Move file uploads to signed URLs", "Rate-limit the public API by key", "Queue retries for failed exports",
             "Idempotency keys on the payments API", "Split the billing worker", "Webhook signing secret rotation",
             "Postgres connection pool limits", "Drop the legacy events table", "Backfill invoice numbers",
             "Alert on queue depth", "Dead-letter queue for webhooks", "Shorter timeouts on the PDF service"],
    "asha": ["Usage page: monthly totals", "Fix the date picker in Safari", "Keyboard focus in the command menu",
             "Empty state for projects", "Dark mode for the settings pages", "Responsive tables on the usage page",
             "Inline errors on the sign-up form", "Avatar upload crops faces", "Toast stacking on small screens",
             "Loading skeletons for reports", "Accessible names on icon buttons", "Retry button on failed uploads"],
    "tomas": ["Error page for a deleted workspace", "Parse Excel dates in CSV import", "Timezone in scheduled reports",
              "Duplicate rows in the members export", "Cap import size with a clear error", "Unicode names in PDFs",
              "Fix pagination on the API keys page", "Retry invoice emails on bounce", "Trim spaces in imported emails",
              "Handle a 413 on large uploads", "Sort order of exported columns", "Stale cache after a plan change"],
}
AGENT_DONE = {42: ["Write the 2.10 changelog"], 43: ["Write the 2.11 changelog"],
              44: ["Write the 2.12 changelog", "Summarise last month's support tags"], 45: ["Write the 2.13 changelog"],
              46: ["Draft the API rate-limit docs", "Write the 2.14 changelog"]}
# Tasks that slipped in closed sprints: key, sprint, title, points, who, outcome there, source.
SLIPPED = [
    ("archive", 42, "Archive webhooks nobody called in 90 days", 3, "asha", "backlog", "tasks"),
    ("retry-mail", 43, "Retry policy for outbound email", 2, "tomas", "backlog", "tasks"),
    ("seats", 44, "Show seat usage on the billing page", 2, "ravi", "dropped", "tasks"),
    ("bulk-audit", 45, "Bulk export for audit events", 3, "asha", "backlog", "tasks"),
]

# Sprint 47 and on. key, demo number, title, points, who, status, priority, source, source id,
# where (plan47, added47, plan48, backlog, came_in), day it came in / was added (days after Sprint 47's
# first day, with HH:MM), day done, nth in 47 or 48.
CURRENT = [
    ("export", 412, "Stream the report export instead of building it in memory", 5, "me", "in_progress", "high", "tasks", None, "plan47", None, None, 3),
    ("webhooks", 420, "Billing webhooks on the shared queue", 5, "ravi", "waiting", "high", "tasks", None, "plan47", None, None, 1),
    ("okta", 405, "Sign in with Okta", 5, "asha", "in_progress", "high", "triage", "TRI-88", "plan47", None, None, 2),
    ("invoice-sync", 398, "Retry invoice sync on a 502", 2, "tomas", "done", "medium", "tasks", None, "plan47", None, "1 15:20", 1),
    ("migration-notes", 417, "Write the migration notes for workspace export", 1, "agent", "done", "low", "tasks", None, "plan47", None, "2 11:05", 1),
    ("audit-empty", 423, "Empty state for the audit log", 2, None, "todo", "low", "tasks", None, "plan47", None, None, 1),
    ("slugs", 409, "Rename workspace slugs", 2, "me", "todo", "low", "tasks", None, "plan47", "7 09:12", None, 1),
    ("role-audit", 414, "Record who changed a member's role in the audit log", 3, "tomas", "done", "medium", "tasks", None, "plan47", None, "3 16:40", 1),
    ("inbox-copy", 426, "Copy for the empty inbox", 1, "asha", "todo", "low", "tasks", None, "plan47", None, None, 2),
    ("banner", 418, "Remove the old billing banner", 1, "me", "done", "low", "tasks", None, "plan47", None, "2 14:30", 1),
    ("limit-meter", 421, "Show the plan limit on the usage page", 2, "ravi", "done", "medium", "tasks", None, "plan47", None, "4 12:10", 1),
    ("members-pages", 415, "Paginate the members list", 2, "asha", "done", "medium", "tasks", None, "plan47", None, "7 17:45", 1),
    ("fallback", 431, "Fallback plan for teams created before March", 3, "ravi", "in_progress", "urgent", "incidents", "INC-14", "added47", "1 10:40", None, 1),
    ("bom", 436, "CSV import drops rows that start with a BOM", 3, "tomas", "todo", "high", "triage", "TRI-97", "added47", "3 15:05", None, 1),
    ("chart-dark", 437, "Chart labels unreadable in dark mode", 2, "agent", "done", "high", "triage", "TRI-98", "added47", "3 15:05", "7 11:30", 1),
    ("saml", 402, "SAML for single sign-on", 8, "ravi", "todo", "high", "tasks", None, "plan48", None, None, 1),
    ("audit-filters", 440, "Filters on the audit log", 5, "me", "todo", "medium", "tasks", None, "plan48", None, None, 1),
    ("org-scroll", 445, "Org switcher loses its scroll position", 1, "asha", "todo", "low", "triage", "TRI-101", "plan48", "5 10:00", None, 1),
    ("flaky", 446, "Flaky test in the export spec", 2, "asha", "todo", "medium", "pr_review", "PR-1219", "plan48", "7 16:00", None, 1),
    ("changelog", 441, "Draft the changelog for 2.15", 1, "agent", "todo", "low", "tasks", None, "plan48", None, None, 1),
    ("webhook-docs", 443, "Update the webhook docs for the new queue", 1, "agent", "todo", "low", "tasks", None, "plan48", None, None, 1),
    ("charge-twice", 444, "Webhook retries charge twice on a timeout", 3, None, "todo", "urgent", "incidents", "INC-16", "came_in", "8 09:20", None, 1),
    ("invite-typo", 449, "Typo in the invite email", 1, None, "todo", "low", "triage", "TRI-104", "came_in", "8 10:05", None, 1),
    ("retention", 447, "Retention setting for audit events", 3, None, "todo", "medium", "tasks", None, "backlog", None, None, 1),
    ("big-search", 448, "Faster search on large workspaces", 5, None, "todo", "medium", "tasks", None, "backlog", None, None, 1),
    ("dark-email", 388, "Dark mode for emails", None, None, "todo", "low", "tasks", None, "backlog", None, None, 1),
]
# Days off: who, days after Sprint 47's first day.
AWAY = [("asha", 10), ("asha", 11), ("asha", 17), ("asha", 18), ("tomas", 25)]


class SprintsSampleDataInput(BaseModel):
    mode: str = "load"
    timezone: str | None = None


class SprintsSampleDataResult(BaseModel):
    mode: str
    tasks: int
    sprints: int
    removed: int
    message: str


def build(me: str | None, my_name: str, today, tz: str, numbers: bool = False) -> dict:
    """Every row of the sample, by table, in the order to write them. Pure: the
    demo's fixtures are made from it too (`numbers` gives tasks the demo's
    numbers; in a Lemma the table numbers them)."""
    d0 = today - _timedelta(days=today.weekday()) - _timedelta(days=7)

    def key_id(key: str) -> str:
        return str(uuid.uuid5(SAMPLE_NS, f"{me or 'demo'}:{key}"))

    def moment(offset: str | None, base=None) -> str | None:
        if offset is None:
            return None
        days, _, hm = str(offset).partition(" ")
        h, _, m = (hm or "09:00").partition(":")
        on = (base or d0) + _timedelta(days=int(days))
        return _datetime.combine(on, _time(int(h), int(m or 0)), zone(tz)).astimezone(_tz.utc).isoformat()

    def person(who):
        if who == "me":
            return {"assignee_kind": "person", "assignee_user_id": me, "assignee_name": my_name, "assignee_agent": None}
        if who == "agent":
            return {"assignee_kind": "agent", "assignee_user_id": None, "assignee_name": None, "assignee_agent": ASSISTANT}
        if who in PEOPLE:
            return {"assignee_kind": "person", "assignee_user_id": None, "assignee_name": PEOPLE[who], "assignee_agent": None}
        return {"assignee_kind": "none", "assignee_user_id": None, "assignee_name": None, "assignee_agent": None}

    out = {t: [] for t in ("task", "sprints_sprint", "sprints_item", "sprints_event", "sprints_estimate", "sprints_away")}
    number = [300]

    def task(key, title, pts, who, status, priority="medium", source="tasks", source_id=None, done_at=None, demo=None):
        row = {"id": key_id(key), "title": title, "status": status, "priority": priority, "labels": [], "source": source,
               "source_id": source_id, "owner_user_id": me, "owner_name": my_name, "done_at": done_at, **person(who)}
        if numbers:
            number[0] += 1
            row["number"] = demo or number[0]
        out["task"].append(row)
        if pts is not None:
            out["sprints_estimate"].append({"id": row["id"], "points": float(pts), "by": "sample", "at": moment("0 09:00")})
        return row

    def sprint_row(n: int, state: str) -> dict:
        start, end = sprint_bounds(d0 + _timedelta(days=14 * (n - 47)), 2)
        row = {"id": sid("sprint", n), "number": n, "starts_on": start.isoformat(), "ends_on": end.isoformat(), "state": state,
               "started_at": moment("0 09:30", start) if state != "planned" else None,
               "closed_at": moment("4 17:30", end - _timedelta(days=4)) if state == "closed" else None, "sample": True,
               "summary_draft": {"picked": [], "keys": [], "how": "the sample: every statement"} if state == "closed" else None}
        out["sprints_sprint"].append(row)
        return row

    def item(sprint, t, pts, *, in_at_start=True, added=None, outcome="open", nth=1, carried_from=None, done=None,
             started=None, removed=None, who=None):
        row = {"id": sid(sprint["id"], t["id"]), "sprint_id": sprint["id"], "task_id": t["id"], "in_at_start": in_at_start,
               "added_at": added or sprint["started_at"] or moment("0 09:00"), "added_by": my_name if in_at_start else (who or my_name),
               "removed_at": removed, "removed_by": my_name if removed else None, "outcome": outcome, "nth": nth,
               "carried_from": carried_from, "points_at_add": float(pts) if pts is not None else None,
               "started_at": started, "done_at": done}
        out["sprints_item"].append(row)
        return row

    def event(sprint, t, kind, at, detail=None, actor=None):
        out["sprints_event"].append({"id": sid("event", sprint["id"], t["id"], kind, at), "sprint_id": sprint["id"],
                                     "task_id": t["id"], "kind": kind, "at": at, "via": "app",
                                     "actor_kind": "person" if actor else "unknown", "actor_name": actor, "detail": detail or {}})

    # Closed sprints.
    pools = {who: list(titles) for who, titles in POOL.items()}
    carried_tasks = {}
    for n in range(42, 47):
        sp = sprint_row(n, "closed")
        start = day(sp["starts_on"])
        for who, total in DONE[n].items():
            for k, pts in enumerate(SPLITS[total]):
                title = pools[who].pop(0)
                done_at = moment(f"{[1, 3, 8][k]} 15:00", start)
                t = task(f"h{n}-{who}-{k}", title, pts, who, "done", "medium", done_at=done_at)
                item(sp, t, pts, outcome="done", done=done_at, started=moment(f"{[0, 2, 7][k]} 10:00", start))
        for k, title in enumerate(AGENT_DONE[n]):
            done_at = moment(f"{3 + k} 11:00", start)
            t = task(f"h{n}-agent-{k}", title, 1, "agent", "done", "low", done_at=done_at)
            item(sp, t, 1, outcome="done", done=done_at, started=moment(f"{2 + k} 11:00", start))
        for key, sn, title, pts, who, outcome, source in SLIPPED:
            if sn == n:
                t = task(key, title, pts, who, "canceled" if outcome == "dropped" else "todo", "low", source)
                item(sp, t, pts, outcome=outcome)
        if n == 45:
            ex = task("export", "Stream the report export instead of building it in memory", 5, "me", "in_progress", "high", demo=412)
            carried_tasks["export"] = ex
            item(sp, ex, 5, outcome="carried", started=moment("6 10:00", start))
        if n == 46:
            ex = carried_tasks["export"]
            item(sp, ex, 5, outcome="carried", nth=2, carried_from=sid("sprint", 45), started=moment("0 10:00", start))
            okta = task("okta", "Sign in with Okta", 5, "asha", "in_progress", "high", "triage", "TRI-88", demo=405)
            carried_tasks["okta"] = okta
            item(sp, okta, 5, outcome="carried", started=moment("5 10:00", start))
            copy = task("inbox-copy", "Copy for the empty inbox", 1, "asha", "todo", "low", demo=426)
            carried_tasks["inbox-copy"] = copy
            item(sp, copy, 1, outcome="carried")

    # The running sprint and the next.
    s47, s48 = sprint_row(47, "running"), sprint_row(48, "planned")
    for key, demo, title, pts, who, status, priority, source, source_id, where, came, done, nth in CURRENT:
        done_at = moment(done) if done else None
        t = carried_tasks.get(key) or task(key, title, pts, who, status, priority, source, source_id, done_at, demo)
        if key in carried_tasks:
            t.update({"status": status, "done_at": done_at})
        if where == "plan47":
            removed = moment(came) if key == "slugs" else None
            started = moment("1 10:00") if status in ("in_progress", "waiting", "done") else None
            item(s47, t, pts, outcome="done" if status == "done" else ("backlog" if removed else "open"), nth=nth,
                 carried_from=sid("sprint", 46) if nth >= 2 else None, done=done_at, started=started, removed=removed)
            if removed:
                event(s47, t, "removed", removed, {"points": pts, "to": "backlog"}, my_name)
        elif where == "added47":
            at = moment(came)
            adder = {"fallback": PEOPLE["ravi"], "bom": my_name, "chart-dark": my_name}[key]
            item(s47, t, pts, in_at_start=False, added=at, outcome="done" if status == "done" else "open", done=done_at,
                 started=moment(came) if status != "todo" else None, who=adder)
            event(s47, t, "added", at, {"points": pts, "source": source, "source_id": source_id}, adder)
        elif where == "plan48":
            item(s48, t, pts, in_at_start=False, added=moment("7 16:30"), nth=nth)
        if done_at and where in ("plan47", "added47"):
            event(s47, t, "done", done_at, {"from": "in_progress", "to": "done"})
        if status == "waiting" and where == "plan47":
            event(s47, t, "status", moment("4 16:00"), {"from": "in_progress", "to": "waiting"})
    for who, offset in AWAY:
        on = d0 + _timedelta(days=offset)
        name = my_name if who == "me" else PEOPLE[who]
        out["sprints_away"].append({"id": sid("away", person_key(None, name), on.isoformat()), "name": name,
                                    "day": on.isoformat(), "part": "full"})
    return out


def sprints_sample_data(ctx: FunctionContext, data: SprintsSampleDataInput) -> SprintsSampleDataResult:
    pod = ctx.pod
    if data.mode == "clear":
        return _clear(ctx)
    s = settings_of(pod)
    if q(pod, "SELECT id FROM sprints_sprint LIMIT 1"):
        return SprintsSampleDataResult(mode="load", tasks=0, sprints=0, removed=0,
                                       message="Sprints are already here: the sample only goes into a Lemma with none.")
    tz = data.timezone or s.get("timezone") or "UTC"
    me = str(ctx.user_id) if ctx.user_id else None
    my_name = s.get("lead_name") if s.get("lead_user_id") == me and s.get("lead_name") else \
        (ctx.user_name or (ctx.user_email or "").split("@")[0] or "You")
    if not s.get("setup_done_at"):
        pod.records.bulk_create("sprints_settings", [{"id": SETTINGS_ID, "length_weeks": 2, "start_weekday": "mon",
                                                      "timezone": tz, "measure": "points", "lead_user_id": me,
                                                      "lead_name": my_name, "scale": DEFAULT_SCALE,
                                                      "watch_sources": DEFAULT_SOURCES, "setup_done_at": now_iso()}], upsert=True)
    rows_ = build(me, my_name, today_in(tz), tz)
    marks = []

    def write(table, batch, **kw):
        for start in range(0, len(batch), 100):
            chunk = batch[start:start + 100]
            try:
                pod.records.bulk_create(table, chunk, upsert=True, **kw)
            except TypeError:  # an SDK without write intents
                pod.records.bulk_create(table, chunk, upsert=True)
        marks.extend({"table_name": table, "row_id": r["id"]} for r in batch)

    # Tasks as an import: no trigger asks about each one.
    write("task", rows_["task"], intent="import")
    sprints = rows_["sprints_sprint"]
    closed = [x for x in sprints if x["state"] == "closed"]
    write("sprints_sprint", [dict(x, state="planned" if x["state"] == "closed" else x["state"]) for x in sprints])
    for table in ("sprints_item", "sprints_event", "sprints_estimate", "sprints_away"):
        write(table, rows_[table])
    pod.records.update("sprints_settings", SETTINGS_ID, {"sample": True})
    # Each closed sprint as it would have closed: capacity at its start, then its numbers and summary.
    s = settings_of(pod)
    for sp in closed + [x for x in sprints if x["state"] == "running"]:
        cap = capacity(pod, s, sp)
        pod.records.update("sprints_sprint", sp["id"], {"capacity": {"people": cap.get("people") or [], "agents": cap.get("agents") or [],
                                                                      "days": cap.get("days"), "measure": "points", "at": sp["started_at"]},
                                                         "capacity_total": cap.get("total"), "state": "running"})
        if sp["state"] != "closed":
            continue
        items = [i for i in rows_["sprints_item"] if i["sprint_id"] == sp["id"] and i["outcome"] != "done"]
        choices = {i["task_id"]: {"choice": {"carried": "carry", "split": "split", "backlog": "backlog", "dropped": "drop"}[i["outcome"]]}
                   for i in items}
        # The task each item was on at close, for each person's usual.
        tasks = {t["id"]: t for t in rows_["task"]}
        done_by = [{"id": i["id"], "closed_assignee": assignee_of(tasks[i["task_id"]])["name"], "closed_points": i["points_at_add"]}
                   for i in rows_["sprints_item"] if i["sprint_id"] == sp["id"]]
        pod.records.bulk_update("sprints_item", done_by)
        pod.records.update("sprints_sprint", sp["id"], {"state": "closed", "closed_at": sp["closed_at"]})
        frozen = {"people": cap.get("people") or [], "agents": cap.get("agents") or []}
        stats, summary = final_numbers(pod, s, dict(sp, state="closed", capacity=frozen), choices, None)
        pod.records.update("sprints_sprint", sp["id"], {"stats": stats, "summary": summary, "summary_path": None})
    # The urgent task that came in this morning, and what may slip: by Sprints' own functions.
    came = [t for t in rows_["task"] if t["source"] == "incidents" and t["priority"] == "urgent" and t["status"] == "todo"]
    for t in came:
        pod.functions.run("sprints_on_task", {"task_id": t["id"], "op": "insert"})
    pod.functions.run("sprints_tick", {"only": "risks"})
    for r in q(pod, f"SELECT id FROM sprints_suggestion WHERE sprint_id IN ({lits([x['id'] for x in sprints])})"):
        marks.append({"table_name": "sprints_suggestion", "row_id": r["id"]})
    pod.records.bulk_create("sprints_sample_row", marks)
    try:
        pod.functions.run("sprints_needs_you", {})
    except Exception:  # noqa: BLE001
        pass
    return SprintsSampleDataResult(mode="load", tasks=len(rows_["task"]), sprints=len(sprints), removed=0,
                                   message=f"Loaded Sprints 42 to 48 with {len(rows_['task'])} tasks; Sprint 47 is running.")


def _clear(ctx) -> SprintsSampleDataResult:
    pod = ctx.pod
    marks = q(pod, "SELECT id, table_name, row_id FROM sprints_sample_row")
    if not marks:
        return SprintsSampleDataResult(mode="clear", tasks=0, sprints=0, removed=0, message="No sample to clear.")
    by: dict[str, list] = {}
    for m in marks:
        by.setdefault(m["table_name"], []).append(m["row_id"])
    sprint_ids = by.get("sprints_sprint") or []
    task_ids = by.get("task") or []
    removed = 0

    def gone(table, ids):
        nonlocal removed
        for start in range(0, len(ids), 100):
            removed += pod.records.bulk_delete(table, ids[start:start + 100])

    if sprint_ids:
        # Anything made in the sample's sprints since: events, suggestions, carried items, tasks split at close.
        gone("sprints_event", [r["id"] for r in q(pod, f"SELECT id FROM sprints_event WHERE sprint_id IN ({lits(sprint_ids)})")])
        gone("sprints_suggestion", [r["id"] for r in q(pod, f"SELECT id FROM sprints_suggestion WHERE sprint_id IN ({lits(sprint_ids)})")])
        gone("sprints_item", [r["id"] for r in q(pod, f"SELECT id FROM sprints_item WHERE sprint_id IN ({lits(sprint_ids)})")])
    if task_ids:
        split = [r["id"] for r in q(pod, f"SELECT id FROM task WHERE source = 'sprints' AND source_id IN ({lits(task_ids)})")]
        every = task_ids + split
        gone("sprints_item", [r["id"] for r in q(pod, f"SELECT id FROM sprints_item WHERE task_id IN ({lits(every)})")])
        gone("sprints_estimate", [r["id"] for r in q(pod, f"SELECT id FROM sprints_estimate WHERE id IN ({lits(every)})")])
        for side in ("tasks_activity", "tasks_run", "tasks_decision"):
            try:
                col = "task_id" if side == "tasks_activity" else "id"
                gone(side, [r["id"] for r in q(pod, f"SELECT id FROM {side} WHERE {col} IN ({lits(every)})")])
            except Exception:  # noqa: BLE001 — Tasks' own tables, when it is here
                pass
        gone("task", every)
    gone("sprints_away", by.get("sprints_away") or [])
    gone("sprints_sprint", sprint_ids)
    gone("sprints_sample_row", [m["id"] for m in marks])
    pod.records.update("sprints_settings", SETTINGS_ID, {"sample": False})
    s = settings_of(pod)
    if not q(pod, "SELECT id FROM sprints_sprint LIMIT 1"):
        first, last = sprint_bounds(next_start(today_in(s["timezone"]), s["start_weekday"]), s["length_weeks"])
        pod.records.bulk_create("sprints_sprint", [{"id": sid("sprint", 1), "number": 1, "starts_on": first.isoformat(),
                                                    "ends_on": last.isoformat(), "state": "planned"}], upsert=True)
    try:
        pod.functions.run("sprints_needs_you", {})
    except Exception:  # noqa: BLE001
        pass
    return SprintsSampleDataResult(mode="clear", tasks=0, sprints=len(sprint_ids), removed=removed,
                                   message=f"Cleared the sample: {removed} rows. Sprint 1 is open for planning.")
