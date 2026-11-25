#input_type_name: TasksMoveInput
#output_type_name: TasksMoveResult
#function_name: tasks_move

"""Share a personal task with the team, or take a team task back.

The platform's row-level security lets a row through to its owner only, so a
private task and a team task live in two tables with the same columns
(`personal_task`, `task`). Moving one copies it, its sub-tasks and its
timeline across with every id kept, then removes the old rows: anything that
points at the task by id (its agent run, its suggestions, Today) still finds
it.

  to team       anyone's own task; optionally into a project
  to personal   only the task's owner, and only out of a project
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

TABLES = {"personal": ("personal_task", "tasks_personal_activity"), "team": ("task", "tasks_activity")}
COLUMNS = ("id", "title", "description", "status", "priority", "due_on", "project_id", "parent_id", "labels",
           "assignee_kind", "assignee_user_id", "assignee_name", "assignee_agent", "owner_user_id", "owner_name",
           "source", "source_id", "source_url", "quote", "done_at", "created_at")
ACTIVITY = ("id", "task_id", "kind", "actor_kind", "actor_user_id", "actor_name", "body", "detail", "state",
            "decided_by", "decided_at", "created_at")


class TasksMoveInput(BaseModel):
    task_id: str
    # team or personal
    to: str = "team"
    project_id: str | None = None


class TasksMoveResult(BaseModel):
    task_id: str
    scope: str
    moved: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def tasks_move(ctx: FunctionContext, data: TasksMoveInput) -> TasksMoveResult:
    pod = ctx.pod
    to = "team" if data.to == "team" else "personal"
    src = "personal" if to == "team" else "team"
    src_table, src_activity = TABLES[src]
    dst_table, dst_activity = TABLES[to]
    task = (_rows(pod.query(f"SELECT * FROM {src_table} WHERE id = {_sql(data.task_id)}")) or [None])[0]
    if not task:
        here = _rows(pod.query(f"SELECT id FROM {dst_table} WHERE id = {_sql(data.task_id)}"))
        if here:
            if to == "team" and data.project_id:
                pod.table(dst_table).update(data.task_id, {"project_id": data.project_id})
            return TasksMoveResult(task_id=data.task_id, scope=to, moved=0, message="Already there.")
        raise ValueError("No such task.")
    if task.get("parent_id"):
        raise ValueError("Move the parent task; its sub-tasks go with it.")
    me = str(ctx.user_id) if ctx.user_id else None
    # Read before writing anything, so a refusal leaves the task where it was.
    settings = (_rows(pod.query("SELECT display_name FROM tasks_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    who = settings.get("display_name") or (ctx.user_email or "").split("@")[0] or None
    if to == "personal" and task.get("owner_user_id") and task.get("owner_user_id") != me:
        raise ValueError("Only the person whose task it is can make it private.")

    project = None
    if to == "team" and data.project_id:
        project = (_rows(pod.query(f"SELECT id, name FROM project WHERE id = {_sql(data.project_id)}")) or [None])[0]
        if not project:
            raise ValueError("No such project.")

    family = [task] + _rows(pod.query(f"SELECT * FROM {src_table} WHERE parent_id = {_sql(task['id'])}"))
    ids = [t["id"] for t in family]
    rows = []
    for t in family:
        row = {k: t.get(k) for k in COLUMNS if k in t and k != "created_at"}
        row["project_id"] = (project or {}).get("id") if to == "team" else None
        if to == "personal" and row.get("assignee_kind") == "person" and row.get("assignee_user_id") != me:
            row.update({"assignee_kind": "none", "assignee_user_id": None, "assignee_name": None})
        rows.append(row)
    pod.records.bulk_create(dst_table, rows, upsert=True)

    events = _rows(pod.query(f"SELECT * FROM {src_activity} WHERE task_id IN ({_in(ids)}) ORDER BY created_at"))
    if events:
        pod.records.bulk_create(dst_activity, [{k: e.get(k) for k in ACTIVITY if k in e and k != "created_at"} for e in events],
                                upsert=True)
        pod.records.bulk_delete(src_activity, [e["id"] for e in events])
    children = [i for i in ids if i != task["id"]]
    if children:
        pod.records.bulk_delete(src_table, children)
    pod.records.bulk_delete(src_table, [task["id"]])

    body = (f"Moved to {project['name']}." if project else "Shared with the team.") if to == "team" else "Made private."
    pod.records.create(dst_activity, {"task_id": task["id"], "kind": "moved", "actor_kind": "person", "actor_user_id": me,
                                      "actor_name": who, "body": body, "detail": {"to": to, "project_id": (project or {}).get("id")}})
    for run in _rows(pod.query(f"SELECT id FROM tasks_run WHERE id IN ({_in(ids)})")):
        pod.table("tasks_run").update(run["id"], {"scope": to})
    return TasksMoveResult(task_id=task["id"], scope=to, moved=len(family), message=body)
