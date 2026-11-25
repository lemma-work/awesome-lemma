#input_type_name: CodingTickInput
#output_type_name: CodingTickResult
#function_name: coding_tick

"""Every 15 minutes, on each member's own TIME schedule (`coding-tick-<first
8 of the user id>`, made by the app): look after the sessions the caller
started, which only they can read.

For each live session with a conversation (`conversations.get`):
  COMPLETED with no report   pr_open when it has a pull request, else done
  FAILED                     failed, with the run's error
  WAITING on the person      needs_you (question)
  STOPPED                    stopped
and the branch, from the worktree, when it is still missing.

For each open pull request (`pulls_get`, as the person): merged or closed;
`mergeable_state` dirty is a conflict, which GitHub sends no webhook for (keep
green asks the agent to merge the base in, within its tries); the head commit
and its checks (`checks_list_for_ref`), so a failure a webhook missed is
still fixed, once per commit, with the same ids the webhook would use.

Then writes the person's items in Today. Stops early rather than run long.
"""

from __future__ import annotations

import time

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# coding:common
# Shared by every Coding agent function, word for word: bin/common.py copies it in.
# Edit it there, never here.
import hashlib as _hashlib
import json as _json
import re as _re
import uuid as _uuid
from datetime import datetime as _datetime, timedelta as _timedelta, timezone as _tz

CODING_NS = _uuid.UUID("ec9afbce-870d-40ca-87dc-0e417991f415")
APP = "coding"
PLUGIN = "coding-agent"
BUILDER = "coding_builder"
ASKER = "coding_ask"
CLOUD = "system:lemma"
# A session is live while it can still change on its own.
LIVE = ("starting", "working", "needs_you", "pr_open")
FINISHED = ("merged", "done", "stopped", "failed")
# Where work came from, as the task says it.
SOURCES = ("coding-agent", "triage", "pr-review", "github", "tasks", "chat")
# A check that ended like this is a failure to fix.
FAILING = ("failure", "timed_out", "action_required", "startup_failure")
PASSING = ("success", "neutral", "skipped")


def cid(*parts) -> str:
    """A stable id from its parts."""
    return str(_uuid.uuid5(CODING_NS, ":".join(str(p) for p in parts)))


SETTINGS_ID = cid("settings")


def event_id(task_id, source, source_id) -> str:
    """An event's id: one per (task, where it came from, that source's own id).

    A webhook reaches every member's schedule, and GitHub sends some twice;
    the same delivery always makes the same id, so it is written once."""
    return cid("event", task_id, source, source_id)


def digest(text, n: int = 12) -> str:
    return _hashlib.sha256(str(text or "").encode()).hexdigest()[:n]


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
    """A datetime (UTC) from an ISO string or a datetime; None otherwise."""
    if not value:
        return None
    if isinstance(value, _datetime):
        return value if value.tzinfo else value.replace(tzinfo=_tz.utc)
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
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


def cut(text, n: int) -> str:
    """Like clip, keeping line breaks (for briefs and log tails)."""
    t = str(text or "").strip()
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def caller(ctx) -> dict:
    uid = str(ctx.user_id) if getattr(ctx, "user_id", None) else None
    name = getattr(ctx, "user_name", None) or (getattr(ctx, "user_email", None) or "").split("@")[0] or None
    return {"user_id": uid, "name": name, "email": getattr(ctx, "user_email", None)}


def settings_of(pod) -> dict:
    found = []
    try:
        found = q(pod, f"SELECT * FROM coding_settings WHERE id = {lit(SETTINGS_ID)}") or q(
            pod, "SELECT * FROM coding_settings ORDER BY created_at LIMIT 1")
    except Exception:  # noqa: BLE001 — a fresh Lemma: defaults
        found = []
    s = dict(found[0]) if found else {}
    s["default_profile_id"] = s.get("default_profile_id") or CLOUD
    s["keep_green"] = True if s.get("keep_green") is None else bool(s.get("keep_green"))
    s["max_tries"] = int(s.get("max_tries") or 3)
    s["issue_label"] = str(s.get("issue_label") or "lemma").strip()
    return s


def repos_of(pod, enabled_only: bool = True) -> list:
    where = "WHERE enabled = true " if enabled_only else ""
    return [dict(r) for r in q(pod, f"SELECT * FROM coding_repo {where}ORDER BY full_name LIMIT 500")]


def repo_row(pod, full_name) -> dict:
    found = q(pod, f"SELECT * FROM coding_repo WHERE LOWER(full_name) = LOWER({lit(full_name)}) LIMIT 1") if full_name else []
    return dict(found[0]) if found else {}


def owner_name(repo):
    owner, _, name = str(repo or "").partition("/")
    return owner, name


# github.example is the sample's made-up host: read like github.com, never called.
GITHUB_URL = _re.compile(r"https?://(?:www\.)?github\.(?:com|example)/([\w.-]+)/([\w.-]+)(?:/(issues|pull)/(\d+))?", _re.I)


def github_ref(url) -> dict:
    """{repo, kind (issues, pull or None), number} from a GitHub address; {} for anything else."""
    m = GITHUB_URL.match(str(url or "").strip())
    if not m:
        return {}
    name = m.group(2)[:-4] if m.group(2).lower().endswith(".git") else m.group(2)
    return {"repo": f"{m.group(1)}/{name}", "kind": m.group(3), "number": int(m.group(4)) if m.group(4) else None}


def branch_of(cwd) -> str | None:
    """The conversation's branch: its worktree is `.../<slug>`, its branch `lemma/<slug>`."""
    slug = str(cwd or "").rstrip("/").rsplit("/", 1)[-1]
    return f"lemma/{slug}" if slug and _re.fullmatch(r"[\w.-]+", slug) else None


