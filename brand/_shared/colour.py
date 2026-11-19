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
