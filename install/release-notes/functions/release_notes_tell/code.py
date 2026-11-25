#input_type_name: ReleaseNotesTellInput
#output_type_name: ReleaseNotesTellResult
#function_name: release_notes_tell

"""Each member's own run: someone they heard asking has had their work ship.
The two steps of the `release-notes-tell` workflow, around the replier agent,
started by the member's own trigger on `ask` (rows: OWNER_READABLE, so it runs
as them and reads only their own conversations).

`brief`: only for an ask `heard_by` this member, `shipped`, with a
conversation of theirs and no reply drafted yet. Gathers what the replier
needs: their thread (subject and the messages' snippets, newest last), what
shipped (the note's line, the version, when it went live), how long they
waited (past 14 days the reply says sorry for the wait) and the member's own
voice from Mail, if they set one.

`save`: the reply as a Mail `draft` in that conversation (kind reply,
`built_from` the ask, id uuid5(RN_NS, "reply:<ask id>") so it is written
once), and an `answer` in their Today with `prepared` "Reply drafted". Mail
shows the draft in its reader and sends it when they press Send; nothing here
sends.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# release-notes:common
# Shared by every Release notes function, word for word (bin/common.py).
import json as _json
import re as _re
import time as _time
import uuid as _uuid
from datetime import datetime as _datetime, timedelta as _timedelta, timezone as _tz

RN_NS = _uuid.UUID("5d3a7c2e-9b14-4f6a-8e21-c4b7a9d0f513")
ASK_NS = _uuid.UUID("9972cf8e-4f42-4b98-86fc-fa5697c1f089")
SETTINGS_ID = str(_uuid.uuid5(RN_NS, "settings"))
PLUGIN = "release-notes"
APP = "release-notes"
IN_NOTE = ("feature", "improvement", "fix", "breaking")
LEFT_OUT_KINDS = ("routine", "internal")
COUNTED = ("open", "shipped", "told")


def rid(*parts) -> str:
    """A stable id from its parts: a pull request is rid("owner/repo#12")."""
    return str(_uuid.uuid5(RN_NS, ":".join(str(p) for p in parts)))


def pr_id(repo: str, number) -> str:
    return str(_uuid.uuid5(RN_NS, f"{repo}#{int(number)}"))


def ask_id(handle_kind, handle, source, source_id, work_source, work_id) -> str:
    """The contract's id for an ask (_contract/tables/ask.json)."""
    return str(_uuid.uuid5(ASK_NS, f"{handle_kind}:{handle}|{source}:{source_id}|{work_source}:{work_id}"))


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


def jl(value, default=None):
    """A JSON column as Python, whether the API handed back text or JSON."""
    if value is None or value == "":
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return _json.loads(value)
    except (TypeError, ValueError):
        return default


def now_iso() -> str:
    return _datetime.now(_tz.utc).isoformat()


