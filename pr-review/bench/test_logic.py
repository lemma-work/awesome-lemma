"""Plain-Python tests for the logic PR review decides by code, with no Lemma
and no GitHub: globs and rule-file scope, the lines a push touched,
fingerprint matching across pushes, the ledger, the verdict, who a pull
request waits on, and the merge conditions. They run the shared block itself
(bin/common.py), the same text every function carries.

    uv run --no-project --with pytest python -m pytest pr-review/bench/test_logic.py -q
    uv run --no-project python pr-review/bench/test_logic.py      # without pytest
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("prr_common", HERE / "bin" / "common.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
C = _mod.namespace()

NOW = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)


# ---------- globs, rule files, the merge gate ----------

def test_globs():
    m = C["match_glob"]
    assert m("docs/a/b.md", "docs/**")
    assert m("uv.lock", "**/uv.lock") and m("web/uv.lock", "**/uv.lock")
    assert not m("docsx/a.md", "docs/**")
    assert m("web/src/CODEOWNERS", "CODEOWNERS")
    assert m("a/b/c.md", "*.md") and not m("a/b/c.mdx", "*.md")
    assert m("billing/queue.py", "billing/*.py") and not m("billing/x/queue.py", "billing/*.py")


def test_rule_files_and_their_scope():
    rf = C["rule_file"]
    assert rf("AGENTS.md") == ("file", [])
    assert rf("web/AGENTS.md") == ("file", ["web/**"])
    assert rf("CONTRIBUTING.md") == ("file", []) and rf(".github/CONTRIBUTING.md") == ("file", [])
    assert rf("web/CONTRIBUTING.md") is None
    assert rf(".github/copilot-instructions.md") == ("file", [])
    front = "---\napplyTo: \"api/**/*.py, api/**/*.ts\"\n---\nUpdate openapi.json.\n"
    assert rf(".github/instructions/api.instructions.md", front) == ("instructions", ["api/**/*.py", "api/**/*.ts"])
    assert rf(".github/instructions/all.instructions.md", "---\napplyTo: '**'\n---\nx") == ("instructions", [])
    assert rf(".cursor/BUGBOT.md") == ("file", [])
    assert rf("web/.cursor/BUGBOT.md") == ("file", ["web/**"])
    assert rf("node_modules/x/AGENTS.md") is None
    assert rf("src/main.py") is None


def test_rules_from_a_nested_file_stay_in_its_folder():
    s = C["scoped"]
    assert s([], ["web/**"]) == ["web/**"]
    assert s(["**"], ["web/**"]) == ["web/**"]
    assert s(["*.tsx"], ["web/**"]) == ["web/*.tsx"]
    assert s(["web/src/**"], ["web/**"]) == ["web/src/**"]
    assert s(["api/**"], []) == ["api/**"]


def test_the_gate_never_lets_a_pull_request_loosen_its_own_rules():
    g = C["gate_path"]
    for path in ("AGENTS.md", "web/CLAUDE.md", "REVIEW.md", "CONTRIBUTING.md", ".github/workflows/ci.yml",
                 "CODEOWNERS", "docs/CODEOWNERS", ".cursor/BUGBOT.md", ".github/instructions/a.instructions.md"):
        assert g(path), path
    for path in ("docs/guide.md", "web/copy/x.json", "package-lock.json"):
        assert not g(path), path


# ---------- touched lines ----------

PATCH = """@@ -78,9 +78,12 @@ def handle(event):
     charge = event.charge
     job = Job(kind="charge", payload=charge)
-    save_idempotency_key(charge.key)
-    run_charge(job)
+    if already_charged(charge.key):
+        return
+    queue.enqueue(job, retries=5)
+    save_idempotency_key(charge.key)
     log.info("charge queued", id=charge.id)
