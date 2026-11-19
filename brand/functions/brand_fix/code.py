#input_type_name: BrandFixInput
#output_type_name: BrandFixResult
#function_name: brand_fix

"""A person fixes what Brand kit has, from the Brand app (or the assistant, at
their word). Each fix is kept as a `brand_correction`, and teaches:

- a colour or a face: the brand changes now (theme.css too), and a later
  read keeps the fix over what it reads;
- what an asset is (logo, icon, photo, illustration, other; the brand's own
  or not): the fix goes with every later "What is this asset?" call as an
  example;
- whether a design follows the brand, and the rule it broke: the fix goes
  with every later brand check as an example;
- the voice: the brand's voice line.

`looks_right` is the end of checking: the brand is ready, and the person's
"Check the brand" item closes.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

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

KINDS = ("logo", "icon", "photo", "illustration", "other")
RULES = ("none", "colour", "type", "logo", "contrast", "voice", "other")


class ColourFix(BaseModel):
    role: str
    value: str
    name: str = ""


class FaceFix(BaseModel):
    role: str
    family: str
    stack: str = ""
    source: str = ""


class AssetFix(BaseModel):
    id: str
    kind: str = ""
    own: bool | None = None
    variant: str = ""
    # Put it away, or bring it back.
    hidden: bool | None = None


class VersionFix(BaseModel):
    id: str
    follows: bool
    broke: str = "none"


class BrandFixInput(BaseModel):
    brand_id: str = ""
    colors: list[ColourFix] = []
    fonts: list[FaceFix] = []
    voice: str = ""
    asset: AssetFix | None = None
    version: VersionFix | None = None
    looks_right: bool = False
    by_name: str = ""


class BrandFixResult(BaseModel):
    fixed: list[str] = []
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _theme(name: str, colors: list[dict], fonts: dict, tokens: dict) -> tuple[dict, str]:
    fresh = tokens_for(colors, fonts, tokens.get("--brand-radius", ""))
    return fresh, theme_css(name, fresh, fonts)


def brand_fix(ctx: FunctionContext, data: BrandFixInput) -> BrandFixResult:
    pod = ctx.pod
    by = (data.by_name or "").strip() or ((ctx.user_email or "").split("@")[0].replace(".", " ").title() or None)
    fixed: list[str] = []
    corrections: list[dict] = []
    brand: dict = {}
    if data.brand_id:
        found = _rows(pod.query(f"SELECT * FROM brand WHERE id = {_sql(data.brand_id)}"))
        if not found:
            raise ValueError(f"No brand {data.brand_id}.")
        brand = found[0]

    if brand and (data.colors or data.fonts or data.voice.strip()):
        colors = [dict(c) for c in (brand.get("colors") or [])]
        fonts = {k: dict(v) for k, v in (brand.get("fonts") or {}).items() if isinstance(v, dict)}
        for fix in data.colors:
            value = color_hex(fix.value)
            role = fix.role.strip().lower()
            if not value:
                raise ValueError(f"{fix.value!r} is not a colour.")
            current = next((c for c in colors if c.get("role") == role and (role != "extra" or c.get("name") == fix.name)), None)
            before = current.get("value") if current else None
            if current is None:
                colors.append({"role": role, "value": value, "name": fix.name, "for": "", "from": "Your fix"})
            else:
                current.update({"value": value, "from": f"Fixed by {by or 'a person'} (was {before})"})
            corrections.append({"kind": "color", "brand_id": brand["id"], "subject": role, "from_answer": {"value": before},
                                "to_answer": {"value": value, "name": fix.name or (current or {}).get("name", "")}, "by_name": by})
            fixed.append(f"{role} {before} → {value}")
        for fix in data.fonts:
            role = fix.role.strip().lower()
            if role not in FALLBACK or not fix.family.strip():
                continue
            family = fix.family.strip()
            stack = fix.stack.strip() or face_stack({"family": family}, role)
            before = (fonts.get(role) or {}).get("family")
            fonts[role] = {**fonts.get(role, {}), "family": family, "stack": stack, "source": fix.source or (fonts.get(role) or {}).get("source", "")}
            corrections.append({"kind": "font", "brand_id": brand["id"], "subject": role, "from_answer": {"family": before},
                                "to_answer": {"family": family, "stack": stack, "source": fonts[role]["source"]}, "by_name": by})
            fixed.append(f"{role} face {before} → {family}")
        tokens, css = _theme(brand.get("name") or "Brand", colors, fonts, brand.get("tokens") or {})
        patch: dict = {"colors": colors, "fonts": fonts, "tokens": tokens}
        if data.voice.strip():
            patch["voice"] = data.voice.strip()[:1000]
            corrections.append({"kind": "voice", "brand_id": brand["id"], "subject": "voice", "from_answer": {"voice": brand.get("voice")},
                                "to_answer": {"voice": patch["voice"]}, "by_name": by})
            fixed.append("voice")
        root = (brand.get("root_path") or "").rstrip("/")
        theme = brand.get("theme_css_path") or f"{root}/theme.css"
        pod.files.write_text(theme, css, search_enabled=False)
        pod.files.write_text(f"{root}/theme.json", json.dumps({"name": brand.get("name"), "tokens": tokens, "colors": colors, "fonts": fonts}, indent=2) + "\n", search_enabled=False)
        patch["theme_css_path"] = theme
        pod.records.update("brand", brand["id"], patch)

    if data.asset:
        rows = _rows(pod.query(f"SELECT * FROM brand_asset WHERE id = {_sql(data.asset.id)}"))
        if not rows:
            raise ValueError(f"No asset {data.asset.id}.")
        asset = rows[0]
        patch = {"sorted_by": "person"}
        kind = data.asset.kind if data.asset.kind in KINDS else asset.get("kind")
        own = data.asset.own if data.asset.own is not None else asset.get("own")
        if own is None:
            own = True
        if data.asset.kind and data.asset.kind in KINDS:
            patch["kind"] = kind
        patch["own"] = own
        if data.asset.variant in ("primary", "inverse", "mono", "mark", "other"):
            patch["variant"] = data.asset.variant
        hidden = data.asset.hidden if data.asset.hidden is not None else (own is False)
        patch["state"] = "hidden" if hidden else "kept"
        patch["reason"] = {"logo": "A logo", "icon": "An icon", "photo": "A photo", "illustration": "An illustration",
                           "other": "Something else"}.get(kind or "other", "Something else") + (", not the brand's own" if own is False else "") + f" (said by {by or 'a person'})"
        pod.records.update("brand_asset", asset["id"], patch)
        if kind != asset.get("kind") or own != asset.get("own"):
            corrections.append({"kind": "asset", "brand_id": asset["brand_id"], "subject": asset["id"],
                                "from_answer": {"kind": asset.get("kind"), "own": asset.get("own")},
                                "to_answer": {"kind": kind, "own": own}, "evidence": asset.get("evidence"), "by_name": by})
        fixed.append(f"asset {asset.get('label') or asset['id'][:8]}: {kind}{'' if own else ', not theirs'}")
        # A logo fixed in or out changes the brand's logos.
        owner = _rows(pod.query(f"SELECT id, logos, logo_path FROM brand WHERE id = {_sql(asset['brand_id'])}"))
        if owner:
            logos = [l for l in (owner[0].get("logos") or []) if l.get("path") != asset.get("file_path")]
            if kind == "logo" and own and not hidden:
                logos.append({"variant": patch.get("variant") or asset.get("variant") or "primary", "path": asset.get("file_path"),
                              "on": "dark" if (patch.get("variant") or asset.get("variant")) == "inverse" else "light", "asset_id": asset["id"]})
            primary = next((l["path"] for l in logos if l.get("variant") == "primary"), logos[0]["path"] if logos else None)
            if logos != (owner[0].get("logos") or []):
                pod.records.update("brand", owner[0]["id"], {"logos": logos, "logo_path": primary})

    if data.version:
        rows = _rows(pod.query(f"SELECT * FROM brand_version WHERE id = {_sql(data.version.id)}"))
        if not rows:
            raise ValueError(f"No version {data.version.id}.")
        version = rows[0]
        broke = "none" if data.version.follows else (data.version.broke if data.version.broke in RULES and data.version.broke != "none" else "other")
        verdict = "follows" if data.version.follows else "breaks"
        words = {"colour": "a colour that isn't the brand's", "type": "a face that isn't the brand's", "logo": "the logo",
                 "contrast": "text too faint to read", "voice": "words that don't sound like the brand", "other": "the brand guide"}
        reason = (f"Follows the brand (said by {by or 'a person'})." if data.version.follows
                  else f"Breaks the brand: {words.get(broke)} (said by {by or 'a person'}).")
        pod.records.update("brand_version", version["id"], {"verdict": verdict, "broke": broke, "reason": reason, "judged_by": "person"})
        corrections.append({"kind": "check", "subject": version["id"], "from_answer": {"follows": version.get("verdict") == "follows", "broke": version.get("broke")},
                            "to_answer": {"follows": data.version.follows, "broke": broke}, "evidence": version.get("evidence"), "by_name": by})
        design = _rows(pod.query(f"SELECT id, version, state, brand_id FROM brand_design WHERE id = {_sql(version['design_id'])}"))
        if design:
            corrections[-1]["brand_id"] = design[0]["brand_id"]
            if design[0]["version"] == version["version"] and design[0]["state"] in ("review", "off_brand"):
                pod.records.update("brand_design", design[0]["id"], {"state": "review" if data.version.follows else "off_brand"})
        fixed.append(f"version {version['version']}: {verdict}")

    if data.looks_right and brand:
        pod.records.update("brand", brand["id"], {"state": "ready", "checked_at": _now(), "checked_by": by})
        fixed.append("checked")

    if corrections:
        pod.records.bulk_create("brand_correction", corrections)
    try:
        pod.functions.run("brand_needs_you", {})
    except Exception:  # noqa: BLE001
        pass
    return BrandFixResult(fixed=fixed, message=("Fixed: " + "; ".join(fixed)) if fixed else "Nothing to fix.")
