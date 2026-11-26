#input_type_name: RoadmapSpecDraftInput
#output_type_name: RoadmapSpecDraftResult
#function_name: roadmap_spec_draft

"""Draft one feature's spec, in two steps around the roadmap-spec-writer
agent (the roadmap-spec workflow: brief, write, save).

`brief` (before the writer) picks what the spec is drafted from:

- the feature's facts (who asked, by company, blockers, deals);
- its quotes, up to about 60 KB: every quote a person-edited line cites,
  then quotes marked blocker first, at most two per company on that first
  pass, then the rest newest first. Each gets a key (q1, q2, ...) the writer
  cites, and the brief keeps which quote each key is;
- the lines a person edited, with their keys, so the writer does not repeat
  them and a redraft never rewrites them.

`save` (after the writer) checks every key the writer cited against the
brief. A key the brief did not give is dropped, and a line left with no quote
is marked unsourced ("No quote"); a "not doing" line is the team's decision
and needs none. It keeps the edited lines as they were, writes the spec as a
Page, /pages/roadmap/<feature>.md, with a footnote per quote linking to it
in the app (/roadmap/q/<feedback id>), and the `roadmap_spec` row with each
line's quotes. A writer that wrote nothing leaves the spec as it was and says
why.
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

# roadmap:rank
# The ranking, shared word for word by roadmap_rank (where it is edited),
# roadmap_feature, roadmap_tick and roadmap_spec_draft: bin/common.py copies it.
# apps/roadmap/source/src/rank.ts does the same in the app: change both.
IMPORTANCE = {"blocker": 3, "important": 2, "nice": 1, "unknown": 0}
COUNTED_ASKS = ("open", "declined", "shipped", "told")
TELL_ASKS = ("open", "shipped")
HORIZON_ORDER = {"now": 0, "next": 1, "later": 2, "shipped": 3, "none": 4}
# Sorting by stage puts the work furthest along first.
STAGE_RANK = {"building": 5, "beta": 4, "planned": 3, "idea": 2, "live": 1, "declined": 0}
SORTS = ("people", "companies", "blockers", "open", "won", "last_asked", "quotes", "stage", "horizon")


def feature_list(pod) -> tuple[list, set]:
    """Every feature not about a rival's product, each with its area (its
    parents' names), and the rival products' ids."""
    rival = {r["id"] for r in q(pod, "SELECT id FROM product WHERE role = 'rival' LIMIT 1000")}
    every = q_all(pod, "SELECT id, name, description, parent_id, state, merged_into, stage, stage_at, owner_user_id, "
                       "product_id, work_source, work_id, work_url, task_id FROM feature ORDER BY name, id")
    by_id = {f["id"]: f for f in every}
    out = []
    for f in every:
        if f.get("product_id") in rival:
            continue
        names, seen, parent = [], set(), f.get("parent_id")
        while parent and parent in by_id and parent not in seen and len(names) < 3:
            seen.add(parent)
            names.append(by_id[parent]["name"])
            parent = by_id[parent].get("parent_id")
        out.append(dict(f, area=" › ".join(reversed(names))))
    return out, rival


def heard_of(pod, feature_ids, rival: set, since=None) -> list:
    """Quotes filed under these features (not set aside, not about a rival)."""
    out, ids = [], list(feature_ids)
    for start in range(0, len(ids), 200):
        where = f"feature_id IN ({lits(ids[start:start + 200])}) AND state <> 'set_aside'"
        if rival:
            where += f" AND (product_id IS NULL OR product_id NOT IN ({lits(sorted(rival))}))"
        if since:
            where += f" AND said_at >= {lit(since)}"
        out += q_all(pod, "SELECT id, feature_id, handle_kind, handle, name, company_id, company_name, importance, said_at, "
                          f"source FROM feedback WHERE {where} ORDER BY said_at DESC, id")
    return out


def works_of(features) -> dict:
    """(work_source, work_id) -> feature id: the feature itself, and its linked work."""
    works = {}
    for f in features:
        works[("feature", str(f["id"]))] = f["id"]
        if f.get("work_source") and f.get("work_id"):
            works[(str(f["work_source"]), str(f["work_id"]))] = f["id"]
    return works


def asks_of(pod, features, since=None) -> dict:
    """feature id -> its asks (open, declined, shipped or told)."""
    works = works_of(features)
    keys, out = list(works), {}
    for start in range(0, len(keys), 150):
        by_source: dict = {}
        for source, work in keys[start:start + 150]:
            by_source.setdefault(source, []).append(work)
        cond = " OR ".join(f"(work_source = {lit(s)} AND work_id IN ({lits(w)}))" for s, w in by_source.items())
        where = f"({cond}) AND state IN ({lits(COUNTED_ASKS)})"
        if since:
            where += f" AND asked_at >= {lit(since)}"
        for a in q_all(pod, "SELECT id, work_source, work_id, handle_kind, handle, name, company_id, company_name, asked_at, "
                            f"state, source FROM ask WHERE {where} ORDER BY asked_at DESC, id"):
            fid = works.get((str(a["work_source"]), str(a["work_id"])))
            if fid:
                out.setdefault(fid, []).append(a)
    return out


def deals_of(pod, company_ids) -> dict:
    """company id -> its open and won deals, biggest first."""
    ids, out = sorted({c for c in company_ids if c}), {}
    for start in range(0, len(ids), 300):
        for d in q_all(pod, "SELECT id, name, company_id, status, stage, amount, currency FROM deal "
                            f"WHERE company_id IN ({lits(ids[start:start + 300])}) AND status IN ('open', 'won') "
                            "ORDER BY amount DESC, id"):
            out.setdefault(d["company_id"], []).append(d)
    return out


def progress_of(pod, project_ids) -> dict:
    """project id -> {name, state, total, done, moved}: tasks not canceled, and the newest change to one."""
    ids = sorted({p for p in project_ids if p})
    if not ids:
        return {}
    got = {r["project_id"]: r for r in q(pod, (
        "SELECT project_id, COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done, "
        f"MAX(updated_at) AS moved FROM task WHERE project_id IN ({lits(ids)}) AND status <> 'canceled' GROUP BY project_id"))}
    names = {p["id"]: p for p in q(pod, f"SELECT id, name, state FROM project WHERE id IN ({lits(ids)})")}
    out = {}
    for pid in ids:
        r, p = got.get(pid) or {}, names.get(pid)
        out[pid] = {"project_id": pid, "name": p.get("name") if p else None, "state": p.get("state") if p else "gone",
                    "total": int(r.get("total") or 0), "done": int(r.get("done") or 0), "moved": r.get("moved")}
    return out


def who_key(kind, handle):
    if not handle:
        return None
    return f"{str(kind or 'other').strip().lower()}:{str(handle).strip().lower()}"


def tally(heard: list, asks: list, deals: dict, main: str) -> dict:
    """One feature's numbers from its quotes, its asks and its companies' deals."""
    people, tell, companies, blockers = set(), set(), set(), set()
    quotes, last = 0, None
    for h in heard:
        quotes += 1
        last = max(last or "", str(h.get("said_at") or "")) or None
        key = who_key(h.get("handle_kind"), h.get("handle"))
        if key:
            people.add(key)
        if h.get("company_id"):
            companies.add(h["company_id"])
            if h.get("importance") == "blocker":
                blockers.add(h["company_id"])
    for a in asks:
        last = max(last or "", str(a.get("asked_at") or "")) or None
        key = who_key(a.get("handle_kind"), a.get("handle"))
        if key:
            people.add(key)
            if a.get("state") in TELL_ASKS:
                tell.add(key)
        if a.get("company_id"):
            companies.add(a["company_id"])
    open_, won = {}, {}
    for c in companies:
        for d in deals.get(c) or []:
            cur = str(d.get("currency") or main).upper()[:3]
            pot = open_ if d.get("status") == "open" else won
            pot[cur] = pot.get(cur, 0.0) + float(d.get("amount") or 0)
    return {"people": len(people), "companies": len(companies), "blockers": len(blockers), "quotes": quotes,
            "last_asked": last, "tell": len(tell), "open": open_, "won": won, "company_ids": sorted(companies),
            "open_main": open_.get(main, 0.0), "won_main": won.get(main, 0.0)}


def sort_rows(rows_: list, by: str = "people") -> list:
    by = by if by in SORTS else "people"

    def key(r):
        first = {"stage": STAGE_RANK.get(r["stage"], 0), "horizon": -HORIZON_ORDER.get(r["horizon"], 4),
                 "last_asked": r.get("last_asked") or "", "open": r["open_main"], "won": r["won_main"]}.get(by, r.get(by) or 0)
        return (first, r["people"], r["companies"], r.get("last_asked") or "")
    # Ties go by name, A to Z: a stable sort keeps that order under the reversed one.
    return sorted(sorted(rows_, key=lambda r: r["name"].lower()), key=key, reverse=True)


def rank(pod, s: dict, since_days=None, company_id=None, feature_ids=None, sort="people") -> dict:
    """The ranked features (every active one, or these), the suggested ones, and the main currency."""
    main = s["currency"]
    features, rival = feature_list(pod)
    wanted = set(feature_ids) if feature_ids is not None else None
    active = [f for f in features if f.get("state") == "active" and (wanted is None or f["id"] in wanted)]
    suggested = [f for f in features if f.get("state") == "suggested"] if wanted is None else []
    since = (_datetime.now(_tz.utc) - _timedelta(days=int(since_days))).isoformat() if since_days else None
    heard = heard_of(pod, [f["id"] for f in active + suggested], rival, since) if active or suggested else []
    by_feature: dict = {}
    for h in heard:
        by_feature.setdefault(h["feature_id"], []).append(h)
    asks = asks_of(pod, active, since) if active else {}
    company_ids = {h.get("company_id") for f in active for h in by_feature.get(f["id"], [])} | {
        a.get("company_id") for f in active for a in asks.get(f["id"], [])}
    deals = deals_of(pod, company_ids)
    where = f"WHERE id IN ({lits(sorted(wanted))})" if wanted is not None else ""
    items = {r["id"]: r for r in q_all(pod, f"SELECT * FROM roadmap_item {where} ORDER BY id")}
    specs = {r["id"]: r for r in q_all(pod, "SELECT id, state, version, drafted_at, unsourced, quotes_used, quotes_total "
                                            f"FROM roadmap_spec {where} ORDER BY id")}
    progress = progress_of(pod, [i.get("project_id") for i in items.values()])
    out = []
    for f in active:
        t = tally(by_feature.get(f["id"], []), asks.get(f["id"], []), deals, main)
        if company_id and company_id not in t["company_ids"]:
            continue
        it = items.get(f["id"]) or {}
        horizon = it.get("horizon") or "none"
        prog = progress.get(it.get("project_id")) if it.get("project_id") else None
        moved_days = days_since(prog.get("moved")) if prog and prog.get("total") else None
        stale = bool(horizon == "now" and moved_days is not None and moved_days >= s["stale_days"]
                     and prog["done"] < prog["total"])
        spec = specs.get(f["id"]) or {}
        out.append(dict(t, id=f["id"], name=f["name"], area=f.get("area") or "", description=f.get("description"),
                        stage=f.get("stage") or "idea", parent_id=f.get("parent_id"), horizon=horizon,
                        horizon_at=it.get("horizon_at"), owner_user_id=it.get("owner_user_id"),
                        owner_label=it.get("owner_label"), project_id=it.get("project_id"), public=bool(it.get("public")),
                        public_title=it.get("public_title"), shipped_on=it.get("shipped_on"), progress=prog,
                        moved_days=moved_days, stale=stale, spec_state=spec.get("state"), spec_version=spec.get("version"),
                        open_text=money_said(t["open"], main) if t["open"] else None,
                        won_text=money_said(t["won"], main) if t["won"] else None))
    sugg = []
    for f in suggested:
        hs = by_feature.get(f["id"], [])
        if hs:
            sugg.append({"id": f["id"], "name": f["name"], "quotes": len(hs),
                         "companies": len({h["company_id"] for h in hs if h.get("company_id")})})
    sugg.sort(key=lambda x: (x["quotes"], x["companies"]), reverse=True)
    return {"currency": main, "since_days": since_days, "features": sort_rows(out, sort), "suggested": sugg}
# end roadmap:rank

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

BUDGET = 60_000


class RoadmapSpecDraftInput(BaseModel):
    mode: str = "brief"
    feature_id: str | None = None
    # save: the brief's keys (key -> feedback id) and what the writer wrote.
    keys: dict | None = None
    written: dict | None = None


class RoadmapSpecDraftResult(BaseModel):
    skip: bool = False
    feature_id: str | None = None
    brief: dict | None = None
    keys: dict | None = None
    lines: int = 0
    dropped: int = 0
    unsourced: int = 0
    message: str


def _spec_row(pod, fid: str) -> dict:
    return (q(pod, f"SELECT * FROM roadmap_spec WHERE id = {lit(fid)}") or [{}])[0]


def _fail(pod, fid: str, old: dict, why: str) -> None:
    keep = {k: v for k, v in old.items() if k not in ("created_at", "updated_at")}
    pod.records.bulk_create("roadmap_spec", [dict(keep, id=fid, state="failed", error=clip(why, 600))], upsert=True)


def _brief(pod, s: dict, fid: str) -> RoadmapSpecDraftResult:
    got = rank(pod, s, feature_ids=[fid])
    if not got["features"]:
        return RoadmapSpecDraftResult(skip=True, feature_id=fid, message="That feature isn't active, so it has no spec.")
    r = got["features"][0]
    features, rival = feature_list(pod)
    f = next(x for x in features if x["id"] == fid)
    heard = q_all(pod, "SELECT id, quote, point, kind, importance, handle_kind, handle, name, company_id, company_name, source, "
                       f"said_at FROM feedback WHERE feature_id = {lit(fid)} AND state <> 'set_aside' "
                       + (f"AND (product_id IS NULL OR product_id NOT IN ({lits(sorted(rival))})) " if rival else "")
                       + "ORDER BY said_at DESC, id")
    old = _spec_row(pod, fid)
    if not heard:
        _fail(pod, fid, old, "Nothing is filed under this feature yet, so there is nothing to draft from.")
        return RoadmapSpecDraftResult(skip=True, feature_id=fid, message=f"{f['name']}: no quotes filed under it yet.")
    kept = [ln for ln in json_list(old.get("lines")) if isinstance(ln, dict) and ln.get("edited")]
    names = {c["id"]: c["name"] for c in q(pod, f"SELECT id, name FROM company WHERE id IN ({lits(r['company_ids'])})")} \
        if r["company_ids"] else {}
    by_id = {h["id"]: h for h in heard}
    ordered = sorted(heard, key=lambda h: (IMPORTANCE.get(h.get("importance") or "unknown", 0), str(h.get("said_at") or "")),
                     reverse=True)
    first, per = [], {}
    for h in ordered:
        who = h.get("company_id") or (f"p:{h.get('handle')}" if h.get("handle") else h["id"])
        if per.get(who, 0) < 2:
            per[who] = per.get(who, 0) + 1
            first.append(h)
    picked = {h["id"] for h in first}
    rest = [h for h in heard if h["id"] not in picked]  # newest first already
    must = [by_id[qid] for ln in kept for qid in (ln.get("quotes") or []) if qid in by_id]
    keys, quotes, size, seen = {}, [], 0, set()
    for h in must + first + rest:
        if h["id"] in seen:
            continue
        when = day(h.get("said_at"))
        entry = {"key": f"q{len(keys) + 1}", "text": clip(h.get("quote"), 1200), "point": h.get("point"),
                 "kind": h.get("kind"), "importance": h.get("importance"),
                 "company": names.get(h.get("company_id")) or h.get("company_name") or None, "who": h.get("name"),
                 "where": h.get("source"), "said_on": when.isoformat() if when else None}
        cost = len(_json.dumps(entry))
        if size + cost > BUDGET and h not in must:
            break
        seen.add(h["id"])
        keys[entry["key"]] = h["id"]
        quotes.append(entry)
        size += cost
    back = {v: k for k, v in keys.items()}
    # Who asked, by company, so the writer can say it without counting.
    groups: dict = {}
    for h in heard:
        cid = h.get("company_id") or ""
        g = groups.setdefault(cid, {"company": names.get(cid) or h.get("company_name") or "No company", "people": set(), "blocker": False})
        if h.get("handle"):
            g["people"].add(who_key(h.get("handle_kind"), h.get("handle")))
        g["blocker"] = g["blocker"] or h.get("importance") == "blocker"
    # People who asked with no quote filed (an ask from Triage or Release
    # notes) count here too, as they do in the ranking and the drawer.
    for a in asks_of(pod, [f]).get(fid, []):
        cid = a.get("company_id") or ""
        g = groups.setdefault(cid, {"company": names.get(cid) or a.get("company_name") or "No company", "people": set(), "blocker": False})
        if a.get("handle"):
            g["people"].add(who_key(a.get("handle_kind"), a.get("handle")))
    deals = deals_of(pod, r["company_ids"])
    companies = []
    for cid, g in sorted(groups.items(), key=lambda kv: (kv[1]["blocker"], len(kv[1]["people"])), reverse=True):
        mine = deals.get(cid) or []
        open_ = sum(float(d.get("amount") or 0) for d in mine if d.get("status") == "open" and (d.get("currency") or s["currency"]) == s["currency"])
        won = sum(float(d.get("amount") or 0) for d in mine if d.get("status") == "won" and (d.get("currency") or s["currency"]) == s["currency"])
        companies.append({"company": g["company"], "people": len(g["people"]), "blocker": g["blocker"],
                          "deal": " ".join(x for x in [("open " + money_short(open_, s["currency"])) if open_ else "",
                                                       ("won " + money_short(won, s["currency"])) if won else ""] if x) or None})
    brief = {
        "feature": {"name": f["name"], "description": f.get("description"), "area": f.get("area") or None,
                    "stage": r["stage"], "horizon": r["horizon"]},
        "facts": {"people": r["people"], "companies": r["companies"], "blockers": r["blockers"], "quotes": r["quotes"],
                  "open_deals": r.get("open_text"), "won": r.get("won_text"), "quotes_in_brief": len(quotes),
                  "by_company": companies[:40]},
        "quotes": quotes,
        "kept_lines": [{"section": ln.get("section"), "text": ln.get("text"),
                        "quotes": [back[qid] for qid in (ln.get("quotes") or []) if qid in back]} for ln in kept],
    }
    keep = {k: v for k, v in old.items() if k not in ("created_at", "updated_at")}
    pod.records.bulk_create("roadmap_spec", [dict(keep, id=fid, state="drafting", error=None)], upsert=True)
    return RoadmapSpecDraftResult(feature_id=fid, brief=brief, keys=keys,
                                  message=f"{f['name']}: {len(quotes)} of {len(heard)} quotes in the brief, {len(kept)} edited line(s) kept.")


def _written(value) -> dict:
    """The writer's output, whichever shape the step hands it on in."""
    if isinstance(value, str):
        try:
            value = _json.loads(value)
        except ValueError:
            return {}
    if not isinstance(value, dict):
        return {}
    if isinstance(value.get("sections"), list):
        return value
    for k in ("answer", "output", "result", "data", "output_data"):
        inner = _written(value.get(k))
        if inner:
            return inner
    return {}


