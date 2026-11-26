#input_type_name: RoadmapProjectInput
#output_type_name: RoadmapProjectResult
#function_name: roadmap_project

"""Make a Tasks project for a feature on the roadmap, and link it.

The project is the shared `project` row Tasks shows (source `roadmap`,
source_id the feature's id), named after the feature, led by the item's
owner when the owner is a member. Its id is fixed by the feature, so pressing
twice makes one project. The item's progress, and whether a "now" item has
gone stale, come from this project's tasks.
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


class RoadmapProjectInput(BaseModel):
    feature_id: str
    # Link an existing project instead of making one.
    project_id: str | None = None


class RoadmapProjectResult(BaseModel):
    feature_id: str
    project_id: str
    made: bool
    message: str


def roadmap_project(ctx: FunctionContext, data: RoadmapProjectInput) -> RoadmapProjectResult:
    pod = ctx.pod
    found = q(pod, f"SELECT id, name, description FROM feature WHERE id = {lit(data.feature_id)}")
    if not found:
        raise ValueError(f"No feature {data.feature_id}.")
    f = found[0]
    old = (q(pod, f"SELECT * FROM roadmap_item WHERE id = {lit(f['id'])}") or [{}])[0]
    made = False
    if data.project_id:
        got = q(pod, f"SELECT id, name FROM project WHERE id = {lit(data.project_id)}")
        if not got:
            raise ValueError(f"No project {data.project_id}.")
        pid, name = got[0]["id"], got[0]["name"]
    else:
        mine = q(pod, f"SELECT id, name FROM project WHERE source = 'roadmap' AND source_id = {lit(f['id'])} LIMIT 1")
        if old.get("project_id") and q(pod, f"SELECT id FROM project WHERE id = {lit(old['project_id'])}"):
            pid, name = old["project_id"], None
        elif mine:
            pid, name = mine[0]["id"], mine[0]["name"]
        else:
            pid, name = rid("project", f["id"]), clip(f["name"], 200)
            lead = old.get("owner_user_id")
            lead_name = None
            if lead:
                got = q(pod, f"SELECT owner_label FROM roadmap_item WHERE id = {lit(f['id'])}")
                lead_name = (got[0].get("owner_label") if got else None) or None
            pod.records.bulk_create("project", [{
                "id": pid, "name": name, "state": "active", "source": "roadmap", "source_id": str(f["id"]),
                "description": clip(f"From the roadmap. {f.get('description') or ''}".strip(), 4000),
                "lead_user_id": lead or None, "lead_name": lead_name}], upsert=True)
            made = True
    keep = {k: v for k, v in old.items() if k not in ("created_at", "updated_at")}
    pod.records.bulk_create("roadmap_item", [dict(keep, id=f["id"], project_id=pid,
                                                  **({} if keep.get("horizon") else {"horizon": "none"}))], upsert=True)
    said = f"Made a project in Tasks for {f['name']}." if made else f"{f['name']} is linked to its project in Tasks."
    return RoadmapProjectResult(feature_id=f["id"], project_id=pid, made=made, message=said)
