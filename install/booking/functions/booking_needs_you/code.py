#input_type_name: BookingNeedsYouInput
#output_type_name: BookingNeedsYouResult
#function_name: booking_needs_you

"""What the person's booking page needs of them, in the shared `needs_you`
list that Today reads.

    attend   each booking still ahead: the call, from its start to its end,
             with Meetings' brief when it is written. Opens the booking.
    decide   a booking the Decisions read was not sure of (genuine, or what
             kind of meeting), until the person settles it. Opens the booking.

Runs as the person, after each booking and on their 15-minute refresh; items
for bookings that are over, declined or settled are closed by the source.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PLUGIN = "booking"
APP = "booking"
KIND_WORD = {"customer": "a customer", "investor": "an investor", "candidate": "a candidate",
             "partner": "a partner", "internal": "your own team", "other": "something else"}


class BookingNeedsYouInput(BaseModel):
    pass


class BookingNeedsYouResult(BaseModel):
    attend: int
    decide: int
    written: dict
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


# contract:needs-you
# The one way to write `needs_you` (see _contract/README.md). Copied verbatim
# into every writer between these markers; _contract/lint.py fails on any
# difference. Needs a grant on needs_you (read and write).
import uuid as _ny_uuid
from datetime import datetime as _ny_datetime, timezone as _ny_timezone

NEEDS_YOU_NS = _ny_uuid.UUID("6b1d9a2e-4c37-4f0a-9e58-2d7c1b3f8a65")


def needs_you_id(plugin: str, table: str, source_id: str, verb: str, member: str) -> str:
    """The item's id: one per (plugin, source table, source row, verb, member)."""
    return str(_ny_uuid.uuid5(NEEDS_YOU_NS, f"{plugin}/{table}/{source_id}/{verb}/{member}"))


def needs_you_write(pod, plugin: str, member: str, items: list, scope_where: str | None = None) -> dict:
    """Write what needs the member now, from one plugin, and resolve the rest.

    `items` are the plugin's current items within the scope, each with verb,
    title, source_table, source_id and source_version, and any other column.
    `scope_where` is a SQL condition on needs_you naming what this pass looked
    at (e.g. "conversation_id IN (...)"); None means everything of this plugin.

    - new: created open.
    - open or snoozed: updated in place (a snooze holds until it ends).
    - dismissed, or done by the person: left alone, unless source_version
      changed, when it opens again.
    - done by the source (resolved before): opens again.
    - open or snoozed items in scope that are no longer current: done, closed
      by the source.
    """
    def rows(response):
        payload = response.to_dict() if hasattr(response, "to_dict") else response
        return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]

    def quoted(value):
        return "'" + str(value).replace("'", "''") + "'"

    now = _ny_datetime.now(_ny_timezone.utc).isoformat()
    current = {}
    for item in items:
        row = dict(item, source_plugin=plugin)
        row["id"] = needs_you_id(plugin, row["source_table"], str(row["source_id"]), row["verb"], member)
        current[row["id"]] = row
    where = f"source_plugin = {quoted(plugin)}" + (f" AND ({scope_where})" if scope_where else "")
    seen = {r["id"]: r for r in rows(pod.query(
        f"SELECT id, state, closed_by, source_version, snoozed_until FROM needs_you WHERE {where} LIMIT 5000"))}
    missing = [i for i in current if i not in seen]
    for start in range(0, len(missing), 200):
        ids = ", ".join(quoted(i) for i in missing[start : start + 200])
        seen.update({r["id"]: r for r in rows(pod.query(
            f"SELECT id, state, closed_by, source_version, snoozed_until FROM needs_you WHERE id IN ({ids})"))})
    creates, updates, counts = [], [], {"created": 0, "updated": 0, "kept_closed": 0, "resolved": 0}
    for item_id, row in current.items():
        old = seen.get(item_id)
        if old is None:
            creates.append(dict(row, state="open"))
            continue
        changed = (old.get("source_version") or "") != (row.get("source_version") or "")
        state = old.get("state")
        if state in ("dismissed", "done") and old.get("closed_by") != "source" and not changed:
            counts["kept_closed"] += 1
            continue
        if state == "snoozed" and not changed and (old.get("snoozed_until") or "") > now:
            updates.append(row)
            continue
        updates.append(dict(row, state="open", closed_by=None, snoozed_until=None))
    for item_id, old in seen.items():
        if item_id not in current and old.get("state") in ("open", "snoozed"):
            updates.append({"id": item_id, "state": "done", "closed_by": "source"})
            counts["resolved"] += 1
    for start in range(0, len(creates), 100):
        pod.records.bulk_create("needs_you", creates[start : start + 100], upsert=True)
    for start in range(0, len(updates), 100):
        pod.records.bulk_update("needs_you", updates[start : start + 100])
    counts["created"], counts["updated"] = len(creates), len(updates) - counts["resolved"]
    return counts
