#input_type_name: DecksSaveCardInput
#output_type_name: DecksSaveCardResult
#function_name: decks_save_card

"""Keep one card `decks-writer` wrote, the moment it lands, so the deck fills
in card by card while the person watches.

What the writer returns is checked against the content model: only the
block types and fields the renderer and the PowerPoint export know, icons
from the shared list, figures as short strings. A card whose blocks all fail
the check is kept as `failed` with its outline, never as an empty slide.
On an edit the card's `version` goes up and `edit_id` names the job, so the
app can show what the request changed.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

LAYOUTS = ("hero", "prose", "bullets", "two-column", "quote", "stats", "visual-left", "visual-right", "closing")
ICONS = {
    "alert-triangle", "bar-chart", "battery", "brain", "calendar", "check-circle", "clock", "code", "coffee", "database",
    "dollar-sign", "eye", "flag", "globe", "heart", "home", "layers", "lightbulb", "link", "lock", "map-pin",
    "message-circle", "moon", "package", "pie-chart", "repeat", "rocket", "search", "send", "settings", "shield",
    "smile", "sparkles", "star", "sun", "target", "thumbs-up", "trending-down", "trending-up", "users", "wrench",
    "x-circle", "zap",
}


class DecksSaveCardInput(BaseModel):
    job_id: str
    card_id: str
    card: dict = {}


class DecksSaveCardResult(BaseModel):
    card_id: str
    status: str
    message: str


def _t(value: Any, size: int) -> str:
    return " ".join(str(value or "").split())[:size]


def _icon(value: Any) -> str | None:
    name = str(value or "").strip().lower()
    return name if name in ICONS else None


def clean_blocks(raw: Any) -> list[dict]:
    """Only what the renderer and the export know."""
    out: list[dict] = []
    for b in raw if isinstance(raw, list) else []:
        if not isinstance(b, dict):
            continue
        kind = b.get("type")
        if kind in ("heading", "text") and _t(b.get("text"), 1):
            out.append({"type": kind, "text": _t(b.get("text"), 900)})
        elif kind == "quote" and _t(b.get("text"), 1):
            out.append({"type": "quote", "text": _t(b.get("text"), 500), "attribution": _t(b.get("attribution"), 160) or None})
        elif kind == "bullets":
            items = []
            for item in b.get("items") or []:
                text = _t(item.get("text") if isinstance(item, dict) else item, 300)
                if text:
                    items.append({"text": text, "icon": _icon(item.get("icon")) if isinstance(item, dict) else None})
            if items:
                if any(i["icon"] for i in items) and not all(i["icon"] for i in items):
                    items = [dict(i, icon=None) for i in items]
                out.append({"type": "bullets", "items": items[:6]})
        elif kind == "stats":
            items = []
            for item in b.get("items") or []:
                if isinstance(item, dict) and _t(item.get("value"), 1):
                    # `source` is where a figure that stays current will plug in (README).
                    items.append({"value": _t(item.get("value"), 24), "label": _t(item.get("label"), 120),
                                  "icon": _icon(item.get("icon")), "source": item.get("source") if isinstance(item.get("source"), dict) else None})
            if items:
                out.append({"type": "stats", "items": items[:4]})
        elif kind == "columns":
            cols = []
            for c in b.get("columns") or []:
                if isinstance(c, dict) and (_t(c.get("heading"), 1) or _t(c.get("body"), 1)):
                    cols.append({"heading": _t(c.get("heading"), 80), "body": _t(c.get("body"), 400), "icon": _icon(c.get("icon"))})
            if cols:
                out.append({"type": "columns", "columns": cols[:3]})
        elif kind == "visual":
            out.append({"type": "visual", "hint": _t(b.get("hint"), 200) or "abstract"})
    return out[:6]


def decks_save_card(ctx: FunctionContext, data: DecksSaveCardInput) -> DecksSaveCardResult:
    pod = ctx.pod
    job = pod.table("decks_job").get(data.job_id)
    card = pod.table("decks_card").get(data.card_id)
    written = data.card or {}
    blocks = clean_blocks(written.get("blocks"))
    layout = written.get("layout") if written.get("layout") in LAYOUTS else card.get("layout") or "prose"
    if card.get("position") == 1:
        layout = "hero"
    has_text = any(b["type"] != "visual" for b in blocks)
    if not has_text and layout not in ("hero",):
        # Keep what it had: an edit leaves the card as it was, a first write keeps its outline.
        status = "ready" if job.get("kind") == "edit" and card.get("blocks") else "failed"
        pod.table("decks_card").update(data.card_id, {"status": status})
        return DecksSaveCardResult(card_id=data.card_id, status=status, message="The writer returned nothing usable for this card.")
    update = {
        "title": _t(written.get("title"), 300) or card.get("title"),
        "layout": layout,
        "blocks": blocks,
        "notes": _t(written.get("notes"), 4000) or card.get("notes"),
        "status": "ready",
        "version": int(card.get("version") or 0) + 1,
    }
    if job.get("kind") == "edit":
        update["edit_id"] = data.job_id
    pod.table("decks_card").update(data.card_id, update)
    return DecksSaveCardResult(card_id=data.card_id, status="ready", message=f"Card {card.get('position')} written.")
