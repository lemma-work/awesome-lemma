#input_type_name: MeetingsNotesContextInput
#output_type_name: MeetingsNotesContextResult
#function_name: meetings_notes_context

"""A meeting's transcript or the owner's notes, with who was there, for the
notes reader."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

MAX_CHARS = 60_000


class MeetingsNotesContextInput(BaseModel):
    meeting_id: str


class MeetingsNotesContextResult(BaseModel):
    meeting: dict
    me: dict
    people: list[dict]
    kind: str
    text: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def meetings_notes_context(ctx: FunctionContext, data: MeetingsNotesContextInput) -> MeetingsNotesContextResult:
    pod = ctx.pod
    meeting = pod.table("meeting").get(data.meeting_id)
    work = pod.table("meetings_work").get(data.meeting_id) or {}
    pod.table("meetings_work").update(data.meeting_id, {"notes_state": "reading", "notes_error": None})
    settings = (_rows(pod.query("SELECT display_name, timezone FROM meetings_settings LIMIT 1")) or [{}])[0]
    try:
        zone = ZoneInfo(settings.get("timezone") or "UTC")
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("UTC")
    path = meeting.get("document_path")
    if not path:
        raise ValueError("This meeting has no transcript or notes yet.")
    text = pod.files.download(path).decode("utf-8", "replace")
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + "\n[cut]"
    start = datetime.fromisoformat(str(meeting["start_at"]).replace("Z", "+00:00")).astimezone(zone)
    now = datetime.now(timezone.utc).astimezone(zone)
    attendees = [a for a in (meeting.get("attendees") or []) if isinstance(a, dict)]
    from_ = (work.get("notes_from") if isinstance(work, dict) else None) or ""
    return MeetingsNotesContextResult(
        meeting={"title": meeting.get("title"), "date": start.strftime("%A %d %B %Y"),
                 "started": start.isoformat(), "kind": meeting.get("kind")},
        me={"name": settings.get("display_name") or "the owner", "now_local": now.strftime("%A %d %B %Y, %H:%M %Z"),
            "utc_offset": start.strftime("%z")},
        people=[{"name": a.get("name") or a.get("handle"), "email": a.get("handle"), "is_owner": bool(a.get("you")),
                 "from_outside": bool(a.get("outside"))} for a in attendees],
        kind="notes" if from_ == "notes" or "## Notes by" in text[:600] else "transcript",
        text=text,
    )