# end contract


def booking_needs_you(ctx: FunctionContext, data: BookingNeedsYouInput) -> BookingNeedsYouResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    member = str(ctx.user_id or "")
    settings = (_rows(pod.query("SELECT page_id FROM booking_settings LIMIT 1")) or [{}])[0]
    if not member:
        return BookingNeedsYouResult(attend=0, decide=0, written={}, message="Runs only for a member.")
    rows = []
    if settings.get("page_id"):
        rows = _rows(pod.query(
            "SELECT r.id, r.name, r.email, r.about, r.starts_at, r.ends_at, r.state, r.kind, r.genuine, r.unsure, "
            "r.answers, r.handled_at, m.headline, m.brief_at, m.kind AS meeting_kind "
            "FROM booking_request r LEFT JOIN meeting m ON m.id = r.meeting_id "
            f"WHERE r.page_id = {_sql(settings['page_id'])} AND r.state = 'confirmed' "
            f"AND r.ends_at >= {_sql(now.isoformat())} ORDER BY r.starts_at LIMIT 500"))
    items = []
    attend = decide = 0
    for r in rows:
        who = r.get("name") or r.get("email")
        about = " ".join(str(r.get("about") or "").split())
        base = {"person_name": r.get("name"), "person_handle": r.get("email"), "source_table": "booking_request",
                "source_id": str(r["id"]), "app": APP, "path": f"/b/{r['id']}"}
        kind = r.get("meeting_kind") or r.get("kind")
        items.append({
            **base, "verb": "attend", "title": f"Call with {who}"[:300],
            "why": (f"Booked on your page: {about}" if about else "Booked on your page.")[:300],
            "due_at": r.get("starts_at"), "ends_at": r.get("ends_at"), "since_at": r.get("handled_at"),
            "source_version": f"{r.get('state')}:{r.get('starts_at')}"[:200],
            "prepared": "Brief ready" if r.get("headline") else None,
            "prepared_text": (r.get("headline") or None) and str(r["headline"])[:2000],
            "weight": 0,
        })
        attend += 1
        if r.get("unsure"):
            answers = r.get("answers") or {}
            if r.get("genuine") is None:
                title, why = f"Is {who}'s booking genuine?", "The read wasn't sure it's a real request; it was booked anyway."
            else:
                title, why = f"What kind of call is {who}'s?", "The read wasn't sure what kind of meeting it is, so the brief may miss."
            items.append({
                **base, "verb": "decide", "title": title[:300], "why": why, "due_at": r.get("starts_at"),
                "since_at": r.get("handled_at"),
                "source_version": f"unsure:{r.get('genuine')}:{kind}"[:200], "weight": 1,
            })
            decide += 1
    written = needs_you_write(pod, PLUGIN, member, items)
    return BookingNeedsYouResult(attend=attend, decide=decide, written=written,
                                 message=f"{attend} bookings ahead, {decide} to decide.")
