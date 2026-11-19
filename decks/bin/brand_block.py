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
