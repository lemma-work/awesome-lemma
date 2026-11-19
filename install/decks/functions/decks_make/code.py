#input_type_name: DecksMakeInput
#output_type_name: DecksMakeResult
#function_name: decks_make

"""Make a deck from one sentence.

The one way a deck starts, from the Decks app, from set-up, and from the
Lemma's assistant in chat ("make a deck about …"): a `decks_deck` row with
the sentence, its look, and an `outline` job in `decks_job` (state `wanted`),
which starts `decks-work` as the person. The outline comes back for them to
approve in Decks; no card is written before that.

The look: the Lemma's brand, read from the shared `brand` table (Brand kit's)
with the voice part of its guide, or one of the themes below. Whose choice:
`look` or `theme` in the input, else the person's set-up (decks_settings),
else the brand when there is one (someone who never opened Decks asking in
chat gets the team's brand), else the first theme.

Also the one owner of the built-in themes: `themes_only` writes them (fixed
ids, so writing them twice changes nothing) and does nothing else; set-up
calls it before showing the themes.
"""

from __future__ import annotations

import uuid
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# decks:brand
# The team's brand from the shared `brand` table (Brand kit's), as a deck's
# look and voice. The one copy is bin/brand_block.py; bin/brand-block.py puts
# it, word for word, into decks_make and decks_plan between these markers
# (--check fails on a difference). The app's brandLook (src/look.ts) draws the
# same look. Never invents a colour, a face or a logo the row lacks: what is
# missing falls back to a neutral, and a Lemma without Brand kit has no row.
import json as _b_json
import re as _b_re


def brand_row(pod):
    """The default brand whose state is check or ready, or None."""
    try:
        response = pod.query(
            "SELECT * FROM brand WHERE state IN ('check', 'ready') ORDER BY is_default DESC, updated_at DESC LIMIT 1")
    except Exception:  # noqa: BLE001 — no brand table, or nothing readable
        return None
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    items = [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]
    return items[0] if items else None


def _b_value(value, default):
    if isinstance(value, str):
        try:
            return _b_json.loads(value)
        except ValueError:
            return default
    return default if value is None else value


def _b_dark(color):
    h = str(color or "").strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return False
    try:
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return False
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45


def _b_family(stack):
    first = str(stack or "").split(",")[0].strip().strip("'\"")
    return first or None


def brand_look(row):
    """A brand row as a deck's look (the keys decks_deck.look holds)."""
    tokens = _b_value(row.get("tokens"), {}) or {}
    colors = [c for c in (_b_value(row.get("colors"), []) or []) if isinstance(c, dict)]
    fonts = _b_value(row.get("fonts"), {}) or {}
    logos = [x for x in (_b_value(row.get("logos"), []) or []) if isinstance(x, dict)]

    def role(name):
        return next((c.get("value") for c in colors if c.get("role") == name), None)

    def logo(variant):
        return next((x.get("path") for x in logos if x.get("variant") == variant), None)

    display = fonts.get("display") or fonts.get("heading") or {}
    body = fonts.get("body") or fonts.get("text") or {}
    surface = tokens.get("--brand-surface") or role("surface") or "#FFFFFF"
    dark = _b_dark(surface)
    ink = tokens.get("--brand-ink") or role("ink") or ("#F5F5F5" if dark else "#111111")
    accent = tokens.get("--brand-accent") or role("accent") or ink
    heading = display.get("family") or _b_family(tokens.get("--brand-font-display")) or "Inter"
    body_face = body.get("family") or _b_family(tokens.get("--brand-font-body")) or heading
    weight = display.get("weight")
    return {
        "source": "brand", "brand_id": row.get("id"), "name": row.get("name"),
        "surface": surface, "ink": ink, "accent": accent,
        "raised": tokens.get("--brand-surface-2") or role("surface_2") or ("#202020" if dark else "#F4F4F4"),
        "muted": tokens.get("--brand-muted") or role("muted") or ink,
        "accent_ink": tokens.get("--brand-accent-ink") or role("accent_ink") or ("#FFFFFF" if _b_dark(accent) else "#111111"),
        "heading_font": heading, "body_font": body_face,
        "heading_stack": display.get("stack") or tokens.get("--brand-font-display"),
        "body_stack": body.get("stack") or tokens.get("--brand-font-body"),
        "heading_google": display.get("source") == "google", "body_google": body.get("source") == "google",
        "heading_weight": weight if isinstance(weight, int) else None,
        "heading_office": heading, "body_office": body_face,
        "radius": tokens.get("--brand-radius") or "12px",
        "logo_path": (logo("inverse") if dark else None) or row.get("logo_path") or logo("primary") or logo("mark"),
        "logo_inverse_path": logo("inverse"),
        "dark": dark,
    }


