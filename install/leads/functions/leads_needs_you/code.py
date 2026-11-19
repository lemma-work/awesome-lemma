#input_type_name: LeadsNeedsYouInput
#output_type_name: LeadsNeedsYouResult
#function_name: leads_needs_you

"""Lead research's part of the person's day, on the shared `needs_you` list
that Today reads (see _contract/README.md).

  decide   "worth a look": a lead looked up in the last fourteen days, at a
           company the team fits 4 or 5 to (sure, or set by someone), who
           wrote to them or is meeting them, and that they have not kept or
           passed yet; opens the lead in Leads

Best fit first, then the soonest meeting. Run as the person when a lead's fit
or their call on it changes (leads-needs-you-fit, leads-needs-you-review) and
by the daily pass. Each pass writes every current item and resolves the rest
(kept, passed, older than fourteen days, gone).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PLUGIN = "leads"
FRESH_DAYS = 14


class LeadsNeedsYouInput(BaseModel):
    pass


class LeadsNeedsYouResult(BaseModel):
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


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


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


def current_items(pod) -> list[dict]:
    """Every lead that is worth a look now, as needs_you items."""
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=FRESH_DAYS)).isoformat()
    items: list[dict] = []
    for r in _rows(pod.query(
            "SELECT lp.id, lc.fit, lc.fit_why, lp.role, lp.summary, lp.looked_up_at, lp.facts, p.name, pp.handle, "
            "pp.last_inbound_at, pp.next_meeting_at, c.name AS company FROM leads_person lp "
            "JOIN person p ON p.id = lp.id LEFT JOIN people_person pp ON pp.id = lp.id "
            "LEFT JOIN company c ON c.id = lp.company_id JOIN leads_company lc ON lc.id = lp.company_id "
            "WHERE lp.state = 'ready' AND lp.review = 'new' AND lc.fit >= 4 AND lc.fit_sure IS TRUE "
            f"AND lp.looked_up_at >= '{since}' "
            f"AND (pp.last_inbound_at IS NOT NULL OR pp.next_meeting_at > '{now.isoformat()}') LIMIT 200")):
        meeting = _parse(r.get("next_meeting_at"))
        meeting = meeting if meeting and meeting > now else None
        who = ", ".join(x for x in (r.get("role"), r.get("company")) if x)
        title = (r.get("name") or r.get("handle") or "Someone") + (f", {who}" if who else "")
        why = [f"Fits {r['fit']} of 5", "meeting you soon" if meeting else "wrote to you"]
        facts = [f for f in (r.get("facts") or []) if isinstance(f, dict)]
        items.append({
            "verb": "decide", "source_table": "leads_person", "source_id": r["id"],
            "source_version": f"{r.get('fit')}|{r.get('looked_up_at')}",
            "title": _clip(title, 300), "why": _clip(" · ".join(why) + (f". {r['fit_why']}" if r.get("fit_why") else ""), 300),
            "person_name": r.get("name"), "person_handle": (r.get("handle") or "").lower() or None,
            "since_at": r.get("looked_up_at"), "due_at": meeting.isoformat() if meeting else None,
            "weight": float(r["fit"]) * 10 + (5 if meeting else 0),
            "prepared": "Looked up" + (f": {len(facts)} facts with sources" if facts else ""),
            "prepared_text": _clip(r.get("summary"), 2000),
            "app": "leads", "path": f"/{r['id']}",
        })
    return items


def leads_needs_you(ctx: FunctionContext, data: LeadsNeedsYouInput) -> LeadsNeedsYouResult:
    pod = ctx.pod
    items = current_items(pod)
    counts = needs_you_write(pod, PLUGIN, str(ctx.user_id), items)
    return LeadsNeedsYouResult(items=len(items), counts=counts, message=f"{len(items)} worth a look: {counts}")
