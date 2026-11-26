#input_type_name: MeetingsSetupDoneInput
#output_type_name: MeetingsSetupDoneResult
#function_name: meetings_setup_done

"""Set-up's last answers: when a brief is wanted (the evening before, or an
hour before) and where what was said comes from after a meeting (Google Meet's
transcript, notes the person writes, or nothing). The pass that follows
(`meetings_due`) asks for the first briefs at once.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class MeetingsSetupDoneInput(BaseModel):
    brief_when: str = "evening_before"
    notes_from: str = "notes"
    meet_account_id: str | None = None


class MeetingsSetupDoneResult(BaseModel):
    brief_when: str
    notes_from: str
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def meetings_setup_done(ctx: FunctionContext, data: MeetingsSetupDoneInput) -> MeetingsSetupDoneResult:
    pod = ctx.pod
    if data.brief_when not in ("evening_before", "hour_before"):
        raise ValueError("brief_when is evening_before or hour_before")
    if data.notes_from not in ("meet", "notes", "skip"):
        raise ValueError("notes_from is meet, notes or skip")
    settings = (_rows(pod.query("SELECT id FROM meetings_settings LIMIT 1")) or [None])[0]
    if settings is None:
        raise ValueError("No Meetings settings yet: start the set-up first.")
    notes_from = data.notes_from
    if notes_from == "meet" and not data.meet_account_id:
        sample = _rows(pod.query("SELECT id FROM meetings_calendar WHERE provider = 'sample' LIMIT 1"))
        if not sample:
            raise ValueError("Connect Google Meet first: the form needs its account id.")
    pod.table("meetings_settings").update(settings["id"], {
        "brief_when": data.brief_when, "notes_from": notes_from, "meet_account_id": data.meet_account_id,
        "setup_step": "done", "setup_done_at": datetime.now(timezone.utc).isoformat(),
    })
    when = "the evening before" if data.brief_when == "evening_before" else "an hour before"
    after = {"meet": "read from Google Meet's transcript", "notes": "read from the notes you write",
             "skip": "not written up"}[notes_from]
    return MeetingsSetupDoneResult(brief_when=data.brief_when, notes_from=notes_from,
                                   message=f"Briefs come {when}; meetings are {after}.")
