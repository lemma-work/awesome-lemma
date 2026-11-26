#input_type_name: RoadmapSpecSaveEditInput
#output_type_name: RoadmapSpecSaveEditResult
#function_name: roadmap_spec_save_edit

"""Save the spec as a person edited it in the app, and rewrite its Page.

`lines` is the whole spec as the editor has it, in order: each line's
section, its key (a new line has none), its text and its quotes (feedback
ids). A line whose text or quotes changed is marked edited: a redraft keeps
it word for word and drafts around it. An edited line keeps the quotes it
had unless the person took them off, and then shows "No quote". A line left
out is taken out.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# roadmap:common
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

# roadmap:page
# A spec's Page, shared word for word by roadmap_spec_draft (where it is
# edited) and roadmap_spec_save_edit: bin/common.py copies it.
SECTIONS = [("problem", "The problem, in their words"), ("who", "Who asked"), ("need", "What they need"),
            ("not", "Not doing"), ("open", "Open questions")]
SECTION_KEYS = [k for k, _ in SECTIONS]


def tidy_lines(lines: list) -> list:
    """Lines in section order, each marked unsourced when no quote is behind it."""
    out = []
    for key, _title in SECTIONS:
        for ln in lines:
            if ln.get("section") == key and str(ln.get("text") or "").strip():
                quotes = [str(x) for x in (ln.get("quotes") or []) if x]
                out.append({"section": key, "key": str(ln.get("key") or ""), "text": clip(ln["text"], 600),
                            "quotes": list(dict.fromkeys(quotes)), "edited": bool(ln.get("edited")),
                            "unsourced": not quotes and key != "not"})
    return out


def labels_of(lines: list) -> dict:
    """feedback id -> its mark on the page, numbered in the order the spec first cites it."""
    labels: dict = {}
    for ln in lines:
        for qid in ln["quotes"]:
            labels.setdefault(qid, f"q{len(labels) + 1}")
    return labels


def page_path(pod, feature: dict, old_path) -> str:
    if old_path:
        return old_path
    path = f"/pages/roadmap/{slug(feature['name'])}.md"
    taken = q(pod, f"SELECT id FROM roadmap_spec WHERE path = {lit(path)} AND id <> {lit(feature['id'])} LIMIT 1")
    return path if not taken else f"/pages/roadmap/{slug(feature['name'])}-{str(feature['id'])[:6]}.md"


def write_page(pod, feature: dict, lines: list, labels: dict, path: str, version: int, used: int, total: int) -> str | None:
    """The spec as a Page that agents and file search read. Returns the path, or None when it couldn't be written."""
    ids = list(labels)
    quotes = {}
    for start in range(0, len(ids), 200):
        for h in q(pod, "SELECT id, quote, name, company_name, source, said_at FROM feedback "
                        f"WHERE id IN ({lits(ids[start:start + 200])})"):
            quotes[h["id"]] = h
    body = [f"# {feature['name']}", "",
            f"Roadmap spec, version {version}. Drafted from {used} of {plural(total, 'quote')} people gave; "
            "each mark links to the quote it came from. Lines marked (No quote) have nothing behind them yet.", ""]
    for key, title in SECTIONS:
        group = [ln for ln in lines if ln["section"] == key]
        if not group:
            continue
        body += [f"## {title}", ""]
        for ln in group:
            marks = "".join(f"[^{labels[qid]}]" for qid in ln["quotes"] if qid in labels)
            body.append(f"- {ln['text']}{marks}" + (" (No quote)" if ln["unsourced"] else ""))
        body.append("")
    if labels:
        for qid, mark in labels.items():
            h = quotes.get(qid) or {}
            when = day(h.get("said_at"))
            said = ", ".join(x for x in [h.get("name"), h.get("company_name"), h.get("source"),
                                         f"{when.day} {when.strftime('%b %Y')}" if when else None] if x)
            text = clip(h.get("quote"), 400) or "(this quote is no longer filed here)"
            body.append(f"[^{mark}]: “{text}” {said}. [Open the quote](/roadmap/q/{qid})")
        body.append("")
    text = "\n".join(body)
    try:
        for folder in ("/pages", "/pages/roadmap"):
            try:
                pod.files.create_folder(folder)
            except Exception:  # noqa: BLE001 — there already
                pass
        pod.files.write_text(path, text)
        return path
    except Exception:  # noqa: BLE001 — the row still holds every line
        return None
