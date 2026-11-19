#input_type_name: DecksNeedsYouInput
#output_type_name: DecksNeedsYouResult
#function_name: decks_needs_you

"""What in Deck maker needs the person, written to the shared needs_you list
(Today reads it).

| Verb | When | Opens |
| --- | --- | --- |
| decide | an outline they asked for is waiting for their approval | decks /d/<deck id> |
| decide | an edit they asked for where the Decisions call was unsure which cards it meant | decks /d/<deck id>/ask/<job id> |
| do | a deck they had written is ready and they have not opened it since (for 7 days) | decks /d/<deck id> |

Runs as the person (decks_job is theirs): at the end of every `decks-work`
run, and from the app when they approve an outline or open a ready deck.
Whatever no longer applies is resolved by the source.
"""

from __future__ import annotations

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
FRESH_DAYS = 7


class DecksNeedsYouInput(BaseModel):
    pass


class DecksNeedsYouResult(BaseModel):
    items: int
    counts: dict
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _clip(text: Any, size: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= size else text[: size - 1] + "…"


def decks_needs_you(ctx: FunctionContext, data: DecksNeedsYouInput) -> DecksNeedsYouResult:
    pod = ctx.pod
    member = str(ctx.user_id) if ctx.user_id else "me"
    since = (datetime.now(timezone.utc) - timedelta(days=FRESH_DAYS)).isoformat()
    # decks_job is the person's own (RLS): only what they asked for.
    jobs = _rows(pod.query(
        "SELECT id, deck_id, kind, state, request, reason, finished_at, opened_at, created_at FROM decks_job "
        f"WHERE (kind = 'outline' AND state = 'done') OR (kind = 'edit' AND state = 'ask') "
        f"OR (kind = 'cards' AND state = 'done' AND opened_at IS NULL AND finished_at >= {_sql(since)}) "
        "ORDER BY created_at DESC LIMIT 300"))
    deck_ids = sorted({j["deck_id"] for j in jobs})
    decks = {d["id"]: d for d in _rows(pod.query(
        "SELECT id, title, prompt, status, card_count, ready_at FROM decks_deck WHERE id IN ("
        + (", ".join(_sql(i) for i in deck_ids) or "NULL") + ")"))} if deck_ids else {}
    items: dict[tuple, dict] = {}
    for j in jobs:
        deck = decks.get(j["deck_id"])
        if not deck:
            continue
        title = _clip(deck.get("title") or deck.get("prompt"), 120)
        if j["kind"] == "outline" and deck.get("status") == "outline_ready":
            key = ("decks_deck", deck["id"], "decide")
            if key not in items:
                items[key] = {"verb": "decide", "title": f"Approve the outline: {title}",
                              "why": _clip(f"{deck.get('card_count') or ''} cards from \"{deck.get('prompt')}\". Nothing is written until you approve it.", 300),
                              "source_table": "decks_deck", "source_id": deck["id"], "source_version": j["id"],
                              "app": "decks", "path": f"/d/{deck['id']}", "weight": 2,
                              "prepared": "Outline written", "prepared_text": None}
        elif j["kind"] == "edit" and j["state"] == "ask":
            items[("decks_job", j["id"], "decide")] = {
                "verb": "decide", "title": _clip(f"Which cards did you mean? \"{j.get('request')}\"", 300),
                "why": _clip(f"On {title}. Pick the cards and it goes ahead.", 300),
                "source_table": "decks_job", "source_id": j["id"], "source_version": j["id"],
                "app": "decks", "path": f"/d/{deck['id']}/ask/{j['id']}", "weight": 1}
        elif j["kind"] == "cards" and deck.get("status") == "ready":
            key = ("decks_deck", deck["id"], "do")
            if key not in items:
                items[key] = {"verb": "do", "title": f"Your deck is ready: {title}",
                              "why": "Written card by card. Read it through, ask for changes, present or export it.",
                              "source_table": "decks_deck", "source_id": deck["id"], "source_version": j["id"],
                              "app": "decks", "path": f"/d/{deck['id']}", "weight": 1, "due_at": None,
                              "prepared": "Deck written"}
    counts = needs_you_write(pod, PLUGIN, member, list(items.values()))
    return DecksNeedsYouResult(items=len(items), counts=counts,
                               message=f"{len(items)} thing(s) in Deck maker need you: {counts}")
