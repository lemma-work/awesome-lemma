#input_type_name: IncidentsNeedsYouInput
#output_type_name: IncidentsNeedsYouResult
#function_name: incidents_needs_you

"""What in Incidents needs the person running this, written to the shared
`needs_you` list Today reads (see _contract/README.md, "Needs you"):

  do      You're leading INC-n         an open incident they lead
  decide  Send the INC-n update        an update is due and a draft waits
  decide  Review the write-up for INC-n   a write-up of theirs to review

Runs as the person: their app (on every open), their declare, set, resolve
and send, and the tick (as the person who set Incidents up). `needs_you` is
row-level, so a run writes only its own person's items: a lead who never
opens Incidents and did not set it up gets their items when one of their own
runs happens. Follow-ups reach Today through Tasks, as tasks.
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


class IncidentsNeedsYouInput(BaseModel):
    detail: bool = False


class IncidentsNeedsYouResult(BaseModel):
    count: int = 0
    counts: dict = {}
    items: list[dict] = []
    message: str


def items_for(me: str, incidents: list, drafts: dict, s: dict) -> list:
    """The person's current items, from incidents and the drafts waiting on them."""
    out = []
    for inc in incidents:
        if str(inc.get("lead_user_id") or "") != me:
            continue
        path = f"/i/{inc['number']}"
        sev = sev_of(s, inc.get("severity"))
        if inc.get("status") != "resolved":
            out.append({"verb": "do", "title": f"You're leading {tag(inc)}: {clip(inc.get('title'), 200)}",
                        "why": f"{sev['label']} · {STATUS_WORDS.get(inc.get('status'))}", "source_table": "incidents_incident",
                        "source_id": inc["id"], "source_version": f"lead:{inc.get('declared_at')}", "app": APP, "path": path,
                        "since_at": iso(inc.get("declared_at")), "weight": 5 if sev["key"] == "sev1" else 4})
            draft = drafts.get(inc["id"])
            due = stamp(inc.get("update_due_at"))
            if draft and (not due or due <= now() + _timedelta(minutes=5)):
                out.append({"verb": "decide", "title": f"Send the {tag(inc)} update", "why": "Due " + (
                    due.strftime("%H:%M UTC") if due else "now") + " · drafted by the Lemma",
                    "source_table": "incidents_update", "source_id": draft["id"], "source_version": f"update:{draft['id']}",
                    "app": APP, "path": path, "due_at": iso(due), "weight": 6, "prepared": "Update drafted",
                    "prepared_text": clip(draft.get("body"), 2000)})
        elif inc.get("writeup_state") == "to_review":
            flags = int(inc.get("open_flags") or 0)
            out.append({"verb": "decide", "title": f"Review the write-up for {tag(inc)}",
                        "why": f"{clip(inc.get('title'), 120)} · " + (f"{flags} claim{'s' if flags != 1 else ''} flagged" if flags
                                                                      else "nothing flagged"),
                        "source_table": "incidents_incident", "source_id": inc["id"],
                        "source_version": f"writeup:{inc.get('writeup_at')}", "app": APP, "path": f"{path}/writeup",
                        "weight": 2, "prepared": "Write-up drafted"})
    return out


def incidents_needs_you(ctx: FunctionContext, data: IncidentsNeedsYouInput) -> IncidentsNeedsYouResult:
    pod = ctx.pod
    me = str(ctx.user_id) if getattr(ctx, "user_id", None) else ""
    if not me:
        return IncidentsNeedsYouResult(message="No member to write for.")
    s = settings_of(pod)
    incidents = [dict(r) for r in q(pod, f"SELECT * FROM incidents_incident WHERE lead_user_id = {lit(me)} AND (status <> 'resolved' "
                                         "OR writeup_state = 'to_review') ORDER BY number")]
    drafts = {}
    if incidents:
        flags = {r["incident_id"]: r.get("n") for r in q(pod, "SELECT incident_id, COUNT(*) AS n FROM incidents_flag WHERE state = 'open' "
                                                              f"AND incident_id IN ({lits([i['id'] for i in incidents])}) GROUP BY incident_id")}
        for inc in incidents:
            inc["open_flags"] = flags.get(inc["id"]) or 0
        for d in q(pod, "SELECT id, incident_id, body FROM incidents_update WHERE state = 'draft' AND incident_id IN "
                        f"({lits([i['id'] for i in incidents])}) ORDER BY drafted_at"):
            drafts[d["incident_id"]] = d
    items = items_for(me, incidents, drafts, s)
    counts = needs_you_write(pod, "incidents", me, items, None)
    return IncidentsNeedsYouResult(count=len(items), counts=counts, items=items if data.detail else [],
                                   message=f"{len(items)} for you in Incidents." if items else "Nothing in Incidents needs you.")