# end roadmap:page


class RoadmapSpecSaveEditInput(BaseModel):
    feature_id: str
    lines: list[dict]


class RoadmapSpecSaveEditResult(BaseModel):
    lines: int
    edited: int
    unsourced: int
    path: str | None
    message: str


def roadmap_spec_save_edit(ctx: FunctionContext, data: RoadmapSpecSaveEditInput) -> RoadmapSpecSaveEditResult:
    pod = ctx.pod
    found = q(pod, f"SELECT id, name FROM feature WHERE id = {lit(data.feature_id)}")
    if not found:
        raise ValueError(f"No feature {data.feature_id}.")
    f = found[0]
    old = (q(pod, f"SELECT * FROM roadmap_spec WHERE id = {lit(f['id'])}") or [{}])[0]
    before = {ln.get("key"): ln for ln in json_list(old.get("lines")) if isinstance(ln, dict) and ln.get("key")}
    filed = {r["id"] for r in q_all(pod, f"SELECT id FROM feedback WHERE feature_id = {lit(f['id'])} ORDER BY id")}
    given, n_new = [], 0
    for ln in data.lines:
        if not isinstance(ln, dict) or ln.get("section") not in SECTION_KEYS or not str(ln.get("text") or "").strip():
            continue
        was = before.get(ln.get("key"))
        quotes = [str(x) for x in (ln.get("quotes") if ln.get("quotes") is not None else (was or {}).get("quotes") or [])
                  if str(x) in filed or str(x) in ((was or {}).get("quotes") or [])]
        text = clip(ln["text"], 600)
        if was is None:
            n_new += 1
            key = f"p{int(old.get('version') or 0)}-{n_new}-{str(_uuid.uuid4())[:6]}"
            edited = True
        else:
            key = was["key"]
            edited = bool(was.get("edited")) or text != was.get("text") or quotes != list(was.get("quotes") or []) \
                or ln.get("section") != was.get("section")
        given.append({"section": ln["section"], "key": key, "text": text, "quotes": quotes, "edited": edited})
    lines = tidy_lines(given)
    labels = labels_of(lines)
    total = q(pod, f"SELECT COUNT(*) AS n FROM feedback WHERE feature_id = {lit(f['id'])} AND state <> 'set_aside'")
    total_n = int((total[0] if total else {}).get("n") or 0)
    version = int(old.get("version") or 0) or 1
    path = page_path(pod, f, old.get("path"))
    wrote = write_page(pod, f, lines, labels, path, version, len(labels), total_n)
    unsourced = sum(1 for ln in lines if ln["unsourced"])
    edited = sum(1 for ln in lines if ln["edited"])
    keep = {k: v for k, v in old.items() if k not in ("created_at", "updated_at")}
    pod.records.bulk_create("roadmap_spec", [dict(keep, id=f["id"], path=wrote or path, version=version, state="ready",
                                                  lines=lines, labels=labels, unsourced=unsourced, edited=edited,
                                                  quotes_used=len(labels), quotes_total=total_n,
                                                  error=None if wrote else "Saved here, but the Page couldn't be written.")],
                            upsert=True)
    return RoadmapSpecSaveEditResult(lines=len(lines), edited=edited, unsourced=unsourced, path=wrote,
                                     message=f"Saved. {plural(edited, 'line')} edited by the team; a redraft keeps them as they are.")
