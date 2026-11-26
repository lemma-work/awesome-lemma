#input_type_name: InterviewsSampleDataInput
#output_type_name: InterviewsSampleDataResult
#function_name: interviews_sample_data

"""`load`: a made-up study to look around with, as the person loading it: a
reporting product (Fernway) and its features, a running study ("Why do
admins rebuild our reports in a spreadsheet?") with people at .example
companies in every stage (to invite, invites drafted, invited, booked, done,
resting under the contact rules, a no-show), the deals and earlier quotes
that put them there, one call's transcript with findings to review, and
three calls' findings already kept. An older study holds the invite and the
opt-out that rest two of them. Nothing in it reaches anyone's mail: its
invites are only marked sent.

`clear`: removes only what the sample made (marked in `interviews_sample_row`),
the people, proposals, findings and invites made in its studies since, and
its files; then starts set-up again if it was never done.
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

SAMPLE_ROOT = "/interviews-sample"

# key: (name, domain, deal status, deal stage)
COMPANIES = {
    "kettle": ("Kettle & Co", "kettle.example", "won", "Customer"),
    "northwind": ("Northwind", "northwind.example", "won", "Customer"),
    "harbor": ("Harbor Labs", "harborlabs.example", "open", "Proposal"),
    "fieldwork": ("Fieldwork", "fieldwork.example", "won", "Customer"),
    "pinecone": ("Pinecone", "pinecone.example", "won", "Customer"),
    "lumen": ("Lumen", "lumen.example", "open", "Trial"),
    "brightline": ("Brightline", "brightline.example", None, None),
    "tallow": ("Tallow", "tallow.example", "won", "Customer"),
    "quarry": ("Quarry", "quarry.example", "won", "Customer"),
    "ridge": ("Ridge", "ridge.example", "won", "Customer"),
    "oaktree": ("Oaktree", "oaktree.example", "open", "Demo"),
    "alder": ("Alder & Finch", "alderfinch.example", "won", "Customer"),
    "copperleaf": ("Copperleaf", "copperleaf.example", "won", "Customer"),
    "meridian": ("Meridian", "meridian.example", "won", "Customer"),
    "quayside": ("Quayside", "quayside.example", "open", "Trial"),
}

# key: (name, title, company, stage, extra)
PEOPLE = [
    ("tomas", "Tomás Berg", "Admin", "kettle", "done", {"call": (-1, 14, 0, 41), "doc": "transcript"}),
    ("ana", "Ana Ruiz", "Ops lead", "northwind", "done", {"call": (-5, 11, 0, 35), "doc": "notes"}),
    ("nadia", "Nadia Sousa", "Admin", "ridge", "done", {"call": (-3, 16, 0, 30), "doc": "transcript"}),
    ("hana", "Hana Kim", "Operations manager", "oaktree", "done", {"call": (-8, 10, 0, 40), "doc": "transcript"}),
    ("mei", "Mei Lin", "Finance admin", "harbor", "booked", {"call": (1, 14, 0, 30), "mine": True}),
    ("jonas", "Jonas Weber", "Head of data", "fieldwork", "booked", {"call": (2, 10, 30, 30)}),
    ("sara", "Sara Okafor", "Admin", "pinecone", "invited", {"invited": -2}),
    ("lucas", "Lucas Moreau", "Ops admin", "alder", "invited", {"invited": -1}),
    ("dev", "Dev Patel", "Ops", "lumen", "drafted", {}),
    ("elena", "Elena Costa", "Admin", "brightline", "drafted", {"pasted": {"plan": "Team", "seats": "12"}}),
    ("priya", "Priya Nair", "Ops manager", "copperleaf", "drafted", {}),
    ("owen", "Owen Hart", "Ops analyst", "quayside", "fits", {}),
    ("marc", "Marc Dubois", "RevOps admin", "tallow", "fits", {"other_invited": -22}),
    ("kofi", "Kofi Mensah", "Admin", "quarry", "no_show", {"no_show": -6}),
    ("lea", "Lea Fischer", "Admin", "meridian", "fits", {"other_opted_out": True}),
]

FEATURES = [
    ("csv", "CSV export", "Export any report or table as a CSV file.", "active", "live", ["export", "download as csv"]),
    ("filters", "Keep filters in exports", "An export holds the filters and columns on screen.", "suggested", "idea", ["export with filters"]),
    ("scheduled", "Scheduled reports", "A report sent by email on a schedule.", "active", "planned", ["weekly email", "report by email"]),
    ("dates", "Date formats in exports", "Dates in exports as real dates, in the reader's format.", "active", "idea", []),
    ("dashboards", "Dashboards", "Charts and numbers on one page.", "active", "live", []),
    ("share", "Share a report by link", "A read-only link to one report.", "active", "idea", []),
]

# Earlier quotes from mail and meetings: (person, feature, kind, importance, source, days ago, quote, point)
EARLIER = [
    ("tomas", "csv", "problem", "important", "mail", 45, "I copy it into a sheet every Friday.", "Rebuilds the weekly report in a sheet"),
    ("tomas", "dates", "problem", "nice", "mail", 40, "The dates come out as text again.", "Exported dates are text"),
    ("tomas", "scheduled", "request", "nice", "meeting", 30, "Could it just email me the Monday numbers?", "Wants the report emailed"),
    ("mei", "filters", "question", "important", "meeting", 23, "Can the export keep my filters?", "Asks for filtered exports"),
    ("jonas", "csv", "problem", "important", "mail", 20, "The export has every region in it, not mine.", "Export ignores the region filter"),
    ("jonas", "share", "request", "nice", "mail", 18, "I'd rather send a link than a file.", "Wants to share by link"),
    ("dev", "csv", "problem", "important", "mail", 7, "We rebuild the weekly numbers by hand.", "Rebuilds weekly numbers by hand"),
    ("marc", "csv", "problem", "important", "mail", 50, "Finance won't take the export as it is.", "Export not usable by finance"),
    ("marc", "scheduled", "request", "nice", "mail", 48, "A Monday email would save me an hour.", "Wants a weekly email"),
    ("marc", "dates", "problem", "nice", "mail", 47, "Every date needs fixing before I share it.", "Fixes dates by hand"),
    ("marc", "dashboards", "praise", "nice", "mail", 46, "The dashboard is what sold us.", "Likes dashboards"),
]

# Findings already kept from three calls: (person, feature, kind, importance, at "m:ss" or None, quote, point)
KEPT = [
    ("ana", "csv", "problem", "important", None, "She exports the usage report every Monday and rebuilds it in Sheets.", "Rebuilds the usage report weekly"),
    ("ana", "csv", "problem", "nice", None, "Column names in the export don't match the screen.", "Export column names differ from the screen"),
    ("ana", "filters", "problem", "important", None, "Filters reset on export, she has to redo them each time.", "Export drops filters"),
    ("ana", "scheduled", "request", "nice", None, "Would take a Monday email over exporting.", "Wants a weekly email"),
    ("nadia", "filters", "request", "blocker", "7:45", "Could the export just be what I see on the screen?", "Wants export to match the screen"),
    ("nadia", "csv", "problem", "important", "9:12", "I spend Monday morning cleaning the file.", "Cleans every export by hand"),
    ("nadia", "scheduled", "request", "important", "14:30", "If it came to me on Monday I'd never open the export again.", "Would use a scheduled report"),
    ("hana", "csv", "problem", "blocker", "5:20", "Our auditors won't accept the export without the totals row.", "Export lacks a totals row"),
    ("hana", "filters", "request", "important", "11:02", "I filter by team and then the file has every team in it.", "Export ignores team filter"),
    ("hana", "dates", "problem", "nice", "16:40", "Half the dates come out the American way.", "Date format wrong in exports"),
]

# Tomás's call, as Meet's transcript (the interviewer is "You").
TRANSCRIPT = [
    ("11:58", "You", "Walk me through last Friday. What did you do with the report?"),
    ("12:04", "Tomás", "Honestly, I copy it into a sheet every Friday."),
    ("12:09", "Tomás", "The export gives me the totals but the dates come out as text."),
    ("12:15", "You", "And then?"),
    ("12:18", "Tomás", "Then I fix the dates by hand before finance will look at it."),
    ("12:31", "Tomás", "And it forgets the filter, so I filter again in Sheets."),
    ("12:40", "You", "How long does that take you?"),
    ("12:43", "Tomás", "Forty minutes, give or take. Every week."),
    ("13:02", "You", "What would make you stop doing it?"),
    ("13:06", "Tomás", "If it just arrived in my inbox on Monday, done."),
    ("13:14", "Tomás", "We nearly went with another tool because of this."),
    ("13:20", "You", "Really? What stopped you?"),
    ("13:22", "Tomás", "The rest of it is good. Your dashboards are better."),
    ("13:30", "You", "Thanks, that helps."),
]
# (line, feature, kind, importance, point, state)
PROPOSED = [
    (1, "csv", "problem", "important", "Rebuilds the weekly report in a spreadsheet", "kept"),
    (4, "dates", "problem", "important", "Exported dates come out as text", "kept"),
    (5, "filters", "request", "important", "Wants the export to keep the filter", "open"),
    (9, "scheduled", "request", "nice", "Would stop exporting if the report were emailed weekly", "open"),
    (10, "csv", "problem", "blocker", "Export pain nearly lost the deal", "open"),
    (12, "dashboards", "praise", "unknown", "Praise for dashboards", "set_aside"),
]

ANA_NOTES = """She exports the usage report every Monday and rebuilds it in Sheets.
Column names in the export don't match the screen.
Filters reset on export, she has to redo them each time.
Would take a Monday email over exporting.
Happy with support, no other asks."""

INVITE = ("Hi {first},\n\nYou wrote to us about getting numbers out of Fernway, and I'd like to hear how that goes for you "
          "each week. It's a 30-minute call about how you use the reports and what happens to them after.\n\n"
          "If you're up for it, pick any time that suits you:\n{link}\n\nNo worries at all if not.\n\n{me}")


class InterviewsSampleDataInput(BaseModel):
    mode: str = "load"


class InterviewsSampleDataResult(BaseModel):
    mode: str
    people: int = 0
    message: str


def _secs(text):
    if not text:
        return None
    m, s_ = str(text).split(":")
    return int(m) * 60 + int(s_)


def _at(day_offset: int, hour: int, minute: int, tz) -> _datetime:
    today = now_utc().astimezone(tz).date()
    return _datetime.combine(today + _timedelta(days=day_offset), _datetime.min.time(), tz).replace(hour=hour, minute=minute)


def _load(ctx) -> InterviewsSampleDataResult:
    pod = ctx.pod
    me = str(ctx.user_id)
    if q(pod, "SELECT id FROM interviews_sample_row LIMIT 1"):
        return InterviewsSampleDataResult(mode="load", message="The sample is already here.")
    tz_name = "UTC"
    try:
        tz_name = (q(pod, "SELECT timezone FROM meetings_settings LIMIT 1") or [{}])[0].get("timezone") or "UTC"
    except Exception:  # noqa: BLE001 - no Meetings set-up yet
        pass
    tz = zone(tz_name)
    now = now_utc()
    s = settings_of(pod)
    out: dict = {t: [] for t in ("product", "company", "company_domain", "deal", "feature", "feedback", "interviews_study",
                                 "interviews_person", "interviews_pasted", "interviews_finding")}
    mine: dict = {t: [] for t in ("interviews_proposal", "draft")}

    product_id = s.get("product_id") or (q(pod, "SELECT id FROM product WHERE role = 'ours' ORDER BY created_at LIMIT 1") or [{}])[0].get("id")
    if not product_id:
        product_id = rid("sample", "product")
        out["product"].append({"id": product_id, "name": "Fernway", "role": "ours", "active": True, "source": "sample"})
    fid = {}
    for key, name, desc, state, stage, aliases in FEATURES:
        same = q(pod, f"SELECT id FROM feature WHERE LOWER(name) = {lit(name.lower())} LIMIT 1")
        if same:
            fid[key] = same[0]["id"]
            continue
        fid[key] = rid("sample", "feature", key)
        out["feature"].append({"id": fid[key], "product_id": product_id, "name": name, "description": desc, "aliases": aliases,
                               "state": state, "origin": "lemma" if state == "suggested" else "team", "stage": stage,
                               "source": "sample"})
    cid = {}
    for key, (name, domain, status, stage) in COMPANIES.items():
        cid[key] = str(_uuid.uuid5(COMPANY_NS, "company:" + domain))
        out["company"].append({"id": cid[key], "name": name, "domain": domain, "name_from": "domain"})
        out["company_domain"].append({"id": str(_uuid.uuid5(COMPANY_NS, domain)), "company_id": cid[key], "domain": domain})
    have_c = {r["id"] for r in q(pod, f"SELECT id FROM company WHERE id IN ({lits([c['id'] for c in out['company']])})")}
    have_d = {r["id"] for r in q(pod, f"SELECT id FROM company_domain WHERE id IN ({lits([c['id'] for c in out['company_domain']])})")}
    out["company"] = [c for c in out["company"] if c["id"] not in have_c]
    out["company_domain"] = [c for c in out["company_domain"] if c["id"] not in have_d]

    handle = {k: f"{k}@{COMPANIES[c][1]}" for k, _n, _t, c, _s, _x in PEOPLE}
    names = {k: n for k, n, _t, _c, _s, _x in PEOPLE}
    for key, (name, domain, status, stage) in COMPANIES.items():
        if not status:
            continue
        people = [{"handle": handle[k], "name": n} for k, n, _t, c, _s, _x in PEOPLE if c == key]
        out["deal"].append({"id": rid("sample", "deal", key), "name": f"{name} subscription", "company_id": cid[key],
                            "company_name": name, "company_domain": domain, "people": people, "owner_user_id": me,
                            "stage": stage, "status": status, "source": "sample", "last_activity_at": (now - _timedelta(days=9)).isoformat()})

    study = rid("sample", "study", "reports")
    old_study = rid("sample", "study", "plans")
    question = "Why do admins rebuild our reports in a spreadsheet?"
    out["interviews_study"] += [
        {"id": study, "question": question, "feature_ids": [fid["csv"], fid["scheduled"]], "want": 8, "owner_user_id": me,
         "state": "running", "fit_sentence": "Admins at paying companies who said something about exports or reports",
         "fit_read": {"filters": [
             {"field": "title_has", "values": ["admin", "ops", "operations"], "line": "Title has admin or ops"},
             {"field": "deal_status", "values": ["won", "open"], "line": "Their company has a deal that is won or open"},
             {"field": "said_about", "values": [fid["csv"], fid["scheduled"], fid["filters"], fid["dates"]],
              "line": "Said something filed under CSV export or Scheduled reports"}],
             "unknown": [{"line": "Used reports in the last 30 days"}], "read_at": now.isoformat()},
         "fit_state": "ready", "invite_line": "How you get numbers out of Fernway each week, and what happens to them after.",
         "pool_at": now.isoformat(), "pool_counts": {"deal": 13, "feedback": 6, "ask": 0, "mine": 1, "pasted": 1},
         "opened_at": (now - _timedelta(days=8)).isoformat(), "sample": True},
        {"id": old_study, "question": "What makes a team move to a bigger plan?", "feature_ids": [], "want": 5, "owner_user_id": me,
         "state": "done", "fit_state": "none", "opened_at": (now - _timedelta(days=40)).isoformat(),
         "closed_at": (now - _timedelta(days=10)).isoformat(), "sample": True},
    ]

    box = (q(pod, "SELECT id FROM mail_mailbox ORDER BY connected_at LIMIT 1") or [{}])[0].get("id") if _has(pod, "mail_mailbox") else None
    booking = "https://book.example/your-name"
    try:
        booking = (q(pod, "SELECT page_url FROM booking_settings LIMIT 1") or [{}])[0].get("page_url") or booking
    except Exception:  # noqa: BLE001 - no Booking set-up yet
        pass

    pid = {}
    earlier = {}
    for k, f, kind, imp, src, ago, quote, point in EARLIER:
        earlier.setdefault(k, []).append((f, kind, imp, src, ago, quote, point))
    for key, name, title, ckey, stage, x in PEOPLE:
        sid = study
        pid[key] = person_row_id(sid, "email", handle[key])
        comp, _dom, status, dstage = COMPANIES[ckey]
        said = earlier.get(key, [])
        why = []
        if status:
            why.append(f"Deal {status}" + (f" · {dstage.lower()}" if status == "open" else ""))
        if said:
            why.append(f"Said {plural(len(said), 'thing')}")
        if x.get("mine"):
            why.append("Your contact")
        if x.get("pasted"):
            why += ["Pasted list", f"Plan: {x['pasted']['plan']}"]
        best = sorted(said, key=lambda e: ({"blocker": 0, "important": 1}.get(e[2], 2), e[4]))
        row = {"id": pid[key], "study_id": sid, "handle_kind": "email", "handle": handle[key], "name": name, "title": title,
               "company_id": cid[ckey], "company_name": comp, "why": why[:4], "deal_status": status, "deal_stage": dstage,
               "sources": {"deal": [rid("sample", "deal", ckey)] if status else [], "feedback": [], "ask": [],
                           "mine": [me] if x.get("mine") else [], "pasted": [rid("sample", "pasted", key)] if x.get("pasted") else []},
               "quote": best[0][5] if best and key in ("tomas", "mei", "dev") else None,
               "quote_from": f"{best[0][3]}, {day_said((now - _timedelta(days=best[0][4])).isoformat(), tz_name)}" if best and key in ("tomas", "mei", "dev") else None,
               "rank": 1000.0 * len(said) + (200 if status == "won" else 100 if status == "open" else 0), "stage": stage,
               "invite_state": "none", "read_state": "none", "sample": True}
        if stage in ("invited", "booked", "done", "no_show"):
            sent = now - _timedelta(days=abs(x.get("invited", -6 if stage != "done" else -12)))
            row.update(invited_at=sent.isoformat(), inviter_user_id=me)
        if "call" in x:
            d, h, m, length = x["call"]
            start = _at(d, h, m, tz)
            row.update(call_at=start.isoformat(), call_end_at=(start + _timedelta(minutes=length)).isoformat())
            if stage == "booked":
                row["join_url"] = "https://meet.example/abc-defg-hij"
        if stage == "done":
            kind = x.get("doc", "transcript")
            row.update(doc_kind=kind, read_state="ready", doc_path=f"{SAMPLE_ROOT}/{pid[key]}.md")
            if key != "tomas":
                n = sum(1 for e in KEPT if e[0] == key)
                row.update(found=n, kept=n, thanked_at=(now - _timedelta(days=1)).isoformat() if key == "ana" else None)
        if stage == "no_show":
            row.update(no_show_at=(now - _timedelta(days=abs(x["no_show"]))).isoformat(), marked_by=me)
        if stage == "drafted":
            draft_id = rid("invite", pid[key])
            body = INVITE.format(first=name.split()[0], link=booking, me="")
            row.update(draft_id=draft_id, invite_state="drafted", inviter_user_id=me)
            mine["draft"].append({"id": draft_id, "conversation_id": None, "source": "mail", "source_account": box or "sample",
                                  "kind": "new", "to_handles": [handle[key]], "subject": "A 30-minute chat about your reports",
                                  "body": body.rstrip(), "original_body": body.rstrip(), "state": "proposed",
                                  "rationale": "Why they fit, the study's line and your booking link.",
                                  "built_from": {"plugin": PLUGIN, "study_id": study, "person_id": pid[key],
                                                 "used": [w for w in why[:2]] + ["the study's line"]}})
        if x.get("pasted"):
            out["interviews_pasted"].append({"id": rid("sample", "pasted", key), "study_id": None, "handle": handle[key],
                                             "name": name, "company_name": comp, "title": title, "fields": x["pasted"], "pasted_by": me})
        out["interviews_person"].append(row)
        if x.get("other_invited") or x.get("other_opted_out"):
            other = {"id": person_row_id(old_study, "email", handle[key]), "study_id": old_study, "handle_kind": "email",
                     "handle": handle[key], "name": name, "title": title, "company_id": cid[ckey], "company_name": comp,
                     "why": [], "sources": {}, "invite_state": "none", "read_state": "none", "sample": True,
                     "invited_at": (now - _timedelta(days=abs(x.get("other_invited") or 30))).isoformat(), "inviter_user_id": me,
                     "stage": "opted_out" if x.get("other_opted_out") else "done"}
            out["interviews_person"].append(other)

    for k, f, kind, imp, src, ago, quote, point in EARLIER:
        said_at = (now - _timedelta(days=ago)).isoformat()
        source_id = f"sample-{src}-{k}-{ago}"
        out["feedback"].append({"id": feedback_row_id(src, source_id, quote), "quote": quote, "point": point,
                                "product_id": product_id, "feature_id": fid[f], "filed_by": "lemma", "kind": kind, "importance": imp,
                                "handle_kind": "email", "handle": handle[k], "name": names[k], "company_name": COMPANIES[dict(
                                    (p[0], p[3]) for p in PEOPLE)[k]][0], "company_id": cid[dict((p[0], p[3]) for p in PEOPLE)[k]],
                                "source": src, "source_id": source_id, "heard_by": me, "said_at": said_at, "state": "processed",
                                "is_public": False, "authenticity": "unknown", "plugin": "user-feedback"})
    by_key = {r["id"]: r for r in out["interviews_person"]}
    for k, f, kind, imp, at, quote, point in KEPT:
        p = by_key[pid[k]]
        source = "note" if p.get("doc_kind") == "notes" else "interview"
        source_id = f"interviews:{p['id']}"
        fb = feedback_row_id(source, source_id, quote)
        out["feedback"].append({"id": fb, "quote": quote, "point": point, "product_id": product_id, "feature_id": fid[f],
                                "filed_by": "lemma", "kind": kind, "importance": imp, "handle_kind": "email", "handle": p["handle"],
                                "name": p["name"], "company_id": p["company_id"], "company_name": p["company_name"],
                                "source": source, "source_id": source_id, "at_seconds": _secs(at), "heard_by": me,
                                "said_at": p["call_at"], "state": "processed", "is_public": False, "authenticity": "unknown",
                                "plugin": PLUGIN})
        out["interviews_finding"].append({"id": fb, "study_id": study, "person_id": p["id"], "kept_at": p["call_at"]})

    # Tomás's call: the transcript, and its proposals (two kept, one set aside, three to review).
    tomas = by_key[pid["tomas"]]
    for n, (line, f, kind, imp, point, state) in enumerate(PROPOSED, start=1):
        at, who, quote = TRANSCRIPT[line]
        prop = {"id": rid("proposal", tomas["id"], quote_key(quote)), "person_id": tomas["id"], "study_id": study, "n": n,
                "quote": quote, "at_seconds": _secs(at), "line": line + 4, "point": point, "feature_id": fid[f], "kind": kind,
                "importance": imp, "state": state, "sample": True, "reason": "Said in their own words"}
        if state == "kept":
            fb = feedback_row_id("interview", f"interviews:{tomas['id']}", quote)
            prop.update(feedback_id=fb, decided_at=now.isoformat())
            out["feedback"].append({"id": fb, "quote": quote, "point": point, "product_id": product_id, "feature_id": fid[f],
                                    "filed_by": "lemma", "kind": kind, "importance": imp, "handle_kind": "email",
                                    "handle": tomas["handle"], "name": tomas["name"], "company_id": tomas["company_id"],
                                    "company_name": tomas["company_name"], "source": "interview",
                                    "source_id": f"interviews:{tomas['id']}", "at_seconds": _secs(at), "heard_by": me,
                                    "said_at": tomas["call_at"], "state": "processed", "is_public": False,
                                    "authenticity": "unknown", "plugin": PLUGIN})
            out["interviews_finding"].append({"id": fb, "study_id": study, "person_id": tomas["id"], "kept_at": now.isoformat()})
        mine["interviews_proposal"].append(prop)
    tomas.update(found=len(PROPOSED), kept=2, set_aside=1, doc_lines=len(TRANSCRIPT))

    # Files: the transcript and Ana's notes; the other calls a line each.
    try:
        pod.files.create_folder(SAMPLE_ROOT)
    except Exception:  # noqa: BLE001 - already there
        pass
    pod.files.write_text(tomas["doc_path"], "# Call with Tomás Berg\n\n## Transcript (Google Meet)\n\n" + "\n".join(
        f"[{at}] {who}: {text}" for at, who, text in TRANSCRIPT) + "\n")
    pod.files.write_text(by_key[pid["ana"]]["doc_path"], "# Call with Ana Ruiz\n\n## Notes\n\n" + ANA_NOTES + "\n")
    for k in ("nadia", "hana"):
        p = by_key[pid[k]]
        pod.files.write_text(p["doc_path"], f"# Call with {p['name']}\n\n## Transcript (Google Meet)\n\n" + "\n".join(
            f"[{at}] {p['name'].split()[0]}: {quote}" for kk, _f, _k, _i, at, quote, _p in KEPT if kk == k) + "\n")

    marks = []
    for table, got in list(out.items()) + list(mine.items()):
        for start in range(0, len(got), 100):
            pod.records.bulk_create(table, got[start:start + 100], upsert=True)
        marks += [{"id": rid("mark", table, r["id"]), "table_name": table, "row_id": r["id"]} for r in got]
    for start in range(0, len(marks), 200):
        pod.records.bulk_create("interviews_sample_row", marks[start:start + 200], upsert=True)
    if s.get("id"):
        pod.records.update("interviews_settings", s["id"], {"sample": True, "product_id": s.get("product_id") or product_id,
                                                            "product_label": s.get("product_label") or "Fernway"})
    else:
        pod.records.bulk_create("interviews_settings", [{"id": SETTINGS_ID, "sample": True, "product_id": product_id,
                                                         "product_label": "Fernway", "invite_gap_days": 30, "no_show_days": 90,
                                                         "nudge_days": 4}], upsert=True)
    rest_refresh(pod, settings_of(pod), [handle[k] for k in handle])
    needs_refresh(pod, me)
    n = len([p for p in out["interviews_person"] if p["study_id"] == study])
    return InterviewsSampleDataResult(mode="load", people=n, message=f"Loaded a sample study: {n} people at made-up companies, "
                                      "one call with findings to review and three with findings kept.")


def _has(pod, table: str) -> bool:
    try:
        q(pod, f"SELECT id FROM {table} LIMIT 1")
        return True
    except Exception:  # noqa: BLE001 - not in this Lemma
        return False


def _clear(ctx) -> InterviewsSampleDataResult:
    pod = ctx.pod
    me = str(ctx.user_id)
    marks = q_all(pod, "SELECT id, table_name, row_id FROM interviews_sample_row ORDER BY id")
    if not marks:
        return InterviewsSampleDataResult(mode="clear", message="No sample to clear.")
    by: dict = {}
    for m in marks:
        by.setdefault(m["table_name"], []).append(m["row_id"])
    studies = by.get("interviews_study") or []
    removed = 0

    def gone(table, ids):
        nonlocal removed
        ids = list(dict.fromkeys(i for i in ids if i))
        for start in range(0, len(ids), 100):
            here = [r["id"] for r in q(pod, f"SELECT id FROM {table} WHERE id IN ({lits(ids[start:start + 100])})")]
            if here:
                pod.records.bulk_delete(table, here)
                removed += len(here)

    people = q_all(pod, f"SELECT id, draft_id, doc_path FROM interviews_person WHERE study_id IN ({lits(studies)}) ORDER BY id") if studies else []
    pids = [p["id"] for p in people]
    findings = q_all(pod, f"SELECT id FROM interviews_finding WHERE study_id IN ({lits(studies)}) ORDER BY id") if studies else []
    props = []
    for i in range(0, len(pids), 100):
        props += q(pod, f"SELECT id FROM interviews_proposal WHERE person_id IN ({lits(pids[i:i + 100])})")
    gone("interviews_proposal", [r["id"] for r in props] + (by.get("interviews_proposal") or []))
    gone("draft", [p["draft_id"] for p in people if p.get("draft_id")] + (by.get("draft") or []))
    gone("interviews_finding", [r["id"] for r in findings] + (by.get("interviews_finding") or []))
    gone("feedback", [r["id"] for r in findings] + (by.get("feedback") or []))
    gone("interviews_person", pids + (by.get("interviews_person") or []))
    for table in ("interviews_pasted", "interviews_study", "deal", "feature", "company_domain", "company"):
        gone(table, by.get(table) or [])
    # The sample's product stays when real work was filed under it since (set-up picked it).
    products = by.get("product") or []
    used = {r["product_id"] for t in ("feature", "feedback")
            for r in (q(pod, f"SELECT DISTINCT product_id FROM {t} WHERE product_id IN ({lits(products)})") if products else [])}
    by["product"] = [p for p in products if p not in used]
    gone("product", by["product"])
    for p in people:
        if str(p.get("doc_path") or "").startswith(SAMPLE_ROOT + "/"):
            try:
                pod.files.delete(p["doc_path"])
            except Exception:  # noqa: BLE001 - already gone
                pass
    gone("interviews_sample_row", [m["id"] for m in marks])
    s = settings_of(pod)
    if s.get("id"):
        patch = {"sample": False}
        if s.get("product_id") in set(by.get("product") or []):
            patch.update(product_id=None, product_label=None)
        pod.records.update("interviews_settings", s["id"], patch)
    needs_refresh(pod, me)
    return InterviewsSampleDataResult(mode="clear", message=f"Cleared the sample ({plural(removed, 'row')}).")


def interviews_sample_data(ctx: FunctionContext, data: InterviewsSampleDataInput) -> InterviewsSampleDataResult:
    return _clear(ctx) if data.mode == "clear" else _load(ctx)
