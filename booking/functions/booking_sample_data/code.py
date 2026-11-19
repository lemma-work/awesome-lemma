#input_type_name: BookingSampleDataInput
#output_type_name: BookingSampleDataResult
#function_name: booking_sample_data

"""A made-up visitor booking the person's page, so the page can be seen
working, and tested, without anyone real.

`load` adds one booking request from one sample visitor at a reserved
`.example` address, for an open time on the person's page two working days
out, exactly as the page would add it. The person's own trigger then handles
it like any other: the Decisions read, the live check against Meetings'
sample calendar, the event (added to the sample calendar's fixture, never a
real calendar), the Meetings meeting and its brief. Nothing is sent: the
visitor is at .example and the calendar is the sample.

`clear` removes only what the sample made: its requests and their outcomes,
the events it added to the sample calendar, the meetings and Meetings' rows
for them (corrections, promises), its items in needs_you, and the sample
visitor as a person when nothing else knows them. Meetings' own sample, the
person's page and settings are left as they are.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

SAMPLE_ROOT = "/meetings-sample"
NS = uuid.UUID("e2b7d4a8-1c3f-4a6e-8d95-7f0b2c4e6a31")
VISITOR = {
    "name": "Ines Moreau",
    "email": "ines@brightloop.example",
    "zone": "Europe/Paris",
    "about": ("We're a 40-person logistics software company and our account managers spend too long getting ready "
              "for customer calls. I'd like to see how the briefs work and what setting it up for a team of six takes."),
}


class BookingSampleDataInput(BaseModel):
    mode: str = "load"


class BookingSampleDataResult(BaseModel):
    mode: str
    request_id: str | None = None
    starts_at: str | None = None
    removed: int = 0
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _load(ctx: FunctionContext) -> BookingSampleDataResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    settings = (_rows(pod.query("SELECT page_id, calendars FROM booking_settings LIMIT 1")) or [{}])[0]
    if not settings.get("page_id"):
        return BookingSampleDataResult(mode="load", message="Set up your booking page first.")
    page = (_rows(pod.query(f"SELECT id, slots FROM booking_page WHERE id = {_sql(settings['page_id'])}")) or [{}])[0]
    slots = sorted(page.get("slots") or [])
    if not slots:
        return BookingSampleDataResult(mode="load", message="Your page has no open times to book.")
    # Two days out when it can, so it shows as coming up rather than now.
    later = [s for s in slots if s >= (now + timedelta(days=2)).strftime("%Y-%m-%dT00:00:00Z")]
    starts_at = (later or slots)[0]
    request_id = str(uuid.uuid5(NS, f"{ctx.user_id}:{settings['page_id']}:{starts_at}"))
    if _rows(pod.query(f"SELECT id FROM booking_request WHERE id = {_sql(request_id)}")):
        return BookingSampleDataResult(mode="load", request_id=request_id, starts_at=starts_at,
                                       message="The sample booking is already there.")
    pod.records.create("booking_request", {
        "id": request_id, "page_id": settings["page_id"], "starts_at": starts_at, "name": VISITOR["name"],
        "email": VISITOR["email"], "about": VISITOR["about"], "zone": VISITOR["zone"],
        "ref": f"sample-{request_id[:8]}", "sample": True,
    })
    return BookingSampleDataResult(mode="load", request_id=request_id, starts_at=starts_at,
                                   message=f"{VISITOR['name']} booked {starts_at}; your page is handling it now.")


def _clear(ctx: FunctionContext) -> BookingSampleDataResult:
    pod = ctx.pod
    settings = (_rows(pod.query("SELECT page_id FROM booking_settings LIMIT 1")) or [{}])[0]
    if not settings.get("page_id"):
        return BookingSampleDataResult(mode="clear", message="Nothing to clear.")
    requests = _rows(pod.query(
        "SELECT id, email, meeting_id, event_id, ref FROM booking_request "
        f"WHERE page_id = {_sql(settings['page_id'])} AND sample = TRUE LIMIT 500"))
    ids = [r["id"] for r in requests]
    meetings = [r["meeting_id"] for r in requests if r.get("meeting_id")]
    events = {str(r["event_id"]) for r in requests if r.get("event_id")}
    refs = [r["ref"] for r in requests if r.get("ref")]
    removed = 0

    def drop(table: str, where: str) -> int:
        count = 0
        while True:
            found = [r["id"] for r in _rows(pod.query(f"SELECT id FROM {table} WHERE {where} LIMIT 500"))]
            for start in range(0, len(found), 100):
                pod.records.bulk_delete(table, found[start : start + 100])
            count += len(found)
            if len(found) < 500:
                return count

    if ids:
        removed += drop("needs_you", f"source_plugin = 'booking' AND source_id IN ({_in(ids)})")
        removed += drop("booking_outcome", f"ref IN ({_in(refs)})")
    if meetings:
        sources = [r["source_id"] for r in _rows(pod.query(
            f"SELECT source_id FROM meeting WHERE id IN ({_in(meetings)})"))]
        if sources:
            removed += drop("promise", f"source = 'meeting' AND source_id IN ({_in(sources)})")
        removed += drop("meetings_correction", f"meeting_id IN ({_in(meetings)})")
        removed += drop("meetings_work", f"id IN ({_in(meetings)})")
        removed += drop("meeting", f"id IN ({_in(meetings)})")
    # The events it added to Meetings' sample calendar, and nothing else there.
    for cal in _rows(pod.query("SELECT id FROM meetings_calendar WHERE provider = 'sample'")):
        path = f"{SAMPLE_ROOT}/{cal['id']}.json"
        try:
            fixture = json.loads(pod.files.download(path).decode("utf-8"))
        except Exception:  # noqa: BLE001 — Meetings' clear already removed it
            continue
        kept = [e for e in fixture.get("events") or [] if not e.get("booking_request") and e.get("id") not in events]
        if len(kept) != len(fixture.get("events") or []):
            removed += len(fixture.get("events") or []) - len(kept)
            fixture["events"] = kept
            pod.files.write_text(path, json.dumps(fixture))
    if ids:
        removed += drop("booking_request", f"id IN ({_in(ids)})")
    # The visitor, when nothing else knows them: no other request, no meeting,
    # no conversation or message, no promise.
    for email in sorted({str(r.get("email") or "").lower() for r in requests if r.get("email")}):
        if _rows(pod.query(f"SELECT id FROM booking_request WHERE lower(email) = {_sql(email)} LIMIT 1")):
            continue
        if _rows(pod.query(f"SELECT id FROM meeting WHERE attendees::text ILIKE {_sql('%' + email + '%')} LIMIT 1")):
            continue
        handles = _rows(pod.query(
            f"SELECT id, person_id FROM person_handle WHERE kind = 'email' AND handle = {_sql(email)}"))
        for h in handles:
            pid = h["person_id"]
            others = _rows(pod.query(
                f"SELECT id FROM person_handle WHERE person_id = {_sql(pid)} AND id <> {_sql(h['id'])} LIMIT 1"))
            talked = _rows(pod.query(f"SELECT id FROM message WHERE from_handle = {_sql(email)} LIMIT 1"))
            promised = _rows(pod.query(f"SELECT id FROM promise WHERE person_handle = {_sql(email)} LIMIT 1"))
            pod.records.bulk_delete("person_handle", [h["id"]])
            removed += 1
            if not others and not talked and not promised:
                pod.records.bulk_delete("person", [pid])
                removed += 1
    return BookingSampleDataResult(mode="clear", removed=removed,
                                   message=f"Removed {removed} rows the sample booking made.")


def booking_sample_data(ctx: FunctionContext, data: BookingSampleDataInput) -> BookingSampleDataResult:
    if data.mode == "clear":
        return _clear(ctx)
    return _load(ctx)
