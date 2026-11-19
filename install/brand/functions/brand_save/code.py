#input_type_name: BrandSaveInput
#output_type_name: BrandSaveResult
#function_name: brand_save

"""Keep what was read about a brand: the assistant calls this once, at the end
of a read (see /brand/reading-a-brand.md), and the sample calls it too.

- Colours by role (ink, surface, surface_2, line, muted, accent, accent_ink,
  ok, bad, extra), each with what it is for and where it was found. A colour
  or face a person fixed (`brand_correction`) is kept over what was read.
- The text colour for the accent is measured, never assumed: when none is
  given, the brand colour that reads best on the accent.
- The contrast of every pair that matters is measured and returned, so the
  assistant can look again at a role that fails (and never invents a colour
  to make it pass). The Brand app shows the same numbers.
- `theme.css` and `theme.json` are written under the brand's folder, the
  guide to `guide.md`, and the evidence to `brand_evidence`.
- The brand waits for a person to check it (`state` check).
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel, Field

# --- colour: parsing, contrast (WCAG 2), and distance (CIE76 in Lab) ---
import re as _c_re

_C_HEX = _c_re.compile(r"#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b")
_C_RGB = _c_re.compile(r"rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)", _c_re.I)
_C_NAMED = {"white": "#ffffff", "black": "#000000"}


def color_parse(value):
    """(r, g, b, alpha) from #rgb, #rrggbb, #rrggbbaa, rgb()/rgba(), white, black; else None."""
    text = str(value or "").strip().lower()
    text = _C_NAMED.get(text, text)
    m = _C_HEX.fullmatch(text)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = "".join(ch * 2 for ch in h)
        alpha = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha
    m = _C_RGB.fullmatch(text)
    if m:
        def part(v, scale=255):
            return float(v[:-1]) * scale / 100 if v.endswith("%") else float(v)
        r, g, b = (max(0, min(255, round(part(v)))) for v in m.groups()[:3])
        a = m.group(4)
        alpha = max(0.0, min(1.0, part(a, 1) if a else 1.0)) if a else 1.0
        return r, g, b, alpha
    return None


def color_hex(value):
    """#rrggbb (lowercase) for a colour, ignoring alpha; None when it isn't one."""
    parsed = color_parse(value)
    return None if parsed is None else "#%02x%02x%02x" % parsed[:3]


def _c_lin(channel):
    c = channel / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def color_luminance(value):
    parsed = color_parse(value)
    if parsed is None:
        return None
    r, g, b, _ = parsed
    return 0.2126 * _c_lin(r) + 0.7152 * _c_lin(g) + 0.0722 * _c_lin(b)


def color_contrast(ink, ground):
    """The WCAG contrast ratio of two opaque colours, or None."""
    a, b = color_luminance(ink), color_luminance(ground)
    if a is None or b is None:
        return None
    hi, lo = max(a, b), min(a, b)
    return round((hi + 0.05) / (lo + 0.05), 2)


def _c_lab(value):
    parsed = color_parse(value)
    if parsed is None:
        return None
    r, g, b = (_c_lin(v) for v in parsed[:3])
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def color_distance(a, b):
    """CIE76 delta E: under about 2.3 people see no difference; we call under 6 the same colour."""
    la, lb = _c_lab(a), _c_lab(b)
    if la is None or lb is None:
        return None
    return round(sum((p - q) ** 2 for p, q in zip(la, lb)) ** 0.5, 1)
# --- end colour ---

# --- theme: the brand's tokens and theme.css, from its colours and faces ---
ROLES = ["ink", "surface", "surface_2", "line", "muted", "accent", "accent_ink", "ok", "bad"]
ROLE_TOKEN = {"ink": "--brand-ink", "surface": "--brand-surface", "surface_2": "--brand-surface-2",
              "line": "--brand-line", "muted": "--brand-muted", "accent": "--brand-accent",
              "accent_ink": "--brand-accent-ink", "ok": "--brand-ok", "bad": "--brand-bad"}
FONT_ROLES = ["display", "body", "mono"]
FALLBACK = {"display": "Georgia, serif", "body": "system-ui, sans-serif", "mono": "ui-monospace, monospace"}


def face_stack(face: dict, role: str) -> str:
    stack = (face.get("stack") or "").strip()
    family = (face.get("family") or "").strip()
    if not stack and family:
        quoted = f'"{family}"' if " " in family else family
        stack = f"{quoted}, {FALLBACK[role]}"
    return stack


