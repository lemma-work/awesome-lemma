#input_type_name: DepsRecordInput
#output_type_name: DepsRecordResult
#function_name: deps_record

"""The deps-updater agent's one writer: everything a run found and did, in
Dependency updates' own tables, and what needs the owner in Today.

One call may carry any of:

  repo_facts   the repository's managers and commands, and whether it installs
  updates      candidate updates, each upserted by (repo, ecosystem, package,
               to_version); a newer version supersedes an older open one
  batch        the pull request the run is preparing or opened, upserted by
               (repo, branch), with `steps` appended to its timeline and
               `commits` naming each update's commit
  platform     what the platform allowed when the run tried: a time schedule
               starting in a checkout, pushing workflow files, Dependabot
               alerts, the alert event, check runs (yes or no, with a note)

Guards it keeps whatever the agent sends:
  - an ignore (deps_ignore) covering an update makes it `ignored`, except a
    security fix;
  - a person's choice stands: an update someone added to Monday, let through
    or asked for on its own is not held again for the same version;
  - text is cut to its column; unknown states are refused, not guessed.

Runs as the person the run is for (the owner, for scheduled runs). Items in
Today are written only when that person is the owner (needs_you is each
member's own).
"""

from __future__ import annotations

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

UPDATE_TEXT = {"why": 300, "lemma_read": 1200, "read_from": 200, "tried_note": 300, "manager": 20,
               "from_version": 64, "commit_sha": 64, "fix_sha": 64}
UPDATE_JSON = ("changes", "uses", "security", "risk")
BATCH_TEXT = {"title": 300, "base_branch": 200, "pr_url": 400, "head_sha": 64, "review_by": 200, "review_text": 600,
              "merged_by": 200}
BATCH_ENUMS = {"kind": ("batch", "security", "own"), "state": ("preparing", "open", "merged", "closed", "failed"),
               "checks": ("running", "passed", "failed", "none"), "review": ("approved", "changes", "commented", "none")}
STEP_KINDS = ("start", "read", "hold", "install", "test", "halve", "fix", "build", "push", "open", "checks", "review",
              "comment", "drop", "merge", "note", "security")
PERSON_CHOICES = ("monday", "own", "let_through", "take_now", "put_back")


class DepsRecordInput(BaseModel):
    repo: str
    # weekly, security, comment, own, first: what kind of run this is.
    run_kind: str = "weekly"
    repo_facts: dict | None = None
    updates: list[dict] = []
    batch: dict | None = None
    steps: list[dict] = []
    platform: dict | None = None
    # One line for the repository's last run ("3 updates ready, 1 held").
    note: str | None = None


class DepsRecordResult(BaseModel):
    updates: int
    batch_id: str | None = None
    refused: list[str] = []
    needs_you: dict | None = None
    message: str


def _repo_row(pod, repo: str) -> dict | None:
    found = q(pod, f"SELECT * FROM deps_repo WHERE LOWER(repo) = {lit(repo.lower())} LIMIT 1")
    return found[0] if found else None


def _facts(pod, repo: str, row: dict | None, facts: dict, note: str | None) -> str:
    patch: dict = {"last_run_at": now_iso()}
    if note:
        patch["last_run_note"] = cut(note, 400)
    for key in ("install_cmd", "test_cmd", "build_cmd", "default_branch"):
        if key in facts and facts[key] is not None:
            patch[key] = cut(facts[key], 400 if key.endswith("_cmd") else 200)
    if facts.get("managers") is not None:
        patch["managers"] = [str(m) for m in jlist(facts["managers"]) if m][:10]
    if facts.get("github_repo_id"):
        try:
            patch["github_repo_id"] = int(facts["github_repo_id"])
        except (TypeError, ValueError):
            pass
    status = facts.get("status")
    if status in REPO_STATUSES:
        changed = any(key in patch and (row or {}).get(key) != patch[key] for key in ("install_cmd", "test_cmd", "build_cmd"))
        if status == "needs_confirm" and row and row.get("commands_confirmed_by") and not changed:
            status = "ok"  # a person already confirmed these commands
        if status == "needs_confirm" and changed:
            patch["commands_confirmed_by"] = None
        patch["status"] = status
    if facts.get("status_note") is not None:
        patch["status_note"] = cut(facts["status_note"], 400)
    if row:
        pod.records.update("deps_repo", row["id"], patch)
        return row["id"]
    made = as_dict(pod.records.create("deps_repo", dict(patch, repo=repo, active=True, status=patch.get("status") or "new")))
    return str(made.get("id") or "")