def stamp(value):
    if not value:
        return None
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def clip(text, n: int):
    text = (str(text) if text is not None else "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "\u2026"


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM release_note_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM release_note_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["repos"] = jl(s.get("repos"), []) or []
    s["publishers"] = jl(s.get("publishers"), []) or []
    s["schedules"] = jl(s.get("schedules"), {}) or {}
    return s


def repo_of(settings: dict, name) -> dict | None:
    for r in settings.get("repos") or []:
        if str(r.get("name", "")).lower() == str(name or "").lower():
            return r
    return None


def issue_ref(repo: str, number) -> str:
    return f"{repo}#{int(number)}"


def gh(pod, op: str, payload: dict):
    """One GitHub call through the Lemma's shared connection; the result's body."""
    result = as_dict(pod.connectors.execute("github", op, payload)).get("result")
    if isinstance(result, dict) and "data" in result and len(result) <= 3:
        return result["data"]
    return result


def gh_list(result) -> list:
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        for key in ("items", "data", "result", "commits", "workflow_runs", "repositories", "workflows"):
            if isinstance(result.get(key), list):
                return result[key]
    return []


def owner_name(repo: str):
    owner, _, name = str(repo).partition("/")
    return owner, name


def decide(pod, instruction: str, schema: dict, evidence) -> dict:
    """One Decisions call, retried on rate limits; {"answers": {...}} or {"error": ...}."""
    for attempt in range(4):
        try:
            got = as_dict(pod.decisions.make(instruction=instruction, schema=schema, evidence=evidence, priority="background"))
            answers = {}
            for key, value in as_dict(got.get("answers")).items():
                value = as_dict(value) if not isinstance(value, (str, int, float, bool, list)) else {"value": value}
                answers[key] = value.get("value")
            return {"answers": answers}
        except Exception as exc:  # noqa: BLE001 - classified below
            status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
            if status == 429 or "RATE_LIMITED" in str(exc):
                _time.sleep(float(getattr(exc, "retry_after", None) or 8))
                continue
            if status in (502, 503, 504) or "UNAVAILABLE" in str(exc):
                _time.sleep(1.5 * (attempt + 1))
                continue
            return {"error": f"{type(exc).__name__}: {exc}"[:300]}
    return {"error": "the Decisions API was unavailable"}


def open_note(pod, repo: str) -> dict | None:
    found = q(pod, f"SELECT * FROM release_note WHERE repo = {lit(repo)} AND state <> 'published' "
                   "ORDER BY created_at DESC LIMIT 1")
    return found[0] if found else None


def next_version(tag) -> str:
    """v2.13 -> v2.14, 2.13.4 -> 2.14.0; nothing yet -> v0.1."""
    if not tag:
        return "v0.1"
    m = _re.match(r"^(\D*)(\d+)(?:\.(\d+))?((?:\.\d+)*)(.*)$", str(tag))
    if not m:
        return f"{tag}-next"
    prefix, major, minor, rest, _suffix = m.groups()
    if minor is None:
        return f"{prefix}{int(major) + 1}"
    zeros = "".join(".0" for _ in rest.split(".")[1:]) if rest else ""
    return f"{prefix}{major}.{int(minor) + 1}{zeros}"
# end release-notes:common

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

SORRY_AFTER_DAYS = 14


class ReleaseNotesTellInput(BaseModel):
    mode: str = "brief"
    ask_id: str | None = None
    written: dict | None = None


class ReleaseNotesTellResult(BaseModel):
    skip: bool = False
    brief: dict | None = None
    draft_id: str | None = None
    message: str


def _ask(pod, ask_id):
    found = q(pod, f"SELECT * FROM ask WHERE id = {lit(ask_id)}") if ask_id else []
    return found[0] if found else None


def _line(pod, a: dict):
    """The published note line this ask's work is in, and its note."""
    for ln in q(pod, "SELECT l.*, n.name AS version, n.live_at AS note_live_at, n.published_at, n.repo FROM release_note_line l "
                     "JOIN release_note n ON n.id = l.note_id WHERE n.state = 'published' AND l.hidden IS NOT TRUE "
                     "ORDER BY n.published_at DESC LIMIT 400"):
        refs = (jl(ln.get("issues"), []) or []) + [issue_ref(ln["repo"], n) for n in (jl(ln.get("prs"), []) or [])]
        if a.get("work_id") in refs:
            return ln
    return None


def release_notes_tell(ctx: FunctionContext, data: ReleaseNotesTellInput) -> ReleaseNotesTellResult:
    pod = ctx.pod
    me = str(ctx.user_id)
    a = _ask(pod, data.ask_id)
    if not a:
        return ReleaseNotesTellResult(skip=True, message="No such ask.")
    if str(a.get("heard_by") or "") != me:
        return ReleaseNotesTellResult(skip=True, message="Someone else heard this ask; their own run tells them.")
    if a.get("state") != "shipped":
        return ReleaseNotesTellResult(skip=True, message=f"The ask is {a.get('state')}, not shipped.")
    draft_id = rid("reply", a["id"])
    if q(pod, f"SELECT id FROM draft WHERE id = {lit(draft_id)}"):
        return ReleaseNotesTellResult(skip=True, draft_id=draft_id, message="A reply is already drafted.")
    conv = q(pod, f"SELECT * FROM conversation WHERE id = {lit(a.get('conversation_id'))}") if a.get("conversation_id") else []
    if not conv:
        return ReleaseNotesTellResult(skip=True, message="Their conversation isn't in your mail any more; nothing to reply in.")
    conv = conv[0]
    line = _line(pod, a)
    if not line:
        return ReleaseNotesTellResult(skip=True, message="Not in a published note yet.")

    if data.mode == "brief":
        msgs = q(pod, f"SELECT direction, from_name, from_handle, sent_at, snippet FROM message WHERE conversation_id = {lit(conv['id'])} "
                      "ORDER BY sent_at DESC LIMIT 6")
        asked = stamp(a.get("asked_at"))
        waited = (_datetime.now(_tz.utc) - asked).days if asked else 0
        voice = None
        try:
            got = q(pod, "SELECT voice FROM mail_settings LIMIT 1")
            voice = got[0].get("voice") if got else None
        except Exception:  # noqa: BLE001 - Mail's own table; the reply is written without it
            voice = None
        brief = {
            "to": {"name": a.get("name") or conv.get("counterpart_name"), "handle": a.get("handle"), "company": a.get("company_name")},
            "thread": {"subject": conv.get("subject"),
                       "messages": [{"from": m.get("from_name") or m.get("from_handle"), "direction": m.get("direction"),
                                     "at": m.get("sent_at"), "text": m.get("snippet")} for m in reversed(msgs)]},
            "asked_at": a.get("asked_at"), "waited_days": waited, "say_sorry": waited > SORRY_AFTER_DAYS,
            "shipped": {"version": line["version"], "title": line.get("title"), "text": line["text"],
                        "live_since": line.get("note_live_at") or line.get("published_at")},
            "voice": voice,
        }
        return ReleaseNotesTellResult(brief=brief, message=f"Writing to {brief['to']['name'] or a['handle']}.")

    written = data.written or {}
    if isinstance(written.get("answer"), dict):
        written = written["answer"]
    body = str(written.get("body") or "").strip()
    if not body or written.get("skip"):
        return ReleaseNotesTellResult(skip=True, message=written.get("skip_reason") or "The replier wrote nothing.")
    subject = conv.get("subject") or ""
    to = [a["handle"]] if a.get("handle_kind") == "email" and "@" in str(a.get("handle")) else (
        [conv["counterpart_handle"]] if conv.get("counterpart_handle") else [])
    pod.records.bulk_create("draft", [{
        "id": draft_id, "conversation_id": conv["id"], "source": conv.get("source") or "mail",
        "source_account": conv.get("source_account") or "", "kind": "reply", "to_handles": to,
        "subject": subject if subject.lower().startswith("re:") or not subject else f"Re: {subject}",
        "body": body, "original_body": body, "state": "proposed",
        "rationale": clip(written.get("rationale") or f"It shipped in {line['version']}: {line.get('title') or line['text']}", 800),
        "built_from": {"plugin": PLUGIN, "ask_id": a["id"], "note_id": line["note_id"], "line_id": line["id"],
                       "used": plain_used(written.get("used") or [], a.get("asked_at"))},
    }], upsert=True)
    first = str(a.get("name") or conv.get("counterpart_name") or a["handle"]).split(" ")[0]
    needs_you_write(pod, PLUGIN, me, [{
        "verb": "answer", "source_table": "ask", "source_id": a["id"], "source_version": f"shipped|{line['version']}",
        "title": f"Tell {first} it shipped", "why": clip(f"{a.get('name') or first} asked you {asked_ago(a.get('asked_at'))}; "
                                                          f"it shipped in {line['version']}", 300),
        "quote": clip(line.get("title") or line["text"], 600), "person_name": a.get("name"), "person_handle": a.get("handle"),
        "conversation_id": conv["id"], "since_at": a.get("asked_at"), "weight": 5.0,
        "app": APP, "path": f"/asked/{a['id']}", "prepared": "Reply drafted", "prepared_text": clip(body, 2000),
    }], f"source_table = 'ask' AND source_id = {lit(a['id'])}")
    return ReleaseNotesTellResult(draft_id=draft_id, message=f"Reply to {first} drafted in your thread.")


def asked_ago(value) -> str:
    moment = stamp(value)
    if not moment:
        return "a while ago"
    days = (_datetime.now(_tz.utc) - moment).days
    if days < 1:
        return "today"
    if days < 14:
        return f"{days} day{'s' if days != 1 else ''} ago"
    if days < 70:
        return f"{days // 7} weeks ago"
    return f"in {moment.strftime('%B')}"


def plain_used(used: list, asked_at) -> list:
    """The margin's labels in plain words: the writer sometimes names the brief's
    fields (waited_days, say_sorry); those become "asked 10 weeks ago, so it says sorry"."""
    out = [str(u) for u in used if u and not _re.search(r"waited_days|say_sorry", str(u))]
    if len(out) < len(used):
        moment = stamp(asked_at)
        days = (_datetime.now(_tz.utc) - moment).days if moment else 0
        if days > SORRY_AFTER_DAYS:
            out.append(f"asked {days // 7} weeks ago, so it says sorry")
    return out[:4]

