#input_type_name: IncidentsSetInput
#output_type_name: IncidentsSetResult
#function_name: incidents_set

"""Change an incident's status, severity or roles (or its impact), from the
app or by "@Lemma sev2", "I'm lead", "we're fixing". Writes an event for
each change, edits the pinned header and topic, and moves the next update's
due time when the severity's cadence changes. `writeup_state: reviewed` marks
a write-up reviewed (the lead's "Mark reviewed").

Resolving is incidents_resolve, not this: it gathers once more and drafts the
write-up.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# incidents:common
# Shared by every Incidents function, word for word: bin/common.py copies it in.
# Edit it there, never here.
import json as _json
import re as _re
import uuid as _uuid
from datetime import datetime as _datetime, timedelta as _timedelta, timezone as _tz

INC_NS = _uuid.UUID("8d3f2a61-5b7e-4c19-a2d4-6e9b0c3f7a15")
SETTINGS_ID = str(_uuid.uuid5(INC_NS, "settings"))
APP = "incidents"
ASSISTANT = "pod_default"
STATUSES = ["declared", "investigating", "fixing", "monitoring", "resolved"]
STATUS_WORDS = {"declared": "Declared", "investigating": "Investigating", "fixing": "Fixing",
                "monitoring": "Monitoring", "resolved": "Resolved"}
DEFAULT_SEVERITIES = [
    {"key": "sev1", "word": "Critical", "update_every_min": 30},
    {"key": "sev2", "word": "Major", "update_every_min": 30},
    {"key": "sev3", "word": "Minor", "update_every_min": 60},
]
# Slack's write operations take their fields under `body`; reads take them flat
# (as Factory's announce found).
SLACK_WRITES = {"conversations_create", "conversations_invite", "conversations_join", "conversations_set_topic",
                "pins_add", "chat_post_message", "chat_update", "chat_post_ephemeral"}
SLACK_TRIGGER = "slack:http:slack_channel_message"


def iid(*parts) -> str:
    """A stable id from its parts."""
    return str(_uuid.uuid5(INC_NS, ":".join(str(p) for p in parts)))


def event_id(incident_id, source, source_id) -> str:
    """An event's id: one per (incident, source, the source's own id)."""
    return iid("event", incident_id, source, source_id)


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
    """A datetime (UTC) from an ISO string, a Slack ts or a datetime."""
    if not value:
        return None
    if isinstance(value, _datetime):
        return value if value.tzinfo else value.replace(tzinfo=_tz.utc)
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


def slug(text, n: int = 24) -> str:
    """A channel-name slug: lower case, words joined by -, at most n characters."""
    words = _re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).split()
    out = ""
    for w in words:
        nxt = f"{out}-{w}" if out else w
        if len(nxt) > n:
            break
        out = nxt
    return out or "incident"


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM incidents_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM incidents_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["slack_account"] = s.get("slack_account") or "slack"
    s["channel_prefix"] = s.get("channel_prefix") or "inc-"
    s["repos"] = json_list(s.get("repos"))
    s["email_to"] = json_list(s.get("email_to"))
    s["severities"] = json_list(s.get("severities")) or DEFAULT_SEVERITIES
    s["schedules"] = json_obj(s.get("schedules"))
    return s


def sev_of(s: dict, key) -> dict:
    """A severity as the team words it: {key, word, update_every_min, label}."""
    for sev in s.get("severities") or DEFAULT_SEVERITIES:
        if str(sev.get("key")) == str(key or ""):
            break
    else:
        sev = {"key": str(key or "sev2"), "word": "", "update_every_min": 30}
    label = str(sev["key"]).upper() + (f" · {sev['word']}" if sev.get("word") else "")
    return {**sev, "update_every_min": int(sev.get("update_every_min") or 30), "label": label}


def tag(inc: dict) -> str:
    return f"INC-{inc.get('number')}"


def find_incident(pod, ref) -> dict | None:
    """An incident by id, number, "INC-14", "#14" or its channel id; None when none is."""
    text = str(ref or "").strip()
    if not text:
        return None
    number = _re.fullmatch(r"(?:inc-?|#)?(\d+)", text, _re.I)
    if number:
        found = q(pod, f"SELECT * FROM incidents_incident WHERE number = {int(number.group(1))} LIMIT 1")
    elif _re.fullmatch(r"[0-9a-f-]{36}", text):
        found = q(pod, f"SELECT * FROM incidents_incident WHERE id = {lit(text)} LIMIT 1")
    else:
        found = q(pod, f"SELECT * FROM incidents_incident WHERE channel_id = {lit(text)} OR channel_name = {lit(text.lstrip('#'))} "
                       "ORDER BY number DESC LIMIT 1")
    if not found:
        return None
    inc = dict(found[0])
    inc["responders"] = json_list(inc.get("responders"))
    inc["followups"] = json_list(inc.get("followups"))
    inc["writeup"] = json_obj(inc.get("writeup"))
    return inc


def open_incidents(pod) -> list:
    out = []
    for r in q(pod, "SELECT * FROM incidents_incident WHERE status <> 'resolved' ORDER BY number"):
        r = dict(r)
        r["responders"] = json_list(r.get("responders"))
        out.append(r)
    return out


def add_events(pod, incident_id: str, events: list) -> int:
    """Upsert events; each {kind, source, source_id, at, actor, text, url?, starred?, detail?}."""
    batch = []
    for e in events:
        row = {k: v for k, v in e.items() if k in ("kind", "source", "source_id", "actor", "text", "url", "starred", "detail")}
        row["id"] = event_id(incident_id, e["source"], e.get("source_id") or e.get("at"))
        row["incident_id"] = incident_id
        row["at"] = iso(e.get("at")) or now_iso()
        row["text"] = clip(row.get("text"), 4000)
        batch.append(row)
    for start in range(0, len(batch), 100):
        pod.records.bulk_create("incidents_event", batch[start: start + 100], upsert=True)
    return len(batch)


class SlackError(Exception):
    pass


def slack(pod, s: dict, op: str, args: dict) -> dict:
    """One Slack operation through the Lemma's Slack connector; raises SlackError on `ok: false`."""
    payload = {"body": args} if op in SLACK_WRITES else args
    result = as_dict(pod.connectors.execute(s.get("slack_account") or "slack", op, payload))
    data = result.get("result", result)
    if isinstance(data, dict) and isinstance(data.get("data"), dict):
        data = data["data"]
    if isinstance(data, dict) and data.get("ok") is False:
        raise SlackError(str(data.get("error") or "Slack said no"))
    return data if isinstance(data, dict) else {}


