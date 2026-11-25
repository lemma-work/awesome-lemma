#input_type_name: TasksReportInput
#output_type_name: TasksReportResult
#function_name: tasks_report

"""How an agent working a task reports on it. The only way it does.

  progress   a short note of what it did or found; the task moves to In
             progress
  question   something only the person can answer; the task waits on them
             until a reply, which the app sends back into the conversation
  approval   before sending or changing anything outside the Lemma: what,
             to whom, the full text. The task waits on them; Approve or
             Decline is sent back into the conversation
  result     the finished work, in full; the task is Done (and a task made
             from a promise closes that promise)
  failed     it cannot go on; the task waits on the person

Runs as the person the agent works for (it handed the task over), so a
personal task's timeline stays theirs. The first report also keeps the
conversation on the task when the hand-over could not read it yet.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

TABLES = {"personal": ("personal_task", "tasks_personal_activity"), "team": ("task", "tasks_activity")}
KINDS = {
    # kind -> (activity kind, activity state, run state, task status or None to leave it)
    "progress": ("comment", None, "working", None),
    "question": ("question", "pending", "waiting", "waiting"),
    "approval": ("approval", "pending", "waiting", "waiting"),
    "result": ("result", None, "done", "done"),
    "failed": ("comment", None, "failed", "waiting"),
}
NEXT = {
    "progress": "Noted on the task. Keep going; end this turn with a question, an approval or a result.",
    "question": "Asked on the task. Stop now: the person's reply will come back to you here.",
    "approval": "Asked for approval on the task. Stop now and do nothing outside the Lemma until a reply says it is approved.",
    "result": "The result is on the task and the task is done. You can stop.",
    "failed": "The person will see that you could not go on. Stop now.",
}


class TasksReportInput(BaseModel):
    task_id: str
    # progress, question, approval, result, failed
    kind: str = "progress"
    # Markdown: the note, the question, the work, or for an approval what you
    # would do and why.
    body: str
    # approval: what you would do (send an email, post, book, ...), to whom,
    # and the full text that would go out.
    action: str | None = None
    to: str | None = None
    text: str | None = None
    # Paths of files you made, under /tasks/<task id>/.
    files: list[str] = []


class TasksReportResult(BaseModel):
    ok: bool
    status: str | None = None
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


def _conversation_of(pod, run: dict) -> str | None:
    """The conversation the tasks-agent run opened, when it was not kept yet."""
    if run.get("conversation_id") or not run.get("workflow_run_id"):
        return run.get("conversation_id")
    try:
        got = _dict(pod.workflows.run_get(run["workflow_run_id"]))
    except Exception:  # noqa: BLE001
        return None
    wait = got.get("active_wait") or {}
    if wait.get("wait_type") == "AGENT" and wait.get("external_ref"):
        return str(wait["external_ref"])
    for step in got.get("step_history") or []:
        if step.get("node_id") == "work" and step.get("external_ref"):
            return str(step["external_ref"])
    return None


def tasks_report(ctx: FunctionContext, data: TasksReportInput) -> TasksReportResult:
    pod = ctx.pod
    kind = data.kind if data.kind in KINDS else "progress"
    found = None
    for scope, (table, activity) in TABLES.items():
        rows = _rows(pod.query(f"SELECT * FROM {table} WHERE id = {_sql(data.task_id)}"))
        if rows:
            found = (scope, table, activity, rows[0])
            break
    if not found:
        return TasksReportResult(ok=False, message="No task with that task_id is visible to you. Check the id in your brief.")
    scope, table, activity, task = found
    now = datetime.now(timezone.utc).isoformat()
    run = (_rows(pod.query(f"SELECT * FROM tasks_run WHERE id = {_sql(task['id'])}")) or [None])[0]
    agent = (run or {}).get("agent") or task.get("assignee_agent") or "agent"

    act_kind, act_state, run_state, status = KINDS[kind]
    detail: dict[str, Any] = {}
    if data.files:
        detail["files"] = [str(f)[:500] for f in data.files[:20]]
    if kind == "approval":
        detail.update({"action": (data.action or "")[:300], "to": (data.to or "")[:300], "text": (data.text or "")[:12000]})
    if kind == "failed":
        detail["failed"] = True
    pod.records.create(activity, {"task_id": task["id"], "kind": act_kind, "actor_kind": "agent", "actor_name": agent,
                                  "body": (data.body or "")[:20000], "detail": detail or None, "state": act_state})

    patch: dict[str, Any] = {}
    if status and task.get("status") != status:
        patch["status"] = status
    elif kind == "progress" and task.get("status") == "todo":
        patch["status"] = "in_progress"
    if patch.get("status") == "done":
        patch["done_at"] = now
    if patch:
        pod.table(table).update(task["id"], patch)
        pod.records.create(activity, {"task_id": task["id"], "kind": "status", "actor_kind": "agent", "actor_name": agent,
                                      "detail": {"from": task.get("status"), "to": patch["status"]}})
    if patch.get("status") == "done" and task.get("source") == "promise" and task.get("source_id"):
        try:
            pod.table("promise").update(task["source_id"], {"state": "done"})
        except Exception:  # noqa: BLE001 — the promise may be gone, or someone else's
            pass

    if run:
        run_patch: dict[str, Any] = {"state": run_state, "last_report_at": now}
        conv = _conversation_of(pod, run)
        if conv and conv != run.get("conversation_id"):
            run_patch["conversation_id"] = conv
        pod.table("tasks_run").update(task["id"], run_patch)
    if kind in ("question", "approval", "result", "failed"):
        # What needs the person changed: refresh their needs_you items.
        try:
            pod.functions.run("tasks_needs_you", {})
        except Exception:  # noqa: BLE001 — the report stands; the next refresh catches up
            pass
    return TasksReportResult(ok=True, status=patch.get("status") or task.get("status"), message=NEXT[kind])
