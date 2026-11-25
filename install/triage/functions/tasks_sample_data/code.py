#input_type_name: TasksSampleDataInput
#output_type_name: TasksSampleDataResult
#function_name: tasks_sample_data

"""A made-up list, so Tasks can be seen working without anyone's real work.

`load` makes, for the person who runs it:

- their own list (private): a founder's week at a small software company,
  with the same made-up people as Mail's sample (Hannah Volkov, Marcus Lee at
  Tidal Foods, Sana Iqbal at Orchard Dental, Eleanor Park, Jonas Weber), one
  task with sub-tasks, one done;
- one team project, "Brightwave renewal" (Daniel Kowalski, 40 seats), with
  five tasks and a comment;
- two tasks an agent could do on its own, with nothing but web search and
  writing: "Draft a one-page guide to turning on single sign-on", and a
  comparison of error-monitoring tools.

Nothing is handed to an agent: the "could an agent do this?" call runs on
each new task (the `tasks-*-added` schedules) and suggests it; the person
hands it over. Every row made is marked in `tasks_sample_row`, with ids made
from the person's id, so two people can each load their own and loading
twice changes nothing.

`clear` removes only what the sample made: its tasks with their timelines,
agent runs, suggestions and corrections, and the project when no task of
anyone else's is left in it, and its items on the shared needs_you list. Agent
conversations stay in the Lemma's history.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

NS = uuid.UUID("5b0e6f3a-8c1d-4e27-9a64-2f7d1c3e8b90")

PERSONAL = [
    # key, title, description, status, priority, due (days from today), labels, parent key
    ("pricing", "Send Hannah v2 of the pricing page",
     "She asked for the annual toggle and an enterprise row. Her notes on v1 are in the thread.",
     "todo", "high", 1, ["website"], None),
    ("invoice", "Fix the seat count on Tidal Foods' invoice INV-2207",
     "Marcus says they were billed for 25 seats; the contract says 20. Re-issue it and say sorry.",
     "todo", "urgent", 0, ["billing"], None),
    ("sso", "Draft a one-page guide to turning on single sign-on",
     "Customers keep asking how to turn on SSO before they roll out to their teams. One page they can follow: "
     "what they need first (an admin in their identity provider), the steps for Okta, Google Workspace and "
     "Microsoft Entra ID, and what to check afterwards. From the providers' public docs, in plain words.",
     "todo", "medium", 4, ["docs"], None),
    ("orchard", "Book the onboarding call with Orchard Dental",
     "Sana asked for next week, mornings only.", "todo", "medium", 3, [], None),
    ("board", "Prepare the board meeting pack", "Deck, the numbers and the hiring update, to Eleanor two days before.",
     "in_progress", "high", 7, ["board"], None),
    ("board-numbers", "Pull the October numbers", None, "done", "none", None, [], "board"),
    ("board-hiring", "Write the hiring update", None, "todo", "none", None, [], "board"),
    ("board-topics", "Ask Eleanor which topics she wants first", None, "todo", "none", None, [], "board"),
    ("monitoring", "Compare three error-monitoring tools for the backend",
     "Pricing for about 2M events a month, how each handles Python and TypeScript, and what moving off our "
     "current one would take.", "todo", "low", None, ["engineering"], None),
    ("podcast", "Reply to Jonas about guesting on Build Notes", None, "todo", "low", None, [], None),
    ("insurance", "Renew the office insurance", None, "done", "medium", -2, ["admin"], None),
]

PROJECT = ("brightwave", "Brightwave renewal",
           "Brightwave Health renews for 40 seats this month. Daniel Kowalski is their lead; the quote, the date "
           "and their SSO set-up have to be settled before the call.", 14)

TEAM = [
    ("bw-quote", "Send Brightwave the 40-seat renewal quote", "Annual, 40 seats, same price per seat as last year.",
     "in_progress", "high", 2, ["sales"], "me"),
    ("bw-sso", "Check Brightwave's SSO set-up before the renewal call",
     "They use Microsoft Entra ID. Make sure their admin knows the steps.", "todo", "medium", 5, ["security"], None),
    ("bw-date", "Confirm the renewal date with Daniel", None, "waiting", "medium", 3, ["sales"], "me"),
    ("bw-tickets", "Summarise Brightwave's support tickets from this quarter",
     "What they asked about most, and anything still open.", "todo", "low", 6, [], None),
    ("bw-discount", "Agree the discount for a two-year term", None, "todo", "high", 4, ["sales"], None),
]

COMMENTS = [("bw-date", "Asked Daniel on Tuesday; he's checking the date with their procurement team.")]


class TasksSampleDataInput(BaseModel):
    mode: str = "load"
    timezone: str | None = None
    display_name: str | None = None


class TasksSampleDataResult(BaseModel):
    mode: str
    tasks: int
    projects: int
    removed: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _today(zone_name: str | None) -> date:
    try:
        zone = ZoneInfo({"Asia/Calcutta": "Asia/Kolkata"}.get(zone_name or "", zone_name or "UTC"))
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("UTC")
    return datetime.now(timezone.utc).astimezone(zone).date()


def tasks_sample_data(ctx: FunctionContext, data: TasksSampleDataInput) -> TasksSampleDataResult:
    pod = ctx.pod
    if data.mode == "clear":
        return _clear(pod)
    me = str(ctx.user_id) if ctx.user_id else "someone"
    settings = (_rows(pod.query("SELECT display_name, timezone FROM tasks_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    name = settings.get("display_name") or data.display_name or (ctx.user_email or "").split("@")[0] or None
    today = _today(data.timezone or settings.get("timezone"))

    def rid(key: str) -> str:
        return str(uuid.uuid5(NS, f"{me}:{key}"))

    have = {r["row_id"] for r in _rows(pod.query("SELECT row_id FROM tasks_sample_row"))}
    if rid("pricing") in have:
        return TasksSampleDataResult(mode="load", tasks=0, projects=0, removed=0, message="The sample is already here.")

    now = datetime.now(timezone.utc).isoformat()
    marks: list[dict] = []
    project_id = rid(PROJECT[0])
    pod.records.bulk_create("project", [{
        "id": project_id, "name": PROJECT[1], "description": PROJECT[2], "state": "active",
        "lead_user_id": me if ctx.user_id else None, "lead_name": name,
        "target_on": (today + timedelta(days=PROJECT[3])).isoformat(), "source": "tasks"}], upsert=True)
    marks.append({"table_name": "project", "row_id": project_id})

    def task_row(key, title, desc, status, priority, due, labels, parent, mine: bool) -> dict:
        row = {"id": rid(key), "title": title, "description": desc, "status": status, "priority": priority,
               "due_on": (today + timedelta(days=due)).isoformat() if due is not None else None,
               "labels": labels, "parent_id": rid(parent) if parent else None,
               "owner_user_id": me if ctx.user_id else None, "owner_name": name, "source": "tasks",
               "assignee_kind": "none", "done_at": now if status == "done" else None}
        if mine:
            row.update({"assignee_kind": "person", "assignee_user_id": me if ctx.user_id else None, "assignee_name": name})
        return row

    personal = [task_row(k, t, d, s, p, due, lab, par, True) for k, t, d, s, p, due, lab, par in PERSONAL]
    # Parents first, so a sub-task never points at a row not yet there.
    personal.sort(key=lambda r: r["parent_id"] is not None)
    pod.records.bulk_create("personal_task", personal, upsert=True)
    marks += [{"table_name": "personal_task", "row_id": r["id"]} for r in personal]

    team = []
    for k, t, d, s, p, due, lab, who in TEAM:
        row = task_row(k, t, d, s, p, due, lab, None, who == "me")
        row["project_id"] = project_id
        team.append(row)
    pod.records.bulk_create("task", team, upsert=True)
    marks += [{"table_name": "task", "row_id": r["id"]} for r in team]

    events = [{"id": rid(f"comment:{key}"), "task_id": rid(key), "kind": "comment", "actor_kind": "person",
               "actor_user_id": me if ctx.user_id else None, "actor_name": name, "body": body} for key, body in COMMENTS]
    pod.records.bulk_create("tasks_activity", events, upsert=True)
    marks += [{"table_name": "tasks_activity", "row_id": e["id"]} for e in events]

    pod.records.bulk_create("tasks_sample_row", marks)
    return TasksSampleDataResult(mode="load", tasks=len(personal) + len(team), projects=1, removed=0,
                                 message=f"Loaded {len(personal)} tasks of your own and the {PROJECT[1]} project with {len(team)}.")


def _clear(pod) -> TasksSampleDataResult:
    marks = _rows(pod.query("SELECT id, table_name, row_id FROM tasks_sample_row"))
    if not marks:
        return TasksSampleDataResult(mode="clear", tasks=0, projects=0, removed=0, message="No sample to clear.")
    by: dict[str, list[str]] = {}
    for m in marks:
        by.setdefault(m["table_name"], []).append(m["row_id"])
    removed = 0
    for table, activity in (("personal_task", "tasks_personal_activity"), ("task", "tasks_activity")):
        ids = by.get(table) or []
        if not ids:
            continue
        # Only what is still there and still this table's (a shared task moved
        # across keeps its id, so look in both).
        for where_table, where_activity in (("personal_task", "tasks_personal_activity"), ("task", "tasks_activity")):
            present = [r["id"] for r in _rows(pod.query(f"SELECT id FROM {where_table} WHERE id IN ({_in(ids)})"))]
            if not present:
                continue
            events = [e["id"] for e in _rows(pod.query(f"SELECT id FROM {where_activity} WHERE task_id IN ({_in(present)})"))]
            if events:
                removed += pod.records.bulk_delete(where_activity, events)
            for side in ("tasks_run", "tasks_decision"):
                found = [r["id"] for r in _rows(pod.query(f"SELECT id FROM {side} WHERE id IN ({_in(present)})"))]
                if found:
                    removed += pod.records.bulk_delete(side, found)
            corrections = [r["id"] for r in _rows(pod.query(f"SELECT id FROM tasks_correction WHERE subject_id IN ({_in(present)})"))]
            if corrections:
                removed += pod.records.bulk_delete("tasks_correction", corrections)
            # Sub-tasks someone added under a sample task go with it.
            children = [r["id"] for r in _rows(pod.query(
                f"SELECT id FROM {where_table} WHERE parent_id IN ({_in(present)}) AND id NOT IN ({_in(present)})"))]
            if children:
                child_events = [e["id"] for e in _rows(pod.query(f"SELECT id FROM {where_activity} WHERE task_id IN ({_in(children)})"))]
                if child_events:
                    removed += pod.records.bulk_delete(where_activity, child_events)
                removed += pod.records.bulk_delete(where_table, children)
            subs = [r["id"] for r in _rows(pod.query(
                f"SELECT id FROM {where_table} WHERE id IN ({_in(present)}) AND parent_id IS NOT NULL"))]
            if subs:
                removed += pod.records.bulk_delete(where_table, subs)
            rest = [i for i in present if i not in subs]
            if rest:
                removed += pod.records.bulk_delete(where_table, rest)
    # Its items on the needs_you list go with it.
    sample_ids = (by.get("personal_task") or []) + (by.get("task") or [])
    for start in range(0, len(sample_ids), 100):
        chunk = sample_ids[start: start + 100]
        items = [r["id"] for r in _rows(pod.query(
            f"SELECT id FROM needs_you WHERE source_plugin = 'tasks' AND source_id IN ({_in(chunk)})"))]
        if items:
            removed += pod.records.bulk_delete("needs_you", items)
    projects = 0
    for pid in by.get("project") or []:
        left = _rows(pod.query(f"SELECT COUNT(*) AS n FROM task WHERE project_id = {_sql(pid)}"))
        if left and int(left[0].get("n") or 0) == 0:
            removed += pod.records.bulk_delete("project", [pid])
            projects += 1
    pod.records.bulk_delete("tasks_sample_row", [m["id"] for m in marks])
    kept = "" if projects == len(by.get("project") or []) else " The project stays: tasks the sample didn't make are in it."
    return TasksSampleDataResult(mode="clear", tasks=0, projects=projects, removed=removed,
                                 message=f"Cleared the sample: {removed} rows.{kept}")
