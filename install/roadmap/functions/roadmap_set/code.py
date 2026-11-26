#input_type_name: RoadmapSetInput
#output_type_name: RoadmapSetResult
#function_name: roadmap_set

"""Put a feature on the roadmap, move it, give it an owner, or say how the
outside page shows it. Only what is given changes.

The feature's `stage` (the shared `feature` table) follows, forward only:

- next or later, from idea: planned;
- now, from idea or planned: building;
- decline: declined (from idea, planned or building; not once it is in beta
  or live), and off the roadmap. Nobody is told: telling a declined ask why
  is Triage's job, and Triage isn't built yet.

Moving back to later never takes a stage back, and `live` is never
Roadmap's to set (Release notes sets it when the work ships; roadmap_ship
only marks the item shipped). Putting a declined feature back on the roadmap
is a person changing their mind: it goes to planned or building.

A change to what the outside page shows rewrites `roadmap_public`.
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


class RoadmapSetInput(BaseModel):
    feature_id: str
    # none (off the roadmap), now, next or later. Shipping is roadmap_ship.
    horizon: str | None = None
    decline: bool = False
    owner_user_id: str | None = None
    owner_label: str | None = None
    # Clear the owner.
    no_owner: bool = False
    public: bool | None = None
    public_title: str | None = None
    public_blurb: str | None = None


class RoadmapSetResult(BaseModel):
    feature_id: str
    horizon: str
    stage: str
    stage_was: str
    public: bool
    published: dict | None = None
    message: str


def _forward(stage: str, horizon: str) -> str:
    if horizon in ("next", "later") and stage in ("idea", "declined"):
        return "planned"
    if horizon == "now" and stage in ("idea", "planned", "declined"):
        return "building"
    return stage


def roadmap_set(ctx: FunctionContext, data: RoadmapSetInput) -> RoadmapSetResult:
    pod = ctx.pod
    s = settings_of(pod)
    found = q(pod, f"SELECT id, name, stage, state FROM feature WHERE id = {lit(data.feature_id)}")
    if not found:
        raise ValueError(f"No feature {data.feature_id}.")
    f = found[0]
    if f.get("state") in ("merged", "archived"):
        raise ValueError(f"{f['name']} is {f['state']}; it isn't on the list any more.")
    old = (q(pod, f"SELECT * FROM roadmap_item WHERE id = {lit(f['id'])}") or [{}])[0]
    stage_was = f.get("stage") or "idea"
    stage = stage_was
    row = {"id": f["id"]}
    horizon = old.get("horizon") or "none"
    if data.decline:
        if stage_was in ("beta", "live"):
            raise ValueError(f"{f['name']} is already {stage_was}; it can't be declined.")
        stage, horizon = "declined", "none"
        row.update(horizon="none", horizon_at=now_iso(), horizon_by=str(ctx.user_id) if ctx.user_id else None)
    elif data.horizon is not None:
        if data.horizon not in ("none", "now", "next", "later"):
            raise ValueError("horizon is none, now, next or later; to mark it shipped, use roadmap_ship.")
        if data.horizon != horizon:
            horizon = data.horizon
            row.update(horizon=horizon, horizon_at=now_iso(), horizon_by=str(ctx.user_id) if ctx.user_id else None)
            if horizon != "none":
                row["shipped_on"] = None
        stage = _forward(stage_was, horizon)
    if data.no_owner:
        row.update(owner_user_id=None, owner_label=None)
    elif data.owner_user_id is not None or data.owner_label is not None:
        if data.owner_user_id is not None:
            row["owner_user_id"] = data.owner_user_id or None
        if data.owner_label is not None:
            row["owner_label"] = clip(data.owner_label, 120) or None
    if data.public is not None:
        row["public"] = bool(data.public)
    if data.public_title is not None:
        row["public_title"] = clip(data.public_title, 120) or None
    if data.public_blurb is not None:
        row["public_blurb"] = clip(data.public_blurb, 300) or None
    if row["public"] if "public" in row else False:
        row.setdefault("public_title", old.get("public_title") or clip(f["name"], 120))
    pod.records.bulk_create("roadmap_item", [dict({k: v for k, v in old.items() if k not in ("created_at", "updated_at")}, **row)],
                            upsert=True)
    if stage != stage_was:
        pod.records.update("feature", f["id"], {"stage": stage, "stage_at": now_iso()})
    public = bool(row.get("public", old.get("public")))
    touches_page = public or bool(old.get("public")) or "public" in row
    published = publish(pod, s) if touches_page else None
    where = {"none": "off the roadmap", "now": "in Now", "next": "in Next", "later": "in Later",
             "shipped": "shipped"}.get(horizon, horizon)
    said = f"{f['name']} is {where}" + (f"; its stage went from {stage_was} to {stage}" if stage != stage_was else "") + "."
    if data.decline:
        said = f"Declined {f['name']}. Nobody who asked is told yet: that waits on Triage."
    return RoadmapSetResult(feature_id=f["id"], horizon=horizon, stage=stage, stage_was=stage_was, public=public,
                            published=published, message=said)
