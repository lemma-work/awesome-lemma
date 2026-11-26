#input_type_name: RoadmapTickInput
#output_type_name: RoadmapTickResult
#function_name: roadmap_tick

"""The roadmap lead's daily run (their own TIME schedule, roadmap-daily, made
by the app as them at set-up; the app also runs it when the lead opens
Roadmap). It writes the lead's "decide" items into the shared `needs_you`
list, which Today shows, and closes the ones that no longer apply:

- a "now" item whose project's tasks have not moved in `stale_days` (14):
  "No work on Faster search in 16 days: keep it in Now?";
- an item whose project has every task done: "Custom fields on deals: every
  task done. Mark it shipped?";
- a feature User feedback suggested, with 5 or more quotes: "Recurring
  invoices: 9 quotes, not a feature yet" (opens User feedback).

Only the lead's own run writes: `needs_you` is per person, so a run as anyone
else writes nothing.
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

# contract:needs-you
# The one way to write `needs_you` (see _contract/README.md). Copied verbatim
# into every writer between these markers; _contract/lint.py fails on any
# difference. Needs a grant on needs_you (read and write).
import uuid as _ny_uuid
from datetime import datetime as _ny_datetime, timezone as _ny_timezone

NEEDS_YOU_NS = _ny_uuid.UUID("6b1d9a2e-4c37-4f0a-9e58-2d7c1b3f8a65")


def needs_you_id(plugin: str, table: str, source_id: str, verb: str, member: str) -> str:
    """The item's id: one per (plugin, source table, source row, verb, member)."""
    return str(_ny_uuid.uuid5(NEEDS_YOU_NS, f"{plugin}/{table}/{source_id}/{verb}/{member}"))


def needs_you_write(pod, plugin: str, member: str, items: list, scope_where: str | None = None) -> dict:
    """Write what needs the member now, from one plugin, and resolve the rest.

    `items` are the plugin's current items within the scope, each with verb,
    title, source_table, source_id and source_version, and any other column.
    `scope_where` is a SQL condition on needs_you naming what this pass looked
    at (e.g. "conversation_id IN (...)"); None means everything of this plugin.

    - new: created open.
    - open or snoozed: updated in place (a snooze holds until it ends).
    - dismissed, or done by the person: left alone, unless source_version
      changed, when it opens again.
    - done by the source (resolved before): opens again.
    - open or snoozed items in scope that are no longer current: done, closed
      by the source.
    """
    def rows(response):
        payload = response.to_dict() if hasattr(response, "to_dict") else response
        return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]

    def quoted(value):
        return "'" + str(value).replace("'", "''") + "'"

    now = _ny_datetime.now(_ny_timezone.utc).isoformat()
    current = {}
    for item in items:
        row = dict(item, source_plugin=plugin)
        row["id"] = needs_you_id(plugin, row["source_table"], str(row["source_id"]), row["verb"], member)
        current[row["id"]] = row
    where = f"source_plugin = {quoted(plugin)}" + (f" AND ({scope_where})" if scope_where else "")
    seen = {r["id"]: r for r in rows(pod.query(
        f"SELECT id, state, closed_by, source_version, snoozed_until FROM needs_you WHERE {where} LIMIT 5000"))}
    missing = [i for i in current if i not in seen]
    for start in range(0, len(missing), 200):
        ids = ", ".join(quoted(i) for i in missing[start : start + 200])
        seen.update({r["id"]: r for r in rows(pod.query(
            f"SELECT id, state, closed_by, source_version, snoozed_until FROM needs_you WHERE id IN ({ids})"))})
    creates, updates, counts = [], [], {"created": 0, "updated": 0, "kept_closed": 0, "resolved": 0}
    for item_id, row in current.items():
        old = seen.get(item_id)
        if old is None:
            creates.append(dict(row, state="open"))
            continue
        changed = (old.get("source_version") or "") != (row.get("source_version") or "")
        state = old.get("state")
        if state in ("dismissed", "done") and old.get("closed_by") != "source" and not changed:
            counts["kept_closed"] += 1
            continue
        if state == "snoozed" and not changed and (old.get("snoozed_until") or "") > now:
            updates.append(row)
            continue
        updates.append(dict(row, state="open", closed_by=None, snoozed_until=None))
    for item_id, old in seen.items():
        if item_id not in current and old.get("state") in ("open", "snoozed"):
            updates.append({"id": item_id, "state": "done", "closed_by": "source"})
            counts["resolved"] += 1
    for start in range(0, len(creates), 100):
        pod.records.bulk_create("needs_you", creates[start : start + 100], upsert=True)
    for start in range(0, len(updates), 100):
        pod.records.bulk_update("needs_you", updates[start : start + 100])
    counts["created"], counts["updated"] = len(creates), len(updates) - counts["resolved"]
    return counts
# end contract

SUGGESTED_AT = 5


class RoadmapTickInput(BaseModel):
    detail: bool = False


class RoadmapTickResult(BaseModel):
    decide: int
    counts: dict
    items: list[dict] = []
    message: str


def roadmap_tick(ctx: FunctionContext, data: RoadmapTickInput) -> RoadmapTickResult:
    pod = ctx.pod
    me = str(ctx.user_id) if ctx.user_id else ""
    s = settings_of(pod)
    if not me or not s.get("setup_done_at") or str(s.get("lead_user_id") or "") != me:
        return RoadmapTickResult(decide=0, counts={}, message="Only the roadmap's lead gets its items in Today; nothing written.")
    got = rank(pod, s)
    items: list[dict] = []
    for r in got["features"]:
        p = r.get("progress") or {}
        if r["stale"]:
            moved = day(p.get("moved"))
            items.append({
                "verb": "decide", "title": f"No work on {r['name']} in {r['moved_days']} days: keep it in Now?",
                "why": f"{p['done']} of {p['total']} tasks done" + (f" · nothing moved since {moved.strftime('%b')} {moved.day}" if moved else ""),
                "source_table": "roadmap_item", "source_id": r["id"], "source_version": f"stale:{str(p.get('moved') or '')[:10]}",
                "app": "roadmap", "path": f"/f/{r['id']}", "weight": 2,
            })
        if r["horizon"] in ("now", "next", "later") and p.get("total") and p["done"] >= p["total"]:
            items.append({
                "verb": "decide", "title": f"{r['name']}: every task done. Mark it shipped?",
                "why": f"{p['done']} of {p['total']} tasks done" + (f" in {p['name']}" if p.get("name") else "")
                       + f" · {plural(r['tell'], 'person', 'people')} to tell when it's live",
                "source_table": "roadmap_item", "source_id": r["id"], "source_version": f"done:{p['total']}",
                "app": "roadmap", "path": f"/f/{r['id']}", "weight": 3,
            })
    for sg in got["suggested"]:
        if sg["quotes"] >= SUGGESTED_AT:
            items.append({
                "verb": "decide", "title": f"{sg['name']}: {sg['quotes']} quotes, not a feature yet",
                "why": f"From {plural(sg['companies'], 'company', 'companies')} · suggested by User feedback; add it, merge it or drop it there",
                "source_table": "feature", "source_id": sg["id"], "source_version": "suggested",
                "app": FEEDBACK_APP, "path": "/", "weight": 1,
            })
    counts = needs_you_write(pod, "roadmap", me, items, None)
    return RoadmapTickResult(decide=len(items), counts=counts, items=items if data.detail else [],
                             message=f"{len(items)} to decide" if items else "Nothing on the roadmap needs you.")
