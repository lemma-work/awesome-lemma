#input_type_name: DepsSampleDataInput
#output_type_name: DepsSampleDataResult
#function_name: deps_sample_data

"""A sample week to look around with, or clear.

load: a made-up team's four repositories (northwind/web on pnpm, api on uv,
infra with GitHub Actions only, mobile behind a private registry) as of the
middle of a week: Monday's batch for web open and green after a halving and
one fix, api's batch merged, two security fixes opened the same day, two
majors waiting for the person loading it, a release held as risky, three
waiting out the wait, two ignored, and Actions updates to do by hand. The
platform is shown as v1 meets it before lemma-platform#1246: cloned by hand,
no workflow pushes, OSV for security, no check run.

clear: removes only the rows the sample made (deps_sample_row), closes its
items in Today, and forgets the sample's platform notes.

`build` makes the rows and is also what bin/demo-fixtures.py writes the
Try-it demo from, so the demo is this sample exactly.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# deps:common
# Shared by every Dependency updates function, word for word: bin/common.py
# copies it in. Edit it there, never here.
import json as _json
import re as _re
import uuid as _uuid
from datetime import datetime as _datetime, timedelta as _timedelta, timezone as _tz

DEPS_NS = _uuid.UUID("863c73f9-b46d-41f0-a465-489177755eb8")
SETTINGS_ID = str(_uuid.uuid5(DEPS_NS, "settings"))
PLUGIN = "dependency-updates"
APP = "dependencies"
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
ECOSYSTEMS = ("npm", "pypi", "actions")
STATES = ("waiting", "ready", "needs_you", "risky", "in_batch", "opened", "merged", "dropped", "by_hand",
          "ignored", "superseded")
# Still to happen: what an ignore, a newer version or a person's choice may change.
OPEN_STATES = ("waiting", "ready", "needs_you", "risky", "dropped", "by_hand")
PLATFORM_KEYS = ("repository_schedule", "workflows", "alerts", "alert_trigger", "checks")
REPO_STATUSES = ("new", "needs_confirm", "ok", "private_registry", "cant_install", "unsupported")


def update_id(repo: str, ecosystem: str, package: str, to_version: str) -> str:
    """One candidate update: the same row however often a run finds it."""
    return str(_uuid.uuid5(DEPS_NS, f"{repo.lower()}|{ecosystem}|{package}|{clean_version(to_version)}"))


def batch_id(repo: str, branch: str) -> str:
    return str(_uuid.uuid5(DEPS_NS, f"{repo.lower()}|{branch}"))


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


def now_iso() -> str:
    return _datetime.now(_tz.utc).isoformat()


def cut(value, n: int):
    """Text held to a column's length; None stays None."""
    if value is None:
        return None
    text = str(value).strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "\u2026"


