#input_type_name: DecksSaveOutlineInput
#output_type_name: DecksSaveOutlineResult
#function_name: decks_save_outline

"""Keep the outline `decks-outliner` wrote: one card per line (title, what it
covers, layout), the deck's title, and the deck waiting for the person to
approve it (`outline_ready`). No card is written until they do.

Writing an outline again (the person asked for a new one) replaces the
cards that were only outline; it never touches a written card.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

LAYOUTS = ("hero", "prose", "bullets", "two-column", "quote", "stats", "visual-left", "visual-right", "closing")


class DecksSaveOutlineInput(BaseModel):
    job_id: str
    outline: dict = {}


class DecksSaveOutlineResult(BaseModel):
    deck_id: str | None = None
    cards: int = 0
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _line(value: Any, size: int) -> str:
    return " ".join(str(value or "").split())[:size]


def decks_save_outline(ctx: FunctionContext, data: DecksSaveOutlineInput) -> DecksSaveOutlineResult:
    pod = ctx.pod
    job = pod.table("decks_job").get(data.job_id)
    deck = pod.table("decks_deck").get(job["deck_id"])
    outline = data.outline or {}
    raw = outline.get("cards") if isinstance(outline.get("cards"), list) else []
    cards = []
    for item in raw:
        if not isinstance(item, dict) or not _line(item.get("title"), 10):
            continue
        layout = item.get("layout") if item.get("layout") in LAYOUTS else "prose"
        cards.append({"title": _line(item.get("title"), 300), "outline": _line(item.get("outline"), 1000), "layout": layout})
    if not cards:
        error = "The outline came back empty. Try again, or say a little more about the deck."
        pod.table("decks_deck").update(deck["id"], {"status": "failed", "error": error})
        pod.table("decks_job").update(data.job_id, {"state": "failed", "error": error,
                                                    "finished_at": datetime.now(timezone.utc).isoformat()})
        return DecksSaveOutlineResult(deck_id=deck["id"], message=error)
    cards[0]["layout"] = "hero"
    if len(cards) > 2:
        cards[-1]["layout"] = "closing"

    old = _rows(pod.query(f"SELECT id, status FROM decks_card WHERE deck_id = {_sql(deck['id'])}"))
    written = [c for c in old if c.get("status") == "ready"]
    if written:
        # A deck that already has written cards keeps them; this outline is not used.
        error = "This deck already has written cards; its outline wasn't replaced."
        pod.table("decks_job").update(data.job_id, {"state": "failed", "error": error})
        return DecksSaveOutlineResult(deck_id=deck["id"], message=error)
    if old:
        pod.records.bulk_delete("decks_card", [c["id"] for c in old])
    pod.records.bulk_create("decks_card", [
        dict(c, deck_id=deck["id"], position=i, status="outline", version=0) for i, c in enumerate(cards, start=1)
    ])
    title = _line(outline.get("title"), 200) or cards[0]["title"]
    pod.table("decks_deck").update(deck["id"], {"title": title, "status": "outline_ready", "error": None,
                                                "card_count": len(cards)})
    pod.table("decks_job").update(data.job_id, {"summary": f"Outline ready: {len(cards)} cards."})
    return DecksSaveOutlineResult(deck_id=deck["id"], cards=len(cards), message=f"Outline ready: {len(cards)} cards.")
