#input_type_name: TriageSampleDataInput
#output_type_name: TriageSampleDataResult
#function_name: triage_sample_data

"""A sample morning to look around with (the set-up's "Look around with a
sample morning"), and clearing it.

load: eight items, T-43 to T-50 in the demo (in a Lemma they take the next
numbers): a checkout crash after a merge, reported four ways and read as one
(1,240 people, rising); a billing error spike (312 people, 4× usual); a
reachable lodash alert and a SQL injection alert; three Slack messages that
look like an older export item; a GitHub issue; and two things the Lemma
marked down (one browser in a loop, a development-only dependency). Plus a
few older items in Accepted and Declined, their team tasks, three published
known issues and two routing rules. People and companies are made up, at
.example addresses. Quiet is on: nothing is posted outside the Lemma, and
what would have been is written down instead.

clear: removes only what the sample made (triage_sample_row), and closes its
items in Today.
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

PEOPLE = {
    "tom": {"name": "Tom Okafor", "email": "tom@acme.example", "github": "tomo", "slack": "U0TOM"},
    "mei": {"name": "Mei Wong", "email": "mei@acme.example", "github": "meiw", "slack": "U0MEI"},
    "ravi": {"name": "Ravi Varma", "email": "ravi@acme.example", "github": "ravi-v", "slack": "U0RAVI"},
    "ana": {"name": "Ana Nunes", "email": "ana@acme.example", "github": "ananunes", "slack": "U0ANA"},
    "jo": {"name": "Jo Lind", "email": "jo@acme.example", "github": "jolind", "slack": "U0JO"},
    "kai": {"name": "Kai Berg", "email": "kai@acme.example", "github": "kaib", "slack": "U0KAI"},
}
NUMBERS = {"decl_pdf": 36, "decl_sso": 37, "export": 38, "weekly": 40, "search": 41,
           "minimist": 43, "loop": 44, "dark": 45, "sqli": 46, "lodash": 47, "checkout": 48, "billing": 49, "csv": 50}
TABLES = ("triage_item", "triage_report", "triage_event", "ask", "triage_known", "triage_rule", "task")


class TriageSampleDataInput(BaseModel):
    mode: str = "load"  # load, clear


class TriageSampleDataResult(BaseModel):
    made: dict = {}
    message: str


def ev(source, asked, answer, state="checked", url=None):
    return {"source": source, "asked": asked, "answer": answer, "state": state, "url": url}


def build(t0: _datetime, me: dict, ids: dict | None = None) -> dict:
    """Every sample row, as of `t0` (the morning's "now", 10:26 in the demo). `me` is the
    person loading it, on triage this week as Tom; `ids` maps a person key to a member id."""
    ids = dict(ids or {})
    ids.setdefault("tom", me.get("user_id"))
    at = lambda minutes: (t0 - _timedelta(minutes=minutes)).isoformat()  # noqa: E731
    hour = lambda h: (t0.replace(minute=0, second=0, microsecond=0) - _timedelta(hours=h)).isoformat()  # noqa: E731
    who = lambda k: {"owner_user_id": ids.get(k), "owner_name": PEOPLE[k]["name"]}  # noqa: E731
    sid = lambda *p: tid("sample", *p)  # noqa: E731
    items, reports, events, asks, tasks = [], [], [], [], []

    def item(key, **f):
        row = {"id": sid("item", key), "sample": True, "read_state": "done" if f.get("summary") else "none", **f}
        row.setdefault("reach_asks", 0)
        row.setdefault("reach_companies", 0)
        row["_key"] = key
        items.append(row)
        return row

    def report(it, n, door, minutes, **f):
        row = {"id": sid("report", it["_key"], n), "item_id": it["id"], "door": door, "state": "filed" if n == 0 else "merged",
               "received_at": at(minutes), "source_id": f.pop("source_id", f"sample:{it['_key']}:{n}"), "sample": True, **f}
        reports.append(row)
        return row

    def ask(it, rep, kind, handle, name, source, company=None):
        asks.append({"id": ask_id(kind, handle, source, rep["source_id"], "triage", it["id"]), "work_source": "triage",
                     "work_id": it["id"], "work_url": "{path:" + it["_key"] + "}", "work_title": it["title"], "handle_kind": kind,
                     "handle": handle, "name": name, "company_name": company, "source": source, "source_id": rep["source_id"],
                     "source_url": rep.get("source_url"), "asked_at": rep["received_at"], "state": "open", "plugin": "triage",
                     "task_id": it.get("task_id")})

    def line(it, minutes, kind, text, key=None, actor="lemma", actor_name=None):
        events.append({"id": event_id(it["id"], kind, key or f"sample:{minutes}:{text[:20]}"), "item_id": it["id"], "at": at(minutes),
                       "kind": kind, "actor": actor, "actor_name": actor_name or ("Lemma" if actor == "lemma" else None), "text": text})

    # ---------- T-48 checkout: four reports, one problem ----------
    co = item("checkout", title="TypeError: cannot read 'plan' of undefined in checkout", kind="bug", state="inbox", priority="urgent",
              reach_people=1240, reach_events=3812, reach_unit="people", reach_note="rising", reach_read_at=at(20), escalating=True,
              reach_companies=38, first_seen=at(45), last_report_at=at(25), repo="acme/web", paths=["web/checkout/summary.tsx:54"],
              doors=["sentry", "form", "slack", "assistant"], history=[[hour(2), 0], [hour(1), 31], [hour(0), 1240]],
              trend=[[hour(2), 0], [hour(1), 31], [hour(0), 1240]], **who("mei"), owner_rule="last_change",
              owner_reason="made the last change to the crashing line (#1209) · owns web/checkout/** in CODEOWNERS",
              alternatives=[{"user_id": ids.get("tom"), "name": PEOPLE["tom"]["name"], "reason": "on triage this week"},
                            {"user_id": ids.get("ravi"), "name": PEOPLE["ravi"]["name"], "reason": "reviewed #1209"}],
              related=[{"ref": "#1209", "title": "Export button on the order summary", "url": "https://github.com/acme/web/pull/1209",
                        "note": "merged 09:38 by Mei Wong"}],
              summary="It started three minutes after #1209 merged, which added the export button to the order summary. Teams created before 4 March have no plan row, and summary.tsx:54 reads one without a fallback. The form, the Slack message and the email all describe the same blank checkout page.",
              fix_hint="A fallback for a missing plan on summary.tsx:54; reverting #1209 also stops it.", read_at=at(20),
              evidence=[ev("Sentry", "Who hits it, since when, where?", "3,812 events from 1,240 people since 09:41, all on teams created before 4 March."),
                        ev("PostHog", "Did people see an error page?", "1,190 people saw the checkout error page today; none yesterday."),
                        ev("GitHub", "What changed near the crash?", "summary.tsx:54 last changed in a41c9e, #1209 by Mei Wong, merged 09:38."),
                        ev("CODEOWNERS", "Who owns the file?", "web/checkout/** belongs to @meiw."),
                        ev("Reports", "Has anyone reported it?", "A form, a Slack message and an email; the form names the page and version."),
                        ev("Open issues", "Is this already filed?", "No open issue or accepted item matches.", "nothing_found"),
                        ev("Logs", "What did the server log?", "No logs source is connected.", "not_checked")])
    r0 = report(co, 0, "sentry", 45, title="TypeError: Cannot read properties of undefined (reading 'plan')", source_id="sample-sentry-4417",
                body="web/checkout/summary.tsx:54 in OrderSummary", quote="TypeError: Cannot read properties of undefined (reading 'plan')",
                reporter_kind="machine", reporter_name="Sentry", people=1240, events=3812, first_seen=at(45), last_seen=at(1), read_at=at(20),
                path="web/checkout/summary.tsx:54", repo="acme/web", kind="alert",
                source_url="https://sentry.example/organizations/acme/issues/4417/",
                detail={"short_id": "WEB-3F2", "priority": "high", "substatus": "escalating", "companies": 38},
                match_note="Read from Sentry at 09:51, its first read after the error appeared")
    r1 = report(co, 1, "form", 38, title="Pay does nothing, the page just sits there", body="Pay does nothing, the page just sits there",
                quote="Pay does nothing, the page just sits there", reporter_kind="contact", handle_kind="email",
                handle="dana@northwind.example", reporter_name="A customer at Northwind, signed in", company_name="Northwind",
                page="/checkout/summary", app_version="web 4.12.0", browser="Chrome 131", files=["/forms/triage_form/checkout.png"],
                how_bad="cant_work", kind="bug", via="web", detail={"signed_in": True},
                match_note="Merged: same page, same minute as the error")
    r2 = report(co, 2, "slack", 34, title="Checkout is blank for two of our customers since this morning", via="slack",
                quote="Checkout is blank for two of our customers since this morning", source_id="C0SUPPORT:1764064320.000100",
                reporter_kind="member", handle_kind="member", handle=ids.get("ana") or "ana", reporter_name="Ana Nunes in #support",
                kind="bug", match_note="Watched channel · merged: same page, same customer teams")
    r3 = report(co, 3, "assistant", 25, title="We can't pay our invoice, checkout is broken", via="email",
                quote="We can't pay our invoice, checkout is broken", reporter_kind="contact", handle_kind="email",
                handle="accounts@contoso.example", reporter_name="A customer, to the Lemma's address", company_name="Contoso",
                kind="bug", match_note="Filed by the Lemma from its mailbox, which replied with what is known · merged; anyone can split it out")
    ask(co, r1, "email", "dana@northwind.example", "Dana at Northwind", "web", "Northwind")
    ask(co, r2, "member", ids.get("ana") or "ana", "Ana Nunes", "slack")
    ask(co, r3, "email", "accounts@contoso.example", "A customer at Contoso", "mail", "Contoso")
    line(co, 35, "report", "Read from Sentry: a new error, 31 people.")
    line(co, 38, "merged", "Merged a form report from a Northwind user; the form showed it is known and being looked at.")
    line(co, 34, "merged", "Merged Ana Nunes's Slack report from #support.")
    line(co, 33, "owner", "Suggested Mei Wong: made the last change to the crashing line.")
    line(co, 25, "merged", "Merged an email to the Lemma's address; the reply said what is known.")
    line(co, 21, "escalated", "Marked escalating: 1,240 people, up from 31.")
    line(co, 20, "read", "Read it: 5 sources checked; not checked: Logs.")
    line(co, 20, "note", "Told Tom Okafor, who is on triage: urgent, waiting for a decision (Today, “decide”).")

    # ---------- T-49 billing ----------
    bi = item("billing", title="InvoiceError: no default payment method", kind="bug", state="inbox", priority="urgent",
              reach_people=312, reach_events=1904, reach_unit="people", reach_note="4× usual", reach_read_at=at(20), escalating=True,
              first_seen=at(46), last_report_at=at(14), repo="acme/web", paths=["billing/charge.ts:120"], doors=["posthog", "assistant"],
              history=[[hour(2), 40], [hour(1), 61], [hour(0), 312]], trend=[[hour(2), 40], [hour(1), 61], [hour(0), 312]],
              **who("ravi"), owner_rule="codeowners", owner_reason="owns billing/** in CODEOWNERS · reviewed #1206",
              alternatives=[{"user_id": ids.get("tom"), "name": PEOPLE["tom"]["name"], "reason": "on triage this week"}],
              related=[{"ref": "#1206", "title": "Move the payment provider to its newer API", "url": "https://github.com/acme/web/pull/1206",
                        "note": "merged yesterday 16:10"}],
              summary="No deploy touched billing today. #1206, merged yesterday at 16:10, moved the payment provider to a newer API version, and customers with an expired card now fail here instead of being asked for a new one.",
              fix_hint="Ask for a new card when the provider says there is no default payment method.", read_at=at(18),
              evidence=[ev("PostHog", "Who hits it, and is it new?", "312 people, 1,904 errors; 4× the 7-day average since 09:40."),
                        ev("GitHub", "What changed under billing/?", "No change under billing/ today. #1206 changed the payment API version yesterday."),
                        ev("Sentry", "Is it in Sentry too?", "No matching issue in Sentry.", "nothing_found"),
                        ev("Logs", "What did the server log?", "No logs source is connected.", "not_checked")])
    b0 = report(bi, 0, "posthog", 46, title="InvoiceError: no default payment method for customer", source_id="sample-posthog-91c",
                quote="InvoiceError: no default payment method for customer", reporter_kind="machine", reporter_name="PostHog",
                people=312, events=1904, sessions=340, read_at=at(20), path="billing/charge.ts:120", kind="alert",
                source_url="https://posthog.example/project/1/error_tracking/91c")
    b1 = report(bi, 1, "assistant", 14, title="Billing is failing for renewals this morning", via="teams",
                quote="Billing is failing for renewals this morning, can you file it?", reporter_kind="member", handle_kind="member",
                handle=ids.get("jo") or "jo", reporter_name="Jo Lind, to the Lemma in a Teams chat", kind="bug",
                match_note="Filed by the Lemma, which replied with {tag:billing}")
    ask(bi, b1, "member", ids.get("jo") or "jo", "Jo Lind", "teams")
    line(bi, 40, "report", "Read from PostHog: a new error issue, 40 people.")
    line(bi, 39, "owner", "Suggested Ravi Varma: owns billing/** in CODEOWNERS.")
    line(bi, 22, "escalated", "Marked escalating: 312 people, 4× usual.")
    line(bi, 18, "read", "Read it: 2 sources checked; not checked: Logs.")
    line(bi, 14, "merged", "Merged Jo Lind's report to the Lemma in Teams; it replied with {tag:billing}.")

    # ---------- T-47 lodash (Dependabot) ----------
    lo = item("lodash", title="lodash: prototype pollution in merge", kind="security", state="inbox", priority="urgent",
              reach_unit="repo", reach_note="reachable", first_seen=at(134), last_report_at=at(134), repo="acme/web",
              paths=["package.json", "web/utils/merge.ts"], doors=["dependabot"], **who("tom"), owner_rule="codeowners",
              owner_reason="owns package.json in CODEOWNERS · on triage this week",
              security={"severity": "high", "scope": "runtime", "relationship": "direct", "reachable": True, "patch": "4.17.21",
                        "advisory": "GHSA-sample-0041", "package": "lodash", "alert_number": 41, "epss": 0.004},
              summary="web/utils/merge.ts passes request bodies to _.merge, the call the advisory names. Upgrading to 4.17.21 is a patch release with no API change.",
              fix_hint="Bump lodash to 4.17.21.", read_at=at(120),
              evidence=[ev("Dependabot", "How bad, and is there a fix?", "High; runtime scope; direct; patched in 4.17.21."),
                        ev("Reachability", "Does our code call it?", "GitHub marks it reachable (its preview, JavaScript and TypeScript only)."),
                        ev("Code", "Who calls _.merge?", "2 calls to _.merge in web/utils/merge.ts take request input."),
                        ev("Exploits", "Is it exploited?", "No exploit feed is connected; the alert's EPSS is 0.4%.", "not_checked")])
    report(lo, 0, "dependabot", 134, title="lodash: prototype pollution in merge", source_id="acme/web#dependabot_alert-41",
           quote="Advisory for lodash < 4.17.21; first patched version 4.17.21", reporter_kind="machine", reporter_name="Dependabot",
           repo="acme/web", path="package.json", kind="security", source_url="https://github.com/acme/web/security/dependabot/41",
           security={"severity": "high", "scope": "runtime", "relationship": "direct", "reachable": True, "patch": "4.17.21",
                     "advisory": "GHSA-sample-0041", "package": "lodash", "alert_number": 41})
    line(lo, 134, "report", "Filed from Dependabot: alert #41 on acme/web.")
    line(lo, 120, "read", "Read it: 3 sources checked; not checked: Exploits.")

    # ---------- T-46 SQL injection (code scanning) ----------
    sq = item("sqli", title="SQL query built from user-controlled input", kind="security", state="inbox", priority="high",
              reach_unit="repo", reach_note=None, first_seen=at(176), last_report_at=at(176), repo="acme/api",
              paths=["api/reports/export.py:88"], doors=["code_scanning"], **who("ana"), owner_rule="codeowners",
              owner_reason="owns api/reports/** in CODEOWNERS · wrote #1198",
              security={"severity": "high", "scope": "runtime", "rule": "py/sql-injection", "tool": "CodeQL", "alert_number": 12,
                        "ref": "refs/heads/main"},
              summary="The sort parameter goes straight into an ORDER BY. It is reachable by any signed-in user from the export page.",
              fix_hint="Check sort against an allow-list of column names.", read_at=at(160),
              evidence=[ev("Code scanning", "How bad, and where?", "High, on the default branch, first seen in #1198."),
                        ev("Code", "Where does sort come from?", "sort comes from the query string with no allow-list."),
                        ev("Exploits", "Is it exploited?", "No exploit feed is connected.", "not_checked")])
    report(sq, 0, "code_scanning", 176, title="SQL query built from user-controlled input", source_id="acme/api#code_scanning_alert-12",
           quote="py/sql-injection in api/reports/export.py:88", reporter_kind="machine", reporter_name="Code scanning",
           repo="acme/api", path="api/reports/export.py:88", kind="security", source_url="https://github.com/acme/api/security/code-scanning/12",
           security={"severity": "high", "scope": "runtime", "rule": "py/sql-injection", "tool": "CodeQL", "alert_number": 12})
    line(sq, 176, "report", "Filed from code scanning: alert #12 on acme/api.")
    line(sq, 160, "read", "Read it: 2 sources checked; not checked: Exploits.")

    # ---------- T-38 export (older, accepted), and T-50 csv that looks like it ----------
    ex = item("export", title="Export times out on big accounts", kind="bug", state="accepted", priority="medium", reach_asks=2,
              reach_unit="asked", first_seen=at(12 * 1440), last_report_at=at(12 * 1440), repo="acme/web",
              paths=["web/export/csv.ts"], doors=["github"], **who("tom"), owner_rule="rotation", owner_reason="on triage that week",
              decided_by=ids.get("tom"), decided_at=at(11 * 1440), task_id=sid("task", "export"))
    e0 = report(ex, 0, "github", 12 * 1440, title="Export times out on big accounts", source_id="acme/web#1180",
                source_url="https://github.com/acme/web/issues/1180", quote="Exporting orders never finishes for our biggest account",
                reporter_kind="contact", handle_kind="github", handle="pia-at-fabrikam", reporter_name="pia-at-fabrikam",
                company_name="Fabrikam", repo="acme/web", kind="bug")
    ask(ex, e0, "github", "pia-at-fabrikam", "pia-at-fabrikam", "github", "Fabrikam")
    line(ex, 11 * 1440, "accepted", "Accepted by Tom Okafor: a medium task in Tasks.", actor=ids.get("tom") or "lemma", actor_name="Tom Okafor")
    tasks.append({"id": sid("task", "export"), "title": "{tag:export} Export times out on big accounts", "status": "in_progress",
                  "priority": "medium", "source": "triage", "source_id": ex["id"], "source_url": "{path:export}",
                  "assignee_kind": "person", "assignee_user_id": ids.get("tom"), "assignee_name": "Tom Okafor",
                  "owner_user_id": ids.get("tom"), "owner_name": "Tom Okafor", "quote": "Exporting orders never finishes for our biggest account",
                  "description": "From Triage: {tag:export}. Reports: GitHub acme/web#1180."})
    cs = item("csv", title="CSV export hangs over 10,000 rows", kind="bug", state="inbox", priority="medium", reach_asks=3,
              reach_unit="asked", reach_companies=3, first_seen=at(76), last_report_at=at(6), repo="acme/web", paths=["web/export/csv.ts"],
              doors=["slack"], **who("tom"), owner_rule="rotation", owner_reason="on triage this week · nothing in CODEOWNERS matches",
              looks_like=ex["id"], looks_like_note="Looks like {tag:export}: Export times out on big accounts (GitHub acme/web#1180), open for 12 days",
              summary="All three are accounts over 10,000 rows. {tag:export} describes the same timeout and is accepted, in progress with Tom Okafor.",
              read_at=at(5),
              evidence=[ev("GitHub", "Is this already filed?", "acme/web#1180 matches: same page, same row count, still open."),
                        ev("Slack", "Who said it?", "3 messages in #support since 09:10."),
                        ev("Sentry", "Is there an error?", "No error: the request times out without throwing.", "nothing_found"),
                        ev("Logs", "What did the server log?", "No logs source is connected.", "not_checked")])
    for n, (k, mins, text) in enumerate((("ana", 76, "Export spins forever for a customer with 40k orders"),
                                         ("kai", 38, "Same again, another account: CSV never arrives"),
                                         ("jo", 6, "CSV download never finishes"))):
        rr = report(cs, n, "slack", mins, title=text, quote=text, source_id=f"C0SUPPORT:17640{60000 + n}.0001", via="slack",
                    reporter_kind="member", handle_kind="member", handle=ids.get(k) or k, reporter_name=f"{PEOPLE[k]['name']} in #support",
                    kind="bug", company_name=["Litware", "Tailspin", "Wingtip"][n])
        ask(cs, rr, "member", ids.get(k) or k, PEOPLE[k]["name"], "slack", ["Litware", "Tailspin", "Wingtip"][n])
    line(cs, 76, "report", "Filed from Slack (#support): Ana Nunes.")
    line(cs, 76, "note", "Looks like {tag:export}: not sure enough to merge.")
    line(cs, 38, "merged", "Merged Kai Berg's Slack message: same export, another account.")
    line(cs, 6, "merged", "Merged Jo Lind's Slack message.")

    # ---------- T-45 dark mode (GitHub issue form) ----------
    dk = item("dark", title="Chart labels unreadable in dark mode", kind="bug", state="inbox", priority="medium", reach_asks=1,
              reach_unit="asked", first_seen=at(264), last_report_at=at(264), repo="acme/web", paths=["web/reports/chart.tsx"],
              doors=["github"], **who("tom"), owner_rule="rotation",
              owner_reason="on triage this week · nothing in CODEOWNERS matches web/reports/**",
              summary="The chart colours are hard-coded in web/reports/chart.tsx and ignore the theme.", read_at=at(250),
              evidence=[ev("GitHub", "What did they report?", "Issue #1182 with a screenshot."),
                        ev("Code", "Where are the colours set?", "chart.tsx sets a fixed dark grey for labels.")])
    d0 = report(dk, 0, "github", 264, title="Chart labels unreadable in dark mode", source_id="acme/web#1182",
                source_url="https://github.com/acme/web/issues/1182", quote="Axis labels are dark grey on the dark background",
                body="### What happened?\n\nAxis labels are dark grey on the dark background\n\n### Steps to reproduce\n\n1. Turn on dark mode\n2. Open Reports\n\n### Expected\n\nReadable labels\n\n### Version\n\nweb 4.12.0",
                steps="1. Turn on dark mode\n2. Open Reports", expected="Readable labels", app_version="web 4.12.0",
                reporter_kind="contact", handle_kind="github", handle="dmitri-k", reporter_name="dmitri-k, a customer, through the repo's bug form",
                repo="acme/web", kind="bug", match_note="Steps, expected and version read from the issue form's sections")
    ask(dk, d0, "github", "dmitri-k", "dmitri-k", "github")
    line(dk, 264, "report", "Filed from GitHub: acme/web#1182, read field by field from its issue form.")
    line(dk, 264, "acked", "Answered the reporter: a comment on acme/web#1182 (quiet: not sent).")

    # ---------- marked down ----------
    lp = item("loop", title="ResizeObserver loop limit exceeded", kind="alert", state="marked_down", priority="low", reach_people=1,
              reach_events=9412, reach_unit="people", first_seen=at(1500), last_report_at=at(1500), doors=["sentry"],
              marked_down_reason="one person with 9,412 events: one browser in a loop", marked_down_by="lemma",
              owner_rule="none", owner_reason="marked down by the Lemma", source_version="alert:<2:0:",
              summary="Every event comes from one person's browser. Browsers raise this harmlessly; it reaches nobody else.", read_at=at(1490),
              evidence=[ev("Sentry", "Who hits it?", "9,412 events, 1 person, 1 session.")])
    report(lp, 0, "sentry", 1500, title="ResizeObserver loop limit exceeded", source_id="sample-sentry-4380", reporter_kind="machine",
           reporter_name="Sentry", people=1, events=9412, read_at=at(20), kind="alert", quote="ResizeObserver loop limit exceeded")
    line(lp, 1500, "marked_down", "Marked down: one person with 9,412 events: one browser in a loop. It comes back if a second person hits it.")
    md = item("minimist", title="minimist: regular expression denial of service", kind="security", state="marked_down", priority="low",
              reach_unit="repo", reach_note="development only", first_seen=at(2900), last_report_at=at(2900), repo="acme/web",
              paths=["package-lock.json"], doors=["dependabot"], marked_down_reason="a development-only dependency: not shipped to users",
              marked_down_by="lemma", owner_rule="none", owner_reason="marked down by the Lemma", source_version="security:none:0:development",
              security={"severity": "moderate", "scope": "development", "relationship": "transitive", "package": "minimist", "alert_number": 39},
              summary="Only the test runner uses it; nothing in the build that reaches users does.", read_at=at(2890),
              evidence=[ev("Dependabot", "Where is it used?", "Development scope; transitive through the test runner.")])
    report(md, 0, "dependabot", 2900, title="minimist: regular expression denial of service", source_id="acme/web#dependabot_alert-39",
           reporter_kind="machine", reporter_name="Dependabot", repo="acme/web", kind="security", quote="minimist via the test runner",
           security={"severity": "moderate", "scope": "development", "relationship": "transitive", "package": "minimist", "alert_number": 39})
    line(md, 2900, "marked_down", "Marked down: a development-only dependency. It comes back if it moves into a runtime dependency.")

    # ---------- older: accepted, done, declined ----------
    wk = item("weekly", title="Weekly email shows Monday as Sunday", kind="bug", state="accepted", priority="medium", reach_asks=4,
              reach_unit="asked", reach_companies=3, first_seen=at(2 * 1440), last_report_at=at(1440), doors=["form", "slack"],
              **who("ravi"), owner_rule="person", owner_reason="chosen by Tom Okafor", decided_by=ids.get("tom"), decided_at=at(1400),
              task_id=sid("task", "weekly"))
    w0 = report(wk, 0, "form", 2 * 1440, title="The weekly email starts the week on Sunday", quote="The weekly email starts the week on Sunday",
                reporter_kind="visitor", handle_kind="email", handle="sam@wingtip.example", reporter_name="sam", company_name="Wingtip", kind="bug")
    ask(wk, w0, "email", "sam@wingtip.example", "sam", "web", "Wingtip")
    tasks.append({"id": sid("task", "weekly"), "title": "{tag:weekly} Weekly email shows Monday as Sunday", "status": "todo", "priority": "medium",
                  "source": "triage", "source_id": wk["id"], "source_url": "{path:weekly}", "assignee_kind": "person",
                  "assignee_user_id": ids.get("ravi"), "assignee_name": "Ravi Varma", "owner_user_id": ids.get("tom"), "owner_name": "Tom Okafor",
                  "quote": "The weekly email starts the week on Sunday", "description": "From Triage: {tag:weekly}."})
    line(wk, 1400, "accepted", "Accepted by Tom Okafor: a medium task in Tasks, assigned to Ravi Varma.", actor=ids.get("tom") or "lemma", actor_name="Tom Okafor")
    se = item("search", title="Search showed projects under their old names", kind="bug", state="done", priority="medium", reach_asks=2,
              reach_unit="asked", first_seen=at(6 * 1440), last_report_at=at(6 * 1440), doors=["slack"], **who("mei"), owner_rule="codeowners",
              owner_reason="owns web/search/** in CODEOWNERS", decided_by=ids.get("tom"), decided_at=at(2 * 1440), task_id=sid("task", "search"))
    tasks.append({"id": sid("task", "search"), "title": "{tag:search} Search showed projects under their old names", "status": "done",
                  "priority": "medium", "source": "triage", "source_id": se["id"], "source_url": "{path:search}", "assignee_kind": "person",
                  "assignee_user_id": ids.get("mei"), "assignee_name": "Mei Wong", "owner_user_id": ids.get("tom"), "owner_name": "Tom Okafor",
                  "description": "From Triage: {tag:search}.", "done_at": at(2 * 1440)})
    s0 = report(se, 0, "slack", 6 * 1440, title="Search still shows the old project name", quote="Search still shows the old project name",
                reporter_kind="member", handle_kind="member", handle=ids.get("ana") or "ana", reporter_name="Ana Nunes in #support", kind="bug")
    line(se, 2 * 1440, "task", "Its task is done in Tasks (Mei Wong).")
    for key, title, why in (("decl_pdf", "Dark mode for the PDF export", "PDFs are printed; we keep them light."),
                            ("decl_sso", "Sign in with a second SSO provider", "Not this quarter: one provider covers every customer who asked.")):
        dd = item(key, title=title, kind="request", state="declined", priority="medium", reach_asks=1, reach_unit="asked",
                  first_seen=at(9 * 1440), last_report_at=at(9 * 1440), doors=["form"], owner_rule="none", owner_reason="",
                  decline_reason=why, decided_by=ids.get("tom"), decided_at=at(8 * 1440))
        r = report(dd, 0, "form", 9 * 1440, title=title, quote=title, reporter_kind="visitor", handle_kind="email",
                   handle=f"{key}@tailspin.example", reporter_name="a visitor", company_name="Tailspin", kind="request")
        asks.append({"id": ask_id("email", f"{key}@tailspin.example", "web", r["source_id"], "triage", dd["id"]), "work_source": "triage",
                     "work_id": dd["id"], "work_url": "{path:" + key + "}", "work_title": title, "handle_kind": "email",
                     "handle": f"{key}@tailspin.example", "source": "web", "source_id": r["source_id"], "asked_at": r["received_at"],
                     "state": "declined", "told_at": at(8 * 1440), "plugin": "triage"})
        line(dd, 8 * 1440, "declined", f"Declined by Tom Okafor: {why}", actor=ids.get("tom") or "lemma", actor_name="Tom Okafor")

    known = [{"id": co["id"], "item_id": co["id"], "title": "Checkout: the Pay button does nothing for some accounts", "state": "investigating",
              "page": "/checkout", "updated_at": at(20)},
             {"id": wk["id"], "item_id": wk["id"], "title": "Weekly email shows Monday as Sunday", "state": "being_fixed", "updated_at": at(1400)},
             {"id": se["id"], "item_id": se["id"], "title": "Search showed projects under their old names", "state": "fixed", "updated_at": at(2 * 1440)}]
    rules = [{"id": sid("rule", "checkout"), "kind": "route", "match": {"path": "web/checkout/**"}, "owner_user_id": ids.get("mei"),
              "owner_name": "Mei Wong", "reason": "owns checkout", "position": 1, "enabled": True, "sample": True},
             {"id": sid("rule", "loop"), "kind": "mark_down", "match": {"text": "ResizeObserver loop"}, "reason": "a harmless browser warning",
              "position": 2, "enabled": True, "sample": True}]
    return {"triage_item": items, "triage_report": reports, "triage_event": events, "ask": asks, "triage_known": known,
            "triage_rule": rules, "task": tasks}


def finish(built: dict, numbers: dict) -> dict:
    """Put each item's number into the rows that name it ({tag:key}, {path:key})."""
    def fill(value):
        if isinstance(value, str):
            for key, n in numbers.items():
                value = value.replace("{tag:" + key + "}", f"T-{n}").replace("{path:" + key + "}", f"/i/{n}")
            return value
        if isinstance(value, list):
            return [fill(v) for v in value]
        if isinstance(value, dict):
            return {k: fill(v) for k, v in value.items()}
        return value
    out = {}
    for table, rows_in in built.items():
        out[table] = []
        for r in rows_in:
            r = {k: fill(v) for k, v in r.items() if k != "_key"}
            out[table].append({k: v for k, v in r.items() if v is not None})
    return out


def triage_sample_data(ctx: FunctionContext, data: TriageSampleDataInput) -> TriageSampleDataResult:
    pod = ctx.pod
    me = caller(ctx)
    s = settings_of(pod)
    if data.mode == "clear":
        marked = q(pod, "SELECT id, table_name, row_id FROM triage_sample_row LIMIT 5000")
        made = {}
        item_ids = [r["row_id"] for r in marked if r["table_name"] == "triage_item"]
        if item_ids:
            for table, col in (("triage_event", "item_id"), ("triage_report", "item_id"), ("triage_correction", "item_id")):
                for r in q(pod, f"SELECT id FROM {table} WHERE {col} IN ({lits(item_ids)}) LIMIT 5000"):
                    pod.records.delete(table, r["id"])
                    made[table] = made.get(table, 0) + 1
            for r in q(pod, f"SELECT id FROM ask WHERE work_source = 'triage' AND work_id IN ({lits(item_ids)}) LIMIT 5000"):
                pod.records.delete("ask", r["id"])
                made["ask"] = made.get("ask", 0) + 1
            for r in q(pod, f"SELECT id FROM task WHERE source = 'triage' AND source_id IN ({lits(item_ids)}) LIMIT 1000"):
                pod.records.delete("task", r["id"])
                made["task"] = made.get("task", 0) + 1
        for r in marked:
            if r["table_name"] in ("triage_item", "triage_known", "triage_rule"):
                try:
                    pod.records.delete(r["table_name"], r["row_id"])
                    made[r["table_name"]] = made.get(r["table_name"], 0) + 1
                except Exception:  # noqa: BLE001 — gone already
                    pass
        for r in marked:
            pod.records.delete("triage_sample_row", r["id"])
        patch = {"sample": False}
        if s.get("schedules", {}).get("_sample_setup"):
            patch.update({"setup_done_at": None, "rotation": [], "people": []})
        if s.get("id"):
            pod.table("triage_settings").update(s["id"], patch)
        run_function(pod, "triage_needs_you", {})
        return TriageSampleDataResult(made=made, message="Cleared the sample morning; your own reports stay.")

    if q(pod, "SELECT id FROM triage_sample_row LIMIT 1"):
        return TriageSampleDataResult(message="The sample morning is already here.")
    t0 = now()
    built = build(t0, me)
    item_rows = finish({"triage_item": built["triage_item"]}, {})["triage_item"]
    order = sorted(item_rows, key=lambda r: r.get("first_seen") or "")
    for r in order:
        pod.records.create("triage_item", r)
    numbers = {}
    by_id = {r["id"]: r for r in q(pod, f"SELECT id, number FROM triage_item WHERE id IN ({lits([r['id'] for r in item_rows])})")}
    for raw in built["triage_item"]:
        numbers[raw["_key"]] = (by_id.get(raw["id"]) or {}).get("number")
    rest = finish({k: v for k, v in built.items() if k != "triage_item"}, numbers)
    # The texts that name another item's number were written before numbers existed.
    for raw in built["triage_item"]:
        fixed = finish({"x": [raw]}, numbers)["x"][0]
        changed = {k: fixed.get(k) for k in ("looks_like_note", "summary") if raw.get(k) and fixed.get(k) != raw.get(k)}
        if changed:
            pod.table("triage_item").update(raw["id"], changed)
    made = {"triage_item": len(item_rows)}
    for table in ("task", "triage_report", "triage_event", "ask", "triage_known", "triage_rule"):
        batch = rest.get(table) or []
        for start in range(0, len(batch), 100):
            pod.records.bulk_create(table, batch[start: start + 100], upsert=True)
        made[table] = len(batch)
    marks = [{"id": tid("sample-row", t, r["id"]), "table_name": t, "row_id": r["id"]}
             for t, rs in (("triage_item", item_rows), ("triage_known", rest.get("triage_known") or []), ("triage_rule", rest.get("triage_rule") or []))
             for r in rs]
    pod.records.bulk_create("triage_sample_row", marks, upsert=True)
    patch = {"sample": True}
    if not s.get("setup_done_at"):
        patch.update({"setup_done_at": now_iso(), "setup_by": me.get("user_id"), "rotation": [me.get("user_id")] if me.get("user_id") else [],
                      "rotation_start": now().date().isoformat(),
                      "people": [{"user_id": me.get("user_id"), "name": me.get("name") or "You", "email": me.get("email")}],
                      "schedules": {**(s.get("schedules") or {}), "_sample_setup": "1"}})
    save_settings(pod, s, patch)
    run_function(pod, "triage_needs_you", {})
    return TriageSampleDataResult(made=made, message="Loaded the sample morning: eight reports to decide, with made-up people at .example addresses. Nothing is posted outside the Lemma.")
