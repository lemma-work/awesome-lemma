#input_type_name: DecksSampleDataInput
#output_type_name: DecksSampleDataResult
#function_name: decks_sample_data

"""A sample to look around with, made up: Fernwick Coffee Roasters, a small
roaster selling an office coffee plan.

load:
- "Better coffee at work, without the admin": a written deck of eight cards
  in the Clay look, with one edit already asked for ("Make the pricing card
  punchier"): the Decisions call chose card 6 only, so only card 6 changed,
  and Undo puts the old card 6 back.
- "Two new cities by spring": an outline of six cards waiting for approval
  (an item in Today's list).

clear: removes only what load made (decks_sample_row), and closes the
sample's items in needs_you (done, closed by the source).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

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


PLUGIN = "decks"
SAMPLE_NS = uuid.UUID("b8f2a3c4-5d6e-4f70-8a91-0c2d3e4f5a6b")

CLAY = {"source": "theme", "name": "Clay", "surface": "#FFF8F0", "raised": "#F5E8DA", "ink": "#2B1D14", "muted": "#7A6151",
        "accent": "#2F7D4F", "accent_ink": "#FFFFFF", "heading_font": "Fraunces", "body_font": "Inter",
        "heading_office": "Georgia", "body_office": "Arial", "radius": "14px", "dark": False}

PITCH = [
    ("hero", "Better coffee at work, without the admin", "Fernwick's office plan, for teams of 20 to 200.",
     [{"type": "text", "text": "Fernwick Coffee Roasters · An office coffee plan for teams of 20 to 200"}],
     "Open with the one promise: the coffee gets better and someone stops having to think about it."),
    ("bullets", "Office coffee is a chore nobody owns", "Why it goes wrong in most offices.",
     [{"type": "bullets", "items": [
         {"text": "Beans get reordered when they run out, usually a day late", "icon": "clock"},
         {"text": "Three suppliers, three invoices, and no one sure what it costs", "icon": "dollar-sign"},
         {"text": "The machine breaks and waits a week for a technician", "icon": "wrench"}]}],
     "Ask the room who reorders the coffee. Usually nobody knows, which is the problem."),
    ("stats", "What a 60-person office spends today", "Spend and hassle from our office audits.",
     [{"type": "stats", "items": [
         {"value": "£410", "label": "a month on beans, milk and pods", "icon": "coffee"},
         {"value": "3", "label": "suppliers to manage", "icon": "layers"},
         {"value": "6 days", "label": "average wait for a machine repair", "icon": "wrench"}]},
      {"type": "text", "text": "From twelve offices we looked at this year."}],
     "These are typical, not worst cases. Most offices are paying more than they think."),
    ("two-column", "One plan instead of three suppliers", "Before and after, side by side.",
     [{"type": "columns", "columns": [
         {"heading": "Today", "body": "Beans from one shop, milk from another, a machine on lease with its own contract.", "icon": "x-circle"},
         {"heading": "With Fernwick", "body": "One delivery a week, one monthly invoice, the machine and its servicing included.", "icon": "check-circle"}]}],
     "Keep this simple: one supplier, one invoice, one number to call."),
    ("visual-right", "Roasted on Monday, in your kitchen by Thursday", "Freshness as the reason it tastes better.",
     [{"type": "bullets", "items": [
         {"text": "Small batches roasted to order each week"},
         {"text": "Delivered within three days of roasting"},
         {"text": "Two roasts on rotation, chosen with your team"}]},
      {"type": "visual", "hint": "warm roastery light, beans cooling in a tray"}],
     "Freshness is the whole difference people taste. Say the days out loud."),
    ("stats", "Simple pricing, per person", "The plan's price and what it includes.",
     [{"type": "stats", "items": [
         {"value": "£6", "label": "per person a month, beans and milk", "icon": "users"},
         {"value": "£0", "label": "for the machine and its servicing", "icon": "settings"},
         {"value": "48h", "label": "to repair or replace a machine", "icon": "clock"}]},
      {"type": "text", "text": "No contract. Leave with a month's notice."}],
     "Lead with £6. The free machine is the line people remember."),
    ("quote", "What changes for the team", "One customer's words.",
     [{"type": "quote", "text": "We stopped talking about the coffee, which is the point. It's just good now.",
       "attribution": "Office manager, a 45-person design studio"}],
     "Let the quote land, then pause."),
    ("closing", "Try it free for a month", "The ask.",
     [{"type": "heading", "text": "Try it free for a month"},
      {"type": "text", "text": "We install a machine and bring two roasts. Keep it if your team does."}],
     "Close on the trial. It removes the risk of saying yes."),
]

PRICING_BEFORE = {"layout": "prose", "title": "Our pricing model",
                  "blocks": [{"type": "text", "text": "Our plan is priced per person per month and includes beans, milk, the use of a machine, regular servicing and a repair guarantee, with no minimum contract term, so offices can try it without a long commitment."}],
                  "notes": "Walk through what's included."}

PLAN = [
    ("hero", "Two new cities by spring", "Fernwick's plan for the next quarter."),
    ("prose", "Why now: offices are back three days a week", "Demand we saw this autumn and what it means."),
    ("two-column", "Leeds or Bristol first", "The case for each, side by side."),
    ("stats", "What a second roastery costs", "The spend and when it pays back."),
    ("bullets", "Hiring: two roasters and a driver", "Who we need and by when."),
    ("closing", "Decide the first city this month", "The one decision this deck asks for."),
]


class DecksSampleDataInput(BaseModel):
    mode: str = "load"


class DecksSampleDataResult(BaseModel):
    mode: str
    rows: int
    deck_id: str | None = None
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _sid(member: str, name: str) -> str:
    return str(uuid.uuid5(SAMPLE_NS, f"{member}:{name}"))


def decks_sample_data(ctx: FunctionContext, data: DecksSampleDataInput) -> DecksSampleDataResult:
    pod = ctx.pod
    member = str(ctx.user_id) if ctx.user_id else "me"
    me = (ctx.user_email or "").split("@")[0] or None
    if data.mode == "clear":
        made = _rows(pod.query(f"SELECT id, table_name, row_id FROM decks_sample_row WHERE member = {_sql(member)} LIMIT 5000"))
        mine = {r["row_id"] for r in made}
        removed = 0
        for table in ("decks_correction", "decks_job", "decks_card", "decks_deck"):
            ids = [r["row_id"] for r in made if r["table_name"] == table]
            if table == "decks_card":
                # Cards an edit added to a sample deck go with it.
                decks = [r["row_id"] for r in made if r["table_name"] == "decks_deck"]
                if decks:
                    ids += [c["id"] for c in _rows(pod.query(
                        "SELECT id FROM decks_card WHERE deck_id IN (" + ", ".join(_sql(d) for d in decks) + ")")) if c["id"] not in mine]
            if table == "decks_job":
                decks = [r["row_id"] for r in made if r["table_name"] == "decks_deck"]
                if decks:
                    ids += [j["id"] for j in _rows(pod.query(
                        "SELECT id FROM decks_job WHERE deck_id IN (" + ", ".join(_sql(d) for d in decks) + ")")) if j["id"] not in mine]
            for start in range(0, len(ids), 200):
                try:
                    removed += pod.records.bulk_delete(table, ids[start:start + 200]) or 0
                except Exception:  # noqa: BLE001 — another person's job rows are not ours to see
                    pass
        decks = [r["row_id"] for r in made if r["table_name"] == "decks_deck"]
        if decks:
            scope = "source_id IN (" + ", ".join(_sql(d) for d in decks) + ")"
            needs_you_write(pod, PLUGIN, member, [], scope)
        if made:
            pod.records.bulk_delete("decks_sample_row", [r["id"] for r in made])
        return DecksSampleDataResult(mode="clear", rows=removed, message=f"Removed the sample ({removed} rows).")

    now = datetime.now(timezone.utc)
    pitch_id, plan_id = _sid(member, "deck:pitch"), _sid(member, "deck:plan")
    edit_id = _sid(member, "job:edit")
    made: list[tuple[str, str]] = []
    pod.records.bulk_create("decks_deck", [
        {"id": pitch_id, "title": "Better coffee at work, without the admin",
         "prompt": "A pitch for office managers: Fernwick's office coffee plan, why it beats juggling suppliers, and a free month's trial",
         "status": "ready", "card_count": len(PITCH), "density": "balanced", "look": CLAY, "source": "sample",
         "made_by": member, "made_by_name": me, "approved_at": (now - timedelta(hours=2)).isoformat(),
         "ready_at": (now - timedelta(hours=2)).isoformat()},
        {"id": plan_id, "title": "Two new cities by spring",
         "prompt": "Next quarter's plan for Fernwick: open in a second city, which one first, what it costs and who we hire",
         "status": "outline_ready", "card_count": len(PLAN), "density": "concise", "look": CLAY, "source": "sample",
         "made_by": member, "made_by_name": me},
    ], upsert=True)
    made += [("decks_deck", pitch_id), ("decks_deck", plan_id)]
    cards = []
    for i, (layout, title, outline, blocks, notes) in enumerate(PITCH, start=1):
        cid = _sid(member, f"pitch:{i}")
        row = {"id": cid, "deck_id": pitch_id, "position": i, "title": title, "outline": outline, "layout": layout,
               "blocks": blocks, "notes": notes, "status": "ready", "version": 1}
        if i == 6:
            row.update({"version": 2, "edit_id": edit_id})
        cards.append(row)
    for i, (layout, title, outline) in enumerate(PLAN, start=1):
        cards.append({"id": _sid(member, f"plan:{i}"), "deck_id": plan_id, "position": i, "title": title, "outline": outline,
                      "layout": layout, "status": "outline", "version": 0})
    pod.records.bulk_create("decks_card", cards, upsert=True)
    made += [("decks_card", c["id"]) for c in cards]
    pricing = next(c for c in cards if c["id"] == _sid(member, "pitch:6"))
    before = dict(pricing, **PRICING_BEFORE, version=1, edit_id=None)
    evidence = ("The request: \"Make the pricing card punchier\"\n\nThe deck: \"Better coffee at work, without the admin\", 8 cards\n"
                + "\n".join(f"c{i}. [{p[0]}] {p[1]} — {p[2]}" for i, p in enumerate(PITCH, start=1)))
    jobs = [
        {"id": _sid(member, "job:pitch-outline"), "deck_id": pitch_id, "kind": "outline", "state": "done",
         "summary": "Outline ready: 8 cards.", "finished_at": (now - timedelta(hours=2, minutes=5)).isoformat()},
        {"id": _sid(member, "job:pitch-cards"), "deck_id": pitch_id, "kind": "cards", "state": "done",
         "summary": "Wrote 8 of 8 cards.", "finished_at": (now - timedelta(hours=2)).isoformat(),
         "opened_at": (now - timedelta(hours=1)).isoformat()},
        {"id": edit_id, "deck_id": pitch_id, "kind": "edit", "state": "done", "request": "Make the pricing card punchier",
         "action": "rewrite", "cards": [pricing["id"]], "confidence": 0.86, "evidence": evidence,
         "reason": "Rewrite: card 6 (86% sure)", "before": {"cards": [before], "positions": {c["id"]: c["position"] for c in cards if c["deck_id"] == pitch_id}},
         "summary": "Rewrote card 6. Nothing else changed.", "decide_seconds": 1.2,
         "finished_at": (now - timedelta(minutes=50)).isoformat()},
        {"id": _sid(member, "job:plan-outline"), "deck_id": plan_id, "kind": "outline", "state": "done",
         "summary": "Outline ready: 6 cards.", "finished_at": (now - timedelta(minutes=20)).isoformat()},
    ]
    pod.records.bulk_create("decks_job", jobs, upsert=True)
    made += [("decks_job", j["id"]) for j in jobs]
    pod.records.bulk_create("decks_sample_row", [{"id": _sid(member, f"row:{t}:{r}"), "table_name": t, "row_id": r, "member": member} for t, r in made], upsert=True)
    return DecksSampleDataResult(mode="load", rows=len(made), deck_id=pitch_id,
                                 message="Loaded a sample: a written pitch deck with one edit, and an outline to approve.")
