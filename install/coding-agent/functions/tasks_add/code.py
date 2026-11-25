#input_type_name: TasksAddInput
#output_type_name: TasksAddResult
#function_name: tasks_add

"""Add a task, for the Lemma's own assistant when someone asks it in chat
("add a task: send Grace the signed quote by Friday"), and for anything else
that wants to put work on a person's list.

The task is the person's own and private (`personal_task`) unless a team
project is named, when it goes to the team (`task`) in that project. Handing
it to an agent is `assign_to`: `lemma` is this Lemma's own assistant, or a
named agent's name; the hand-over itself is the usual one (the
`tasks-*-added` schedule). `source` is chat unless the caller says otherwise.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PRIORITIES = ("none", "low", "medium", "high", "urgent")


class TasksAddInput(BaseModel):
    title: str
    notes: str | None = None
    # YYYY-MM-DD, or today / tomorrow.
    due_on: str | None = None
    priority: str | None = None
    # A team project's name (or id). Without one the task is private.
    project: str | None = None
    labels: list[str] = []
    # me, lemma (this Lemma's own assistant), or a named agent's name.
    assign_to: str | None = "me"
    # The sentence it came from, word for word, if any.
    quote: str | None = None
    source: str = "chat"
    source_id: str | None = None
    source_url: str | None = None


class TasksAddResult(BaseModel):
    task_id: str
    scope: str
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


def _today(zone_name: str | None) -> date:
    try:
        zone = ZoneInfo({"Asia/Calcutta": "Asia/Kolkata"}.get(zone_name or "", zone_name or "UTC"))
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("UTC")
    return datetime.now(timezone.utc).astimezone(zone).date()


def tasks_add(ctx: FunctionContext, data: TasksAddInput) -> TasksAddResult:
    pod = ctx.pod
    settings = (_rows(pod.query("SELECT display_name, timezone, agents FROM tasks_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    me = settings.get("display_name") or (ctx.user_email or "").split("@")[0] or None
    title = " ".join((data.title or "").split())[:300]
    if not title:
        raise ValueError("A task needs a title.")

    due = None
    if data.due_on:
        word = data.due_on.strip().lower()
        today = _today(settings.get("timezone"))
        if word == "today":
            due = today.isoformat()
        elif word == "tomorrow":
            due = (today + timedelta(days=1)).isoformat()
        else:
            due = date.fromisoformat(word[:10]).isoformat()

    project = None
    if data.project:
        name = data.project.strip()
        project = (_rows(pod.query(
            f"SELECT id, name FROM project WHERE id::text = {_sql(name)} OR LOWER(name) = LOWER({_sql(name)}) LIMIT 1")) or [None])[0]
        if not project:
            names = [p["name"] for p in _rows(pod.query("SELECT name FROM project WHERE state = 'active' ORDER BY name LIMIT 20"))]
            raise ValueError(f"No team project called {name!r}. Projects: {', '.join(names) or 'none yet'}.")

    who = (data.assign_to or "me").strip()
    row: dict[str, Any] = {
        "title": title, "description": (data.notes or None), "status": "todo",
        "priority": data.priority if data.priority in PRIORITIES else "none", "due_on": due,
        "labels": [str(label)[:40] for label in data.labels][:10], "owner_user_id": str(ctx.user_id) if ctx.user_id else None,
        "owner_name": me, "source": (data.source or "chat")[:32], "source_id": data.source_id, "source_url": data.source_url,
        "quote": (data.quote or None), "assignee_kind": "none",
    }
    if who.lower() in ("lemma", "assistant", "pod_default", "this lemma"):
        row.update({"assignee_kind": "agent", "assignee_agent": "pod_default"})
    elif who.lower() in ("me", "myself", "", "i"):
        row.update({"assignee_kind": "person", "assignee_user_id": str(ctx.user_id) if ctx.user_id else None, "assignee_name": me})
    else:
        row.update({"assignee_kind": "agent", "assignee_agent": who})
    scope = "personal"
    table, activity = "personal_task", "tasks_personal_activity"
    if project:
        scope, table, activity = "team", "task", "tasks_activity"
        row["project_id"] = project["id"]
    created = _dict(pod.records.create(table, row))
    task_id = str(created.get("id") or (created.get("data") or {}).get("id"))
    pod.records.create(activity, {"task_id": task_id, "kind": "created", "actor_kind": "lemma" if row["source"] == "chat" else "person",
                                  "actor_name": "chat" if row["source"] == "chat" else me,
                                  "body": "Added from a conversation with this Lemma." if row["source"] == "chat" else None})
    where = f"the {project['name']} project" if project else "your own list (only you see it)"
    handed = " and handed to " + ("this Lemma" if row.get("assignee_agent") == "pod_default" else row.get("assignee_agent", "")) \
        if row["assignee_kind"] == "agent" else ""
    return TasksAddResult(task_id=task_id, scope=scope, message=f"Added \"{title}\" to {where}{handed}.")