def slack_try(pod, s: dict, op: str, args: dict):
    """(data, None) or (None, why): for the calls a run goes on without."""
    try:
        return slack(pod, s, op, args), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"[:300]


def post(pod, s: dict, channel: str, text: str, blocks=None, thread_ts=None) -> str:
    """Post as the Lemma's bot; joins a public channel once if it is not in it. Returns the ts."""
    body = {"channel": channel, "text": text, "unfurl_links": False, "unfurl_media": False}
    if blocks:
        body["blocks"] = _json.dumps(blocks)
    if thread_ts:
        body["thread_ts"] = thread_ts
    try:
        got = slack(pod, s, "chat_post_message", body)
    except SlackError as exc:
        if str(exc) != "not_in_channel":
            raise
        slack(pod, s, "conversations_join", {"channel": channel})
        got = slack(pod, s, "chat_post_message", body)
    return str(got.get("ts") or "")


def slack_time(value) -> str:
    """A time Slack shows in each reader's own zone, with UTC as the fallback."""
    moment = stamp(value)
    if not moment:
        return ""
    return f"<!date^{int(moment.timestamp())}^{{time}}|{moment.strftime('%H:%M')} UTC>"


def esc(text) -> str:
    return str(text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def header_text(inc: dict, s: dict) -> str:
    """The pinned header's text: what anyone joining the channel reads first."""
    sev = sev_of(s, inc.get("severity"))
    lead = inc.get("lead_name") or "nobody yet"
    comms = inc.get("comms_name") or "nobody yet"
    lines = [
        f"*{tag(inc)} · {esc(inc.get('title'))}*",
        f"{sev['label']} · {STATUS_WORDS.get(inc.get('status'), inc.get('status'))} · lead {esc(lead)} · comms {esc(comms)}",
    ]
    if inc.get("impact") or inc.get("service"):
        lines.append("Impact: " + esc(" · ".join(x for x in [inc.get("service"), inc.get("impact")] if x)))
    if inc.get("summary"):
        lines.append(f"Now ({slack_time(inc.get('summary_at'))}): {esc(inc['summary'])}")
    else:
        lines.append("Now: the Lemma writes a summary here as the timeline fills.")
    lines.append("_Kept current by the Lemma. Mention it to change status or severity, draft an update, or catch up._")
    return "\n".join(lines)


def topic_of(inc: dict, s: dict) -> str:
    sev = sev_of(s, inc.get("severity"))
    return clip(f"{tag(inc)} {sev['key'].upper()} {STATUS_WORDS.get(inc.get('status'), '')} · lead "
                f"{inc.get('lead_name') or '-'} · {inc.get('title') or ''}", 250)


def update_header(pod, s: dict, inc: dict) -> list:
    """Edit the pinned header in place and set the channel topic. Returns what failed (empty when nothing did)."""
    problems = []
    if not inc.get("channel_id"):
        return ["no channel"]
    if inc.get("header_ts"):
        _, why = slack_try(pod, s, "chat_update", {"channel": inc["channel_id"], "ts": inc["header_ts"],
                                                   "text": header_text(inc, s)})
        if why:
            problems.append(f"header: {why}")
    _, why = slack_try(pod, s, "conversations_set_topic", {"channel": inc["channel_id"], "topic": topic_of(inc, s)})
    if why:
        problems.append(f"topic: {why}")
    return problems


def connect_channel(pod, channel_id: str, channel_name: str) -> dict:
    """Connecting a new incident channel to the Lemma's bot: the one place it is done.

    The bot hears a Slack channel, and a channel's messages can start a
    schedule, only once the channel is in its surface's channel routes
    (`SurfaceChannelRoute`: an exact id or name). This reads the Slack
    surface, appends {channel_id, channel_name} to `config.channels` and
    PATCHes it. The PATCH asks for `agent.update` on the Lemma itself, which
    no function can be granted (a grant on the Lemma holds only
    `channel.notify_self` and `agent.execute`), so from a function this is
    expected to be refused: then it says so, and the app does the same as
    the person who declared or opens the incident (src/wire.ts).
    """
    try:
        listed = as_dict(pod.surfaces.list())
        slacks = [x for x in (listed.get("items") or [])
                  if str(x.get("platform") or x.get("surface_type") or "").upper() == "SLACK"]
        if not slacks:
            return {"connected": False, "why": "This Lemma has no Slack bot yet."}
        surface = slacks[0]
        routes = [r for r in (as_dict(surface.get("config")).get("channels") or []) if isinstance(r, dict)]
        if any(str(r.get("channel_id") or "") == channel_id for r in routes):
            return {"connected": True, "surface": surface.get("name")}
        routes.append({"channel_id": channel_id, "channel_name": channel_name})
        pod.surfaces.update(surface.get("name"), {"config": {"channels": routes}})
        return {"connected": True, "surface": surface.get("name")}
    except Exception as exc:  # noqa: BLE001
        return {"connected": False, "why": f"{type(exc).__name__}: {exc}"[:300]}


def message_event(msg: dict, people: dict) -> dict | None:
    """One Slack message as an event, or None for what is not a person's message."""
    subtype = msg.get("subtype") or ""
    ts = str(msg.get("ts") or "")
    if not ts or msg.get("bot_id") or subtype in ("channel_join", "channel_leave", "channel_topic", "bot_message"):
        return None
    who = people.get(msg.get("user") or "") or (msg.get("user_profile") or {}).get("real_name") or "Someone"
    if subtype == "pinned_item":
        item = msg.get("item") or {}
        return {"kind": "pin", "source": "slack", "source_id": f"pin:{item.get('ts') or ts}", "at": ts, "actor": who,
                "text": clip(item.get("text") or msg.get("text") or "pinned a message", 4000), "starred": True}
    text = msg.get("text") or ""
    if not text.strip():
        return None
    return {"kind": "message", "source": "slack", "source_id": ts, "at": ts, "actor": who, "text": text,
            "detail": {"thread_ts": msg.get("thread_ts")} if msg.get("thread_ts") and msg.get("thread_ts") != ts else None}


def ask(pod, instruction: str, schema: dict, evidence) -> dict:
    """One Decisions call: {"answers": {...}} or {"error": why}. Retries a busy or unavailable service."""
    import time as _time
    for attempt in range(4):
        try:
            got = as_dict(pod.decisions.make(instruction=instruction, schema=schema, evidence=evidence, priority="interactive"))
            return {"answers": as_dict(got.get("answers"))}
        except Exception as exc:  # noqa: BLE001
            status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
            if status == 429 or "RATE_LIMITED" in str(exc):
                _time.sleep(float(getattr(exc, "retry_after", None) or 6))
                continue
            if status in (502, 503, 504) or "UNAVAILABLE" in str(exc):
                _time.sleep(1.5 * (attempt + 1))
                continue
            return {"error": f"{type(exc).__name__}: {exc}"[:300]}
    return {"error": "the Decisions API was unavailable"}


def answer(got: dict, key: str):
    """The value of one answered question, or None."""
    return as_dict((got.get("answers") or {}).get(key)).get("value")


def events_of(pod, incident_id: str, limit: int = 400) -> list:
    """An incident's events, oldest first, as evidence: {id, at, kind, actor, text, url, starred}."""
    out = []
    for e in q(pod, "SELECT id, at, kind, source, actor, text, url, starred FROM incidents_event "
                    f"WHERE incident_id = {lit(incident_id)} ORDER BY at LIMIT {int(limit)}"):
        out.append({"id": e["id"], "at": iso(e.get("at")), "kind": e.get("kind"), "source": e.get("source"),
                    "who": e.get("actor"), "text": clip(e.get("text"), 600), "url": e.get("url"),
                    "pinned": bool(e.get("starred"))})
    return out


def run_function(pod, name: str, data: dict) -> dict:
    """Another Incidents function's output; {} when it could not run."""
    try:
        return as_dict(as_dict(pod.functions.run(name, data)).get("output_data"))
    except Exception:  # noqa: BLE001
        return {}


def caller(ctx) -> dict:
    uid = str(ctx.user_id) if getattr(ctx, "user_id", None) else None
    name = getattr(ctx, "user_name", None) or (getattr(ctx, "user_email", None) or "").split("@")[0] or None
    return {"user_id": uid, "name": name, "email": getattr(ctx, "user_email", None)}
# end incidents:common


class IncidentsSetInput(BaseModel):
    incident: str
    status: str | None = None  # declared, investigating, fixing, monitoring
    severity: str | None = None
    lead_user_id: str | None = None
    lead_name: str | None = None
    lead_email: str | None = None
    lead_me: bool = False  # "I'm lead"
    comms_user_id: str | None = None
    comms_name: str | None = None
    add_responders: list[dict] | None = None
    impact: str | None = None
    service: str | None = None
    people_affected: int | None = None
    people_source: str | None = None
    writeup_state: str | None = None  # reviewed
    hypothesis: str | None = None  # a hypothesis id, with hypothesis_state
    hypothesis_state: str | None = None  # confirmed, not_it


class IncidentsSetResult(BaseModel):
    incident: str | None = None
    changed: list[str] = []
    message: str


def incidents_set(ctx: FunctionContext, data: IncidentsSetInput) -> IncidentsSetResult:
    pod = ctx.pod
    s = settings_of(pod)
    me = caller(ctx)
    inc = find_incident(pod, data.incident)
    if not inc:
        return IncidentsSetResult(message="No such incident.")
    patch: dict = {}
    events: list[dict] = []
    at = now()
    who = me["name"] or "Someone"

    def ev(kind: str, text: str, detail: dict):
        events.append({"kind": kind, "source": "app", "source_id": f"{kind}:{at.isoformat()}:{len(events)}", "at": at,
                       "actor": who, "text": text, "detail": detail})

    if data.status and data.status != inc.get("status"):
        if data.status not in STATUSES or data.status == "resolved":
            return IncidentsSetResult(incident=tag(inc), message="Status is declared, investigating, fixing or monitoring; "
                                                                 "resolve with incidents_resolve.")
        patch["status"] = data.status
        ev("status", f"{who} set status to {STATUS_WORDS[data.status]}", {"from": inc.get("status"), "to": data.status})
    if data.severity and data.severity != inc.get("severity"):
        keys = [x.get("key") for x in s["severities"]]
        if data.severity.lower() not in keys:
            return IncidentsSetResult(incident=tag(inc), message=f"Severity is one of {', '.join(keys)}.")
        old, new = sev_of(s, inc.get("severity")), sev_of(s, data.severity.lower())
        patch["severity"] = new["key"]
        ev("severity", f"{who} changed severity from {old['key'].upper()} to {new['label']}", {"from": old["key"], "to": new["key"]})
        if new["update_every_min"] != old["update_every_min"]:
            due = stamp(inc.get("update_due_at")) or at
            patch["update_due_at"] = min(due, at + _timedelta(minutes=new["update_every_min"])).isoformat()
    responders = list(inc.get("responders") or [])
    if data.lead_me or data.lead_user_id or data.lead_name:
        lead = {"user_id": me["user_id"], "name": me["name"], "email": me["email"]} if data.lead_me else \
            {"user_id": data.lead_user_id, "name": data.lead_name, "email": data.lead_email}
        if (lead.get("user_id") or lead.get("name")) and (lead.get("user_id") or None) != inc.get("lead_user_id"):
            patch.update({"lead_user_id": lead.get("user_id"), "lead_name": lead.get("name")})
            ev("role", f"{lead.get('name') or 'Someone'} is lead" + ("" if data.lead_me else f", set by {who}"),
               {"role": "lead", "from": inc.get("lead_name"), "to": lead.get("name")})
            data.add_responders = list(data.add_responders or []) + [lead]
    if data.comms_user_id or data.comms_name:
        patch.update({"comms_user_id": data.comms_user_id, "comms_name": data.comms_name})
        ev("role", f"{data.comms_name or 'Someone'} is on comms", {"role": "comms", "to": data.comms_name})
    for p in data.add_responders or []:
        key = p.get("user_id") or (p.get("email") or "").lower() or p.get("name")
        if key and not any((r.get("user_id") or (r.get("email") or "").lower() or r.get("name")) == key for r in responders):
            responders.append({"user_id": p.get("user_id"), "name": p.get("name"), "email": (p.get("email") or "").lower() or None})
            if inc.get("channel_id") and p.get("email"):
                got, _ = slack_try(pod, s, "users_lookup_by_email", {"email": p["email"]})
                uid = ((got or {}).get("user") or {}).get("id")
                if uid:
                    responders[-1]["slack_id"] = uid
                    slack_try(pod, s, "conversations_invite", {"channel": inc["channel_id"], "users": uid})
    if responders != (inc.get("responders") or []):
        patch["responders"] = responders
    for key in ("impact", "service"):
        value = getattr(data, key)
        if value is not None and value != inc.get(key):
            patch[key] = value
    if data.people_affected is not None:
        patch.update({"people_affected": data.people_affected, "people_source": data.people_source or f"said by {who}"})
    if data.writeup_state == "reviewed" and inc.get("writeup_state") == "to_review":
        patch.update({"writeup_state": "reviewed", "reviewed_by": who})
        ev("status", f"{who} marked the write-up reviewed", {"writeup": "reviewed"})
    if data.hypothesis and data.hypothesis_state in ("confirmed", "not_it", "open"):
        pod.records.update("incidents_hypothesis", data.hypothesis, {"state": data.hypothesis_state})
        words = {"confirmed": "confirmed the likely cause", "not_it": "said the likely cause is not it", "open": "reopened the likely cause"}
        ev("lemma", f"{who} {words[data.hypothesis_state]}", {"hypothesis": data.hypothesis})
    if not patch and not events:
        return IncidentsSetResult(incident=tag(inc), message="Nothing changed.")
    if patch:
        pod.records.update("incidents_incident", inc["id"], patch)
    add_events(pod, inc["id"], events)
    inc.update(patch)
    if inc.get("channel_id") and any(k in patch for k in ("status", "severity", "lead_name", "comms_name", "impact", "service")):
        update_header(pod, s, inc)
        for e in events:
            if e["kind"] in ("status", "severity", "role"):
                slack_try(pod, s, "chat_post_message", {"channel": inc["channel_id"], "text": esc(e["text"])})
    if "writeup_state" in patch or "lead_user_id" in patch:
        run_function(pod, "incidents_needs_you", {})
    changed = [e["text"] for e in events] or list(patch)
    return IncidentsSetResult(incident=tag(inc), changed=changed, message=f"{tag(inc)}: " + "; ".join(changed) + ".")
