#input_type_name: MailPeopleInput
#output_type_name: MailPeopleResult
#function_name: mail_people

"""Recompute who the owner deals with.

Counts come from messages in conversations with real people (a broadcast
never makes someone a person you know). A person is found by handle in
`person_handle` (an email address is kind "email"), never by a column on
the person, and created with their handle when new. Weight is volume times reciprocity: someone
the owner writes back to outranks someone who only writes to them.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

NS = uuid.UUID("3f8a1c52-7d0e-4b61-9c2a-5e4f7a9b0d13")
FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com",
            "live.com", "me.com", "proton.me", "protonmail.com", "aol.com"}
AUTOMATED = ("noreply", "no-reply", "donotreply", "do-not-reply", "notifications", "notification",
             "mailer-daemon", "bounce", "alerts", "newsletter", "digest", "billing@", "invoice",
             "receipts", "calendar-notification")


class MailPeopleInput(BaseModel):
    run_pass: int | None = None


class MailPeopleResult(BaseModel):
    people: int
    created: int
    updated: int


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _parse(value: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


def _org(email: str) -> str | None:
    domain = email.rsplit("@", 1)[-1]
    if domain in FREEMAIL:
        return None
    label = domain.split(".")[-2] if domain.count(".") >= 1 else domain
    return " ".join(part.capitalize() for part in label.replace("_", "-").split("-"))


HANDLE_KIND = {"mail": "email"}


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def mail_people(ctx: FunctionContext, data: MailPeopleInput) -> MailPeopleResult:
    """Counts come from the shared `message` table, every source, so a person
    who writes on Slack and by mail is counted once, under one person row,
    once Chat adds their Slack handle to it."""
    pod = ctx.pod
    mine = {r["email"].lower() for r in _rows(pod.query("SELECT email FROM mail_mailbox"))}
    inbound = _rows(pod.query(
        "SELECT m.source, LOWER(m.from_handle) AS handle, MAX(m.from_name) AS name, COUNT(*) AS n, "
        "COUNT(DISTINCT m.conversation_id) AS conversations, MIN(m.sent_at) AS first, MAX(m.sent_at) AS last "
        "FROM message m JOIN conversation c ON c.id = m.conversation_id "
        "WHERE m.direction = 'inbound' AND c.kind = 'people' AND m.from_handle IS NOT NULL "
        "GROUP BY m.source, LOWER(m.from_handle) LIMIT 4000"
    ))
    outbound = _rows(pod.query(
        "SELECT m.source, LOWER(r.value) AS handle, COUNT(*) AS n, COUNT(DISTINCT m.conversation_id) AS conversations, "
        "MIN(m.sent_at) AS first, MAX(m.sent_at) AS last "
        "FROM message m JOIN conversation c ON c.id = m.conversation_id, "
        "jsonb_array_elements_text(m.to_handles::jsonb) AS r(value) "
        "WHERE m.direction = 'outbound' AND c.kind = 'people' GROUP BY m.source, LOWER(r.value) LIMIT 4000"
    ))
    stats: dict[tuple[str, str], dict] = {}
    for row in inbound:
        key = (HANDLE_KIND.get(row["source"], row["source"]), row["handle"])
        stats.setdefault(key, {}).update(
            name=row.get("name"), inbound=int(row["n"]), in_conversations=int(row["conversations"] or 0),
            first=_parse(row.get("first")), last_in=_parse(row.get("last")))
    for row in outbound:
        key = (HANDLE_KIND.get(row["source"], row["source"]), row["handle"])
        entry = stats.setdefault(key, {})
        entry.update(outbound=int(row["n"]), out_conversations=int(row["conversations"] or 0), last_out=_parse(row.get("last")))
        first = _parse(row.get("first"))
        if first and (not entry.get("first") or first < entry["first"]):
            entry["first"] = first

    handles = {(r["kind"], r["handle"]): r for r in _rows(pod.query(
        "SELECT h.kind, h.handle, h.person_id, p.name, p.org FROM person_handle h "
        "JOIN person p ON p.id = h.person_id LIMIT 10000"))}
    # One person can have several handles (an address and a Slack user):
    # their counts are the sum over all of them.
    per: dict[str, dict] = {}
    new_people: list[dict] = []
    new_handles: list[dict] = []
    for (kind, handle), s in stats.items():
        if not handle or (kind == "email" and ("@" not in handle or handle in mine or any(t in handle for t in AUTOMATED))):
            continue
        found = handles.get((kind, handle))
        person_id = found["person_id"] if found else str(uuid.uuid5(NS, f"{ctx.user_id}:{kind}:{handle}"))
        agg = per.setdefault(person_id, {"inbound": 0, "outbound": 0, "conversations": 0, "first": None,
                                         "last_in": None, "last_out": None, "found": found, "name": None, "org": None})
        agg["inbound"] += s.get("inbound", 0)
        agg["outbound"] += s.get("outbound", 0)
        agg["conversations"] += max(s.get("in_conversations", 0), s.get("out_conversations", 0))
        for field, pick in (("first", min), ("last_in", max), ("last_out", max)):
            values = [v for v in (agg[field], s.get(field)) if v]
            agg[field] = pick(values) if values else None
        agg["name"] = agg["name"] or s.get("name")
        if kind == "email":
            agg["org"] = agg["org"] or _org(handle)
        if not found:
            new_handles.append({"id": str(uuid.uuid5(NS, f"{person_id}:{kind}:{handle}")), "person_id": person_id,
                                "kind": kind, "handle": handle, "display_name": (s.get("name") or "")[:200] or None})
    update: list[dict] = []
    for person_id, agg in per.items():
        i, o, count = agg["inbound"], agg["outbound"], agg["conversations"]
        weight = math.log1p(i) + 1.5 * math.log1p(o) + (2.0 if i and o else 0.0)
        touches = [d for d in (agg["last_in"], agg["last_out"]) if d]
        last_touch = max(touches) if touches else None
        cadence = None
        if agg["first"] and last_touch and count > 1:
            cadence = round(max(1.0, (last_touch - agg["first"]).total_seconds() / 86400 / (count - 1)), 1)
        row = {
            "id": person_id,
            "conversation_count": count,
            "inbound_count": i,
            "outbound_count": o,
            "first_seen_at": agg["first"].isoformat() if agg["first"] else None,
            "last_inbound_at": agg["last_in"].isoformat() if agg["last_in"] else None,
            "last_outbound_at": agg["last_out"].isoformat() if agg["last_out"] else None,
            "cadence_days": cadence,
            "weight": round(weight, 3),
        }
        found = agg["found"]
        if found:
            if not found.get("name") and agg["name"]:
                row["name"] = agg["name"][:200]
            if not found.get("org") and agg["org"]:
                row["org"] = agg["org"]
            update.append(row)
        else:
            new_people.append({**row, "name": (agg["name"] or "")[:200] or None, "org": agg["org"], "title": None, "is_vip": False})
    for start in range(0, len(new_people), 100):
        pod.records.bulk_create("person", new_people[start : start + 100], upsert=True)
    for start in range(0, len(new_handles), 100):
        pod.records.bulk_create("person_handle", new_handles[start : start + 100], upsert=True)
    for start in range(0, len(update), 100):
        pod.records.bulk_update("person", update[start : start + 100])
    return MailPeopleResult(people=len(new_people) + len(update), created=len(new_people), updated=len(update))
