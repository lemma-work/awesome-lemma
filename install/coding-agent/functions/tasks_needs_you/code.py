#input_type_name: TasksNeedsYouInput
#output_type_name: TasksNeedsYouResult
#function_name: tasks_needs_you

"""What in Tasks needs the person, written to the shared `needs_you` list
that Today reads (see _contract/README.md, "Needs you").

Runs as the person (their own run: a task trigger on their write, the agent's
report on a task they handed over, their app, their daily schedule), and
writes only their own items:

  do       a task of theirs due today or late: their own list, and team tasks
           on them, not done; a sub-task when it is theirs by name and dated
           (its why names the parent)
  decide   an agent waiting on them on a task or sub-task they handed over: a question,
           or an outside action to approve (the approval's text is prepared)
  waiting  a team task they own that someone else has, still open; or a task
           an agent is working for them

Each opens the task (`app` tasks, `path` /t/<id>). Items no longer current are
resolved by the contract's write rule; one the person dismissed comes back
only when the task changes (`source_version`).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# contract:needs-you
# The one way to write `needs_you` (see _contract/README.md). Copied verbatim
# into every writer between these markers; _contract/lint.py fails on any
# difference. Needs a grant on needs_you (read and write).
import uuid as _ny_uuid
from datetime import datetime as _ny_datetime, timezone as _ny_timezone

NEEDS_YOU_NS = _ny_uuid.UUID("6b1d9a2e-4c37-4f0a-9e58-2d7c1b3f8a65")


def needs_you_id(plugin: str, table: str, source_id: str, verb: str, member: str) -> str:
    """The item's id: one per (plugin, source table, source row, verb, member)."""
    return str(_ny_uuid.uuid5(NEEDS_YOU_NS, f"{plugin}/{table}/{source_id}/{verb}/{member}"))


def needs_you_write(pod, plugin: str, member: str, items: list, scope_where: str | None = None) -> dict:
    """Write what needs the member now, from one plugin, and resolve the rest.

    `items` are the plugin's current items within the scope, each with verb,
    title, source_table, source_id and source_version, and any other column.
    `scope_where` is a SQL condition on needs_you naming what this pass looked
    at (e.g. "conversation_id IN (...)"); None means everything of this plugin.

    - new: created open.
    - open or snoozed: updated in place (a snooze holds until it ends).
    - dismissed, or done by the person: left alone, unless source_version
      changed, when it opens again.
    - done by the source (resolved before): opens again.
    - open or snoozed items in scope that are no longer current: done, closed
      by the source.
    """
    def rows(response):
        payload = response.to_dict() if hasattr(response, "to_dict") else response
        return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]

    def quoted(value):
        return "'" + str(value).replace("'", "''") + "'"

    now = _ny_datetime.now(_ny_timezone.utc).isoformat()
    current = {}
    for item in items:
        row = dict(item, source_plugin=plugin)
        row["id"] = needs_you_id(plugin, row["source_table"], str(row["source_id"]), row["verb"], member)
        current[row["id"]] = row
    where = f"source_plugin = {quoted(plugin)}" + (f" AND ({scope_where})" if scope_where else "")
    seen = {r["id"]: r for r in rows(pod.query(
        f"SELECT id, state, closed_by, source_version, snoozed_until FROM needs_you WHERE {where} LIMIT 5000"))}
    missing = [i for i in current if i not in seen]
    for start in range(0, len(missing), 200):
        ids = ", ".join(quoted(i) for i in missing[start : start + 200])
        seen.update({r["id"]: r for r in rows(pod.query(
            f"SELECT id, state, closed_by, source_version, snoozed_until FROM needs_you WHERE id IN ({ids})"))})
    creates, updates, counts = [], [], {"created": 0, "updated": 0, "kept_closed": 0, "resolved": 0}
    for item_id, row in current.items():
        old = seen.get(item_id)
        if old is None:
            creates.append(dict(row, state="open"))
            continue
        changed = (old.get("source_version") or "") != (row.get("source_version") or "")
        state = old.get("state")
        if state in ("dismissed", "done") and old.get("closed_by") != "source" and not changed:
            counts["kept_closed"] += 1
            continue
        if state == "snoozed" and not changed and (old.get("snoozed_until") or "") > now:
            updates.append(row)
            continue
        updates.append(dict(row, state="open", closed_by=None, snoozed_until=None))
    for item_id, old in seen.items():
        if item_id not in current and old.get("state") in ("open", "snoozed"):
            updates.append({"id": item_id, "state": "done", "closed_by": "source"})
            counts["resolved"] += 1
    for start in range(0, len(creates), 100):
        pod.records.bulk_create("needs_you", creates[start : start + 100], upsert=True)
    for start in range(0, len(updates), 100):
        pod.records.bulk_update("needs_you", updates[start : start + 100])
    counts["created"], counts["updated"] = len(creates), len(updates) - counts["resolved"]
    return counts
