#input_type_name: SprintsCloseInput
#output_type_name: SprintsCloseResult
#function_name: sprints_close

"""Close a sprint with the lead's choice for each unfinished task.

- carry: the task goes into the next sprint as it is, marked as its next
  sprint ("2nd sprint", "3rd sprint").
- split: the task keeps its id for the part that carries (its title and
  estimate can change), and the rest becomes a new team task (`source`
  sprints, `source_id` the original) in the backlog with its own estimate.
- backlog: out of every sprint; the task stays as it is.
- drop: the task is canceled.

Then: the numbers (`stats`), worked out by sprints_close_prepare's own code
with these choices; the summary (the lead's text if they edited it, else the
draft again with the final numbers); `/sprints/<n>.md`; the sprint closed;
the next one open for planning with the carried work in it; and the lead's
"Close Sprint N" resolved. Every unfinished task needs a choice: none is made
for anyone.
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


class SprintsCloseInput(BaseModel):
    sprint: str | int | None = None
    # task id -> {choice: carry|split|backlog|drop, carry_title, carry_points, rest_title, rest_points}
    choices: dict | None = None
    # The lead's own text, when they edited the summary.
    summary: str | None = None
    # Take the Lemma's suggestion for any task with no choice given.
    take_suggestions: bool = False


class SprintsCloseResult(BaseModel):
    sprint_number: int | None
    closed: bool
    next_number: int | None
    path: str | None
    stats: dict
    message: str


def sprints_close(ctx: FunctionContext, data: SprintsCloseInput) -> SprintsCloseResult:
    pod = ctx.pod
    s = settings_of(pod)
    sprints = q(pod, "SELECT * FROM sprints_sprint ORDER BY number")
    if data.sprint in (None, "", "current"):
        sprint = next((x for x in sprints if x["state"] in ("running", "closing")), None)
    else:
        sprint = next((x for x in sprints if str(x["number"]) == str(data.sprint).lstrip("#")), None)
    if not sprint or sprint["state"] not in ("running", "closing"):
        return SprintsCloseResult(sprint_number=None, closed=False, next_number=None, path=None, stats={},
                                  message="There is no running sprint to close.")
    n = int(sprint["number"])
    points_on = s["measure"] == "points"
    items = q(pod, "SELECT i.*, t.id AS tid, t.number, t.title, t.description, t.status, t.priority, t.project_id, t.labels, "
                   "t.assignee_kind, t.assignee_user_id, t.assignee_name, t.assignee_agent, t.owner_user_id, t.owner_name "
                   f"FROM sprints_item i LEFT JOIN task t ON t.id = i.task_id WHERE i.sprint_id = {lit(sprint['id'])}")
    est = {r["id"]: float(r["points"]) for r in q(pod, "SELECT id, points FROM sprints_estimate")}
    suggestions = {(json_list(r.get("task_ids")) or [None])[0]: r for r in
                   q(pod, f"SELECT * FROM sprints_suggestion WHERE kind = 'close' AND sprint_id = {lit(sprint['id'])}")}
    present = [i for i in items if not i.get("removed_at")]
    open_ = [i for i in present if i.get("tid") and i.get("outcome") != "done" and i.get("status") != "done"]
    choices: dict = {}
    for i in open_:
        c = dict((data.choices or {}).get(i["task_id"]) or {})
        if not c.get("choice") and data.take_suggestions and (suggestions.get(i["task_id"]) or {}).get("choice"):
            c["choice"] = suggestions[i["task_id"]]["choice"]
        choices[i["task_id"]] = c
    missing = [f"#{i['number']}" for i in open_ if (choices[i["task_id"]] or {}).get("choice") not in ("carry", "split", "backlog", "drop")]
    if missing:
        return SprintsCloseResult(sprint_number=n, closed=False, next_number=None, path=None, stats={},
                                  message=f"Choose what happens to {joined(missing)} first: carry, split, backlog or drop.")

    now = now_iso()
    who = ctx.user_name or (ctx.user_email or "").split("@")[0] or None
    nxt = next((x for x in sprints if int(x["number"]) == n + 1), None)
    if not nxt:
        first, end = sprint_bounds(day(sprint["starts_on"]) + _timedelta(days=7 * s["length_weeks"]), s["length_weeks"])
        nxt = {"id": sid("sprint", n + 1), "number": n + 1, "starts_on": first.isoformat(), "ends_on": end.isoformat(), "state": "planned"}
        pod.records.bulk_create("sprints_sprint", [nxt], upsert=True)
    carry_rows, item_updates, task_updates, estimates, events = [], [], [], [], []
    actor = {"actor_kind": "person" if ctx.user_id else "lemma", "actor_name": who,
             "actor_user_id": str(ctx.user_id) if ctx.user_id else None}

    def closed_fields(i):
        a = assignee_of(i)
        return {"closed_assignee": a["name"] if a["kind"] != "none" else None,
                "closed_points": (est.get(i["task_id"]) if points_on else 1.0)}

    for i in present:
        if i.get("tid") and (i.get("outcome") == "done" or i.get("status") == "done"):
            item_updates.append({"id": i["id"], "outcome": "done", "done_at": i.get("done_at") or now, **closed_fields(i)})
    for i in open_:
        c = choices[i["task_id"]]
        choice = c["choice"]
        if choice == "split":
            whole = est.get(i["task_id"])
            carry_points = c.get("carry_points")
            rest_points = c.get("rest_points")
            if carry_points is None and whole is not None and rest_points is not None:
                carry_points = max(0.0, whole - float(rest_points))
            if rest_points is None and whole is not None and carry_points is not None:
                rest_points = max(0.0, whole - float(carry_points))
            rest = pod.records.create("task", {
                "title": (c.get("rest_title") or f"{i['title']}: the rest")[:300],
                "description": f"Split from #{i['number']} when Sprint {n} closed.", "status": "todo",
                "priority": i.get("priority") or "none", "project_id": i.get("project_id"), "labels": json_list(i.get("labels")),
                "assignee_kind": "none", "owner_user_id": i.get("owner_user_id"), "owner_name": i.get("owner_name"),
                "source": "sprints", "source_id": str(i["task_id"])})
            rest = as_dict(rest)
            rest_id = rest.get("id")
            c["rest_tag"] = f"#{rest.get('number')}" if rest.get("number") is not None else None
            if rest_id and rest_points is not None and points_on:
                estimates.append({"id": rest_id, "points": float(rest_points), "by": who, "at": now})
            patch = {}
            if c.get("carry_title"):
                patch["title"] = str(c["carry_title"])[:300]
            if patch:
                task_updates.append((i["task_id"], patch))
            if carry_points is not None and points_on:
                estimates.append({"id": i["task_id"], "points": float(carry_points), "by": who, "at": now})
                c["carry_points"] = float(carry_points)
        if choice in ("carry", "split"):
            carry_rows.append({"id": sid(nxt["id"], i["task_id"]), "sprint_id": nxt["id"], "task_id": i["task_id"],
                               "in_at_start": False, "added_at": now, "added_by": who, "outcome": "open",
                               "nth": int(i.get("nth") or 1) + 1, "carried_from": sprint["id"],
                               "points_at_add": (float(c["carry_points"]) if choice == "split" and c.get("carry_points") is not None
                                                 else est.get(i["task_id"])) if points_on else 1.0})
        if choice == "drop":
            task_updates.append((i["task_id"], {"status": "canceled"}))
        outcome = {"carry": "carried", "split": "split", "backlog": "backlog", "drop": "dropped"}[choice]
        fields = closed_fields(i)
        if choice == "split" and c.get("rest_points") is not None and points_on and est.get(i["task_id"]) is not None:
            fields["closed_points"] = est.get(i["task_id"])  # the whole, as it stood in this sprint
        item_updates.append({"id": i["id"], "outcome": outcome, **fields})
        events.append({"id": sid("event", i["id"], "close", now), "sprint_id": sprint["id"], "task_id": i["task_id"],
                       "kind": "status", "at": now, "via": "close", **actor, "detail": {"close": choice, **{k: v for k, v in c.items() if k != "choice"}}})

    if item_updates:
        for start in range(0, len(item_updates), 100):
            pod.records.bulk_update("sprints_item", item_updates[start:start + 100])
    if events:
        pod.records.bulk_create("sprints_event", events, upsert=True)
    # Stats and summary from the same code the close screen's draft came from.
    slim = {k: {kk: vv for kk, vv in v.items() if kk in ("choice", "carry_points", "rest_tag")} for k, v in choices.items()}
    closed_view = dict(sprint, state="closed")
    stats, drafted = final_numbers(pod, s, closed_view, slim, None)
    pod.records.update("sprints_sprint", sprint["id"], {"stats": stats, "state": "closed", "closed_at": now})
    if estimates:
        pod.records.bulk_create("sprints_estimate", estimates, upsert=True)
    if carry_rows:
        pod.records.bulk_create("sprints_item", carry_rows, upsert=True)
    for task_id, patch in task_updates:
        pod.records.update("task", task_id, patch)
    # The next sprint's capacity now counts this one; the summary says it.
    try:
        cap = capacity(pod, s, nxt)["total"]
        _, drafted = final_numbers(pod, s, closed_view, slim, cap)
    except Exception:  # noqa: BLE001 — the draft without the next sprint's capacity
        pass
    text = data.summary.strip() + "\n" if data.summary and data.summary.strip() else (
        sprint.get("summary") if sprint.get("summary_edited") and sprint.get("summary") else drafted)
    path = f"/sprints/{n}.md"
    lines = [text.rstrip(), "", "## The tasks", ""]
    titles = {i["task_id"]: i for i in items}
    ordered = sorted(items, key=lambda i: int(i.get("number") or 0))
    groups = [("In at the start", [i for i in ordered if i.get("in_at_start")]),
              ("Added after the start", [i for i in ordered if not i.get("in_at_start")])]
    for head, group in groups:
        if not group:
            continue
        lines.append(f"### {head}")
        for i in group:
            c = choices.get(i["task_id"]) or {}
            state = "taken out" if i.get("removed_at") else ("done" if i.get("outcome") == "done" or i.get("status") == "done" else
                                                              {"carry": "carried", "split": "split", "backlog": "to the backlog",
                                                               "drop": "dropped"}.get(c.get("choice"), "not done"))
            pts = est.get(i["task_id"])
            pts = f", {num(pts)} {'pt' if pts == 1 else 'pts'}" if points_on and pts is not None else ""
            lines.append(f"- #{titles[i['task_id']].get('number')} {titles[i['task_id']].get('title') or '(deleted)'}{pts}: {state}")
        lines.append("")
    body = "\n".join(lines).rstrip() + "\n"
    try:
        try:
            pod.files.create_folder("/sprints")
        except Exception:  # noqa: BLE001 — there already
            pass
        pod.files.write_text(path, body)
    except Exception as exc:  # noqa: BLE001
        path = None
        text += f"\n<!-- not saved: {type(exc).__name__} -->\n"
    pod.records.update("sprints_sprint", sprint["id"], {"summary": text, "summary_path": path})
    for r in suggestions.values():
        if r.get("state") == "open":
            took = (choices.get((json_list(r.get("task_ids")) or [None])[0]) or {}).get("choice") == r.get("choice")
            pod.records.update("sprints_suggestion", r["id"], {"state": "taken" if took else "dismissed", "decided_by": who,
                                                               "decided_at": now})
    try:
        pod.functions.run("sprints_needs_you", {})
    except Exception:  # noqa: BLE001
        pass
    carried = len(carry_rows)
    return SprintsCloseResult(sprint_number=n, closed=True, next_number=n + 1, path=path, stats=stats,
                              message=f"Closed Sprint {n}. {carried} task{'s' if carried != 1 else ''} carried into Sprint {n + 1}"
                                      + (f"; the summary is {path}." if path else "; the summary could not be saved as a file."))
