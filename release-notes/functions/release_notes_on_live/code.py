#input_type_name: ReleaseNotesOnLiveInput
#output_type_name: ReleaseNotesOnLiveResult
#function_name: release_notes_on_live

"""A deploy signal from GitHub: the open note's work is live.

What counts is set per repository at set-up (`live_via`):

- `workflow` (the default): a `workflow_run` that completed with conclusion
  success, from the workflow named at set-up (Deploy, say), on the default
  branch. Its head commit is what reached people.
- `tag`: a `push` of a tag (refs/tags/...). The tag's commit is what shipped,
  and the note takes the tag's name.
- `deployment`: a GitHub deployment status `success` in the named
  environment. Not on the platform's main yet (deployment_status is built on
  an unmerged branch); set-up shows it but cannot pick it.

Every pull request on the note whose merge commit the deployed commit
contains (`repos_compare_commits` merge...deployed is ahead or identical) is
marked live; when any shown line's work is live the note becomes `ready`, and
each publisher's own trigger on release_note puts "v2.14 notes are ready" in
their Today (release_notes_on_note). Never publishes anything.
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


class ReleaseNotesOnLiveInput(BaseModel):
    event: str = "workflow_run"  # workflow_run | push | deployment_status
    repo: str | None = None
    # workflow_run
    workflow_name: str | None = None
    conclusion: str | None = None
    status: str | None = None
    head_sha: str | None = None
    head_branch: str | None = None
    run_number: int | None = None
    run_url: str | None = None
    # push
    ref: str | None = None
    after: str | None = None
    # deployment_status (once the platform has it)
    state: str | None = None
    environment: str | None = None
    sha: str | None = None
    # when it happened, if the event says
    at: str | None = None


class ReleaseNotesOnLiveResult(BaseModel):
    skip: bool = False
    note_id: str | None = None
    live: int = 0
    message: str


def _contains(pod, repo: str, merge_sha: str, deployed: str) -> bool:
    if not merge_sha or not deployed:
        return False
    if merge_sha == deployed:
        return True
    owner, name = owner_name(repo)
    try:
        got = as_dict(gh(pod, "repos_compare_commits", {"owner": owner, "repo": name,
                                                        "basehead": f"{merge_sha}...{deployed}", "per_page": 1}))
    except Exception:  # noqa: BLE001 - unknown commit: not live
        return False
    return got.get("status") in ("ahead", "identical")


def release_notes_on_live(ctx: FunctionContext, data: ReleaseNotesOnLiveInput) -> ReleaseNotesOnLiveResult:
    pod = ctx.pod
    settings = settings_of(pod)
    cfg = repo_of(settings, data.repo)
    if not cfg:
        return ReleaseNotesOnLiveResult(skip=True, message=f"{data.repo} is not watched.")
    via = cfg.get("live_via") or "workflow"
    tag_name, env = None, None
    if data.event == "workflow_run":
        want = str(cfg.get("workflow") or "").strip().lower()
        if via != "workflow":
            return ReleaseNotesOnLiveResult(skip=True, message=f"{data.repo} goes live by {via}, not a workflow run.")
        if (data.status and data.status != "completed") or data.conclusion != "success":
            return ReleaseNotesOnLiveResult(skip=True, message=f"Run {data.conclusion or data.status}: not a deploy that finished.")
        if want and str(data.workflow_name or "").strip().lower() != want:
            return ReleaseNotesOnLiveResult(skip=True, message=f"'{data.workflow_name}' is not the deploy workflow ('{cfg.get('workflow')}').")
        deployed = data.head_sha
        env = cfg.get("environment") or "production"
        ref = f"{cfg.get('workflow') or data.workflow_name} workflow, run {data.run_number}" if data.run_number else f"{data.workflow_name} workflow"
    elif data.event == "push":
        if via != "tag":
            return ReleaseNotesOnLiveResult(skip=True, message=f"{data.repo} goes live by {via}, not a tag.")
        if not str(data.ref or "").startswith("refs/tags/") or not data.after or set(data.after) == {"0"}:
            return ReleaseNotesOnLiveResult(skip=True, message="Not a new tag.")
        tag_name = str(data.ref)[len("refs/tags/"):]
        deployed, env, ref = data.after, None, f"Tag {tag_name}"
    elif data.event == "deployment_status":
        if via != "deployment":
            return ReleaseNotesOnLiveResult(skip=True, message=f"{data.repo} goes live by {via}, not a deployment.")
        want_env = str(cfg.get("environment") or "production").lower()
        if data.state != "success" or str(data.environment or "").lower() != want_env:
            return ReleaseNotesOnLiveResult(skip=True, message=f"Deployment {data.state} in {data.environment}: not {want_env}.")
        deployed, env, ref = data.sha, data.environment, f"Deployment to {data.environment}"
    else:
        return ReleaseNotesOnLiveResult(skip=True, message=f"Unknown event {data.event}.")

    note = open_note(pod, cfg["name"])
    if not note:
        return ReleaseNotesOnLiveResult(skip=True, message="No open note.")
    prs = q(pod, f"SELECT id, number, merge_sha, live_at, kind, left_out FROM release_note_pr WHERE note_id = {lit(note['id'])} LIMIT 500")
    at = data.at or now_iso()
    live = [p for p in prs if not p.get("live_at") and _contains(pod, cfg["name"], p.get("merge_sha"), deployed)]
    if live:
        pod.records.bulk_update("release_note_pr", [{"id": p["id"], "live_at": at} for p in live])
    shown_live = any((p.get("live_at") or p in live) and p.get("kind") in IN_NOTE and not p.get("left_out") for p in prs)
    patch: dict = {"to_sha": deployed}
    if tag_name:
        patch.update({"tag": tag_name, "name": tag_name if _re.match(r"^v?\d", tag_name) else note["name"]})
    if shown_live:
        patch.update({"live_at": note.get("live_at") or at, "live_env": env, "live_via": via, "live_ref": clip(ref, 300)})
        if note.get("state") == "drafting":
            patch["state"] = "ready"
    pod.table("release_note").update(note["id"], patch)
    return ReleaseNotesOnLiveResult(note_id=note["id"], live=len(live),
                                    message=f"{len(live)} pull request(s) live; {note['name']} is {patch.get('state', note['state'])}.")