"""


def test_patch_ranges():
    assert C["patch_ranges"](PATCH) == [[79, 83]]
    assert C["patch_ranges"](None) == "*"
    only_delete = "@@ -10,3 +10,2 @@\n a\n-b\n c\n"
    assert C["patch_ranges"](only_delete) == [[10, 11]]
    assert 84 in C["diff_lines"](PATCH) and 82 in C["diff_lines"](PATCH)


def test_line_touched():
    t = C["touched_from_files"]([{"filename": "billing/queue.py", "patch": PATCH},
                                 {"filename": "img.png", "patch": None},
                                 {"filename": "new.py", "previous_filename": "old.py", "patch": "@@ -1 +1 @@\n-a\n+b\n"}])
    lt = C["line_touched"]
    assert lt(t, "billing/queue.py", 82)
    assert lt(t, "billing/queue.py", 86)          # within the window
    assert not lt(t, "billing/queue.py", 120)
    assert lt(t, "img.png", 5) and lt(t, "old.py", 40)
    assert not lt(t, "jobs/worker.py", 61)
    assert lt(None, "anything", 1)                 # unknown counts as touched


# ---------- fingerprint matching across pushes ----------

PR = {"id": "pr-1", "key": "acme/api#1214"}


def _f(**kw):
    base = {"severity": "should_fix", "body": "", "found_by": "reviewer"}
    base.update(kw)
    return base


def test_first_round_creates_everything():
    plan = C["match_findings"]([], [_f(fingerprint="r1:billing/queue.py:twice", path="billing/queue.py", line=82,
                                       title="A retry can charge twice", severity="must_fix")],
                               first_round=True, sha="a1", round_id="R1", pr=PR)
    assert plan["counts"]["new"] == 1 and plan["creates"][0]["state"] == "open"
    assert plan["creates"][0]["first_sha"] == "a1"


def test_second_push_fixes_dismisses_and_ignores_untouched_lines():
    existing = [
        {"id": "f1", "fingerprint": "r1:billing/queue.py:twice", "state": "open", "path": "billing/queue.py", "line": 82,
         "title": "A retry can charge twice", "rule_id": "r1", "severity": "must_fix"},
        {"id": "f2", "fingerprint": "logs:billing/webhooks.py:card", "state": "open", "path": "billing/webhooks.py", "line": 44,
         "title": "Log lines include a card number", "rule_id": "logs", "severity": "must_fix"},
        {"id": "f3", "fingerprint": "early:jobs/worker.py:61", "state": "dismissed", "path": "jobs/worker.py", "line": 61,
         "title": "Early return on line 61", "rule_id": "early", "severity": "nit"},
        {"id": "f4", "fingerprint": "bug:jobs/retry.py:loop", "state": "open", "path": "jobs/retry.py", "line": 5,
         "title": "Unbounded loop", "rule_id": None, "severity": "should_fix"},
    ]
    touched = {"billing/webhooks.py": [[40, 48]], "billing/queue.py": [[200, 210]]}
    proposed = [
        # still there, reraised with the same fingerprint, line moved
        _f(fingerprint="r1:billing/queue.py:twice", path="billing/queue.py", line=84, title="A retry can charge twice",
           rule_id="r1", severity="must_fix"),
        # the dismissed one, raised again under a new fingerprint but the same rule, path and title
        _f(fingerprint="early:jobs/worker.py:nested", path="jobs/worker.py", line=61, title="Early return on line 61",
           rule_id="early", severity="nit"),
        # new, on lines this push didn't touch: dropped
        _f(fingerprint="tests:jobs/worker.py:none", path="jobs/worker.py", line=10, title="No test", rule_id="tests"),
        # new, on touched lines: kept
        _f(fingerprint="bug:billing/queue.py:typo", path="billing/queue.py", line=205, title="Wrong variable"),
        # new, about the whole change (no path): kept
        _f(fingerprint="tests::none", path=None, line=None, title="Nothing tests the queue"),
    ]
    plan = C["match_findings"](existing, proposed, touched=touched, first_round=False,
                               changed_paths={"billing/queue.py", "billing/webhooks.py", "jobs/worker.py", "jobs/retry.py"},
                               sha="b2", round_id="R2", pr=PR)
    after = {f["id"]: f for f in C["apply_updates"](existing, plan)}
    assert after["f1"]["state"] == "open" and after["f1"]["line"] == 84
    assert after["f2"]["state"] == "fixed" and after["f2"]["fixed_in"] == "b2"      # its lines changed, not seen again
    assert after["f3"]["state"] == "dismissed"                                     # dismissed stays dismissed
    assert after["f4"]["state"] == "open"                                          # untouched, not seen: still open
    c = plan["counts"]
    assert c["kept_dismissed"] == 1 and c["dropped_untouched"] == 1 and c["new"] == 2 and c["fixed"] == 1
    titles = {f["title"] for f in plan["creates"]}
    assert titles == {"Wrong variable", "Nothing tests the queue"}


def test_a_finding_whose_file_left_the_pull_request_is_fixed():
    existing = [{"id": "f1", "fingerprint": "x", "state": "open", "path": "a.py", "line": 3, "title": "t"}]
    plan = C["match_findings"](existing, [], touched={}, first_round=False, changed_paths={"b.py"}, sha="c3", round_id="R3", pr=PR)
    assert plan["updates"] == [{"id": "f1", "state": "fixed", "fixed_in": "c3"}]


def test_resolved_needs_the_file_touched():
    existing = [{"id": "f1", "fingerprint": "x", "state": "open", "path": "a.py", "line": 3, "title": "t"},
                {"id": "f2", "fingerprint": "y", "state": "open", "path": "b.py", "line": 3, "title": "u"}]
    plan = C["match_findings"](existing, [], resolved=["x", "y"], touched={"a.py": [[90, 91]]}, first_round=False,
                               changed_paths={"a.py", "b.py"}, sha="d4", round_id="R4", pr=PR)
    after = {f["id"]: f for f in C["apply_updates"](existing, plan)}
    assert after["f1"]["state"] == "fixed" and after["f2"]["state"] == "open"


def test_a_fixed_finding_back_on_untouched_lines_stays_fixed():
    existing = [{"id": "f1", "fingerprint": "x", "state": "fixed", "path": "a.py", "line": 3, "title": "t", "fixed_in": "b2"}]
    back = [_f(fingerprint="x", path="a.py", line=3, title="t")]
    plan = C["match_findings"](existing, back, touched={"a.py": [[50, 60]]}, first_round=False, changed_paths={"a.py"},
                               sha="c3", round_id="R3", pr=PR)
    assert C["apply_updates"](existing, plan)[0]["state"] == "fixed"
    plan = C["match_findings"](existing, back, touched={"a.py": [[1, 5]]}, first_round=False, changed_paths={"a.py"},
                               sha="c3", round_id="R3", pr=PR)
    assert C["apply_updates"](existing, plan)[0]["state"] == "open"


def test_a_code_finding_is_fixed_when_code_stops_finding_it():
    existing = [{"id": "f1", "fingerprint": "cross:acme/api#1203:m", "state": "open", "path": "migrations/0091_q.py",
                 "found_by": "code", "title": "Migration 0091 is also added by acme/api#1203"}]
    plan = C["match_findings"](existing, [], touched={}, first_round=False, changed_paths={"migrations/0091_q.py"},
                               sha="e5", round_id="R5", pr=PR)
    assert C["apply_updates"](existing, plan)[0]["state"] == "fixed"


# ---------- the ledger and the verdict ----------

RULES = [
    {"id": "r1", "text": "A write that charges money saves its idempotency key first.", "state": "active", "scope": ["billing/**"], "severity": "must_fix"},
    {"id": "r2", "text": "Log lines never include a card number.", "state": "active", "scope": [], "severity": "must_fix"},
    {"id": "r3", "text": "Migrations run on a copy of production data.", "state": "active", "scope": ["migrations/**"],
     "checkable": False, "not_checkable_why": "The review has no database"},
    {"id": "r4", "text": "Public API changes update openapi.json.", "state": "active", "scope": ["api/**"]},
    {"id": "r5", "text": "Tests for behaviour.", "state": "active", "scope": []},
    {"id": "r6", "text": "Old rule.", "state": "retired", "scope": []},
    {"id": "r7", "text": "Web only.", "state": "active", "scope": [], "repo": "acme/web"},
]


def test_in_scope():
    paths = ["billing/queue.py", "migrations/0091_q.py"]
    got = [r["id"] for r in RULES if C["in_scope"](r, paths, "acme/api")]
    assert got == ["r1", "r2", "r3", "r5"]


def test_ledger_is_decided_by_code():
    scope = [r for r in RULES if C["in_scope"](r, ["billing/queue.py", "migrations/0091_q.py"], "acme/api")]
    answers = [{"rule_id": "r1", "state": "passed"},             # the reviewer says passed, but a finding is open: broken
               {"rule_id": "r2", "state": "broken"},             # broken with no finding on a line: not checked
               {"rule_id": "r3", "state": "passed"}]             # can't be checked from a diff: not checked
    findings = [{"id": "f1", "rule_id": "r1", "state": "open", "path": "billing/queue.py", "line": 82}]
    ledger = {e["rule_id"]: e for e in C["build_ledger"](scope, answers, findings)}
    assert ledger["r1"]["state"] == "broken" and "billing/queue.py:82" in ledger["r1"]["note"]
    assert ledger["r2"]["state"] == "not_checked" and "named no line" in ledger["r2"]["note"]
    assert ledger["r3"]["state"] == "not_checked" and "database" in ledger["r3"]["note"]
    assert ledger["r5"]["state"] == "not_checked" and "did not answer" in ledger["r5"]["note"]
    assert len(ledger) == 4


def test_live_ledger_after_a_dismissal():
    ledger = [{"rule_id": "r1", "state": "broken", "finding_ids": ["f1"]}, {"rule_id": "r2", "state": "passed"}]
    live = C["live_ledger"](ledger, [{"id": "f1", "state": "dismissed"}])
    assert live[0]["state"] == "passed"
    assert C["live_ledger"](ledger, [{"id": "f1", "state": "open"}])[0]["state"] == "broken"


def test_verdict():
    v = C["verdict_of"]
    assert v([{"severity": "must_fix"}], "low", "member") == "changes"
    assert v([{"severity": "must_fix"}], "high", "outside") == "changes"
    assert v([{"severity": "should_fix"}], "high", "member") == "needs_person"
    assert v([], "low", "outside") == "needs_person"
    assert v([{"severity": "nit"}], "medium", "member") == "clean"


def test_risk_by_paths_and_size():
    files = [{"path": "billing/queue.py", "additions": 10, "deletions": 2},
             {"path": "package-lock.json", "additions": 9000, "deletions": 9000}]
    risk, reasons = C["assess"](files, [{"glob": "billing/**", "tier": "high", "reviewer_user_id": "u-asha"}], "acme/api")
    assert risk == "high" and reasons[0]["paths"] == ["billing/queue.py"]
    risk, reasons = C["assess"](files[1:], [], "acme/api")
    assert risk == "low"                                           # lockfiles not counted
    risk, _ = C["assess"]([{"path": "a.py", "additions": 1500, "deletions": 600}], [], "acme/api")
    assert risk == "medium"


def test_author_kind():
    members = [{"login": "ravi", "user_id": "u-ravi"}]
    k = C["author_kind_of"]
    assert k("Ravi", "User", members) == "member"
    assert k("dependabot[bot]", "Bot", members) == "bot"
    assert k("lemma-app[bot]", "Bot", members, "lemma/deps-vite") == "bot"
    assert k("lemma-app[bot]", "Bot", members, "lemma/abc123") == "agent"
    assert k("stranger", "User", members) == "outside"


# ---------- who it waits on ----------

MEMBERS = [{"login": "asha", "user_id": "u-asha", "name": "asha", "owns": ["billing/**"]},
           {"login": "ravi", "user_id": "u-ravi", "name": "ravi", "owns": ["api/**"]},
           {"login": "mei", "user_id": "u-mei", "name": "mei", "owns": []}]


def test_waits():
    w = C["waits_of"]
    pr = {"state": "open", "author": "ravi"}
    assert w(pr, None, "reviewing", False, MEMBERS, [], [])[::2] == ("nobody", "round")
    assert w(pr, "changes", "reviewed", False, MEMBERS, [], [])[::2] == ("u-ravi", "fix")
    reasons = [{"source": "path", "reviewer_user_id": "u-asha", "reviewer_name": "asha"}]
    assert w(pr, "needs_person", "reviewed", False, MEMBERS, reasons, ["billing/queue.py"])[::2] == ("u-asha", "review")
    assert w(pr, "needs_person", "reviewed", False, MEMBERS, reasons, ["billing/queue.py"], approvers=["asha"])[::2] == ("u-ravi", "merge")
    assert w(pr, "clean", "reviewed", False, MEMBERS, [], ["api/x.py"])[::2] == ("u-ravi", "merge")
    assert w(pr, "clean", "reviewed", True, MEMBERS, [], [])[::2] == ("nobody", "nothing")
    # an owner is picked before anyone who takes reviews, never the author
    assert w({"state": "open", "author": "mei"}, "needs_person", "reviewed", False, MEMBERS, [], ["api/x.py"])[::2] == ("u-ravi", "review")
    # the owner is the author: the next one who takes reviews, by name
    assert w({"state": "open", "author": "asha"}, "needs_person", "reviewed", False, MEMBERS, [], ["billing/a.py"])[::2] == ("u-mei", "review")
    assert w({"state": "open", "author": "stranger"}, "changes", "reviewed", False, MEMBERS, [], [])[::2] == ("author", "fix")


# ---------- merging by itself ----------

def _merge_case(**over):
    settings = {"merge": {"paths": ["docs/**", "**/package-lock.json"], "max_lines": 40, "max_files": 5, "wait_minutes": 10,
                          "how": "auto"}, "daily_merge_cap": 20}
    repo = {"merge_mode": "merge", "allow_auto_merge": True}
    pr = {"state": "open", "draft": False, "head_sha": "h1", "risk": "low", "author": "mei", "author_kind": "member",
          "labels": [], "merge_state": "merging", "merge_due_at": (NOW - timedelta(minutes=1)).isoformat(), "risk_reasons": []}
    rnd = {"status": "done", "sha": "h1", "files": [{"path": "docs/a.md", "additions": 2, "deletions": 2},
                                                    {"path": "package-lock.json", "additions": 400, "deletions": 400}],
           "ledger": [{"rule_id": "r5", "state": "passed"}]}
    live = {"checks": "passing", "mergeable": "yes", "labels": []}
    findings = []
    for k, v in over.items():
        target = {"pr": pr, "rnd": rnd, "live": live, "repo": repo, "settings": settings}[k.split("__")[0]]
        target[k.split("__")[1]] = v
    return C["merge_conditions"](pr, rnd, findings, settings, repo, live, merged_today=0, now=NOW, at_merge=True)


def _failed(conds):
    return {c["name"] for c in conds if not c["ok"]}


def test_merge_conditions_hold_for_a_small_clean_docs_change():
    conds = _merge_case()
    assert C["eligible"](conds), _failed(conds)


def test_merge_conditions_each_one_bites():
    assert _failed(_merge_case(rnd__status="running")) >= {"round_finished"}
    assert _failed(_merge_case(rnd__sha="old")) >= {"round_finished"}
    assert _failed(_merge_case(rnd__files=[{"path": "src/a.py", "additions": 1, "deletions": 0}])) == {"paths"}
    big = [{"path": "docs/a.md", "additions": 30, "deletions": 20}]
    assert _failed(_merge_case(rnd__files=big)) == {"size"}
    assert _failed(_merge_case(rnd__ledger=[{"rule_id": "r5", "state": "not_checked"}])) == {"rules"}
    assert _failed(_merge_case(pr__risk="medium")) == {"risk"}
    assert _failed(_merge_case(pr__author_kind="outside")) == {"author"}
    assert _failed(_merge_case(pr__author_kind="agent")) == {"author"}
    assert not _failed(_merge_case(pr__author_kind="bot", pr__author="dependabot[bot]"))
    assert _failed(_merge_case(live__checks="failing")) == {"checks"}
    # No CI at all: nothing checked the change, so it waits unless allowed.
    assert _failed(_merge_case(live__checks="none")) == {"checks"}
    allowed = {"paths": ["docs/**", "**/package-lock.json"], "max_lines": 40, "max_files": 5, "wait_minutes": 10,
               "how": "auto", "allow_no_checks": True}
    assert not _failed(_merge_case(live__checks="none", settings__merge=allowed))
    assert _failed(_merge_case(live__mergeable="no")) == {"mergeable"}
    assert _failed(_merge_case(rnd__files=[{"path": "docs/AGENTS.md", "additions": 1, "deletions": 0}])) == {"gate_files"}
    assert _failed(_merge_case(settings__merge={"paths": ["**"], "max_lines": 40, "max_files": 5, "how": "auto"},
                               rnd__files=[{"path": ".github/workflows/ci.yml", "additions": 1, "deletions": 1}])) == {"gate_files"}
    assert _failed(_merge_case(pr__merge_state="held")) == {"not_held"}
    assert _failed(_merge_case(live__labels=["lemma-hold"])) == {"not_held"}
    assert _failed(_merge_case(pr__merge_due_at=(NOW + timedelta(minutes=5)).isoformat())) == {"wait"}
    assert _failed(_merge_case(repo__allow_auto_merge=False)) == {"how"}
    assert _failed(_merge_case(pr__draft=True)) == {"open"}


def test_an_open_finding_of_any_severity_stops_it():
    pr = {"state": "open", "head_sha": "h1", "risk": "low", "author_kind": "member", "merge_due_at": None}
    rnd = {"status": "done", "sha": "h1", "files": [{"path": "docs/a.md", "additions": 1, "deletions": 1}], "ledger": []}
    conds = C["merge_conditions"](pr, rnd, [{"id": "f", "state": "open", "severity": "nit"}],
                                  {"merge": {"paths": ["docs/**"]}}, {"merge_mode": "watch"},
                                  {"checks": "passing", "mergeable": "yes"}, now=NOW)
    assert _failed(conds) == {"findings"}


def test_github_state_readers():
    s = C["summarize_checks"]
    assert s([{"name": "ci", "status": "completed", "conclusion": "success"}], {"statuses": []}) == "passing"
    assert s([{"name": "ci", "status": "in_progress", "conclusion": None}], {}) == "running"
    assert s([{"name": "ci", "status": "completed", "conclusion": "failure"}], {}) == "failing"
    assert s([{"name": "Lemma check", "status": "completed", "conclusion": "failure"}], {}) == "none"
    assert s([], {"statuses": [{"context": "ci", "state": "error"}]}) == "failing"
    mo = C["mergeable_of"]
    assert mo({"mergeable": True, "mergeable_state": "clean"}) == "yes"
    assert mo({"mergeable": True, "mergeable_state": "blocked"}, "auto") == "yes"
    assert mo({"mergeable": True, "mergeable_state": "blocked"}, "squash") == "no"
    assert mo({"mergeable": None}) == "unknown"
    assert mo({"mergeable": False, "mergeable_state": "dirty"}) == "no"


# ---------- the reviewer's answer, checked ----------

def test_validate_review():
    raw = {"output": {"summary": "x" * 3000, "ledger": [{"rule_id": "r1", "state": "checked"}, {"rule_id": "zz", "state": "passed"}],
                      "findings": [{"title": "A", "severity": "block", "rule_id": "r1", "path": "a.py", "line": "12"},
                                   {"severity": "warn"}, {"title": "B", "rule_id": "nope"}],
                      "resolved": ["x"], "key_changes": [{"title": "K", "hunks": [{"path": "a.py", "start": 1, "end": 4}]}] * 20}}
    clean, problems = C["validate_review"](raw, ["r1"])
    assert len(clean["summary"]) == 2000
    assert clean["ledger"] == [{"rule_id": "r1", "state": "passed", "note": ""}]
    assert [f["severity"] for f in clean["findings"]] == ["must_fix", "should_fix"]
    assert clean["findings"][0]["line"] == 12 and clean["findings"][1]["rule_id"] is None
    assert len(clean["key_changes"]) == 8
    assert any("unknown rule" in p for p in problems) and any("without a title" in p for p in problems)
    assert C["validate_review"]("not json", ["r1"])[0] is None
    fenced = '```json\n{"summary": "ok", "ledger": [], "findings": []}\n```'
    assert C["validate_review"](fenced, [])[0]["summary"] == "ok"


def test_linked_issues():
    body = "Fixes #12 and closes acme/web#40. Resolves: #12. Mentions #99."
    assert C["linked_issues"](body, "acme/api") == ["acme/api#12", "acme/web#40"]


def test_gh_app_never_falls_back():
    class Old:
        def execute(self, connector, op, payload):
            raise AssertionError("called as the person")

    class Refuses:
        def execute(self, connector, op, payload, *, act_as="user"):
            err = Exception("This call cannot act as the connector's app")
            err.code, err.status_code = "APP_IDENTITY_UNAVAILABLE", 409
            raise err

    class NoPermission:
        def execute(self, connector, op, payload, *, act_as="user"):
            err = Exception("Resource not accessible by integration")
            err.status_code = 403
            raise err

    class Works:
        def execute(self, connector, op, payload, *, act_as="user"):
            assert act_as == "app"
            return {"result": {"id": 7}}

    pod = type("Pod", (), {})
    for conn, want in ((Old(), "needs_platform"), (Refuses(), "needs_platform"), (NoPermission(), "no_permission"), (Works(), "ok")):
        pod.connectors = conn
        assert C["gh_app"](pod, "checks_create", {})[1] == want


if __name__ == "__main__":
    failed = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        try:
            fn()
            print(f"ok    {name}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL  {name}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
