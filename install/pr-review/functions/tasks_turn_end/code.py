#input_type_name: TasksTurnEndInput
#output_type_name: TasksTurnEndResult
#function_name: tasks_turn_end

"""The Lemma's assistant ended its first turn on a task (the `tasks-agent`
workflow's last step).

Keeps the conversation on the task if no report did. If the turn ended
without a question, an approval or a result (the run is still "working"), the
person is told on the task, which then waits on them: a reply sends it back
to work. Later turns (after a reply) are not watched by a workflow; the agent
reports on its own, and the app shows how long it has been quiet.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

TABLES = {"personal": ("personal_task", "tasks_personal_activity"), "team": ("task", "tasks_activity")}


class TasksTurnEndInput(BaseModel):
    task_id: str
    answer: str | None = None


class TasksTurnEndResult(BaseModel):
    state: str | None = None
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


def tasks_turn_end(ctx: FunctionContext, data: TasksTurnEndInput) -> TasksTurnEndResult:
    pod = ctx.pod
    run = (_rows(pod.query(f"SELECT * FROM tasks_run WHERE id = {_sql(data.task_id)}")) or [None])[0]
    if not run:
        return TasksTurnEndResult(message="No run for this task.")
    patch: dict[str, Any] = {"turns": int(run.get("turns") or 0) + 1}
    if not run.get("conversation_id") and run.get("workflow_run_id"):
        try:
            got = _dict(pod.workflows.run_get(run["workflow_run_id"]))
            for step in got.get("step_history") or []:
                if step.get("node_id") == "work" and step.get("external_ref"):
                    patch["conversation_id"] = str(step["external_ref"])
        except Exception:  # noqa: BLE001
            pass
    state = run.get("state")
    if state in ("starting", "working"):
        scope = run.get("scope") if run.get("scope") in TABLES else "personal"
        table, activity = TABLES[scope]
        task = (_rows(pod.query(f"SELECT id, status FROM {table} WHERE id = {_sql(data.task_id)}")) or [None])[0]
        patch.update({"state": "waiting", "last_report_at": datetime.now(timezone.utc).isoformat()})
        if task:
            said = " ".join(str(data.answer or "").split())[:1500]
            body = "Stopped without a result or a question." + (f" Its last words: {said}" if said else "") + \
                   " Reply to send it back to work."
            pod.records.create(activity, {"task_id": task["id"], "kind": "stopped", "actor_kind": "lemma",
                                          "actor_name": run.get("agent"), "body": body})
            if task.get("status") not in ("done", "canceled", "waiting"):
                pod.table(table).update(task["id"], {"status": "waiting"})
        state = "waiting"
    pod.table("tasks_run").update(data.task_id, patch)
    return TasksTurnEndResult(state=state, message=f"Turn ended; the run is {state}.")