def jlist(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip().startswith("["):
        try:
            got = _json.loads(value)
            return got if isinstance(got, list) else []
        except ValueError:
            return []
    return []


def jobj(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip().startswith("{"):
        try:
            got = _json.loads(value)
            return got if isinstance(got, dict) else {}
        except ValueError:
            return {}
    return {}


def stamp(value):
    if not value:
        return None
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def who(ctx) -> str:
    """The person a run is for, as their name."""
    return (getattr(ctx, "user_name", None) or (getattr(ctx, "user_email", None) or "").split("@")[0]
            or "Someone")


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM deps_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM deps_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["weekday"] = s.get("weekday") if s.get("weekday") in WEEKDAYS else "mon"
    s["run_time"] = s.get("run_time") or "06:00"
    s["timezone"] = s.get("timezone") or "UTC"
    s["wait_days"] = int(s.get("wait_days") if s.get("wait_days") is not None else 3)
    s["wait_major_days"] = int(s.get("wait_major_days") if s.get("wait_major_days") is not None else 14)
    s["hold_install_scripts"] = s.get("hold_install_scripts") is not False
    s["platform"] = jobj(s.get("platform"))
    s["schedule_ids"] = jobj(s.get("schedule_ids"))
    return s


def clean_version(value) -> str:
    """'v4', '^5.2.0', '==2.9.0' -> '4', '5.2.0', '2.9.0'."""
    text = str(value or "").strip()
    text = _re.sub(r"^(?:[=v^~<>! ]+)", "", text)
    return text


def parts(value) -> tuple:
    """A version's leading numbers: '3.25.76' -> (3, 25, 76); 'v5' -> (5,)."""
    out = []
    for piece in clean_version(value).split("."):
        m = _re.match(r"\d+", piece)
        if not m:
            break
        out.append(int(m.group(0)))
    return tuple(out)


def bump_of(from_version, to_version) -> str:
    """major, minor or patch: the first number that moved. 0.118 -> 0.121 is a minor."""
    a, b = parts(from_version), parts(to_version)
    if not a or not b:
        return "minor"
    for i in range(max(len(a), len(b))):
        x = a[i] if i < len(a) else 0
        y = b[i] if i < len(b) else 0
        if x != y:
            return "major" if i == 0 else ("minor" if i == 1 else "patch")
    return "patch"


def newer(a, b) -> bool:
    """a is a later version than b."""
    pa, pb = parts(a), parts(b)
    n = max(len(pa), len(pb))
    return pa + (0,) * (n - len(pa)) > pb + (0,) * (n - len(pb))


def in_range(update: dict, version_range) -> bool:
    """An ignore's range against an update: 'all', 'patches', 'minors',
    '19.x' (a major), '3.25.x', or an exact version."""
    rng = str(version_range or "").strip().lower()
    to = clean_version(update.get("to_version"))
    if rng in ("", "all", "*"):
        return True
    if rng in ("patch", "patches"):
        return (update.get("bump") or bump_of(update.get("from_version"), to)) == "patch"
    if rng in ("minor", "minors"):
        return (update.get("bump") or bump_of(update.get("from_version"), to)) in ("minor", "patch")
    if rng.endswith(".x") or rng.endswith(".*"):
        want = parts(rng[:-2])
        return bool(want) and parts(to)[: len(want)] == want
    return clean_version(rng) == to


def ignore_for(ignores: list, update: dict):
    """The ignore that covers this update, or None."""
    for ig in ignores:
        if (ig.get("package") or "") != (update.get("package") or ""):
            continue
        if ig.get("repo") and str(ig["repo"]).lower() != str(update.get("repo") or "").lower():
            continue
        if in_range(update, ig.get("version_range")):
            return ig
    return None


def major_of(version) -> str:
    p = parts(version)
    return str(p[0]) if p else clean_version(version)


def risk_words(risk: dict) -> str:
    """Why a release is held as risky, in a few words."""
    risk = jobj(risk)
    if risk.get("install_script"):
        return "adds an install script"
    if risk.get("new_publisher"):
        return "comes from a new publisher"
    if risk.get("age_hours") is not None and float(risk.get("age_hours") or 0) < 24:
        return "is hours old"
    return "looks risky"


def needs_items(pod, s: dict) -> list:
    """What Dependency updates asks of its owner, as needs_you items: one
    "decide" per held major and per risky release."""
    items = []
    for u in q(pod, "SELECT id, repo, package, from_version, to_version, bump, state, why, risk, updated_at FROM deps_update "
                    "WHERE state IN ('needs_you', 'risky') ORDER BY created_at LIMIT 200"):
        short = str(u.get("repo") or "").split("/")[-1]
        if u["state"] == "needs_you":
            title = f"{u['package']} {major_of(u['to_version'])}: add to Monday, its own PR, or not yet?"
            weight = 2
        else:
            title = f"{u['package']} {clean_version(u['to_version'])} {risk_words(u.get('risk'))}: let it through?"
            weight = 3
        items.append({
            "verb": "decide", "title": cut(title, 300),
            "why": cut(f"{short} \u00b7 {u.get('why') or (str(u.get('from_version') or '') + ' to ' + str(u['to_version']))}", 300),
            "source_table": "deps_update", "source_id": u["id"],
            "source_version": f"{u['state']}:{clean_version(u['to_version'])}",
            "app": APP, "path": f"/u/{u['id']}", "weight": weight,
        })
    return items


def write_needs(pod, ctx, s: dict):
    """The owner's items in Today, written only by the owner's own runs:
    needs_you is each member's own (RLS). Anyone else's run leaves them to
    the owner's next run or the owner's next open of the app."""
    me = str(getattr(ctx, "user_id", None) or "")
    owner = str(s.get("owner_user_id") or "")
    if not me or not owner or me != owner:
        return None
    return needs_you_write(pod, PLUGIN, me, needs_items(pod, s), None)
# end deps:common

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

SAMPLE_ZONE = "Europe/Berlin"
TABLES = ("deps_repo", "deps_batch", "deps_update", "deps_ignore", "deps_rule")


class DepsSampleDataInput(BaseModel):
    mode: str = "load"
    timezone: str | None = None


class DepsSampleDataResult(BaseModel):
    mode: str
    rows: int
    message: str


def _sid(*parts) -> str:
    return str(_uuid.uuid5(DEPS_NS, "sample:" + ":".join(str(p) for p in parts)))


def build(me, my_name: str, today: date, tz: str = SAMPLE_ZONE) -> dict:
    """The sample week's rows, as of `today` (a Wednesday reads best)."""
    zone = ZoneInfo(tz)
    monday = today - timedelta(days=today.weekday())
    if today.weekday() < 2:  # Monday's batch and Tuesday's fix must be past: the week before
        monday -= timedelta(days=7)
    now = datetime.combine(today, time(10, 0), zone)

    def at(day_offset: int, clock: str) -> str:
        h, m = (int(x) for x in clock.split(":"))
        return datetime.combine(monday + timedelta(days=day_offset), time(h, m), zone).astimezone(timezone.utc).isoformat()

    def ago(days: float = 0, hours: float = 0) -> str:
        return (now - timedelta(days=days, hours=hours)).astimezone(timezone.utc).isoformat()

    wd = (today - monday).days  # the batch was Monday, a security fix Tuesday, another today
    week = monday.isoformat()
    web, api, infra, mobile = "northwind/web", "northwind/api", "northwind/infra", "northwind/mobile"
    hand = "Cloned {repo} by hand at main {sha}: a time schedule can't start in a checkout yet."

    repos = [
        {"id": _sid("repo", web), "repo": web, "github_repo_id": 70100001, "default_branch": "main", "managers": ["pnpm"],
         "install_cmd": "pnpm install --frozen-lockfile", "test_cmd": "pnpm test", "build_cmd": "pnpm build", "status": "ok",
         "commands_confirmed_by": my_name, "last_run_at": at(min(1, wd), "07:04"), "last_run_note": "Security fix for next opened as #421",
         "active": True},
        {"id": _sid("repo", api), "repo": api, "github_repo_id": 70100002, "default_branch": "main", "managers": ["uv"],
         "install_cmd": "uv sync --frozen", "test_cmd": "uv run pytest", "build_cmd": None, "status": "ok",
         "commands_confirmed_by": my_name, "last_run_at": at(wd, "07:03"), "last_run_note": "Security fix for pyjwt opened as #77",
         "active": True},
        {"id": _sid("repo", infra), "repo": infra, "github_repo_id": 70100003, "default_branch": "main", "managers": ["actions"],
         "install_cmd": None, "test_cmd": None, "build_cmd": None, "status": "ok",
         "status_note": "GitHub Actions only: checked by CI on the pull request.", "commands_confirmed_by": my_name,
         "last_run_at": at(0, "06:02"), "last_run_note": "2 Actions updates to do by hand", "active": True},
        {"id": _sid("repo", mobile), "repo": mobile, "github_repo_id": 70100004, "default_branch": "main", "managers": ["npm"],
         "install_cmd": "npm ci", "test_cmd": "npm test", "build_cmd": None, "status": "private_registry",
         "status_note": "Can't install: @northwind/ui comes from a private registry. Updates are read, not tested.",
         "last_run_at": at(0, "06:03"), "last_run_note": "1 update read, not tested", "active": True},
    ]

    b_web = batch_id(web, f"lemma/deps-{week}")
    b_api = batch_id(api, f"lemma/deps-{week}")
    b_next = batch_id(web, "lemma/security-next-15.4.8")
    b_jwt = batch_id(api, "lemma/security-pyjwt-2.10.1")
    s = lambda when, kind, text, ok=True: {"at": when, "kind": kind, "text": text, "ok": ok}  # noqa: E731

    batches = [
        {"id": b_web, "repo": web, "kind": "batch", "title": f"Dependencies, week of {monday.day} {monday.strftime('%b')}",
         "week_of": week, "branch": f"lemma/deps-{week}", "base_branch": "main", "pr_number": 418,
         "pr_url": "https://github.com/northwind/web/pull/418", "state": "open", "head_sha": "e93b1c4", "checks": "passed",
         "check_runs": [{"name": "build", "state": "passed"}, {"name": "test", "state": "passed"},
                        {"name": "lint", "state": "passed"}, {"name": "e2e", "state": "passed"}],
         "review": "approved", "review_notes": 1, "review_by": "tbecker",
         "review_text": "The lockfile also moves 41 indirect packages; none of them add install scripts.",
         "opened_at": at(0, "06:13"),
         "commits": [{"package": "zod", "sha": "7be21d0", "fix": "a41c09e"}, {"package": "vite", "sha": "c0d93aa"},
                     {"package": "@types/node", "sha": "51e0b7f"}, {"package": "postcss", "sha": "0e6c14d"},
                     {"package": "prettier", "sha": "9f3a2b1"}, {"package": "@vitejs/plugin-react", "sha": "d7a1e55"},
                     {"package": "lucide-react", "sha": "3b8c0f2"}],
         "files": [{"path": "package.json", "additions": 7, "deletions": 7, "kind": "manifest"},
                   {"path": "pnpm-lock.yaml", "additions": 612, "deletions": 592, "kind": "lockfile"},
                   {"path": "src/forms/schema.ts", "additions": 1, "deletions": 1, "kind": "fix",
                    "patch": "@@ src/forms/schema.ts:18 @@\n-  const result = await schema.parseAsync(input);\n+  const result = await schema.safeParseAsync(input);"}],
         "steps": [
             s(at(0, "06:00"), "start", hand.format(repo=web, sha="4f1c2e9")),
             s(at(0, "06:01"), "read", "Read 11 changelogs. Held 3 out: two majors that need you, and one release that looks risky."),
             s(at(0, "06:03"), "install", "Installed 8 updates with pnpm, one commit per update."),
             s(at(0, "06:06"), "test", "pnpm test: 2 failed in src/forms/schema.test.ts.", False),
             s(at(0, "06:07"), "halve", "Tried the updates in halves, 3 test runs: zod 3.25.76 alone fails both tests."),
             s(at(0, "06:09"), "fix", "Fixed it: parseAsync to safeParseAsync in src/forms/schema.ts, commit a41c09e."),
             s(at(0, "06:12"), "test", "pnpm test: 412 passed. pnpm build: passed."),
             s(at(0, "06:13"), "open", "Opened this pull request as the Lemma's GitHub App, labelled dependencies. "
                                      "No check run: the App can't write checks yet, so the description says the same."),
             s(at(0, "06:21"), "checks", "GitHub Actions: build, test, lint and e2e passed."),
             s(at(0, "06:24"), "review", "Reviewed by tbecker: approved, 1 note."),
             s(at(0, "09:40"), "comment", "tbecker commented \"@lemma leave eslint for next week\". Dropped its commit."),
             s(at(0, "09:52"), "checks", "GitHub Actions: passed again with 7 updates."),
         ]},
        {"id": b_api, "repo": api, "kind": "batch", "title": f"Dependencies, week of {monday.day} {monday.strftime('%b')}",
         "week_of": week, "branch": f"lemma/deps-{week}", "base_branch": "main", "pr_number": 75,
         "pr_url": "https://github.com/northwind/api/pull/75", "state": "merged", "head_sha": "b71e0c2", "checks": "passed",
         "check_runs": [{"name": "test", "state": "passed"}, {"name": "lint", "state": "passed"}],
         "review": "approved", "review_notes": 0, "review_by": "aokafor", "opened_at": at(0, "06:05"),
         "merged_at": at(1, "11:02"), "merged_by": "aokafor",
         "commits": [{"package": "fastapi", "sha": "2c9e417"}, {"package": "pydantic", "sha": "f04a6d3"},
                     {"package": "sqlalchemy", "sha": "8b3d5e1"}],
         "files": [{"path": "pyproject.toml", "additions": 3, "deletions": 3, "kind": "manifest"},
                   {"path": "uv.lock", "additions": 148, "deletions": 141, "kind": "lockfile"}],
         "steps": [
             s(at(0, "06:00"), "start", hand.format(repo=api, sha="90d4a7e")),
             s(at(0, "06:01"), "read", "Read 4 changelogs. Left boto3 out: a rule takes it monthly."),
             s(at(0, "06:02"), "install", "Installed 3 updates with uv, one commit per update."),
             s(at(0, "06:04"), "test", "uv run pytest: 186 passed."),
             s(at(0, "06:05"), "open", "Opened this pull request as the Lemma's GitHub App, labelled dependencies."),
             s(at(0, "06:11"), "checks", "GitHub Actions: test and lint passed."),
             s(at(1, "10:47"), "review", "Reviewed by aokafor: approved."),
             s(at(1, "11:02"), "merge", "Merged by aokafor."),
         ]},
        {"id": b_next, "repo": web, "kind": "security", "title": "Security: next 15.4.8 (GHSA-7m27-4f2p-q9h3, high)",
         "week_of": week, "branch": "lemma/security-next-15.4.8", "base_branch": "main", "pr_number": 421,
         "pr_url": "https://github.com/northwind/web/pull/421", "state": "open", "head_sha": "5a0f9d2", "checks": "passed",
         "check_runs": [{"name": "build", "state": "passed"}, {"name": "test", "state": "passed"}],
         "review": "none", "review_notes": 0, "opened_at": at(1, "07:04"),
         "commits": [{"package": "next", "sha": "c4e81a7"}],
         "files": [{"path": "package.json", "additions": 1, "deletions": 1, "kind": "manifest"},
                   {"path": "pnpm-lock.yaml", "additions": 24, "deletions": 24, "kind": "lockfile"}],
         "steps": [
             s(at(1, "07:00"), "start", "Daily security run. " + hand.format(repo=web, sha="4f1c2e9")),
             s(at(1, "07:01"), "security", "OSV lists GHSA-7m27-4f2p-q9h3 (high) for next 15.4.6. Dependabot alerts can't be read yet."),
             s(at(1, "07:01"), "read", "Reached: yes. middleware.ts:12 uses the matcher the fix changes. The Lemma read the code; this is not a call graph."),
             s(at(1, "07:02"), "install", "Installed next 15.4.8 with pnpm."),
             s(at(1, "07:03"), "test", "pnpm test: 412 passed. pnpm build: passed."),
             s(at(1, "07:04"), "open", "Opened this pull request the same day, outside the batch and the wait."),
             s(at(1, "07:12"), "checks", "GitHub Actions: build and test passed."),
         ]},
        {"id": b_jwt, "repo": api, "kind": "security", "title": "Security: pyjwt 2.10.1 (GHSA-75c5-xw7c-p5pm, moderate)",
         "week_of": week, "branch": "lemma/security-pyjwt-2.10.1", "base_branch": "main", "pr_number": 77,
         "pr_url": "https://github.com/northwind/api/pull/77", "state": "open", "head_sha": "d2c4b90", "checks": "running",
         "check_runs": [{"name": "test", "state": "running"}, {"name": "lint", "state": "passed"}],
         "review": "none", "review_notes": 0, "opened_at": at(wd, "07:03"),
         "commits": [{"package": "pyjwt", "sha": "17ab9e3"}],
         "files": [{"path": "pyproject.toml", "additions": 1, "deletions": 1, "kind": "manifest"},
                   {"path": "uv.lock", "additions": 9, "deletions": 9, "kind": "lockfile"}],
         "steps": [
             s(at(wd, "07:00"), "start", "Daily security run. " + hand.format(repo=api, sha="90d4a7e")),
             s(at(wd, "07:01"), "security", "OSV lists GHSA-75c5-xw7c-p5pm (moderate) for pyjwt 2.9.0."),
             s(at(wd, "07:02"), "read", "Reach: not found. You only call jwt.decode with an algorithm list (app/auth/tokens.py:31). Opened anyway, the same day."),
             s(at(wd, "07:03"), "open", "Opened this pull request outside the batch and the wait. uv run pytest: 186 passed."),
         ]},
    ]

    def u(repo, eco, manager, pkg, frm, to, bump, released, state, **kw) -> dict:
        row = {"id": update_id(repo, eco, pkg, to), "repo": repo, "ecosystem": eco, "manager": manager, "package": pkg,
               "from_version": frm, "to_version": to, "bump": bump, "released_at": released, "state": state,
               "tried": "none", "changes": [], "uses": [], "touches": 0}
        row.update(kw)
        return row

    pnpm = ("npm", "pnpm")
    uv = ("pypi", "uv")
    updates = [
        # In Monday's batch for web, #418.
        u(web, *pnpm, "zod", "3.24.4", "3.25.76", "minor", ago(9), "opened", batch_id=b_web, pr_number=418,
          downloads_week=9800000, tried="fixed", tried_note="Failed 2 tests, then passed after one fix",
          why="Fixed in the batch: one call changed", read_from="GitHub releases",
          lemma_read="parseAsync is deprecated, and your test treats the warning as a failure. Switching the one call to safeParseAsync fixes it; that fix is its own commit.",
          changes=["parseAsync is deprecated in favour of safeParseAsync.", "Faster object parsing."],
          uses=[{"at": "src/forms/schema.ts:18", "line": "const result = await schema.parseAsync(input);"}], touches=1,
          commit_sha="7be21d0", fix_sha="a41c09e"),
        u(web, *pnpm, "vite", "7.1.4", "7.1.9", "patch", ago(12), "opened", batch_id=b_web, pr_number=418, downloads_week=14000000,
          tried="passed", why="Fixes only", read_from="CHANGELOG.md", lemma_read="Fixes only. Nothing you configure changed.",
          changes=["Five fixes in dev-server reload and CSS ordering."], commit_sha="c0d93aa"),
        u(web, *pnpm, "@types/node", "24.3.0", "24.6.2", "minor", ago(15), "opened", batch_id=b_web, pr_number=418,
          downloads_week=4100000, tried="passed", why="Types only", read_from="DefinitelyTyped", lemma_read="Types only.",
          changes=["Types for the Node 24.6 APIs."], commit_sha="51e0b7f"),
        u(web, *pnpm, "postcss", "8.5.6", "8.5.9", "patch", ago(20), "opened", batch_id=b_web, pr_number=418,
          downloads_week=21000000, tried="passed", why="Fixes only", read_from="CHANGELOG.md", lemma_read="Fixes only.",
          changes=["Two parser fixes."], commit_sha="0e6c14d"),
        u(web, *pnpm, "prettier", "3.6.2", "3.6.6", "patch", ago(10), "opened", batch_id=b_web, pr_number=418,
          downloads_week=3900000, tried="passed", why="No formatting changes on your files", read_from="CHANGELOG.md",
          lemma_read="No formatting changes on your files: the Lemma ran it over the repository and nothing moved.",
          changes=["Fixes in Markdown and CSS formatting."], commit_sha="9f3a2b1"),
        u(web, *pnpm, "@vitejs/plugin-react", "5.0.2", "5.0.4", "patch", ago(8), "opened", batch_id=b_web, pr_number=418,
          downloads_week=2700000, tried="passed", why="Fixes only", read_from="GitHub releases", lemma_read="Fixes only.",
          changes=["Fast Refresh fix for class components."], commit_sha="d7a1e55"),
        u(web, *pnpm, "lucide-react", "0.544.0", "0.548.0", "minor", ago(6), "opened", batch_id=b_web, pr_number=418,
          downloads_week=1600000, tried="passed", why="New icons; none renamed", read_from="GitHub releases",
          lemma_read="New icons; none renamed or removed.", changes=["Twelve new icons."], commit_sha="3b8c0f2"),
        u(web, *pnpm, "eslint", "9.36.0", "9.38.0", "minor", ago(18), "dropped", batch_id=b_web, pr_number=418,
          downloads_week=3000000, tried="passed", why="Left for next week, at a person's ask on #418",
          read_from="GitHub releases", lemma_read="Two new rules, both off unless you turn them on.",
          changes=["Two new rules, off by default.", "Faster config loading."], commit_sha="6d2f8e0", choice="drop",
          decided_by="tbecker", decided_at=at(0, "09:40")),
        # Ready for Monday.
        u(web, *pnpm, "@tanstack/react-query", "5.90.2", "5.90.5", "patch", ago(5), "ready", downloads_week=1900000,
          why="Out 5 days; joins Monday", read_from="GitHub releases", lemma_read="Fixes only.",
          changes=["Two fixes in query cancellation."]),
        u(api, *uv, "httpx", "0.28.0", "0.28.1", "patch", ago(6), "ready", why="Out 6 days; joins Monday",
          read_from="CHANGELOG.md", lemma_read="One fix in proxy handling. You don't set a proxy.",
          changes=["Fixes a proxy environment variable being read twice."]),
        u(api, *uv, "ruff", "0.14.0", "0.14.3", "patch", ago(9), "ready", why="Out 9 days; joins Monday",
          read_from="GitHub releases", lemma_read="New rules stay off: your configuration picks rule sets by name.",
          changes=["Three new preview rules.", "Faster import sorting."]),
        u(mobile, "npm", "npm", "react-native-svg", "15.12.1", "15.13.0", "minor", ago(7), "ready", downloads_week=1100000,
          why="Read, not tested: northwind/mobile can't install (private registry)", read_from="GitHub releases",
          lemma_read="Adds filter elements; nothing removed. It can't be tested here, so the pull request will say so.",
          changes=["Adds FeFlood and FeMerge filters."]),
        # Actions the App can't push yet.
        u(infra, "actions", "actions", "actions/cache", "4.2.3", "4.3.0", "minor", ago(16), "by_hand",
          why="Do by hand: the Lemma's GitHub App can't push workflow files yet", read_from="GitHub releases",
          lemma_read="Faster restores; nothing to change in how you call it.",
          changes=["Restores run in parallel.", "Node 24 runtime."],
          uses=[{"at": ".github/workflows/ci.yml:22", "line": "uses: actions/cache@v4.2.3"}], touches=1),
        u(infra, "actions", "actions", "docker/build-push-action", "6.15.0", "6.18.0", "minor", ago(24), "by_hand",
          why="Do by hand: the Lemma's GitHub App can't push workflow files yet", read_from="GitHub releases",
          lemma_read="Adds build summary options; your inputs are unchanged.",
          changes=["Build summaries in the job summary.", "Fixes cache export on retries."],
          uses=[{"at": ".github/workflows/release.yml:41", "line": "uses: docker/build-push-action@v6.15.0"}], touches=1),
        # Waiting for you.
        u(web, *pnpm, "react-router", "6.30.1", "7.9.4", "major", ago(21), "needs_you", downloads_week=2100000,
          tried="failed", tried_note="Tried once on a branch: 2 tests failed on the json() import",
          why="3 breaking changes; 1 touches you: src/routes.tsx:42", read_from="GitHub releases, the upgrade guide",
          lemma_read="One real change for you: the json() import in the routes file. The Lemma can make that change in the batch, as its own commit. Node is already 24 here.",
          changes=["Loaders and actions come from react-router, not react-router-dom.",
                   "json() and defer() are gone; return plain objects.", "Needs Node 20 or later."],
          uses=[{"at": "src/routes.tsx:42", "line": "import { json } from \"react-router-dom\";"}], touches=1),
        u(web, *pnpm, "tailwindcss", "3.4.17", "4.1.14", "major", ago(63), "needs_you", downloads_week=6000000,
          why="Config moves into CSS: tailwind.config.ts and 3 stylesheets", read_from="The upgrade guide",
          lemma_read="Worth its own pull request, with the official upgrade tool run first. Too big to slip into Monday.",
          changes=["Configuration moves from tailwind.config.ts into CSS.", "Some utilities are renamed."],
          uses=[{"at": "tailwind.config.ts:1", "line": "export default { content: [\"./src/**/*.tsx\"] }"},
                {"at": "src/styles/app.css:1", "line": "@tailwind base;"}], touches=4),
        # Waiting out the wait.
        u(web, *pnpm, "typescript", "5.9.3", "5.9.4", "patch", ago(1), "waiting", downloads_week=1100000,
          why="Out 1 day", read_from="GitHub releases", lemma_read="Two fixes in type narrowing.",
          changes=["Two fixes in type narrowing."]),
        u(api, *uv, "uvicorn", "0.38.0", "0.38.1", "patch", ago(2), "waiting", why="Out 2 days", read_from="Release notes",
          lemma_read="One fix for reload on macOS.", changes=["Fixes --reload on macOS."]),
        u(web, *pnpm, "react-hook-form", "7.66.0", "7.66.1", "patch", ago(0, 7), "waiting", downloads_week=820000,
          why="Out 7 hours", read_from="GitHub releases", lemma_read="One fix in field arrays.",
          changes=["Fixes a stale value in useFieldArray."]),
        # Held as risky.
        u(web, *pnpm, "color-convert", "3.1.0", "3.1.1", "patch", ago(0, 9), "risky", downloads_week=3000,
          why="Adds a postinstall script; published 9 hours ago by a new maintainer", read_from="npm registry",
          risk={"install_script": "postinstall", "new_publisher": True, "age_hours": 9,
                "note": "Published by a maintainer new to the package; adds a postinstall script; no changelog entry."},
          lemma_read="A patch with no notes that adds an install script, from a new publisher, hours old. Held until a person lets it through.",
          changes=["No changelog entry.", "Adds a postinstall script.", "Published by a maintainer new to the package."]),
        # Ignored.
        u(web, *pnpm, "@types/react", "18.3.12", "19.2.2", "major", ago(34), "ignored",
          why="Ignored: 19.x (Until the React 19 move)", read_from="DefinitelyTyped", lemma_read="Types for React 19."),
        u(api, *uv, "boto3", "1.40.61", "1.40.70", "patch", ago(1), "ignored", why="Ignored: patches (Daily releases; take them monthly)",
          read_from="Release notes", lemma_read="New service endpoints only."),
        # Security, opened the same day.
        u(web, *pnpm, "next", "15.4.6", "15.4.8", "patch", ago(3), "opened", batch_id=b_next, pr_number=421, downloads_week=4200000,
          tried="passed", why="Security fix, opened the same day", read_from="OSV, the release notes",
          security={"ghsa": "GHSA-7m27-4f2p-q9h3", "severity": "high", "summary": "Middleware matcher bypass", "source": "osv",
                    "reach": "yes", "reach_note": "middleware.ts:12 uses the matcher the fix changes.", "reach_at": at(1, "07:01")},
          lemma_read="Your middleware uses the affected matcher, so this opened the same day, outside the wait.",
          changes=["Fixes a middleware matcher bypass (high)."],
          uses=[{"at": "middleware.ts:12", "line": "export const config = { matcher: [\"/app/:path*\"] };"}], touches=3,
          commit_sha="c4e81a7"),
        u(api, *uv, "pyjwt", "2.9.0", "2.10.1", "minor", ago(30), "opened", batch_id=b_jwt, pr_number=77,
          tried="passed", why="Security fix, opened the same day", read_from="OSV",
          security={"ghsa": "GHSA-75c5-xw7c-p5pm", "severity": "moderate", "summary": "Tokens with no algorithm accepted",
                    "source": "osv", "reach": "not_found",
                    "reach_note": "You only call jwt.decode with an algorithm list.", "reach_at": at(wd, "07:02")},
          lemma_read="You always pass an algorithm list, so the attack path isn't reached. Opened anyway, the same day.",
          changes=["Rejects tokens signed with no algorithm unless asked."],
          uses=[{"at": "app/auth/tokens.py:31", "line": "jwt.decode(token, key, algorithms=[\"HS256\"])"}], touches=2,
          commit_sha="17ab9e3"),
        # Merged on Tuesday in api #75.
        u(api, *uv, "fastapi", "0.118.0", "0.121.1", "minor", ago(13), "merged", batch_id=b_api, pr_number=75, tried="passed",
          why="Merged in #75", read_from="Release notes", lemma_read="Adds a dependency caching option. No change needed.",
          changes=["Adds a dependency caching option."], commit_sha="2c9e417"),
        u(api, *uv, "pydantic", "2.11.9", "2.12.3", "minor", ago(22), "merged", batch_id=b_api, pr_number=75, tried="passed",
          why="Merged in #75", read_from="GitHub releases", lemma_read="Python 3.14 support; one deprecation you don't hit.",
          changes=["Python 3.14 support.", "Deprecates a config key you don't use."], commit_sha="f04a6d3"),
        u(api, *uv, "sqlalchemy", "2.0.43", "2.0.44", "patch", ago(16), "merged", batch_id=b_api, pr_number=75, tried="passed",
          why="Merged in #75", read_from="Changelog", lemma_read="Fixes only.", changes=["Fixes in the asyncio dialects."],
          commit_sha="8b3d5e1"),
    ]

    ignores = [
        {"id": _sid("ignore", web, "@types/react"), "repo": web, "package": "@types/react", "version_range": "19.x",
         "reason": "Until the React 19 move", "by_kind": "person", "by_name": "tbecker"},
        {"id": _sid("ignore", api, "boto3"), "repo": api, "package": "boto3", "version_range": "patches",
         "reason": "Daily releases; take them monthly", "by_kind": "rule", "by_name": "Take boto3 monthly."},
    ]
    rules = [{"id": _sid("rule", "boto3"), "text": "Take boto3 monthly.", "by_name": my_name, "active": True}]
    platform = {
        "repository_schedule": {"state": "no", "at": at(0, "06:00"),
                                "note": "A time schedule can't start in a checkout yet; each run clones by hand."},
        "workflows": {"state": "no", "at": at(0, "06:02"),
                      "note": "The GitHub App can't push workflow files yet; Actions updates are listed to do by hand."},
        "alerts": {"state": "no", "at": at(wd, "07:01"), "note": "Dependabot alerts answered 403; security fixes come from OSV, daily."},
        "alert_trigger": {"state": "no", "at": at(0, "06:00"), "note": "No Dependabot alert event yet; the daily run finds them."},
        "checks": {"state": "no", "at": at(0, "06:13"), "note": "No check run; the pull request description says the same."},
    }
    settings = {"id": SETTINGS_ID, "owner_user_id": me, "owner_name": my_name, "weekday": "mon", "run_time": "06:00",
                "timezone": tz, "wait_days": 3, "wait_major_days": 14, "hold_install_scripts": True, "alerts": "osv",
                "platform": platform, "setup_done_at": at(0, "05:00"), "sample": True}
    return {"deps_settings": [settings], "deps_repo": repos, "deps_batch": batches, "deps_update": updates,
            "deps_ignore": ignores, "deps_rule": rules}


def _clear(ctx) -> DepsSampleDataResult:
    pod = ctx.pod
    marks = q(pod, "SELECT id, table_name, row_id FROM deps_sample_row LIMIT 5000")
    removed = 0
    by: dict = {}
    for m in marks:
        by.setdefault(m["table_name"], []).append(m["row_id"])
    for table in ("deps_update", "deps_batch", "deps_ignore", "deps_rule", "deps_repo"):
        ids = by.get(table) or []
        for start in range(0, len(ids), 100):
            pod.records.bulk_delete(table, ids[start:start + 100])
            removed += len(ids[start:start + 100])
    ids = [m["id"] for m in marks]
    for start in range(0, len(ids), 100):
        pod.records.bulk_delete("deps_sample_row", ids[start:start + 100])
    s = settings_of(pod)
    if s.get("id"):
        pod.records.update("deps_settings", s["id"], {"sample": False, "platform": {}, "alerts": "osv"})
    # Its items leave Today: closed by the source.
    me = str(ctx.user_id) if ctx.user_id else ""
    if me:
        needs_you_write(pod, PLUGIN, me, needs_items(pod, settings_of(pod)) if me == str(s.get("owner_user_id") or "") else [], None)
    return DepsSampleDataResult(mode="clear", rows=removed, message=f"Cleared the sample week ({removed} rows).")


def deps_sample_data(ctx: FunctionContext, data: DepsSampleDataInput) -> DepsSampleDataResult:
    pod = ctx.pod
    if data.mode == "clear":
        return _clear(ctx)
    if q(pod, "SELECT id FROM deps_sample_row LIMIT 1"):
        return DepsSampleDataResult(mode="load", rows=0, message="The sample week is already here.")
    s = settings_of(pod)
    me = str(ctx.user_id) if ctx.user_id else None
    my_name = s.get("owner_name") if s.get("owner_user_id") and str(s.get("owner_user_id")) == me else who(ctx)
    tz = data.timezone or (s.get("timezone") if s.get("setup_done_at") else None) or SAMPLE_ZONE
    today = _datetime.now(_tz.utc).astimezone(ZoneInfo(tz) if tz else timezone.utc).date()
    built = build(me, my_name, today, tz)
    srow = built["deps_settings"][0]
    if s.get("setup_done_at"):
        # Keep the set-up; the sample brings its repositories and notes only.
        pod.records.update("deps_settings", s["id"], {"sample": True, "platform": srow["platform"], "alerts": "osv"})
    else:
        pod.records.bulk_create("deps_settings", [srow], upsert=True)
    marks = []
    for table in TABLES:
        batch = built[table]
        for start in range(0, len(batch), 100):
            pod.records.bulk_create(table, batch[start:start + 100], upsert=True)
        marks.extend({"table_name": table, "row_id": r["id"]} for r in batch)
    for start in range(0, len(marks), 100):
        pod.records.bulk_create("deps_sample_row", marks[start:start + 100])
    write_needs(pod, ctx, settings_of(pod))
    n = len(built["deps_update"])
    return DepsSampleDataResult(mode="load", rows=len(marks),
                                message=f"Loaded a sample week: 4 repositories, {n} updates, 4 pull requests.")