def brand_voice(pod, row):
    """How the brand talks: its voice line, and the voice part of its guide."""
    voice = str(row.get("voice") or "").strip()
    part = ""
    if row.get("guide_path"):
        try:
            raw = pod.files.download(row["guide_path"])
            text = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw or "")
            head = _b_re.search(r"^(#{1,3})\s.*(voice|tone|how .* (talks|sounds)|writing).*$", text, _b_re.I | _b_re.M)
            if head:
                level = len(head.group(1))
                rest = text[head.end():]
                stop = _b_re.search(r"^#{1,%d}\s" % level, rest, _b_re.M)
                part = (head.group(0) + rest[: stop.start() if stop else len(rest)]).strip()
        except Exception:  # noqa: BLE001 — no guide, or not readable: the voice line stands
            part = ""
    return "\n\n".join(p for p in (voice, part[:2600]) if p)[:3800]
# end decks:brand

DECKS_NS = uuid.UUID("3f6c1d52-8a0e-4b7a-9d21-6e5b0c4a7f19")

THEMES = [
    {"key": "paper", "name": "Paper", "position": 1,
     "description": "Warm off-white, near-black type, a burnt-orange accent. Serif headings.",
     "tokens": {"surface": "#FBFAF7", "raised": "#F1EEE7", "ink": "#1C1B19", "muted": "#67635B",
                "accent": "#C2410C", "accent_ink": "#FFFFFF", "heading_font": "Source Serif 4",
                "body_font": "Inter", "heading_office": "Georgia", "body_office": "Arial", "radius": "10px", "dark": False}},
    {"key": "graphite", "name": "Graphite", "position": 2,
     "description": "Dark slate, soft white type, an amber accent. For a room with the lights down.",
     "tokens": {"surface": "#16181D", "raised": "#21252C", "ink": "#F2F2EE", "muted": "#A4A8AF",
                "accent": "#F5B83D", "accent_ink": "#16181D", "heading_font": "Inter",
                "body_font": "Inter", "heading_office": "Arial", "body_office": "Arial", "radius": "10px", "dark": True}},
    {"key": "harbor", "name": "Harbor", "position": 3,
     "description": "Cool white, deep navy type, a teal accent. Clean and calm.",
     "tokens": {"surface": "#F7FAFC", "raised": "#E8F0F5", "ink": "#0F2233", "muted": "#506A80",
                "accent": "#0E7C86", "accent_ink": "#FFFFFF", "heading_font": "Space Grotesk",
                "body_font": "Inter", "heading_office": "Arial", "body_office": "Arial", "radius": "12px", "dark": False}},
    {"key": "clay", "name": "Clay", "position": 4,
     "description": "Cream, espresso type, a forest-green accent. Friendly, a little editorial.",
     "tokens": {"surface": "#FFF8F0", "raised": "#F5E8DA", "ink": "#2B1D14", "muted": "#7A6151",
                "accent": "#2F7D4F", "accent_ink": "#FFFFFF", "heading_font": "Fraunces",
                "body_font": "Inter", "heading_office": "Georgia", "body_office": "Arial", "radius": "14px", "dark": False}},
]


def theme_id(key: str) -> str:
    return str(uuid.uuid5(DECKS_NS, f"theme:{key}"))


class DecksMakeInput(BaseModel):
    # The one sentence: what the deck is for.
    prompt: str | None = None
    notes: str | None = None
    # Files already uploaded under /decks/ (paths), read into the outline.
    files: list[str] = []
    card_count: int | None = None
    # concise, balanced or detailed
    density: str | None = None
    # brand or theme; empty: the person's own choice from set-up
    look: str | None = None
    # A theme's name or id (Paper, Graphite, Harbor, Clay, or one the team added)
    theme: str | None = None
    # app, chat or sample; empty: chat (the assistant calls without it)
    source: str | None = None
    themes_only: bool = False


