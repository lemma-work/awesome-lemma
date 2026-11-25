#input_type_name: ReleaseNotesSampleDataInput
#output_type_name: ReleaseNotesSampleDataResult
#function_name: release_notes_sample_data

"""`load`: a made-up product's release, to look around with. Fernway (a
billing and reporting app, `.example` people) has v2.12 and v2.13 published
and v2.14 live and ready: 24 pull requests merged since v2.13 (9 in the note,
15 folded out as routine or internal), the note written from them, and the
people who asked for what's in it: three in the person's own (sample) mail,
two in a Slack thread, eight on GitHub issues, and one more the Lemma thinks
matches. Nothing in it reaches GitHub, Slack or anyone's mailbox: the sample
repository is never called, and publishing or sending says so.

`clear`: removes only what the sample made (its own rows are `sample`; rows
in shared tables are listed in release_note_sample_row) and closes the
sample's items in Today. Set-up starts again unless the real one was done.

`build()` is plain Python so bin/demo-fixtures.py makes the "Try it" demo
from the same rows.
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

REPO = "fernway/web"
SAMPLE_ACCOUNT = "sample"
SLACK_CHANNEL = "C07QSFERN"

# number, title, author, kind, days before now it merged, summary, closes [(issue, title)], left out
PRS = [
    (1196, "Split billing service tests by provider", "rdas", "internal", 13.6, None, [], "Internal: no change people would notice"),
    (1197, "Fix typo in README", "mchen", "routine", 13.2, None, [], "Routine: dependencies, CI or typos"),
    (1198, "Run end-to-end tests on the merge queue", "rdas", "routine", 12.8, None, [], "Routine: dependencies, CI or typos"),
    (1199, "Fix typo in billing settings copy", "tkaur", "routine", 12.1, None, [], "Routine: dependencies, CI or typos"),
    (1200, "Bump vite from 7.2.1 to 7.2.4", "dependabot", "routine", 11.9, None, [], "Routine: dependencies, CI or typos"),
    (1201, "Bump react-router from 7.9.1 to 7.9.4", "dependabot", "routine", 11.4, None, [], "Routine: dependencies, CI or typos"),
    (1202, "Bump eslint from 9.38.0 to 9.39.1", "dependabot", "routine", 10.8, None, [], "Routine: dependencies, CI or typos"),
    (1203, "Retry invoice sync after provider outage", "rdas", "fix", 10.2,
     "Invoices that failed to sync during an outage sync again on their own.", [], None),
    (1204, "Bump zod from 4.1.5 to 4.1.12", "dependabot", "routine", 9.7, None, [], "Routine: dependencies, CI or typos"),
    (1205, "Bump date-fns from 4.1.0 to 4.2.0", "dependabot", "routine", 9.1, None, [], "Routine: dependencies, CI or typos"),
    (1206, "Chart labels in dark mode", "mchen", "fix", 8.6, "Chart labels are readable on a dark background.",
     [(911, "Chart labels unreadable in dark mode")], None),
    (1207, "Remember the last report date range", "mchen", "improvement", 8.1, "Reports open on the date range you used last.",
     [(861, "Reports forget my date range")], None),
    (1208, "Bump typescript from 5.9.2 to 5.9.3", "dependabot", "routine", 7.6, None, [], "Routine: dependencies, CI or typos"),
    (1209, "Export button on reports", "tkaur", "feature", 6.4, "Any report can be exported to CSV, filters and all.",
     [(880, "CSV export for reports")], None),
    (1210, "Date picker on the 31st", "tkaur", "fix", 6.0, "Opening the date picker on the 31st no longer skips a month.",
     [(874, "Date picker jumps to the wrong month")], None),
    (1211, "Stream large CSV exports", "tkaur", "improvement", 5.6, "Big exports download as they are built instead of timing out.",
     [(902, "Large exports time out")], None),
    (1212, "Bump vitest from 3.2.4 to 4.0.6", "dependabot", "routine", 5.1, None, [], "Routine: dependencies, CI or typos"),
    (1213, "Billing webhooks on the shared retry queue", "rdas", "improvement", 4.7,
     "Billing webhooks retry on their own when the payment provider is slow.", [], None),
    (1214, "Expire API tokens made before October 1", "rdas", "breaking", 4.2,
     "Old API tokens stop working on December 15; people make new ones.", [], None),
    (1215, "Bump @types/node from 24.3.0 to 24.9.2", "dependabot", "routine", 3.5, None, [], "Routine: dependencies, CI or typos"),
    (1216, "Owner column on new tables", "rdas", "internal", 2.8, None, [], "Internal: no change people would notice"),
    (1217, "Bump postcss from 8.5.6 to 8.5.8", "dependabot", "routine", 2.1, None, [], "Routine: dependencies, CI or typos"),
    (1218, "Cache the pnpm store in CI", "mchen", "routine", 1.4, None, [], "Routine: dependencies, CI or typos"),
    (1219, "Faster report list query", "mchen", "improvement", 0.014, "The report list opens faster on large accounts.", [], None),
]
LIVE_DAYS = 5.0  # the deploy that took most of it live

# key, section, position, title, text, prs, issues
LINES = [
    ("export", "lead", 0, "Export any report to CSV",
     "Open a report and choose Export. You get exactly the rows and columns you see, with your filters applied.", [1209], [880]),
    ("stream", "lead", 1, "Large exports no longer stall",
     "Reports over 10,000 rows now download as they're built, so a big export starts in seconds instead of timing out.", [1211], [902]),
    ("tokens", "need", 0, None,
     "API tokens made before October 1 stop working on December 15. Make a new one in Settings, then API.", [1214], []),
    ("webhooks", "improved", 0, None,
     "Billing webhooks retry on their own, so a slow payment provider no longer loses an event.", [1213], []),
    ("filters", "improved", 1, None, "Report filters remember the last date range you picked.", [1207], [861]),
    ("list", "improved", 2, None, "The report list opens faster on large accounts.", [1219], []),
    ("invoices", "fixed", 0, None, "Invoices that failed to sync during a provider outage now sync once it's back.", [1203], []),
    ("charts", "fixed", 1, None, "Chart labels are readable in dark mode.", [1206], [911]),
    ("picker", "fixed", 2, None, "The date picker no longer jumps a month when you open it on the 31st.", [1210], [874]),
]

# handle, name, company, where (mail|slack|github), issue, days ago asked, how (author|me too), state
ASKS = [
    ("jo@harborpine.example", "Jo Lund", "Harbor Pine", "mail", 880, 73, None, "open"),
    ("U07TBERG", "Tomas Berg", "Quillstone", "slack", 880, 54, None, "open"),
    ("elamoreno", "Ela Moreno", None, "github", 880, 83, "author", "open"),
    ("linpark", "Lin Park", None, "github", 880, 60, "me too", "open"),
    ("ruicosta", "Rui Costa", None, "github", 880, 41, "me too", "open"),
    ("kofi@tallyhouse.example", "Kofi Mensah", "Tallyhouse", "mail", 902, 35, None, "open"),
    ("U07PKALE", "Priya Kale", "Quillstone", "slack", 902, 22, None, "open"),
    ("maraholt", "Mara Holt", None, "github", 902, 30, "author", "open"),
    ("ivopetrov", "Ivo Petrov", None, "github", 861, 64, "author", "open"),
    ("nooraziz", "Noor Aziz", None, "github", 861, 50, "me too", "open"),
    ("dvoss", "Dana Voss", None, "github", 911, 18, "author", "open"),
    ("bealind", "Bea Lind", None, "github", 874, 45, "author", "open"),
    ("calortiz", "Cal Ortiz", None, "github", 874, 29, "me too", "open"),
    ("sam@ostravalabs.example", "Sam Ito", "Ostrava Labs", "mail", 880, 52, None, "suggested"),
]

THREADS = {
    "jo@harborpine.example": ("September reporting", "Get the monthly report out as a CSV", [
        ("inbound", 73, "Is there any way to get the monthly report out as a CSV? We copy it into a spreadsheet by hand every month, and it takes Lin most of a morning."),
        ("outbound", 73, "Not yet, but it's on our list, and you're not the first to ask. I'll tell you when it ships."),
    ]),
    "kofi@tallyhouse.example": ("Yearly export", "Make the yearly invoice export finish", [
        ("inbound", 35, "Our yearly invoice export times out every time we run it. Is there anything we can do on our side?"),
        ("outbound", 34, "Thanks Kofi. It's the size: anything over about 10,000 rows hits the limit. We're working on it."),
    ]),
    "sam@ostravalabs.example": ("Invoices into Excel", "Get invoice lists into Excel", [
        ("inbound", 52, "Could we pull the invoice list into Excel somehow? Our accountant asks for it every quarter."),
    ]),
}

PUBLISHED = [
    # version, days ago, title, lines [(section, title, text, asked)]
    ("v2.13", 14, "Share a report with a link", [
        ("lead", "Share a report with a link",
         "Anyone with the link sees the report as it is now, read only. Turn the link off from the report's Share menu.", 3),
        ("fixed", None, "Customer names with an apostrophe no longer break search.", 0),
    ]),
    ("v2.12", 28, "Faster invoice list on large accounts", [
        ("lead", "Faster invoice list on large accounts",
         "The invoice list opens in under a second on accounts with thousands of invoices.", 0),
        ("fixed", None, "Tax totals round the same way on the invoice and the summary.", 0),
    ]),
]


class ReleaseNotesSampleDataInput(BaseModel):
    mode: str = "load"


class ReleaseNotesSampleDataResult(BaseModel):
    loaded: dict
    message: str


def _at(now, days: float) -> str:
    return (now - _timedelta(days=days)).isoformat()


def build(me: str, me_name, now=None) -> dict:
    """Every row of the sample, by table."""
    now = now or _datetime.now(_tz.utc)
    out: dict = {k: [] for k in ("release_note_settings", "release_note", "release_note_pr", "release_note_line",
                                 "release_note_page", "ask", "conversation", "message")}
    out["release_note_settings"].append({
        "id": SETTINGS_ID, "product": "Fernway", "sample": True, "setup_done_at": now.isoformat(),
        "repos": [{"name": REPO, "live_via": "workflow", "workflow": "Deploy", "environment": "production", "paths": []}],
        "slack_channel": SLACK_CHANNEL, "slack_channel_name": "product-updates",
        "publishers": [{"user_id": me, "name": me_name}], "schedules": {}})
    note_id = rid("note", REPO, "v2.14")
    live_at = _at(now, LIVE_DAYS)
    out["release_note"].append({
        "id": note_id, "repo": REPO, "name": "v2.14", "tag": "v2.14", "from_ref": "v2.13", "to_sha": "9f3c1e7",
        "state": "ready", "title": "Export any report, and large files that don't stall", "live_at": live_at,
        "live_env": "production", "live_via": "workflow", "live_ref": "Deploy workflow, run 4812",
        "drafted_at": _at(now, 0.003), "sample": True})
    for version, days, title, lines in PUBLISHED:
        nid = rid("note", REPO, version)
        page_id = rid("page", nid)
        out["release_note"].append({
            "id": nid, "repo": REPO, "name": version, "tag": version, "state": "published", "title": title,
            "live_at": _at(now, days + 0.2), "live_env": "production", "live_via": "workflow", "published_at": _at(now, days),
            "published_by": me, "page_id": page_id, "sample": True,
            "sent": [{"to": "github", "ok": True, "text": f"GitHub release {version} on {REPO}"},
                     {"to": "page", "ok": True, "text": "Changelog page"},
                     {"to": "slack", "ok": True, "text": "Slack #product-updates"}]})
        for i, (section, t, text, asked) in enumerate(lines):
            out["release_note_line"].append({"id": rid("line", nid, i), "note_id": nid, "section": section, "position": i,
                                             "title": t, "text": text, "prs": [], "issues": [], "asked": asked, "sample": True})
        out["release_note_page"].append({
            "id": page_id, "published_on": _at(now, days)[:10], "version": version, "title": title,
            "lines": [{"section": s, "title": t, "text": x, "asked": a} for s, t, x, a in lines],
            "need": None, "asked_total": sum(a for *_x, a in lines), "product": "Fernway", "brand": None, "sample": True})
    for number, title, author, kind, days, summary, closes, left in PRS:
        live = days >= LIVE_DAYS * 0.5 or number < 1219
        out["release_note_pr"].append({
            "id": pr_id(REPO, number), "repo": REPO, "number": number, "title": title, "author": author,
            "url": None, "merged_at": _at(now, days), "merge_sha": f"{number:x}a1", "labels": ["dependencies"] if author == "dependabot" else [],
            "files": 2 if kind == "routine" else 6, "summary": summary, "kind": kind,
            "closes": [{"ref": issue_ref(REPO, n), "title": t} for n, t in closes], "note_id": note_id,
            "live_at": live_at if live and number != 1219 else None, "left_out": left, "sample": True})
    asked: dict = {}
    for handle, name, company, where, issue, days, how, state in ASKS:
        if state in COUNTED:
            asked.setdefault(issue, 0)
            asked[issue] += 1
    for key, section, position, title, text, prs, issues in LINES:
        out["release_note_line"].append({
            "id": rid("line", note_id, key), "note_id": note_id, "section": section, "position": position, "title": title,
            "text": text, "prs": prs, "issues": [issue_ref(REPO, i) for i in issues],
            "asked": sum(asked.get(i, 0) for i in issues), "sample": True})
    for handle, name, company, where, issue, days, how, state in ASKS:
        work = issue_ref(REPO, issue)
        row = {"work_source": "github", "work_id": work, "work_url": None, "name": name, "company_name": company,
               "work_title": next((t for n, *_r, cl, _l in PRS for i, t in cl if i == issue), None),
               "asked_at": _at(now, days), "state": state, "plugin": PLUGIN}
        if where == "mail":
            conv_id = rid("sample-conversation", me, handle)
            row.update({"handle_kind": "email", "handle": handle, "source": "mail", "source_account": SAMPLE_ACCOUNT,
                        "source_id": f"sample-{handle}", "heard_by": me, "conversation_id": conv_id})
            subject, ask_text, msgs = THREADS[handle]
            out["conversation"].append({
                "id": conv_id, "source": "mail", "source_account": SAMPLE_ACCOUNT, "source_id": f"sample-{handle}",
                "subject": subject, "snippet": msgs[-1][2], "counterpart_handle": handle, "counterpart_name": name,
                "participants": [handle], "last_message_at": _at(now, msgs[-1][1]), "last_inbound_at": _at(now, msgs[0][1]),
                "last_direction": msgs[-1][0], "message_count": len(msgs), "kind": "people",
                "state": "done" if msgs[-1][0] == "outbound" else "needs_reply", "priority": 1, "ask": ask_text})
            for i, (direction, d, text) in enumerate(msgs):
                out["message"].append({
                    "id": rid("sample-message", conv_id, i), "conversation_id": conv_id, "source": "mail",
                    "source_id": f"sample-{handle}-{i}", "direction": direction,
                    "from_handle": handle if direction == "inbound" else "you@example.com",
                    "from_name": name if direction == "inbound" else me_name, "to_handles": ["you@example.com"] if direction == "inbound" else [handle],
                    "subject": subject if i == 0 else f"Re: {subject}", "sent_at": _at(now, d - i * 0.02), "snippet": text})
        elif where == "slack":
            ts = f"17270{days:05d}.000100"  # fixed, so the sample's ask ids are the same on every load
            row.update({"handle_kind": "slack", "handle": f"T07FERN:{handle}", "source": "slack", "source_account": "T07FERN",
                        "source_id": f"C07QSTONE:{ts}", "source_url": None})
        else:
            source_id = work if how == "author" else f"IC_sample_{handle}"
            row.update({"handle_kind": "github", "handle": handle, "source": "github", "source_account": "fernway",
                        "source_id": source_id})
        row["id"] = ask_id(row["handle_kind"], row["handle"], row["source"], row["source_id"], row["work_source"], row["work_id"])
        out["ask"].append(row)
    return out


SHARED = ("ask", "conversation", "message")


def release_notes_sample_data(ctx: FunctionContext, data: ReleaseNotesSampleDataInput) -> ReleaseNotesSampleDataResult:
    pod = ctx.pod
    me = str(ctx.user_id)
    if data.mode == "clear":
        return _clear(pod, me)
    settings = settings_of(pod)
    if settings.get("setup_done_at") and not settings.get("sample"):
        return ReleaseNotesSampleDataResult(loaded={}, message="Release notes is set up for real here; the sample would mix with it.")
    name = None
    try:
        who = as_dict(pod.members.list()) if hasattr(pod, "members") else {}
        for m in who.get("items") or []:
            if str(m.get("user_id")) == me:
                name = m.get("user_name") or m.get("name")
    except Exception:  # noqa: BLE001 - a name is nice, not needed
        name = None
    rows_ = build(me, name or "You")
    counts = {}
    for table, items in rows_.items():
        for start in range(0, len(items), 100):
            pod.records.bulk_create(table, items[start: start + 100], upsert=True)
        counts[table] = len(items)
    marks = [{"id": rid("sample-row", me, t, r["id"]), "table_name": t, "row_id": r["id"]} for t in SHARED for r in rows_[t]]
    for start in range(0, len(marks), 100):
        pod.records.bulk_create("release_note_sample_row", marks[start: start + 100], upsert=True)
    try:
        pod.functions.run("release_notes_on_note", {"refresh": True})
    except Exception:  # noqa: BLE001 - Today catches up on the next open
        pass
    return ReleaseNotesSampleDataResult(loaded=counts, message=(
        f"Loaded Fernway's v2.14: {counts['release_note_pr']} merged pull requests, {len(LINES)} lines, "
        f"{counts['ask']} people who asked. Nothing in it reaches GitHub, Slack or anyone's mail."))


def _clear(pod, me: str) -> ReleaseNotesSampleDataResult:
    counts = {}
    marks = q(pod, "SELECT id, table_name, row_id FROM release_note_sample_row LIMIT 5000")
    drafts = [r["id"] for r in q(pod, "SELECT d.id FROM draft d JOIN conversation c ON c.id = d.conversation_id "
                                      f"WHERE c.source_account = {lit(SAMPLE_ACCOUNT)} LIMIT 2000")]
    if drafts:
        pod.records.bulk_delete("draft", drafts)
        counts["draft"] = len(drafts)
    for table in ("message", "conversation", "ask"):
        ids = [m["row_id"] for m in marks if m["table_name"] == table]
        for start in range(0, len(ids), 100):
            pod.records.bulk_delete(table, ids[start: start + 100])
        counts[table] = len(ids)
    sample_asks = [r["id"] for r in q(pod, "SELECT id FROM ask WHERE work_id LIKE 'fernway/web#%' LIMIT 2000")]
    for start in range(0, len(sample_asks), 100):
        pod.records.bulk_delete("ask", sample_asks[start: start + 100])
    for table in ("release_note_reply", "release_note_line", "release_note_pr", "release_note_page", "release_note"):
        ids = [r["id"] for r in q(pod, f"SELECT id FROM {table} WHERE sample IS TRUE LIMIT 5000")]
        for start in range(0, len(ids), 100):
            pod.records.bulk_delete(table, ids[start: start + 100])
        counts[table] = len(ids)
    s = settings_of(pod)
    if s.get("sample"):
        pod.records.bulk_delete("release_note_settings", [s["id"]])
    open_items = q(pod, f"SELECT id FROM needs_you WHERE source_plugin = {lit(PLUGIN)} AND state IN ('open', 'snoozed') LIMIT 500")
    if open_items:
        pod.records.bulk_update("needs_you", [{"id": r["id"], "state": "done", "closed_by": "source"} for r in open_items])
    for start in range(0, len(marks), 100):
        pod.records.bulk_delete("release_note_sample_row", [m["id"] for m in marks[start: start + 100]])
    return ReleaseNotesSampleDataResult(loaded=counts, message="Cleared the sample. Set-up is next.")