def tokens_for(colors: list, fonts: dict, radius: str = "") -> dict:
    """The flat custom properties renderers apply: roles, extras, faces, radius."""
    import re as _t_re
    tokens = {}
    by_role = {c["role"]: c["value"] for c in colors if c.get("role") in ROLE_TOKEN}
    for role, token in ROLE_TOKEN.items():
        if by_role.get(role):
            tokens[token] = by_role[role]
    for i, c in enumerate([c for c in colors if c.get("role") == "extra"], 1):
        slug = _t_re.sub(r"[^a-z0-9]+", "-", (c.get("name") or f"extra-{i}").lower()).strip("-") or f"extra-{i}"
        if f"--brand-{slug}" in tokens or slug in ("font-display", "font-body", "font-mono", "radius"):
            slug = f"extra-{i}"
        tokens[f"--brand-{slug}"] = c["value"]
    for role in FONT_ROLES:
        stack = face_stack(fonts.get(role) or {}, role)
        if stack:
            tokens[f"--brand-font-{role}"] = stack
    if radius:
        tokens["--brand-radius"] = radius
    return tokens


def theme_css(name: str, tokens: dict, fonts: dict) -> str:
    """theme.css: Google faces imported first, then the tokens on :root."""
    families = []
    for role in FONT_ROLES:
        face = fonts.get(role) or {}
        if face.get("source") == "google" and face.get("family"):
            fam = face["family"].strip().replace(" ", "+")
            if fam not in families:
                families.append(fam)
    lines = [f"/* {name}: the brand's tokens, written by Brand kit. Change the brand, not this file. */"]
    if families:
        query = "&".join(f"family={f}:wght@400;500;600;700" for f in families)
        lines.insert(0, f'@import url("https://fonts.googleapis.com/css2?{query}&display=swap");')
    lines += [":root {"] + [f"  {k}: {v};" for k, v in tokens.items()] + ["}"]
    return "\n".join(lines) + "\n"
# --- end theme ---

GENERIC = {"serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy", "ui-sans-serif", "ui-serif",
           "ui-monospace", "ui-rounded", "-apple-system", "blinkmacsystemfont", "emoji", "math", "fangsong"}
EVIDENCE_KINDS = {"screenshot", "css", "copy", "document", "file"}


class Colour(BaseModel):
    role: str = Field(description="ink, surface, surface_2, line, muted, accent, accent_ink, ok, bad, or extra")
    value: str = Field(description="#rrggbb")
    name: str = ""
    # What it is for, in a few words: "Buttons and the one thing to look at".
    purpose: str = ""
    # Where it was found: "--color-primary in site.css", "the header on the home page".
    found_in: str = ""


class Face(BaseModel):
    family: str
    stack: str = ""
    weight: int | None = None
    # google, open, licensed (named, never stored), system
    source: str = ""
    note: str = ""


class Logo(BaseModel):
    # An id from brand_add_assets, or a pod path.
    asset_id: str = ""
    path: str = ""
    variant: str = "primary"
    # The ground it is for: light or dark.
    on: str = "light"


class Evidence(BaseModel):
    kind: str = Field(description="screenshot, css, copy, document or file")
    about: str = Field(description="colors, fonts, logos, voice, or one role: color:accent, font:display")
    path: str = ""
    url: str = ""
    excerpt: str = ""
    note: str = ""


class BrandSaveInput(BaseModel):
    brand_id: str
    job_id: str = ""
    name: str = ""
    site_url: str = ""
    colors: list[Colour] = []
    fonts: dict[str, Face] = {}
    voice: str = ""
    # The whole guide, in markdown. Written to <root>/guide.md.
    guide: str = ""
    logos: list[Logo] = []
    evidence: list[Evidence] = []
    # The corner radius the brand uses most, e.g. "8px".
    radius: str = ""


class Pair(BaseModel):
    pair: str
    ink: str
    ground: str
    ratio: float | None
    needs: float
    ok: bool


class BrandSaveResult(BaseModel):
    brand_id: str
    state: str
    contrast: list[Pair] = []
    kept_fixes: list[str] = []
    problems: list[str] = []
    theme_css_path: str = ""
    guide_path: str = ""
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def measure(colors: list[dict]) -> list[dict]:
    """Every pair that matters, with its WCAG ratio and what it needs."""
    by = {c["role"]: c["value"] for c in colors if c.get("role")}
    pairs = [("Body text on the page", "ink", "surface", 4.5),
             ("Secondary text on the page", "muted", "surface", 4.5),
             ("Body text on cards", "ink", "surface_2", 4.5),
             ("Text on the accent", "accent_ink", "accent", 4.5),
             ("The accent as text or a link", "accent", "surface", 3.0),
             ("Success on the page", "ok", "surface", 3.0),
             ("Error on the page", "bad", "surface", 3.0)]
    out = []
    for label, ink, ground, needs in pairs:
        if by.get(ink) and by.get(ground):
            ratio = color_contrast(by[ink], by[ground])
            out.append({"pair": label, "ink": ink, "ground": ground, "ratio": ratio, "needs": needs,
                        "ok": ratio is not None and ratio >= needs})
    return out


