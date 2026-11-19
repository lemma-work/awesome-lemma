#input_type_name: TasksSetupDoneInput
#output_type_name: TasksSetupDoneResult
#function_name: tasks_setup_done

"""Set-up, last step: keeps what the person chose and opens Tasks.

  promises      auto, ask or never (asked only with Mail or Meetings here;
                never otherwise)
  agents        which agents can take tasks; pod_default is the Lemma's own
                assistant
  capabilities  what this Lemma has, as the app found it (plugins, connected
                accounts, named agents): the evidence for "could an agent do
                this?"

The workflow then catches up: promises made in the last 30 days, and every
open task not yet asked whether an agent could do it.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class TasksSetupDoneInput(BaseModel):
    promises: str | None = None
    agents: list[str] = ["pod_default"]
    capabilities: dict | None = None


class TasksSetupDoneResult(BaseModel):
    promises: str
    agents: list[str]
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def tasks_setup_done(ctx: FunctionContext, data: TasksSetupDoneInput) -> TasksSetupDoneResult:
    pod = ctx.pod
    promises = data.promises if data.promises in ("auto", "ask", "never") else "never"
    agents = list(dict.fromkeys(str(a)[:120] for a in data.agents if a))[:20]
    patch: dict[str, Any] = {"promises": promises, "agents": agents, "setup_step": "done",
                             "setup_done_at": datetime.now(timezone.utc).isoformat()}
    if data.capabilities is not None:
        patch["capabilities"] = data.capabilities
    settings = (_rows(pod.query("SELECT id FROM tasks_settings ORDER BY created_at LIMIT 1")) or [None])[0]
    if settings:
        pod.table("tasks_settings").update(settings["id"], patch)
    else:
        pod.records.create("tasks_settings", patch)
    said = {"auto": "promises you make become tasks", "ask": "you'll be asked about each promise", "never": "promises stay where they are"}
    return TasksSetupDoneResult(promises=promises, agents=agents,
                                message=f"Set up: {said[promises]}; {len(agents)} agent(s) can take tasks.")
