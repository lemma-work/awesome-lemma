#input_type_name: TasksSetupScopeInput
#output_type_name: TasksSetupScopeResult
#function_name: tasks_setup_scope

"""Set-up, step 1: just you, or your team too.

Keeps the answer (and the person's name and zone, for "due today") on their
`tasks_settings`. With the team, makes their first team project when they
named one; a project of that name already there is used as it is.
`has_promises` is what the app found (Mail or Meetings in this Lemma) and is
handed back for the workflow's next turn: the promises question is asked
only then.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class TasksSetupScopeInput(BaseModel):
    scope: str = "me"
    project_name: str | None = None
    display_name: str | None = None
    timezone: str | None = None
    has_promises: bool = False


class TasksSetupScopeResult(BaseModel):
    scope: str
    project_id: str | None = None
    has_promises: bool
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _dict(obj: Any) -> dict:
    if obj is None:
        return {}
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return dict(obj) if isinstance(obj, dict) else {}


def tasks_setup_scope(ctx: FunctionContext, data: TasksSetupScopeInput) -> TasksSetupScopeResult:
    pod = ctx.pod
    scope = "team" if data.scope == "team" else "me"
    patch: dict[str, Any] = {"scope": scope}
    if data.display_name:
        patch["display_name"] = data.display_name[:200]
    if data.timezone:
        patch["timezone"] = data.timezone[:64]
    settings = (_rows(pod.query("SELECT id FROM tasks_settings ORDER BY created_at LIMIT 1")) or [None])[0]
    if settings:
        pod.table("tasks_settings").update(settings["id"], patch)
    else:
        pod.records.create("tasks_settings", patch)

    project_id = None
    name = " ".join((data.project_name or "").split())[:200]
    if scope == "team" and name:
        found = (_rows(pod.query(f"SELECT id FROM project WHERE LOWER(name) = LOWER({_sql(name)}) LIMIT 1")) or [None])[0]
        if found:
            project_id = found["id"]
        else:
            made = _dict(pod.records.create("project", {"name": name, "state": "active", "source": "tasks",
                                                        "lead_user_id": str(ctx.user_id) if ctx.user_id else None,
                                                        "lead_name": data.display_name or None}))
            project_id = made.get("id") or (made.get("data") or {}).get("id")
    message = "Just you." if scope == "me" else ("Your team too" + (f", starting with {name}." if name else "."))
    return TasksSetupScopeResult(scope=scope, project_id=project_id, has_promises=bool(data.has_promises), message=message)
