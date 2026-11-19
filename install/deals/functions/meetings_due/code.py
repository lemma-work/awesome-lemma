#input_type_name: MeetingsDueInput
#output_type_name: MeetingsDueResult
#function_name: meetings_due

"""The regular pass, after every calendar read: briefs that are due, and what
was said in meetings that are over.

Before. A meeting that gets a brief is planned for when the person wants it:
18:00 the evening before (their time), or an hour before. Once that time comes
the brief is asked for (brief_state = wanted, which a datastore trigger turns
into a writer run as the owner). On the first pass after set-up, briefs for
the next two days are asked for at once, so the person sees one straight away.

After. For a meeting that wanted a brief and is over (within a week), what was
said becomes the meeting's document, and the notes reader is asked for:
- the sample calendar: its own transcript;
- Google Meet, when the person chose it: the transcript Meet kept, found by the
  meeting's Meet code (minutes after the end; given up a day later);
- notes: the meeting waits for the person's notes (the app asks).

A writer or reader stuck for a quarter of an hour is marked failed, so the app
offers to try again.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

SAMPLE_ROOT = "/meetings-sample"
FIRST_RUN_AHEAD = timedelta(hours=48)
NOTES_WITHIN = timedelta(days=7)
STUCK = timedelta(minutes=15)
MEET_CODE = re.compile(r"meet\.google\.com/([a-z]{3}-[a-z]{4}-[a-z]{3})", re.I)


class MeetingsDueInput(BaseModel):
    first_run: bool = False
    # Just this meeting's after-part (the app's "look for the transcript").
    meeting_id: str | None = None


class MeetingsDueResult(BaseModel):
    briefs_wanted: int
    briefs_planned: int
    notes_wanted: int
    notes_waiting: int
    transcripts: int
    unstuck: int
    errors: list[str]
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _result(response: Any) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    result = (payload or {}).get("result", payload) or {}
    if isinstance(result, dict) and isinstance(result.get("data"), dict):
        return result["data"]
    return result if isinstance(result, dict) else {}


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _due(start: datetime, brief_when: str, zone: ZoneInfo) -> datetime:
    if brief_when == "hour_before":
        return start - timedelta(hours=1)
    local = start.astimezone(zone)
    return datetime.combine(local.date() - timedelta(days=1), time(18, 0), zone).astimezone(timezone.utc)


def _meet_transcript(pod: Any, meeting: dict, account_id: str, zone: ZoneInfo) -> str | None:
    """The transcript Google Meet kept, as 'Speaker: words' lines, or None.

    Written against Google Meet's REST shapes as the googlemeet connector
    documents them (conference records filtered by the space's meeting code,
    their transcripts, the transcript's entries, the participants' names). Not
    yet seen against a real account: see the README.
    """
    code = MEET_CODE.search(meeting.get("join_url") or "")
    if not code:
        return None
    start = _parse(meeting["start_at"]) or datetime.now(timezone.utc)
    after = (start - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    records = _result(pod.connectors.execute("googlemeet", "GOOGLEMEET_LIST_CONFERENCE_RECORDS", {
        "filter": f'space.meeting_code = "{code.group(1)}" AND start_time >= "{after}"', "page_size": 5,
    }, account_id=account_id))
    found = records.get("conferenceRecords") or records.get("conference_records") or []
    for record in found:
        name = record.get("name") or ""
        record_id = name.split("/")[-1]
        transcripts = _result(pod.connectors.execute("googlemeet", "GOOGLEMEET_GET_TRANSCRIPTS_BY_CONFERENCE_RECORD_ID", {
            "conference_record_id": record_id}, account_id=account_id))
        ready = [t for t in (transcripts.get("transcripts") or [])
                 if str(t.get("state") or "").upper() in ("FILE_GENERATED", "ENDED")]
        if not ready:
            continue
        names: dict[str, str] = {}
        participants = _result(pod.connectors.execute("googlemeet", "GOOGLEMEET_LIST_PARTICIPANTS", {
            "parent": name, "page_size": 100}, account_id=account_id))
        for p in participants.get("participants") or []:
            who = (p.get("signedinUser") or p.get("anonymousUser") or p.get("phoneUser") or {})
            names[p.get("name") or ""] = who.get("displayName") or "Someone"
        lines: list[str] = []
        token = None
        for _ in range(20):
            payload = {"parent": ready[0].get("name"), "page_size": 100}
            if token:
                payload["page_token"] = token
            page = _result(pod.connectors.execute("googlemeet", "GOOGLEMEET_LIST_TRANSCRIPT_ENTRIES", payload,
                                                  account_id=account_id))
            for entry in page.get("transcriptEntries") or page.get("transcript_entries") or []:
                text = " ".join(str(entry.get("text") or "").split())
                if text:
                    lines.append(f"{names.get(entry.get('participant') or '', 'Someone')}: {text}")
            token = page.get("nextPageToken") or page.get("next_page_token")
            if not token:
                break
        if lines:
            return "\n".join(lines)
    return None


def meetings_due(ctx: FunctionContext, data: MeetingsDueInput) -> MeetingsDueResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    settings = (_rows(pod.query(
        "SELECT display_name, timezone, brief_when, notes_from, meet_account_id FROM meetings_settings LIMIT 1")) or [{}])[0]
    try:
        zone = ZoneInfo(settings.get("timezone") or "UTC")
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("UTC")
    brief_when = settings.get("brief_when") or "evening_before"
    notes_from = settings.get("notes_from") or "notes"
    calendars = {c["id"]: c for c in _rows(pod.query("SELECT id, provider, email FROM meetings_calendar"))}
    counts = {"briefs_wanted": 0, "briefs_planned": 0, "notes_wanted": 0, "notes_waiting": 0, "transcripts": 0, "unstuck": 0}
    errors: list[str] = []
    stale = (now - STUCK).isoformat()
    only = f"AND m.id = {_sql(data.meeting_id)} " if data.meeting_id else ""

    # --- stuck writers and readers -------------------------------------------------
    if not data.meeting_id:
        for column, error in (("brief", "brief_error"), ("notes", "notes_error")):
            stuck = _rows(pod.query(
                f"SELECT id FROM meetings_work WHERE {column}_state = '{'writing' if column == 'brief' else 'reading'}' "
                f"AND updated_at < {_sql(stale)} LIMIT 100"))
            if stuck:
                pod.records.bulk_update("meetings_work", [
                    {"id": r["id"], f"{column}_state": "failed", error: "It took too long. Try again."} for r in stuck])
                counts["unstuck"] += len(stuck)

    # --- before: briefs ----------------------------------------------------------------
    updates: list[dict] = []
    if not data.meeting_id:
        for r in _rows(pod.query(
                "SELECT m.id, m.start_at, m.wants_brief, m.status, w.brief_state, w.brief_due_at "
                "FROM meeting m JOIN meetings_work w ON w.id = m.id "
                f"WHERE m.start_at > {_sql(now.isoformat())} AND w.brief_state IN ('none', 'planned') LIMIT 2000")):
            start = _parse(r["start_at"])
            if not start:
                continue
            if r.get("wants_brief") is not True or r.get("status") == "cancelled":
                if r.get("brief_state") == "planned":
                    updates.append({"id": r["id"], "brief_state": "none", "brief_due_at": None})
                continue
            due = _due(start, brief_when, zone)
            if due <= now or (data.first_run and start - now <= FIRST_RUN_AHEAD):
                updates.append({"id": r["id"], "brief_state": "wanted", "brief_due_at": due.isoformat(), "brief_error": None})
                counts["briefs_wanted"] += 1
            elif r.get("brief_state") != "planned" or _parse(r.get("brief_due_at")) != due:
                updates.append({"id": r["id"], "brief_state": "planned", "brief_due_at": due.isoformat()})
                counts["briefs_planned"] += 1
            else:
                counts["briefs_planned"] += 1
    # One write per row: the trigger fires on each row that became wanted.
    for i in range(0, len(updates), 100):
        pod.records.bulk_update("meetings_work", updates[i : i + 100])

    # --- after: what was said ------------------------------------------------------------
    if notes_from == "skip" and not data.meeting_id:
        return MeetingsDueResult(**counts, errors=errors, message=_message(counts))
    ended = _rows(pod.query(
        "SELECT m.id, m.source_account, m.source_id, m.title, m.start_at, m.end_at, m.join_url, m.document_path, "
        "w.notes_state FROM meeting m JOIN meetings_work w ON w.id = m.id "
        f"WHERE m.end_at <= {_sql(now.isoformat())} AND m.end_at >= {_sql((now - NOTES_WITHIN).isoformat())} "
        f"AND m.status <> 'cancelled' {only}"
        + ("" if data.meeting_id else "AND m.wants_brief IS TRUE ")
        + "AND w.notes_state IN ('none', 'waiting', 'failed') ORDER BY m.end_at DESC LIMIT 50"))
    fixtures: dict[str, dict] = {}
    fetched = 0
    for m in ended:
        if m.get("notes_state") == "failed" and not data.meeting_id:
            continue
        cal = calendars.get(m.get("source_account")) or {}
        if m.get("document_path"):
            pod.table("meetings_work").update(m["id"], {"notes_state": "wanted", "notes_error": None})
            counts["notes_wanted"] += 1
            continue
        text, source, error = None, None, None
        if cal.get("provider") == "sample":
            if cal["id"] not in fixtures:
                try:
                    fixtures[cal["id"]] = json.loads(pod.files.download(f"{SAMPLE_ROOT}/{cal['id']}.json").decode("utf-8"))
                except Exception:  # noqa: BLE001 — the sample was cleared
                    fixtures[cal["id"]] = {}
            text = (fixtures[cal["id"]].get("transcripts") or {}).get(m["source_id"])
            source = "sample"
        elif notes_from == "meet" and cal.get("provider") == "google" and settings.get("meet_account_id") and fetched < 5:
            end = _parse(m.get("end_at")) or now
            if now - end >= timedelta(minutes=10):
                fetched += 1
                try:
                    text = _meet_transcript(pod, m, settings["meet_account_id"], zone)
                    source = "meet"
                    if not text and now - end > timedelta(hours=24):
                        error = "Google Meet kept no transcript of this one. Was transcription on?"
                except Exception as exc:  # noqa: BLE001 — try again next pass
                    errors.append(f"{m.get('title')}: {exc}"[:300])
                    error = f"Couldn't read the transcript: {exc}"[:600]
        if text:
            local = (_parse(m["start_at"]) or now).astimezone(zone)
            # A sample meeting's id is the person's own (made from who loaded
            # it), so its document sits right in the sample folder.
            folder = SAMPLE_ROOT if source == "sample" else "/me/meetings"
            path = f"{folder}/{m['id']}.md"
            kind = "Transcript" if source in ("meet", "sample") else "Notes"
            doc = f"# {m.get('title') or 'Meeting'}\n\n{local.strftime('%A %d %B %Y, %H:%M')}\n\n## {kind}\n\n{text.strip()}\n"
            try:
                pod.files.create_folder(folder)
            except Exception:  # noqa: BLE001 — already there
                pass
            pod.files.write_text(path, doc)
            pod.table("meeting").update(m["id"], {"document_path": path})
            pod.table("meetings_work").update(m["id"], {"notes_state": "wanted", "notes_from": source, "notes_error": None})
            counts["notes_wanted"] += 1
            counts["transcripts"] += 1
        elif m.get("notes_state") != "waiting" or error:
            pod.table("meetings_work").update(m["id"], {"notes_state": "waiting", "notes_error": error})
            counts["notes_waiting"] += 1
        else:
            counts["notes_waiting"] += 1
    return MeetingsDueResult(**counts, errors=errors, message=_message(counts))


def _message(counts: dict) -> str:
    parts = []
    if counts["briefs_wanted"]:
        parts.append(f"{counts['briefs_wanted']} brief{'s' if counts['briefs_wanted'] != 1 else ''} being written")
    if counts["briefs_planned"]:
        parts.append(f"{counts['briefs_planned']} planned")
    if counts["notes_wanted"]:
        parts.append(f"{counts['notes_wanted']} meeting{'s' if counts['notes_wanted'] != 1 else ''} being written up")
    if counts["notes_waiting"]:
        parts.append(f"{counts['notes_waiting']} waiting for notes")
    return ", ".join(parts) or "Nothing due."