def is_sha(ref) -> bool:
    return bool(_re.fullmatch(r"[0-9a-f]{7,40}", str(ref or ""), _re.I))


def pr_of_ref(ref) -> int | None:
    m = _re.fullmatch(r"(?:refs/)?pull/(\d+)/(?:head|merge)", str(ref or ""))
    return int(m.group(1)) if m else None


def base_of(ref, push_to, default_branch) -> str:
    """What to open the pull request against: the branch it started from, else the default branch."""
    if push_to:
        return push_to
    if ref and not is_sha(ref) and pr_of_ref(ref) is None and not str(ref).startswith("refs/tags/"):
        return str(ref).removeprefix("refs/heads/")
    return default_branch or "the default branch"


# ---------- GitHub, through the Lemma's connector (as the person running this) ----------

def gh(pod, op: str, payload: dict):
    """One GitHub call; the result's body."""
    result = as_dict(pod.connectors.execute("github", op, payload)).get("result")
    if isinstance(result, dict) and "data" in result and len(result) <= 3:
        return result["data"]
    return result


def gh_list(result, *keys) -> list:
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        for key in keys + ("items", "data", "result"):
            if isinstance(result.get(key), list):
                return result[key]
    return []


def gh_try(pod, op: str, payload: dict):
    """(result, None) or (None, why): for the calls a run goes on without."""
    try:
        return gh(pod, op, payload), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"[:300]


def pull(pod, repo: str, number: int) -> dict:
    owner, name = owner_name(repo)
    got, _ = gh_try(pod, "pulls_get", {"owner": owner, "repo": name, "pull_number": int(number)})
    return got if isinstance(got, dict) else {}


def pr_facts(pr: dict) -> dict:
    """The session columns a pulls_get answer gives."""
    out = {}
    head = pr.get("head") or {}
    if head.get("sha"):
        out["head_sha"] = str(head["sha"])
    for col, key in (("additions", "additions"), ("deletions", "deletions"), ("files_changed", "changed_files")):
        if isinstance(pr.get(key), int):
            out[col] = pr[key]
    state = pr.get("mergeable_state")
    if state == "dirty":
        out["mergeable"] = "conflict"
    elif state in ("clean", "unstable", "has_hooks", "blocked", "behind"):
        out["mergeable"] = "clean"
    if pr.get("merged") or pr.get("merged_at"):
        out["pr_state"] = "merged"
    elif pr.get("state") == "closed":
        out["pr_state"] = "closed"
    elif pr.get("state") == "open":
        out["pr_state"] = "open"
    return out


def latest_checks(runs: list) -> list:
    """GitHub lists every attempt; the newest run of each name is the one that counts."""
    best = {}
    for c in runs or []:
        if not isinstance(c, dict):
            continue
        name = str(c.get("name") or "")
        if name not in best or (c.get("id") or 0) > (best[name].get("id") or 0):
            best[name] = c
    return list(best.values())


def checks_state(runs: list) -> dict:
    """{state: running|passed|failed|none, text, failed: [names]} from a ref's check runs."""
    runs = latest_checks(runs)
    if not runs:
        return {"state": "none", "text": None, "failed": []}
    failed = [c for c in runs if c.get("conclusion") in FAILING]
    done = [c for c in runs if c.get("status") == "completed"]
    passed = [c for c in done if c.get("conclusion") in PASSING]
    if failed:
        names = [str(c.get("name")) for c in failed]
        return {"state": "failed", "failed": names,
                "text": clip(f"{len(failed)} of {len(runs)} failed: " + ", ".join(names), 600)}
    if len(done) < len(runs):
        return {"state": "running", "text": f"{len(passed)} of {len(runs)} passed", "failed": []}
    return {"state": "passed", "text": f"{len(runs)} of {len(runs)} passed", "failed": []}


def ref_checks(pod, repo: str, sha: str) -> dict:
    owner, name = owner_name(repo)
    got, why = gh_try(pod, "checks_list_for_ref", {"owner": owner, "repo": name, "ref": sha, "per_page": 100})
    if why:
        return {"state": "unknown", "text": None, "failed": []}
    return checks_state(gh_list(got, "check_runs"))


def log_tail(pod, repo: str, check: dict, lines: int = 40, chars: int = 3000) -> str | None:
    """The end of a GitHub Actions job's log, when it is cheap to get; None otherwise."""
    if str(((check.get("app") or {}).get("slug")) or "") not in ("github-actions", ""):
        return None
    job_id = check.get("id")
    if not job_id:
        return None
    owner, name = owner_name(repo)
    got, why = gh_try(pod, "actions_download_job_logs_for_workflow_run", {"owner": owner, "repo": name, "job_id": int(job_id)})
    if why or got is None:
        return None
    text = got if isinstance(got, str) else None
    if isinstance(got, dict):
        text = got.get("text") or got.get("content") or got.get("logs")
        url = got.get("url") or got.get("location") or got.get("Location")
        if not text and isinstance(url, str) and url.startswith("https://"):
            text = _fetch_text(url)
    if not isinstance(text, str) or not text.strip():
        return None
    kept = []
    for line in text.splitlines()[-lines * 3:]:
        line = _re.sub(r"^\d{4}-\d\d-\d\dT[\d:.]+Z\s?", "", line).rstrip()
        if line and not line.startswith("##[group]") and not line.startswith("##[endgroup]"):
            kept.append(line)
    return cut("\n".join(kept[-lines:]), chars) or None


