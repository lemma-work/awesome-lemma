#input_type_name: MeetingsSaveBriefInput
#output_type_name: MeetingsSaveBriefResult
#function_name: meetings_save_brief

"""Store the brief writer's brief and headline beside the meeting, and note
who it looked up on the web and what it drew on."""

from __future__ import annotations

from datetime import datetime, timezone

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class MeetingsSaveBriefInput(BaseModel):
    meeting_id: str
    brief: dict = {}
    built_from: dict = {}


class MeetingsSaveBriefResult(BaseModel):
    ok: bool
    message: str


def _clean(text: str) -> str:
    return text.replace("—", ", ").replace("–", "-").strip()


def _blocks(text: str) -> str:
    """A blank line wherever a list starts or ends, so every reader of the
    shared column (this app, Today) sees the bullets as a list."""
    out: list[str] = []
    for line in text.splitlines():
        bullet = line.lstrip().startswith(("- ", "* ", "• "))
        if out and out[-1].strip() and bullet != out[-1].lstrip().startswith(("- ", "* ", "• ")):
            out.append("")
        out.append(line.rstrip())
    return "\n".join(out).strip()


def meetings_save_brief(ctx: FunctionContext, data: MeetingsSaveBriefInput) -> MeetingsSaveBriefResult:
    pod = ctx.pod
    text = _blocks(_clean(str(data.brief.get("brief") or "")))
    if not text:
        pod.table("meetings_work").update(data.meeting_id, {"brief_state": "failed",
                                                            "brief_error": "The writer returned nothing. Try again."})
        return MeetingsSaveBriefResult(ok=False, message="The brief writer returned nothing.")
    headline = _clean(str(data.brief.get("headline") or ""))[:300] or None
    searched = [str(s)[:200] for s in (data.brief.get("searched") or []) if s][:12]
    pod.table("meeting").update(data.meeting_id, {"brief": text[:20000], "headline": headline,
                                                  "brief_at": datetime.now(timezone.utc).isoformat()})
    pod.table("meetings_work").update(data.meeting_id, {"brief_state": "ready", "brief_error": None,
                                                        "searched": searched, "built_from": data.built_from or {}})
    meeting = pod.table("meeting").get(data.meeting_id)
    return MeetingsSaveBriefResult(ok=True, message=f"Brief ready for {meeting.get('title')}")
