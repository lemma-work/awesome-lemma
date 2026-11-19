#input_type_name: DealsNeedsYouInput
#output_type_name: DealsNeedsYouResult
#function_name: deals_needs_you

"""What Deal tracker needs of the signed-in person, written to the shared
`needs_you` (Today shows it), and what no longer does, resolved:

    decide    a change proposed from their own conversations or meeting notes,
              waiting for them to keep or dismiss (only they can: the sentence
              is theirs). Opens the deal, or the waiting list for a new deal.
    do        a deal they own whose next step is due: it closes within three
              days, or was due to close and is still open.
    drifting  a deal they own gone quiet: the warmest anyone on the team is
              with its people (People map's `people_link`) is cooling or cold.

Runs as the person: at the end of each read that proposed something, when set-
up finishes, after they keep or dismiss in the app, once a day on their own
schedule, and when the app opens after ten minutes. Counted, never asked.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PLUGIN = "deals"
APP = "deals"
DUE_DAYS = 3
RANK = {"warm": 3, "new": 2, "cooling": 1, "cold": 0}
KIND = {"new_deal": "New deal", "stage": "Stage", "amount": "Amount", "close_date": "Close date",
        "next_step": "Next step", "lost": "Lost"}


class DealsNeedsYouInput(BaseModel):
    # Ignored: lets a workflow pass the step before it.
    after: dict | None = None


class DealsNeedsYouResult(BaseModel):
    decide: int
    do: int
    drifting: int
    counts: dict
    message: str


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


def _zone(name: str | None) -> ZoneInfo:
    aliases = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv"}
    try:
        return ZoneInfo(aliases.get(name or "", name or "UTC"))
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def _money(amount: Any, currency: str | None) -> str:
    try:
        return f"{currency or ''} {float(amount):,.0f}".strip()
    except (TypeError, ValueError):
        return ""


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


def deals_needs_you(ctx: FunctionContext, data: DealsNeedsYouInput) -> DealsNeedsYouResult:
    pod = ctx.pod
    me = str(ctx.user_id or "")
    if not me:
        return DealsNeedsYouResult(decide=0, do=0, drifting=0, counts={}, message="No one to write for.")
    member = (_rows(pod.query("SELECT id, timezone, setup_step FROM deals_member ORDER BY created_at LIMIT 1")) or [{}])[0]
    zone = _zone(member.get("timezone"))
    now = datetime.now(timezone.utc)
    today = now.astimezone(zone).date()
    items: list[dict] = []

    # decide: this person's own proposals.
    changes = _rows(pod.query(
        "SELECT id, kind, deal_id, deal_name, company_name, company_domain, people, value, quote, speaker, said_at, "
        "source, source_row, confidence FROM deals_change WHERE state = 'proposed' ORDER BY said_at DESC NULLS LAST LIMIT 300"))
    for c in changes:
        who = ((c.get("people") or [{}])[0] or {}) if isinstance(c.get("people"), list) else {}
        name = c.get("deal_name") or (c.get("value") or {}).get("name") or c.get("company_name") or "a deal"
        where = c.get("company_name") or c.get("company_domain")
        items.append({
            "verb": "decide", "title": f"{KIND.get(c['kind'], c['kind'])}: {name}"[:300],
            "why": (f"Proposed from {'a meeting' if c.get('source') == 'meeting' else 'a conversation'}"
                    + (f" with {where}" if where else "") + "; keep or dismiss it")[:300],
            "quote": c.get("quote"), "person_name": who.get("name") or c.get("speaker"),
            "person_handle": who.get("handle"), "since_at": c.get("said_at"),
            "source_table": "deals_change", "source_id": c["id"], "source_version": c["id"],
            "conversation_id": c.get("source_row") if c.get("source") != "meeting" else None,
            "app": APP, "path": f"/{c['deal_id']}" if c.get("deal_id") else "/waiting",
            "weight": float(c.get("confidence") or 0),
        })

    # do and drifting: open deals this person owns.
    deals = _rows(pod.query(
        "SELECT id, name, company_id, company_name, people, amount, currency, close_date, next_step, last_activity_at "
        f"FROM deal WHERE status = 'open' AND owner_user_id = {_sql(me)} LIMIT 2000"))
    for d in deals:
        if not d.get("next_step") or not d.get("close_date"):
            continue
        close = date.fromisoformat(str(d["close_date"])[:10])
        if close > today + timedelta(days=DUE_DAYS):
            continue
        late = (today - close).days
        why = (f"{d['name']} was due to close {late} day{'s' if late != 1 else ''} ago" if late > 0
               else f"{d['name']} closes today" if late == 0 else f"{d['name']} closes {close.strftime('%a %d %b')}")
        who = ((d.get("people") or [{}])[0] or {}) if isinstance(d.get("people"), list) else {}
        items.append({
            "verb": "do", "title": d["next_step"][:300], "why": (why + (f", {d.get('company_name')}" if d.get("company_name") else ""))[:300],
            "person_name": who.get("name"), "person_handle": who.get("handle"),
            "due_at": datetime.combine(close, datetime.min.time(), zone).astimezone(timezone.utc).isoformat(),
            "source_table": "deal", "source_id": d["id"], "source_version": f"{d['next_step']}|{d['close_date']}"[:200],
            "app": APP, "path": f"/{d['id']}", "weight": float(d.get("amount") or 0),
        })

    handles = sorted({str(p.get("handle")).lower() for d in deals for p in (d.get("people") or [])
                      if isinstance(p, dict) and p.get("handle")})
    companies = sorted({d["company_id"] for d in deals if d.get("company_id")})
    links: list[dict] = []
    if handles or companies:
        try:
            links = _rows(pod.query(
                "SELECT handle, name, company_id, last_contact_at, warmth FROM people_link "
                f"WHERE handle IN ({_in(handles)}) OR company_id IN ({_in(companies)}) LIMIT 20000"))
        except Exception:  # noqa: BLE001 - People map not in this Lemma
            links = []
    for d in deals:
        mine = {str(p.get("handle")).lower() for p in (d.get("people") or []) if isinstance(p, dict) and p.get("handle")}
        rows = [l for l in links if l.get("warmth") and (l["handle"].lower() in mine if mine else l.get("company_id") == d.get("company_id"))]
        if not rows:
            continue
        best = max(rows, key=lambda l: RANK.get(l["warmth"], -1))
        if best["warmth"] not in ("cooling", "cold"):
            continue
        newest = max(rows, key=lambda l: l.get("last_contact_at") or "")
        last = _parse(newest.get("last_contact_at"))
        days = (now - last).days if last else None
        items.append({
            "verb": "drifting", "title": f"{d['name']} has gone quiet"[:300],
            "why": (f"Nobody on the team has heard from {newest.get('name') or newest['handle']}"
                    + (f" in {days} days" if days is not None else "")
                    + (f"; {_money(d.get('amount'), d.get('currency'))} open" if d.get("amount") else ""))[:300],
            "person_name": newest.get("name"), "person_handle": newest["handle"], "since_at": newest.get("last_contact_at"),
            "source_table": "deal", "source_id": d["id"], "source_version": str(newest.get("last_contact_at") or "")[:200],
            "app": APP, "path": f"/{d['id']}", "weight": float(d.get("amount") or 0),
        })

    counts = needs_you_write(pod, PLUGIN, me, items)
    if member.get("id"):
        pod.table("deals_member").update(member["id"], {"needs_at": now.isoformat()})
    n = {v: sum(1 for i in items if i["verb"] == v) for v in ("decide", "do", "drifting")}
    return DealsNeedsYouResult(decide=n["decide"], do=n["do"], drifting=n["drifting"], counts=counts,
                               message=f"{n['decide']} to decide, {n['do']} to do, {n['drifting']} drifting; "
                                       f"{counts.get('resolved', 0)} resolved.")