# end contract


PRIORITY_WEIGHT = {"urgent": 4, "high": 3, "medium": 2, "low": 1, "none": 0}
ZONE_ALIASES = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu",
                "Europe/Kiev": "Europe/Kyiv", "US/Eastern": "America/New_York", "US/Pacific": "America/Los_Angeles"}


class TasksNeedsYouInput(BaseModel):
    detail: bool = False


class TasksNeedsYouResult(BaseModel):
    do: int
    decide: int
    waiting: int
    counts: dict
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _clip(text: Any, size: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= size else text[: size - 1] + "…"


def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(ZONE_ALIASES.get(name or "", name or "UTC"))
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def tasks_needs_you(ctx: FunctionContext, data: TasksNeedsYouInput) -> TasksNeedsYouResult:
    pod = ctx.pod
    me = str(ctx.user_id) if ctx.user_id else ""
    if not me:
        return TasksNeedsYouResult(do=0, decide=0, waiting=0, counts={}, message="No member to write for.")
    settings = (_rows(pod.query("SELECT timezone FROM tasks_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    zone = _zone(settings.get("timezone"))
    today = datetime.now(timezone.utc).astimezone(zone).date()
    names = {r["id"]: r["name"] for r in _rows(pod.query("SELECT id, name FROM project"))}

    def due_at(day: str) -> str:
        d = date.fromisoformat(str(day)[:10])
        return datetime.combine(d, time(18, 0), zone).astimezone(timezone.utc).isoformat()

    items: list[dict] = []
    cols = ("id, title, status, priority, due_on, project_id, parent_id, assignee_kind, assignee_user_id, assignee_name, "
            "assignee_agent, owner_user_id, source, quote, updated_at")
    runs = {r["id"]: r for r in _rows(pod.query("SELECT id, agent, state, last_report_at FROM tasks_run"))}
    mine = [("personal_task", r) for r in _rows(pod.query(
        f"SELECT {cols} FROM personal_task WHERE status IN ('todo', 'in_progress', 'waiting') LIMIT 3000"))]
    # Team tasks and sub-tasks on them, theirs, or handed by them to an agent (their runs).
    mine += [("task", r) for r in _rows(pod.query(
        f"SELECT {cols} FROM task WHERE status IN ('todo', 'in_progress', 'waiting') "
        f"AND (assignee_user_id = {_sql(me)} OR owner_user_id = {_sql(me)} OR id IN ({_in(runs)})) LIMIT 3000"))]
    titles = {t["id"]: t.get("title") for _, t in mine}
    missing = {t["parent_id"] for _, t in mine if t.get("parent_id") and t["parent_id"] not in titles}
    for table in ("personal_task", "task"):
        if missing:
            for r in _rows(pod.query(f"SELECT id, title FROM {table} WHERE id IN ({_in(missing)})")):
                titles[r["id"]] = r.get("title")

    for table, t in mine:
        where = f"In {names[t['project_id']]}" if t.get("project_id") in names else ("Only you see it" if table == "personal_task" else "Team task")
        sub = bool(t.get("parent_id"))
        # A sub-task says whose part it is, so Today can tell it from its parent.
        of = f"Sub-task of “{_clip(titles.get(t['parent_id']) or 'a task', 80)}” · " if sub else ""
        base = {"source_table": table, "source_id": t["id"], "app": "tasks", "path": f"/t/{t['id']}",
                "quote": _clip(t.get("quote"), 600) or None, "weight": PRIORITY_WEIGHT.get(t.get("priority") or "none", 0)}
        run = runs.get(t["id"])
        if sub:
            # A sub-task is theirs to do only when it is theirs by name.
            on_me = t.get("assignee_kind") == "person" and t.get("assignee_user_id") == me
        else:
            on_me = table == "personal_task" and t.get("assignee_kind") != "agent" or (table == "task" and t.get("assignee_user_id") == me)
        # do: due today or late, and theirs to do.
        if on_me and t.get("due_on") and str(t["due_on"])[:10] <= today.isoformat() and t.get("status") != "waiting":
            late = (today - date.fromisoformat(str(t["due_on"])[:10])).days
            why = "Due today" if late == 0 else ("Due yesterday" if late == 1 else f"{late} days late")
            items.append(dict(base, verb="do", title=_clip(t["title"], 300), why=_clip(f"{of}{why} · {where}", 300), due_at=due_at(t["due_on"]),
                              source_version=f"{t.get('status')}|{t.get('due_on')}|{t.get('title')}"))
        # decide: an agent waiting on them.
        if t.get("assignee_kind") == "agent" and run and run.get("state") == "waiting":
            activity = "tasks_personal_activity" if table == "personal_task" else "tasks_activity"
            ask = (_rows(pod.query(
                f"SELECT id, kind, body, detail, created_at FROM {activity} WHERE task_id = {_sql(t['id'])} AND state = 'pending' "
                "ORDER BY created_at DESC LIMIT 1")) or [None])[0]
            agent = "This Lemma" if run.get("agent") == "pod_default" else run.get("agent")
            detail = (ask or {}).get("detail") or {}
            if ask and ask.get("kind") == "approval":
                why = f"{agent} wants your approval: {_clip(detail.get('action') or ask.get('body'), 200)}"
                prepared, text = "Ready to approve", detail.get("text") or ask.get("body")
            elif ask:
                why = f"{agent} asks: {_clip(ask.get('body'), 220)}"
                prepared, text = None, None
            else:
                why, prepared, text = f"{agent} stopped and is waiting on you", None, None
            items.append(dict(base, verb="decide", title=_clip(t["title"], 300), why=_clip(of + why, 300),
                              since_at=(ask or {}).get("created_at") or run.get("last_report_at"),
                              prepared=prepared, prepared_text=_clip(text, 2000) if text else None,
                              source_version=f"waiting|{(ask or {}).get('id') or run.get('last_report_at')}"))
        # waiting: handed to someone else, or an agent working for them.
        elif not sub and table == "task" and t.get("owner_user_id") == me and t.get("assignee_kind") == "person" \
                and t.get("assignee_user_id") and t.get("assignee_user_id") != me:
            items.append(dict(base, verb="waiting", title=_clip(t["title"], 300), person_name=t.get("assignee_name"),
                              why=_clip(f"With {t.get('assignee_name') or 'someone'} · {where}", 300),
                              due_at=due_at(t["due_on"]) if t.get("due_on") else None,
                              source_version=f"{t.get('status')}|{t.get('assignee_user_id')}|{t.get('due_on')}"))
        elif not sub and t.get("assignee_kind") == "agent" and run and run.get("state") in ("starting", "working"):
            agent = "This Lemma" if run.get("agent") == "pod_default" else run.get("agent")
            items.append(dict(base, verb="waiting", title=_clip(t["title"], 300), why=_clip(f"{agent} is working on it · {where}", 300),
                              since_at=run.get("last_report_at"), prepared="An agent is on it",
                              due_at=due_at(t["due_on"]) if t.get("due_on") else None,
                              source_version=f"agent|{run.get('state')}"))

    counts = needs_you_write(pod, "tasks", me, items)
    by = {v: sum(1 for i in items if i["verb"] == v) for v in ("do", "decide", "waiting")}
    return TasksNeedsYouResult(do=by["do"], decide=by["decide"], waiting=by["waiting"], counts=counts,
                               message=f"{by['do']} to do, {by['decide']} to decide, {by['waiting']} waiting; {counts}")
