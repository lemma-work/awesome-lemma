#input_type_name: ReleaseNotesReconcileInput
#output_type_name: ReleaseNotesReconcileResult
#function_name: release_notes_reconcile

"""The nightly catch-up, for what a webhook missed (a trigger can skip under
lag; the platform records it in `record_skips`, it does not redeliver).

For each repository: every pull request merged since the open note's last
release (`repos_compare_commits`, read for "(#123)" and "Merge pull request
#123") that `release_note_pr` doesn't have goes through
release_notes_on_merge; for a repository that goes live by its deploy
workflow, the newest successful run of that workflow goes through
release_notes_on_live. When anything new came in, the note is redrafted
(`release-notes-redraft`). Runs as whoever set Release notes up.
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

MERGE_PR = _re.compile(r"Merge pull request #(\d+)|\(#(\d+)\)\s*$", _re.M)


class ReleaseNotesReconcileInput(BaseModel):
    repo: str | None = None


class ReleaseNotesReconcileResult(BaseModel):
    merged: int
    live: int
    message: str


def release_notes_reconcile(ctx: FunctionContext, data: ReleaseNotesReconcileInput) -> ReleaseNotesReconcileResult:
    pod = ctx.pod
    settings = settings_of(pod)
    if settings.get("sample") or not settings.get("setup_done_at"):
        return ReleaseNotesReconcileResult(merged=0, live=0, message="Nothing set up (or only the sample).")
    merged = live = 0
    said = []
    for cfg in settings.get("repos") or []:
        repo = cfg.get("name")
        if not repo or (data.repo and data.repo != repo):
            continue
        owner, name = owner_name(repo)
        try:
            info = as_dict(gh(pod, "repos_get", {"owner": owner, "repo": name}))
            head = info.get("default_branch") or "main"
            note = open_note(pod, repo)
            base = (note or {}).get("from_ref")
            if not base:
                try:
                    base = as_dict(gh(pod, "repos_get_latest_release", {"owner": owner, "repo": name})).get("tag_name")
                except Exception:  # noqa: BLE001
                    base = None
            numbers = set()
            if base:
                got = as_dict(gh(pod, "repos_compare_commits", {"owner": owner, "repo": name, "basehead": f"{base}...{head}", "per_page": 250}))
                for c in got.get("commits") or []:
                    for m in MERGE_PR.finditer(as_dict(c.get("commit")).get("message") or ""):
                        numbers.add(int(m.group(1) or m.group(2)))
            known = {int(r["number"]) for r in q(pod, f"SELECT number FROM release_note_pr WHERE repo = {lit(repo)} AND number IN ({lits(sorted(numbers))})")} if numbers else set()
            note_id = (note or {}).get("id")
            for n in sorted(numbers - known)[:40]:
                out = as_dict(as_dict(pod.functions.run("release_notes_on_merge", {"repo": repo, "number": n, "action": "closed", "merged": True})).get("output_data"))
                if not out.get("skip"):
                    merged += 1
                    note_id = out.get("note_id") or note_id
            if (cfg.get("live_via") or "workflow") == "workflow" and cfg.get("workflow"):
                runs = gh_list(gh(pod, "actions_list_workflow_runs_for_repo", {"owner": owner, "repo": name, "status": "success",
                                                                               "branch": head, "per_page": 30}))
                want = str(cfg["workflow"]).strip().lower()
                run = next((r for r in runs if str(r.get("name") or "").strip().lower() == want), None)
                if run:
                    out = as_dict(as_dict(pod.functions.run("release_notes_on_live", {
                        "event": "workflow_run", "repo": repo, "workflow_name": run.get("name"), "conclusion": run.get("conclusion"),
                        "status": run.get("status"), "head_sha": run.get("head_sha"), "head_branch": run.get("head_branch"),
                        "run_number": run.get("run_number"), "run_url": run.get("html_url"), "at": run.get("updated_at")})).get("output_data"))
                    live += int(out.get("live") or 0)
            if merged and note_id:
                pod.workflows.run("release-notes-redraft", about=("release_note", note_id))
            said.append(f"{repo}: {len(numbers - known)} missed merge(s)")
        except Exception as exc:  # noqa: BLE001 - the next repository still runs
            said.append(f"{repo}: {clip(str(exc), 200)}")
    return ReleaseNotesReconcileResult(merged=merged, live=live, message="; ".join(said) or "No repositories.")
