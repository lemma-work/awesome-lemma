#input_type_name: InterviewsOnMeetingInput
#output_type_name: InterviewsOnMeetingResult
#function_name: interviews_on_meeting

"""One of the member's meetings, new or with a document: the target of each
member's own triggers on `meeting` (made by the app as them, rows
OWNER_READABLE), so it runs as the meeting's owner and reads only their own.

Booking: an attendee's handle is a person invited in a running study, and the
call starts after the invite went: the person is booked, with the call's
times and link. A booking through the member's page and an ordinary calendar
invite count the same; the handle is all that matters, and on a booking page
it is an address the visitor confirmed.

Document: Meetings kept the call's transcript or the member's notes
(`document_path`) for a booked person's meeting. The person's call is done,
`read_state` goes to waiting, and the read starts (the `interviews-read`
workflow, as the member). A cancelled meeting puts a booked person back to
invited.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# interviews:common
# Shared by every User interviews function, word for word: bin/common.py
# copies it in. Edit it there, never here.
import hashlib as _hashlib
import json as _json
import re as _re
import time as _time
import uuid as _uuid
from datetime import date as _date, datetime as _datetime, timedelta as _timedelta, timezone as _tz
from zoneinfo import ZoneInfo as _Zone

INTERVIEWS_NS = _uuid.UUID("119b800c-47d6-43fe-9576-6e281b149300")
FEEDBACK_NS = _uuid.UUID("19126ba2-6613-4244-a0c9-bb395b202890")
COMPANY_NS = _uuid.UUID("c6fc6ea2-4356-443e-8065-e1d71b8f6359")
SETTINGS_ID = str(_uuid.uuid5(INTERVIEWS_NS, "settings"))
PLUGIN = "user-interviews"
APP = "interviews"
# A person who asked never to hear from us again rests until then.
NEVER = "2100-01-01T00:00:00+00:00"
ZONE_ALIASES = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv",
                "US/Eastern": "America/New_York", "US/Pacific": "America/Los_Angeles"}
FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "me.com",
            "proton.me", "protonmail.com", "aol.com"}
# Stages before an invite went out: the contact rules can still hold them back.
NOT_SENT = ("fits", "drafted")


def rid(*parts) -> str:
    """A stable id from its parts."""
    return str(_uuid.uuid5(INTERVIEWS_NS, ":".join(str(p) for p in parts)))


def person_row_id(study_id, handle_kind, handle) -> str:
    return str(_uuid.uuid5(INTERVIEWS_NS, f"{study_id}:{handle_kind}:{str(handle).strip().lower()}"))


def quote_key(quote) -> str:
    """The contract's quote key: sha1 of the quote lowercased, whitespace collapsed, first 16 hex."""
    return _hashlib.sha1(" ".join(str(quote or "").lower().split()).encode("utf-8")).hexdigest()[:16]


def feedback_row_id(source, source_id, quote) -> str:
    """The contract's id for a `feedback` row (_contract/tables/feedback.json)."""
    return str(_uuid.uuid5(FEEDBACK_NS, f"{source}:{source_id}|{quote_key(quote)}"))


def rows(response) -> list:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def q(pod, sql: str) -> list:
    return rows(pod.query(sql))


def q_all(pod, sql: str, page: int = 1000, most: int = 20000) -> list:
    """Every row of a read, a page at a time (a read answers at most 1000)."""
    out: list = []
    while len(out) < most:
        got = q(pod, f"{sql} LIMIT {page} OFFSET {len(out)}")
        out += got
        if len(got) < page:
            break
    return out


def lit(value) -> str:
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def lits(values) -> str:
    return ", ".join(lit(v) for v in values) or "NULL"


def as_dict(obj) -> dict:
    if obj is None:
        return {}
    if hasattr(obj, "to_dict"):
        obj = obj.to_dict()
    return obj if isinstance(obj, dict) else {}


def jl(value, default=None):
    """A JSON column as Python, whether the API handed back text or JSON."""
    if value is None or value == "":
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return _json.loads(value)
    except (TypeError, ValueError):
        return default