class DecksMakeResult(BaseModel):
    deck_id: str | None = None
    job_id: str | None = None
    title: str | None = None
    app: str = "decks"
    path: str | None = None
    look: str | None = None
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def write_themes(pod) -> list[dict]:
    """The built-in themes, written once with fixed ids; every theme back."""
    have = {r["id"]: r for r in _rows(pod.query("SELECT id, name, tokens, position FROM decks_theme ORDER BY position, name"))}
    missing = [{"id": theme_id(t["key"]), "name": t["name"], "description": t["description"],
                "tokens": t["tokens"], "position": t["position"]}
               for t in THEMES if theme_id(t["key"]) not in have]
    if missing:
        pod.records.bulk_create("decks_theme", missing, upsert=True)
        have = {r["id"]: r for r in _rows(pod.query("SELECT id, name, tokens, position FROM decks_theme ORDER BY position, name"))}
    return sorted(have.values(), key=lambda r: (r.get("position") or 99, r.get("name") or ""))


def _theme_look(theme: dict) -> dict:
    tokens = theme.get("tokens") if isinstance(theme.get("tokens"), dict) else {}
    return dict(tokens, source="theme", theme_id=theme["id"], name=theme.get("name"))


def decks_make(ctx: FunctionContext, data: DecksMakeInput) -> DecksMakeResult:
    pod = ctx.pod
    themes = write_themes(pod)
    if data.themes_only:
        return DecksMakeResult(message=f"{len(themes)} themes ready.")

    prompt = " ".join(str(data.prompt or "").split())
    if not prompt:
        return DecksMakeResult(message="Say what the deck is for, in a sentence.")

    settings = next(iter(_rows(pod.query("SELECT * FROM decks_settings ORDER BY created_at LIMIT 1"))), {})
    me = settings.get("display_name") or (ctx.user_email or "").split("@")[0] or None

    # The look: this request, else the person's set-up, else the brand, else the first theme.
    wanted = (data.look or "").strip().lower() or None
    theme = None
    if data.theme:
        key = data.theme.strip().lower()
        theme = next((t for t in themes if t["id"] == data.theme.strip() or (t.get("name") or "").lower() == key), None)
    chose = wanted or (settings.get("look_source") if settings else None)
    look, voice = None, None
    if theme is None and chose in ("brand", None):
        brand = brand_row(pod)
        if brand:
            look, voice = brand_look(brand), brand_voice(pod, brand) or None
    if look is None:
        if theme is None and settings.get("theme_id"):
            theme = next((t for t in themes if t["id"] == settings["theme_id"]), None)
        theme = theme or themes[0]
        look = _theme_look(theme)

    count = data.card_count or settings.get("card_count") or 8
    count = max(4, min(16, int(count)))
    density = data.density if data.density in ("concise", "balanced", "detailed") else (settings.get("density") or "balanced")
    source = data.source if data.source in ("app", "chat", "sample") else "chat"
    files = [{"path": p, "name": p.rstrip("/").rsplit("/", 1)[-1]} for p in (data.files or []) if isinstance(p, str) and p.startswith("/")][:8]

    deck = pod.records.create("decks_deck", {
        "prompt": prompt[:2000], "notes": (data.notes or "").strip()[:20000] or None, "files": files or None,
        "status": "outlining", "card_count": count, "density": density, "look": look, "voice": voice,
        "source": source, "made_by": str(ctx.user_id) if ctx.user_id else None, "made_by_name": me,
    })
    deck_id = str(deck.get("id"))
    job = pod.records.create("decks_job", {"deck_id": deck_id, "kind": "outline", "state": "wanted"})
    return DecksMakeResult(
        deck_id=deck_id, job_id=str(job.get("id")), path=f"/d/{deck_id}", look=look.get("name"),
        message=(f"Writing the outline ({count} cards, {look.get('name')} look). It will be in Decks in under a minute "
                 f"for you to approve; the cards are written after that."),
    )
