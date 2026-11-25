#input_type_name: IncidentsSampleDataInput
#output_type_name: IncidentsSampleDataResult
#function_name: incidents_sample_data

"""Made-up incidents, so Incidents can be seen working before a real one:
"Look around with a sample incident" at set-up.

`load` makes, around now:

- INC-14, open for 38 minutes: card payments in the EU fail with a 502 on
  checkout-api. Its timeline from the channel, GitHub and a Triage item; a
  likely cause with its evidence, what it ruled out and what it couldn't
  check; an update sent and the next one drafted; the revert handed to the
  Lemma as a task.
- INC-13, INC-12, INC-11, resolved: each with its write-up (INC-13's still to
  review, one claim flagged) and its follow-ups as team tasks.

The people are made up (Mara Lind, Theo Park, Ines Ruiz, Jun Oda at
company.example). Whoever loads it leads INC-14 and INC-13, so their Today
shows the update to send and the write-up to review. Nothing is posted to
Slack or GitHub. Every row made is marked in `incidents_sample_row`.

`clear` removes only what the sample made (and anything since hung on the
sample's incidents), then resolves the loader's items in Today.
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


class IncidentsSampleDataInput(BaseModel):
    mode: str = "load"  # load, clear


class IncidentsSampleDataResult(BaseModel):
    made: dict = {}
    message: str


PEOPLE = {
    "mara": {"name": "Mara Lind", "email": "mara@company.example"},
    "theo": {"name": "Theo Park", "email": "theo@company.example"},
    "ines": {"name": "Ines Ruiz", "email": "ines@company.example"},
    "jun": {"name": "Jun Oda", "email": "jun@company.example"},
}
GH = "https://github.example/shop/checkout-api"
SLACK = "https://company.slack.example/archives"
TABLES = ["incidents_flag", "incidents_update", "incidents_hypothesis", "incidents_event", "incidents_change", "task",
          "incidents_incident"]


def build(t0: _datetime, lead: dict, numbers: bool = False) -> dict:
    """Every sample row, with INC-14's first error at t0. `lead` ({user_id, name}) leads INC-14 and INC-13.
    numbers: give tasks the numbers the demo shows (a Lemma numbers them itself)."""
    out = {t: [] for t in TABLES}
    lead_name = lead.get("name") or "Mara Lind"
    first = lead_name.split()[0]
    rs = lambda *keys: [{"user_id": lead.get("user_id") if k == "mara" else None,  # noqa: E731
                         "name": lead_name if k == "mara" else PEOPLE[k]["name"],
                         "email": None if k == "mara" and lead.get("user_id") else PEOPLE[k]["email"]} for k in keys]

    def at(minutes: float, base=None) -> str:
        return ((base or t0) + _timedelta(minutes=minutes)).isoformat()

    def ev(inc_id, minutes, kind, source, sid, actor, text, url=None, starred=False, detail=None, base=None):
        row = {"id": event_id(inc_id, source, sid), "incident_id": inc_id, "at": at(minutes, base), "kind": kind,
               "source": source, "source_id": sid, "actor": actor, "text": text, "url": url, "starred": starred,
               "detail": detail}
        out["incidents_event"].append(row)
        return row["id"]

    def change(minutes, kind, ref, title, author, url, files=None, outcome=None, base=None):
        cid = iid("sample", "change", ref)
        out["incidents_change"].append({"id": cid, "repo": "shop/checkout-api", "kind": kind, "ref": ref, "title": title,
                                        "author": author, "at": at(minutes, base), "url": url, "files": files or [],
                                        "outcome": outcome})
        return cid

    task_no = iter(range(431, 460))

    def task(inc, title, status, who=None, agent=None, minutes=0, base=None, why=""):
        row = {"id": iid("sample", "task", inc["id"], title), "title": title, "status": status,
               "priority": "high" if agent else "medium", "description": f"{why}\n\nFrom {tag(inc)}: {inc['title']}".strip(),
               "assignee_kind": "agent" if agent else ("person" if who else "none"), "assignee_agent": agent,
               "assignee_user_id": None, "assignee_name": PEOPLE[who]["name"] if who else None,
               "owner_user_id": lead.get("user_id"), "owner_name": lead_name, "source": "incidents",
               "source_id": inc["id"], "source_url": f"/i/{inc['number']}", "quote": why or None,
               "done_at": at(minutes, base) if status == "done" else None}
        if numbers:
            row["number"] = next(task_no)
            row["created_at"] = at(minutes - 1, base)
            row["updated_at"] = at(minutes, base)
        out["task"].append(row)
        return row

    # ---------- INC-14: open, the incident page ----------
    i14 = {"id": iid("sample", "incident", 14), "number": 14, "title": "Checkout returns 502 for card payments in the EU",
           "severity": "sev2", "status": "investigating", "lead_user_id": lead.get("user_id"), "lead_name": lead_name,
           "comms_user_id": None, "comms_name": "Ines Ruiz", "responders": rs("theo", "mara", "ines"),
           "service": "checkout-api", "impact": "EU card payments", "people_affected": 1240, "people_source": "Sentry users",
           "started_at": at(0), "started_source": "first error", "noticed_at": at(0), "noticed_source": "Triage",
           "declared_at": at(1), "declared_by": lead_name, "channel_id": "C0SAMPLE14", "channel_name": "inc-14-checkout-502",
           "header_ts": None, "channel_connected": True, "source": "triage", "source_id": "TRI-482",
           "source_url": "https://triage.example/TRI-482", "source_label": "TRI-482 TimeoutError in eu/client.ts",
           "summary": (f"Card payments routed to the EU provider fail with a 502 since 14:02. About 1,240 people have hit it. "
                       f"Non-EU cards and wallets work. Theo is reverting the 13:58 timeout change; the revert's checks are running."),
           "summary_at": at(34), "gathered_to_ts": None, "gathered_at": at(34), "update_due_at": at(43),
           "writeup_state": "none", "followups": []}
    i = i14["id"]
    c2288 = change(-22, "merge", "#2288", "Checkout copy", "Jun Oda", f"{GH}/pull/2288", ["web/checkout/copy.ts"])
    c2291 = change(-4, "merge", "#2291", "EU timeout 10 s → 1 s", "Theo Park", f"{GH}/pull/2291", ["payments/eu/client.ts"])
    cdep = change(-1, "deploy", "Deploy #812", "Deploy on main", "Theo Park", f"{GH}/actions/runs/812", outcome="success")
    e = {}
    e["2288"] = ev(i, -22, "change", "github", c2288, "GitHub", "#2288 merged by Jun Oda: Checkout copy", f"{GH}/pull/2288",
                   detail={"ref": "#2288", "kind": "merge", "change_id": c2288})
    e["2291"] = ev(i, -4, "change", "github", c2291, "GitHub", "#2291 merged by Theo Park: EU timeout 10 s → 1 s", f"{GH}/pull/2291",
                   detail={"ref": "#2291", "kind": "merge", "change_id": c2291})
    e["deploy"] = ev(i, -1, "deploy", "github", cdep, "GitHub", "Deploy workflow for checkout-api succeeded", f"{GH}/actions/runs/812",
                     detail={"ref": "Deploy #812", "kind": "deploy", "outcome": "success", "via": "workflow_run", "change_id": cdep})
    e["triage"] = ev(i, 0, "triage", "triage", "TRI-482:0", "Triage", "TimeoutError escalating: 1,240 users in 9 min",
                     "https://triage.example/TRI-482", detail={"users": 1240, "label": "TRI-482"})
    e["declared"] = ev(i, 1, "declared", "triage", "declared:14", lead_name, f"Declared by {first} from Triage item TRI-482 · SEV2",
                       "https://triage.example/TRI-482", detail={"severity": "sev2", "source": "triage", "label": "TRI-482"})
    e["opened"] = ev(i, 2, "lemma", "lemma", "opened:C0SAMPLE14", "Lemma", f"Opened #inc-14-checkout-502 and invited {first}, Theo, Ines")
    ev(i, 3, "message", "slack", "s14-1", lead_name, "Looking. Theo, you merged into payments this morning?", f"{SLACK}/C0SAMPLE14/p1")
    ev(i, 5, "message", "slack", "s14-2", "Theo Park", "yes, #2291, the EU timeout. checking the client now", f"{SLACK}/C0SAMPLE14/p2")
    e["ines"] = ev(i, 7, "message", "slack", "s14-3", "Ines Ruiz", "only EU cards failing, wallets fine", f"{SLACK}/C0SAMPLE14/p3",
                   starred=True)
    ev(i, 8, "message", "slack", "s14-4", "Ines Ruiz", "support has a macro out for EU customers: try a wallet for now", f"{SLACK}/C0SAMPLE14/p4")
    e["cause"] = ev(i, 10, "lemma", "lemma", "hypothesis:14", "Lemma", "Posted a likely cause: PR #2291")
    e["update"] = ev(i, 13, "update", "app", "update:14-1", lead_name, f"Update sent by {first} to #incidents and 3 people")
    ev(i, 16, "message", "slack", "s14-5", lead_name, "Theo, can you try 10 s in staging before we revert?", f"{SLACK}/C0SAMPLE14/p5")
    e["staging"] = ev(i, 20, "message", "slack", "s14-6", "Theo Park",
                      "confirmed in staging, 1 s is too short for their 3-D Secure step. Reverting.", f"{SLACK}/C0SAMPLE14/p6",
                      starred=True)
    ev(i, 22, "role", "app", "task:revert14", "Theo Park", "Theo handed the revert to the Lemma's assistant")
    e["revert"] = ev(i, 29, "lemma", "lemma", "pr:2294", "Lemma", "Opened #2294 Revert EU timeout, asked by Theo", f"{GH}/pull/2294")
    ev(i, 32, "change", "github", "checks:2294", "GitHub", "Checks running on #2294 Revert EU timeout", f"{GH}/pull/2294/checks",
       detail={"ref": "#2294"})
    out["incidents_hypothesis"].append({
        "id": iid("sample", "hypothesis", 14), "incident_id": i, "confidence": "likely", "agree": 3, "signs": 4,
        "text": "The 13:58 change to payments/eu/client.ts cut the EU provider's timeout from 10 s to 1 s. "
                "The provider answers in about 1.4 s, so every EU card payment times out.",
        "evidence": [
            {"text": "PR #2291 merged 13:58 by Theo Park: EU timeout 10 s → 1 s", "event_id": e["2291"], "url": f"{GH}/pull/2291", "source": "github"},
            {"text": "Deploy workflow for checkout-api finished 14:01", "event_id": e["deploy"], "url": f"{GH}/actions/runs/812",
             "source": "deploy"},
            {"text": "Sentry: TimeoutError in eu/client.ts, first seen 14:02 · 1,240 users", "event_id": e["triage"],
             "url": "https://triage.example/TRI-482", "source": "sentry"},
            {"text": "Ines, 14:09: \"only EU cards failing, wallets fine\"", "event_id": e["ines"], "url": None, "source": "slack"}],
        "ruled_out": [{"text": "Database: no failover or slow queries in the window"},
                      {"text": "PR #2288, merged 13:40: copy changes only"}],
        "not_checked": [{"text": "Metrics: Datadog isn't connected", "source": "mcp"},
                        {"text": "The provider's own status: no source", "source": None}],
        "state": "open", "posted_ts": None, "posted_at": at(10)})
    out["incidents_update"] += [
        {"id": iid("sample", "update", 14, 1), "incident_id": i, "state": "sent", "drafted_at": at(12), "sent_at": at(13),
         "sent_by": lead_name, "recipients": {"channel": True, "announce": True, "email": ["support@company.example", "cx@company.example",
                                                                                  "finance@company.example"]},
         "delivery": {"channel": "sent", "announce": "sent", "email": "sent"},
         "body": "Card payments in the EU are failing since 14:02 UTC. We are looking into it with the payments team. "
                 "Other payment methods work. Next update by 14:45 UTC."},
        {"id": iid("sample", "update", 14, 2), "incident_id": i, "state": "draft", "drafted_at": at(36),
         "recipients": {"channel": True, "announce": True, "email": ["support@company.example", "cx@company.example", "finance@company.example"]},
         "body": "Card payments in the EU are failing since 14:02 UTC. We found the cause, a configuration change, and are rolling "
                 "it back now. Other payment methods work. Next update by 15:00 UTC."}]
    task(i14, "Revert #2291 (INC-14)", "in_progress", agent=ASSISTANT, minutes=22,
         why="Open a pull request that reverts #2291; ask the incident's lead before merging it.")
    out["incidents_incident"].append(i14)

    # ---------- INC-13: resolved, write-up to review ----------
    b13 = t0 - _timedelta(days=6, hours=3, minutes=12)
    i13 = {"id": iid("sample", "incident", 13), "number": 13, "title": "Search results stale", "severity": "sev3",
           "status": "resolved", "lead_user_id": lead.get("user_id"), "lead_name": lead_name, "comms_name": "Jun Oda",
           "responders": rs("mara", "jun", "theo"), "service": "search-api", "impact": "Product search showed yesterday's prices",
           "people_affected": None, "people_source": None, "started_at": at(0, b13), "started_source": "first report",
           "noticed_at": at(14, b13), "noticed_source": "Slack", "declared_at": at(16, b13), "declared_by": lead_name,
           "resolved_at": at(130, b13), "channel_id": "C0SAMPLE13", "channel_name": "inc-13-search-stale", "channel_connected": True,
           "source": "slack", "summary": "Resolved: the search index rebuilt; results are current.", "summary_at": at(128, b13),
           "writeup_state": "to_review", "writeup_path": "/incidents/INC-13.md", "writeup_at": at(140, b13)}
    i = i13["id"]
    c = change(-35, "merge", "#2270", "Cache search responses for 24 h", "Jun Oda", f"{GH}/pull/2270", ["search/cache.ts"], base=b13)
    a = ev(i, -35, "change", "github", c, "GitHub", "#2270 merged by Jun Oda: Cache search responses for 24 h", f"{GH}/pull/2270",
           detail={"ref": "#2270", "kind": "merge"}, base=b13)
    b = ev(i, 14, "message", "slack", "s13-1", "Ines Ruiz", "a customer says search shows yesterday's prices on sale items",
           f"{SLACK}/C0SAMPLE13/p1", base=b13)
    d = ev(i, 16, "declared", "slack", "declared:13", lead_name, f"Declared by {first} in Slack · SEV3", base=b13)
    f = ev(i, 41, "message", "slack", "s13-2", "Jun Oda", "it's my cache change, #2270. the price index isn't part of the cache key",
           f"{SLACK}/C0SAMPLE13/p2", starred=True, base=b13)
    g = ev(i, 47, "update", "app", "update:13-1", lead_name, f"Update sent by {first} to #incidents", base=b13)
    h = ev(i, 102, "change", "github", "pr:2277", "GitHub", "#2277 merged by Jun Oda: Key the search cache on the price index",
           f"{GH}/pull/2277", detail={"ref": "#2277", "kind": "merge"}, base=b13)
    k = ev(i, 128, "message", "slack", "s13-3", "Theo Park", "index rebuilt, sale prices are right again", f"{SLACK}/C0SAMPLE13/p3",
           base=b13)
    ev(i, 130, "status", "app", "resolved:13", lead_name, f"Resolved by {first}", base=b13)
    out["incidents_incident"].append(i13)
    i13["writeup"] = {
        "title": "Search showed stale prices for two hours", "drafted_at": at(140, b13),
        "sections": [
            {"key": "summary", "heading": "Summary", "items": [
                {"key": "summary.0", "kind": "p", "text": "A change merged that morning cached search responses for 24 hours.", "cites": [a]},
                {"key": "summary.1", "kind": "p", "text": "The cache key left out the price index, so sale prices in search stayed a day old.",
                 "cites": [f]},
                {"key": "summary.2", "kind": "p", "text": "A fix keyed the cache on the price index and the index was rebuilt.", "cites": [h, k]}]},
            {"key": "impact", "heading": "Impact", "items": [
                {"key": "impact.0", "kind": "p", "text": "Search showed yesterday's prices on sale items for about two hours.", "cites": [b, k]},
                {"key": "impact.1", "kind": "p", "text": "Most customers who saw a stale price did not complete the order.", "cites": []}]},
            {"key": "why", "heading": "Why it happened", "items": [
                {"key": "why.0", "kind": "p", "text": "The cache key was built from the query alone; the price index was not part of it.",
                 "cites": [f]}]},
            {"key": "went", "heading": "What went well, what didn't", "items": [
                {"key": "went.0", "kind": "li", "text": "The cause was found 25 minutes after declaring, from the merge in the hour before.",
                 "cites": [d, f]},
                {"key": "went.1", "kind": "li", "text": "A customer noticed before anyone on the team did.", "cites": [b]}]}],
        "timeline": [{"at": at(-35, b13), "text": "#2270 merged", "cites": [a]},
                     {"at": at(14, b13), "text": "Reported by a customer through support", "cites": [b]},
                     {"at": at(16, b13), "text": f"{first} declared INC-13, SEV3", "cites": [d]},
                     {"at": at(41, b13), "text": "Cause found: the cache key", "cites": [f]},
                     {"at": at(102, b13), "text": "#2277 merged", "cites": [h]},
                     {"at": at(128, b13), "text": "Index rebuilt; prices right", "cites": [k]}],
        "built_from": {"messages": 3, "pinned": 1, "changes": 2, "deploys": 0, "triage": 0, "channel": "inc-13-search-stale"},
        "not_used": ["the call: no transcript connected", "metrics: not connected"]}
    out["incidents_flag"].append({"id": iid("sample", "flag", 13), "incident_id": i, "section": "impact",
                                  "claim": "Most customers who saw a stale price did not complete the order.",
                                  "reason": "No event is cited for this claim, and none gives how many orders were completed.",
                                  "offer": "Rewrite it from the events, or keep it.", "state": "open"})
    task(i13, "Put the price index in the search cache key", "done", who="jun", minutes=102, base=b13,
         why="The cache key left out the price index.")
    task(i13, "Alert when search results are older than the price index", "todo", who="theo", minutes=140, base=b13)
    i13["followups"] = [{"key": "fu13a", "title": "Review cache keys in every service that caches prices", "why": "The same mistake "
                         "could be anywhere a response is cached.", "owner_name": None, "state": "proposed", "task_id": None}]

    # ---------- INC-12 and INC-11: resolved, reviewed ----------
    b12 = t0 - _timedelta(days=14, hours=5)
    i12 = {"id": iid("sample", "incident", 12), "number": 12, "title": "Login emails delayed", "severity": "sev3",
           "status": "resolved", "lead_user_id": None, "lead_name": "Theo Park", "comms_name": None, "responders": rs("theo", "ines"),
           "service": "auth", "impact": "Sign-in links arrived late", "started_at": at(0, b12), "noticed_at": at(4, b12),
           "noticed_source": "Slack", "declared_at": at(5, b12), "declared_by": "Theo Park", "resolved_at": at(22, b12),
           "channel_name": "inc-12-login-emails", "source": "app", "writeup_state": "reviewed", "reviewed_by": "Theo Park",
           "writeup_path": "/incidents/INC-12.md", "writeup_at": at(30, b12), "summary": "Resolved: the email queue drained."}
    i = i12["id"]
    x1 = ev(i, 4, "message", "slack", "s12-1", "Ines Ruiz", "two customers say the sign-in link took 10 minutes", base=b12)
    x2 = ev(i, 12, "message", "slack", "s12-2", "Theo Park", "the email worker was stuck on one bounced address; restarted it", base=b12)
    x3 = ev(i, 22, "message", "slack", "s12-3", "Theo Park", "queue is empty, links arrive in seconds", base=b12)
    i12["writeup"] = {"title": "Sign-in emails arrived late for 22 minutes", "drafted_at": at(30, b12), "sections": [
        {"key": "summary", "heading": "Summary", "items": [
            {"key": "summary.0", "kind": "p", "text": "The email worker stopped on one bounced address and sign-in links queued behind it.",
             "cites": [x2]},
            {"key": "summary.1", "kind": "p", "text": "A restart drained the queue.", "cites": [x2, x3]}]}],
        "timeline": [{"at": at(4, b12), "text": "Customers report slow links", "cites": [x1]},
                     {"at": at(22, b12), "text": "Queue empty", "cites": [x3]}],
        "built_from": {"messages": 3, "pinned": 0, "changes": 0, "deploys": 0, "triage": 0, "channel": "inc-12-login-emails"},
        "not_used": []}
    task(i12, "Skip a bounced address instead of retrying it", "done", who="theo", minutes=60, base=b12)
    task(i12, "Alert when the email queue is older than 2 minutes", "todo", who="ines", minutes=60, base=b12)
    out["incidents_incident"].append(i12)

    b11 = t0 - _timedelta(days=26, hours=2)
    i11 = {"id": iid("sample", "incident", 11), "number": 11, "title": "Webhooks retried twice", "severity": "sev2",
           "status": "resolved", "lead_user_id": None, "lead_name": "Ines Ruiz", "comms_name": "Theo Park",
           "responders": rs("ines", "theo", "jun"), "service": "webhooks", "impact": "Partners received some order events twice",
           "started_at": at(0, b11), "noticed_at": at(9, b11), "noticed_source": "Slack", "declared_at": at(10, b11),
           "declared_by": "Ines Ruiz", "resolved_at": at(64, b11), "channel_name": "inc-11-webhooks-twice", "source": "app",
           "writeup_state": "reviewed", "reviewed_by": "Ines Ruiz", "writeup_path": "/incidents/INC-11.md", "writeup_at": at(80, b11),
           "summary": "Resolved: retries wait for the first attempt's timeout."}
    i = i11["id"]
    y1 = ev(i, 9, "message", "slack", "s11-1", "Jun Oda", "a partner sees every order.created twice since this morning", base=b11)
    y2 = ev(i, 30, "message", "slack", "s11-2", "Theo Park", "retry fires at 5 s but the partner answers in 7 s, so both land", base=b11)
    y3 = ev(i, 64, "message", "slack", "s11-3", "Ines Ruiz", "retry now waits for the 10 s timeout; no doubles since", base=b11)
    i11["writeup"] = {"title": "Order webhooks were sent twice for an hour", "drafted_at": at(80, b11), "sections": [
        {"key": "summary", "heading": "Summary", "items": [
            {"key": "summary.0", "kind": "p", "text": "Webhook retries fired before a slow partner's first answer, so both deliveries landed.",
             "cites": [y1, y2]},
            {"key": "summary.1", "kind": "p", "text": "Retries now wait for the first attempt's timeout.", "cites": [y3]}]}],
        "timeline": [{"at": at(9, b11), "text": "A partner reports doubles", "cites": [y1]},
                     {"at": at(64, b11), "text": "Fixed", "cites": [y3]}],
        "built_from": {"messages": 3, "pinned": 0, "changes": 0, "deploys": 0, "triage": 0, "channel": "inc-11-webhooks-twice"},
        "not_used": []}
    for title, who in (("Retry only after the first attempt times out", "theo"), ("Send an idempotency key with every webhook", "jun"),
                       ("Tell partners how to drop duplicate deliveries", "ines")):
        task(i11, title, "done", who=who, minutes=200, base=b11)
    out["incidents_incident"].append(i11)
    return out


def demo_writeup(t0: _datetime, lead: dict) -> dict:
    """What resolving INC-14 drafts, as the canvas has it: for the "Try it" demo's Resolve (.lemma/demo.js)."""
    rows = build(t0, lead)
    ev = {r["source_id"]: r["id"] for r in rows["incidents_event"] if r["incident_id"] == iid("sample", "incident", 14)}
    at = lambda m: (t0 + _timedelta(minutes=m)).isoformat()  # noqa: E731
    first = (lead.get("name") or "Mara Lind").split()[0]
    c = lambda *keys: [ev[k] for k in keys if k in ev]  # noqa: E731
    pr2291, dep = iid("sample", "change", "#2291"), iid("sample", "change", "Deploy #812")
    c2291 = event_id(iid("sample", "incident", 14), "github", pr2291)
    cdep = event_id(iid("sample", "incident", 14), "github", dep)
    resolved = {"id": event_id(iid("sample", "incident", 14), "app", "resolved:14"), "incident_id": iid("sample", "incident", 14),
                "at": at(45), "kind": "status", "source": "app", "source_id": "resolved:14", "actor": lead.get("name") or "Mara Lind",
                "text": f"Resolved by {first}: revert deployed, errors stopped", "url": None, "starred": False, "detail": None}
    return {
        "event": resolved,
        "writeup": {
            "title": "Checkout returned 502 for EU card payments", "drafted_at": at(46),
            "sections": [
                {"key": "summary", "heading": "Summary", "items": [
                    {"key": "summary.0", "kind": "p", "text": "A change merged at 13:58 cut the EU payment provider's timeout from 10 s to 1 s.",
                     "cites": [c2291]},
                    {"key": "summary.1", "kind": "p", "text": "The provider takes about 1.4 s to answer, so every EU card payment timed out "
                     "from the 14:01 deploy until the revert went out at 14:47.", "cites": [cdep] + c("pr:2294") + [resolved["id"]]},
                    {"key": "summary.2", "kind": "p", "text": "Wallets and non-EU cards were not affected.", "cites": c("s14-3")}]},
                {"key": "impact", "heading": "Impact", "items": [
                    {"key": "impact.0", "kind": "p", "text": "About 1,240 people saw a failed payment.", "cites": c("TRI-482:0")},
                    {"key": "impact.1", "kind": "p", "text": "Roughly €38,000 of orders were delayed, most of them retried later.", "cites": []}]},
                {"key": "why", "heading": "Why it happened", "items": [
                    {"key": "why.0", "kind": "p", "text": "The timeout was lowered to make a slow-provider page fail fast.", "cites": [c2291]},
                    {"key": "why.1", "kind": "p", "text": "Nothing tested the EU provider's real response time, and the change was reviewed "
                     "by someone who did not own payments.", "cites": c("s14-6")}]},
                {"key": "went", "heading": "What went well, what didn't", "items": [
                    {"key": "went.0", "kind": "li", "text": "Detected within a minute: Triage saw the spike in users before anyone reported it.",
                     "cites": c("TRI-482:0")},
                    {"key": "went.1", "kind": "li", "text": "First update took 12 minutes.", "cites": c("update:14-1")},
                    {"key": "went.2", "kind": "li", "text": "The call wasn't recorded, so its decisions are missing here.", "cites": []}]}],
            "timeline": [{"at": at(-4), "text": "#2291 merged", "cites": [c2291]},
                         {"at": at(-1), "text": "Deployed to production", "cites": [cdep]},
                         {"at": at(0), "text": "First TimeoutError; Triage marked it escalating", "cites": c("TRI-482:0")},
                         {"at": at(1), "text": f"{first} declared INC-14, SEV2", "cites": c("declared:14")},
                         {"at": at(10), "text": "Likely cause posted", "cites": c("hypothesis:14")},
                         {"at": at(20), "text": "Confirmed in staging", "cites": c("s14-6")},
                         {"at": at(29), "text": "Revert #2294 opened by the Lemma", "cites": c("pr:2294")},
                         {"at": at(45), "text": "Revert deployed; errors stopped", "cites": [resolved["id"]]}],
            "built_from": {"messages": 6, "pinned": 2, "changes": 4, "deploys": 1, "triage": 1, "channel": "inc-14-checkout-502",
                           "triage_label": "TRI-482"},
            "not_used": ["the call: no transcript connected", "metrics: not connected"]},
        "flags": [
            {"id": iid("sample", "flag", 14, 1), "incident_id": iid("sample", "incident", 14), "section": "impact", "state": "open",
             "claim": "Roughly €38,000 of orders were delayed, most of them retried later.",
             "reason": "No event backs this figure.", "offer": "Count it from a connected source, or remove the sentence."},
            {"id": iid("sample", "flag", 14, 2), "incident_id": iid("sample", "incident", 14), "section": "why", "state": "open",
             "claim": "Nothing tested the EU provider's real response time, and the change was reviewed by someone who did not own payments.",
             "reason": "The events it cites don't say who reviewed #2291.", "offer": "Rewrite it from the events, or keep it."}],
        "followups": [{"key": "fu14a", "title": "Contract test for the EU provider's response time", "why": "Nothing tested it.",
                       "owner_name": "Theo Park", "state": "proposed", "task_id": None},
                      {"key": "fu14b", "title": "Alert on EU card failure rate above 2%", "why": "Triage caught it; an alert would too.",
                       "owner_name": "Ines Ruiz", "state": "proposed", "task_id": None},
                      {"key": "fu14c", "title": "Require a payments owner on changes to payments/", "why": "The review may have missed it.",
                       "owner_name": None, "state": "proposed", "task_id": None}],
    }


