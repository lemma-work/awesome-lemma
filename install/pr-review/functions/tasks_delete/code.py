#input_type_name: TasksDeleteInput
#output_type_name: TasksDeleteResult
#function_name: tasks_delete

"""Delete tasks, with their sub-tasks, timelines and agent runs.

`not_a_task` on a task made from a promise is a correction: keeping that
promise is just a reply. Its decision is marked dismissed and the correction
becomes an example for later promises. The promise itself stays as it is:
it is still a promise (Today still shows it), only not a task.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

TABLES = {"personal": ("personal_task", "tasks_personal_activity"), "team": ("task", "tasks_activity")}


class TasksDeleteInput(BaseModel):
    task_ids: list[str]
    not_a_task: bool = False


class TasksDeleteResult(BaseModel):
    deleted: int
    corrected: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def tasks_delete(ctx: FunctionContext, data: TasksDeleteInput) -> TasksDeleteResult:
    pod = ctx.pod
    ids = [str(i) for i in data.task_ids if i][:200]
    if not ids:
        return TasksDeleteResult(deleted=0, corrected=0, message="Nothing to delete.")
    deleted = corrected = 0
    for scope, (table, activity) in TABLES.items():
        found = _rows(pod.query(f"SELECT id, source, source_id FROM {table} WHERE id IN ({_in(ids)})"))
        if not found:
            continue
        top = [t["id"] for t in found]
        family = top + [c["id"] for c in _rows(pod.query(f"SELECT id FROM {table} WHERE parent_id IN ({_in(top)})"))]
        family = list(dict.fromkeys(family))
        events = [e["id"] for e in _rows(pod.query(f"SELECT id FROM {activity} WHERE task_id IN ({_in(family)})"))]
        if events:
            pod.records.bulk_delete(activity, events)
        runs = [r["id"] for r in _rows(pod.query(f"SELECT id FROM tasks_run WHERE id IN ({_in(family)})"))]
        if runs:
            pod.records.bulk_delete("tasks_run", runs)
        children = [i for i in family if i not in top]
        if children:
            pod.records.bulk_delete(table, children)
        pod.records.bulk_delete(table, top)
        deleted += len(family)

        if data.not_a_task:
            for t in found:
                if t.get("source") != "promise" or not t.get("source_id"):
                    continue
                decision = (_rows(pod.query(f"SELECT * FROM tasks_decision WHERE id = {_sql(t['source_id'])}")) or [None])[0]
                if decision:
                    pod.table("tasks_decision").update(decision["id"], {"state": "dismissed"})
                    pod.records.create("tasks_correction", {"kind": "promise", "subject_id": decision["id"],
                                                            "from_answer": decision.get("answer"), "to_answer": "reply",
                                                            "evidence": (decision.get("evidence") or "")[:1600]})
                    corrected += 1
    message = f"Deleted {deleted} task(s)" + (f"; noted {corrected} promise(s) as just a reply" if corrected else "")
    return TasksDeleteResult(deleted=deleted, corrected=corrected, message=message)
