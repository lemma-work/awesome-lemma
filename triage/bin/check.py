#!/usr/bin/env python3
"""Unit checks for Triage's functions that need no Lemma: the pure parts (an
issue form read field by field, CODEOWNERS' last match, security alerts and
Slack messages as reports, reach and priority, mark-downs, who's on triage,
telling, Today's items) and the sample's own consistency.

    uv run --no-project python bin/check.py

Each function file is loaded with stand-ins for `lemma_sdk` and `pydantic`,
as bin/demo-fixtures.py does, and a small stand-in Lemma answers the reads
the checked parts make. Python's standard library only.
"""

from __future__ import annotations

import re
import sys
import types
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FAILED: list[str] = []


def load(name: str) -> dict:
    sdk = types.ModuleType("lemma_sdk")
    sdk.FunctionContext = object
    pyd = types.ModuleType("pydantic")
    pyd.BaseModel = object
    sys.modules.setdefault("lemma_sdk", sdk)
    sys.modules.setdefault("pydantic", pyd)
    scope: dict = {"__name__": name}
    exec(compile((HERE / "functions" / name / "code.py").read_text(), name, "exec"), scope)
    return scope


def check(what: str, ok: bool) -> None:
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        FAILED.append(what)


class Pod:
    """Answers `SELECT ... FROM <table>` with the rows given for that table; records writes."""

    def __init__(self, tables: dict):
        self.tables = tables
        self.writes: list = []
        self.posted: list = []

    def query(self, sql: str):
        table = re.search(r"\bFROM\s+(\w+)", sql, re.I).group(1)
        return {"items": list(self.tables.get(table, []))}

    class _T:
        def __init__(self, pod, name):
            self.pod, self.name = pod, name

        def update(self, rid, data):
            self.pod.writes.append(("update", self.name, rid, data))

    def table(self, name):
        return Pod._T(self, name)

    class _C:
        def __init__(self, pod):
            self.pod = pod

        def execute(self, connector, op, payload, **kw):
            self.pod.posted.append((connector, op, payload))
            return {"result": {"ok": True, "ts": "1.0"}}

    @property
    def connectors(self):
        return Pod._C(self)