def incidents_sample_data(ctx: FunctionContext, data: IncidentsSampleDataInput) -> IncidentsSampleDataResult:
    pod = ctx.pod
    me = caller(ctx)
    if data.mode == "clear":
        marked = q(pod, "SELECT table_name, row_id FROM incidents_sample_row LIMIT 5000")
        ids = [r["row_id"] for r in marked if r["table_name"] == "incidents_incident"]
        made = {}
        if ids:
            for table in ("incidents_flag", "incidents_update", "incidents_hypothesis", "incidents_event"):
                for r in q(pod, f"SELECT id FROM {table} WHERE incident_id IN ({lits(ids)}) LIMIT 5000"):
                    pod.records.delete(table, r["id"])
                    made[table] = made.get(table, 0) + 1
            for r in q(pod, f"SELECT id FROM task WHERE source = 'incidents' AND source_id IN ({lits(ids)}) LIMIT 1000"):
                pod.records.delete("task", r["id"])
                made["task"] = made.get("task", 0) + 1
        for r in marked:
            if r["table_name"] in ("incidents_change", "incidents_incident"):
                try:
                    pod.records.delete(r["table_name"], r["row_id"])
                    made[r["table_name"]] = made.get(r["table_name"], 0) + 1
                except Exception:  # noqa: BLE001 — gone already
                    pass
        for r in q(pod, "SELECT id FROM incidents_sample_row LIMIT 5000"):
            pod.records.delete("incidents_sample_row", r["id"])
        s = settings_of(pod)
        if s.get("id"):
            pod.records.update("incidents_settings", s["id"], {"sample": False})
        run_function(pod, "incidents_needs_you", {})
        return IncidentsSampleDataResult(made=made, message="Cleared the sample; your own incidents stay.")
    if q(pod, "SELECT id FROM incidents_sample_row LIMIT 1"):
        return IncidentsSampleDataResult(message="The sample is already here.")
    if q(pod, "SELECT id FROM incidents_incident WHERE number BETWEEN 11 AND 14 LIMIT 1"):
        return IncidentsSampleDataResult(message="This Lemma already has an INC-11 to INC-14; the sample would clash with them.")
    t0 = now() - _timedelta(minutes=38)
    built = build(t0, {"user_id": me["user_id"], "name": me["name"] or "Mara Lind"})
    made = {}
    for table in reversed(TABLES):
        batch = built[table]
        for start in range(0, len(batch), 100):
            pod.records.bulk_create(table, batch[start: start + 100], upsert=True)
        made[table] = len(batch)
        marks = [{"id": iid("sample-row", table, r["id"]), "table_name": table, "row_id": r["id"]} for r in batch
                 if table in ("incidents_incident", "incidents_change")]
        if marks:
            pod.records.bulk_create("incidents_sample_row", marks, upsert=True)
    s = settings_of(pod)
    pod.records.bulk_create("incidents_settings", [{
        "id": s.get("id") or SETTINGS_ID, "sample": True,
        "repos": s["repos"] or [{"repo": "shop/checkout-api", "service": "checkout-api", "deploy_workflow": "Deploy"}],
        "email_to": s["email_to"] or ["support@company.example", "cx@company.example", "finance@company.example"],
        "announce_channel_name": s.get("announce_channel_name") or "incidents", "severities": s["severities"]}], upsert=True)
    run_function(pod, "incidents_needs_you", {})
    return IncidentsSampleDataResult(made=made, message="Loaded the sample: INC-14 open, and three past incidents with write-ups.")
