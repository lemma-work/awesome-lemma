#input_type_name: DealsSampleDataInput
#output_type_name: DealsSampleDataResult
#function_name: deals_sample_data

"""What Mail's, Meetings' and People map's samples can't show on their own: a
board with weeks of history behind it.

The samples' own conversations and meeting notes already talk about deals (a
renewal at Brightwave Health, an annual plan at Velo Cycles, a signed contract
at Orchard Dental), and set-up's "find them in my conversations" proposes
those from what was said. So `load` adds only four made-up deals with
history, at companies People map's sample already knows:

    Lumen Labs        talking for seven weeks, its contact cold: goes quiet
    Harborview Hotels negotiating, moved and repriced this week, closing in two
                      days with a next step: "do" in needs_you
    Tidal Foods       won a month ago (the invoice thread is about its seats), owned by
                      People map's made-up colleague, to show a team's board
    Ferro Logistics   an add-on, lost last week

Each is labelled with source `sample`, and every row load makes is listed in
`deals_sample_row`. With the samples' proposals, Lumen going quiet and
Harborview's next step, the person's `needs_you` gets one of each verb Deal
tracker writes (decide, do, drifting).

`clear` removes exactly what load made, and Deal tracker's own rows read from
the sample mailbox and calendar (its reads, proposals and corrections, and
any deal kept from a sample conversation), and its items in `needs_you`. It
never touches Mail's, Meetings' or People map's rows, nor the team's stages
and settings.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

SAMPLE_NS = uuid.UUID("a3f4d2c8-6e1b-4c09-8d5f-2b7e9a1c4d63")
COLLEAGUE = "Noor Haddad (sample)"

# key, name, company, domain, (contact name, address), stage slot, amount,
# close in days (None: none), next step, owner (None: the person loading),
# lost reason, history as (days ago, field, from slot/value, to slot/value, how, with)
DEALS: list[tuple] = [
    ("lumen", "Rollout to all three sites", "Lumen Labs", "lumen-labs.example", ("Ana Ruiz", "ana@lumen-labs.example"),
     "open1", 18000, 25, "Send the rollout plan for the second and third sites", None, None, [
         (58, "created", None, "open0", "proposal", "Ana Ruiz"),
         (50, "stage", "open0", "open1", "proposal", "Ana Ruiz"),
         (49, "amount", None, 18000, "person", None),
         (49, "next_step", None, "Send the rollout plan for the second and third sites", "person", None),
     ]),
    ("harborview", "Two more properties and Lisbon", "Harborview Hotels", "harborview-hotels.example",
     ("Sofia Marin", "sofia@harborview-hotels.example"), "open-1", 24000, 2, "Send the revised terms for the Lisbon property",
     None, None, [
         (40, "created", None, "open1", "proposal", "Sofia Marin"),
         (21, "stage", "open1", "open2", "proposal", "Sofia Marin"),
         (21, "amount", None, 22000, "proposal", "Sofia Marin"),
         (4, "amount", 22000, 24000, "proposal", "Sofia Marin"),
         (3, "stage", "open2", "open-1", "proposal", "Sofia Marin"),
         (3, "close_date", None, "close", "proposal", "Sofia Marin"),
     ]),
    ("tidal", "Annual plan, 10 seats", "Tidal Foods", "tidal-foods.example", ("Marcus Lee", "ap@tidal-foods.example"),
     "won", 6000, -30, None, COLLEAGUE, None, [
         (70, "created", None, "open0", "person", None),
         (45, "stage", "open0", "open2", "proposal", "Marcus Lee"),
         (30, "won", "open2", "won", "proposal", "Marcus Lee"),
     ]),
    ("ferro", "Reporting add-on", "Ferro Logistics", "ferro-logistics.example", ("Lena Fischer", "lena.fischer@ferro-logistics.example"),
     "lost", 4800, None, None, None, "Waiting for next year's budget", [
         (35, "created", None, "open1", "proposal", "Lena Fischer"),
         (20, "stage", "open1", "open2", "person", None),
         (9, "lost", "open2", "lost", "proposal", "Lena Fischer"),
     ]),
]
NOTES = [("harborview", 3, COLLEAGUE, "Sofia wants Lisbon live before the summer season; the two other properties can follow in autumn.")]


class DealsSampleDataInput(BaseModel):
    mode: str = "load"
    display_name: str | None = None


class DealsSampleDataResult(BaseModel):
    mode: str
    deals: int
    history: int
    removed: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _ids(pod: Any, sql: str) -> list[str]:
    return [r["id"] for r in _rows(pod.query(sql))]


def _delete(pod: Any, table: str, ids: list[str]) -> int:
    n = 0
    ids = sorted(set(ids))
    for i in range(0, len(ids), 100):
        pod.records.bulk_delete(table, ids[i:i + 100])
        n += len(ids[i:i + 100])
    return n


def _j(value: Any) -> Any:
    """A JSON column takes an object or a list, never a bare number or string
    (the datastore passes a scalar to Postgres unencoded and refuses it), so a
    history value is kept as {"v": value}."""
    return value if value is None or isinstance(value, (dict, list)) else {"v": value}


def deals_sample_data(ctx: FunctionContext, data: DealsSampleDataInput) -> DealsSampleDataResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    me = str(ctx.user_id or ctx.user_email or "someone")

    if data.mode == "clear":
        made = _rows(pod.query("SELECT id, table_name, row_id FROM deals_sample_row LIMIT 20000"))
        deal_ids = [r["row_id"] for r in made if r["table_name"] == "deal"]
        removed = 0
        sample_changes = _ids(pod, "SELECT id FROM deals_change WHERE sample IS TRUE"
                                   + (f" OR deal_id IN ({_in(deal_ids)})" if deal_ids else "") + " LIMIT 20000")
        # Everything hanging off the deals the sample made, then the rows it listed.
        if deal_ids:
            for table in ("deals_history", "deals_note"):
                removed += _delete(pod, table, _ids(pod, f"SELECT id FROM {table} WHERE deal_id IN ({_in(deal_ids)}) LIMIT 20000"))
            removed += _delete(pod, "deals_change", _ids(pod, f"SELECT id FROM deals_change WHERE deal_id IN ({_in(deal_ids)}) LIMIT 20000"))
        for table in ("deals_history", "deals_note"):
            listed = [r["row_id"] for r in made if r["table_name"] == table]
            if listed:
                removed += _delete(pod, table, _ids(pod, f"SELECT id FROM {table} WHERE id IN ({_in(listed)}) LIMIT 20000"))
        if deal_ids:
            removed += _delete(pod, "deal", _ids(pod, f"SELECT id FROM deal WHERE id IN ({_in(deal_ids)}) LIMIT 20000"))
        # This person's own rows read from the sample mailbox and calendar.
        for table in ("deals_correction", "deals_change", "deals_read"):
            removed += _delete(pod, table, _ids(pod, f"SELECT id FROM {table} WHERE sample IS TRUE LIMIT 20000"))
        # Its items in the shared needs_you: what was about a removed row.
        gone = set(deal_ids) | set(sample_changes)
        if gone:
            removed += _delete(pod, "needs_you", _ids(pod,
                f"SELECT id FROM needs_you WHERE source_plugin = 'deals' AND source_id IN ({_in(sorted(gone))}) LIMIT 20000"))
        removed += _delete(pod, "deals_sample_row", [r["id"] for r in made])
        return DealsSampleDataResult(mode="clear", deals=0, history=0, removed=removed,
                                     message=f"Removed the sample's {removed} rows from Deal tracker.")

    if data.mode != "load":
        return DealsSampleDataResult(mode=data.mode, deals=0, history=0, removed=0, message="Use load or clear.")

    stages = _rows(pod.query("SELECT name, kind FROM deals_stage ORDER BY position, name"))
    opens = [s["name"] for s in stages if s["kind"] == "open"]
    won = next((s["name"] for s in stages if s["kind"] == "won"), None)
    lost = next((s["name"] for s in stages if s["kind"] == "lost"), None)
    if not opens or not won or not lost:
        return DealsSampleDataResult(mode="load", deals=0, history=0, removed=0,
                                     message="Set up Deal tracker first: the sample deals sit in the team's stages.")
    team = (_rows(pod.query("SELECT currency FROM deals_settings LIMIT 1")) or [{}])[0]
    currency = team.get("currency") or "USD"
    member = (_rows(pod.query("SELECT display_name FROM deals_member ORDER BY created_at LIMIT 1")) or [{}])[0]
    my_name = data.display_name or member.get("display_name") or ctx.user_email

    def slot(name: Any) -> Any:
        if not isinstance(name, str):
            return name
        if name == "won":
            return won
        if name == "lost":
            return lost
        if name.startswith("open"):
            i = int(name[4:])
            return opens[max(0, min(len(opens) - 1, i if i >= 0 else len(opens) + i))]
        return name

    domains = sorted({d[3] for d in DEALS})
    companies = {r["domain"]: r for r in _rows(pod.query(
        "SELECT d.domain, c.id, c.name FROM company_domain d JOIN company c ON c.id = d.company_id "
        f"WHERE d.domain IN ({_in(domains)})"))}
    ids = {d[0]: str(uuid.uuid5(SAMPLE_NS, f"{me}:deal:{d[0]}")) for d in DEALS}
    have = set(_ids(pod, f"SELECT id FROM deal WHERE id IN ({_in(list(ids.values()))})"))
    deals, history, notes, listed = [], [], [], []
    for key, name, company, domain, (who, handle), stage, amount, close_in, step, owner, why, events in DEALS:
        if ids[key] in have:
            continue
        stage_name = slot(stage)
        kind = "won" if stage == "won" else "lost" if stage == "lost" else "open"
        closed_days = next((e[0] for e in events if e[1] in ("won", "lost")), None)
        close = (now + timedelta(days=close_in)).date().isoformat() if close_in is not None else None
        found = companies.get(domain) or {}
        deals.append({
            "id": ids[key], "name": name, "company_id": found.get("id"), "company_name": found.get("name") or company,
            "company_domain": domain, "people": [{"handle": handle, "name": who}],
            "owner_user_id": None if owner else ctx.user_id, "owner_name": owner or my_name,
            "stage": stage_name, "status": kind, "amount": float(amount), "currency": currency, "close_date": close,
            "next_step": step, "lost_reason": why,
            "closed_at": (now - timedelta(days=closed_days)).isoformat() if closed_days is not None else None,
            "source": "sample", "source_id": f"sample:{key}",
            "last_activity_at": (now - timedelta(days=min(e[0] for e in events))).isoformat(),
        })
        listed.append({"id": str(uuid.uuid5(SAMPLE_NS, f"{me}:row:deal:{key}")), "table_name": "deal", "row_id": ids[key]})
        for i, (days, field, before, after, how, with_name) in enumerate(events):
            hid = str(uuid.uuid5(SAMPLE_NS, f"{me}:history:{key}:{i}"))
            to_value = slot(after)
            if field == "created":
                to_value = {"name": name, "stage": slot(after), "amount": None}
            if field == "close_date":
                to_value = close
            by = owner or my_name
            history.append({
                "id": hid, "deal_id": ids[key], "field": field, "from_value": _j(slot(before)), "to_value": _j(to_value),
                "by_user_id": None if owner else ctx.user_id, "by_name": by, "how": how,
                "source": "mail" if how == "proposal" else None, "with_name": with_name,
                "at": (now - timedelta(days=days, hours=2 + i)).isoformat()})
            listed.append({"id": str(uuid.uuid5(SAMPLE_NS, f"{me}:row:history:{key}:{i}")), "table_name": "deals_history", "row_id": hid})
    for key, days, by, body in NOTES:
        if ids[key] in have:
            continue
        nid = str(uuid.uuid5(SAMPLE_NS, f"{me}:note:{key}"))
        notes.append({"id": nid, "deal_id": ids[key], "body": body, "by_name": by,
                      "by_user_id": None})
        listed.append({"id": str(uuid.uuid5(SAMPLE_NS, f"{me}:row:note:{key}")), "table_name": "deals_note", "row_id": nid})
    if deals:
        pod.records.bulk_create("deal", deals, upsert=True)
        pod.records.bulk_create("deals_history", history, upsert=True)
        if notes:
            pod.records.bulk_create("deals_note", notes, upsert=True)
        pod.records.bulk_create("deals_sample_row", listed, upsert=True)
    return DealsSampleDataResult(
        mode="load", deals=len(deals), history=len(history), removed=0,
        message=(f"Added {len(deals)} sample deals with {len(history)} changes of history." if deals
                 else "The sample deals are already here."))
