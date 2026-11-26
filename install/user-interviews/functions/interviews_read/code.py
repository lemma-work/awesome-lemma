#input_type_name: InterviewsReadInput
#output_type_name: InterviewsReadResult
#function_name: interviews_read

"""Read one call for findings: the two steps of the `interviews-read`
workflow, around the `interviews-reader` agent (no tools, an output schema).
Runs as the member who had the call: the document is in their own files.

`brief`: the document (Meet's transcript as `[m:ss] Speaker: words` lines,
the member's notes, or a pasted transcript), the study's question and
features (names, descriptions, other names), who was interviewed and who
asked.

`save`, Meetings' rule and then some:
- a proposal is kept only when its quote is in the document word for word
  (spacing, case and quote marks aside);
- `at_seconds` is the nearest `[m:ss]` at or above the quote's line;
- a line spoken by the member themselves is dropped;
- a feature the agent named that isn't on the list is kept as a new one's
  name (`feature_new`), suggested only once the member keeps it.
Proposals are the member's own (RLS) until kept. Reading again keeps what
they already kept or set aside. Then "N findings from the call with X to
review" in their Today.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# interviews:common
# Shared by every User interviews function, word for word: bin/common.py
# copies it in. Edit it there, never here.
import hashlib as _hashlib
import json as _json
import re as _re
import time as _time
import uuid as _uuid
from datetime import date as _date, datetime as _datetime, timedelta as _timedelta, timezone as _tz
from zoneinfo import ZoneInfo as _Zone

INTERVIEWS_NS = _uuid.UUID("119b800c-47d6-43fe-9576-6e281b149300")
FEEDBACK_NS = _uuid.UUID("19126ba2-6613-4244-a0c9-bb395b202890")
COMPANY_NS = _uuid.UUID("c6fc6ea2-4356-443e-8065-e1d71b8f6359")
SETTINGS_ID = str(_uuid.uuid5(INTERVIEWS_NS, "settings"))
PLUGIN = "user-interviews"
APP = "interviews"
# A person who asked never to hear from us again rests until then.
NEVER = "2100-01-01T00:00:00+00:00"
ZONE_ALIASES = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv",
                "US/Eastern": "America/New_York", "US/Pacific": "America/Los_Angeles"}
FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "me.com",
            "proton.me", "protonmail.com", "aol.com"}
# Stages before an invite went out: the contact rules can still hold them back.
NOT_SENT = ("fits", "drafted")


def rid(*parts) -> str:
    """A stable id from its parts."""
    return str(_uuid.uuid5(INTERVIEWS_NS, ":".join(str(p) for p in parts)))


def person_row_id(study_id, handle_kind, handle) -> str:
    return str(_uuid.uuid5(INTERVIEWS_NS, f"{study_id}:{handle_kind}:{str(handle).strip().lower()}"))


def quote_key(quote) -> str:
    """The contract's quote key: sha1 of the quote lowercased, whitespace collapsed, first 16 hex."""
    return _hashlib.sha1(" ".join(str(quote or "").lower().split()).encode("utf-8")).hexdigest()[:16]


def feedback_row_id(source, source_id, quote) -> str:
    """The contract's id for a `feedback` row (_contract/tables/feedback.json)."""
    return str(_uuid.uuid5(FEEDBACK_NS, f"{source}:{source_id}|{quote_key(quote)}"))


def rows(response) -> list:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def q(pod, sql: str) -> list:
    return rows(pod.query(sql))


def q_all(pod, sql: str, page: int = 1000, most: int = 20000) -> list:
    """Every row of a read, a page at a time (a read answers at most 1000)."""
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


