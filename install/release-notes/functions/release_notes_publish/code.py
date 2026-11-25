#input_type_name: ReleaseNotesPublishInput
#output_type_name: ReleaseNotesPublishResult
#function_name: release_notes_publish

"""Publish a note, as the person who pressed Publish (on the platform's main,
a function's GitHub and Slack calls go out as the person whose run it is).

To each place the person ticked:

- `github`: the release for the note's tag, made or updated
  (`repos_get_release_by_tag`, then `repos_update_release` or
  `repos_create_release` with `target_commitish` the deployed commit);
- `page`: a `release_note_page` row (Public), what the changelog app shows,
  with the brand as Brand kit has it now (the page cannot read `brand`);
- `slack`: the note posted to the set-up's channel by the Lemma's Slack app.

Then every ask linked to the note's lines moves to `shipped` (`shipped_in`,
`shipped_at`), which each member's own trigger on `ask` turns into a reply
drafted in their thread (release_notes_tell); asks nobody heard privately (a
public GitHub issue, a Slack thread) get a `release_note_reply` proposed here,
which waits for Send. A place that fails is said and the rest go on; publishing
again updates the same release, page row and asks, and never posts to Slack
twice.
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

SECTIONS = {"lead": 0, "need": 1, "improved": 2, "fixed": 3}
HEADS = {"improved": "Improved", "fixed": "Fixed"}


class ReleaseNotesPublishInput(BaseModel):
    note_id: str
    github: bool = True
    page: bool = True
    slack: bool = True


class ReleaseNotesPublishResult(BaseModel):
    published: bool
    sent: list
    shipped: int = 0
    replies: int = 0
    message: str


def _lines(pod, note_id: str) -> list:
    lines = q(pod, f"SELECT * FROM release_note_line WHERE note_id = {lit(note_id)} AND hidden IS NOT TRUE LIMIT 500")
    return sorted(lines, key=lambda ln: (SECTIONS.get(ln["section"], 9), int(ln.get("position") or 0)))


def _live_only(pod, note: dict, lines: list) -> tuple[list, list]:
    """Split the lines into those that reached people and those that haven't yet.

    A note says only what is live. Once the note knows what was deployed
    (`live_at`), a line none of whose pull requests is live is held back: it is
    not on the release, the page or Slack, and no ask moves to shipped for it.
    The release is cut at the deployed commit, so those pull requests fall in
    the next release's range and its draft picks them up. A note with no live
    signal (published by hand before any deploy) is published as it stands.
    """
    if not note.get("live_at"):
        return lines, []
    numbers = sorted({int(n) for x in lines for n in (jl(x.get("prs"), []) or [])})
    if not numbers:
        return lines, []
    live = {int(p["number"]) for p in q(pod, f"SELECT number FROM release_note_pr WHERE repo = {lit(note['repo'])} "
                                             f"AND number IN ({lits(numbers)}) AND live_at IS NOT NULL LIMIT 500")}
    keep, held = [], []
    for x in lines:
        prs = {int(n) for n in (jl(x.get("prs"), []) or [])}
        (held if prs and not prs & live else keep).append(x)
    return keep, held


def markdown(note: dict, lines: list) -> str:
    out = []
    if note.get("title"):
        out.append(f"## {note['title']}\n")
    for ln in [x for x in lines if x["section"] == "lead"]:
        out.append(f"### {ln.get('title') or ln['text']}\n")
        if ln.get("title"):
            out.append(ln["text"] + "\n")
    need = [x for x in lines if x["section"] == "need"]
    if need:
        out.append("**You need to:** " + " ".join(x["text"] for x in need) + "\n")
    for section, head in HEADS.items():
        part = [x for x in lines if x["section"] == section]
        if part:
            out.append(f"#### {head}\n" + "\n".join(f"- {x['text']}" for x in part) + "\n")
    return "\n".join(out).strip() + "\n"


def slack_text(note: dict, lines: list, product: str, page_url) -> str:
    leads = [x for x in lines if x["section"] == "lead"]
    rest = [x for x in lines if x["section"] in ("improved", "fixed")]
    need = [x for x in lines if x["section"] == "need"]
    parts = [f"*{product} {note['name']}*" + (f": {note['title']}" if note.get("title") else "")]
    parts += [f"• *{x.get('title') or x['text']}*" + (f" {x['text']}" if x.get("title") else "") for x in leads]
    if need:
        parts.append("*You need to:* " + " ".join(x["text"] for x in need))
    if rest:
        parts.append(f"Also {len(rest)} smaller change{'s' if len(rest) != 1 else ''}.")
    if page_url:
        parts.append(f"<{page_url}|Read the whole note>")
    return "\n".join(parts)


def release_notes_publish(ctx: FunctionContext, data: ReleaseNotesPublishInput) -> ReleaseNotesPublishResult:
    pod = ctx.pod
    me = str(ctx.user_id) if ctx.user_id else None
    found = q(pod, f"SELECT * FROM release_note WHERE id = {lit(data.note_id)}")
    if not found:
        return ReleaseNotesPublishResult(published=False, sent=[], message="No such note.")
    note = found[0]
    settings = settings_of(pod)
    publishers = {str(p.get("user_id")) for p in settings.get("publishers") or []}
    if publishers and me not in publishers:
        return ReleaseNotesPublishResult(published=False, sent=[], message="Only the people set up as publishers can publish.")
    lines, held = _live_only(pod, note, _lines(pod, note["id"]))
    if not lines:
        return ReleaseNotesPublishResult(published=False, sent=[], message="Nothing in the note is live yet." if held
                                         else "The note has no lines yet.")
    product = settings.get("product") or note["repo"].split("/")[-1]
    sample = bool(note.get("sample"))
    sent = list(jl(note.get("sent"), []) or [])
    said = {s.get("to"): s for s in sent}
    now = now_iso()
    patch: dict = {}

    def done(to: str, ok: bool, text: str, url=None):
        said[to] = {"to": to, "ok": ok, "text": text, "url": url, "at": now}

    if data.github:
        if sample:
            done("github", True, "Sample: no GitHub release was made")
        else:
            owner, name = owner_name(note["repo"])
            tag = note.get("tag") or note["name"]
            body = {"tag_name": tag, "name": f"{note['name']}" + (f": {note['title']}" if note.get("title") else ""),
                    "body": markdown(note, lines)}
            try:
                existing = None
                try:
                    existing = as_dict(gh(pod, "repos_get_release_by_tag", {"owner": owner, "repo": name, "tag": tag}))
                except Exception:  # noqa: BLE001 - none yet
                    existing = None
                if existing and existing.get("id"):
                    rel = as_dict(gh(pod, "repos_update_release", {"owner": owner, "repo": name,
                                                                    "release_id": existing["id"], **body}))
                else:
                    if note.get("to_sha"):
                        body["target_commitish"] = note["to_sha"]
                    rel = as_dict(gh(pod, "repos_create_release", {"owner": owner, "repo": name, **body}))
                patch.update({"github_release_id": str(rel.get("id") or ""), "github_release_url": rel.get("html_url")})
                done("github", True, f"GitHub release {tag} on {note['repo']}", rel.get("html_url"))
            except Exception as exc:  # noqa: BLE001 - say it, go on
                done("github", False, f"GitHub release: {clip(str(exc), 200)}")

    if data.page:
        brand = q(pod, "SELECT name, colors, fonts, tokens FROM brand WHERE state IN ('check', 'ready') "
                       "ORDER BY is_default DESC, updated_at DESC LIMIT 1")
        b = brand[0] if brand else {}
        need = " ".join(x["text"] for x in lines if x["section"] == "need") or None
        page = {"id": note.get("page_id") or rid("page", note["id"]), "published_on": now[:10], "version": note["name"],
                "title": note.get("title") or note["name"],
                "lines": [{"section": x["section"], "title": x.get("title"), "text": x["text"], "asked": int(x.get("asked") or 0)}
                          for x in lines if x["section"] != "need"],
                "need": need, "asked_total": sum(int(x.get("asked") or 0) for x in lines),
                "product": product, "brand": {"name": b.get("name"), "tokens": jl(b.get("tokens"), None),
                                              "colors": jl(b.get("colors"), None), "fonts": jl(b.get("fonts"), None)} if b else None,
                "sample": sample}
        try:
            pod.records.bulk_create("release_note_page", [page], upsert=True)
            patch["page_id"] = page["id"]
            done("page", True, "Changelog page", settings.get("page_url"))
        except Exception as exc:  # noqa: BLE001
            done("page", False, f"Changelog page: {clip(str(exc), 200)}")

    if data.slack and settings.get("slack_channel"):
        if sample:
            done("slack", True, f"Sample: nothing was posted to #{settings.get('slack_channel_name') or 'the channel'}")
        elif note.get("slack_ts"):
            done("slack", True, f"Already posted to #{settings.get('slack_channel_name') or settings['slack_channel']}")
        else:
            try:
                got = as_dict(as_dict(pod.connectors.execute("slack", "chat_post_message", {"body": {
                    "channel": settings["slack_channel"], "text": slack_text(note, lines, product, settings.get("page_url")),
                    "unfurl_links": False}})).get("result"))
                ts = got.get("ts") or as_dict(got.get("message")).get("ts")
                patch["slack_ts"] = ts
                done("slack", True, f"Slack #{settings.get('slack_channel_name') or settings['slack_channel']}")
            except Exception as exc:  # noqa: BLE001
                done("slack", False, f"Slack: {clip(str(exc), 200)}")

    if any(s.get("ok") is False for s in said.values()) and not any(s.get("ok") for s in said.values()):
        pod.table("release_note").update(note["id"], {**patch, "sent": list(said.values())})
        return ReleaseNotesPublishResult(published=False, sent=list(said.values()), message="Nothing was published: " + "; ".join(
            s["text"] for s in said.values() if not s.get("ok")))

    patch.update({"state": "published", "published_at": note.get("published_at") or now, "published_by": me,
                  "sent": list(said.values())})
    pod.table("release_note").update(note["id"], patch)

    # Held lines leave this note, and their pull requests go back to no note,
    # so the next release's draft (which reads its range) writes them again.
    if held:
        pod.records.bulk_update("release_note_line", [{"id": x["id"], "hidden": True} for x in held], intent="normal")
        numbers = sorted({int(n) for x in held for n in (jl(x.get("prs"), []) or [])})
        prs = q(pod, f"SELECT id FROM release_note_pr WHERE repo = {lit(note['repo'])} AND number IN ({lits(numbers)}) "
                     f"AND note_id = {lit(note['id'])} LIMIT 500")
        if prs:
            pod.records.bulk_update("release_note_pr", [{"id": p["id"], "note_id": None} for p in prs], intent="normal")

    # The asks this note answers: shipped, and a reply proposed where nobody heard them privately.
    refs = sorted({r for x in lines for r in (jl(x.get("issues"), []) or [])}
                  | {issue_ref(note["repo"], n) for x in lines for n in (jl(x.get("prs"), []) or [])})
    asks = q(pod, f"SELECT * FROM ask WHERE work_id IN ({lits(refs)}) AND state IN ('open', 'shipped') LIMIT 2000") if refs else []
    line_of = {}
    for x in lines:
        for r in (jl(x.get("issues"), []) or []) + [issue_ref(note["repo"], n) for n in (jl(x.get("prs"), []) or [])]:
            line_of.setdefault(r, x)
    moved = [{"id": a["id"], "state": "shipped", "shipped_in": note["name"], "shipped_at": a.get("shipped_at") or now}
             for a in asks if a.get("state") == "open"]
    for start in range(0, len(moved), 100):
        pod.records.bulk_update("ask", moved[start: start + 100], intent="normal")
    replies = []
    have = {r["id"] for r in q(pod, f"SELECT id FROM release_note_reply WHERE id IN ({lits([a['id'] for a in asks])})")} if asks else set()
    for a in asks:
        if a.get("heard_by") or a["id"] in have or a.get("source") not in ("github", "slack"):
            continue
        x = line_of.get(a["work_id"]) or {}
        what = x.get("title") or x.get("text") or a.get("work_title") or "what you asked for"
        if a["source"] == "github":
            target = a["work_id"]
            body = (f"This shipped in {product} {note['name']}: {what.rstrip('.')}."
                    + (f" {x['text']}" if x.get("title") else "")
                    + (f"\n\nThe whole note: {settings['page_url']}" if settings.get("page_url") else "")
                    + "\n\nThank you for asking for it.")
        else:
            target = a.get("source_id") or ""
            body = (f"This is out now in {note['name']}: {what.rstrip('.')}."
                    + (f" {x['text']}" if x.get("title") else "") + " Thanks for asking for it.")
        replies.append({"id": a["id"], "ask_id": a["id"], "note_id": note["id"], "channel": a["source"], "target": target,
                        "body": clip(body, 4000), "state": "proposed", "sample": sample})
    if replies:
        pod.records.bulk_create("release_note_reply", replies, upsert=True)
    places = ", ".join(s["text"] for s in said.values() if s.get("ok"))
    failed = "; ".join(s["text"] for s in said.values() if s.get("ok") is False)
    return ReleaseNotesPublishResult(published=True, sent=list(said.values()), shipped=len(moved), replies=len(replies),
                                     message=f"Published {note['name']}: {places}." + (f" Not done: {failed}." if failed else "")
                                     + f" {len(moved)} ask(s) shipped, {len(replies)} public repl{'y' if len(replies) == 1 else 'ies'} drafted."
                                     + (f" Held for the next release, not live yet: {len(held)} line(s)." if held else ""))
