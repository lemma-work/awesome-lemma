#input_type_name: DepsOnGithubInput
#output_type_name: DepsOnGithubResult
#function_name: deps_on_github

"""What GitHub says about a pull request the Lemma opened: the target of the
three WEBHOOK schedules set-up makes (workflows deps-on-pull-request,
deps-on-check-suite, deps-on-review).

  pull_request         opened, reopened, closed or synchronize on a
                       `lemma/deps-*` (or `deps/*`) branch, or one labelled
                       `dependencies`: its state, head, merged; merged
                       updates become `merged`, a pull request closed
                       unmerged sends its updates back to `ready`
  check_suite          completed: the checks on its head, passed or failed
  pull_request_review  submitted: approved, changes requested or commented,
                       and the review's words

Only watched repositories (deps_repo) count. The payload is GitHub's: what
people wrote in it is read as text, never followed.
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

PASSED = ("success", "neutral", "skipped")
FAILED = ("failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale")


class DepsOnGithubInput(BaseModel):
    event: str
    payload: dict | None = None


class DepsOnGithubResult(BaseModel):
    batch_id: str | None = None
    changed: list[str] = []
    message: str


def _ours(pr: dict) -> bool:
    ref = str(((pr.get("head") or {}).get("ref")) or "")
    labels = {str((x or {}).get("name") or "").lower() for x in (pr.get("labels") or [])}
    return ref.startswith(("lemma/deps-", "lemma/deps/", "deps/", "lemma/security-")) or "dependencies" in labels


def _find(pod, repo: str, number=None, branch=None, sha=None) -> dict | None:
    where = [f"LOWER(repo) = {lit(repo.lower())}"]
    ors = []
    if number:
        ors.append(f"pr_number = {int(number)}")
    if branch:
        ors.append(f"branch = {lit(branch)}")
    if sha:
        ors.append(f"head_sha = {lit(sha)}")
    if not ors:
        return None
    found = q(pod, f"SELECT * FROM deps_batch WHERE {where[0]} AND ({' OR '.join(ors)}) ORDER BY created_at DESC LIMIT 1")
    return found[0] if found else None


def _step(batch: dict, kind: str, text: str, ok: bool = True, at: str | None = None) -> list:
    steps = [x for x in jlist(batch.get("steps")) if isinstance(x, dict)]
    item = {"at": at or now_iso(), "kind": kind, "text": cut(text, 600), "ok": ok}
    if not any(x.get("text") == item["text"] and x.get("at") == item["at"] for x in steps):
        steps.append(item)
    steps.sort(key=lambda x: str(x.get("at") or ""))
    return steps[-200:]


def deps_on_github(ctx: FunctionContext, data: DepsOnGithubInput) -> DepsOnGithubResult:
    pod = ctx.pod
    p = data.payload or {}
    event = (data.event or "").strip()
    repo = str((p.get("repository") or {}).get("full_name") or "")
    if not repo:
        return DepsOnGithubResult(message="No repository in the event.")
    watched = q(pod, f"SELECT id, repo FROM deps_repo WHERE LOWER(repo) = {lit(repo.lower())} AND active = true LIMIT 1")
    if not watched:
        return DepsOnGithubResult(message=f"{repo} isn't watched.")
    repo = watched[0]["repo"]
    action = str(p.get("action") or "")
    changed: list[str] = []

    if event == "pull_request":
        pr = p.get("pull_request") or {}
        if not _ours(pr):
            return DepsOnGithubResult(message="Not a dependency pull request.")
        number = pr.get("number")
        branch = (pr.get("head") or {}).get("ref")
        batch = _find(pod, repo, number, branch)
        if not batch:
            if action not in ("opened", "reopened", "labeled"):
                return DepsOnGithubResult(message=f"#{number} isn't one the Lemma recorded.")
            bid = batch_id(repo, branch)
            kind = "security" if "security" in str(branch) else "batch"
            pod.records.bulk_create("deps_batch", [{"id": bid, "repo": repo, "branch": cut(branch, 200), "kind": kind,
                                                    "pr_number": number, "state": "open", "title": cut(pr.get("title"), 300)}],
                                    upsert=True)
            batch = {"id": bid, "repo": repo, "branch": branch, "steps": []}
        patch: dict = {"pr_number": number, "pr_url": cut(pr.get("html_url"), 400),
                       "head_sha": cut((pr.get("head") or {}).get("sha"), 64)}
        if pr.get("title"):
            patch["title"] = cut(pr["title"], 300)
        if action == "closed" and pr.get("merged"):
            by = ((pr.get("merged_by") or {}).get("login")) or "someone"
            patch.update(state="merged", merged_at=pr.get("merged_at") or now_iso(), merged_by=cut(by, 200))
            patch["steps"] = _step(batch, "merge", f"Merged by {by}.", at=pr.get("merged_at"))
            ups = q(pod, f"SELECT id FROM deps_update WHERE batch_id = {lit(batch['id'])} AND state IN ('in_batch', 'opened')")
            if ups:
                pod.records.bulk_update("deps_update", [{"id": u["id"], "state": "merged", "why": f"Merged in #{number}"} for u in ups])
            changed.append(f"merged, {len(ups)} update{'s' if len(ups) != 1 else ''}")
        elif action == "closed":
            patch["state"] = "closed"
            patch["steps"] = _step(batch, "note", "Closed without merging. Its updates go back to the next batch.", ok=False,
                                   at=pr.get("closed_at"))
            ups = q(pod, f"SELECT id FROM deps_update WHERE batch_id = {lit(batch['id'])} AND state IN ('in_batch', 'opened')")
            if ups:
                pod.records.bulk_update("deps_update", [{"id": u["id"], "state": "ready", "why": f"#{number} was closed without merging"}
                                                        for u in ups])
            changed.append("closed")
        elif action == "synchronize":
            patch.update(state="open", checks="running")
            patch["steps"] = _step(batch, "push", f"New commits on {branch}; checks running again.")
            changed.append("new commits")
        elif action in ("opened", "reopened"):
            patch["state"] = "open"
            patch["opened_at"] = batch.get("opened_at") or pr.get("created_at") or now_iso()
            changed.append(action)
        pod.records.update("deps_batch", batch["id"], patch)
        return DepsOnGithubResult(batch_id=batch["id"], changed=changed, message=f"#{number}: {', '.join(changed) or 'noted'}.")

    if event == "check_suite":
        suite = p.get("check_suite") or {}
        if action != "completed":
            return DepsOnGithubResult(message=f"check_suite {action}: waiting for it to complete.")
        sha = suite.get("head_sha")
        numbers = [x.get("number") for x in (suite.get("pull_requests") or []) if isinstance(x, dict)]
        batch = _find(pod, repo, numbers[0] if numbers else None, suite.get("head_branch"), sha)
        if not batch:
            return DepsOnGithubResult(message="Not a pull request the Lemma opened.")
        if batch.get("head_sha") and sha and batch["head_sha"] != sha:
            return DepsOnGithubResult(batch_id=batch["id"], message="Checks on an older commit; kept the newest.")
        conclusion = str(suite.get("conclusion") or "")
        state = "passed" if conclusion in PASSED else ("failed" if conclusion in FAILED else "running")
        app = ((suite.get("app") or {}).get("name")) or "Checks"
        runs = [x for x in jlist(batch.get("check_runs")) if isinstance(x, dict) and x.get("name") != app]
        runs.append({"name": app, "state": state})
        overall = "failed" if any(x.get("state") == "failed" for x in runs) else (
            "running" if any(x.get("state") == "running" for x in runs) else "passed")
        patch = {"checks": overall, "check_runs": runs, "head_sha": cut(sha, 64) if sha else batch.get("head_sha"),
                 "steps": _step(batch, "checks", f"{app}: {'passed' if state == 'passed' else ('failed' if state == 'failed' else conclusion or 'done')}.",
                                ok=state != "failed", at=suite.get("updated_at"))}
        pod.records.update("deps_batch", batch["id"], patch)
        return DepsOnGithubResult(batch_id=batch["id"], changed=[f"checks {overall}"], message=f"{app}: {state}.")

    if event == "pull_request_review":
        review = p.get("review") or {}
        pr = p.get("pull_request") or {}
        if action != "submitted":
            return DepsOnGithubResult(message=f"review {action}: nothing to keep.")
        if not _ours(pr):
            return DepsOnGithubResult(message="Not a dependency pull request.")
        batch = _find(pod, repo, pr.get("number"), (pr.get("head") or {}).get("ref"))
        if not batch:
            return DepsOnGithubResult(message="Not a pull request the Lemma opened.")
        raw = str(review.get("state") or "").lower()
        verdict = {"approved": "approved", "changes_requested": "changes", "commented": "commented"}.get(raw, "commented")
        body = (review.get("body") or "").strip()
        by = ((review.get("user") or {}).get("login")) or "someone"
        notes = int(batch.get("review_notes") or 0) + (1 if body else 0)
        words = {"approved": "approved", "changes": "asked for changes", "commented": "commented"}[verdict]
        patch = {"review": verdict if not (batch.get("review") == "approved" and verdict == "commented") else "approved",
                 "review_notes": notes, "review_by": cut(by, 200),
                 "steps": _step(batch, "review", f"Reviewed by {by}: {words}" + (f", {notes} note{'s' if notes != 1 else ''}." if notes else "."),
                                ok=verdict != "changes", at=review.get("submitted_at"))}
        if body:
            patch["review_text"] = cut(body, 600)
        pod.records.update("deps_batch", batch["id"], patch)
        return DepsOnGithubResult(batch_id=batch["id"], changed=[f"review {verdict}"], message=f"Review: {words}.")

    return DepsOnGithubResult(message=f"{event or 'That event'} isn't one Dependency updates keeps.")
