#input_type_name: MeetingsNeedsYouInput
#output_type_name: MeetingsNeedsYouResult
#function_name: meetings_needs_you

"""Meetings' part of the person's day: what on their calendar needs them,
written to the shared `needs_you` list that Today reads (see
_contract/README.md).

  attend   today's and tomorrow's meetings (in the person's time), until they
           end, opening on the meeting's page with its brief; "Brief ready"
           when Meetings has written one
  do       a follow-up the person promised in a meeting (from its notes)
  waiting  something someone promised them in a meeting

Run as the person at the end of Meetings' own jobs: set-up, the 15-minute
sweep, a brief written, notes read. Each pass writes everything current and
resolves the rest (a meeting that ended, a promise kept).

`settle_item_id`: the person marked one of these promise items done outside
Meetings (Today's Done); the promise is done here too.
"""

from __future__ import annotations

from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PLUGIN = "meetings"
ZONE_ALIASES = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu",
                "Asia/Rangoon": "Asia/Yangon", "Europe/Kiev": "Europe/Kyiv", "US/Eastern": "America/New_York",
                "US/Central": "America/Chicago", "US/Mountain": "America/Denver", "US/Pacific": "America/Los_Angeles"}


class MeetingsNeedsYouInput(BaseModel):
    settle_item_id: str | None = None


class MeetingsNeedsYouResult(BaseModel):
    items: int
    counts: dict
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


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


def _clip(text: Any, size: int) -> str | None:
    text = " ".join(str(text or "").split())
    if not text:
        return None
    return text if len(text) <= size else text[: size - 1] + "…"


def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(ZONE_ALIASES.get(name or "", name or "UTC"))
    except Exception:  # noqa: BLE001 — an unknown zone reads as UTC
        return ZoneInfo("UTC")


def _lead(attendees: Any) -> dict:
    people = [a for a in (attendees if isinstance(attendees, list) else []) if isinstance(a, dict) and not a.get("you")]
    outside = [a for a in people if a.get("outside")]
    return (outside or people or [{}])[0]


def _with(attendees: Any) -> str:
    people = [a for a in (attendees if isinstance(attendees, list) else []) if isinstance(a, dict) and not a.get("you")]
    shown = [a.get("name") or a.get("handle") for a in ([a for a in people if a.get("outside")] or people)]
    shown = [s for s in shown if s]
    if not shown:
        return "Just you"
    return ", ".join(shown[:2]) + (f" +{len(shown) - 2}" if len(shown) > 2 else "")


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


def _settle(pod: Any, item_id: str) -> str:
    item = (_rows(pod.query(
        f"SELECT verb, source_table, source_id, state, closed_by FROM needs_you WHERE id = {_sql(item_id)} AND source_plugin = 'meetings'"))
        or [None])[0]
    if not item or item.get("state") != "done" or item.get("closed_by") != "person" or item.get("source_table") != "promise":
        return "Nothing to settle."
    promise = (_rows(pod.query(f"SELECT id, state FROM promise WHERE id = {_sql(item['source_id'])}")) or [None])[0]
    if promise and promise.get("state") == "open":
        pod.table("promise").update(promise["id"], {"state": "done"})
        return "The promise is done."
    return "Nothing to change."


def meetings_needs_you(ctx: FunctionContext, data: MeetingsNeedsYouInput) -> MeetingsNeedsYouResult:
    pod = ctx.pod
    member = str(ctx.user_id)
    if data.settle_item_id:
        return MeetingsNeedsYouResult(items=0, counts={}, message=_settle(pod, data.settle_item_id))
    settings = (_rows(pod.query("SELECT timezone FROM meetings_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    zone = _zone(settings.get("timezone"))
    now = datetime.now(timezone.utc)
    start = datetime.combine(now.astimezone(zone).date(), dtime.min, zone)
    end = start + timedelta(days=2)

    items: list[dict] = []
    for m in _rows(pod.query(
            "SELECT id, title, start_at, end_at, attendees, outside, kind, status, headline, brief, brief_at, location "
            f"FROM meeting WHERE status <> 'cancelled' AND start_at >= {_sql(start.isoformat())} "
            f"AND start_at < {_sql(end.isoformat())} ORDER BY start_at LIMIT 200")):
        began = _parse(m.get("start_at"))
        ends = _parse(m.get("end_at")) or (began + timedelta(hours=1) if began else None)
        if ends and ends <= now:
            continue
        lead = _lead(m.get("attendees"))
        items.append({
            "verb": "attend", "source_table": "meeting", "source_id": m["id"],
            "source_version": f"{m.get('start_at')}|{m.get('status')}|{m.get('brief_at')}",
            "title": _clip(m.get("title") or "Meeting", 300),
            "why": _clip(_with(m.get("attendees")) + (f" · {m['location']}" if m.get("location") else ""), 300),
            "person_name": lead.get("name"), "person_handle": (lead.get("handle") or "").lower() or None,
            "due_at": m.get("start_at"), "ends_at": ends.isoformat() if ends else None,
            "weight": 10.0 if m.get("outside") else 0.0,
            "app": "meetings", "path": f"/{m['id']}",
            "prepared": "Brief ready" if m.get("brief") else None,
            "prepared_text": _clip(m.get("headline"), 2000) if m.get("brief") else None,
        })
    meetings_by_source = {}
    promises = _rows(pod.query(
        "SELECT id, source_id, direction, text, quote, due_at, person_name, person_handle, state FROM promise "
        "WHERE source = 'meeting' AND state = 'open' LIMIT 1000"))
    if promises:
        ids = ", ".join(_sql(p.get("source_id")) for p in promises if p.get("source_id")) or "NULL"
        meetings_by_source = {r["source_id"]: r for r in _rows(pod.query(
            f"SELECT id, source_id, title, start_at FROM meeting WHERE source_id IN ({ids}) LIMIT 1000"))}
    for p in promises:
        m = meetings_by_source.get(p.get("source_id")) or {}
        mine = p.get("direction") == "i_owe"
        who = p.get("person_name") or p.get("person_handle") or "them"
        at = f"in “{m['title']}”" if m.get("title") else "in a meeting"
        items.append({
            "verb": "do" if mine else "waiting", "source_table": "promise", "source_id": p["id"],
            "source_version": f"{p.get('text')}|{p.get('due_at')}|{p.get('state')}",
            "title": _clip(p.get("text"), 300),
            "why": _clip(f"You said {at}" if mine else f"{who} said {at}", 300),
            "quote": _clip(p.get("quote"), 600),
            "person_name": p.get("person_name"), "person_handle": (p.get("person_handle") or "").lower() or None,
            "due_at": p.get("due_at"), "since_at": m.get("start_at"), "weight": 0.0,
            "app": "meetings", "path": f"/{m['id']}" if m.get("id") else "/after",
        })
    counts = needs_you_write(pod, PLUGIN, member, items)
    return MeetingsNeedsYouResult(items=len(items), counts=counts, message=f"{len(items)} item(s) from meetings: {counts}")
