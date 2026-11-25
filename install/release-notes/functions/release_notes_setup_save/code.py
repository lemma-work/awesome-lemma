#input_type_name: ReleaseNotesSetupSaveInput
#output_type_name: ReleaseNotesSetupSaveResult
#function_name: release_notes_setup_save

"""Keep Release notes' set-up: the product's name, the repositories and how
each goes live, the Slack channel, who publishes. Writes the memory block
(release_notes_memory). Safe to run again from Settings.

The WEBHOOK, nightly and per-member schedules are made by the app, as the
person setting up: a function cannot be granted `schedule.create` (the pod
grant target allows only notifying yourself and starting the assistant), and
a GitHub schedule's installation id is written by the platform from the
shared GitHub connection's account, never sent by anyone.
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

VIA = ("workflow", "tag", "deployment", "merge")


class ReleaseNotesSetupSaveInput(BaseModel):
    product: str | None = None
    repos: list = []
    slack_channel: str | None = None
    slack_channel_name: str | None = None
    publishers: list = []
    page_url: str | None = None


class ReleaseNotesSetupSaveResult(BaseModel):
    saved: bool
    memory: str | None = None
    message: str


def release_notes_setup_save(ctx: FunctionContext, data: ReleaseNotesSetupSaveInput) -> ReleaseNotesSetupSaveResult:
    pod = ctx.pod
    me = str(ctx.user_id)
    repos = []
    for r in data.repos or []:
        r = as_dict(r) if not isinstance(r, dict) else r
        name = str(r.get("name") or "").strip()
        if not _re.match(r"^[\w.-]+/[\w.-]+$", name):
            continue
        via = r.get("live_via") if r.get("live_via") in VIA else "workflow"
        if via == "deployment":
            via = "workflow"  # not on the platform yet: set-up cannot pick it
        repos.append({"name": name, "live_via": via, "workflow": clip(r.get("workflow"), 120) or None,
                      "environment": clip(r.get("environment"), 120) or None,
                      "paths": [str(p) for p in (r.get("paths") or []) if str(p).strip()][:20]})
    if not repos:
        return ReleaseNotesSetupSaveResult(saved=False, message="Pick at least one repository.")
    publishers = [{"user_id": str(p.get("user_id")), "name": clip(p.get("name"), 120)} for p in data.publishers if p.get("user_id")] \
        or [{"user_id": me, "name": None}]
    old = settings_of(pod)
    row = {"id": SETTINGS_ID, "product": clip(data.product, 120) or None, "repos": repos,
           "slack_channel": data.slack_channel or None, "slack_channel_name": data.slack_channel_name or None,
           "publishers": publishers, "setup_done_at": old.get("setup_done_at") if not old.get("sample") else None,
           "sample": False}
    row["setup_done_at"] = row["setup_done_at"] or now_iso()
    if data.page_url:
        row["page_url"] = data.page_url
    pod.records.bulk_create("release_note_settings", [row], upsert=True)
    memory = None
    try:
        memory = as_dict(as_dict(pod.functions.run("release_notes_memory", {})).get("output_data")).get("message")
    except Exception as exc:  # noqa: BLE001 - set-up goes on
        memory = f"Could not write the memory block: {clip(str(exc), 200)}"
    return ReleaseNotesSetupSaveResult(saved=True, memory=memory,
                                       message=f"Saved: {len(repos)} repositor{'y' if len(repos) == 1 else 'ies'}, {len(publishers)} publisher(s).")
