#!/usr/bin/env python3
"""Copy Roadmap's shared helpers into every function, word for word.

    uv run --no-project python bin/common.py          # write them in
    uv run --no-project python bin/common.py --check  # fail if any differs

A Lemma function is one file: it cannot import a neighbour. So the helpers
every Roadmap function needs (ids, SQL quoting, dates, the settings row) live
here once, as COMMON, and sit in each functions/<name>/code.py between
`# roadmap:common` and `# end roadmap:common`. Edit them here, never there.

Larger shared parts live in the one function that owns them and are copied
from there into the others that need them (BLOCKS below): the ranking (owned
by roadmap_rank) and the outside page's rewrite (owned by roadmap_publish).
It also fills each `# contract:<name>` ... `# end contract` with
`_contract/snippets/<name>.py` word for word (the lint checks those).
"""
import re
import sys
from pathlib import Path

COMMON = '''# roadmap:common
# Shared by every Roadmap function, word for word: bin/common.py copies it in.
# Edit it there, never here.
import json as _json
import re as _re
import uuid as _uuid
from datetime import date as _date, datetime as _datetime, timedelta as _timedelta, timezone as _tz
from zoneinfo import ZoneInfo as _Zone

ROADMAP_NS = _uuid.UUID("5c0e7a3d-2b91-4f6e-8d14-9a7b3e6c1f28")
SETTINGS_ID = str(_uuid.uuid5(ROADMAP_NS, "settings"))
HORIZONS = ("none", "now", "next", "later", "shipped")
# feature.stage moves forward only: idea, planned, building, beta, live. declined is its own end.
STAGE_ORDER = {"idea": 0, "planned": 1, "building": 2, "beta": 3, "live": 4}
ZONE_ALIASES = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv",
                "US/Eastern": "America/New_York", "US/Pacific": "America/Los_Angeles"}
# User feedback's app, opened for its own work (links to check, a suggested
# feature). Its slug isn't settled until User feedback is built.
FEEDBACK_APP = "feedback"


def rid(*parts) -> str:
    """A stable id from its parts."""
    return str(_uuid.uuid5(ROADMAP_NS, ":".join(str(p) for p in parts)))


def rows(response) -> list:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def q(pod, sql: str) -> list:
    return rows(pod.query(sql))


def q_all(pod, sql: str, page: int = 1000, most: int = 20000) -> list:
    """Every row of a read, a page at a time: one read returns at most 1,000.
    `sql` has an ORDER BY and no LIMIT."""
    out: list = []
    while len(out) < most:
        got = q(pod, f"{sql} LIMIT {page} OFFSET {len(out)}")
        out += got
        if len(got) < page:
            break
    return out


def lit(value) -> str:
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def lits(values) -> str:
    return ", ".join(lit(v) for v in values) or "NULL"


def as_dict(obj) -> dict:
    if obj is None:
        return {}
    if hasattr(obj, "to_dict"):
        obj = obj.to_dict()
    return obj if isinstance(obj, dict) else {}


def now_iso() -> str:
    return _datetime.now(_tz.utc).isoformat()


def zone(name) -> _Zone:
    try:
        return _Zone(ZONE_ALIASES.get(name or "", name or "UTC"))
    except Exception:  # noqa: BLE001
        return _Zone("UTC")


def today_in(name) -> _date:
    return _datetime.now(_tz.utc).astimezone(zone(name)).date()


def day(value):
    if not value:
        return None
    if isinstance(value, _date) and not isinstance(value, _datetime):
        return value
    try:
        return _date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def stamp(value):
    if not value:
        return None
    if isinstance(value, _datetime):
        return value if value.tzinfo else value.replace(tzinfo=_tz.utc)
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def days_since(value) -> int | None:
    moment = stamp(value)
    return None if moment is None else max(0, (_datetime.now(_tz.utc) - moment).days)


def json_list(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip().startswith("["):
        try:
            got = _json.loads(value)
            return got if isinstance(got, list) else []
        except ValueError:
            return []
    return []


def json_obj(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip().startswith("{"):
        try:
            got = _json.loads(value)
            return got if isinstance(got, dict) else {}
        except ValueError:
            return {}
    return {}


def clip(value, n: int):
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def slug(text) -> str:
    out = _re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")
    return out[:60].strip("-") or "feature"


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM roadmap_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM roadmap_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["timezone"] = s.get("timezone") or "UTC"
    s["stale_days"] = 14 if s.get("stale_days") is None else int(s["stale_days"])
    if not s.get("currency"):
        try:
            deals = q(pod, "SELECT currency FROM deals_settings ORDER BY created_at LIMIT 1")
        except Exception:  # noqa: BLE001 — Deal tracker isn't here
            deals = []
        s["currency"] = (deals[0].get("currency") if deals else None) or "USD"
    s["currency"] = str(s["currency"]).upper()[:3]
    return s


def money_short(amount, currency: str) -> str:
    """"$62k", "€1.2M", "$900": a column's figure, never rounded up past what it is."""
    a = float(amount or 0)
    sign = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "JPY": "¥", "AUD": "A$", "CAD": "C$"}.get(currency, "")
    unit = "" if sign else f" {currency}"
    if a >= 1_000_000:
        text = f"{int(a / 100_000) / 10:g}M"
    elif a >= 1000:
        text = f"{int(a / 1000)}k"
    else:
        text = f"{int(a)}"
    return f"{sign}{text}{unit}"


def money_said(by_currency: dict, main: str) -> str:
    """{"USD": 62000, "EUR": 12000} -> "$62k + €12k": the main currency first, never converted."""
    parts = [money_short(by_currency[c], c) for c in sorted(by_currency, key=lambda c: (c != main, c)) if by_currency[c]]
    return " + ".join(parts) or "none"


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"
# end roadmap:common
'''