def brand_save(ctx: FunctionContext, data: BrandSaveInput) -> BrandSaveResult:
    pod = ctx.pod
    found = _rows(pod.query(f"SELECT * FROM brand WHERE id = {_sql(data.brand_id)}"))
    if not found:
        raise ValueError(f"No brand {data.brand_id}. brand_read makes one.")
    brand = found[0]
    root = (brand.get("root_path") or "").rstrip("/")
    if data.job_id:
        try:
            pod.records.update("brand_job", data.job_id, {"activity": "Saving the brand and measuring its contrast"})
        except Exception:  # noqa: BLE001
            pass

    problems: list[str] = []
    kept: list[str] = []

    # Colours, one per role (extras keep their order), normalised to #rrggbb.
    colors: list[dict] = []
    seen_roles: set[str] = set()
    for c in data.colors:
        value = color_hex(c.value)
        role = c.role.strip().lower().replace("-", "_").replace(" ", "_")
        if role == "surface2":
            role = "surface_2"
        if value is None:
            problems.append(f"{c.role}: {c.value!r} is not a colour; left out")
            continue
        if role not in ROLES:
            role = "extra"
        if role != "extra" and role in seen_roles:
            role = "extra"
        seen_roles.add(role)
        colors.append({"role": role, "value": value, "name": c.name.strip()[:60], "for": c.purpose.strip()[:160],
                       "from": c.found_in.strip()[:200]})
    if not data.colors and brand.get("colors"):
        colors = list(brand.get("colors") or [])

    fonts: dict[str, dict] = {}
    for role, face in (data.fonts or {}).items():
        role = role.strip().lower()
        if role not in FONT_ROLES or not face.family.strip():
            continue
        fonts[role] = {"family": face.family.strip()[:120], "stack": face_stack(face.model_dump(), role)[:400],
                       "weight": face.weight, "source": (face.source or "").strip().lower()[:16], "note": face.note[:300]}
    if not data.fonts and brand.get("fonts"):
        fonts = dict(brand.get("fonts") or {})

    # What a person fixed is kept over what was read (newest fix per role).
    fixes = _rows(pod.query(
        f"SELECT kind, subject, to_answer FROM brand_correction WHERE brand_id = {_sql(data.brand_id)} "
        "AND kind IN ('color', 'font') ORDER BY created_at DESC LIMIT 100"))
    done: set[tuple[str, str]] = set()
    for fix in fixes:
        key = (fix["kind"], fix["subject"])
        if key in done:
            continue
        done.add(key)
        to = fix.get("to_answer") if isinstance(fix.get("to_answer"), dict) else {}
        if fix["kind"] == "color" and color_hex(to.get("value")):
            value = color_hex(to["value"])
            current = next((c for c in colors if c["role"] == fix["subject"]), None)
            if current is None:
                colors.append({"role": fix["subject"], "value": value, "name": to.get("name", ""), "for": "", "from": "Your fix"})
            elif current["value"] != value:
                current.update({"value": value, "from": "Your fix (kept over the read: " + current["value"] + ")"})
            kept.append(f"{fix['subject']} {value}")
        elif fix["kind"] == "font" and to.get("family"):
            fonts[fix["subject"]] = {**fonts.get(fix["subject"], {}), **to}
            kept.append(f"{fix['subject']} face {to['family']}")

    by = {c["role"]: c["value"] for c in colors}
    for need in ("ink", "surface", "accent"):
        if need not in by:
            problems.append(f"No {need} colour: the brand needs one before anything is made in it.")
    # The text colour on the accent: measured, never assumed white.
    if by.get("accent") and not by.get("accent_ink"):
        options = [(c["value"], c["role"]) for c in colors if c["role"] in ("ink", "surface", "surface_2")]
        best = max(options, key=lambda o: color_contrast(o[0], by["accent"]) or 0, default=None)
        if best and (color_contrast(best[0], by["accent"]) or 0) >= 4.5:
            colors.append({"role": "accent_ink", "value": best[0], "name": "", "for": "Text on the accent",
                           "from": f"Measured: the brand's {best[1]} reads best on the accent"})
        else:
            plain = max(["#ffffff", "#000000"], key=lambda v: color_contrast(v, by["accent"]) or 0)
            colors.append({"role": "accent_ink", "value": plain, "name": "", "for": "Text on the accent",
                           "from": "Measured: no brand colour reads on the accent, so plain " + ("white" if plain == "#ffffff" else "black")})
            problems.append("No brand colour reads on the accent at 4.5:1; text on it is plain " + ("white" if plain == "#ffffff" else "black") + ".")
    order = {r: i for i, r in enumerate(ROLES + ["extra"])}
    colors.sort(key=lambda c: order.get(c["role"], 99))

    contrast = measure(colors)
    for p in contrast:
        if not p["ok"] and p["ratio"] is not None:
            problems.append(f"{p['pair']}: {p['ratio']}:1, needs {p['needs']}:1")

    # Logos: asset ids or paths, with their variant.
    asset_ids = [l.asset_id for l in data.logos if l.asset_id]
    assets = {a["id"]: a for a in _rows(pod.query(
        "SELECT id, file_path FROM brand_asset WHERE id IN (" + (", ".join(_sql(i) for i in asset_ids) or "NULL") + ")"))} if asset_ids else {}
    logos: list[dict] = []
    for l in data.logos:
        path = l.path or (assets.get(l.asset_id) or {}).get("file_path") or ""
        if not path:
            problems.append(f"Logo {l.asset_id or '?'}: no file; left out")
            continue
        logos.append({"variant": l.variant if l.variant in ("primary", "inverse", "mono", "mark") else "other",
                      "path": path, "on": "dark" if l.on == "dark" else "light", "asset_id": l.asset_id or None})
        if l.asset_id and l.asset_id in assets:
            pod.records.update("brand_asset", l.asset_id, {"variant": logos[-1]["variant"] if logos[-1]["variant"] != "other" else "other"})
    if not data.logos and brand.get("logos"):
        logos = list(brand.get("logos") or [])
    primary = next((l["path"] for l in logos if l["variant"] == "primary"), logos[0]["path"] if logos else None)

    tokens = tokens_for(colors, fonts, data.radius or (brand.get("tokens") or {}).get("--brand-radius", ""))
    name = data.name.strip() or brand.get("name") or "Brand"
    theme_path = f"{root}/theme.css"
    pod.files.write_text(theme_path, theme_css(name, tokens, fonts), search_enabled=False)
    pod.files.write_text(f"{root}/theme.json", json.dumps({"name": name, "tokens": tokens, "colors": colors, "fonts": fonts}, indent=2) + "\n", search_enabled=False)
    guide_path = brand.get("guide_path") or ""
    if data.guide.strip():
        guide_path = f"{root}/guide.md"
        pod.files.write_text(guide_path, data.guide.strip() + "\n")
    elif not guide_path:
        problems.append("No guide was written: the voice and the rules live there.")

    # Evidence: what this read saw. A read's evidence replaces an earlier read's
    # (its rows; the files stay); the CSS brand_site_style kept for this read stays.
    if data.job_id:
        old = [r["id"] for r in _rows(pod.query(
            f"SELECT id FROM brand_evidence WHERE brand_id = {_sql(data.brand_id)} "
            f"AND (job_id IS NULL OR job_id <> {_sql(data.job_id)}) LIMIT 500"))]
        if old:
            pod.records.bulk_delete("brand_evidence", old)
    if data.evidence:
        rows = []
        for e in data.evidence:
            kind = e.kind if e.kind in EVIDENCE_KINDS else "file"
            rows.append({"brand_id": data.brand_id, "job_id": data.job_id or None, "kind": kind, "about": (e.about or "colors")[:64],
                         "path": e.path or None, "url": e.url[:1000] or None, "excerpt": e.excerpt[:4000] or None,
                         "note": e.note[:500] or None})
        pod.records.bulk_create("brand_evidence", rows)

    patch = {"name": name[:120], "colors": colors, "fonts": fonts, "tokens": tokens, "theme_css_path": theme_path,
             "logos": logos, "logo_path": primary, "guide_path": guide_path or None, "state": "check",
             "synced_at": _now(), "checked_at": None, "checked_by": None}
    if data.voice.strip():
        patch["voice"] = data.voice.strip()[:1000]
    if data.site_url.strip():
        patch["site_url"] = data.site_url.strip()[:500]
    pod.records.update("brand", data.brand_id, patch)
    if data.job_id:
        try:
            pod.records.update("brand_job", data.job_id, {"activity": "Saved. Waiting for a person to check it."})
        except Exception:  # noqa: BLE001
            pass

    message = f"Saved {name}: {len(colors)} colours, {len(fonts)} faces, {len(logos)} logos."
    if kept:
        message += " Kept the person's fixes: " + ", ".join(kept) + "."
    if problems:
        message += " Look again at: " + "; ".join(problems[:6])
    return BrandSaveResult(brand_id=data.brand_id, state="check", contrast=[Pair(**p) for p in contrast],
                           kept_fixes=kept, problems=problems, theme_css_path=theme_path, guide_path=guide_path,
                           message=message)