def _fetch_text(url: str) -> str | None:
    """A log GitHub redirects to (a short-lived signed address): at most 2 MB, 6 seconds."""
    import urllib.parse as _parse
    import urllib.request as _request
    host = _parse.urlparse(url).hostname or ""
    if not (host.endswith(".githubusercontent.com") or host.endswith(".github.com") or host.endswith(".blob.core.windows.net")):
        return None
    try:
        with _request.urlopen(url, timeout=6) as response:  # noqa: S310 — https, GitHub's hosts only
            return response.read(2_000_000).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return None


# ---------- the platform: raw requests, conversations, runtimes ----------

def api(pod, method: str, path: str, body=None, params=None):
    """A request the vendored SDK has no method for; `path` after /pods/<id>."""
    kwargs = {}
    if params:
        kwargs["params"] = params
    if body is not None:
        kwargs["json"] = body
    return pod.request(method, f"/pods/{pod.pod_id}{path}", **kwargs)


def status_of(exc) -> int | None:
    return getattr(exc, "status_code", None) or getattr(exc, "status", None)


def not_there_yet(exc) -> bool:
    """A 404 or 422 from an endpoint or field the platform may not have deployed."""
    return status_of(exc) in (404, 405, 422) or "404" in str(exc)[:8] or "422" in str(exc)[:8]


def refused_ref(exc) -> bool:
    """A create refused because of `ref` (platform PR #1242 not deployed yet)."""
    text = str(exc) + " " + _json.dumps(getattr(exc, "details", None), default=str)
    return status_of(exc) in (400, 422) and bool(_re.search(r"\bref\b", text))


def runtime_for(profile_id, model) -> dict | None:
    """`agent_runtime` for a create: none for Lemma in the cloud with no model named (the agent's own)."""
    profile_id = str(profile_id or "").strip() or CLOUD
    model = str(model or "").strip() or None
    if profile_id == CLOUD and not model:
        return None
    return {"profile_id": profile_id, **({"model_name": model} if model else {})}


def profile_of(pod, profile_id) -> dict:
    """{id, name, kind, availability_status, default_model_name} of a runtime profile; {} when unreadable."""
    if not profile_id or profile_id == CLOUD:
        return {"id": CLOUD, "name": "Lemma", "kind": "MODEL_PROVIDER", "availability_status": "READY"}
    try:
        got = pod.request("GET", f"/organizations/{pod.org_id}/agent-runtime/profiles")
    except Exception:  # noqa: BLE001 — a function may not read the organization's runtimes
        return {}
    for p in gh_list(got, "items", "profiles"):
        if isinstance(p, dict) and str(p.get("id")) == str(profile_id):
            return p
    return {}


def open_conversation(pod, agent: str, title: str, repo: str, ref=None, runtime=None, metadata=None) -> dict:
    """Open a conversation with `agent` in its own worktree of `repo`.

    Returns {conversation: {...}, ref_dropped: bool, error: str|None}. Tries
    `ref` first; when the platform refuses it (PR #1242 not deployed: a 422
    naming ref) it opens again without it, from the default branch, and says
    so with ref_dropped."""
    body = {"agent_name": agent, "title": clip(title, 120), "repository": repo}
    if runtime:
        body["agent_runtime"] = runtime
    if metadata:
        body["metadata"] = metadata
    attempts = [dict(body, ref=ref), body] if ref else [body]
    last = None
    for i, attempt in enumerate(attempts):
        try:
            conv = as_dict(api(pod, "POST", "/conversations", attempt))
            return {"conversation": conv, "ref_dropped": i > 0, "error": None}
        except Exception as exc:  # noqa: BLE001
            last = exc
            if i == 0 and ref and refused_ref(exc):
                continue
            break
    return {"conversation": {}, "ref_dropped": False, "error": f"{type(last).__name__}: {last}"[:1500]}


def append(pod, conversation_id: str, text: str, key=None) -> None:
    """Post into a conversation and return at once (never `send`, which waits for the run).

    `key` makes it safe to post twice: the server keeps one message per
    client_message_id, so two members' schedules seeing one webhook post once."""
    message_id = cid("message", conversation_id, key) if key else None
    try:
        if message_id:
            pod.conversations.append(conversation_id, text, client_message_id=message_id)
        else:
            pod.conversations.append(conversation_id, text)
        return
    except TypeError:
        pass  # an SDK without these arguments: the raw request
    except AttributeError:
        pass
    body = {"content": text}
    if message_id:
        try:
            api(pod, "POST", f"/conversations/{conversation_id}/messages/append", {**body, "client_message_id": message_id})
            return
        except Exception as exc:  # noqa: BLE001 — a server without client_message_id: post it plainly
            if status_of(exc) != 422:
                raise
    api(pod, "POST", f"/conversations/{conversation_id}/messages/append", body)


def conversation(pod, conversation_id) -> dict:
    try:
        return as_dict(pod.conversations.get(conversation_id))
    except Exception:  # noqa: BLE001
        try:
            return as_dict(api(pod, "GET", f"/conversations/{conversation_id}"))
        except Exception:  # noqa: BLE001
            return {}


# ---------- sessions, tasks and events ----------

def task_table(scope) -> str:
    return "personal_task" if scope == "personal" else "task"


def find_task(pod, task_id) -> tuple:
    """(scope, row) of a task in `task`, else `personal_task`; (None, {}) when neither has it."""
    if not task_id:
        return None, {}
    for scope in ("team", "personal"):
        try:
            found = q(pod, f"SELECT * FROM {task_table(scope)} WHERE id = {lit(task_id)} LIMIT 1")
        except Exception:  # noqa: BLE001 — no grant on personal_task
            found = []
        if found:
            return scope, dict(found[0])
    return None, {}


def session_of(pod, session_id) -> dict:
    if not session_id:
        return {}
    found = q(pod, f"SELECT * FROM coding_session WHERE id = {lit(session_id)} LIMIT 1")
    return dict(found[0]) if found else {}