def now_utc() -> _datetime:
    return _datetime.now(_tz.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def stamp(value):
    if not value:
        return None
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def zone(name) -> _Zone:
    try:
        return _Zone(ZONE_ALIASES.get(str(name or ""), str(name or "UTC")))
    except Exception:  # noqa: BLE001 - an unknown zone reads as UTC
        return _Zone("UTC")


def day_said(value, tz="UTC") -> str:
    """26 Nov (and the year when it isn't this one)."""
    moment = stamp(value)
    if not moment:
        return ""
    local = moment.astimezone(zone(tz))
    text = f"{local.day} {local.strftime('%b')}"
    return text if local.year == now_utc().astimezone(zone(tz)).year else f"{text} {local.year}"


def clip(value, n: int):
    text = " ".join(str(value if value is not None else "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "\u2026"


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def first_name(name, handle=None) -> str:
    text = str(name or "").strip()
    if text:
        return text.split()[0]
    return str(handle or "someone").split("@")[0]


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM interviews_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM interviews_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["invite_gap_days"] = int(s.get("invite_gap_days") or 30)
    s["no_show_days"] = int(s.get("no_show_days") or 90)
    s["nudge_days"] = int(s.get("nudge_days") or 4)
    return s


def fn(pod, name: str, payload: dict) -> dict:
    """Run another function of this Lemma (as the same person); its output."""
    return as_dict(as_dict(pod.functions.run(name, payload)).get("output_data"))


def start_read(pod, person_id: str) -> None:
    """Read one call for findings: the interviews-read workflow, as the person running this."""
    pod.workflows.run("interviews-read", about=("interviews_person", person_id))


def rest_for(row: dict, others: list, s: dict, now=None):
    """Whether the contact rules hold this person back in this study, and why.

    `others` are every study's rows for the same handle. Never after they
    opted out (anywhere); not for no_show_days after a no-show; not within
    invite_gap_days of an invite sent from another study. A person's
    override lets them through the last two, never the first."""
    now = now or now_utc()
    if row.get("stage") not in NOT_SENT:
        return None, None
    out = [o for o in others if o.get("stage") == "opted_out"]
    if out:
        return NEVER, "Asked not to be invited again"
    override = stamp(row.get("override_at"))
    found = []
    for o in others:
        if o.get("id") == row.get("id"):
            continue
        missed = stamp(o.get("no_show_at"))
        if missed and (not override or override < missed):
            until = missed + _timedelta(days=s["no_show_days"])
            if until > now:
                found.append((until, f"Missed a call on {day_said(missed)}"))
        sent = stamp(o.get("invited_at"))
        if sent and (not override or override < sent):
            until = sent + _timedelta(days=s["invite_gap_days"])
            if until > now:
                found.append((until, f"Invited {day_said(sent)} to another study"))
    if not found:
        return None, None
    until, rule = max(found, key=lambda f: f[0])
    return until.isoformat(), rule


def rest_refresh(pod, s: dict, handles) -> int:
    """Work the contact rules out again for every row of these handles; the rows that changed."""
    handles = sorted({str(h).lower() for h in handles if h})
    changed = 0
    for start in range(0, len(handles), 100):
        got = q_all(pod, "SELECT id, handle, stage, invited_at, no_show_at, override_at, rests_until, rest_rule "
                         f"FROM interviews_person WHERE handle IN ({lits(handles[start:start + 100])}) ORDER BY id")
        by: dict = {}
        for r in got:
            by.setdefault(str(r.get("handle") or "").lower(), []).append(r)
        updates = []
        for group in by.values():
            for r in group:
                until, rule = rest_for(r, group, s)
                if (stamp(until) != stamp(r.get("rests_until"))) or (rule or None) != (r.get("rest_rule") or None):
                    updates.append({"id": r["id"], "rests_until": until, "rest_rule": rule})
        for i in range(0, len(updates), 100):
            pod.records.bulk_update("interviews_person", updates[i:i + 100])
        changed += len(updates)
    return changed


def is_resting(row: dict, now=None) -> bool:
    until = stamp(row.get("rests_until"))
    return bool(until and until > (now or now_utc()) and row.get("stage") in NOT_SENT)


def norm_text(text) -> str:
    """For checking a quote against a document word for word (Meetings' rule):
    spacing, case and quote marks aside."""
    text = str(text or "").replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2014", "-").replace("\u2013", "-")
    return " ".join(text.split()).lower().strip(" .\"'")


TIME_LINE = _re.compile(r"^\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(?:([^:\n]{1,60}):\s*)?(.*)$")


def line_time(line: str):
    """Seconds into the call of a '[m:ss] Speaker: words' line (h:mm:ss past an hour), its speaker and words."""
    m = TIME_LINE.match(line or "")
    if not m:
        return None, None, line
    a, b, c, who, words = m.groups()
    secs = int(a) * 3600 + int(b) * 60 + int(c) if c is not None else int(a) * 60 + int(b)
    return secs, (who or "").strip() or None, words


def mm_ss(secs) -> str:
    if secs is None:
        return ""
    secs = int(secs)
    h, rest = divmod(secs, 3600)
    m, s_ = divmod(rest, 60)
    return f"{h}:{m:02d}:{s_:02d}" if h else f"{m}:{s_:02d}"
# end interviews:common

# interviews:booking
# Owned by interviews_on_meeting; bin/common.py copies it into interviews_daily.
def meeting_kind_of(pod, meeting_id, path) -> str:
    """transcript (Meet's) or notes, from Meetings' own record of where it came from."""
    try:
        work = q(pod, f"SELECT notes_from FROM meetings_work WHERE id = {lit(meeting_id)}")
    except Exception:  # noqa: BLE001 - Meetings' own table; the name decides then
        work = []
    source = (work[0].get("notes_from") if work else None) or ""
    if source == "meet":
        return "transcript"
    if source in ("notes", "sample"):
        return "notes"
    return "notes" if str(path or "").endswith("-notes.md") else "transcript"


def match_meeting(pod, meeting: dict) -> dict:
    """One meeting against the studies' people. {booked, read: person ids or None, said}."""
    out = {"booked": None, "read": None, "said": "Not a study's call."}
    mid = str(meeting.get("id") or "")
    if not mid:
        return out
    linked = q(pod, f"SELECT * FROM interviews_person WHERE meeting_id = {lit(mid)} LIMIT 5")
    if meeting.get("status") == "cancelled":
        for p in linked:
            if p.get("stage") == "booked":
                pod.records.update("interviews_person", p["id"], {
                    "stage": "invited", "meeting_id": None, "call_at": None, "call_end_at": None, "join_url": None})
                out["said"] = f"{p.get('name') or p['handle']}'s call was cancelled; back to invited."
        return out
    start = stamp(meeting.get("start_at"))
    if not linked:
        handles = sorted({str(a.get("handle") or "").strip().lower() for a in (jl(meeting.get("attendees"), []) or [])
                          if isinstance(a, dict) and a.get("handle") and not a.get("you")})
        if not handles:
            return out
        found = q(pod, "SELECT p.* FROM interviews_person p JOIN interviews_study s ON s.id = p.study_id "
                       f"WHERE s.state = 'running' AND p.stage = 'invited' AND p.handle IN ({lits(handles)}) "
                       "ORDER BY p.invited_at DESC LIMIT 20")
        for p in found:
            sent = stamp(p.get("invited_at"))
            if not sent or not start or start <= sent:
                continue
            pod.records.update("interviews_person", p["id"], {
                "stage": "booked", "meeting_id": mid, "call_at": meeting.get("start_at"),
                "call_end_at": meeting.get("end_at"), "join_url": meeting.get("join_url")})
            p.update(stage="booked", meeting_id=mid)
            linked = [p]
            out["booked"] = p["id"]
            out["said"] = f"{p.get('name') or p['handle']} booked a call for {day_said(meeting.get('start_at'))}."
            break
    else:
        for p in linked:
            if (stamp(p.get("call_at")) != start or (p.get("join_url") or None) != (meeting.get("join_url") or None)) \
                    and p.get("stage") == "booked":
                pod.records.update("interviews_person", p["id"], {
                    "call_at": meeting.get("start_at"), "call_end_at": meeting.get("end_at"), "join_url": meeting.get("join_url")})
    path = meeting.get("document_path")
    for p in linked:
        if not path or p.get("stage") not in ("booked", "done", "no_show"):
            continue
        same = p.get("doc_path") == path and p.get("read_state") in ("waiting", "reading", "ready")
        if same:
            continue
        pod.records.update("interviews_person", p["id"], {
            "stage": "done", "read_state": "waiting", "read_error": None, "doc_path": path,
            "doc_kind": meeting_kind_of(pod, mid, path), "no_show_at": None})
        out["read"] = p["id"]
        out["said"] = f"The call with {p.get('name') or p['handle']} has a document; reading it for findings."
    return out
# end interviews:booking


class InterviewsOnMeetingInput(BaseModel):
    meeting_id: str | None = None


class InterviewsOnMeetingResult(BaseModel):
    booked: str | None = None
    read: str | None = None
    message: str


def interviews_on_meeting(ctx: FunctionContext, data: InterviewsOnMeetingInput) -> InterviewsOnMeetingResult:
    pod = ctx.pod
    if not data.meeting_id:
        return InterviewsOnMeetingResult(message="No meeting named.")
    got = q(pod, "SELECT id, start_at, end_at, attendees, status, join_url, document_path, created_at "
                 f"FROM meeting WHERE id = {lit(data.meeting_id)}")
    if not got:
        return InterviewsOnMeetingResult(message="Not one of your meetings.")
    out = match_meeting(pod, got[0])
    if out["read"]:
        try:
            start_read(pod, out["read"])
        except Exception as exc:  # noqa: BLE001 - the daily run starts it again
            pod.records.update("interviews_person", out["read"], {
                "read_state": "failed", "read_error": clip(f"Couldn't start the read: {exc}", 400)})
    return InterviewsOnMeetingResult(booked=out["booked"], read=out["read"], message=out["said"])