def now_utc() -> _datetime:
    return _datetime.now(_tz.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def stamp(value):
    if not value:
        return None
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def zone(name) -> _Zone:
    try:
        return _Zone(ZONE_ALIASES.get(str(name or ""), str(name or "UTC")))
    except Exception:  # noqa: BLE001 - an unknown zone reads as UTC
        return _Zone("UTC")


def day_said(value, tz="UTC") -> str:
    """26 Nov (and the year when it isn't this one)."""
    moment = stamp(value)
    if not moment:
        return ""
    local = moment.astimezone(zone(tz))
    text = f"{local.day} {local.strftime('%b')}"
    return text if local.year == now_utc().astimezone(zone(tz)).year else f"{text} {local.year}"


def clip(value, n: int):
    text = " ".join(str(value if value is not None else "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "\u2026"


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def first_name(name, handle=None) -> str:
    text = str(name or "").strip()
    if text:
        return text.split()[0]
    return str(handle or "someone").split("@")[0]


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM interviews_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM interviews_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["invite_gap_days"] = int(s.get("invite_gap_days") or 30)
    s["no_show_days"] = int(s.get("no_show_days") or 90)
    s["nudge_days"] = int(s.get("nudge_days") or 4)
    return s


def fn(pod, name: str, payload: dict) -> dict:
    """Run another function of this Lemma (as the same person); its output."""
    return as_dict(as_dict(pod.functions.run(name, payload)).get("output_data"))


def start_read(pod, person_id: str) -> None:
    """Read one call for findings: the interviews-read workflow, as the person running this."""
    pod.workflows.run("interviews-read", about=("interviews_person", person_id))


def rest_for(row: dict, others: list, s: dict, now=None):
    """Whether the contact rules hold this person back in this study, and why.

    `others` are every study's rows for the same handle. Never after they
    opted out (anywhere); not for no_show_days after a no-show; not within
    invite_gap_days of an invite sent from another study. A person's
    override lets them through the last two, never the first."""
    now = now or now_utc()
    if row.get("stage") not in NOT_SENT:
        return None, None
    out = [o for o in others if o.get("stage") == "opted_out"]
    if out:
        return NEVER, "Asked not to be invited again"
    override = stamp(row.get("override_at"))
    found = []
    for o in others:
        if o.get("id") == row.get("id"):
            continue
        missed = stamp(o.get("no_show_at"))
        if missed and (not override or override < missed):
            until = missed + _timedelta(days=s["no_show_days"])
            if until > now:
                found.append((until, f"Missed a call on {day_said(missed)}"))
        sent = stamp(o.get("invited_at"))
        if sent and (not override or override < sent):
            until = sent + _timedelta(days=s["invite_gap_days"])
            if until > now:
                found.append((until, f"Invited {day_said(sent)} to another study"))
    if not found:
        return None, None
    until, rule = max(found, key=lambda f: f[0])
    return until.isoformat(), rule


def rest_refresh(pod, s: dict, handles) -> int:
    """Work the contact rules out again for every row of these handles; the rows that changed."""
    handles = sorted({str(h).lower() for h in handles if h})
    changed = 0
    for start in range(0, len(handles), 100):
        got = q_all(pod, "SELECT id, handle, stage, invited_at, no_show_at, override_at, rests_until, rest_rule "
                         f"FROM interviews_person WHERE handle IN ({lits(handles[start:start + 100])}) ORDER BY id")
        by: dict = {}
        for r in got:
            by.setdefault(str(r.get("handle") or "").lower(), []).append(r)
        updates = []
        for group in by.values():
            for r in group:
                until, rule = rest_for(r, group, s)
                if (stamp(until) != stamp(r.get("rests_until"))) or (rule or None) != (r.get("rest_rule") or None):
                    updates.append({"id": r["id"], "rests_until": until, "rest_rule": rule})
        for i in range(0, len(updates), 100):
            pod.records.bulk_update("interviews_person", updates[i:i + 100])
        changed += len(updates)
    return changed


def is_resting(row: dict, now=None) -> bool:
    until = stamp(row.get("rests_until"))
    return bool(until and until > (now or now_utc()) and row.get("stage") in NOT_SENT)


def norm_text(text) -> str:
    """For checking a quote against a document word for word (Meetings' rule):
    spacing, case and quote marks aside."""
    text = str(text or "").replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2014", "-").replace("\u2013", "-")
    return " ".join(text.split()).lower().strip(" .\"'")


TIME_LINE = _re.compile(r"^\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(?:([^:\n]{1,60}):\s*)?(.*)$")


def line_time(line: str):
    """Seconds into the call of a '[m:ss] Speaker: words' line (h:mm:ss past an hour), its speaker and words."""
    m = TIME_LINE.match(line or "")
    if not m:
        return None, None, line
    a, b, c, who, words = m.groups()
    secs = int(a) * 3600 + int(b) * 60 + int(c) if c is not None else int(a) * 60 + int(b)
    return secs, (who or "").strip() or None, words


def mm_ss(secs) -> str:
    if secs is None:
        return ""
    secs = int(secs)
    h, rest = divmod(secs, 3600)
    m, s_ = divmod(rest, 60)
    return f"{h}:{m:02d}:{s_:02d}" if h else f"{m}:{s_:02d}"
# end interviews:common

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

# interviews:needs
# Owned by interviews_daily; bin/common.py copies it into every function that
# writes needs_you. Everything of User interviews that needs this member now:
# needs_you_write(pod, PLUGIN, me, needs_now(pod, me), None) then closes the rest.
SHOW_UP_AFTER_HOURS = 2


def needs_now(pod, me: str) -> list:
    items = []
    now = now_utc()
    studies = {r["id"]: r for r in q_all(pod, "SELECT id, question, state FROM interviews_study ORDER BY id")}
    # Findings to review: the member's own open proposals (RLS: only theirs), per call.
    open_by: dict = {}
    for p in q_all(pod, "SELECT person_id FROM interviews_proposal WHERE state = 'open' ORDER BY id"):
        open_by[p["person_id"]] = open_by.get(p["person_id"], 0) + 1
    people = {}
    if open_by:
        ids = sorted(open_by)
        for i in range(0, len(ids), 200):
            for r in q(pod, f"SELECT * FROM interviews_person WHERE id IN ({lits(ids[i:i + 200])})"):
                people[r["id"]] = r
    for pid, n in sorted(open_by.items()):
        p = people.get(pid)
        if not p:
            continue
        study = studies.get(p["study_id"]) or {}
        who = p.get("company_name") or p.get("name") or p["handle"]
        items.append({
            "verb": "decide", "source_table": "interviews_proposal", "source_id": pid, "source_version": f"open|{n}",
            "title": clip(f"{plural(n, 'finding')} from the call with {who} to review", 300),
            "why": clip(study.get("question") or "", 300), "person_name": p.get("name"), "person_handle": p.get("handle"),
            "since_at": p.get("call_at"), "weight": 4.0, "app": APP, "path": f"/s/{p['study_id']}/p/{pid}",
            "prepared": "Findings proposed, each with its quote"})
    # Did they show up: a booked call of theirs that ended a while ago, with nothing to read.
    for p in q_all(pod, "SELECT * FROM interviews_person WHERE stage = 'booked' AND read_state = 'none' "
                        f"AND inviter_user_id = {lit(me)} ORDER BY id"):
        end = stamp(p.get("call_end_at")) or ((stamp(p.get("call_at")) + _timedelta(minutes=45)) if p.get("call_at") else None)
        if not end or end > now - _timedelta(hours=SHOW_UP_AFTER_HOURS):
            continue
        items.append({
            "verb": "decide", "source_table": "interviews_person", "source_id": p["id"],
            "source_version": f"show|{p.get('call_at')}",
            "title": clip(f"Did {first_name(p.get('name'), p['handle'])} show up for your call?", 300),
            "why": clip(f"No transcript or notes yet. {(studies.get(p['study_id']) or {}).get('question') or ''}", 300),
            "person_name": p.get("name"), "person_handle": p.get("handle"), "due_at": p.get("call_at"), "ends_at": p.get("call_end_at"),
            "weight": 3.0, "app": APP, "path": f"/s/{p['study_id']}/p/{p['id']}"})
    # Invites waiting for Send, per study.
    waiting: dict = {}
    for p in q_all(pod, "SELECT study_id FROM interviews_person WHERE stage = 'drafted' AND invite_state = 'drafted' "
                        f"AND inviter_user_id = {lit(me)} ORDER BY id"):
        waiting[p["study_id"]] = waiting.get(p["study_id"], 0) + 1
    for sid, n in sorted(waiting.items()):
        study = studies.get(sid) or {}
        if study.get("state") != "running":
            continue
        items.append({
            "verb": "do", "source_table": "interviews_study", "source_id": sid, "source_version": f"invites|{n}",
            "title": clip(f"{plural(n, 'invite')} to send", 300), "why": clip(study.get("question") or "", 300),
            "weight": 2.0, "app": APP, "path": f"/s/{sid}/invites", "prepared": "Each written in your voice"})
    return items


def needs_refresh(pod, me: str) -> dict:
    try:
        return needs_you_write(pod, PLUGIN, me, needs_now(pod, me), None)
    except Exception as exc:  # noqa: BLE001 - Today catches up on the next run
        return {"error": clip(str(exc), 300)}
# end interviews:needs

MAX_CHARS = 60000
MOST = 12


class InterviewsReadInput(BaseModel):
    mode: str = "brief"
    person_id: str | None = None
    written: dict | None = None


class InterviewsReadResult(BaseModel):
    skip: bool = False
    brief: dict | None = None
    found: int = 0
    dropped: int = 0
    message: str


def _safe(pod, sql: str) -> list:
    try:
        return q(pod, sql)
    except Exception:  # noqa: BLE001 - another plugin's table, not set up for this person
        return []


def _me_names(pod) -> set:
    names = {"you", "me", "interviewer"}
    for row in _safe(pod, "SELECT display_name FROM meetings_settings LIMIT 1") + _safe(pod, "SELECT display_name FROM mail_settings LIMIT 1"):
        full = str(row.get("display_name") or "").strip().lower()
        if full:
            names.add(full)
            names.add(full.split()[0])
    return names


def _lines(text: str) -> list:
    """Each line of the document: (seconds or None, speaker or None, words, normalized words)."""
    out = []
    for raw in (text or "").splitlines():
        secs, who, words = line_time(raw)
        if secs is None:
            # 'Name: words' without a time, as a pasted transcript often is.
            m = _re.match(r"^\s*([A-Z][\w .'\-]{0,40}):\s+(.+)$", raw)
            if m and len(m.group(1).split()) <= 4:
                who, words = m.group(1).strip(), m.group(2)
        out.append((secs, who, words, norm_text(words)))
    return out


def _find(lines: list, quote_n: str):
    """The line a quote starts on, or None: one line, or across up to three."""
    if not quote_n:
        return None
    for i, (_s, _w, _words, n) in enumerate(lines):
        if quote_n in n:
            return i
    for i in range(len(lines)):
        joined = " ".join(lines[j][3] for j in range(i, min(i + 3, len(lines))) if lines[j][3])
        if quote_n in joined and lines[i][3] and (joined.find(quote_n) < len(lines[i][3])):
            return i
    return None


def interviews_read(ctx: FunctionContext, data: InterviewsReadInput) -> InterviewsReadResult:
    pod = ctx.pod
    me = str(ctx.user_id)
    p = (q(pod, f"SELECT * FROM interviews_person WHERE id = {lit(data.person_id)}") if data.person_id else [None])[0]
    if not p:
        return InterviewsReadResult(skip=True, message="No such person.")
    if not p.get("doc_path"):
        return InterviewsReadResult(skip=True, message="Nothing to read yet: no transcript or notes for this call.")
    try:
        text = pod.files.download(p["doc_path"]).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001 - someone else's file, or gone
        pod.records.update("interviews_person", p["id"], {
            "read_state": "failed", "read_error": "Only the person who had the call can read its transcript or notes."})
        return InterviewsReadResult(skip=True, message="The document isn't yours to read.")
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + "\n[cut]"
    study = (q(pod, f"SELECT * FROM interviews_study WHERE id = {lit(p['study_id'])}") or [{}])[0]
    doc_kind = p.get("doc_kind") or "transcript"

    if data.mode == "brief":
        pod.records.update("interviews_person", p["id"], {"read_state": "reading", "read_error": None})
        want = set(jl(study.get("feature_ids"), []) or [])
        feats = q_all(pod, "SELECT id, name, description, aliases, state FROM feature WHERE state IN ('active', 'suggested') ORDER BY name")
        feats.sort(key=lambda f: (0 if f["id"] in want else 1, f["name"]))
        me_name = next(iter(sorted(n for n in _me_names(pod) if " " in n)), None)
        return InterviewsReadResult(brief={
            "question": study.get("question"),
            "features": [{"id": f["id"], "name": f["name"], "description": clip(f.get("description"), 300) or None,
                          "aliases": jl(f.get("aliases"), []) or [], "in_study": f["id"] in want} for f in feats[:60]],
            "them": {"name": p.get("name"), "title": p.get("title"), "company": p.get("company_name")},
            "me": {"name": me_name.title() if me_name else None},
            "doc_kind": "notes" if doc_kind == "notes" else "transcript",
            "text": text}, message=f"Reading the call with {p.get('name') or p['handle']}.")

    written = data.written or {}
    if isinstance(written.get("answer"), dict):
        written = written["answer"]
    lines = _lines(text)
    mine = _me_names(pod)
    them = {str(p.get("name") or "").strip().lower(), first_name(p.get("name"), p["handle"]).lower()}
    feats = {f["id"]: f for f in q_all(pod, "SELECT id, name, state FROM feature WHERE state <> 'merged' ORDER BY id")}
    by_name = {str(f["name"]).strip().lower(): f["id"] for f in feats.values()}
    found, dropped, seen = [], 0, set()
    for f in (written.get("findings") or [])[: MOST * 2]:
        if not isinstance(f, dict):
            continue
        quote = " ".join(str(f.get("quote") or "").split()).strip().strip('"“”')
        quote = _re.sub(r"^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*", "", quote)
        i = _find(lines, norm_text(quote))
        if i is None or len(quote) < 8:
            dropped += 1
            continue
        speaker = str(lines[i][1] or "").strip().lower()
        if doc_kind != "notes" and speaker and speaker in mine and speaker not in them:
            dropped += 1
            continue
        key = quote_key(quote)
        if key in seen:
            continue
        seen.add(key)
        secs = None
        if doc_kind != "notes":
            for j in range(i, -1, -1):
                if lines[j][0] is not None:
                    secs = lines[j][0]
                    break
        fid = str(f.get("feature_id") or "").strip() or None
        new = clip(f.get("feature_new"), 120) or None
        if fid and fid not in feats:
            fid = None
        if not fid and new and new.lower() in by_name:
            fid, new = by_name[new.lower()], None
        found.append({"quote": clip(quote, 2000), "line": i, "at_seconds": secs, "point": clip(f.get("point"), 200),
                      "feature_id": fid, "feature_new": None if fid else new,
                      "kind": f.get("kind") if f.get("kind") in ("request", "problem", "praise", "question", "comparison", "other") else "other",
                      "importance": f.get("importance") if f.get("importance") in ("unknown", "nice", "important", "blocker") else "unknown",
                      "reason": clip(f.get("reason"), 300), "key": key})
        if len(found) >= MOST:
            break

    before = {r["id"]: r for r in q_all(pod, f"SELECT id, state, line FROM interviews_proposal WHERE person_id = {lit(p['id'])} ORDER BY id")}
    writes = []
    for f in found:
        pid = rid("proposal", p["id"], f.pop("key"))
        old = before.get(pid)
        if old and old.get("state") != "open":
            continue
        writes.append(dict(f, id=pid, person_id=p["id"], study_id=p["study_id"], meeting_id=p.get("meeting_id"),
                           state="open", sample=bool(p.get("sample"))))
    fresh = {w["id"] for w in writes}
    stale = [i for i, r in before.items() if r.get("state") == "open" and i not in fresh]
    if stale:
        pod.records.bulk_delete("interviews_proposal", stale)
    if writes:
        pod.records.bulk_create("interviews_proposal", writes, upsert=True)
    # Number them in the order said, kept ones included.
    allp = q_all(pod, f"SELECT id, line, n FROM interviews_proposal WHERE person_id = {lit(p['id'])} ORDER BY id")
    allp.sort(key=lambda r: (r.get("line") if r.get("line") is not None else 10 ** 6, r["id"]))
    renumber = [{"id": r["id"], "n": k + 1} for k, r in enumerate(allp) if r.get("n") != k + 1]
    for i in range(0, len(renumber), 100):
        pod.records.bulk_update("interviews_proposal", renumber[i:i + 100])
    states = q_all(pod, f"SELECT state FROM interviews_proposal WHERE person_id = {lit(p['id'])} ORDER BY id")
    pod.records.update("interviews_person", p["id"], {
        "read_state": "ready", "read_error": None, "stage": "done" if p.get("stage") in ("booked", "no_show") else p.get("stage"),
        "doc_lines": len([ln for ln in lines if ln[3]]), "found": len(states),
        "kept": sum(1 for r in states if r.get("state") == "kept"),
        "set_aside": sum(1 for r in states if r.get("state") == "set_aside")})
    needs_refresh(pod, me)
    who = p.get("name") or p["handle"]
    return InterviewsReadResult(found=len(writes), dropped=dropped,
                                message=f"{plural(len(writes), 'finding')} proposed from the call with {who}"
                                        + (f"; {dropped} left out (not in the text word for word, or your own words)." if dropped else "."))