PATTERN = re.compile(r"^# roadmap:common\n.*?^# end roadmap:common\n", re.S | re.M)

# Larger shared parts: name -> the function that owns (and edits) it.
BLOCKS = {"rank": "roadmap_rank", "publish": "roadmap_publish", "page": "roadmap_spec_draft"}


def block_pattern(name: str):
    return re.compile(rf"^# roadmap:{name}\n.*?^# end roadmap:{name}\n", re.S | re.M)


def contract_snippets(root: Path) -> dict:
    out = {}
    for path in sorted((root.parent / "_contract" / "snippets").glob("*.py")):
        found = re.search(r"^# contract:[a-z0-9-]+\n.*?^# end contract\n", path.read_text(), re.S | re.M)
        if found:
            out[path.stem] = found.group(0)
    return out


def main() -> int:
    check = "--check" in sys.argv[1:]
    root = Path(__file__).resolve().parent.parent
    snippets = contract_snippets(root)
    blocks = {}
    for name, owner in BLOCKS.items():
        found = block_pattern(name).search((root / "functions" / owner / "code.py").read_text())
        if not found:
            sys.exit(f"functions/{owner}/code.py has no '# roadmap:{name}' block")
        blocks[name] = found.group(0)
    bad = 0
    for code in sorted(root.glob("functions/*/code.py")):
        text = code.read_text()
        fresh = PATTERN.sub(lambda _m: COMMON, text, count=1) if "# roadmap:common" in text else text
        for name, body in blocks.items():
            if f"# roadmap:{name}\n" in fresh:
                fresh = block_pattern(name).sub(lambda _m: body, fresh, count=1)
        for name, body in snippets.items():
            fresh = re.sub(rf"^# contract:{name}\n.*?^# end contract\n", lambda _m: body, fresh, count=1, flags=re.S | re.M)
        if fresh != text:
            if check:
                print(f"differs: {code.relative_to(root)}")
                bad += 1
            else:
                code.write_text(fresh)
                print(f"wrote {code.relative_to(root)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