def live_sessions(pod, task_id) -> list:
    return [dict(r) for r in q(pod, f"SELECT * FROM coding_session WHERE task_id = {lit(task_id)} "
                                    f"AND status IN ({lits(LIVE)}) ORDER BY started_at DESC")]


def sessions_for_pr(pod, repo: str, number=None, branch=None, sha=None) -> list:
    """Sessions on one pull request: by number, its head branch, or its head commit."""
    ors = []
    if number:
        ors.append(f"pr_number = {int(number)}")
    if branch:
        ors.append(f"branch = {lit(branch)} OR push_to = {lit(branch)}")
    if sha:
        ors.append(f"head_sha = {lit(sha)}")
    if not repo or not ors:
        return []
    return [dict(r) for r in q(pod, f"SELECT * FROM coding_session WHERE LOWER(repo) = LOWER({lit(repo)}) AND ("
                                    + " OR ".join(f"({o})" for o in ors) + ") ORDER BY started_at DESC LIMIT 20")]


def add_events(pod, session: dict, events: list) -> int:
    """Upsert a session's events; each {kind, source, source_id, at?, actor?, text?, url?, detail?}."""
    batch = []
    for e in events:
        row = {k: v for k, v in e.items() if k in ("kind", "actor", "text", "url", "detail")}
        row["id"] = event_id(session["task_id"], e["source"], e.get("source_id") or e.get("at") or now_iso())
        row["task_id"] = session["task_id"]
        row["session_id"] = session.get("id")
        row["at"] = iso(e.get("at")) or now_iso()
        row["text"] = cut(row.get("text"), 4000) or None
        row["url"] = clip(row.get("url"), 600) or None
        batch.append(row)
    for start in range(0, len(batch), 100):
        pod.records.bulk_create("coding_event", batch[start: start + 100], upsert=True)
    return len(batch)


def has_event(pod, task_id, source, source_id) -> bool:
    return bool(q(pod, f"SELECT id FROM coding_event WHERE id = {lit(event_id(task_id, source, source_id))} LIMIT 1"))


def update_session(pod, session: dict, patch: dict) -> dict:
    """Write only what changed; returns the session as it now is."""
    changed = {k: v for k, v in patch.items() if session.get(k) != v}
    if changed:
        changed.setdefault("last_event_at", now_iso())
        pod.records.update("coding_session", session["id"], changed)
        session = {**session, **changed}
    return session


def update_task(pod, session: dict, patch: dict) -> None:
    """Move the session's task (status, done_at); a task that is gone is left alone."""
    try:
        scope, task = find_task(pod, session.get("task_id"))
        if not task:
            return
        if patch.get("status") == "done":
            patch = {**patch, "done_at": patch.get("done_at") or now_iso()}
        changed = {k: v for k, v in patch.items() if task.get(k) != v}
        if task.get("status") == "canceled" or (task.get("status") == "done" and patch.get("status") != "done"):
            return
        if changed:
            pod.records.update(task_table(scope), task["id"], changed)
    except Exception:  # noqa: BLE001 — the session's own state is what matters
        pass


def run_function(pod, name: str, data: dict) -> dict:
    """Another function's output; {} when it could not run. Only for quick ones (30 s)."""
    try:
        return as_dict(as_dict(pod.functions.run(name, data)).get("output_data"))
    except Exception:  # noqa: BLE001
        return {}


# ---------- starting a session ----------

def brief_text(session: dict, brief: str, repo: dict, ref_note: str | None) -> str:
    """The first message: what the agent works, where its branch starts, what to open the pull request against."""
    default = repo.get("default_branch") or "the default branch"
    lines = [f"[coding session {session['id']}]", "", f"Repository: {session['repo']}"]
    start = session.get("ref") or default
    lines.append(f"Your branch starts from: {start}" + (f" ({ref_note})" if ref_note else ""))
    if session.get("push_to"):
        lines.append(f"Push to the existing pull request's branch `{session['push_to']}` "
                     f"(`git push origin HEAD:{session['push_to']}`); do not open another pull request.")
    else:
        lines.append(f"Open the pull request against: {base_of(session.get('ref'), None, repo.get('default_branch'))}")
    lines += ["", f"Task: {session['title']}", "", cut(brief or session["title"], 12000)]
    if repo.get("setup"):
        lines += ["", "Set-up commands for this repository, run first:", "```", cut(repo["setup"], 4000), "```"]
    if repo.get("notes"):
        lines += ["", "Notes for this repository:", cut(repo["notes"], 4000)]
    if session.get("keep_green"):
        lines += ["", f"Keep the pull request green: later messages may bring a failed check, a review comment or a "
                      f"conflict; each is one round, up to {session.get('max_tries') or 3}."]
    lines += ["", f"Report with coding_report and session_id {session['id']}."]
    return "\n".join(lines)