def _platform(pod, s: dict, given: dict) -> None:
    current = dict(s.get("platform") or {})
    for key, value in (given or {}).items():
        if key not in PLATFORM_KEYS:
            continue
        value = value if isinstance(value, dict) else {"state": value}
        state = value.get("state") if value.get("state") in ("yes", "no", "unknown") else "unknown"
        current[key] = {"state": state, "note": cut(value.get("note"), 300), "at": now_iso()}
    patch: dict = {"platform": current}
    alerts = current.get("alerts", {}).get("state")
    if alerts in ("yes", "no"):
        patch["alerts"] = "github" if alerts == "yes" else "osv"
    if s.get("id"):
        pod.records.update("deps_settings", s["id"], patch)


def _steps(old, new: list) -> list:
    out = [x for x in jlist(old) if isinstance(x, dict)]
    seen = {(x.get("at"), x.get("text")) for x in out}
    for step in new or []:
        if not isinstance(step, dict) or not step.get("text"):
            continue
        clean = {"at": step.get("at") or now_iso(), "kind": step.get("kind") if step.get("kind") in STEP_KINDS else "note",
                 "text": cut(step["text"], 600), "ok": step.get("ok") is not False}
        if (clean["at"], clean["text"]) in seen:
            continue
        seen.add((clean["at"], clean["text"]))
        out.append(clean)
    out.sort(key=lambda x: str(x.get("at") or ""))
    return out[-200:]


def _batch(pod, repo: str, given: dict, steps: list, run_kind: str) -> str | None:
    branch = str(given.get("branch") or "").strip()
    if not branch:
        return None
    bid = batch_id(repo, branch)
    old = (q(pod, f"SELECT * FROM deps_batch WHERE id = {lit(bid)}") or [None])[0]
    row: dict = {"id": bid, "repo": repo, "branch": cut(branch, 200)}
    for key, n in BATCH_TEXT.items():
        if given.get(key) is not None:
            row[key] = cut(given[key], n)
    for key, allowed in BATCH_ENUMS.items():
        if given.get(key) in allowed:
            row[key] = given[key]
    if "kind" not in row and not old:
        row["kind"] = "security" if run_kind == "security" else ("own" if run_kind == "own" else "batch")
    for key in ("pr_number", "review_notes"):
        if given.get(key) is not None:
            try:
                row[key] = int(given[key])
            except (TypeError, ValueError):
                pass
    for key in ("week_of", "opened_at", "merged_at", "conversation_id"):
        if given.get(key):
            row[key] = given[key]
    for key in ("check_runs", "commits", "files"):
        if given.get(key) is not None:
            row[key] = jlist(given[key])[:200]
    if row.get("pr_number") and not row.get("state") and (not old or old.get("state") == "preparing"):
        row["state"] = "open"
    if row.get("state") == "open" and not (old or {}).get("opened_at") and not row.get("opened_at"):
        row["opened_at"] = now_iso()
    row["steps"] = _steps((old or {}).get("steps"), list(given.get("steps") or []) + list(steps or []))
    pod.records.bulk_create("deps_batch", [row], upsert=True)
    return bid