def main() -> int:
    p = load("triage_on_github")
    body = "### What happened?\n\nAxis labels are grey\n\n### Steps to reproduce\n\n1. Dark mode\n\n### Expected\n\nReadable\n\n### Version\n\nweb 4.12.0\n\n### Browser\n\n_No response_"
    f = p["issue_form"](body)
    check("an issue form is read field by field", f["main"] == "Axis labels are grey" and f["steps"] == "1. Dark mode"
          and f["expected"] == "Readable" and f["app_version"] == "web 4.12.0" and not f.get("browser"))
    check("a plain issue body stays the body", p["issue_form"]("It broke")["main"] == "It broke")
    co = "* @tomo\nweb/checkout/** @meiw\n/api/reports/ @ananunes\n*.md @docs\n"
    check("CODEOWNERS: the last match wins", p["codeowners_for"](co, "web/checkout/summary.tsx") == ["@meiw"])
    check("CODEOWNERS: an anchored folder", p["codeowners_for"](co, "api/reports/export.py") == ["@ananunes"])
    check("CODEOWNERS: the catch-all", p["codeowners_for"](co, "billing/charge.ts") == ["@tomo"])
    check("CODEOWNERS: an extension anywhere", p["codeowners_for"](co, "docs/a/readme.md") == ["@docs"])
    dep = p["alert_report"]("dependabot_alert", "acme/web", {"number": 41, "html_url": "u", "created_at": "2026-11-25T08:12:00Z",
        "dependency": {"package": {"name": "lodash"}, "manifest_path": "package.json", "scope": "runtime", "relationship": "direct"},
        "security_advisory": {"ghsa_id": "GHSA-x", "summary": "prototype pollution", "severity": "high"},
        "security_vulnerability": {"severity": "high", "first_patched_version": {"identifier": "4.17.21"}, "vulnerable_version_range": "< 4.17.21"}})
    check("a Dependabot alert is a security report with its facts", dep["door"] == "dependabot" and dep["security"]["patch"] == "4.17.21"
          and dep["security"]["scope"] == "runtime" and dep["source_id"] == "acme/web#dependabot_alert-41")
    cs = p["alert_report"]("code_scanning_alert", "acme/api", {"number": 12, "rule": {"id": "py/sql-injection", "security_severity_level": "high",
        "description": "SQL query built from user-controlled input"}, "tool": {"name": "CodeQL"},
        "most_recent_instance": {"ref": "refs/heads/main", "location": {"path": "api/reports/export.py", "start_line": 88}}})
    check("a code scanning alert points at its line", cs["door"] == "code_scanning" and cs["path"] == "api/reports/export.py:88")
    check("+1 and 'same here' are asks, other comments aren't",
          bool(p["PLUS_ONE"].search("+1")) and bool(p["PLUS_ONE"].search("Same here, on Firefox")) and not p["PLUS_ONE"].search("I think it's the cache"))

    s = {"slack": {"team_id": "T1", "channels": [{"id": "C1", "name": "support"}]}, "people": [{"user_id": "u-ana", "name": "Ana", "slack": "U1"}]}
    r = p["slack_report"](s, {"channel": "C1", "ts": "1764064320.0001", "user": "U1", "text": "Checkout is blank"})
    check("a watched channel's message is a report by a member", r and r["handle_kind"] == "member" and r["handle"] == "u-ana")
    check("a bot, a thread reply or an unwatched channel is not", p["slack_report"](s, {"channel": "C1", "ts": "2", "bot_id": "B", "text": "x"}) is None
          and p["slack_report"](s, {"channel": "C1", "ts": "3", "thread_ts": "1", "text": "x"}) is None
          and p["slack_report"](s, {"channel": "C9", "ts": "4", "text": "x"}) is None)

    settings = {"urgent_people": 100, "read_from_people": 25}
    now = p["now"]()
    item = {"id": "i1", "kind": "bug", "state": "inbox", "history": [], "first_seen": now.isoformat()}
    reps = [{"door": "sentry", "people": 1240, "events": 3812, "read_at": now.isoformat(), "detail": {"companies": 38}},
            {"door": "form", "company_name": "Northwind"}]
    pod = Pod({"ask": [{"handle_kind": "email", "handle": "a@n.example", "company_name": "Northwind"},
                       {"handle_kind": "email", "handle": "a@n.example", "company_name": "Northwind"}]})
    reach = p["compute_reach"](pod, settings, item, reps)
    check("reach: people from the tracker, asks counted once per person, companies from tags",
          reach["reach_people"] == 1240 and reach["reach_asks"] == 1 and reach["reach_companies"] == 38 and reach["reach_unit"] == "people")
    check("reach: over the urgent number and new is urgent and escalating", reach["priority"] == "urgent" and reach["escalating"])
    sec = p["compute_reach"](Pod({}), settings, {"id": "i2", "kind": "security", "state": "inbox", "history": []},
                             [{"door": "dependabot", "security": {"severity": "high", "scope": "runtime", "reachable": True}}])
    check("reach: a reachable high alert is urgent, counted by repository", sec["priority"] == "urgent" and sec["reach_unit"] == "repo")
    low = p["compute_reach"](Pod({}), settings, {"id": "i3", "kind": "bug", "state": "inbox", "history": []}, [{"door": "slack"}])
    check("reach: one Slack report is medium, counted in reports", low["priority"] == "medium" and low["reach_unit"] == "reports")

    loop = {"id": "i4", "reach_people": 1, "reach_events": 9412, "reach_asks": 0, "security": None}
    check("mark down: one person with thousands of events",
          "one person" in (p["mark_down_reason"](Pod({"triage_rule": []}), loop, [{"door": "sentry"}]) or ""))
    dev = {"id": "i5", "security": {"scope": "development"}, "reach_asks": 0}
    check("mark down: a development-only dependency", "development" in (p["mark_down_reason"](Pod({"triage_rule": []}), dev, [{"door": "dependabot"}]) or ""))
    down = dict(loop, state="marked_down", marked_down_by="lemma", kind="alert", source_version=p["source_version"](dict(loop, kind="alert")))
    check("a mark-down holds while nothing changed", not p["back_from_mark_down"](Pod({"triage_rule": []}), down, [{"door": "sentry"}]))
    check("and comes back when a second person hits it",
          p["back_from_mark_down"](Pod({"triage_rule": []}), dict(down, reach_people=2), [{"door": "sentry"}]))

    rot = {"rotation": ["u1", "u2", "u3"], "rotation_start": "2026-11-23"}
    check("rotation: a week each from its Monday", p["on_triage"](rot, date(2026, 11, 25)) == "u1" and p["on_triage"](rot, date(2026, 12, 2)) == "u2")
    check("rotation: someone away all day is skipped", p["on_triage"](rot, date(2026, 11, 25), {"2026-11-25": {"u1": "full"}}) == "u2")
    check("rotation: half a day away still counts", p["on_triage"](rot, date(2026, 11, 25), {"2026-11-25": {"u1": "half"}}) == "u1")
    check("the contract's away id", p["away_id"]("u1", "2026-11-25") == p["away_id"]("u1", "2026-11-25")
          and str(p["AWAY_NS"]) == "363239d5-9ea7-40d6-b959-7dc722c3891f")
    check("the contract's ask id", p["ask_id"]("email", "a@b.example", "web", "r1", "triage", "i1")
          == str(__import__("uuid").uuid5(p["ASK_NS"], "email:a@b.example|web:r1|triage:i1")))

    quiet = {"quiet": True, "slack": {}}
    tpod = Pod({})
    out = p["tell_asks"](tpod, quiet, {"id": "i"}, [
        {"id": "a1", "source": "github", "source_id": "acme/web#1182", "handle_kind": "github"},
        {"id": "a2", "source": "github", "source_id": "acme/web#1182", "handle_kind": "github"},
        {"id": "a3", "source": "web", "source_id": "f1", "handle_kind": "email"}], "Fixed.", "told")
    check("telling: quiet sends nothing, once per place, form people left for the app",
          not tpod.posted and out["told"] == 2 and len(out["left"]) == 1 and out["left"][0]["app"])
    lpod = Pod({})
    p["tell_asks"](lpod, {"quiet": False, "slack": {"account": "slack"}}, {"id": "i"}, [
        {"id": "a1", "source": "slack", "source_id": "C0SUPPORT:1764064320.0001", "handle_kind": "slack"}], "Fixed.", "told")
    check("telling: a Slack thread reply as the Lemma's app", lpod.posted and lpod.posted[0][1] == "chat_post_message"
          and lpod.posted[0][2]["body"]["thread_ts"] == "1764064320.0001")

    n = load("triage_needs_you")
    urgent = [{"id": "i1", "number": 48, "title": "Checkout", "state": "inbox", "reach_people": 1240, "escalating": True, "owner_user_id": "u2", "owner_name": "Mei"}]
    items = n["items_for"]("u1", "u1", urgent, [])
    check("Today: whoever is on triage gets decide for an urgent item", len(items) == 1 and items[0]["verb"] == "decide"
          and items[0]["path"] == "/i/48" and "1,240 people" in items[0]["title"])
    check("Today: nobody else does", n["items_for"]("u2", "u1", urgent, []) == [])
    check("Today: with no rotation, the suggested owner does", len(n["items_for"]("u2", None, urgent, [])) == 1)
    told = n["items_for"]("u1", None, [], [({"id": "i9", "number": 40, "title": "Weekly", "decided_by": "u1"}, 2, "fixed")])
    check("Today: people who used the form to tell", told and told[0]["verb"] == "answer" and "Tell 2 people T-40 is fixed" in told[0]["title"])

    s = load("triage_sample_data")
    t0 = datetime(2026, 11, 25, 10, 26, tzinfo=timezone.utc)
    built = s["build"](t0, {"user_id": "u-tom", "name": "Tom"})
    rows = s["finish"](built, s["NUMBERS"])
    ids = {i["id"] for i in built["triage_item"]}
    check("sample: every report, event and ask belongs to a sample item",
          all(r["item_id"] in ids for r in rows["triage_report"]) and all(e["item_id"] in ids for e in rows["triage_event"])
          and all(a["work_id"] in ids for a in rows["ask"]))
    check("sample: no placeholder is left", "{tag:" not in str(rows) and "{path:" not in str(rows))
    check("sample: people and companies at .example addresses",
          all(str(a["handle"]).endswith(".example") for a in rows["ask"] if a["handle_kind"] == "email"))
    check("sample: every evidence entry has an answer, every missing source says why",
          all(e.get("answer") for i in built["triage_item"] for e in i.get("evidence") or [])
          and all("connected" in e["answer"] for i in built["triage_item"] for e in i.get("evidence") or [] if e["state"] == "not_checked"))
    check("sample: T-43 to T-50 and the older items are numbered", sorted(s["NUMBERS"].values())[-8:] == list(range(43, 51)))
    check("sample: three known issues, two of them public words for fixed or being fixed",
          len(rows["triage_known"]) == 3 and {k["state"] for k in rows["triage_known"]} == {"investigating", "being_fixed", "fixed"})

    import subprocess
    same = subprocess.run([sys.executable, str(HERE / "bin" / "common.py"), "--check"], capture_output=True, text=True)
    check("every function holds bin/shared/ and the contract's snippets word for word", same.returncode == 0)

    print(f"\n{len(FAILED)} failed" if FAILED else "\nall checks pass")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