def start_session(pod, me: dict, *, title: str, brief: str, repo: str, task_id=None, ref=None, push_to=None,
                  profile_id=None, model=None, keep_green=None, max_tries=None, source=None, source_url=None,
                  agent_label=None, place=None, availability=None, session_id=None, actor=None) -> dict:
    """Make or update the task, write the session, open the conversation and post the brief.

    The session row is written before the task (a claim: `session_id`, when
    given, is created and never overwritten, so two schedules that see one
    event start one session), so the task's own triggers find it live.
    Returns {ok, session_id, task_id, status, conversation_id, branch, message}."""
    s = settings_of(pod)
    repo = str(repo or "").strip().strip("/")
    if not _re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        return {"ok": False, "message": f"{repo or 'No repository'} is not owner/name."}
    repo_info = repo_row(pod, repo)
    profile_id = str(profile_id or "").strip() or s["default_profile_id"]
    if not model and profile_id == s["default_profile_id"]:
        model = s.get("default_model")
    profile = profile_of(pod, profile_id)
    kind = str(profile.get("kind") or "").upper()
    on_mac = kind == "HARNESS" or (not kind and place == "mac")
    ready = str(profile.get("availability_status") or availability or "READY").upper()
    label = agent_label or profile.get("name") or ("Lemma" if profile_id == CLOUD else "An agent")

    scope, task = find_task(pod, task_id) if task_id else (None, {})
    source = clip(source or task.get("source") or "coding-agent", 40)
    task_id = str(task.get("id") or task_id or _uuid.uuid4())
    scope = scope or "team"
    sid = str(session_id or _uuid.uuid4())
    session = {
        "id": sid, "task_id": task_id, "scope": scope, "title": clip(title or task.get("title") or "A coding task", 300),
        "source": source, "source_url": clip(source_url or task.get("source_url"), 600) or None, "repo": repo,
        "ref": clip(ref, 255) or None, "push_to": clip(push_to, 255) or None, "profile_id": profile_id,
        "model": clip(model, 120) or None, "place": "mac" if on_mac else "cloud", "agent_label": clip(label, 80),
        "keep_green": s["keep_green"] if keep_green is None else bool(keep_green),
        "max_tries": int(max_tries or s["max_tries"]), "tries": 0, "status": "starting", "needs": "none",
        "started_by": me.get("user_id"), "started_by_name": me.get("name"), "started_at": now_iso(),
        "last_event_at": now_iso(),
    }
    try:
        pod.records.create("coding_session", session)
    except Exception as exc:  # noqa: BLE001
        if session_id and session_of(pod, sid):
            return {"ok": False, "session_id": sid, "task_id": task_id, "message": "Already started."}
        return {"ok": False, "message": f"Couldn't write the session: {type(exc).__name__}: {exc}"[:500]}

    # The task: the card on the board, assigned to the coding agent.
    patch = {"assignee_kind": "agent", "assignee_agent": BUILDER, "assignee_name": label}
    if task:
        if task.get("status") in ("todo", "waiting", "done", "canceled"):
            patch["status"] = "in_progress"
            patch["done_at"] = None
        if not task.get("source_url") and source_url:
            patch["source_url"] = clip(source_url, 1000)
        patch = {k: v for k, v in patch.items() if task.get(k) != v}
        if patch:
            pod.records.update(task_table(scope), task_id, patch)
    else:
        pod.records.create("task", {"id": task_id, "title": session["title"], "description": cut(brief, 20000) or None,
                                    "status": "in_progress", "priority": "none", **patch,
                                    "owner_user_id": me.get("user_id"), "owner_name": me.get("name"),
                                    "source": source, "source_url": clip(source_url, 1000) or None})

    who = actor or me.get("name") or "Someone"
    where = f"{label} on their Mac" if on_mac else f"{label} in the cloud"
    events = [{"kind": "assigned", "source": "session", "source_id": f"{sid}:assigned", "actor": who,
               "text": f"{who} assigned it to {where}", "detail": {"profile_id": profile_id, "model": session["model"]}}]

    # Moving it: an earlier session that never started on this task is closed.
    for old in live_sessions(pod, task_id):
        if old["id"] != sid and (old.get("needs") in ("waiting_mac", "failed") or not old.get("conversation_id")):
            update_session(pod, old, {"status": "stopped", "needs": "none", "finished_at": now_iso()})
            add_events(pod, old, [{"kind": "moved", "source": "session", "source_id": f"{old['id']}:moved:{sid}",
                                   "actor": who, "text": f"Moved to {where}"}])

    if on_mac and ready != "READY":
        text = f"Assigned to {label} on your Mac, which is {'offline' if ready == 'OFFLINE' else 'not available'}."
        session = update_session(pod, session, {"status": "needs_you", "needs": "waiting_mac", "needs_text": text})
        add_events(pod, session, events)
        return {"ok": True, "session_id": sid, "task_id": task_id, "status": "needs_you", "conversation_id": None,
                "branch": None, "message": text + " Move it to the cloud, or wake the Mac and start again."}

    metadata = {"plugin": PLUGIN, "coding_session": sid, "task_id": task_id}
    opened = open_conversation(pod, BUILDER, session["title"], repo, session["ref"], runtime_for(profile_id, model), metadata)
    conv = opened["conversation"]
    if opened["error"] or not conv.get("id"):
        why = opened["error"] or "no conversation came back"
        session = update_session(pod, session, {"status": "failed", "needs": "failed", "error": cut(why, 2000),
                                                "needs_text": clip(f"Couldn't start: {why}", 2000), "finished_at": now_iso()})
        add_events(pod, session, events + [{"kind": "failed", "source": "session", "source_id": f"{sid}:open",
                                            "actor": label, "text": f"Couldn't start: {clip(why, 600)}"}])
        return {"ok": False, "session_id": sid, "task_id": task_id, "status": "failed", "message": f"Couldn't start: {why}"}

    conversation_id = str(conv["id"])
    branch = branch_of(conv.get("workspace_cwd"))
    ref_note = None
    if opened["ref_dropped"]:
        ref_note = f"this Lemma can't start a branch from {session['ref']} yet, so it started from the default branch"
    session = update_session(pod, session, {"conversation_id": conversation_id, "branch": branch,
                                            "ref": None if opened["ref_dropped"] else session["ref"]})
    try:
        append(pod, conversation_id, brief_text(session, brief, repo_info, ref_note), key=f"brief:{sid}")
    except Exception as exc:  # noqa: BLE001
        why = f"{type(exc).__name__}: {exc}"[:1500]
        session = update_session(pod, session, {"status": "failed", "needs": "failed", "error": why,
                                                "needs_text": clip(f"Couldn't hand over the brief: {why}", 2000),
                                                "finished_at": now_iso()})
        add_events(pod, session, events + [{"kind": "failed", "source": "session", "source_id": f"{sid}:brief",
                                            "actor": label, "text": f"Couldn't hand over the brief: {clip(why, 600)}"}])
        return {"ok": False, "session_id": sid, "task_id": task_id, "status": "failed", "conversation_id": conversation_id,
                "message": f"Couldn't hand over the brief: {why}"}

    start = (f"pull request #{pr_of_ref(ref)}" if pr_of_ref(ref) else ref) if (ref and not opened["ref_dropped"]) else (
        repo_info.get("default_branch") or "the default branch")
    if opened["ref_dropped"]:
        events.append({"kind": "checked_out", "source": "session", "source_id": f"{sid}:checked_out", "actor": label,
                       "text": f"Started from the default branch{' on ' + branch if branch else ''}: this Lemma can't "
                               f"start a branch from {ref} yet",
                       "detail": {"ref": ref, "branch": branch, "ref_dropped": True}})
    else:
        events.append({"kind": "checked_out", "source": "session", "source_id": f"{sid}:checked_out", "actor": label,
                       "text": f"Checked out from {start}" + (f" on {branch}" if branch else ""),
                       "detail": {"ref": ref, "branch": branch}})
    events.append({"kind": "started", "source": "session", "source_id": f"{sid}:started", "actor": label,
                   "text": f"{label} started", "detail": {"conversation_id": conversation_id}})
    session = update_session(pod, session, {"status": "working"})
    add_events(pod, session, events)
    return {"ok": True, "session_id": sid, "task_id": task_id, "status": "working", "conversation_id": conversation_id,
            "branch": branch, "message": f"{label} is on it" + (f" ({ref_note})." if ref_note else ".")}