def _save(pod, s: dict, fid: str, keys: dict, written: dict) -> RoadmapSpecDraftResult:
    found = q(pod, f"SELECT id, name FROM feature WHERE id = {lit(fid)}")
    if not found:
        return RoadmapSpecDraftResult(skip=True, feature_id=fid, message="The feature is gone.")
    f = found[0]
    old = _spec_row(pod, fid)
    out = _written(written)
    if not out.get("sections"):
        _fail(pod, fid, old, "The writer wrote nothing this time; the spec is as it was.")
        return RoadmapSpecDraftResult(feature_id=fid, message="The writer wrote nothing; kept the spec as it was.")
    version = int(old.get("version") or 0) + 1
    kept = [dict(ln, edited=True) for ln in json_list(old.get("lines")) if isinstance(ln, dict) and ln.get("edited")]
    new, dropped = [], 0
    said = {" ".join(str(ln.get("text") or "").lower().split()) for ln in kept}
    for sec in out["sections"]:
        if not isinstance(sec, dict) or sec.get("key") not in SECTION_KEYS:
            continue
        for n, ln in enumerate(sec.get("lines") or []):
            if not isinstance(ln, dict) or not str(ln.get("text") or "").strip():
                continue
            if " ".join(str(ln["text"]).lower().split()) in said:
                continue  # a person's line, written again: theirs stays
            cited = [str(k).strip() for k in (ln.get("quotes") or [])]
            good = [keys[k] for k in cited if k in keys]
            dropped += len(cited) - len(good)
            new.append({"section": sec["key"], "key": f"v{version}-{sec['key']}-{n + 1}", "text": ln["text"],
                        "quotes": good, "edited": False})
    lines = tidy_lines(kept + new)
    labels = labels_of(lines)
    total = q(pod, f"SELECT COUNT(*) AS n FROM feedback WHERE feature_id = {lit(fid)} AND state <> 'set_aside'")
    total_n = int((total[0] if total else {}).get("n") or 0)
    path = page_path(pod, f, old.get("path"))
    wrote = write_page(pod, f, lines, labels, path, version, len(labels), total_n)
    unsourced = sum(1 for ln in lines if ln["unsourced"])
    pod.records.bulk_create("roadmap_spec", [{
        "id": fid, "path": wrote or old.get("path") or path, "version": version, "state": "ready", "drafted_at": now_iso(),
        "error": None if wrote else "The spec is saved here, but its Page couldn't be written.",
        "quotes_used": len(labels), "quotes_total": total_n, "lines": lines, "labels": labels,
        "unsourced": unsourced, "edited": sum(1 for ln in lines if ln["edited"])}], upsert=True)
    return RoadmapSpecDraftResult(feature_id=fid, lines=len(lines), dropped=dropped, unsourced=unsourced,
                                  message=f"{f['name']}: version {version}, {len(lines)} lines from {len(labels)} of {total_n} quotes; "
                                          f"{dropped} unknown quote key(s) dropped, {unsourced} line(s) with no quote.")


def roadmap_spec_draft(ctx: FunctionContext, data: RoadmapSpecDraftInput) -> RoadmapSpecDraftResult:
    pod = ctx.pod
    if not data.feature_id:
        return RoadmapSpecDraftResult(skip=True, message="Name the feature to draft a spec for.")
    s = settings_of(pod)
    if data.mode == "brief":
        return _brief(pod, s, data.feature_id)
    return _save(pod, s, data.feature_id, data.keys or {}, data.written or {})
