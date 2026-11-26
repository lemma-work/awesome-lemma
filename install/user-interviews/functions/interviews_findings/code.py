#input_type_name: InterviewsFindingsInput
#output_type_name: InterviewsFindingsResult
#function_name: interviews_findings

"""What one study found, by feature: the Findings tab's grid, and a ready
answer for the Lemma's assistant ("what did people say about exports in the
reporting study?").

Per feature, the distinct people with kept findings in this study ("4 of 6
people"), how many findings, how many people called it a blocker, its
Roadmap `stage` and whether it is a suggested feature; per person (a column)
their count on it and whether one was a blocker. "Since the last call": what
the most recent call with findings changed. The chosen feature's quotes,
each with its call and minute. Only `feedback` rows still processed count.
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


class InterviewsFindingsInput(BaseModel):
    study_id: str
    feature_id: str | None = None


class InterviewsFindingsResult(BaseModel):
    people: list = []
    features: list = []
    since: list = []
    quotes: list = []
    text: str = ""
    message: str


def _grid(found: list, people: dict) -> dict:
    out: dict = {}
    for f in found:
        key = f.get("feature_id") or "none"
        row = out.setdefault(key, {"cells": {}, "findings": 0})
        cell = row["cells"].setdefault(f["person_id"], {"n": 0, "blocker": False})
        cell["n"] += 1
        cell["blocker"] = cell["blocker"] or f.get("importance") == "blocker"
        row["findings"] += 1
    return out


def interviews_findings(ctx: FunctionContext, data: InterviewsFindingsInput) -> InterviewsFindingsResult:
    pod = ctx.pod
    study = (q(pod, f"SELECT * FROM interviews_study WHERE id = {lit(data.study_id)}") or [None])[0]
    if not study:
        raise ValueError("No such study.")
    links = {r["id"]: r for r in q_all(pod, f"SELECT id, person_id, meeting_id, kept_at FROM interviews_finding "
                                             f"WHERE study_id = {lit(study['id'])} ORDER BY id")}
    fbs = []
    ids = sorted(links)
    for i in range(0, len(ids), 200):
        fbs += q(pod, "SELECT id, quote, point, feature_id, importance, kind, source, at_seconds, said_at, state FROM feedback "
                      f"WHERE id IN ({lits(ids[i:i + 200])}) AND state = 'processed'")
    for f in fbs:
        f["person_id"] = links[f["id"]]["person_id"]
    pids = sorted({f["person_id"] for f in fbs})
    people = {r["id"]: r for r in (q(pod, f"SELECT id, name, handle, company_name, call_at, deal_status FROM interviews_person "
                                          f"WHERE id IN ({lits(pids)})") if pids else [])}
    order = sorted(people.values(), key=lambda r: (str(r.get("call_at") or ""), r["id"]))
    fids = sorted({f["feature_id"] for f in fbs if f.get("feature_id")})
    feats = {r["id"]: r for r in (q(pod, f"SELECT id, name, state, stage FROM feature WHERE id IN ({lits(fids)})") if fids else [])}
    grid = _grid(fbs, people)
    total = len(order)
    rows = []
    for key, g in grid.items():
        f = feats.get(key) or {}
        n_people = len(g["cells"])
        rows.append({"feature_id": None if key == "none" else key, "name": f.get("name") or "Not filed",
                     "state": f.get("state"), "stage": f.get("stage"), "people": n_people, "of": total,
                     "findings": g["findings"], "blockers": sum(1 for c in g["cells"].values() if c["blocker"]),
                     "cells": g["cells"]})
    rows.sort(key=lambda r: (-r["people"], -r["blockers"], -r["findings"], r["name"]))

    since = []
    last = next((p for p in reversed(order)), None)
    if last and len(order) > 1:
        before = _grid([f for f in fbs if f["person_id"] != last["id"]], people)
        for r in rows:
            key = r["feature_id"] or "none"
            was = before.get(key, {"cells": {}})
            was_people = len(was["cells"])
            was_blockers = sum(1 for c in was["cells"].values() if c["blocker"])
            if r["people"] > was_people:
                since.append(f"{r['name']} went from {was_people} to {r['people']} people." if was_people
                             else f"{r['name']} came up for the first time.")
            if r["blockers"] and not was_blockers:
                since.append(f"{r['name']} gained its first blocker.")
    quotes = []
    want = data.feature_id or (rows[0]["feature_id"] if rows else None)
    for f in sorted(fbs, key=lambda f: (f.get("importance") != "blocker", str(f.get("said_at") or ""))):
        if (f.get("feature_id") or None) != want:
            continue
        p = people.get(f["person_id"]) or {}
        quotes.append({"id": f["id"], "quote": f["quote"], "point": f.get("point"), "importance": f.get("importance"),
                       "source": f.get("source"), "at": mm_ss(f.get("at_seconds")) if f.get("at_seconds") is not None else None,
                       "person_id": f["person_id"], "name": p.get("name") or p.get("handle"), "company": p.get("company_name"),
                       "call": day_said(p.get("call_at") or f.get("said_at"))})
    lines = [f"{study['question']}: {plural(total, 'person', 'people')} with findings kept."]
    for r in rows[:10]:
        lines.append(f"- {r['name']}: {r['people']} of {total} people, {plural(r['findings'], 'finding')}"
                     + (f", {plural(r['blockers'], 'blocker')}" if r["blockers"] else "") + (f" ({r['stage']})" if r.get("stage") else ""))
    lines += [f"Since the last call: {s_}" for s_ in since[:3]]
    return InterviewsFindingsResult(
        people=[{"id": p["id"], "name": p.get("name") or p["handle"], "company": p.get("company_name"), "call_at": p.get("call_at"),
                 "deal_status": p.get("deal_status")} for p in order],
        features=rows, since=since, quotes=quotes[:50], text="\n".join(lines),
        message=f"{plural(len(fbs), 'finding')} from {plural(total, 'person', 'people')}.")
