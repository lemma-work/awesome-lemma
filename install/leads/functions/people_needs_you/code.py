#input_type_name: PeopleNeedsYouInput
#output_type_name: PeopleNeedsYouResult
#function_name: people_needs_you

"""People map's part of the person's day: people who matter going quiet,
written to the shared `needs_you` list that Today reads (see
_contract/README.md).

  drifting  someone People map counts as gone quiet (`people_person.quiet`:
            someone they deal with, cooling or cold against their own usual
            gap, both sides spoke or met, no meeting ahead, no reply owed by
            the person), most overdue first by `weight` (days quiet past the
            usual gap); opens on the person in People

People map owns the rule; this only copies its answer. Run as the person when
a row's `quiet` changes (people-needs-you-quiet, people-needs-you-new): the
hourly refresh and the refresh on opening People write it. Each pass writes
everyone gone quiet and resolves whoever is not any more.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PLUGIN = "people"


class PeopleNeedsYouInput(BaseModel):
    pass


class PeopleNeedsYouResult(BaseModel):
    items: int
    counts: dict
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _clip(text: Any, size: int) -> str | None:
    text = " ".join(str(text or "").split())
    if not text:
        return None
    return text if len(text) <= size else text[: size - 1] + "…"


LAST = {"outbound": "you wrote last", "inbound": "they wrote last", "meeting": "you last met"}


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


def people_needs_you(ctx: FunctionContext, data: PeopleNeedsYouInput) -> PeopleNeedsYouResult:
    pod = ctx.pod
    member = str(ctx.user_id)
    items: list[dict] = []
    for r in _rows(pod.query(
            "SELECT pp.id, p.name, c.name AS company, pp.handle, pp.kind, pp.last_contact_at, pp.last_contact_dir, "
            "pp.quiet_days, pp.usual_gap_days, pp.warmth FROM people_person pp JOIN person p ON p.id = pp.id "
            "LEFT JOIN company c ON c.id = pp.company_id WHERE pp.quiet IS TRUE AND pp.in_scope IS TRUE LIMIT 500")):
        gap = r.get("usual_gap_days")
        why = [r.get("company"), f"usually every {round(gap)} days" if gap else None, LAST.get(r.get("last_contact_dir") or "")]
        items.append({
            "verb": "drifting", "source_table": "people_person", "source_id": r["id"],
            "source_version": f"{r.get('last_contact_at')}|{r.get('warmth')}",
            "title": _clip(r.get("name") or r.get("handle") or "Someone", 300),
            "why": _clip(" · ".join(w for w in why if w), 300),
            "person_name": r.get("name"), "person_handle": (r.get("handle") or "").lower() or None,
            "since_at": r.get("last_contact_at"), "due_at": None,
            "weight": float(int(r.get("quiet_days") or 0) - float(gap or 14)),
            "prepared": None, "prepared_text": None,
            "app": "people", "path": f"/{r['id']}",
        })
    counts = needs_you_write(pod, PLUGIN, member, items)
    return PeopleNeedsYouResult(items=len(items), counts=counts, message=f"{len(items)} gone quiet: {counts}")
