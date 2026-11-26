#input_type_name: RoadmapShipInput
#output_type_name: RoadmapShipResult
#function_name: roadmap_ship

"""A person marks a roadmap item shipped: its horizon becomes `shipped` and
`shipped_on` is set (today in the set-up's zone, or the day given). The
outside page lists it under Shipped for 90 days.

The feature's `stage` is left alone: `live` is Release notes' to set, when
the release that carries it goes out, and with it the asks about the feature
go `shipped` and their people are told where they asked. Until Release notes
does that for features, nobody is told by Roadmap.
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

# roadmap:publish
# The outside page's rewrite, shared word for word by roadmap_publish (where it
# is edited), roadmap_set, roadmap_ship and roadmap_setup_save: bin/common.py
# copies it.
PUBLIC_LANES = ("now", "next", "later", "shipped")
SHIPPED_KEPT_DAYS = 90


def publish(pod, s: dict) -> dict:
    """roadmap_public, made to match the public items: rows added, changed and taken away."""
    want: dict = {}
    if s.get("public_on"):
        items = q_all(pod, "SELECT id, horizon, horizon_at, public, public_title, public_blurb, shipped_on FROM roadmap_item "
                           "WHERE public = true ORDER BY horizon_at, id")
        ids = [i["id"] for i in items]
        names = {}
        for start in range(0, len(ids), 300):
            for f in q(pod, f"SELECT id, name, state FROM feature WHERE id IN ({lits(ids[start:start + 300])})"):
                if f.get("state") in ("active", "suggested"):
                    names[f["id"]] = f["name"]
        cutoff = today_in(s.get("timezone")) - _timedelta(days=SHIPPED_KEPT_DAYS)
        lanes: dict = {lane: [] for lane in PUBLIC_LANES}
        for it in items:
            lane = it.get("horizon")
            if lane not in PUBLIC_LANES or it["id"] not in names:
                continue
            shipped = day(it.get("shipped_on"))
            if lane == "shipped" and (not shipped or shipped < cutoff):
                continue
            title = clip(it.get("public_title") or names[it["id"]], 120)
            lanes[lane].append({"id": it["id"], "lane": lane, "title": title, "blurb": clip(it.get("public_blurb"), 300) or None,
                                "shipped_on": shipped.isoformat() if lane == "shipped" and shipped else None})
        lanes["shipped"].sort(key=lambda r: r["shipped_on"] or "", reverse=True)
        for lane, group in lanes.items():
            for n, row in enumerate(group):
                want[row["id"]] = dict(row, position=n)
    have = {r["id"]: r for r in q_all(pod, "SELECT id, lane, title, blurb, shipped_on, position FROM roadmap_public ORDER BY id")}
    gone = [i for i in have if i not in want]

    def same(old, new):
        return old and all(str(old.get(k) or "")[:10 if k == "shipped_on" else None] == str(new.get(k) or "")
                           for k in ("lane", "title", "blurb", "shipped_on", "position"))
    changed = [row for row in want.values() if not same(have.get(row["id"]), row)]
    for start in range(0, len(gone), 100):
        pod.records.bulk_delete("roadmap_public", gone[start:start + 100])
    for start in range(0, len(changed), 100):
        pod.records.bulk_create("roadmap_public", changed[start:start + 100], upsert=True)
    return {"shown": len(want), "written": len(changed), "removed": len(gone), "on": bool(s.get("public_on"))}
# end roadmap:publish


class RoadmapShipInput(BaseModel):
    feature_id: str
    shipped_on: str | None = None
    # Take it back off Shipped, to where it was (now).
    undo: bool = False


class RoadmapShipResult(BaseModel):
    feature_id: str
    horizon: str
    shipped_on: str | None
    to_tell: int
    message: str


def roadmap_ship(ctx: FunctionContext, data: RoadmapShipInput) -> RoadmapShipResult:
    pod = ctx.pod
    s = settings_of(pod)
    found = q(pod, f"SELECT id, name, stage, work_source, work_id FROM feature WHERE id = {lit(data.feature_id)}")
    if not found:
        raise ValueError(f"No feature {data.feature_id}.")
    f = found[0]
    old = (q(pod, f"SELECT * FROM roadmap_item WHERE id = {lit(f['id'])}") or [{}])[0]
    keep = {k: v for k, v in old.items() if k not in ("created_at", "updated_at")}
    if data.undo:
        row = dict(keep, id=f["id"], horizon="now", shipped_on=None, horizon_at=now_iso(),
                   horizon_by=str(ctx.user_id) if ctx.user_id else None)
        on = None
    else:
        on = (day(data.shipped_on) or today_in(s["timezone"])).isoformat()
        row = dict(keep, id=f["id"], horizon="shipped", shipped_on=on, horizon_at=now_iso(),
                   horizon_by=str(ctx.user_id) if ctx.user_id else None)
    pod.records.bulk_create("roadmap_item", [row], upsert=True)
    publish(pod, s)
    works = [("feature", f["id"])] + ([(f["work_source"], f["work_id"])] if f.get("work_source") and f.get("work_id") else [])
    cond = " OR ".join(f"(work_source = {lit(a)} AND work_id = {lit(b)})" for a, b in works)
    tell = q(pod, f"SELECT COUNT(DISTINCT LOWER(handle_kind) || ':' || LOWER(handle)) AS n FROM ask WHERE ({cond}) "
                  "AND state IN ('open', 'shipped')")
    n = int((tell[0] if tell else {}).get("n") or 0)
    if data.undo:
        message = f"{f['name']} is back in Now."
    else:
        message = (f"Marked {f['name']} shipped on {on}. {plural(n, 'person', 'people')} asked and can be told where they asked "
                   "once Release notes sets the feature live; Roadmap tells nobody itself.")
    return RoadmapShipResult(feature_id=f["id"], horizon=row["horizon"], shipped_on=on, to_tell=n, message=message)
