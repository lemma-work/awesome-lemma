#input_type_name: InterviewsKeepInput
#output_type_name: InterviewsKeepResult
#function_name: interviews_keep

"""Keep or set aside one proposed finding, as the interviewer (proposals are
theirs: only they can). An edited point, feature, kind or importance comes
with it.

Kept: a team-wide `feedback` row, by the contract's id rule
(uuid5(FEEDBACK_NS, "<source>:<source_id>|<quote key>")):
- `source` interview (a transcript, Meet's or pasted) or note (the
  interviewer's own notes, their words not the speaker's); `source_id` the
  call's `meeting.source_id` (a call with no meeting: "interviews:<person id>");
  `at_seconds`;
- `heard_by` the interviewer, `plugin` user-interviews, `state` processed;
- `filed_by` lemma, or person when they changed the feature;
- `importance` and `kind`.
A new feature's name becomes a `feature` (`state` suggested, `origin`
lemma) under the team's product, or the existing one of that name. Then
`interviews_finding` (same id) puts it in the study, and the person's counts
are kept.

`undo`: back to open; a kept finding's `feedback` row is set aside and leaves
the study.
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

KINDS = ("request", "problem", "praise", "question", "comparison", "other")
IMPORTANCE = ("unknown", "nice", "important", "blocker")


class InterviewsKeepInput(BaseModel):
    proposal_id: str
    keep: bool = True
    undo: bool = False
    point: str | None = None
    feature_id: str | None = None
    feature_new: str | None = None
    kind: str | None = None
    importance: str | None = None


class InterviewsKeepResult(BaseModel):
    state: str
    feedback_id: str | None = None
    feature_id: str | None = None
    message: str


def _counts(pod, person_id: str) -> None:
    states = q_all(pod, f"SELECT state FROM interviews_proposal WHERE person_id = {lit(person_id)} ORDER BY id")
    pod.records.update("interviews_person", person_id, {
        "found": len(states), "kept": sum(1 for r in states if r.get("state") == "kept"),
        "set_aside": sum(1 for r in states if r.get("state") == "set_aside")})


def _feature_for(pod, s: dict, name: str) -> str:
    name = clip(name, 120)
    same = q(pod, f"SELECT id, state, merged_into FROM feature WHERE LOWER(name) = {lit(name.lower())} LIMIT 1")
    if same:
        f = same[0]
        return f.get("merged_into") if f.get("state") == "merged" and f.get("merged_into") else f["id"]
    product = s.get("product_id") or (q(pod, "SELECT id FROM product WHERE role = 'ours' ORDER BY created_at LIMIT 1") or [{}])[0].get("id")
    if not product:
        raise ValueError("Set up User interviews first: a new feature needs the team's product.")
    fid = rid("feature", product, name.lower())
    pod.records.bulk_create("feature", [{"id": fid, "product_id": product, "name": name, "state": "suggested", "origin": "lemma",
                                         "stage": "idea", "source": PLUGIN, "source_id": fid}], upsert=True)
    return fid


def interviews_keep(ctx: FunctionContext, data: InterviewsKeepInput) -> InterviewsKeepResult:
    pod = ctx.pod
    me = str(ctx.user_id)
    got = q(pod, f"SELECT * FROM interviews_proposal WHERE id = {lit(data.proposal_id)}")
    if not got:
        raise ValueError("Only the interviewer can keep or set aside this call's findings.")
    pr = got[0]
    person = (q(pod, f"SELECT * FROM interviews_person WHERE id = {lit(pr['person_id'])}") or [None])[0]
    if not person:
        raise ValueError("This finding's person is gone from the study.")
    now = now_iso()

    if data.undo:
        if pr.get("feedback_id"):
            if q(pod, f"SELECT id FROM feedback WHERE id = {lit(pr['feedback_id'])}"):
                pod.records.update("feedback", pr["feedback_id"], {"state": "set_aside"})
            if q(pod, f"SELECT id FROM interviews_finding WHERE id = {lit(pr['feedback_id'])}"):
                pod.records.bulk_delete("interviews_finding", [pr["feedback_id"]])
        pod.records.update("interviews_proposal", pr["id"], {"state": "open", "feedback_id": None, "decided_at": None})
        _counts(pod, person["id"])
        needs_refresh(pod, me)
        return InterviewsKeepResult(state="open", message="Back to review.")

    patch = {}
    if data.point is not None and data.point.strip() and data.point.strip() != (pr.get("point") or ""):
        patch["point"] = clip(data.point, 200)
    if data.kind in KINDS and data.kind != pr.get("kind"):
        patch["kind"] = data.kind
    if data.importance in IMPORTANCE and data.importance != pr.get("importance"):
        patch["importance"] = data.importance
    feature_changed = False
    if data.feature_id is not None or data.feature_new is not None:
        fid = (data.feature_id or "").strip() or None
        new = clip(data.feature_new, 120) or None
        if (fid or None) != (pr.get("feature_id") or None) or (new or None) != (pr.get("feature_new") or None):
            feature_changed = True
            patch.update(feature_id=fid, feature_new=None if fid else new)
    if patch:
        patch["edited"] = True
    pr = dict(pr, **patch)

    if not data.keep:
        pod.records.update("interviews_proposal", pr["id"], dict(patch, state="set_aside", decided_at=now))
        _counts(pod, person["id"])
        needs_refresh(pod, me)
        return InterviewsKeepResult(state="set_aside", message="Set aside.")

    s = settings_of(pod)
    fid = pr.get("feature_id")
    if not fid and pr.get("feature_new"):
        fid = _feature_for(pod, s, pr["feature_new"])
    product = s.get("product_id")
    if fid:
        product = (q(pod, f"SELECT product_id FROM feature WHERE id = {lit(fid)}") or [{}])[0].get("product_id") or product
    meeting = {}
    if pr.get("meeting_id") or person.get("meeting_id"):
        meeting = (q(pod, f"SELECT id, source, source_account, source_id, start_at FROM meeting "
                          f"WHERE id = {lit(pr.get('meeting_id') or person.get('meeting_id'))}") or [{}])[0]
    source = "note" if person.get("doc_kind") == "notes" else "interview"
    source_id = meeting.get("source_id") or f"interviews:{person['id']}"
    fb_id = feedback_row_id(source, source_id, pr["quote"])
    pod.records.bulk_create("feedback", [{
        "id": fb_id, "quote": pr["quote"], "point": pr.get("point"), "product_id": product, "feature_id": fid,
        "feature_said": pr.get("feature_new"), "filed_by": "person" if feature_changed else "lemma",
        "kind": pr.get("kind") or "other", "importance": pr.get("importance") or "unknown",
        "handle_kind": person.get("handle_kind") or "email", "handle": person["handle"], "name": person.get("name"),
        "company_id": person.get("company_id"), "company_name": person.get("company_name"),
        "source": source, "source_account": clip(meeting.get("source_account"), 64) or None, "source_id": source_id,
        "at_seconds": pr.get("at_seconds") if source == "interview" else None, "heard_by": me,
        "is_public": False, "authenticity": "unknown",
        "said_at": person.get("call_at") or meeting.get("start_at") or now, "state": "processed", "plugin": PLUGIN,
    }], upsert=True)
    pod.records.bulk_create("interviews_finding", [{
        "id": fb_id, "study_id": person["study_id"], "person_id": person["id"], "meeting_id": meeting.get("id"), "kept_at": now}],
        upsert=True)
    if s.get("sample") and person.get("sample"):
        pod.records.bulk_create("interviews_sample_row", [
            {"id": rid("mark", "feedback", fb_id), "table_name": "feedback", "row_id": fb_id},
            {"id": rid("mark", "interviews_finding", fb_id), "table_name": "interviews_finding", "row_id": fb_id}]
            + ([{"id": rid("mark", "feature", fid), "table_name": "feature", "row_id": fid}] if fid and pr.get("feature_new") else []),
            upsert=True)
    pod.records.update("interviews_proposal", pr["id"], dict(patch, state="kept", feedback_id=fb_id, decided_at=now,
                                                             feature_id=fid, feature_new=pr.get("feature_new") if not fid else pr.get("feature_new")))
    _counts(pod, person["id"])
    needs_refresh(pod, me)
    return InterviewsKeepResult(state="kept", feedback_id=fb_id, feature_id=fid, message="Kept, under its feature.")