def pr_target(pod, repo: str, number: int) -> dict:
    """Where work on an open pull request starts and goes: {ref, push_to}; push_to only when its branch is in the repo."""
    pr = pull(pod, repo, number)
    head = pr.get("head") or {}
    same = str(((head.get("repo") or {}).get("full_name")) or "").lower() == repo.lower()
    return {"ref": f"pull/{int(number)}/head", "push_to": head.get("ref") if same and pr.get("state") == "open" else None}


# ---------- keeping a pull request green ----------

NEEDS_FOR = {"check": "checks_failing", "review": "review", "conflict": "conflict"}


def keep_green(pod, me: dict, session: dict, what: str, key: str, message: str, ask: str) -> dict:
    """One fix round, by the session's starter only.

    `what` is check, review or conflict; `key` names this round (the head
    commit, the comment) so it happens once; `message` goes to the agent and
    `ask` to the person when the rounds are used up. Anyone else's run writes
    only events: each member's schedule sees the same webhook, and the
    starter's own one does the fixing."""
    if not me.get("user_id") or str(session.get("started_by") or "") != me["user_id"]:
        return {"acted": False, "why": "not the starter"}
    if session.get("status") in FINISHED:
        return {"acted": False, "why": "finished"}
    if has_event(pod, session["task_id"], "keep-green", f"{session['id']}:{key}"):
        return {"acted": False, "why": "done already"}
    tries, top = int(session.get("tries") or 0), int(session.get("max_tries") or 3)
    if not session.get("keep_green") or not session.get("conversation_id") or tries >= top:
        text = (f"Stopped after {tries} tr{'y' if tries == 1 else 'ies'}: {ask}" if session.get("keep_green") and tries >= top
                else ask)
        update_session(pod, session, {"status": "needs_you", "needs": NEEDS_FOR.get(what, "review"),
                                      "needs_text": clip(text, 2000)})
        add_events(pod, session, [{"kind": "fixing", "source": "keep-green",
                                   "source_id": f"{session['id']}:{key}", "actor": "Lemma",
                                   "text": "Needs you: " + clip(text, 600), "detail": {"try": tries, "of": top, "stopped": True}}])
        return {"acted": True, "asked": True}
    n = tries + 1
    append(pod, session["conversation_id"], f"[coding session {session['id']}] {message}\n\nThis is try {n} of {top}.",
           key=f"fix:{session['id']}:{key}")
    update_session(pod, session, {"tries": n, "needs": "none" if session.get("needs") in NEEDS_FOR.values() else session.get("needs"),
                                  "status": "pr_open" if session.get("status") == "needs_you" else session.get("status")})
    add_events(pod, session, [{"kind": "fixing", "source": "keep-green", "source_id": f"{session['id']}:{key}",
                               "actor": session.get("agent_label") or "The agent",
                               "text": f"Fixing {'the failed check' if what == 'check' else 'the review comment' if what == 'review' else 'the conflict'}, "
                                       f"try {n} of {top}", "detail": {"try": n, "of": top, "what": what}}])
    return {"acted": True, "try": n}



# ---------- what needs the person (Today) ----------

NEEDS_WORDS = {
    "question": ("decide", "Answer the coding agent: {t}", 8),
    "approval": ("decide", "Approve what the coding agent asks: {t}", 8),
    "checks_failing": ("do", "Checks failing: {t}", 6),
    "review": ("do", "Review comments to settle: {t}", 6),
    "conflict": ("do", "Fix the conflicts: {t}", 6),
    "waiting_mac": ("do", "Waiting for your Mac: {t}", 5),
    "failed": ("do", "The coding agent stopped: {t}", 4),
}


