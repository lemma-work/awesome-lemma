#input_type_name: MeetingsSaveNotesInput
#output_type_name: MeetingsSaveNotesResult
#function_name: meetings_save_notes

"""Store what the notes reader found in a meeting's transcript or notes.

- A few lines on what happened, on the meeting.
- Each decision, as a `meetings_decision` row.
- Each promise between the owner and someone on the meeting, either way, in
  the shared `promise` table (source "meeting", the meeting's source_id), the
  same table Mail's promises are in, so one list holds what was promised in
  mail and in meetings.

Every decision and promise carries the sentence it came from, and is kept only
when that sentence is in the text word for word (spacing and quote marks
aside); anything else is counted as dropped, never stored. Reading the same
meeting again updates what it found before, matched by sentence, and marks
what it no longer finds dropped (a promise) or dismissed (a decision), so no
row is deleted.
"""

from __future__ import annotations

import re
from datetime import datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class MeetingsSaveNotesInput(BaseModel):
    meeting_id: str
    found: dict = {}


class MeetingsSaveNotesResult(BaseModel):
    decisions: int
    promises: int
    dropped: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _norm(text: str) -> str:
    text = (text or "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = text.replace("—", "-").replace("–", "-")
    return " ".join(text.split()).lower().strip(" .\"'")


def _clip(value: Any, size: int) -> str | None:
    text = " ".join(str(value or "").replace("—", ",").split())
    return text[:size] or None


def _due(value: Any, zone: ZoneInfo) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            day = datetime.fromisoformat(text).date()
            return datetime.combine(day, time(18, 0), zone).astimezone(timezone.utc).isoformat()
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=zone)).astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def meetings_save_notes(ctx: FunctionContext, data: MeetingsSaveNotesInput) -> MeetingsSaveNotesResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    meeting = pod.table("meeting").get(data.meeting_id)
    settings = (_rows(pod.query("SELECT timezone FROM meetings_settings LIMIT 1")) or [{}])[0]
    try:
        zone = ZoneInfo(settings.get("timezone") or "UTC")
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("UTC")
    found = data.found or {}
    text = ""
    if meeting.get("document_path"):
        try:
            text = pod.files.download(meeting["document_path"]).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001 — nothing can be checked, so nothing is kept
            text = ""
    haystack = _norm(text)
    attendees = [a for a in (meeting.get("attendees") or []) if isinstance(a, dict)]
    by_handle = {(a.get("handle") or "").lower(): a for a in attendees}
    by_name = {_norm(a.get("name") or ""): a for a in attendees if a.get("name")}
    others = [a for a in attendees if not a.get("you")]
    default_other = next((a for a in others if a.get("outside")), others[0] if others else {})

    def heard(quote: str) -> bool:
        q = _norm(quote)
        return len(q) >= 8 and q in haystack

    def who(value: Any) -> dict:
        key = str(value or "").strip().lower()
        return by_handle.get(key) or by_name.get(_norm(key)) or {}

    dropped = 0
    # --- decisions --------------------------------------------------------------------
    old_decisions = {_norm(r["quote"]): r for r in _rows(pod.query(
        f"SELECT id, quote, state FROM meetings_decision WHERE meeting_id = {_sql(data.meeting_id)}"))}
    kept_decisions = set()
    decisions = 0
    for d in (found.get("decisions") or [])[:20]:
        if not isinstance(d, dict) or not d.get("text") or not heard(d.get("quote") or ""):
            dropped += 1
            continue
        by = who(d.get("by"))
        row = {"meeting_id": data.meeting_id, "text": _clip(d["text"], 400), "quote": _clip(d["quote"], 600),
               "by_name": by.get("name") or _clip(d.get("by"), 200), "by_handle": by.get("handle"), "state": "kept"}
        key = _norm(d["quote"])
        if key in kept_decisions:
            continue
        kept_decisions.add(key)
        if key in old_decisions:
            pod.table("meetings_decision").update(old_decisions[key]["id"], row)
        else:
            pod.table("meetings_decision").create(row)
        decisions += 1
    for key, r in old_decisions.items():
        if key not in kept_decisions and r.get("state") == "kept":
            pod.table("meetings_decision").update(r["id"], {"state": "dismissed"})

    # --- promises -----------------------------------------------------------------------
    old_promises = {_norm(r.get("quote") or ""): r for r in _rows(pod.query(
        "SELECT id, quote, state FROM promise WHERE source = 'meeting' "
        f"AND source_id = {_sql(meeting['source_id'])}"))}
    kept_promises = set()
    promises = 0
    for p in (found.get("promises") or [])[:30]:
        if not isinstance(p, dict) or p.get("direction") not in ("i_owe", "owed_to_me") or not p.get("text") \
                or not heard(p.get("quote") or ""):
            dropped += 1
            continue
        other = who(p.get("other_person")) or default_other
        if other.get("you"):
            other = default_other
        key = _norm(p["quote"])
        if key in kept_promises:
            continue
        kept_promises.add(key)
        row = {"conversation_id": None, "source": "meeting", "source_id": meeting["source_id"],
               "person_handle": other.get("handle"), "person_name": other.get("name"),
               "direction": p["direction"], "text": _clip(p["text"], 400), "quote": _clip(p["quote"], 600),
               "due_at": _due(p.get("due"), zone)}
        if key in old_promises:
            if old_promises[key].get("state") == "dropped":
                row["state"] = "open"
            pod.table("promise").update(old_promises[key]["id"], row)
        else:
            pod.table("promise").create({**row, "state": "open"})
        promises += 1
    for key, r in old_promises.items():
        if key not in kept_promises and r.get("state") == "open":
            pod.table("promise").update(r["id"], {"state": "dropped"})

    summary = _clip(found.get("summary"), 2000)
    pod.table("meeting").update(data.meeting_id, {"summary": summary, "summarized_at": now})
    pod.table("meetings_work").update(data.meeting_id, {"notes_state": "ready", "notes_error": None, "dropped": dropped})
    parts = [f"{decisions} decision{'s' if decisions != 1 else ''}", f"{promises} promise{'s' if promises != 1 else ''}"]
    if dropped:
        parts.append(f"{dropped} left out (not in the text word for word)")
    return MeetingsSaveNotesResult(decisions=decisions, promises=promises, dropped=dropped,
                                   message=f"{meeting.get('title')}: " + ", ".join(parts))
