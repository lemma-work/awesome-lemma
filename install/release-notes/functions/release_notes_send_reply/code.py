#input_type_name: ReleaseNotesSendReplyInput
#output_type_name: ReleaseNotesSendReplyResult
#function_name: release_notes_send_reply

"""Send one reply a person approved in Who asked, as that person.

- A `release_note_reply` (a public place): `github` comments on the issue
  (`issues_create_comment`, as the person who pressed Send); `slack` replies
  in the asker's thread (`chat_post_message` with `thread_ts`, posted by the
  Lemma's Slack app). The ask is then `told`.
- A sample's Mail draft (`draft_id`, its conversation on the sample
  mailbox): nothing is sent; it is marked sent so the sample shows what
  happens next. A real Mail draft is sent by Mail's own mail_send_draft, never
  here.

Refuses anything already sent, and anything but proposed, approved or failed.
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


class ReleaseNotesSendReplyInput(BaseModel):
    reply_id: str | None = None
    draft_id: str | None = None
    body: str | None = None


class ReleaseNotesSendReplyResult(BaseModel):
    sent: bool
    url: str | None = None
    message: str


def release_notes_send_reply(ctx: FunctionContext, data: ReleaseNotesSendReplyInput) -> ReleaseNotesSendReplyResult:
    pod = ctx.pod
    me = str(ctx.user_id) if ctx.user_id else None
    now = now_iso()
    if data.draft_id:
        d = q(pod, f"SELECT * FROM draft WHERE id = {lit(data.draft_id)}")
        if not d:
            return ReleaseNotesSendReplyResult(sent=False, message="No such draft.")
        d = d[0]
        if d.get("source_account") != "sample":
            return ReleaseNotesSendReplyResult(sent=False, message="A real mail reply is sent by Mail (mail_send_draft).")
        patch = {"state": "sent", "sent_at": now}
        if data.body:
            patch["body"] = data.body
        pod.table("draft").update(d["id"], patch)
        return ReleaseNotesSendReplyResult(sent=True, message="Sample: marked sent. Nothing left this Lemma.")
    found = q(pod, f"SELECT * FROM release_note_reply WHERE id = {lit(data.reply_id)}") if data.reply_id else []
    if not found:
        return ReleaseNotesSendReplyResult(sent=False, message="No such reply.")
    r = found[0]
    if r.get("state") == "sent":
        return ReleaseNotesSendReplyResult(sent=False, url=r.get("url"), message="Already sent; not sending twice.")
    if r.get("state") not in ("proposed", "approved", "failed"):
        return ReleaseNotesSendReplyResult(sent=False, message=f"The reply is {r.get('state')}.")
    body = (data.body or r["body"]).strip()
    if not body:
        return ReleaseNotesSendReplyResult(sent=False, message="The reply is empty.")
    url = None
    if r.get("sample"):
        url = None
    else:
        try:
            if r["channel"] == "github":
                repo, _, number = str(r["target"]).rpartition("#")
                owner, name = owner_name(repo)
                got = as_dict(gh(pod, "issues_create_comment", {"owner": owner, "repo": name, "issue_number": int(number), "body": body}))
                url = got.get("html_url")
            else:
                channel, _, ts = str(r["target"]).partition(":")
                pod.connectors.execute("slack", "chat_post_message", {"body": {"channel": channel, "thread_ts": ts, "text": body}})
        except Exception as exc:  # noqa: BLE001 - say why, offer again
            pod.table("release_note_reply").update(r["id"], {"state": "failed", "error": clip(str(exc), 1000), "body": body})
            return ReleaseNotesSendReplyResult(sent=False, message=f"Couldn't send: {clip(str(exc), 300)}")
    pod.table("release_note_reply").update(r["id"], {"state": "sent", "sent_by": me, "sent_at": now, "url": url, "error": None, "body": body})
    pod.table("ask").update(r["ask_id"], {"state": "told", "told_at": now})
    where = "on the issue" if r["channel"] == "github" else "in their Slack thread"
    return ReleaseNotesSendReplyResult(sent=True, url=url, message=("Sample: marked sent; nothing was posted." if r.get("sample")
                                                                    else f"Posted {where}."))
