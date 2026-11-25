#input_type_name: TriageNeedsYouInput
#output_type_name: TriageNeedsYouResult
#function_name: triage_needs_you

"""What in Triage needs the person running this, in the shared `needs_you`
list Today reads. A `needs_you` row is its member's own, so this writes only
for the person it runs as: the app on open, their own `triage-needs-you-<id>`
schedule (every 15 minutes, made by the app when they are in the rotation),
and the runs a change starts (a report filed, a decision, a poll).

- decide: an urgent item in the inbox, for whoever is on triage this week
  (skipping anyone away; with no rotation, the suggested owner):
  "T-48 needs a decision: 1,240 people and rising". Its `source_version` is
  the item's state and reach band, so a dismissal holds until it gets worse.
- answer: people who used the form to tell, after the person declined the
  item or its task was done: a member writes to them from the app.
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


class TriageNeedsYouInput(BaseModel):
    detail: bool = False


class TriageNeedsYouResult(BaseModel):
    count: int = 0
    counts: dict = {}
    items: list[dict] = []
    message: str


def band(people) -> str:
    if people is None:
        return "none"
    for edge in (25, 100, 1000, 10000, 100000):
        if people < edge:
            return f"<{edge}"
    return "100000+"


def why_line(it: dict) -> str:
    bits = []
    if it.get("reach_people") is not None:
        bits.append(f"{num(it['reach_people'])} people" + (" and rising" if it.get("escalating") else ""))
    elif (json_obj(it.get("security")) or {}).get("severity"):
        sec = json_obj(it.get("security"))
        bits.append(f"{sec.get('severity')} security" + (", reachable" if sec.get("reachable") else ""))
    elif it.get("reach_asks"):
        bits.append(f"{plural(it['reach_asks'], 'person', 'people')} asked")
    return ", ".join(bits) or "urgent by reach"


def items_for(me: str, on_duty: str | None, urgent: list, untold: list) -> list:
    out = []
    for it in urgent:
        mine = (on_duty == me) if on_duty else (str(it.get("owner_user_id") or "") == me)
        if not mine:
            continue
        out.append({"verb": "decide", "title": clip(f"{tag(it)} needs a decision: {why_line(it)}", 300),
                     "why": clip(f"{it.get('title')}" + (f" · suggested owner {it['owner_name']}" if it.get("owner_name") else ""), 300),
                     "source_table": "triage_item", "source_id": str(it["id"]),
                     "source_version": f"{it.get('state')}:{band(it.get('reach_people'))}:{bool(it.get('escalating'))}",
                     "app": APP, "path": f"/i/{it.get('number')}", "since_at": iso(it.get("first_seen") or it.get("created_at")),
                     "weight": 6 if it.get("escalating") else 5, "prepared": "Read by the Lemma" if it.get("summary") else None,
                     "prepared_text": clip(it.get("summary"), 2000) or None})
    for it, n, what in untold:
        if str(it.get("decided_by") or "") != me:
            continue
        out.append({"verb": "answer", "title": clip(f"Tell {plural(n, 'person', 'people')} {tag(it)} " + ("is fixed" if what == "fixed" else "won't be worked on"), 300),
                     "why": clip(f"{it.get('title')} · they used the report form", 300), "source_table": "triage_item",
                     "source_id": str(it["id"]), "source_version": f"tell:{what}:{n}", "app": APP, "path": f"/i/{it.get('number')}",
                     "weight": 2})
    return out


def triage_needs_you(ctx: FunctionContext, data: TriageNeedsYouInput) -> TriageNeedsYouResult:
    pod = ctx.pod
    me = str(ctx.user_id) if getattr(ctx, "user_id", None) else ""
    if not me:
        return TriageNeedsYouResult(message="No member to write for.")
    s = settings_of(pod)
    today = now().date()
    on_duty = on_triage(s, today, away_days(pod, s, today, today))
    urgent = [item_of(r) for r in q(pod, "SELECT * FROM triage_item WHERE state = 'inbox' AND priority = 'urgent' "
                                         "ORDER BY number LIMIT 100")]
    untold = []
    decided = [item_of(r) for r in q(pod, f"SELECT * FROM triage_item WHERE decided_by = {lit(me)} AND state IN ('done', 'declined') "
                                          "ORDER BY number DESC LIMIT 100")]
    if decided:
        waiting = {}
        for a in q(pod, f"SELECT work_id, state FROM ask WHERE work_source = 'triage' AND source = 'web' AND told_at IS NULL "
                        f"AND state IN ('shipped', 'declined') AND work_id IN ({lits([str(i['id']) for i in decided])}) LIMIT 1000"):
            waiting[str(a["work_id"])] = waiting.get(str(a["work_id"]), 0) + 1
        for it in decided:
            if waiting.get(str(it["id"])):
                untold.append((it, waiting[str(it["id"])], "fixed" if it.get("state") == "done" else "declined"))
    items = items_for(me, on_duty, urgent, untold)
    counts = needs_you_write(pod, "triage", me, [{k: v for k, v in i.items() if v is not None} for i in items], None)
    return TriageNeedsYouResult(count=len(items), counts=counts, items=items if data.detail else [],
                                message=f"{len(items)} for you in Triage." if items else "Nothing in Triage needs you.")
