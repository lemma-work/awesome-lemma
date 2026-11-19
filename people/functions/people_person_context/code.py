#input_type_name: PeoplePersonContextInput
#output_type_name: PeoplePersonContextResult
#function_name: people_person_context

"""Everything the writer needs to say where things stand with one person, as
numbered sources it must cite: the newest conversations with them (each with
its last few messages) and the meetings with them, newest first. Open
promises either way, remembered facts and what they are to the owner come as
context; a promise names the source it was made in, so a sentence about it
cites that source.

Runs as the person who owns the row, so it reads only their own mail and
meetings. Marks the person `summary_state = writing` so a second trigger does
not start a second run while this one works.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

MAX_CONVERSATIONS = 8
MAX_MEETINGS = 6
MESSAGES_EACH = 3


class PeoplePersonContextInput(BaseModel):
    person_id: str


class PeoplePersonContextResult(BaseModel):
    person: dict
    me: dict
    now_local: str
    sources: list[dict]
    open_promises: list[dict]
    facts: list[str]


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _zone(name: str | None) -> ZoneInfo:
    aliases = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv"}
    try:
        return ZoneInfo(aliases.get(name or "", name or "UTC"))
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def people_person_context(ctx: FunctionContext, data: PeoplePersonContextInput) -> PeoplePersonContextResult:
    pod = ctx.pod
    pid = data.person_id
    pod.table("people_person").update(pid, {"summary_state": "writing", "summary_error": None})
    person = (_rows(pod.query(
        "SELECT p.name, p.org, p.title, pp.kind, pp.warmth, pp.usual_gap_days, pp.last_contact_at, pp.last_contact_dir, "
        "pp.next_meeting_at, pp.handle FROM person p JOIN people_person pp ON pp.id = p.id "
        f"WHERE p.id = {_sql(pid)}")) or [{}])[0]
    handles = sorted({r["handle"].lower() for r in _rows(pod.query(
        f"SELECT handle FROM person_handle WHERE person_id = {_sql(pid)}")) if r.get("handle")}
        | ({person["handle"]} if person.get("handle") else set()))
    settings = (_rows(pod.query("SELECT display_name, timezone FROM people_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    zone = _zone(settings.get("timezone"))

    convs = _rows(pod.query(
        "SELECT DISTINCT c.id, c.subject, c.state, c.ask, c.last_message_at, c.last_direction FROM conversation c, "
        "jsonb_array_elements_text(COALESCE(c.participants, '[]')::jsonb) AS h(v) "
        f"WHERE c.kind = 'people' AND LOWER(h.v) IN ({_in(handles)}) "
        f"ORDER BY c.last_message_at DESC NULLS LAST LIMIT {MAX_CONVERSATIONS}")) if handles else []
    messages: dict[str, list[dict]] = {}
    if convs:
        for m in _rows(pod.query(
                "SELECT conversation_id, direction, from_name, sent_at, snippet FROM ("
                "SELECT conversation_id, direction, from_name, sent_at, snippet, "
                "ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY sent_at DESC) AS n FROM message "
                f"WHERE conversation_id IN ({_in([c['id'] for c in convs])})) x WHERE n <= {MESSAGES_EACH} "
                "ORDER BY sent_at")):
            messages.setdefault(m["conversation_id"], []).append(m)
    contains = " OR ".join(f"attendees::jsonb @> {_sql(json.dumps([{'handle': h}]))}" for h in handles)
    meetings = _rows(pod.query(
        "SELECT id, source_id, title, start_at, kind, headline, summary FROM meeting "
        f"WHERE status <> 'cancelled' AND ({contains}) ORDER BY start_at DESC LIMIT {MAX_MEETINGS}")) if handles else []
    promises = _rows(pod.query(
        "SELECT conversation_id, source, source_id, direction, text, quote, due_at FROM promise "
        f"WHERE state = 'open' AND LOWER(person_handle) IN ({_in(handles)}) ORDER BY due_at NULLS LAST LIMIT 12")) if handles else []
    facts = [r["fact"] for r in _rows(pod.query(
        f"SELECT fact FROM people_fact WHERE person_id = {_sql(pid)} AND state = 'active' ORDER BY created_at DESC LIMIT 12"))]

    def local(value: Any) -> str | None:
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(zone).strftime("%a %d %b %Y, %H:%M")
        except (TypeError, ValueError):
            return None

    sources: list[dict] = []
    n_of: dict[str, int] = {}
    for c in convs:
        n = len(sources) + 1
        n_of[c["id"]] = n
        sources.append({
            "n": n, "kind": "conversation", "id": c["id"], "label": c.get("subject") or "(no subject)",
            "at": c.get("last_message_at"), "when": local(c.get("last_message_at")),
            "waiting_on": {"needs_reply": "the owner", "waiting": "them"}.get(c.get("state") or ""),
            "ask": c.get("ask"),
            "messages": [{"from": "the owner" if m.get("direction") == "outbound" else (m.get("from_name") or "them"),
                          "when": local(m.get("sent_at")),
                          "text": " ".join(str(m.get("snippet") or "").split())[:700]}
                         for m in messages.get(c["id"], [])],
        })
    now = datetime.now(timezone.utc)
    for m in meetings:
        n = len(sources) + 1
        n_of[f"meeting:{m.get('source_id')}"] = n
        ahead = False
        try:
            ahead = datetime.fromisoformat(str(m["start_at"]).replace("Z", "+00:00")) > now
        except (KeyError, ValueError):
            pass
        sources.append({
            "n": n, "kind": "meeting", "id": m["id"], "label": m.get("title") or "Meeting", "at": m.get("start_at"),
            "when": local(m.get("start_at")), "ahead": ahead, "meeting_kind": m.get("kind"),
            "headline": m.get("headline"), "written_up": m.get("summary"),
        })
    open_promises = [{
        "direction": "the owner owes them" if p.get("direction") == "i_owe" else "they owe the owner",
        "text": p.get("text"), "quote": p.get("quote"), "due": local(p.get("due_at")),
        "source_n": n_of.get(str(p.get("conversation_id"))) or n_of.get(f"meeting:{p.get('source_id')}"),
    } for p in promises]
    return PeoplePersonContextResult(
        person={"name": person.get("name"), "org": person.get("org"), "title": person.get("title"),
                "relationship": person.get("kind"), "warmth": person.get("warmth"),
                "usual_gap_days": person.get("usual_gap_days"), "last_contact": local(person.get("last_contact_at")),
                "last_contact_was": {"inbound": "they wrote", "outbound": "the owner wrote", "meeting": "a meeting"}.get(
                    person.get("last_contact_dir") or ""),
                "next_meeting": local(person.get("next_meeting_at")), "addresses": handles},
        me={"name": settings.get("display_name"), "timezone": str(zone)},
        now_local=now.astimezone(zone).strftime("%A %d %B %Y, %H:%M %Z"),
        sources=sources, open_promises=open_promises, facts=facts)
