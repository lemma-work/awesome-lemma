#input_type_name: MeetingsBriefContextInput
#output_type_name: MeetingsBriefContextResult
#function_name: meetings_brief_context

"""What the brief writer needs to write one meeting's brief.

For each person from outside on it (at most six): who they are as far as the
owner's mail knows, their recent conversations with the owner and the newest
words in them, open promises either way (from mail and from earlier meetings),
and earlier meetings with them with what was decided. All of it comes from the
shared tables, so it is there exactly when Mail (or another source) is in the
Lemma; alone, Meetings knows only its own earlier meetings, and the writer
looks up on the web the people nothing here knows.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class MeetingsBriefContextInput(BaseModel):
    meeting_id: str


class MeetingsBriefContextResult(BaseModel):
    meeting: dict
    me: dict
    attendees: list[dict]
    built_from: dict


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def meetings_brief_context(ctx: FunctionContext, data: MeetingsBriefContextInput) -> MeetingsBriefContextResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    meeting = pod.table("meeting").get(data.meeting_id)
    pod.table("meetings_work").update(data.meeting_id, {"brief_state": "writing", "brief_error": None})
    settings = (_rows(pod.query("SELECT display_name, timezone, my_domains FROM meetings_settings LIMIT 1")) or [{}])[0]
    try:
        zone = ZoneInfo(settings.get("timezone") or "UTC")
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("UTC")
    fmt = lambda v: (_parse(v) or now).astimezone(zone).strftime("%a %d %b %Y")  # noqa: E731
    start = _parse(meeting["start_at"]) or now
    end = _parse(meeting.get("end_at"))
    attendees = [a for a in (meeting.get("attendees") or []) if isinstance(a, dict)]
    outside = [a for a in attendees if a.get("outside")][:6]
    if not outside:
        # An internal meeting someone asked a brief for: brief on the people on it.
        outside = [a for a in attendees if not a.get("you")][:6]
    handles = [a["handle"] for a in outside if a.get("handle")]

    if not handles:
        handles = ["nobody@invalid"]
    with ThreadPoolExecutor(max_workers=5) as pool:
        p_job = pool.submit(lambda: _rows(pod.query(
            "SELECT h.handle, p.name, p.org, p.title, p.is_vip, p.conversation_count, p.last_inbound_at, p.last_outbound_at "
            f"FROM person_handle h JOIN person p ON p.id = h.person_id WHERE h.handle IN ({_in(handles)})")))
        c_job = pool.submit(lambda: _rows(pod.query(
            "SELECT id, counterpart_handle, participants, subject, state, ask, last_message_at FROM conversation "
            f"WHERE kind = 'people' AND (counterpart_handle IN ({_in(handles)}) OR "
            + " OR ".join(f"participants::text ILIKE {_sql('%' + h + '%')}" for h in handles[:6])
            + ") ORDER BY last_message_at DESC LIMIT 60")))
        pr_job = pool.submit(lambda: _rows(pod.query(
            "SELECT person_handle, direction, text, quote, due_at, source, created_at FROM promise "
            f"WHERE state = 'open' AND person_handle IN ({_in(handles)}) ORDER BY created_at DESC LIMIT 40")))
        m_job = pool.submit(lambda: _rows(pod.query(
            "SELECT id, title, start_at, kind, summary, attendees FROM meeting "
            f"WHERE id <> {_sql(data.meeting_id)} AND start_at < {_sql(start.isoformat())} AND status <> 'cancelled' AND ("
            + " OR ".join(f"attendees::text ILIKE {_sql('%' + h + '%')}" for h in handles[:6])
            + ") ORDER BY start_at DESC LIMIT 12")))
        people = {r["handle"]: r for r in p_job.result()}
        conversations = c_job.result()
        promises = pr_job.result()
        earlier = m_job.result()

    used_conversations = set()
    newest_words: dict[str, list[dict]] = {}
    top_ids = []
    for h in handles:
        mine = [c for c in conversations if c.get("counterpart_handle") == h or h in str(c.get("participants") or "")][:2]
        top_ids += [c["id"] for c in mine]
    if top_ids:
        for r in _rows(pod.query(
                "SELECT conversation_id, direction, from_name, from_handle, sent_at, snippet FROM message "
                f"WHERE conversation_id IN ({_in(top_ids)}) ORDER BY sent_at DESC LIMIT 40")):
            bucket = newest_words.setdefault(r["conversation_id"], [])
            if len(bucket) < 3:
                bucket.append(r)
    decisions: dict[str, list[str]] = {}
    if earlier:
        for r in _rows(pod.query(
                "SELECT meeting_id, text FROM meetings_decision WHERE state = 'kept' "
                f"AND meeting_id IN ({_in([e['id'] for e in earlier])}) LIMIT 60")):
            decisions.setdefault(r["meeting_id"], []).append(r["text"])

    out = []
    used_meetings = set()
    for a in outside:
        h = a.get("handle") or ""
        person = people.get(h) or {}
        talks = [c for c in conversations if c.get("counterpart_handle") == h or h in str(c.get("participants") or "")][:5]
        before = [e for e in earlier if h in str(e.get("attendees") or "")][:3]
        used_conversations |= {c["id"] for c in talks}
        used_meetings |= {e["id"] for e in before}
        out.append({
            "name": a.get("name") or person.get("name") or h,
            "email": h,
            "org": person.get("org"),
            "title": person.get("title"),
            "vip": bool(person.get("is_vip")),
            "response": a.get("response"),
            "organizer": bool(a.get("organizer")),
            "known_from_mail": bool(talks or person),
            "met_before": bool(before),
            "conversations": [{
                "subject": c.get("subject"), "state": c.get("state"), "they_want": c.get("ask"),
                "last": fmt(c.get("last_message_at")),
                "newest_words": [{"from": "you" if w.get("direction") == "outbound" else (w.get("from_name") or w.get("from_handle")),
                                  "on": fmt(w.get("sent_at")), "text": (w.get("snippet") or "")[:700]}
                                 for w in newest_words.get(c["id"], [])],
            } for c in talks],
            "promises": [{"who": "you owe them" if p.get("direction") == "i_owe" else "they owe you",
                          "what": p.get("text"), "due": fmt(p.get("due_at")) if p.get("due_at") else None,
                          "said": p.get("quote"), "where": p.get("source")}
                         for p in promises if p.get("person_handle") == h][:6],
            "earlier_meetings": [{"title": e.get("title"), "on": fmt(e.get("start_at")), "kind": e.get("kind"),
                                  "what_happened": e.get("summary"), "decided": decisions.get(e["id"], [])[:4]}
                                 for e in before],
        })

    team = [a.get("name") or a.get("handle") for a in attendees if not a.get("outside") and not a.get("you")]
    return MeetingsBriefContextResult(
        meeting={
            "title": meeting.get("title"),
            "kind": meeting.get("kind"),
            "when": start.astimezone(zone).strftime("%A %d %b, %H:%M %Z"),
            "minutes": int((end - start).total_seconds() // 60) if end else None,
            "where": meeting.get("location") or ("video call" if meeting.get("join_url") else None),
            "organizer": meeting.get("organizer_handle"),
            "invitation": (meeting.get("agenda") or "")[:1500] or None,
            "your_team_on_it": team,
            "repeats": bool(meeting.get("series_id")),
        },
        me={"name": settings.get("display_name"), "own_domains": settings.get("my_domains") or [],
            "now_local": now.astimezone(zone).strftime("%A %d %b, %H:%M %Z")},
        attendees=out,
        built_from={"conversation_ids": sorted(used_conversations)[:20], "meeting_ids": sorted(used_meetings)[:20]},
    )
