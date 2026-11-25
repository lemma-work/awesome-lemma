#!/usr/bin/env python3
"""Unit checks for Incidents' functions that need no Lemma: the pure parts
(slugs, finding an incident by what a person types, Slack messages and GitHub
webhooks as events, the write-up review's rules, what goes to Today) and the
sample's own consistency (every citation is one of its incident's events).

    uv run --no-project python bin/check.py

Each function file is loaded with stand-ins for `lemma_sdk` and `pydantic`,
as bin/demo-fixtures.py does. Python's standard library only.
"""

from __future__ import annotations

import sys
import types
from datetime import datetime, timedelta, timezone
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


def main() -> int:
    m = load("incidents_on_message")
    check("slug keeps whole words under the limit", m["slug"]("Checkout returns 502 for EU cards!", 18) == "checkout-returns")
    check("slug of nothing is 'incident'", m["slug"]("!!!") == "incident")
    check("a Slack ts reads as a time", m["stamp"]("1764079320.000200").year >= 2025)
    check("severity label", m["sev_of"]({"severities": m["DEFAULT_SEVERITIES"]}, "sev2")["label"] == "SEV2 · Major")
    check("an unknown severity still has a label", m["sev_of"]({}, "p1")["label"] == "P1")
    people = {"U1": "Ines Ruiz"}
    ev = m["message_event"]({"ts": "1764079320.0002", "user": "U1", "text": "only EU cards failing"}, people)
    check("a message is an event, by name", ev and ev["kind"] == "message" and ev["actor"] == "Ines Ruiz")
    check("a bot's message is not", m["message_event"]({"ts": "1.0", "bot_id": "B1", "text": "x"}, people) is None)
    check("a join is not", m["message_event"]({"ts": "1.0", "subtype": "channel_join", "text": "joined"}, people) is None)
    pin = m["message_event"]({"ts": "2.0", "user": "U1", "subtype": "pinned_item", "item": {"ts": "1.5", "text": "wallets fine"}}, people)
    check("a pin is a starred event keyed on the pinned message", pin["kind"] == "pin" and pin["starred"] and pin["source_id"] == "pin:1.5")
    check("one event id per (incident, source, id)", m["event_id"]("a", "slack", "1.0") == m["event_id"]("a", "slack", "1.0")
          and m["event_id"]("a", "slack", "1.0") != m["event_id"]("b", "slack", "1.0"))
    header = m["header_text"]({"number": 14, "title": "Checkout <502>", "severity": "sev2", "status": "investigating",
                               "lead_name": "Mara Lind"}, {"severities": m["DEFAULT_SEVERITIES"]})
    check("the header escapes Slack markup and names the lead", "&lt;502&gt;" in header and "lead Mara Lind" in header)

    g = load("incidents_on_github")
    repo = {"full_name": "shop/checkout-api", "default_branch": "main"}
    merged = g["change_of"]("pull_request", {"action": "closed", "repository": repo, "pull_request": {
        "merged": True, "number": 2291, "title": "EU timeout", "user": {"login": "theo"}, "merged_at": "2026-11-25T13:58:00Z",
        "html_url": "https://github.example/pr/2291"}}, {})
    check("a merged pull request is a merge", merged and merged["kind"] == "merge" and merged["ref"] == "#2291")
    check("a closed, unmerged one is not", g["change_of"]("pull_request", {"action": "closed", "repository": repo,
                                                                            "pull_request": {"merged": False}}, {}) is None)
    check("a push to a branch is not", g["change_of"]("push", {"ref": "refs/heads/feature", "repository": repo,
                                                               "head_commit": {"id": "abc"}}, {}) is None)
    run = {"action": "completed", "repository": repo, "workflow_run": {"name": "CI", "run_number": 3}}
    check("a CI run is not a deploy", g["change_of"]("workflow_run", run, {}) is None)
    run["workflow_run"]["name"] = "Deploy production"
    check("a deploy-named run is", g["change_of"]("workflow_run", run, {})["kind"] == "deploy")
    check("the set-up's deploy workflow name wins", g["change_of"]("workflow_run", run, {"deploy_workflow": "Ship"}) is None)
    dep = g["change_of"]("deployment_status", {"repository": repo, "deployment": {"environment": "production", "sha": "abcdef1"},
                                               "deployment_status": {"state": "success", "created_at": "2026-11-25T14:01:00Z"}}, {})
    check("deployment_status is ready for when it arrives", dep and dep["kind"] == "deploy")

    w = load("incidents_writeup_save")
    check("figures: amounts and counts, not times or PR numbers",
          w["figures"]("Roughly €38,000 of orders at 14:02 after #2291") == {"38000"})
    events = {"e1": {"text": "Sentry: 1,240 users"}, "e2": {"text": "Theo: reverting"}}
    flags = w["review"]([
        {"key": "a", "section": "impact", "text": "About 1,240 people saw it.", "cites": ["e1"]},
        {"key": "b", "section": "impact", "text": "Roughly €38,000 of orders were delayed.", "cites": ["e1"]},
        {"key": "c", "section": "why", "text": "Reviewed by someone outside payments.", "cites": []},
        {"key": "d", "section": "summary", "text": "Theo reverted it.", "cites": ["e2"]},
    ], events)
    check("review flags the uncited claim and the unbacked figure, nothing else", sorted(f["key"] for f in flags) == ["b", "c"])

    n = load("incidents_needs_you")
    now = datetime.now(timezone.utc)
    incs = [{"id": "i1", "number": 14, "title": "Checkout", "severity": "sev2", "status": "investigating", "lead_user_id": "u1",
             "declared_at": now.isoformat(), "update_due_at": (now - timedelta(minutes=1)).isoformat()},
            {"id": "i2", "number": 13, "title": "Search", "severity": "sev3", "status": "resolved", "lead_user_id": "u1",
             "writeup_state": "to_review", "writeup_at": now.isoformat(), "open_flags": 1},
            {"id": "i3", "number": 12, "title": "Login", "severity": "sev3", "status": "fixing", "lead_user_id": "u2",
             "declared_at": now.isoformat()}]
    items = n["items_for"]("u1", incs, {"i1": {"id": "up1", "body": "draft"}}, {"severities": n["DEFAULT_SEVERITIES"]})
    titles = sorted(i["title"] for i in items)
    check("Today: lead, update due, write-up to review; nothing for someone else's incident",
          titles == ["Review the write-up for INC-13", "Send the INC-14 update", "You're leading INC-14: Checkout"])
    check("every item opens the incident in the app", all(i["app"] == "incidents" and i["path"].startswith("/i/") for i in items))

    s = load("incidents_sample_data")
    built = s["build"](datetime(2026, 11, 25, 14, 2, tzinfo=timezone.utc), {"user_id": "u1", "name": "Mara Lind"})
    ids = {e["id"]: e for e in built["incidents_event"]}
    check("sample event ids are the ones add_events would make",
          all(e["id"] == s["event_id"](e["incident_id"], e["source"], e["source_id"]) for e in built["incidents_event"]))
    cites = [c for inc in built["incidents_incident"] for sec in (inc.get("writeup") or {}).get("sections", [])
             for item in sec["items"] for c in item["cites"]]
    check("every sample write-up citation is an event of its incident", cites and all(c in ids for c in cites))
    hyp = built["incidents_hypothesis"][0]
    check("the sample cause's evidence points at real events", all(e["event_id"] in ids for e in hyp["evidence"]))
    check("the sample says what it couldn't check", len(hyp["not_checked"]) == 2)
    demo = s["demo_writeup"](datetime(2026, 11, 25, 14, 2, tzinfo=timezone.utc), {"user_id": "u1", "name": "Mara Lind"})
    known = set(ids) | {demo["event"]["id"]}
    dc = [c for sec in demo["writeup"]["sections"] for item in sec["items"] for c in item["cites"]]
    check("the demo's INC-14 write-up cites only INC-14's events", dc and all(c in known for c in dc))
    emails = [r.get("email") for inc in built["incidents_incident"] for r in inc.get("responders") or [] if r.get("email")]
    check("sample people are at .example addresses", emails and all(e.endswith(".example") for e in emails))

    print(f"\n{len(FAILED)} failed" if FAILED else "\nall checks pass")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
