#!/usr/bin/env python3
"""Write PR review's made-up sample: the fixtures the "Try it" demo and the
site pictures are taken on, and the GitHub answers the demo plays back.

    python3 pr-review/.lemma/shots/fixtures.py

Writes .lemma/shots/fixtures/pods/... (datastore query answers, members) and
the GITHUB block in .lemma/demo.js (each pull request's files with their
patches, its checks, and what pulls_get says). Every person is made up, on
.example addresses; the times are written as of ANCHOR and moved to the
viewer's now by demo.js.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEMMA = HERE.parent
FIX = HERE / "fixtures" / "pods"
NS = uuid.UUID("6f1c2b8e-3d4a-5f60-9b7c-2a1e0d9c8b7a")
ANCHOR = datetime(2026, 11, 25, 10, 0, tzinfo=timezone.utc)


def uid(*parts: object) -> str:
    return str(uuid.uuid5(NS, ":".join(str(p) for p in parts)))


def at(minutes: float = 0, hours: float = 0, days: float = 0) -> str:
    return (ANCHOR - timedelta(minutes=minutes, hours=hours, days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def ahead(minutes: float) -> str:
    return (ANCHOR + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def sha(*parts: object) -> str:
    return uuid.uuid5(NS, "sha:" + ":".join(str(p) for p in parts)).hex[:40]


# ---------------------------------------------------------------- people

ME = "user-sample"
PEOPLE = [
    {"user_id": ME, "login": "asha", "name": "Asha Rao", "email": "asha@acme.example", "owns": ["billing/**"]},
    {"user_id": "user-ravi", "login": "ravi", "name": "Ravi Kumar", "email": "ravi@acme.example", "owns": ["jobs/**"]},
    {"user_id": "user-mei", "login": "mei", "name": "Mei Lin", "email": "mei@acme.example", "owns": ["migrations/**"]},
    {"user_id": "user-tom", "login": "tom", "name": "Tom Becker", "email": "tom@acme.example", "owns": ["web/**"]},
]
BY_LOGIN = {p["login"]: p for p in PEOPLE}
BY_ID = {p["user_id"]: p for p in PEOPLE}

# ---------------------------------------------------------------- repositories

REPOS = {
    "acme/api": {"id": uid("repo", "acme/api"), "full_name": "acme/api", "default_branch": "main", "html_url": "https://github.com/acme/api",
                 "review_mode": "every_push", "merge_mode": "watch", "allow_auto_merge": False, "merge_queue": False,
                 "required_check": "Lemma check", "required_approvals": 1, "checked_at": at(hours=2), "source": "sample", "source_id": "780011"},
    "acme/web": {"id": uid("repo", "acme/web"), "full_name": "acme/web", "default_branch": "main", "html_url": "https://github.com/acme/web",
                 "review_mode": "every_push", "merge_mode": "merge", "allow_auto_merge": True, "merge_queue": False,
                 "required_check": None, "required_approvals": 0, "checked_at": at(hours=2), "source": "sample", "source_id": "780012"},
}
for r in REPOS.values():
    r["created_at"] = at(days=30)
    r["updated_at"] = at(hours=2)

# ---------------------------------------------------------------- rules

RULES: list[dict] = []


def rule(key, text, scope, severity, state, kind, source, quotes=None, checkable=True, why=None, decided_by=None, repo=None):
    row = {
        "id": uid("rule", key), "text": text, "scope": scope, "repo": repo, "severity": severity, "state": state,
        "source_kind": kind, "source": source, "quotes": quotes or [], "source_sha": sha("main", "rules") if kind == "file" else None,
        "seen_at": at(days=1), "checkable": checkable, "not_checkable_why": why, "proposed_by": "prr_scout" if kind != "typed" else None,
        "decided_by": decided_by, "decided_at": at(days=12) if decided_by else None, "sample": True,
        "created_at": at(days=14), "updated_at": at(days=1),
    }
    RULES.append(row)
    return row["id"]


R = {}
R["idem"] = rule("idem", "A write that charges money saves its idempotency key first.", ["billing/**"], "must_fix", "active", "file", "CONTRIBUTING.md:42", decided_by=ME)
R["log"] = rule("log", "Log lines never include a card number or an email address.", [], "must_fix", "active", "file", "AGENTS.md:17", decided_by=ME)
R["migcopy"] = rule("migcopy", "Migrations run on a copy of production data before merge.", ["migrations/**"], "must_fix", "active", "file", "CONTRIBUTING.md:58",
                    checkable=False, why="the review has no database to run them on", decided_by="user-mei")
R["mignum"] = rule("mignum", "Two open pull requests never add the same migration number.", ["migrations/**"], "should_fix", "active", "comments", "3 review comments",
                   quotes=[{"who": "mei", "where": "acme/api#1161", "text": "this is the second 0084 this week, whoever merges last has to renumber"},
                           {"who": "ravi", "where": "acme/api#1172", "text": "clash with 0087 in the other PR"},
                           {"who": "mei", "where": "acme/api#1180", "text": "please check open PRs for the same migration number before pushing"}], decided_by="user-mei")
R["openapi"] = rule("openapi", "Public API changes update openapi.json in the same pull request.", ["api/**"], "should_fix", "active", "file", ".github/instructions/api.instructions.md:4", decided_by=ME)
R["test"] = rule("test", "A pull request that changes behaviour adds or changes a test.", [], "should_fix", "active", "file", "REVIEW.md:9", decided_by=ME)
R["case"] = rule("case", "User-facing text is sentence case.", ["web/**"], "nit", "active", "file", "REVIEW.md:21", decided_by="user-tom")
R["early"] = rule("early", "Prefer early returns over nested conditions.", [], "nit", "active", "file", ".cursor/BUGBOT.md:6", decided_by="user-tom")
R["roles"] = rule("roles", "A new endpoint checks the caller's role before reading data.", ["api/**"], "must_fix", "active", "file", "AGENTS.md:24", decided_by=ME)
R["backoff"] = rule("backoff", "Retries use the shared backoff helper, never a bare sleep.", ["jobs/**", "billing/**"], "should_fix", "active", "file", "CONTRIBUTING.md:71", decided_by="user-ravi")
R["flag"] = rule("flag", "A feature flag is removed within one release of shipping.", [], "nit", "active", "file", "REVIEW.md:30", decided_by=ME)
R["batch"] = rule("batch", "Database queries inside a loop are batched.", ["api/**", "billing/**"], "should_fix", "active", "file", "AGENTS.md:31", decided_by="user-ravi")
R["env"] = rule("env", "Every new environment variable is added to .env.example.", [], "should_fix", "active", "file", "CONTRIBUTING.md:88", decided_by=ME)
R["trace"] = rule("trace", "Errors shown to a customer never include a stack trace.", ["web/**", "api/**"], "must_fix", "active", "file", "AGENTS.md:40", decided_by=ME)
R["money"] = rule("money", "Money is stored in minor units, as an integer.", ["billing/**"], "must_fix", "active", "file", "CONTRIBUTING.md:47", decided_by=ME)
R["states"] = rule("states", "A component that fetches data shows a loading and an empty state.", ["web/**"], "should_fix", "active", "file", ".github/instructions/web.instructions.md:3", decided_by="user-tom")
R["iso"] = rule("iso", "Dates sent to the browser are ISO 8601, in UTC.", ["api/**"], "nit", "active", "file", "REVIEW.md:14", decided_by=ME)
R["hook5"] = rule("hook5", "A webhook handler answers within 5 seconds and queues the rest.", ["billing/**", "api/webhooks/**"], "should_fix", "active", "file", "CONTRIBUTING.md:63", decided_by=ME)
# proposed
rule("owner", "A new table has an owner column.", ["migrations/**"], "should_fix", "proposed", "comments", "4 review comments",
     quotes=[{"who": "mei", "where": "acme/api#1187", "text": "every new table needs an owner column, we keep backfilling these"},
             {"who": "ravi", "where": "acme/api#1176", "text": "owner column?"},
             {"who": "mei", "where": "acme/api#1169", "text": "same as last time: add owner_id so RLS can scope it"},
             {"who": "ravi", "where": "acme/api#1158", "text": "missing owner again"}])
rule("flagowner", "A feature flag check names the flag's owner in a comment.", [], "nit", "proposed", "comments", "2 review comments",
     quotes=[{"who": "tom", "where": "acme/web#1170", "text": "who owns this flag? please say so where it's read"},
             {"who": "tom", "where": "acme/web#1151", "text": "flag owner in a comment please"}])
rule("jobid", "Background jobs log their job id on every line.", ["jobs/**"], "nit", "proposed", "comments", "3 review comments",
     quotes=[{"who": "ravi", "where": "acme/api#1183", "text": "can't trace this without the job id in the log line"}])
rule("copyreview", "Copy changes are read by someone who writes the docs.", ["web/copy/**"], "nit", "proposed", "file", "REVIEW.md:40")
# paused, retired
rule("issue", "Every pull request links an issue.", [], "nit", "paused", "file", "REVIEW.md:5", decided_by="user-tom")
rule("snap", "Snapshot tests are updated only with a reason in the description.", ["web/**"], "nit", "paused", "file", ".cursor/BUGBOT.md:12", decided_by="user-tom")
R["doc"] = rule("doc", "Every function has a docstring.", [], "nit", "retired", "file", "AGENTS.md:9", decided_by=ME)
rule("tabs", "Indent with tabs, not spaces.", [], "nit", "retired", "typed", "Added by Tom Becker", decided_by="user-tom")
rule("console", "No console.log in committed code.", ["web/**"], "nit", "retired", "file", ".cursor/BUGBOT.md:3", decided_by="user-tom")

RULE_ROW = {r["id"]: r for r in RULES}
ACTIVE = [r for r in RULES if r["state"] == "active"]


def glob_re(g: str) -> re.Pattern:
    s = re.escape(g).replace(r"\*\*/", "\0").replace(r"\*\*", "\0").replace(r"\*", "[^/]*").replace("\0", ".*")
    return re.compile("^" + s + "$")


def in_scope(rule_row: dict, paths: list[str]) -> bool:
    if not rule_row["scope"]:
        return True
    return any(glob_re(g).match(p) for g in rule_row["scope"] for p in paths)


# ---------------------------------------------------------------- patches

def hunk(old: int, new: int, header: str, lines: list[tuple[str, str]]) -> tuple[str, int, int]:
    o = sum(1 for k, _ in lines if k in " -")
    n = sum(1 for k, _ in lines if k in " +")
    body = "\n".join(k + t for k, t in lines)
    return f"@@ -{old},{o} +{new},{n} @@ {header}\n{body}", sum(1 for k, _ in lines if k == "+"), sum(1 for k, _ in lines if k == "-")


def patch(*hunks: tuple[str, int, int]) -> tuple[str, int, int]:
    return "\n".join(h[0] for h in hunks), sum(h[1] for h in hunks), sum(h[2] for h in hunks)


PY = ["def {f}(event):", "    \"\"\"{d}\"\"\"", "    if not event:", "        return None", "    result = {f}_inner(event)", "    log.debug(\"{f} done\", id=event.id)", "    return result", ""]
TS = ["export function {f}(input: Input) {{", "  if (!input) return null;", "  const out = compute{F}(input);", "  return out;", "}}", ""]
MD = ["## {F}", "", "{d}", ""]


def synth(path: str, adds: int, dels: int, start: int = 10, new_file: bool = False) -> tuple[str, int, int]:
    """Plausible lines for a file, with exactly this many additions and deletions."""
    ext = path.rsplit(".", 1)[-1]
    name = re.sub(r"[^a-z]", "_", path.rsplit("/", 1)[-1].split(".")[0].lower()) or "part"
    tpl = PY if ext == "py" else MD if ext == "md" else TS
    words = ["load", "save", "check", "apply", "render", "format", "fetch", "queue", "merge", "plan"]
    out: list[str] = []
    i = 0
    while len(out) < adds + dels + 6:
        f = f"{words[i % len(words)]}_{name}" if ext == "py" else f"{words[i % len(words)]}{name.title().replace('_', '')}"
        for t in tpl:
            out.append(t.format(f=f, F=f[0].upper() + f[1:], d=f"How {f.replace('_', ' ')} works."))
        i += 1
    if new_file:
        return hunk(0, 1, "", [("+", t) for t in out[:adds]])
    lines: list[tuple[str, str]] = [(" ", out[0]), (" ", out[1])]
    k = 2
    for _ in range(dels):
        lines.append(("-", out[k] + "  # old"))
        k += 1
    for _ in range(adds):
        lines.append(("+", out[k]))
        k += 1
    lines += [(" ", out[k]), (" ", out[k + 1])]
    return hunk(start, start, "", lines)


def lockfile(adds: int, dels: int) -> tuple[str, int, int]:
    lines: list[tuple[str, str]] = [(" ", "[[package]]"), (" ", 'name = "httpx"')]
    for i in range(dels):
        lines.append(("-", f'version = "0.{20 + i % 7}.{i % 9}"' if i % 3 == 0 else f'    {{ url = "https://files.example/pkg-{i}.whl", hash = "sha256:{sha("lock-old", i)[:24]}" }},'))
    for i in range(adds):
        lines.append(("+", f'version = "0.{28 + i % 3}.{i % 5}"' if i % 3 == 0 else f'    {{ url = "https://files.example/pkg-{i}.whl", hash = "sha256:{sha("lock-new", i)[:24]}" }},'))
    lines.append((" ", ""))
    return hunk(120, 120, "", lines)


def gfile(path: str, p: tuple[str, int, int], status: str = "modified", previous: str | None = None) -> dict:
    out = {"filename": path, "status": status, "additions": p[1], "deletions": p[2], "changes": p[1] + p[2], "patch": p[0],
           "blob_url": f"https://github.com/acme/x/blob/HEAD/{path}"}
    if previous:
        out["previous_filename"] = previous
    return out


# The pull request the pictures are about: billing webhooks onto the queue.
QUEUE_PY = patch(
    hunk(1, 1, "", [(" ", "from billing.charges import run_charge, save_idempotency_key"), ("+", "from billing.charges import already_charged"),
                    ("-", "from billing.retry import retry"), ("+", "from jobs.queue import Job, queue"), (" ", "from common.log import log"), (" ", "")]),
    hunk(78, 78, "def handle(event):", [
        (" ", "    charge = event.charge"), (" ", "    job = Job(kind=\"charge\", payload=charge)"),
        ("-", "    save_idempotency_key(charge.key)"), ("-", "    run_charge(job)"),
        ("+", "    if already_charged(charge.key):"), ("+", "        return"), ("+", "    queue.enqueue(job, retries=5)"), ("+", "    save_idempotency_key(charge.key)"),
        (" ", "    log.info(\"charge queued\", id=charge.id)"),
    ]),
    hunk(96, 104, "def process(event):", [
        (" ", ""), ("-", "def process(event):"), ("-", "    run_charge(event.charge)"), ("+", "def requeue(job_id):"), ("+", "    \"\"\"Put a failed charge back on the queue, once.\"\"\""),
        ("+", "    job = queue.get(job_id)"), ("+", "    if job and job.attempts < job.retries:"), ("+", "        queue.enqueue(job, retries=job.retries - job.attempts)"),
        ("+", "    return job"), ("+", ""), ("+", "def drain(limit=100):"), ("+", "    for job in queue.take(limit):"), ("+", "        yield job"), (" ", ""),
    ]),
)
MIGRATION = patch(hunk(0, 1, "", [("+", t) for t in [
    "\"\"\"Queue the billing webhooks: one table for jobs and their attempts.\"\"\"", "", "from alembic import op", "import sqlalchemy as sa", "",
    "revision = \"0091\"", "down_revision = \"0090\"", "", "", "def upgrade():", "    op.create_table(", "        \"job\",",
    "        sa.Column(\"id\", sa.Uuid, primary_key=True),", "        sa.Column(\"kind\", sa.Text, nullable=False),",
    "        sa.Column(\"payload\", sa.JSON, nullable=False),", "        sa.Column(\"attempts\", sa.Integer, server_default=\"0\"),",
    "        sa.Column(\"retries\", sa.Integer, server_default=\"5\"),", "        sa.Column(\"run_after\", sa.DateTime(timezone=True)),", "    )",
    "    op.create_index(\"job_run_after\", \"job\", [\"run_after\"])", "", "", "def downgrade():", "    op.drop_table(\"job\")"]]))
WEBHOOKS_PY = patch(
    hunk(30, 30, "def verify(request):", [(" ", "def verify(request):"), (" ", "    signature = request.headers[\"Stripe-Signature\"]"),
                                         ("-", "    log.info(\"webhook\", card=request.json[\"card\"][\"last4\"], email=request.json[\"email\"])"),
                                         ("+", "    log.info(\"webhook\", event=request.json[\"id\"])"), (" ", "    return check_signature(signature, request.body)")]),
    hunk(55, 55, "def route(event):", [(" ", "def route(event):"), (" ", "    if event.type == \"invoice.paid\":"), (" ", "        if event.amount:"),
                                       (" ", "            return queue_handle(event)"), (" ", "    return None"), (" ", "")]),
    synth("billing/webhooks.py", 29, 11, start=80),
)
WORKER_PY = synth("jobs/worker.py", 22, 6, start=12)
RETRY_PY = synth("jobs/retry.py", 14, 9, start=20)
TEST_PY = synth("tests/test_queue.py", 40, 0, new_file=True)
DOCS_MD = synth("docs/billing.md", 5, 2, start=8)

FILES_1214 = [
    gfile("billing/queue.py", QUEUE_PY), gfile("migrations/0091_queue.py", MIGRATION, "added"), gfile("billing/webhooks.py", WEBHOOKS_PY),
    gfile("jobs/worker.py", WORKER_PY), gfile("jobs/retry.py", RETRY_PY), gfile("tests/test_queue.py", TEST_PY, "added"), gfile("docs/billing.md", DOCS_MD),
    gfile("uv.lock", lockfile(188, 38)),
] + [gfile(f"billing/legacy/{n}.py", synth(f"billing/legacy/{n}.py", 5, 2, start=1), "renamed", f"billing/handlers/{n}.py")
     for n in ["invoice", "refund", "dispute", "payout", "coupon", "tax", "credit", "receipt", "trial", "plan"]]

FILES_1203 = [
    gfile("api/invoices/sync.py", patch(hunk(40, 40, "def sync_invoice(invoice):", [
        (" ", "def sync_invoice(invoice):"), (" ", "    response = ledger.post(invoice.to_json())"), ("-", "    response.raise_for_status()"),
        ("+", "    if response.status_code == 502:"), ("+", "        for attempt in range(3):"), ("+", "            time.sleep(2 ** attempt)"),
        ("+", "            response = ledger.post(invoice.to_json())"), ("+", "            if response.ok:"), ("+", "                break"),
        ("+", "    response.raise_for_status()"), (" ", "    return response.json()")]), synth("api/invoices/sync.py", 26, 17, start=80))),
    gfile("migrations/0091_invoice_sync.py", synth("migrations/0091_invoice_sync.py", 18, 0, new_file=True), "added"),
    gfile("tests/test_invoice_sync.py", synth("tests/test_invoice_sync.py", 10, 3, start=5)),
]

FILES_1198 = [
    gfile("web/settings/rename.ts", patch(hunk(12, 12, "export async function renameWorkspace", [
        (" ", "export async function renameWorkspace(team: Team, name: string) {"), (" ", "  const before = team.name;"),
        ("-", "  log.info(\"workspace renamed\", { id: team.id });"), ("+", "  log.info(\"team renamed\", { id: team.id, by: session.user.email });"),
        (" ", "  await api.patch(`/teams/${team.id}`, { name });"), (" ", "  return { before, after: name };"), (" ", "}")]), synth("web/settings/rename.ts", 20, 18, start=40))),
] + [gfile(f"web/settings/{n}.tsx", synth(f"web/settings/{n}.tsx", 8, 8, start=3)) for n in ["Members", "Billing", "General", "Danger", "Invites", "Header", "Sidebar", "Empty", "Plan", "Seats"]] \
  + [gfile(f"web/copy/{n}.json", synth(f"web/copy/{n}.md", 6, 6, start=1)) for n in ["en", "de", "fr", "es", "ja", "pt", "it", "nl", "sv", "da", "fi", "pl", "cs", "tr", "ko", "zh", "he", "ar", "hi", "id"]]

FILES_1210 = [
    gfile("api/plans/views.py", patch(hunk(22, 22, "def get_plan(request, plan_id):", [
        (" ", "def get_plan(request, plan_id):"), (" ", "    require_role(request, \"member\")"), ("-", "    plan = Plan.objects.get(id=plan_id)"),
        ("+", "    plan = Plan.objects.filter(id=plan_id, deleted_at__isnull=True).first()"), ("+", "    if plan is None:"), ("+", "        raise NotFound(\"No such plan\")"),
        (" ", "    return serialize(plan)")]))),
    gfile("tests/test_plans.py", synth("tests/test_plans.py", 15, 3, start=40)),
]
FILES_1217 = [gfile("web/copy/billing-settings.md", patch(hunk(4, 4, "", [(" ", "## Billing settings"), (" ", ""), ("-", "Change the card your team is billed on, or downlaod past invoices."),
                                                                          ("+", "Change the card your team is billed on, or download past invoices."), (" ", ""),
                                                                          ("-", "Invoices are emailed to the billing contanct."), ("+", "Invoices are emailed to the billing contact.")])))]
FILES_1215 = [gfile("package-lock.json", lockfile(64, 58))]


# ---------------------------------------------------------------- pull requests

PRS: list[dict] = []
ROUNDS: list[dict] = []
FINDINGS: list[dict] = []
LOG: list[dict] = []
GH: dict = {"files": {}, "checks": {}, "pulls": {}}


def files_for(n: int, paths: list[str], add: int, dele: int) -> list[dict]:
    each_a = max(1, add // max(1, len(paths)))
    each_d = dele // max(1, len(paths))
    out = []
    for i, p in enumerate(paths):
        a = add - each_a * (len(paths) - 1) if i == 0 else each_a
        d = dele - each_d * (len(paths) - 1) if i == 0 else each_d
        out.append(gfile(p, synth(p, max(0, a), max(0, d), start=10 + i * 7)))
    return out


def ledger_for(paths: list[str], broken: dict[str, str] | None = None, not_checked: dict[str, str] | None = None, notes: dict[str, str] | None = None) -> list[dict]:
    broken = broken or {}
    not_checked = dict(not_checked or {})
    out = []
    for r in ACTIVE:
        if not in_scope(r, paths):
            continue
        key = next(k for k, v in R.items() if v == r["id"])
        if not r["checkable"]:
            out.append({"rule_id": r["id"], "text": r["text"], "state": "not_checked", "note": not_checked.get(key, r["not_checkable_why"]), "finding_ids": []})
        elif key in broken:
            out.append({"rule_id": r["id"], "text": r["text"], "state": "broken", "note": broken[key], "finding_ids": []})
        else:
            out.append({"rule_id": r["id"], "text": r["text"], "state": "passed", "note": (notes or {}).get(key), "finding_ids": []})
    return out


def add_pr(repo: str, n: int, title: str, author: str, *, kind="member", add=10, dele=2, files: list[dict] | None = None, paths: list[str] | None = None,
           head_ref="", waits_on=None, waits_for=None, waits_min=60, verdict="clean", risk="low", state="open", merged_days=None, merge_state=None,
           merge_due=None, checks="passing", summary="", rounds: list[dict] | None = None, draft=False, opened_days=1.0, by_itself=False,
           mergeable="yes", review_state="reviewed", linked=None):
    pid = uid("pr", repo, n)
    if files is None:
        files = files_for(n, paths or [f"src/part_{n}.py"], add, dele)
    add = sum(f["additions"] for f in files)
    dele = sum(f["deletions"] for f in files)
    member = BY_LOGIN.get(author)
    rounds = rounds or [{}]
    shas = [r.get("sha") or sha(repo, n, i) for i, r in enumerate(rounds)]
    head = shas[-1]
    merged_at = at(days=merged_days) if merged_days is not None else None
    row = {
        "id": pid, "key": f"{repo}#{n}", "repository_id": REPOS[repo]["id"], "repo": repo, "number": n, "title": title,
        "url": f"https://github.com/{repo}/pull/{n}", "author": author, "author_user_id": member["user_id"] if member else None,
        "author_kind": kind, "state": state, "draft": draft, "head_sha": head, "head_ref": head_ref or re.sub(r"[^a-z0-9]+", "-", title.lower())[:40].strip("-"),
        "base_ref": "main", "additions": add, "deletions": dele, "changed_files": len(files), "labels": [], "risk": risk,
        "waits_on": waits_on if state == "open" else None,
        "waits_on_name": (BY_ID.get(waits_on) or {}).get("name") if waits_on else None,
        "waits_for": waits_for if state == "open" else None, "waits_since": at(minutes=waits_min) if state == "open" else merged_at,
        "review_state": review_state, "reviewed_sha": head if review_state == "reviewed" else (shas[-2] if len(shas) > 1 else None),
        "verdict": verdict if review_state == "reviewed" or len(rounds) > 1 else None, "summary": summary or None, "linked_issues": linked or [],
        "checks": checks, "mergeable": mergeable, "merge_state": ("merged_by_itself" if by_itself else None) if state == "merged" else merge_state,
        "merge_due_at": merge_due, "opened_at": at(days=opened_days), "merged_at": merged_at, "closed_at": merged_at,
        "source": "sample", "source_id": f"PR_sample_{n}", "created_at": at(days=opened_days), "updated_at": at(minutes=waits_min) if state == "open" else merged_at,
    }
    PRS.append(row)
    paths_now = [f["filename"] for f in files]
    for i, spec in enumerate(rounds):
        rid = uid("round", repo, n, i + 1)
        started = spec.get("started")
        if started is None:
            started = (waits_min + 3) if state == "open" else (merged_days * 1440 + 60)
            started += (len(rounds) - 1 - i) * 180
        status = spec.get("status", "done")
        ROUNDS.append({
            "id": rid, "pull_request_id": pid, "key": row["key"], "sha": shas[i], "since_sha": shas[i - 1] if i else None, "seq": i + 1,
            "status": status, "queued_at": at(minutes=started + 1), "started_at": at(minutes=started), "finished_at": at(minutes=started - 4) if status == "done" else None,
            "files": [{"path": f["filename"], "status": f["status"], "additions": f["additions"], "deletions": f["deletions"], "previous": f.get("previous_filename")} for f in files],
            "touched": {}, "summary": spec.get("summary", summary) if status == "done" else None,
            "key_changes": spec.get("key_changes", []), "mechanical": spec.get("mechanical", []), "lines_to_read": spec.get("lines_to_read", []),
            "lines_total": add + dele, "lines_to_read_count": spec.get("read"),
            "ledger": spec.get("ledger") if "ledger" in spec else (ledger_for(paths_now) if status == "done" else []),
            "cross_pr": spec.get("cross_pr", []), "counts": spec.get("counts", {"new": 0, "kept": 0, "fixed": 0, "kept_dismissed": 0, "dropped_untouched": 0, "invalid": 0}),
            "verdict": verdict if status == "done" else None, "risk": risk, "risk_reasons": spec.get("risk_reasons", []),
            "github": spec.get("github", {"check": "ok", "approval": "off", "comment": "off", "review": "off"}) if status == "done" else {},
            "conversation_id": None, "workflow_run_id": None, "error": None, "sample": True, "created_at": at(minutes=started + 1), "updated_at": at(minutes=started - 4),
        })
    GH["files"][f"{repo}#{n}"] = files
    GH["pulls"][f"{repo}#{n}"] = {
        "number": n, "state": "closed" if state != "open" else "open", "merged": state == "merged", "draft": draft,
        "mergeable": mergeable == "yes", "mergeable_state": "blocked" if checks == "failing" else "unstable" if checks == "running" else "clean",
        "commits": spec_commits(rounds), "head": {"sha": head, "ref": row["head_ref"]}, "base": {"ref": "main"}, "user": {"login": author}, "html_url": row["url"],
    }
    GH["checks"][head] = checks_list(checks, repo)
    return pid, [uid("round", repo, n, i + 1) for i in range(len(rounds))], shas


def spec_commits(rounds):
    return 2 + 2 * len(rounds)


CHECK_NAMES = ["lint", "typecheck", "test (3.12)", "test (3.13)", "build", "e2e: billing", "e2e: reports", "migrations", "security scan", "license check",
               "docs", "bundle size", "storybook", "preview deploy"]


def checks_list(state: str, repo: str) -> list[dict]:
    out = []
    for i, name in enumerate(CHECK_NAMES):
        st, concl = "completed", "success"
        if state == "failing" and name == "test (3.12)":
            concl = "failure"
        if state == "running" and i in (2, 3, 6):
            st, concl = "in_progress", None
        out.append({"id": 9000 + i, "name": name, "status": st, "conclusion": concl, "html_url": f"https://github.com/{repo}/runs/{9000 + i}"})
    out.append({"id": 9100, "name": "Lemma check", "status": "completed", "conclusion": "failure" if state == "failing" else "success", "app": {"slug": "lemma"}})
    return out


def finding(pid, key, rid_first, rid_last, rule_key, severity, path, line, title, body, suggestion=None, state="open", fixed_in=None, by="reviewer",
            decided_by=None, created_min=60, end_line=None, slug=None):
    fid = uid("finding", key, slug or title)
    FINDINGS.append({
        "id": fid, "fingerprint": f"{rule_key or 'bug'}:{path}:{slug or re.sub(r'[^a-z]+', '-', title.lower())[:30]}", "pull_request_id": pid, "key": key,
        "rule_id": R.get(rule_key) if rule_key else None, "severity": severity, "path": path, "line": line, "end_line": end_line, "title": title,
        "body": body, "suggestion": suggestion, "state": state, "fixed_in": fixed_in, "found_by": by, "first_round": rid_first, "first_sha": None,
        "last_seen_round": rid_last, "last_seen_sha": None, "decided_by": decided_by, "decided_at": at(minutes=created_min - 30) if decided_by else None,
        "decided_note": None, "task_id": None, "posted_round": None, "sample": True, "created_at": at(minutes=created_min), "updated_at": at(minutes=max(1, created_min - 40)),
    })
    return fid


# --- 1214: the one every picture is about
p1214 = [f["filename"] for f in FILES_1214]
led1214_r1 = ledger_for(p1214, broken={"idem": "billing/queue.py:82", "log": "billing/webhooks.py:32", "mignum": "shared with acme/api#1203"},
                        notes={"openapi": "no public API changed"})
led1214_r2 = ledger_for(p1214, broken={"idem": "billing/queue.py:82", "mignum": "shared with acme/api#1203"},
                        notes={"log": "fixed in round 2", "openapi": "no public API changed", "test": "tests/test_queue.py added", "backoff": "jobs/retry.py uses backoff()", "hook5": "answers before it queues"})
pid, (r1, r2), (s1, s2) = add_pr(
    "acme/api", 1214, "Move billing webhooks onto the shared queue", "ravi", files=FILES_1214, head_ref="billing-queue", waits_on=ME, waits_for="review", waits_min=12,
    verdict="changes", risk="high", opened_days=1.2,
    summary="Billing webhooks go through the shared job queue instead of running in the request. Retries move from the handler to the queue.",
    rounds=[
        {"sha": "7c2e9f1" + sha("1214a")[7:], "ledger": led1214_r1, "started": 300, "counts": {"new": 3, "kept": 0, "fixed": 0, "kept_dismissed": 0, "dropped_untouched": 0, "invalid": 0}},
        {"sha": "a91c3f2" + sha("1214b")[7:], "ledger": led1214_r2, "started": 16, "read": 214,
         "counts": {"new": 1, "kept": 1, "fixed": 1, "kept_dismissed": 1, "dropped_untouched": 2, "invalid": 0},
         "risk_reasons": [{"source": "path", "glob": "billing/**", "tier": "high", "reason": "money moves here", "reviewer_user_id": ME},
                          {"source": "path", "glob": "migrations/**", "tier": "high", "reason": "schema changes", "reviewer_user_id": "user-mei"}],
         "key_changes": [
             {"title": "Charges are queued, not run in the webhook request", "why": "The handler answers at once and a worker runs the charge, so a slow card network no longer times out the webhook.", "hunks": [{"path": "billing/queue.py", "start": 60, "end": 84}, {"path": "jobs/worker.py", "start": 12, "end": 40}]},
             {"title": "Retries move from the handler to the queue", "why": "Five tries with the shared backoff instead of three in the request.", "hunks": [{"path": "jobs/retry.py", "start": 20, "end": 44}]},
             {"title": "A new job table", "why": "Migration 0091 adds it; acme/api#1203 adds a 0091 too.", "hunks": [{"path": "migrations/0091_queue.py", "start": 1, "end": 24}]},
         ],
         "mechanical": [{"kind": "renames", "files": 10, "lines": 70, "examples": ["billing/handlers/invoice.py → billing/legacy/invoice.py", "billing/handlers/refund.py → billing/legacy/refund.py"]},
                        {"kind": "lockfile", "files": 1, "lines": 226, "examples": ["uv.lock"]}],
         "cross_pr": [{"pr": "acme/api#1203", "kind": "same_number", "detail": "both add migrations/0091_*.py", "paths": ["migrations/0091_queue.py", "migrations/0091_invoice_sync.py"]}]},
    ],
)
F1 = finding(pid, "acme/api#1214", r1, r2, "idem", "must_fix", "billing/queue.py", 82, "A retry can charge twice",
             "The job is queued on line 82 before its idempotency key is saved on line 83. A worker that picks it up and fails in between retries with no key, and the customer is charged again.",
             suggestion="+    save_idempotency_key(charge.key)\n+    queue.enqueue(job, retries=5)", created_min=300, slug="retry-charges-twice")
F2 = finding(pid, "acme/api#1214", r2, r2, "mignum", "should_fix", "migrations/0091_queue.py", None, "Migration 0091 is also added by acme/api#1203",
             "Both open pull requests add migrations/0091_*.py. Whichever merges second fails to migrate.", by="code", created_min=16, slug="migration-0091")
finding(pid, "acme/api#1214", r1, r2, "log", "must_fix", "billing/webhooks.py", 32, "Log lines include a card number",
        "The webhook log line prints the card's last four digits and the customer's email.", state="fixed", fixed_in="3e1b0d4" + sha("fix")[7:], created_min=300, slug="log-card")
finding(pid, "acme/api#1214", r1, r2, "early", "nit", "billing/webhooks.py", 58, "Early return on line 61",
        "The nested ifs in route() read more easily as an early return.", state="dismissed", decided_by="user-mei", created_min=300, slug="early-return")
for e in led1214_r2:
    if e["rule_id"] == R["idem"]:
        e["finding_ids"] = [F1]
    if e["rule_id"] == R["mignum"]:
        e["finding_ids"] = [F2]

# --- 1209: clean, waits on you
add_pr("acme/web", 1209, "Add the export button to reports", "mei", paths=["web/reports/Export.tsx", "web/reports/Table.tsx", "web/copy/reports.md", "tests/reports.test.ts"],
       add=88, dele=12, waits_on=ME, waits_for="review", waits_min=60, summary="Reports get an Export button that downloads the table as a CSV, with the filters applied.", opened_days=0.2)
# --- 1203: should fix, failing check, waits on you
p1203 = [f["filename"] for f in FILES_1203]
led1203 = ledger_for(p1203, broken={"mignum": "shared with acme/api#1214", "backoff": "api/invoices/sync.py:45"}, notes={"test": "tests/test_invoice_sync.py changed"})
pid, rs, ss = add_pr("acme/api", 1203, "Retry failed invoice sync on 502", "tom", files=FILES_1203, waits_on=ME, waits_for="review", waits_min=180, verdict="needs_person", risk="high", checks="failing",
                     opened_days=3, summary="When the ledger answers 502, the invoice sync tries again up to three times before it gives up.",
                     rounds=[{}, {}, {"risk_reasons": [{"source": "path", "glob": "migrations/**", "tier": "high", "reason": "schema changes", "reviewer_user_id": "user-mei"}], "ledger": led1203,
                                     "cross_pr": [{"pr": "acme/api#1214", "kind": "same_number", "detail": "both add migrations/0091_*.py", "paths": ["migrations/0091_invoice_sync.py"]}]}])
F5 = finding(pid, "acme/api#1203", rs[2], rs[2], "mignum", "should_fix", "migrations/0091_invoice_sync.py", None, "Migration 0091 is also added by acme/api#1214",
             "Both open pull requests add migrations/0091_*.py. Whichever merges second fails to migrate.", by="code", created_min=40, slug="migration-0091")
F6 = finding(pid, "acme/api#1203", rs[0], rs[2], "backoff", "should_fix", "api/invoices/sync.py", 45, "A bare sleep instead of the backoff helper",
             "The retry loop sleeps 2 ** attempt seconds itself. The shared jobs.retry.backoff() adds jitter, so a ledger outage doesn't get every worker retrying at once.",
             suggestion="-            time.sleep(2 ** attempt)\n+            backoff(attempt)", created_min=2000, slug="bare-sleep")
for e in led1203:
    if e["rule_id"] == R["mignum"]:
        e["finding_ids"] = [F5]
    if e["rule_id"] == R["backoff"]:
        e["finding_ids"] = [F6]
# --- 1210: ready to merge
add_pr("acme/api", 1210, "Return 404 for a deleted plan", "tom", files=FILES_1210, waits_on=ME, waits_for="merge", waits_min=40, opened_days=0.5,
       summary="Asking for a deleted plan answers 404 instead of a server error.")
# --- merging by itself
add_pr("acme/web", 1217, "Fix a typo on the billing settings page", "mei", files=FILES_1217, waits_on="nobody", waits_for="nothing", waits_min=6,
       merge_state="merging", merge_due=ahead(8), summary="Two spelling fixes on the billing settings page.", opened_days=0.01)
add_pr("acme/web", 1215, "Bump vite and 4 dev packages", "acme-deps[bot]", kind="bot", files=FILES_1215, waits_on="nobody", waits_for="nothing", waits_min=60,
       merge_state="merging", merge_due=at(minutes=50), summary="Dev dependency updates: vite, vitest, eslint, prettier and typescript.", opened_days=0.06)
# --- returned to you
p1198 = [f["filename"] for f in FILES_1198]
pid, rs, ss = add_pr("acme/web", 1198, "Rename workspace to team in settings", "asha", files=FILES_1198, waits_on=ME, waits_for="fix", waits_min=300, verdict="changes",
                     opened_days=1, summary="Settings say team instead of workspace everywhere, in every language.",
                     rounds=[{}, {"ledger": ledger_for(p1198, broken={"log": "web/settings/rename.ts:15"}, notes={"case": "every new label is sentence case"})}])
F7 = finding(pid, "acme/web#1198", rs[1], rs[1], "log", "must_fix", "web/settings/rename.ts", 15, "The rename log line has the person's email",
             "The new log line adds session.user.email. Log lines never carry an email address; the user id is enough to trace it.",
             suggestion="-  log.info(\"team renamed\", { id: team.id, by: session.user.email });\n+  log.info(\"team renamed\", { id: team.id, by: session.user.id });", created_min=300, slug="rename-email")
# --- waiting on others
add_pr("acme/web", 1211, "Stream large CSV exports", "asha", paths=["web/reports/stream.ts", "web/reports/Export.tsx", "api/exports/csv.py", "api/exports/views.py", "tests/test_csv.py", "docs/exports.md"],
       add=130, dele=41, waits_on="user-mei", waits_for="review", waits_min=120, opened_days=0.3, summary="CSV exports stream row by row, so an export of a year no longer times out.")
add_pr("acme/api", 1216, "Add an owner column to new tables", "lemma-coding[bot]", kind="agent", paths=["migrations/0092_owner.py", "api/models/base.py"], add=22, dele=0,
       waits_on="user-ravi", waits_for="review", waits_min=20, checks="running", opened_days=0.02, summary="New tables get an owner column, so row-level rules can scope them.")
# --- reviewing now
add_pr("acme/api", 1219, "Cache plan lookups per request", "tom", paths=["api/plans/cache.py", "api/plans/views.py"], add=54, dele=9, waits_on="nobody", waits_for="round", waits_min=4,
       review_state="reviewing", opened_days=0.01, rounds=[{"status": "running", "started": 3}])
# --- the rest of what's open (All open)
for repo, n, title, author, paths, a, d, waits, wfor, mins, verdict, risk in [
    ("acme/web", 1220, "Show the plan name in the billing header", "ravi", ["web/billing/Header.tsx", "web/copy/billing.md"], 24, 6, "user-mei", "review", 30, "clean", "low"),
    ("acme/api", 1218, "Paginate the audit log endpoint", "mei", ["api/audit/views.py", "api/audit/serializers.py", "openapi.json", "tests/test_audit.py"], 96, 30, "user-tom", "review", 90, "clean", "low"),
    ("acme/web", 1213, "Keyboard shortcuts on the reports table", "tom", ["web/reports/Table.tsx", "web/reports/keys.ts", "tests/keys.test.ts"], 70, 12, "user-ravi", "review", 200, "clean", "low"),
    ("acme/api", 1212, "Drop the unused legacy_invoices table", "ravi", ["migrations/0090_drop_legacy.py", "api/models/legacy.py"], 8, 64, "user-mei", "review", 400, "needs_person", "high"),
    ("acme/web", 1207, "Dark mode for the invoice PDF preview", "mei", ["web/invoices/Preview.tsx", "web/invoices/theme.ts"], 44, 10, "user-tom", "review", 900, "clean", "low"),
    ("acme/api", 1205, "Fix a typo in the README", "jdoe-dev", ["README.md"], 1, 1, "user-ravi", "review", 1500, "needs_person", "low"),
    ("acme/web", 1204, "Move date formatting into one helper", "ravi", ["web/lib/dates.ts", "web/reports/Table.tsx", "web/invoices/List.tsx"], 60, 48, "user-ravi", "fix", 700, "changes", "low"),
    ("acme/api", 1201, "Add rate limit headers", "tom", ["api/middleware/limits.py", "openapi.json", "tests/test_limits.py"], 58, 4, "user-mei", "review", 1800, "clean", "low"),
    ("acme/web", 1196, "Remove the old onboarding checklist", "mei", ["web/onboarding/Checklist.tsx", "web/onboarding/index.ts", "web/copy/onboarding.md"], 6, 140, "user-mei", "fix", 2600, "changes", "low"),
]:
    kind = "outside" if author == "jdoe-dev" else "member"
    pid, rs, ss = add_pr(repo, n, title, author, kind=kind, paths=paths, add=a, dele=d, waits_on=waits, waits_for=wfor, waits_min=mins, verdict=verdict, risk=risk,
                         opened_days=mins / 1440 + 0.2, summary=f"{title}.")
    if verdict == "changes":
        finding(pid, f"{repo}#{n}", rs[0], rs[0], "test" if n == 1204 else "states", "must_fix" if n == 1196 else "should_fix", paths[0], 14,
                "No test covers the new helper" if n == 1204 else "The checklist's empty state goes with it", "A behaviour change with no test beside it." if n == 1204 else "Removing it leaves the onboarding page with no empty state.", created_min=mins)

# --- merged this week: six by itself, six by a person
MERGED = [
    ("acme/web", 1206, "Update the pricing FAQ", "mei", ["docs/pricing-faq.md"], 12, 9, 1.2, True),
    ("acme/web", 1202, "Bump eslint and 2 dev packages", "acme-deps[bot]", ["package-lock.json"], 40, 38, 1.8, True),
    ("acme/web", 1200, "Fix a broken link in the setup guide", "tom", ["docs/setup.md"], 1, 1, 2.1, True),
    ("acme/web", 1197, "Reword the empty state on Invoices", "mei", ["web/copy/invoices.md"], 4, 4, 2.6, True),
    ("acme/web", 1195, "Bump typescript to 5.9.3", "acme-deps[bot]", ["package-lock.json"], 6, 6, 3.4, True),
    ("acme/web", 1194, "Spell out the trial length on the plans page", "ravi", ["web/copy/plans.md"], 2, 2, 4.0, True),
    ("acme/api", 1199, "Store refunds in minor units", "ravi", ["billing/refunds.py", "migrations/0089_refund_cents.py", "tests/test_refunds.py"], 64, 22, 0.8, False),
    ("acme/api", 1193, "Answer the Stripe webhook before charging", "asha", ["billing/webhooks.py", "tests/test_webhooks.py"], 38, 20, 1.5, False),
    ("acme/web", 1191, "Loading and empty states on the team page", "tom", ["web/team/Members.tsx", "web/team/Empty.tsx"], 70, 14, 2.2, False),
    ("acme/api", 1189, "Role check on the export endpoint", "mei", ["api/exports/views.py", "tests/test_exports.py"], 16, 3, 3.0, False),
    ("acme/api", 1186, "Add the invoice number to the ledger API", "tom", ["api/invoices/views.py", "openapi.json", "tests/test_invoices.py"], 30, 6, 4.5, False),
    ("acme/web", 1185, "Batch the member lookups on the audit page", "ravi", ["web/audit/List.tsx", "api/audit/views.py"], 26, 18, 5.5, False),
]
merged_ids = {}
for repo, n, title, author, paths, a, d, days, itself in MERGED:
    kind = "bot" if author.endswith("[bot]") else "member"
    pid, rs, ss = add_pr(repo, n, title, author, kind=kind, paths=paths, add=a, dele=d, state="merged", merged_days=days, by_itself=itself, opened_days=days + 0.5,
                         summary=f"{title}.")
    merged_ids[n] = (pid, rs, ss)
    if itself:
        LOG.append({"id": uid("log", n, "merging"), "pull_request_id": pid, "key": f"{repo}#{n}", "sha": ss[-1], "action": "merging", "how": "auto", "conditions": [], "by": None, "at": at(days=days, minutes=12), "note": None, "sample": True})
        LOG.append({"id": uid("log", n, "merged"), "pull_request_id": pid, "key": f"{repo}#{n}", "sha": ss[-1], "action": "merged", "how": "auto",
                    "conditions": [{"name": c, "ok": True, "detail": None} for c in ["paths", "size", "rules", "findings", "risk", "author", "checks", "mergeable", "gate"]],
                    "by": None, "at": at(days=days), "note": None, "sample": True})

# Held twice before they merged, this week.
for n, note, days in [(1200, "asked for a screenshot first", 2.15)]:
    pr = next(p for p in PRS if p["number"] == n)
    if True:
        LOG.append({"id": uid("log", n, "held"), "pull_request_id": pr["id"], "key": pr["key"], "sha": pr["head_sha"], "action": "held", "how": None, "conditions": [], "by": "user-tom", "at": at(days=days + 0.05), "note": note, "sample": True})
        LOG.append({"id": uid("log", n, "unheld"), "pull_request_id": pr["id"], "key": pr["key"], "sha": pr["head_sha"], "action": "unheld", "how": None, "conditions": [], "by": "user-tom", "at": at(days=days + 0.01), "note": None, "sample": True})
p1197 = next(p for p in PRS if p["number"] == 1197)
LOG.append({"id": uid("log", 1197, "held"), "pull_request_id": p1197["id"], "key": p1197["key"], "sha": p1197["head_sha"], "action": "held", "how": None, "conditions": [], "by": "user-mei", "at": at(days=2.7), "note": "wanted to read it once more", "sample": True})
for pr in PRS:
    if pr["merge_state"] == "merging":
        LOG.append({"id": uid("log", pr["number"], "merging"), "pull_request_id": pr["id"], "key": pr["key"], "sha": pr["head_sha"], "action": "merging", "how": "auto", "conditions": [], "by": None, "at": pr["waits_since"], "note": None, "sample": True})

# acme/api watches first: what would have merged there this week, and what a person did.
for repo, n, title, author, paths, a, d, days, later_min, held in [
    ("acme/api", 1192, "Update the API changelog for 4.2", "mei", ["docs/changelog.md"], 14, 2, 1.0, 34, None),
    ("acme/api", 1190, "Bump httpx and 2 dev packages", "acme-deps[bot]", ["uv.lock"], 30, 28, 1.6, 900, None),
    ("acme/api", 1188, "Fix the example request in the auth docs", "tom", ["docs/auth.md"], 3, 3, 2.0, 120, None),
    ("acme/api", 1187, "Typo in the webhook docs", "ravi", ["docs/webhooks.md"], 1, 1, 2.4, 47, None),
    ("acme/api", 1184, "Bump pytest to 8.4", "acme-deps[bot]", ["uv.lock"], 8, 8, 3.1, 52, None),
    ("acme/api", 1183, "Reword the rate limit error page", "mei", ["docs/errors.md"], 6, 6, 3.8, 31, None),
    ("acme/api", 1182, "Add the 4.1 deprecations to the docs", "tom", ["docs/deprecations.md"], 22, 0, 4.4, 75, None),
    ("acme/api", 1181, "Bump ruff to 0.8", "acme-deps[bot]", ["uv.lock"], 4, 4, 5.0, 20, None),
    ("acme/api", 1179, "Clarify the pagination docs", "ravi", ["docs/pagination.md"], 9, 7, 5.6, None, "asked for an example first"),
]:
    kind = "bot" if author.endswith("[bot]") else "member"
    state = "merged" if later_min is not None else "open"
    pid, rs, ss = add_pr(repo, n, title, author, kind=kind, paths=paths, add=a, dele=d, state=state,
                         merged_days=(days - later_min / 1440) if later_min is not None else None, opened_days=days + 0.1,
                         waits_on="user-mei" if state == "open" else None, waits_for="merge" if state == "open" else None, waits_min=days * 1440,
                         merge_state="would_merge" if state == "open" else None, summary=f"{title}.")
    LOG.append({"id": uid("log", n, "would"), "pull_request_id": pid, "key": f"{repo}#{n}", "sha": ss[-1], "action": "would_merge", "how": "auto",
                "conditions": [{"name": c, "ok": True, "detail": None} for c in ["paths", "size", "rules", "findings", "risk", "author", "checks", "mergeable", "gate"]],
                "by": None, "at": at(days=days), "note": None, "sample": True})
    if held:
        LOG.append({"id": uid("log", n, "held"), "pull_request_id": pid, "key": f"{repo}#{n}", "sha": ss[-1], "action": "held", "how": None, "conditions": [], "by": "user-mei", "at": at(days=days - 0.02), "note": held, "sample": True})
    elif later_min is not None:
        LOG.append({"id": uid("log", n, "person"), "pull_request_id": pid, "key": f"{repo}#{n}", "sha": ss[-1], "action": "person_merged", "how": "squash", "conditions": [], "by": "user-mei", "at": at(days=days - later_min / 1440), "note": None, "sample": True})

# Kept for a person this week, and why.
for i, (reason, count) in enumerate([("risk", 11), ("rules", 6), ("size", 4), ("gate_files", 2)]):
    for j in range(count):
        pr = PRS[(i * 7 + j) % len(PRS)]
        LOG.append({"id": uid("log", "refused", reason, j), "pull_request_id": pr["id"], "key": pr["key"], "sha": pr["head_sha"], "action": "refused", "how": None,
                    "conditions": [{"name": reason, "ok": False, "detail": None}], "by": None, "at": at(days=0.5 + j * 0.4), "note": None, "sample": True})

# Older history, so each rule's record is what reviews did with it.
OLD = []
for k in range(24):
    repo = "acme/api" if k % 2 else "acme/web"
    n = 1150 + k
    paths = ["billing/charges.py", "api/views.py", "web/Page.tsx", "migrations/0080_x.py", "jobs/run.py"][k % 5:k % 5 + 2]
    pid, rs, ss = add_pr(repo, n, f"Earlier change {n}", ["ravi", "mei", "tom", "asha"][k % 4], paths=paths, add=20 + k, dele=k, state="merged", merged_days=9 + k, opened_days=10 + k, summary="")
    OLD.append((pid, rs[-1], f"{repo}#{n}"))

RECORD = {  # rule: (fixed, dismissed, of them this week)
    "idem": (5, 1, 2), "log": (2, 0, 0), "mignum": (2, 0, 0), "openapi": (3, 2, 2), "test": (7, 4, 1), "case": (5, 3, 1), "early": (2, 11, 1),
    "roles": (2, 0, 0), "backoff": (1, 1, 0), "batch": (2, 1, 0), "env": (3, 0, 0), "trace": (1, 0, 0), "money": (2, 0, 0), "states": (2, 1, 0), "iso": (1, 2, 0), "hook5": (1, 0, 0),
    "doc": (1, 9, 0),
}
i = 0
for key, (fixed, dismissed, week) in RECORD.items():
    for j in range(fixed + dismissed):
        pid, rid, k = OLD[i % len(OLD)]
        i += 1
        recent = j < week
        finding(pid, k, rid, rid, key, RULE_ROW[R[key]]["severity"], "src/x.py", 10 + j, f"{RULE_ROW[R[key]]['text'][:40]} ({j})", "Raised in an earlier round.",
                state="fixed" if j < fixed else "dismissed", fixed_in=sha("old", key, j) if j < fixed else None, decided_by=None if j < fixed else "user-tom",
                created_min=(2 + j) * 1440 if recent else (9 + j) * 1440, slug=f"old-{key}-{j}")

# Not checked: the migration rule, on every round that touched migrations/**.
for r in ROUNDS:
    if r["status"] == "done" and not any(e["rule_id"] == R["migcopy"] for e in (r["ledger"] or [])) and any(f["path"].startswith("migrations/") for f in r["files"]):
        r["ledger"].append({"rule_id": R["migcopy"], "text": RULE_ROW[R["migcopy"]]["text"], "state": "not_checked", "note": "the review has no database to run them on", "finding_ids": []})

SETTINGS = {
    "id": uid("settings"), "posts_as": "bot", "check_on": True, "comments": "off", "approve_when_clean": False,
    "merge": {"paths": ["docs/**", "web/copy/**", "**/package-lock.json", "**/uv.lock"], "max_lines": 40, "max_files": 5, "wait_minutes": 10, "how": "auto",
              "approve_first": True, "allow_no_checks": False, "update_bots": ["acme-deps[bot]"], "update_branch_prefix": "deps/"},
    "daily_cap": 60, "daily_merge_cap": 20, "paused": False, "app_url": None, "platform": {"app": "ok", "checks": "ok", "at": at(hours=1)},
    "schedules": {}, "schedule_user_id": ME, "accept_file_rules": False, "setup_done_at": at(days=14), "setup_by": ME, "sample": True,
    "created_at": at(days=14), "updated_at": at(hours=1),
}

MEMBERS = [{"id": uid("member", p["login"]), "login": p["login"], "user_id": p["user_id"], "name": p["name"], "owns": p["owns"], "reviews": True, "sample": True, "created_at": at(days=14)} for p in PEOPLE]
RISK = [
    {"id": uid("risk", "billing"), "glob": "billing/**", "repo": None, "tier": "high", "reason": "money moves here", "reviewer_user_id": ME, "reviewer_name": "Asha Rao", "state": "active", "sample": True},
    {"id": uid("risk", "migrations"), "glob": "migrations/**", "repo": "acme/api", "tier": "high", "reason": "schema changes", "reviewer_user_id": "user-mei", "reviewer_name": "Mei Lin", "state": "active", "sample": True},
    {"id": uid("risk", "auth"), "glob": "api/auth/**", "repo": "acme/api", "tier": "high", "reason": "sign-in and sessions", "reviewer_user_id": "user-ravi", "reviewer_name": "Ravi Kumar", "state": "active", "sample": True},
    {"id": uid("risk", "infra"), "glob": "infra/**", "repo": None, "tier": "medium", "reason": "proposed from CODEOWNERS", "reviewer_user_id": None, "reviewer_name": None, "state": "proposed", "sample": True},
]
TASKS = []  # made by Fix it in the demo


def answer(rows: list[dict]) -> dict:
    return {"items": rows, "total": len(rows), "limit": len(rows), "next_page_token": None}


def main() -> None:
    q = [
        {"match": "from prr_settings", "response": answer([SETTINGS])},
        {"match": "from repository", "response": answer(sorted(REPOS.values(), key=lambda r: r["full_name"]))},
        {"match": "from pull_request", "response": answer(sorted(PRS, key=lambda p: p["updated_at"] or "", reverse=True))},
        {"match": "from prr_round", "response": answer(sorted(ROUNDS, key=lambda r: r["created_at"], reverse=True))},
        {"match": "from prr_finding", "response": answer(sorted(FINDINGS, key=lambda f: f["created_at"], reverse=True))},
        {"match": "from prr_rule", "response": answer(RULES)},
        {"match": "from prr_member", "response": answer(MEMBERS)},
        {"match": "from prr_risk_path", "response": answer(RISK)},
        {"match": "from prr_merge_log", "response": answer(sorted(LOG, key=lambda l: l["at"], reverse=True))},
        {"match": "from task", "response": answer(TASKS)},
    ]
    (FIX / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (FIX / "pod" / "datastore" / "query.json").write_text(json.dumps(q, indent=1) + "\n")
    (FIX / "pod.json").write_text(json.dumps({"id": "pod", "name": "Acme engineering", "organization_id": "org"}) + "\n")
    members = [{"pod_member_id": f"member-{p['login']}", "user_id": p["user_id"], "user_name": p["name"], "user_email": p["email"], "email": p["email"],
                "roles": ["POD_ADMIN"] if p["user_id"] == ME else ["POD_EDITOR"]} for p in PEOPLE]
    (FIX / "pod" / "members.json").write_text(json.dumps({"items": members, "total": len(members)}, indent=1) + "\n")
    GH["repos"] = [{"full_name": n, "default_branch": "main", "private": True, "id": int(r["source_id"])} for n, r in REPOS.items()] + [
        {"full_name": "acme/mobile", "default_branch": "main", "private": True, "id": 780013}, {"full_name": "acme/infra", "default_branch": "main", "private": True, "id": 780014}]
    GH["anchor"] = ANCHOR.strftime("%Y-%m-%dT%H:%M:%SZ")
    demo = LEMMA / "demo.js"
    text = demo.read_text()
    new = re.sub(r"/\* GITHUB \*/.*?/\* END GITHUB \*/", lambda _: "/* GITHUB */ " + json.dumps(GH, separators=(",", ":")) + " /* END GITHUB */", text, flags=re.S)
    demo.write_text(new)
    print(f"{len(PRS)} pull requests, {len(ROUNDS)} rounds, {len(FINDINGS)} findings, {len(RULES)} rules, {len(LOG)} merge log rows")


if __name__ == "__main__":
    main()
