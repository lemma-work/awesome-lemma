#input_type_name: TriageAwayInput
#output_type_name: TriageAwayResult
#function_name: triage_away

"""Someone away for a stretch, written to the shared `away` table one row per
day (the contract's id: uuid5(AWAY_NS, "<member id or name>:<day>")), so
Sprints and Triage read the same days. `clear` takes the stretch's days out.
Who's on triage skips anyone away all day.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# triage:common
# Shared by every Triage function, word for word: bin/common.py copies it in
# from bin/shared/common.py. Edit it there, never here.
import json as _json
import re as _re
import uuid as _uuid
from datetime import date as _date, datetime as _datetime, timedelta as _timedelta, timezone as _tz

TRIAGE_NS = _uuid.UUID("e847d17f-4770-4e7e-8dba-488b3b5fac33")
ASK_NS = _uuid.UUID("9972cf8e-4f42-4b98-86fc-fa5697c1f089")
AWAY_NS = _uuid.UUID("363239d5-9ea7-40d6-b959-7dc722c3891f")
SETTINGS_ID = str(_uuid.uuid5(TRIAGE_NS, "settings"))
APP = "triage"
ASSISTANT = "pod_default"
OPEN_STATES = ("inbox", "accepted", "snoozed", "marked_down")
DOOR_WORDS = {"app": "New report", "assistant": "The Lemma", "slack": "Slack", "github": "GitHub", "form": "Form",
              "sentry": "Sentry", "posthog": "PostHog", "dependabot": "Dependabot", "code_scanning": "Code scanning",
              "secret_scanning": "Secret scanning"}
MACHINE_DOORS = ("sentry", "posthog", "dependabot", "code_scanning", "secret_scanning")
COUNTING_DOORS = ("sentry", "posthog")
SECURITY_DOORS = ("dependabot", "code_scanning", "secret_scanning")
DEFAULT_ACK = {"app": "off", "assistant": "got_it_known", "slack": "off", "github": "got_it", "form": "got_it_known"}


def tid(*parts) -> str:
    """A stable id from its parts."""
    return str(_uuid.uuid5(TRIAGE_NS, ":".join(str(p) for p in parts)))


def report_id(door, source_id) -> str:
    """A report's id: one per (door, the source's own id), so nothing is filed twice."""
    return tid("report", door, source_id)


def event_id(item_id, kind, key) -> str:
    return tid("event", item_id, kind, key)


def ask_id(handle_kind, handle, source, source_id, work_source, work_id) -> str:
    """The contract's ask id, from the values the row is first written with."""
    return str(_uuid.uuid5(ASK_NS, f"{handle_kind}:{handle}|{source}:{source_id}|{work_source}:{work_id}"))


def away_id(member_or_name, day) -> str:
    """The contract's away id: one row per person per day."""
    return str(_uuid.uuid5(AWAY_NS, f"{member_or_name}:{day}"))


def rows(response) -> list:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def q(pod, sql: str) -> list:
    return rows(pod.query(sql))


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


def now() -> _datetime:
    return _datetime.now(_tz.utc)


def now_iso() -> str:
    return now().isoformat()


def stamp(value):
    """A datetime (UTC) from an ISO string, a Slack ts, epoch seconds or a datetime."""
    if not value:
        return None
    if isinstance(value, _datetime):
        return value if value.tzinfo else value.replace(tzinfo=_tz.utc)
    if isinstance(value, (int, float)):
        return _datetime.fromtimestamp(float(value), _tz.utc)
    text = str(value)
    if _re.fullmatch(r"\d{9,11}(\.\d+)?", text):
        return _datetime.fromtimestamp(float(text), _tz.utc)
    try:
        moment = _datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def iso(value):
    moment = stamp(value)
    return moment.isoformat() if moment else None


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


def clip(text, n: int) -> str:
    t = " ".join(str(text or "").split())
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def num(n) -> str:
    try:
        return f"{int(n):,}"
    except (TypeError, ValueError):
        return ""


def plural(n, one: str, many: str = "") -> str:
    n = int(n or 0)
    return f"{num(n)} {one if n == 1 else (many or one + 's')}"