def session_items(me: str, sessions: list) -> list:
    """The person's current items from their sessions that wait on them."""
    out = []
    for se in sessions:
        if str(se.get("started_by") or "") != me or se.get("status") != "needs_you":
            continue
        verb, title, weight = NEEDS_WORDS.get(se.get("needs") or "", ("do", "The coding agent needs you: {t}", 4))
        out.append({"verb": verb, "title": clip(title.format(t=se.get("title") or "a task"), 300),
                    "why": clip(se.get("needs_text") or f"{se.get('repo')} · {se.get('agent_label') or 'the agent'}", 300),
                    "source_table": "coding_session", "source_id": str(se["id"]),
                    "source_version": f"{se.get('needs')}:{digest(se.get('needs_text'))}:{se.get('tries') or 0}",
                    "app": APP, "path": f"/t/{se['task_id']}" + ("?tab=transcript" if se.get("needs") == "question" else ""),
                    "since_at": iso(se.get("last_event_at")) or iso(se.get("started_at")), "weight": weight})
    return out


def repo_item(task: dict) -> dict:
    """A task handed to the coding agent with no repository to work in."""
    return {"verb": "decide", "title": "Which repository should the coding agent work in?",
            "why": clip(task.get("title") or "A task handed to the coding agent", 300), "source_table": "task",
            "source_id": str(task["id"]), "source_version": f"repo:{task['id']}", "app": APP, "path": f"/t/{task['id']}",
            "weight": 5}


def needs_you_pass(pod, me: str) -> dict:
    """Write this person's Coding agent items to Today and resolve the rest.

    Sessions waiting on them (scope: coding_session), and the "Which
    repository?" items still true (scope: task). Needs `needs_you_write`
    (the contract snippet) in the calling function, and a grant on needs_you."""
    if not me:
        return {"skipped": "no member"}
    mine = [dict(r) for r in q(pod, f"SELECT * FROM coding_session WHERE started_by = {lit(me)} AND status = 'needs_you' "
                                    "ORDER BY last_event_at DESC LIMIT 200")]
    counts = needs_you_write(pod, PLUGIN, me, session_items(me, mine), "source_table = 'coding_session'")
    asked = [r["source_id"] for r in q(pod, f"SELECT source_id FROM needs_you WHERE source_plugin = {lit(PLUGIN)} "
                                            "AND source_table = 'task' AND state IN ('open', 'snoozed') LIMIT 200")]
    still = []
    if asked:
        busy = {r["task_id"] for r in q(pod, f"SELECT task_id FROM coding_session WHERE task_id IN ({lits(asked)})")}
        for t in q(pod, f"SELECT id, title, status, assignee_agent FROM task WHERE id IN ({lits(asked)})"):
            if t.get("assignee_agent") == BUILDER and t.get("status") not in ("done", "canceled") and t["id"] not in busy:
                still.append(repo_item(t))
    more = needs_you_write(pod, PLUGIN, me, still, "source_table = 'task'")
    return {k: counts.get(k, 0) + more.get(k, 0) for k in counts}
# end coding:common

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


class CodingTickInput(BaseModel):
    detail: bool = False


class CodingTickResult(BaseModel):
    looked: int = 0
    changed: int = 0
    details: list[dict] = []
    message: str


BUDGET_SECONDS = 45
MAX_SESSIONS = 40


def conversation_patch(se: dict, conv: dict) -> tuple:
    """(session patch, event or None) from the conversation's state: the pure part."""
    status = str(conv.get("status") or "").upper()
    run = str(conv.get("last_run_id") or conv.get("updated_at") or "")
    patch: dict = {}
    if not se.get("branch") and branch_of(conv.get("workspace_cwd")):
        patch["branch"] = branch_of(conv.get("workspace_cwd"))
    working = se.get("status") in ("starting", "working")
    if status == "COMPLETED" and working:
        if se.get("pr_number"):
            patch["status"] = "pr_open"
            return patch, None
        patch.update(status="done", needs="none", needs_text=None, finished_at=now_iso())
        return patch, {"kind": "result", "source": "conversation", "source_id": f"{se['id']}:{run}:completed",
                       "text": "Finished without a report"}
    if status == "FAILED" and se.get("status") in ("starting", "working", "pr_open"):
        why = clip(conv.get("last_run_error") or "The run failed.", 2000)
        patch.update(status="failed", needs="failed", needs_text=why, error=why, finished_at=now_iso())
        return patch, {"kind": "failed", "source": "conversation", "source_id": f"{se['id']}:{run}:failed", "text": why}
    if status == "WAITING" and conv.get("has_pending_interaction") and se.get("status") != "needs_you":
        text = "The agent is waiting for your answer in the transcript."
        patch.update(status="needs_you", needs="question", needs_text=text)
        return patch, {"kind": "question", "source": "conversation", "source_id": f"{se['id']}:{run}:waiting", "text": text}
    if status == "STOPPED" and working:
        patch.update(status="stopped", needs="none", needs_text=None, finished_at=now_iso())
        return patch, {"kind": "stopped", "source": "conversation", "source_id": f"{se['id']}:{run}:stopped", "text": "Stopped"}
    return patch, None


