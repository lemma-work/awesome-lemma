#input_type_name: MeetingsAddNotesInput
#output_type_name: MeetingsAddNotesResult
#function_name: meetings_add_notes

"""Keep notes the person wrote after a meeting as the meeting's document, and
ask the notes reader to read them (notes_state = wanted, which a datastore
trigger turns into a reader run as the owner).

A real meeting's notes go to the person's own files, /me/meetings; a sample
meeting's go beside the sample, so clearing the sample removes them too.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

SAMPLE_ROOT = "/meetings-sample"


class MeetingsAddNotesInput(BaseModel):
    meeting_id: str
    text: str


class MeetingsAddNotesResult(BaseModel):
    document_path: str
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def meetings_add_notes(ctx: FunctionContext, data: MeetingsAddNotesInput) -> MeetingsAddNotesResult:
    pod = ctx.pod
    text = (data.text or "").strip()
    if len(text) < 3:
        raise ValueError("Write a few words first.")
    meeting = pod.table("meeting").get(data.meeting_id)
    cal = (_rows(pod.query(f"SELECT provider FROM meetings_calendar WHERE id = {_sql(meeting.get('source_account'))}")) or [{}])[0]
    settings = (_rows(pod.query("SELECT display_name, timezone FROM meetings_settings LIMIT 1")) or [{}])[0]
    try:
        zone = ZoneInfo(settings.get("timezone") or "UTC")
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("UTC")
    start = datetime.fromisoformat(str(meeting["start_at"]).replace("Z", "+00:00")).astimezone(zone)
    folder = SAMPLE_ROOT if cal.get("provider") == "sample" else "/me/meetings"
    path = f"{folder}/{data.meeting_id}-notes.md"
    who = settings.get("display_name") or "the owner"
    doc = (f"# {meeting.get('title') or 'Meeting'}\n\n{start.strftime('%A %d %B %Y, %H:%M')}\n\n"
           f"## Notes by {who}\n\n{text[:60000]}\n")
    try:
        pod.files.create_folder(folder)
    except Exception:  # noqa: BLE001 — already there
        pass
    pod.files.write_text(path, doc)
    pod.table("meeting").update(data.meeting_id, {"document_path": path})
    pod.table("meetings_work").update(data.meeting_id, {"notes_state": "wanted", "notes_from": "notes", "notes_error": None})
    return MeetingsAddNotesResult(document_path=path, message="Notes kept; reading them for decisions and promises.")
