#input_type_name: BrandNeedsYouInput
#output_type_name: BrandNeedsYouResult
#function_name: brand_needs_you

"""What in Brand kit needs the person, written to the shared `needs_you` list
that Today reads (see _contract/README.md, "Needs you").

Runs as the person (their brand job's run, their own call in chat, the Brand
app on open and after their changes), and writes only their own items:

  decide  a design they asked for, waiting for their review: its current
          version follows the brand (or the check wasn't sure), or it broke
          the brand and the maker couldn't fix it
  decide  the brand, after a read they started, waiting for them to check
          what was found

Each opens the Brand app (`app` brand): `/designs/<id>`, or `/` for the
brand. What no longer applies is resolved by the contract's write rule; one
the person dismissed comes back only when its source changes.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from lemma_sdk import FunctionContext
from pydantic import BaseModel

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

APP = "brand"


class BrandNeedsYouInput(BaseModel):
    pass


class BrandNeedsYouResult(BaseModel):
    decide: int
    counts: dict = {}
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def brand_needs_you(ctx: FunctionContext, data: BrandNeedsYouInput) -> BrandNeedsYouResult:
    pod = ctx.pod
    me = str(ctx.user_id) if ctx.user_id else ""
    if not me:
        return BrandNeedsYouResult(decide=0, message="No member to write for.")
    items = []

    designs = _rows(pod.query(
        "SELECT d.id, d.title, d.state, d.version, d.updated_at, v.verdict, v.reason, v.broke "
        "FROM brand_design d LEFT JOIN brand_version v ON v.design_id = d.id AND v.version = d.version "
        f"WHERE d.requested_by = {_sql(me)} AND d.state IN ('review', 'off_brand') LIMIT 500"))
    for d in designs:
        title = (d.get("title") or "a design")[:120]
        if d["state"] == "review":
            sure = d.get("verdict") == "follows"
            items.append({
                "verb": "decide", "title": f"Review “{title}”"[:300],
                "why": (f"Version {d.get('version')} follows the brand. Approve it, or ask for a change." if sure
                        else f"Version {d.get('version')} is ready, but the brand check wasn't sure. Have a look.")[:300],
                "prepared": "Checked against the brand" if sure else "Not sure it's on brand",
                "prepared_text": (d.get("reason") or "")[:2000] or None,
                "app": APP, "path": f"/designs/{d['id']}", "source_table": "brand_design", "source_id": d["id"],
                "source_version": f"{d.get('version')}|review|{d.get('verdict')}", "weight": 2 if sure else 3,
            })
        else:
            items.append({
                "verb": "decide", "title": f"“{title}” breaks the brand"[:300],
                "why": (d.get("reason") or "The brand check found a rule it breaks.")[:300],
                "prepared": None, "prepared_text": None,
                "app": APP, "path": f"/designs/{d['id']}", "source_table": "brand_design", "source_id": d["id"],
                "source_version": f"{d.get('version')}|off_brand|{d.get('broke')}", "weight": 3,
            })

    brands = _rows(pod.query("SELECT id, name, site_url, source, synced_at FROM brand WHERE state = 'check' LIMIT 20"))
    for b in brands:
        read = _rows(pod.query(f"SELECT requested_by, finished_at FROM brand_job WHERE brand_id = {_sql(b['id'])} AND kind = 'read' "
                               "AND state = 'done' ORDER BY finished_at DESC NULLS LAST LIMIT 1"))
        if not read or str(read[0].get("requested_by") or "") != me:
            continue
        where = (urlparse(b.get("site_url") or "").netloc.removeprefix("www.")
                 or ("Brand kit's sample" if b.get("source") == "sample" else "the files you uploaded"))
        items.append({
            "verb": "decide", "title": f"Check {b.get('name') or 'the brand'}’s brand"[:300],
            "why": f"Read from {where}: check its colours, type, logos and voice, and fix anything wrong."[:300],
            "prepared": "Read with its evidence", "prepared_text": None,
            "app": APP, "path": "/", "source_table": "brand", "source_id": b["id"],
            "source_version": str(b.get("synced_at") or ""), "weight": 4,
        })

    counts = needs_you_write(pod, "brand", me, items)
    return BrandNeedsYouResult(decide=len(items), counts=counts, message=f"{len(items)} thing(s) need you in Brand kit.")