def coding_tick(ctx: FunctionContext, data: CodingTickInput) -> CodingTickResult:
    pod = ctx.pod
    me = caller(ctx)
    began = time.monotonic()
    if not me["user_id"]:
        return CodingTickResult(message="No member to look after.")
    sessions = [dict(r) for r in q(pod, f"SELECT * FROM coding_session WHERE started_by = {lit(me['user_id'])} "
                                        f"AND status IN ({lits(LIVE)}) ORDER BY last_event_at LIMIT {MAX_SESSIONS}")]
    looked = changed = 0
    details = []
    for se in sessions:
        if time.monotonic() - began > BUDGET_SECONDS:
            break
        if "github.example/" in str(se.get("pr_url") or se.get("source_url") or ""):
            continue  # the sample's made-up work: nothing to read
        looked += 1
        before = dict(se)
        actor = se.get("agent_label") or "The agent"
        try:
            if se.get("conversation_id"):
                conv = conversation(pod, se["conversation_id"])
                if conv:
                    patch, ev = conversation_patch(se, conv)
                    se = update_session(pod, se, patch)
                    if ev:
                        add_events(pod, se, [{**ev, "actor": actor}])
                    if patch.get("status") == "done":
                        update_task(pod, se, {"status": "done"})
            if se.get("pr_number") and se.get("pr_state") == "open" and se.get("status") in LIVE:
                pr = pull(pod, se["repo"], se["pr_number"])
                if pr:
                    facts = pr_facts(pr)
                    number = se["pr_number"]
                    if facts.get("pr_state") == "merged":
                        se = update_session(pod, se, {**facts, "status": "merged", "needs": "none", "needs_text": None,
                                                      "finished_at": iso(pr.get("merged_at")) or now_iso()})
                        update_task(pod, se, {"status": "done"})
                        add_events(pod, se, [{"kind": "merged", "source": "pr", "source_id": f"{se['repo']}#{number}:merged",
                                              "actor": ((pr.get("merged_by") or {}).get("login")) or "GitHub",
                                              "text": f"#{number} merged", "url": pr.get("html_url"), "at": pr.get("merged_at")}])
                    elif facts.get("pr_state") == "closed":
                        se = update_session(pod, se, {**facts, "status": "stopped", "needs": "none", "needs_text": None,
                                                      "finished_at": iso(pr.get("closed_at")) or now_iso()})
                        add_events(pod, se, [{"kind": "closed", "source": "pr",
                                              "source_id": f"{se['repo']}#{number}:closed:{pr.get('closed_at') or ''}",
                                              "actor": "GitHub", "text": f"#{number} closed without merging",
                                              "url": pr.get("html_url"), "at": pr.get("closed_at")}])
                    else:
                        sha = facts.get("head_sha") or se.get("head_sha")
                        if sha and sha != se.get("head_sha"):
                            facts.update(checks="running", checks_text=None)
                        conflict = facts.get("mergeable") == "conflict"
                        if facts.get("mergeable") == "clean" and se.get("needs") == "conflict" and se.get("status") == "needs_you":
                            facts.update(status="pr_open", needs="none", needs_text=None)
                        se = update_session(pod, se, facts)
                        base = ((pr.get("base") or {}).get("ref")) or "the base branch"
                        if conflict and sha:
                            add_events(pod, se, [{"kind": "conflict", "source": "pr", "source_id": f"{se['repo']}#{number}:conflict:{sha}",
                                                  "actor": "GitHub", "text": f"#{number} conflicts with {base}",
                                                  "url": pr.get("html_url"), "detail": {"sha": sha, "base": base}}])
                            keep_green(pod, me, se, "conflict", f"conflict:{sha}",
                                       f"Your pull request #{number} conflicts with {base}. Merge {base} into your branch and fix "
                                       "the conflicts without dropping anyone's changes; run the checks, push, and report "
                                       "progress. If a conflict isn't clear, report a question.",
                                       f"#{number} conflicts with {base}.")
                            se = session_of(pod, se["id"]) or se
                        if sha:
                            state = ref_checks(pod, se["repo"], sha)
                            if state["state"] in ("running", "passed", "failed"):
                                patch = {"checks": state["state"], "checks_text": state["text"]}
                                if state["state"] == "passed" and se.get("needs") == "checks_failing" and se.get("status") == "needs_you":
                                    patch.update(status="pr_open", needs="none", needs_text=None)
                                se = update_session(pod, se, patch)
                            if state["state"] == "passed":
                                add_events(pod, se, [{"kind": "checks_passed", "source": "checks",
                                                      "source_id": f"{se['repo']}@{sha}:passed", "actor": "GitHub",
                                                      "text": f"Checks passed: {state['text']}", "detail": {"sha": sha}}])
                            elif state["state"] == "failed" and not has_event(pod, se["task_id"], "keep-green", f"{se['id']}:check:{sha}"):
                                names = ", ".join(state["failed"])
                                add_events(pod, se, [{"kind": "check_failed", "source": "checks", "source_id": f"{se['repo']}@{sha}:failed",
                                                      "actor": "GitHub", "text": f"Checks failed: {names}", "detail": {"sha": sha}}])
                                keep_green(pod, me, se, "check", f"check:{sha}",
                                           f"Checks failed on your pull request #{number}: {names}. `gh pr checks {number}` and "
                                           "`gh run view --log-failed` show why. Fix them in the smallest way, run them locally "
                                           "if you can, push, and report progress.",
                                           f"{names} still fail{'s' if len(state['failed']) == 1 else ''} on #{number}.")
                                se = session_of(pod, se["id"]) or se
        except Exception as exc:  # noqa: BLE001 — one session never stops the rest
            details.append({"session_id": se["id"], "error": f"{type(exc).__name__}: {exc}"[:300]})
            continue
        if any(se.get(k) != before.get(k) for k in ("status", "needs", "checks", "mergeable", "pr_state", "branch", "tries")):
            changed += 1
            if data.detail:
                details.append({"session_id": se["id"], "status": se.get("status"), "needs": se.get("needs")})
    counts = {}
    try:
        counts = needs_you_pass(pod, me["user_id"])
    except Exception as exc:  # noqa: BLE001
        details.append({"needs_you": f"{type(exc).__name__}: {exc}"[:300]})
    return CodingTickResult(looked=looked, changed=changed, details=details,
                            message=f"Looked at {looked} session(s); {changed} changed. Today: {counts}.")
