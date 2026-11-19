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