def settings_of(pod) -> dict:
    """The set-up row, with its JSON read and its defaults filled in."""
    found = q(pod, f"SELECT * FROM triage_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM triage_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["repos"] = [r for r in json_list(s.get("repos")) if isinstance(r, dict) and r.get("full_name")]
    s["slack"] = json_obj(s.get("slack"))
    s["sentry"] = json_obj(s.get("sentry"))
    s["posthog"] = json_obj(s.get("posthog"))
    s["ack"] = {**DEFAULT_ACK, **json_obj(s.get("ack"))}
    s["rotation"] = [str(u) for u in json_list(s.get("rotation")) if u]
    s["people"] = [p for p in json_list(s.get("people")) if isinstance(p, dict)]
    s["status"] = json_obj(s.get("status"))
    s["cursors"] = json_obj(s.get("cursors"))
    s["schedules"] = json_obj(s.get("schedules"))
    s["plugins"] = json_obj(s.get("plugins"))
    s["sprints_away"] = json_obj(s.get("sprints_away"))
    s["urgent_people"] = int(s.get("urgent_people") or 100)
    s["read_from_people"] = int(s.get("read_from_people") or 25)
    s["quiet"] = bool(s.get("quiet")) or bool(s.get("sample"))
    return s


def save_settings(pod, s: dict, fields: dict) -> None:
    """Write some set-up fields, making the row when there is none."""
    if s.get("id"):
        pod.table("triage_settings").update(s["id"], fields)
    else:
        pod.records.bulk_create("triage_settings", [{"id": SETTINGS_ID, **fields}], upsert=True)
        s["id"] = SETTINGS_ID
    s.update(fields)


def tag(item) -> str:
    return f"T-{item.get('number')}" if item and item.get("number") is not None else "T-?"


def item_of(row: dict) -> dict:
    """An item row with its JSON read."""
    it = dict(row)
    for key in ("trend", "history", "paths", "doors", "alternatives", "evidence", "related"):
        it[key] = json_list(it.get(key))
    it["security"] = json_obj(it.get("security"))
    return it


def find_item(pod, ref) -> dict | None:
    """An item by id, number, "T-48" or "#48"; None when none is."""
    text = str(ref or "").strip()
    if not text:
        return None
    number = _re.fullmatch(r"(?:t-?|#)?(\d+)", text, _re.I)
    if number:
        found = q(pod, f"SELECT * FROM triage_item WHERE number = {int(number.group(1))} LIMIT 1")
    elif _re.fullmatch(r"[0-9a-fA-F-]{36}", text):
        found = q(pod, f"SELECT * FROM triage_item WHERE id = {lit(text)} LIMIT 1")
    else:
        return None
    return item_of(found[0]) if found else None


def add_events(pod, item_id: str, events: list) -> int:
    """Upsert Activity lines; each {kind, key, text, actor?, actor_name?, at?, detail?}."""
    batch = []
    for e in events:
        batch.append({
            "id": event_id(item_id, e["kind"], e.get("key") or e.get("at") or now_iso()),
            "item_id": item_id, "kind": e["kind"], "at": iso(e.get("at")) or now_iso(),
            "actor": str(e.get("actor") or "lemma")[:64], "actor_name": e.get("actor_name") or ("Lemma" if not e.get("actor") or e.get("actor") == "lemma" else None),
            "text": clip(e.get("text"), 2000), "detail": e.get("detail"),
        })
    for start in range(0, len(batch), 100):
        pod.records.bulk_create("triage_event", batch[start: start + 100], upsert=True)
    return len(batch)


def caller(ctx) -> dict:
    uid = str(ctx.user_id) if getattr(ctx, "user_id", None) else None
    name = getattr(ctx, "user_name", None) or (getattr(ctx, "user_email", None) or "").split("@")[0] or None
    return {"user_id": uid, "name": name, "email": getattr(ctx, "user_email", None)}


def person_name(s: dict, user_id) -> str | None:
    for p in s.get("people") or []:
        if str(p.get("user_id") or "") == str(user_id or ""):
            return p.get("name") or None
    return None


def run_function(pod, name: str, data: dict) -> dict:
    """Another Triage function's output; {} when it could not run."""
    try:
        return as_dict(as_dict(pod.functions.run(name, data)).get("output_data"))
    except Exception:  # noqa: BLE001
        return {}


def day_of(value) -> _date:
    moment = stamp(value)
    return (moment or now()).date()


def away_days(pod, s: dict, start: _date, end: _date) -> dict:
    """Who is away, by day: {"YYYY-MM-DD": {member id or name: part}}.

    The shared `away` table, and Sprints' own days off as the app last read
    them (settings.sprints_away) while Sprints keeps its own table: a function
    is granted only the tables its bundle has, so the app, as the person, reads
    `sprints_away` when that table exists and keeps the next 30 days here.
    """
    out: dict = {}
    try:
        for r in q(pod, f"SELECT member_id, name, day, part FROM away WHERE day >= {lit(start.isoformat())} "
                        f"AND day <= {lit(end.isoformat())} LIMIT 2000"):
            out.setdefault(str(r.get("day"))[:10], {})[str(r.get("member_id") or r.get("name"))] = r.get("part") or "full"
    except Exception:  # noqa: BLE001
        pass
    for r in json_list(s.get("sprints_away", {}).get("days")):
        if not isinstance(r, dict):
            continue
        d = str(r.get("day") or "")[:10]
        if start.isoformat() <= d <= end.isoformat():
            out.setdefault(d, {}).setdefault(str(r.get("member_id") or r.get("name")), r.get("part") or "full")
    return out


def on_triage(s: dict, day: _date, away: dict | None = None) -> str | None:
    """Who is on triage on `day`: the rotation, a week each from its start, skipping anyone away that day."""
    order = s.get("rotation") or []
    if not order:
        return None
    start = day_of(s.get("rotation_start")) if s.get("rotation_start") else day
    start = start - _timedelta(days=start.weekday())
    week = max(0, (day - start).days // 7)
    off = (away or {}).get(day.isoformat(), {})
    for step in range(len(order)):
        who = order[(week + step) % len(order)]
        if off.get(who) != "full":
            return who
    return None
# end triage:common

MAX_DAYS = 120


class TriageAwayInput(BaseModel):
    member_id: str | None = None
    name: str
    start: str  # YYYY-MM-DD
    end: str | None = None  # YYYY-MM-DD, the last day away (default: start)
    part: str = "full"  # full, half
    clear: bool = False


class TriageAwayResult(BaseModel):
    days: int
    message: str


def triage_away(ctx: FunctionContext, data: TriageAwayInput) -> TriageAwayResult:
    pod = ctx.pod
    try:
        first = _date.fromisoformat(data.start[:10])
        last = _date.fromisoformat((data.end or data.start)[:10])
    except ValueError:
        return TriageAwayResult(days=0, message="Days are YYYY-MM-DD.")
    if last < first:
        first, last = last, first
    days = [first + _timedelta(days=i) for i in range(min(MAX_DAYS, (last - first).days + 1))]
    key = data.member_id or data.name.strip()
    ids = [away_id(key, d.isoformat()) for d in days]
    if data.clear:
        for start in range(0, len(ids), 100):
            existing = {r["id"] for r in q(pod, f"SELECT id FROM away WHERE id IN ({lits(ids[start:start + 100])})")}
            for i in existing:
                pod.table("away").delete(i)
        return TriageAwayResult(days=len(days), message=f"{data.name} is no longer away then.")
    part = data.part if data.part in ("full", "half") else "full"
    rows_out = [{"id": i, "name": clip(data.name, 200), "day": d.isoformat(), "part": part, **({"member_id": data.member_id} if data.member_id else {})}
                for i, d in zip(ids, days)]
    for start in range(0, len(rows_out), 100):
        pod.records.bulk_create("away", rows_out[start: start + 100], upsert=True)
    return TriageAwayResult(days=len(days), message=f"{data.name} is away {plural(len(days), 'day')}.")