def _updates(pod, repo: str, given: list, s: dict, bid: str | None, batch: dict | None, refused: list) -> int:
    ignores = q(pod, "SELECT * FROM deps_ignore LIMIT 2000")
    commits = {}
    for c in jlist((batch or {}).get("commits")):
        if isinstance(c, dict):
            commits[str(c.get("package") or c.get("update_id") or "")] = c
    done = 0
    for raw in given or []:
        if not isinstance(raw, dict):
            continue
        eco, pkg, to = raw.get("ecosystem"), str(raw.get("package") or "").strip(), clean_version(raw.get("to_version"))
        if eco not in ECOSYSTEMS or not pkg or not to:
            refused.append(f"{pkg or '?'}: needs ecosystem (npm, pypi, actions), package and to_version")
            continue
        state = raw.get("state") or "waiting"
        if state not in STATES:
            refused.append(f"{pkg} {to}: state '{state}' is not one of {', '.join(STATES)}")
            continue
        uid = update_id(repo, eco, pkg, to)
        old = (q(pod, f"SELECT * FROM deps_update WHERE id = {lit(uid)}") or [None])[0]
        row: dict = {"id": uid, "repo": repo, "ecosystem": eco, "package": cut(pkg, 214), "to_version": cut(to, 64)}
        for key, n in UPDATE_TEXT.items():
            if raw.get(key) is not None:
                row[key] = cut(clean_version(raw[key]) if key == "from_version" else raw[key], n)
        for key in UPDATE_JSON:
            if raw.get(key) is not None:
                row[key] = raw[key] if key in ("security", "risk") else jlist(raw[key])[:40]
        row["bump"] = raw.get("bump") if raw.get("bump") in ("patch", "minor", "major") else bump_of(
            row.get("from_version") or (old or {}).get("from_version"), to)
        if raw.get("released_at"):
            row["released_at"] = raw["released_at"]
        for key in ("downloads_week", "touches", "pr_number"):
            if raw.get(key) is not None:
                try:
                    row[key] = int(raw[key])
                except (TypeError, ValueError):
                    pass
        if raw.get("tried") in ("none", "passed", "failed", "fixed"):
            row["tried"] = raw["tried"]
        security = jobj(row.get("security") if "security" in row else (old or {}).get("security"))
        # A person's choice stands for this version.
        if old and old.get("decided_at") and old.get("choice") in PERSON_CHOICES and state in ("needs_you", "risky", "waiting"):
            state = old.get("state") if old.get("state") not in ("needs_you", "risky") else "ready"
        # An ignore covers it, unless it fixes a security advisory.
        if state in OPEN_STATES and not security:
            ig = ignore_for(ignores, dict(row, bump=row["bump"]))
            if ig:
                state = "ignored"
                row["why"] = cut(f"Ignored: {ig.get('version_range')}" + (f" ({ig['reason']})" if ig.get("reason") else ""), 300)
        row["state"] = state
        if state in ("in_batch", "opened", "merged", "dropped") and bid:
            row["batch_id"] = bid
            if batch and batch.get("pr_number") and "pr_number" not in row:
                try:
                    row["pr_number"] = int(batch["pr_number"])
                except (TypeError, ValueError):
                    pass
        c = commits.get(pkg) or commits.get(uid)
        if c:
            if c.get("sha") and "commit_sha" not in row:
                row["commit_sha"] = cut(c["sha"], 64)
            if c.get("fix") and "fix_sha" not in row:
                row["fix_sha"] = cut(c["fix"], 64)
        pod.records.bulk_create("deps_update", [row], upsert=True)
        done += 1
        if state not in ("superseded", "merged"):
            older = q(pod, f"SELECT id, to_version FROM deps_update WHERE LOWER(repo) = {lit(repo.lower())} AND ecosystem = {lit(eco)} "
                           f"AND package = {lit(pkg)} AND id <> {lit(uid)} AND state IN ({lits(OPEN_STATES)})")
            stale = [o["id"] for o in older if newer(to, o.get("to_version"))]
            if stale:
                pod.records.bulk_update("deps_update", [{"id": i, "state": "superseded", "why": f"{pkg} {to} was found"} for i in stale])
    return done


def deps_record(ctx: FunctionContext, data: DepsRecordInput) -> DepsRecordResult:
    pod = ctx.pod
    repo = str(data.repo or "").strip().strip("/")
    if not _re.match(r"^[\w.-]+/[\w.-]+$", repo):
        return DepsRecordResult(updates=0, refused=[f"repo '{data.repo}' is not owner/name"], message="Nothing recorded.")
    s = settings_of(pod)
    row = _repo_row(pod, repo)
    repo = (row or {}).get("repo") or repo
    refused: list[str] = []
    if data.repo_facts or data.note or row is None:
        _facts(pod, repo, row, data.repo_facts or {}, data.note)
    elif row:
        pod.records.update("deps_repo", row["id"], {"last_run_at": now_iso()})
    if data.platform:
        _platform(pod, s, data.platform)
    bid = None
    if data.batch:
        bid = _batch(pod, repo, data.batch, data.steps, data.run_kind)
        if not bid:
            refused.append("batch: needs its branch")
    elif data.steps:
        # Steps without a batch: the newest batch of this repository.
        latest = q(pod, f"SELECT id, branch FROM deps_batch WHERE LOWER(repo) = {lit(repo.lower())} ORDER BY created_at DESC LIMIT 1")
        if latest:
            bid = _batch(pod, repo, {"branch": latest[0]["branch"]}, data.steps, data.run_kind)
    done = _updates(pod, repo, data.updates, s, bid, data.batch, refused)
    counts = write_needs(pod, ctx, settings_of(pod))
    bits = [f"{done} update{'s' if done != 1 else ''}"]
    if bid:
        bits.append("the pull request")
    if data.platform:
        bits.append("what the platform allowed")
    return DepsRecordResult(updates=done, batch_id=bid, refused=refused, needs_you=counts,
                            message="Recorded " + ", ".join(bits) + (f"; refused {len(refused)}" if refused else "") + ".")
