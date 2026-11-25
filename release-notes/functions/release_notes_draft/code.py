#input_type_name: ReleaseNotesDraftInput
#output_type_name: ReleaseNotesDraftResult
#function_name: release_notes_draft

"""Redraft the open note, in two steps around the writer agent.

`brief` (before the writer) works out what the note is made of:

- the pull requests since the last release: `repos_compare_commits` from the
  note's `from_ref` to the default branch, read for "(#123)" and "Merge pull
  request #123" (pull requests the table does not know yet are the nightly
  reconcile's); a sample note, or one GitHub could not compare, uses the
  pull requests already hung on it;
- folds out routine and internal work, and anything a person left out;
- groups pull requests that close the same issue into one line, so "export
  button" and "stream large exports" are told together;
- which one to three lead the note: one Decisions call (a multi-choice over
  the user-facing changes, with how many asked for each);
- keeps every line a person edited, and leaves their pull requests out of
  what the writer sees, so an edit is never rewritten;
- the team's voice: the default brand's `voice` from Brand kit, if any.

`save` (after the writer) writes the lines the writer wrote, one per group,
keeps the edited ones as they are, counts `asked` per line from `ask` (open,
shipped or told; one per person) and the plain summary per pull request, and
stamps the note. A writer that failed leaves the old lines and says why.
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

LEAD_INSTRUCTION = """You are choosing what a product's release note leads with. The evidence lists the changes in this release that people using the product will notice, each with its pull requests' titles, the issues it closes, and how many people asked for it.
Pick the one to three changes people would most want to hear about first: new things they can do, and long-asked-for changes, before small improvements. A fix leads only when many people asked for it."""
MERGE_PR = _re.compile(r"Merge pull request #(\d+)|\(#(\d+)\)\s*$", _re.M)


class ReleaseNotesDraftInput(BaseModel):
    mode: str = "brief"
    note_id: str | None = None
    # save: the brief's groups and what the writer wrote.
    groups: list | None = None
    written: dict | None = None


class ReleaseNotesDraftResult(BaseModel):
    skip: bool = False
    note_id: str | None = None
    brief: dict | None = None
    groups: list | None = None
    lines: int = 0
    message: str


def _note(pod, note_id) -> dict | None:
    if note_id:
        found = q(pod, f"SELECT * FROM release_note WHERE id = {lit(note_id)}")
        return found[0] if found else None
    found = q(pod, "SELECT n.* FROM release_note n WHERE n.state <> 'published' ORDER BY n.updated_at DESC LIMIT 1")
    return found[0] if found else None


def _since_tag(pod, note: dict) -> set | None:
    """Pull request numbers merged since the note's last release, or None when GitHub can't say."""
    if note.get("sample") or not note.get("from_ref"):
        return None
    owner, name = owner_name(note["repo"])
    try:
        repo = as_dict(gh(pod, "repos_get", {"owner": owner, "repo": name}))
        head = repo.get("default_branch") or "main"
        got = as_dict(gh(pod, "repos_compare_commits", {"owner": owner, "repo": name,
                                                        "basehead": f"{note['from_ref']}...{head}", "per_page": 250}))
    except Exception:  # noqa: BLE001
        return None
    numbers = set()
    for c in got.get("commits") or []:
        message = as_dict(c.get("commit")).get("message") or ""
        for m in MERGE_PR.finditer(message.split("\n")[0] + "\n" + message):
            numbers.add(int(m.group(1) or m.group(2)))
    return numbers


def _asked(pod, refs: list) -> dict:
    """ref -> set of handles who asked for that work (open, shipped or told)."""
    if not refs:
        return {}
    out: dict = {}
    for r in q(pod, f"SELECT work_id, handle_kind, handle FROM ask WHERE work_id IN ({lits(refs)}) "
                    f"AND state IN ({lits(COUNTED)}) LIMIT 5000"):
        out.setdefault(r["work_id"], set()).add(f"{r['handle_kind']}:{r['handle']}")
    return out


def _groups(prs: list, asked: dict) -> list:
    """Pull requests that close the same issue are one line."""
    groups: list = []
    by_issue: dict = {}
    for pr in sorted(prs, key=lambda p: int(p["number"])):
        closes = [c.get("ref") for c in (jl(pr.get("closes"), []) or []) if c.get("ref")]
        target = next((by_issue[c] for c in closes if c in by_issue), None)
        if target is None:
            target = {"key": f"pr{pr['number']}", "prs": [], "issues": [], "titles": []}
            groups.append(target)
        target["prs"].append(pr)
        for c in jl(pr.get("closes"), []) or []:
            if c.get("ref") and c["ref"] not in target["issues"]:
                target["issues"].append(c["ref"])
                target["titles"].append(c.get("title"))
            if c.get("ref"):
                by_issue[c["ref"]] = target
    for g in groups:
        kinds = [p.get("kind") for p in g["prs"]]
        g["kind"] = ("breaking" if "breaking" in kinds else "feature" if "feature" in kinds
                     else "improvement" if "improvement" in kinds else "fix")
        refs = g["issues"] + [issue_ref(p["repo"], p["number"]) for p in g["prs"]]
        who: set = set()
        for r in refs:
            who |= asked.get(r, set())
        g["asked"] = len(who)
    return groups


def _brief(pod, note: dict) -> ReleaseNotesDraftResult:
    settings = settings_of(pod)
    numbers = _since_tag(pod, note)
    prs = q(pod, f"SELECT * FROM release_note_pr WHERE repo = {lit(note['repo'])} AND "
                 f"(note_id = {lit(note['id'])}{' OR number IN (' + lits(sorted(numbers)) + ')' if numbers else ''}) "
                 "ORDER BY number LIMIT 500")
    if numbers is not None:
        prs = [p for p in prs if int(p["number"]) in numbers or p.get("note_id") == note["id"] and p.get("sample")]
        moved = [{"id": p["id"], "note_id": note["id"]} for p in prs if p.get("note_id") != note["id"]]
        if moved:
            pod.records.bulk_update("release_note_pr", moved)
    lines = q(pod, f"SELECT * FROM release_note_line WHERE note_id = {lit(note['id'])} ORDER BY section, position")
    kept = [ln for ln in lines if ln.get("edited_by")]
    covered = {int(n) for ln in kept for n in (jl(ln.get("prs"), []) or [])}
    shown = [p for p in prs if p.get("kind") in IN_NOTE and not p.get("left_out") and int(p["number"]) not in covered]
    refs = sorted({c.get("ref") for p in shown for c in (jl(p.get("closes"), []) or []) if c.get("ref")}
                  | {issue_ref(p["repo"], p["number"]) for p in shown})
    groups = _groups(shown, _asked(pod, refs))
    leads: list = []
    candidates = [g for g in groups if g["kind"] in ("feature", "improvement") or g["asked"] >= 3]
    if len(candidates) == 1:
        leads = [candidates[0]["key"]]
    elif len(candidates) > 1:
        options = [{"const": g["key"], "description": clip(" / ".join(p["title"] for p in g["prs"]), 120)} for g in candidates[:60]]
        got = decide(pod, LEAD_INSTRUCTION, {"type": "object", "properties": {"lead": {
            "type": "array", "uniqueItems": True, "description": "Which one to three changes should the note lead with?",
            "items": {"type": "string", "oneOf": options}}}}, {
            "changes": [{"key": g["key"], "kind": g["kind"], "asked": g["asked"],
                         "pull_requests": [p["title"] for p in g["prs"]], "issues": [t for t in g["titles"] if t]}
                        for g in candidates[:60]]})
        leads = [k for k in ((got.get("answers") or {}).get("lead") or []) if isinstance(k, str)][:3]
        if not leads:  # unsure or failed: the most asked-for new thing
            leads = [max(candidates, key=lambda g: (g["asked"], g["kind"] == "feature"))["key"]]
    for g in groups:
        g["section"] = "need" if g["kind"] == "breaking" else "lead" if g["key"] in leads else (
            "fixed" if g["kind"] == "fix" else "improved")
    brand = q(pod, "SELECT name, voice FROM brand WHERE state IN ('check', 'ready') ORDER BY is_default DESC, updated_at DESC LIMIT 1")
    brief = {
        "product": settings.get("product") or (brand[0]["name"] if brand else None) or note["repo"].split("/")[-1],
        "version": note["name"],
        "voice": (brand[0].get("voice") if brand else None) or None,
        "changes": [{"key": g["key"], "section": g["section"], "asked": g["asked"],
                     "pull_requests": [{"number": p["number"], "title": p["title"], "labels": jl(p.get("labels"), []),
                                        "description": clip(p.get("body"), 1500)} for p in g["prs"]],
                     "issues": [t for t in g["titles"] if t]} for g in groups],
        "kept_lines": [{"section": ln["section"], "title": ln.get("title"), "text": ln["text"]} for ln in kept],
    }
    slim = [{"key": g["key"], "section": g["section"], "asked": g["asked"], "prs": [int(p["number"]) for p in g["prs"]],
             "issues": g["issues"]} for g in groups]
    if not groups and not kept:
        return ReleaseNotesDraftResult(skip=True, note_id=note["id"], groups=[],
                                       message=f"{note['name']}: nothing people would notice has merged yet.")
    if not groups:
        _save(pod, note, [], {})
        return ReleaseNotesDraftResult(skip=True, note_id=note["id"], groups=[],
                                       message=f"{note['name']}: only edited lines; nothing to write.")
    return ReleaseNotesDraftResult(note_id=note["id"], brief=brief, groups=slim,
                                   message=f"{note['name']}: {len(groups)} change(s) to write, {len(kept)} edited line(s) kept.")


def _save(pod, note: dict, groups: list, written: dict) -> int:
    lines = q(pod, f"SELECT * FROM release_note_line WHERE note_id = {lit(note['id'])}")
    kept = {ln["id"]: ln for ln in lines if ln.get("edited_by")}
    by_key = {str(w.get("key")): w for w in (written.get("lines") or []) if isinstance(w, dict) and w.get("key")}
    new, order = [], {"lead": 0, "need": 0, "improved": 0, "fixed": 0}
    for ln in kept.values():
        order[ln["section"]] = max(order[ln["section"]], int(ln.get("position") or 0) + 1)
    for g in groups:
        w = by_key.get(str(g["key"]))
        if not w or not str(w.get("text") or "").strip():
            continue
        section = g["section"] if g["section"] in order else "improved"
        line_id = rid("line", note["id"], g["key"])
        if line_id in kept:
            continue
        new.append({"id": line_id, "note_id": note["id"], "section": section, "position": order[section],
                    "title": clip(w.get("title"), 200) if section in ("lead", "need") and w.get("title") else None,
                    "text": clip(w.get("text"), 2000), "prs": g["prs"], "issues": g["issues"], "asked": int(g.get("asked") or 0),
                    "hidden": False, "sample": bool(note.get("sample"))})
        order[section] += 1
    stale = [ln["id"] for ln in lines if not ln.get("edited_by") and ln["id"] not in {n["id"] for n in new}]
    for start in range(0, len(stale), 100):
        pod.records.bulk_delete("release_note_line", stale[start: start + 100])
    if new:
        pod.records.bulk_create("release_note_line", new, upsert=True)
    # asked, again, for the lines a person kept
    if kept:
        refs = sorted({r for ln in kept.values() for r in (jl(ln.get("issues"), []) or [])}
                      | {issue_ref(note["repo"], n) for ln in kept.values() for n in (jl(ln.get("prs"), []) or [])})
        asked = _asked(pod, refs)
        upd = []
        for ln in kept.values():
            who: set = set()
            for r in (jl(ln.get("issues"), []) or []) + [issue_ref(note["repo"], n) for n in (jl(ln.get("prs"), []) or [])]:
                who |= asked.get(r, set())
            if len(who) != int(ln.get("asked") or 0):
                upd.append({"id": ln["id"], "asked": len(who)})
        if upd:
            pod.records.bulk_update("release_note_line", upd)
    summaries = [{"id": pr_id(note["repo"], s["number"]), "summary": clip(s.get("summary"), 600)}
                 for s in (written.get("summaries") or []) if isinstance(s, dict) and s.get("number") and s.get("summary")]
    if summaries:
        pod.records.bulk_update("release_note_pr", summaries)
    patch = {"drafted_at": now_iso(), "draft_error": None}
    if written.get("title"):
        patch["title"] = clip(written["title"], 300)
    pod.table("release_note").update(note["id"], patch)
    return len(new)


def release_notes_draft(ctx: FunctionContext, data: ReleaseNotesDraftInput) -> ReleaseNotesDraftResult:
    pod = ctx.pod
    note = _note(pod, data.note_id)
    if not note:
        return ReleaseNotesDraftResult(skip=True, message="No open note to draft.")
    if note.get("state") == "published":
        return ReleaseNotesDraftResult(skip=True, note_id=note["id"], message=f"{note['name']} is published; it is not redrafted.")
    if data.mode == "brief":
        return _brief(pod, note)
    written = data.written or {}
    if isinstance(written.get("answer"), dict):
        written = written["answer"]
    if not written.get("lines"):
        pod.table("release_note").update(note["id"], {"draft_error": "The writer wrote nothing this time; the note is as it was."})
        return ReleaseNotesDraftResult(note_id=note["id"], message="The writer wrote nothing; kept the note as it was.")
    n = _save(pod, note, data.groups or [], written)
    return ReleaseNotesDraftResult(note_id=note["id"], lines=n, message=f"{note['name']}: wrote {n} line(s).")
