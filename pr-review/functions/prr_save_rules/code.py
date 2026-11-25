#input_type_name: PrrSaveRulesInput
#output_type_name: PrrSaveRulesResult
#function_name: prr_save_rules

"""Keep the rules the scout proposed, as code checks them.

- A rule from a file must quote the file: its quote is looked for at the line
  the scout named (and near it), else anywhere in that file; found, its
  source is `path:line` where code found it; not found, it is dropped. Its
  scope stays inside what the file applies to (a nested AGENTS.md's folder,
  an instructions file's `applyTo`).
- A rule from review comments must quote at least two comments on two pull
  requests, word for word; who said it and where come from the comments
  themselves, not the model.
- Everything enters `proposed`, unless the person chose at set-up to accept
  the rules read from files (`accept_file_rules`). A rule a person already
  accepted, paused or retired keeps its state; it is only marked seen.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# pr-review:common
# Shared by every PR review function, word for word (bin/common.py).
import hashlib as _hashlib
import inspect as _inspect
import json as _json
import re as _re
import time as _time
import uuid as _uuid
from datetime import datetime as _datetime, timedelta as _timedelta, timezone as _tz

PRR_NS = _uuid.UUID("3f0b6c1e-8a2d-4e57-9c41-7d5e2a9b6f03")
SETTINGS_ID = str(_uuid.uuid5(PRR_NS, "settings"))
PLUGIN = "pr-review"
APP = "pull-requests"
GITHUB = "github"
# Each person's own GitHub (PER_MEMBER): only what is done as them, so it
# carries their name and never the name of whoever shared `github`.
GITHUB_PERSONAL = "github-personal"
CHECK_NAME = "Lemma check"
HOLD_LABEL = "lemma-hold"
SEVERITIES = ("must_fix", "should_fix", "nit")
SEVERITY_ALIASES = {"block": "must_fix", "blocker": "must_fix", "must": "must_fix", "high": "must_fix",
                    "warn": "should_fix", "warning": "should_fix", "should": "should_fix", "medium": "should_fix",
                    "note": "nit", "minor": "nit", "low": "nit", "info": "nit"}
TIER = {"low": 0, "medium": 1, "high": 2}
TIER_NAME = {0: "low", 1: "medium", 2: "high"}
MEDIUM_LINES = 2000
HIGH_LINES = 10000
# A finding's line is "touched" when a push changed a line this close to it.
LINE_WINDOW = 3
CAPS = {"findings": 40, "key_changes": 8, "mechanical": 10, "hunks": 6, "lines_to_read": 30, "ledger": 120,
        "files": 300, "resolved": 100, "cross_pr": 20}
# Lines nobody reads: lockfiles and generated or vendored output. Changed
# lines, but not lines that make a pull request big to review.
NOT_READ = ("**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml", "**/uv.lock", "**/poetry.lock",
            "**/Cargo.lock", "**/go.sum", "**/Gemfile.lock", "**/composer.lock", "**/Pipfile.lock",
            "**/*.min.js", "**/*.min.css", "**/*.snap", "**/*.gen.*", "**/generated/**", "**/vendor/**",
            "**/node_modules/**", "**/__snapshots__/**")
LOCKFILES = ("package-lock.json", "yarn.lock", "pnpm-lock.yaml", "uv.lock", "poetry.lock", "Cargo.lock",
             "go.sum", "Gemfile.lock", "composer.lock", "Pipfile.lock")
# The files rules are read from, and the files a pull request may never
# change and still merge by itself: a pull request can't loosen its own gate.
RULE_NAMES = ("AGENTS.md", "CLAUDE.md", "REVIEW.md")
UPDATE_BOTS = ("dependabot[bot]", "renovate[bot]")
DEFAULT_MERGE = {"paths": ["docs/**", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock", "**/uv.lock"],
                 "max_lines": 40, "max_files": 5, "wait_minutes": 10, "how": "auto", "approve_first": False,
                 "update_bots": list(UPDATE_BOTS), "update_branch_prefix": "lemma/deps-",
                 # A repository with no CI has nothing checking the change, so it
                 # never merges by itself unless someone says it may.
                 "allow_no_checks": False}
HOW = ("auto", "queue", "squash")
LIVE_ROUND = ("queued", "running")


# ---------- ids, rows, text ----------

def rid(*parts) -> str:
    return str(_uuid.uuid5(PRR_NS, ":".join(str(p) for p in parts)))


def key_of(repo: str, number) -> str:
    return f"{repo}#{int(number)}"


def pr_id(key: str) -> str:
    """The contract's id for a pull request: uuid5(PRR_NS, "owner/repo#n")."""
    return str(_uuid.uuid5(PRR_NS, key))


def repo_id(full_name: str) -> str:
    """The contract's id for a repository: uuid5(PRR_NS, "repo:" + full_name.lower())."""
    return str(_uuid.uuid5(PRR_NS, "repo:" + str(full_name).lower()))


def member_id(login: str) -> str:
    return str(_uuid.uuid5(PRR_NS, "member:" + str(login).lower()))


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
    if isinstance(value, _datetime):
        return value if value.tzinfo else value.replace(tzinfo=_tz.utc)
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def clip(text, n: int):
    text = (str(text) if text is not None else "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def to_int(value):
    try:
        return int(value) if value is not None and value != "" else None
    except (TypeError, ValueError):
        return None


def owner_name(repo: str):
    owner, _, name = str(repo).partition("/")
    return owner, name


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def put(pod, table: str, row: dict) -> None:
    pod.records.bulk_create(table, [row], upsert=True)


def patch(pod, table: str, row_id: str, fields: dict) -> None:
    if fields:
        pod.records.bulk_update(table, [dict(fields, id=row_id)])


# ---------- globs and paths ----------

_GLOBS: dict = {}


def _glob_re(pattern: str):
    found = _GLOBS.get(pattern)
    if found is not None:
        return found
    p = pattern.strip()
    if p.startswith("./"):
        p = p[2:]
    p = p.lstrip("/")
    if p.endswith("/"):
        p += "**"
    out, i = [], 0
    while i < len(p):
        if p.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif p.startswith("**", i):
            out.append(".*")
            i += 2
        elif p[i] == "*":
            out.append("[^/]*")
            i += 1
        elif p[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(_re.escape(p[i]))
            i += 1
    found = _re.compile("^" + "".join(out) + "$")
    _GLOBS[pattern] = found
    return found


def match_glob(path, pattern) -> bool:
    """A git-style glob: `**` crosses folders, `*` doesn't, and a pattern with
    no slash (`*.md`, `CODEOWNERS`) matches a file of that name anywhere."""
    path = str(path or "")
    if path.startswith("./"):
        path = path[2:]
    pattern = str(pattern or "").strip()
    if not path or not pattern:
        return False
    rx = _glob_re(pattern)
    if "/" not in pattern.strip("/"):
        return bool(rx.match(path) or rx.match(path.rsplit("/", 1)[-1]))
    return bool(rx.match(path))


def match_any(path, globs) -> bool:
    return any(match_glob(path, g) for g in (globs or []))


def unread(path) -> bool:
    """A lockfile, generated or vendored file: not counted as lines to read."""
    return match_any(path, NOT_READ)


def is_lockfile(path) -> bool:
    return str(path or "").rsplit("/", 1)[-1] in LOCKFILES


def apply_to(text) -> list:
    """The `applyTo` globs of a .github/instructions file's front matter; [] for all."""
    m = _re.match(r"^﻿?---\s*\n(.*?)\n---\s*(?:\n|$)", str(text or ""), _re.S)
    if not m:
        return []
    for line in m.group(1).splitlines():
        k, _, v = line.partition(":")
        if k.strip() == "applyTo":
            v = v.strip().strip("'\"")
            globs = [g.strip().strip("'\"") for g in v.split(",") if g.strip().strip("'\"")]
            return [] if any(g in ("**", "**/*", "*") for g in globs) else globs
    return []


def rule_file(path, text=None):
    """(kind, scope) when `path` is a file rules are read from, else None.

    AGENTS.md, CLAUDE.md and REVIEW.md apply to their folder (the root: every
    file); CONTRIBUTING.md at the root, in .github/ or docs/ applies to every
    file; .github/copilot-instructions.md to every file;
    .github/instructions/*.instructions.md to its `applyTo` globs; a
    .cursor/BUGBOT.md to the folder that holds the .cursor folder.
    """
    path = str(path or "").lstrip("/")
    if not path or any(part in ("node_modules", "vendor", ".git") for part in path.split("/")):
        return None
    folder, _, name = path.rpartition("/")
    under = (lambda d: [f"{d}/**"] if d else [])
    if name in RULE_NAMES:
        return ("file", under(folder))
    if name == "CONTRIBUTING.md" and folder in ("", ".github", "docs"):
        return ("file", [])
    if path == ".github/copilot-instructions.md":
        return ("file", [])
    if folder == ".github/instructions" and name.endswith(".instructions.md"):
        return ("instructions", apply_to(text))
    if name == "BUGBOT.md" and (folder == ".cursor" or folder.endswith("/.cursor")):
        return ("file", under(folder[: -len(".cursor")].rstrip("/")))
    return None


def gate_path(path) -> bool:
    """A file a pull request may never change and still merge by itself: a
    rule file, CODEOWNERS anywhere, or anything under .github/."""
    path = str(path or "").lstrip("/")
    name = path.rsplit("/", 1)[-1]
    if path.startswith(".github/") or name == "CODEOWNERS":
        return True
    if name in RULE_NAMES or name in ("CONTRIBUTING.md", "BUGBOT.md"):
        return True
    return rule_file(path) is not None


def scoped(globs, under) -> list:
    """A rule's globs, kept inside the folder its file applies to."""
    globs = [str(g).strip() for g in (globs or []) if str(g).strip()][:10]
    if not under:
        return globs
    if not globs or any(g in ("**", "*", "**/*") for g in globs):
        return list(under)
    out = []
    for g in globs:
        for base in under:
            root = base[:-3] if base.endswith("/**") else base
            out.append(g if g.startswith(root + "/") else f"{root}/{g.lstrip('/')}")
    return out[:10]


# ---------- which lines a push touched ----------

_HUNK = _re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def _ranges(lines) -> list:
    out = []
    for n in sorted(set(lines)):
        if out and n <= out[-1][1] + 1:
            out[-1][1] = n
        else:
            out.append([n, n])
    return out


def patch_ranges(patch):
    """The new file's lines a unified diff touched, as [[start, end], ...].
    A deletion touches the lines either side of where it was. A file GitHub
    sends no patch for (binary, too big) is touched whole: "*"."""
    if patch is None:
        return "*"
    touched, new = set(), 0
    for raw in str(patch).splitlines():
        m = _HUNK.match(raw)
        if m:
            new = int(m.group(1))
            continue
        if raw.startswith("+"):
            touched.add(new)
            new += 1
        elif raw.startswith("-"):
            touched.update(n for n in (new - 1, new) if n >= 1)
        elif raw.startswith("\\"):
            continue
        else:
            new += 1
    return _ranges(touched)


def diff_lines(patch) -> set:
    """Every new-file line inside a diff's hunks (added or context): the lines
    GitHub takes a review comment on."""
    lines, new = set(), 0
    for raw in str(patch or "").splitlines():
        m = _HUNK.match(raw)
        if m:
            new = int(m.group(1))
            continue
        if raw.startswith("-") or raw.startswith("\\"):
            continue
        lines.add(new)
        new += 1
    return lines


def touched_from_files(files) -> dict:
    """{path: ranges or "*"} from a compare's or a pull request's file list."""
    out: dict = {}
    for f in files or []:
        path = f.get("filename") or f.get("path")
        if not path:
            continue
        if f.get("status") == "removed":
            out[path] = "*"
            continue
        out[path] = patch_ranges(f.get("patch"))
        prev = f.get("previous_filename") or f.get("previous")
        if prev:
            out[prev] = "*"
    return out


def line_touched(touched, path, line=None, end_line=None, window: int = LINE_WINDOW) -> bool:
    """Did the push change this place? `touched` None means unknown: yes."""
    if touched is None:
        return True
    ranges = touched.get(path) if path else None
    if ranges is None:
        return False
    if ranges == "*" or line is None:
        return True
    lo, hi = int(line) - window, int(end_line or line) + window
    return any(start <= hi and end >= lo for start, end in ranges)


# ---------- findings matched across pushes ----------

def norm_title(text) -> str:
    return " ".join(_re.findall(r"[a-z0-9]+", str(text or "").lower()))


def fingerprint_of(f: dict) -> str:
    given = str(f.get("fingerprint") or "").strip()
    if given:
        return given[:200]
    basis = f"{f.get('rule_id') or f.get('kind') or ''}|{f.get('path') or ''}|{norm_title(f.get('title'))}"
    return "h:" + _hashlib.sha1(basis.encode()).hexdigest()[:16]


def _alt(f: dict):
    return (str(f.get("rule_id") or ""), str(f.get("path") or ""), norm_title(f.get("title")))


def match_findings(existing, proposed, *, resolved=(), touched=None, first_round=True, changed_paths=None,
                   sha="", round_id="", pr: dict | None = None) -> dict:
    """What one round does to a pull request's findings.

    - A proposed finding with a fingerprint (or the same rule, path and title)
      seen before is that row. Dismissed or wrong stays so, whatever the
      model says; open is updated (its line may have moved); fixed opens
      again only if it is back on lines this push touched.
    - A new one on lines this push didn't touch is dropped, after the first
      round: nothing new on untouched lines.
    - An open finding not seen again is fixed (`fixed_in` this commit) when
      this push changed its lines, its file left the pull request, or the
      reviewer said it is resolved in a file this push changed; else it stays
      open. A finding found by code (a migration number two pull requests
      share) is fixed as soon as code stops finding it.

    Returns {creates, updates, counts}; rows are dicts ready to write.
    """
    pr = pr or {}
    resolved = set(resolved or [])
    by_fp = {f.get("fingerprint"): f for f in existing or [] if f.get("fingerprint")}
    by_alt = {_alt(f): f for f in existing or []}
    seen, creates, updates = set(), [], []
    counts = {"new": 0, "kept": 0, "fixed": 0, "kept_dismissed": 0, "dropped_untouched": 0, "reopened": 0}
    for p in proposed or []:
        fp = fingerprint_of(p)
        old = by_fp.get(fp) or by_alt.get(_alt(p))
        fields = {k: p.get(k) for k in ("rule_id", "severity", "path", "line", "end_line", "title", "body", "suggestion")}
        fields.update(last_seen_round=round_id, last_seen_sha=sha)
        if old is not None:
            if old.get("id") in seen:
                continue
            seen.add(old.get("id"))
            state = old.get("state")
            if state in ("dismissed", "wrong"):
                counts["kept_dismissed"] += 1
                updates.append({"id": old["id"], "last_seen_round": round_id, "last_seen_sha": sha})
            elif state == "fixed":
                if first_round or line_touched(touched, p.get("path"), p.get("line"), p.get("end_line")):
                    counts["reopened"] += 1
                    updates.append(dict(fields, id=old["id"], state="open", fixed_in=None))
                else:
                    counts["dropped_untouched"] += 1
            else:
                counts["kept"] += 1
                updates.append(dict(fields, id=old["id"]))
            continue
        if not first_round and p.get("path") and p.get("found_by") != "code" \
                and not line_touched(touched, p.get("path"), p.get("line"), p.get("end_line")):
            counts["dropped_untouched"] += 1
            continue
        row = dict(fields, id=rid("finding", pr.get("key") or pr.get("id") or "", fp), fingerprint=fp,
                   pull_request_id=pr.get("id"), key=pr.get("key"), state="open", found_by=p.get("found_by") or "reviewer",
                   first_round=round_id, first_sha=sha)
        by_fp[fp] = row
        seen.add(row["id"])
        creates.append(row)
        counts["new"] += 1
    changed = set(changed_paths) if changed_paths is not None else None
    for old in existing or []:
        if old.get("state") != "open" or old.get("id") in seen:
            continue
        path = old.get("path")
        gone = bool(path) and changed is not None and path not in changed
        if old.get("found_by") == "code":
            fixed = True
        elif gone:
            fixed = True
        elif first_round:
            fixed = old.get("fingerprint") in resolved
        elif old.get("fingerprint") in resolved:
            fixed = touched is None or (bool(path) and path in touched) or not path
        else:
            fixed = touched is not None and bool(path) and line_touched(touched, path, old.get("line"), old.get("end_line"))
        if fixed:
            counts["fixed"] += 1
            updates.append({"id": old["id"], "state": "fixed", "fixed_in": sha})
        else:
            counts["kept"] += 1
    return {"creates": creates, "updates": updates, "counts": counts}


def apply_updates(existing, plan: dict) -> list:
    """The findings as they stand once `plan` (match_findings) is written."""
    out = {f["id"]: dict(f) for f in existing or []}
    for row in plan.get("creates") or []:
        out[row["id"]] = dict(row)
    for row in plan.get("updates") or []:
        out.setdefault(row["id"], {}).update(row)
    return list(out.values())


# ---------- rules, the ledger, the verdict ----------

def in_scope(rule: dict, paths, repo=None) -> bool:
    """An active rule reaches a pull request when it is for this repository
    (or every one) and a changed file matches its scope (none: every file)."""
    if rule.get("state") != "active":
        return False
    if rule.get("repo") and repo and str(rule["repo"]).lower() != str(repo).lower():
        return False
    globs = jl(rule.get("scope"), []) or []
    if not globs:
        return True
    return any(match_any(p, globs) for p in paths or [])


def build_ledger(rules, answers, findings) -> list:
    """One entry per rule in scope, decided by code: broken when an open
    finding names it (whatever the reviewer said), not_checked when the rule
    can't be checked from a diff, the reviewer didn't answer, or it said
    broken without naming a line; passed only when the reviewer said so and
    nothing open names it. "Checked, fine" and "never looked" never look alike."""
    said = {}
    for a in answers or []:
        if isinstance(a, dict) and a.get("rule_id"):
            said[str(a["rule_id"])] = a
    by_rule: dict = {}
    fixed_by_rule: dict = {}
    for f in findings or []:
        if not f.get("rule_id"):
            continue
        if f.get("state") == "open":
            by_rule.setdefault(str(f["rule_id"]), []).append(f)
        elif f.get("state") == "fixed":
            fixed_by_rule.setdefault(str(f["rule_id"]), []).append(f)
    out = []
    for r in rules or []:
        r_id = str(r.get("id"))
        entry = {"rule_id": r_id, "text": clip(r.get("text"), 300), "severity": r.get("severity")}
        hits = by_rule.get(r_id)
        a = said.get(r_id) or {}
        if hits:
            first = hits[0]
            where = f"{first.get('path')}:{first.get('line')}" if first.get("line") else (first.get("path") or "the change")
            entry.update(state="broken", note=clip(f"Broken · {where}" + (f" and {len(hits) - 1} more" if len(hits) > 1 else ""), 300),
                         finding_ids=[f.get("id") for f in hits][:10])
        elif r.get("checkable") is False:
            entry.update(state="not_checked", note=clip(r.get("not_checkable_why") or "Can't be checked from a diff", 300))
        elif not a:
            entry.update(state="not_checked", note="The review did not answer it")
        elif a.get("state") == "passed":
            fixed = fixed_by_rule.get(r_id)
            note = a.get("note") or ("Passed · fixed in " + str(fixed[0].get("fixed_in") or "")[:7] if fixed else "Passed")
            entry.update(state="passed", note=clip(note, 300))
        elif a.get("state") == "broken":
            entry.update(state="not_checked", note=clip("The review said broken but named no line" + (f": {a['note']}" if a.get("note") else ""), 300))
        else:
            entry.update(state="not_checked", note=clip(a.get("note") or "Not checked", 300))
        out.append(entry)
    return out[: CAPS["ledger"]]


def live_ledger(ledger, findings) -> list:
    """A round's ledger with what people decided since: a rule broken only by
    findings now dismissed, wrong or fixed has passed."""
    state = {f.get("id"): f.get("state") for f in findings or []}
    out = []
    for e in ledger or []:
        e = dict(e)
        ids = e.get("finding_ids") or []
        if e.get("state") == "broken" and ids and all(state.get(i) not in ("open", None) for i in ids):
            e["state"], e["note"] = "passed", "Passed · its findings were dismissed or fixed"
        out.append(e)
    return out


def ledger_counts(ledger) -> dict:
    out = {"passed": 0, "broken": 0, "not_checked": 0}
    for e in ledger or []:
        out[e.get("state") if e.get("state") in out else "not_checked"] += 1
    return out


def verdict_of(open_findings, risk, author_kind) -> str:
    """Code decides: an open must-fix finding means changes; high risk or an
    author from outside the team means a person must look; else clean."""
    if any(f.get("severity") == "must_fix" for f in open_findings or []):
        return "changes"
    if risk == "high" or author_kind == "outside":
        return "needs_person"
    return "clean"


def assess(files, risk_paths, repo=None, additions=None, deletions=None):
    """(risk, reasons) by code: the team's risky paths, then the size with
    lockfiles and generated files not counted."""
    tier, reasons = 0, []
    paths = []
    for f in files or []:
        paths += [p for p in (f.get("path"), f.get("previous")) if p]
    for rp in risk_paths or []:
        if rp.get("state", "active") != "active":
            continue
        if rp.get("repo") and repo and str(rp["repo"]).lower() != str(repo).lower():
            continue
        hits = sorted({p for p in paths if match_glob(p, rp.get("glob"))})
        if not hits:
            continue
        t = rp.get("tier") if rp.get("tier") in ("medium", "high") else "high"
        reasons.append({"source": "path", "glob": rp.get("glob"), "tier": t, "reason": rp.get("reason"),
                        "paths": hits[:6], "count": len(hits), "reviewer_user_id": rp.get("reviewer_user_id"),
                        "reviewer_name": rp.get("reviewer_name")})
        tier = max(tier, TIER[t])
    lines = sum((f.get("additions") or 0) + (f.get("deletions") or 0) for f in files or [] if not unread(f.get("path")))
    if not files and (additions is not None or deletions is not None):
        lines = (additions or 0) + (deletions or 0)
    if lines >= HIGH_LINES:
        reasons.append({"source": "size", "tier": "high", "reason": f"{lines:,} changed lines; too big to read whole"})
        tier = max(tier, 2)
    elif lines >= MEDIUM_LINES:
        reasons.append({"source": "size", "tier": "medium", "reason": f"{lines:,} changed lines"})
        tier = max(tier, 1)
    return TIER_NAME[tier], reasons


def find_member(members, login):
    login = str(login or "").lower()
    for m in members or []:
        if str(m.get("login") or "").lower() == login and login:
            return m
    return None


def author_kind_of(login, user_type, members, head_ref=None, merge=None) -> str:
    """member: someone on the team (prr_member), whoever wrote the code (an
    agent a member ran opens as them). bot: a dependency bot, by login, or a
    bot on Dependency updates' branch. agent: any other bot (the Lemma's own
    App opening an agent's work). outside: anyone else."""
    merge = merge or DEFAULT_MERGE
    login_l = str(login or "").lower()
    ref = str(head_ref or "")
    if find_member(members, login):
        return "member"
    bots = [b.lower() for b in (merge.get("update_bots") or UPDATE_BOTS)]
    prefix = merge.get("update_branch_prefix") or ""
    is_bot = login_l.endswith("[bot]") or str(user_type or "") == "Bot"
    if login_l in bots or (prefix and ref.startswith(prefix) and is_bot):
        return "bot"
    if is_bot:
        return "agent"
    return "outside"


def pick_reviewer(author_user_id, members, risk_reasons, paths):
    """Who reviews, decided by code: whoever a risky path names, then whoever
    owns the changed paths, then anyone who takes reviews; never the author."""
    candidates = []
    for r in risk_reasons or []:
        if r.get("reviewer_user_id"):
            candidates.append((str(r["reviewer_user_id"]), r.get("reviewer_name")))
    for m in members or []:
        if m.get("user_id") and any(match_any(p, jl(m.get("owns"), []) or []) for p in paths or []):
            candidates.append((str(m["user_id"]), m.get("name") or m.get("login")))
    for m in sorted(members or [], key=lambda x: str(x.get("name") or x.get("login") or "")):
        if m.get("user_id") and m.get("reviews") is not False:
            candidates.append((str(m["user_id"]), m.get("name") or m.get("login")))
    for user_id, name in candidates:
        if user_id and user_id != str(author_user_id or ""):
            return user_id, name
    return None, None


def waits_of(pr: dict, verdict, review_state, merging_itself: bool, members, risk_reasons, paths, approvers=()):
    """(waits_on, waits_on_name, waits_for) for an open pull request, by code."""
    if pr.get("state") != "open":
        return "nobody", None, "nothing"
    if review_state in ("queued", "reviewing"):
        return "nobody", None, "round"
    if merging_itself:
        return "nobody", None, "nothing"
    author = find_member(members, pr.get("author")) or {}
    author_id = str(author.get("user_id") or pr.get("author_user_id") or "") or None
    author_name = author.get("name") or pr.get("author")
    reviewer, reviewer_name = pick_reviewer(author_id, members, risk_reasons, paths)
    if review_state == "failed" or not verdict:
        return (reviewer or "nobody"), reviewer_name, "review"
    if verdict == "changes":
        return (author_id or "author"), author_name, "fix"
    if verdict == "needs_person":
        approved = [m for m in (find_member(members, a) for a in approvers or []) if m and m.get("user_id")
                    and str(m["user_id"]) != str(author_id or "")]
        if approved:
            if author_id:
                return author_id, author_name, "merge"
            return str(approved[0]["user_id"]), approved[0].get("name"), "merge"
        return (reviewer or "nobody"), reviewer_name, "review"
    named = [r for r in risk_reasons or [] if r.get("reviewer_user_id") and str(r["reviewer_user_id"]) != str(author_id or "")]
    if named:
        return str(named[0]["reviewer_user_id"]), named[0].get("reviewer_name"), "merge"
    if author_id:
        return author_id, author_name, "merge"
    return (reviewer or "nobody"), reviewer_name, "merge"


# ---------- merging by itself ----------

def merge_settings(settings: dict) -> dict:
    m = dict(DEFAULT_MERGE)
    m.update({k: v for k, v in (jl(settings.get("merge"), {}) or {}).items() if v is not None})
    if m.get("how") not in HOW:
        m["how"] = "auto"
    return m


def merge_conditions(pr: dict, rnd: dict | None, findings, settings: dict, repo: dict, live: dict,
                     merged_today: int = 0, now=None, at_merge: bool = False) -> list:
    """Every condition for merging by itself, checked by code on the latest
    commit and GitHub's live state. One that can't be checked fails: an
    unfinished round is not clean. [{name, ok, detail}]"""
    m = merge_settings(settings)
    now = now or _datetime.now(_tz.utc)
    rnd = rnd or {}
    out = []

    def c(name, ok, detail):
        out.append({"name": name, "ok": bool(ok), "detail": clip(detail, 300)})

    c("open", pr.get("state") == "open" and not pr.get("draft"),
      "Open and ready" if pr.get("state") == "open" and not pr.get("draft") else f"It is {'a draft' if pr.get('draft') else pr.get('state')}")
    done = rnd.get("status") == "done" and rnd.get("sha") and rnd.get("sha") == pr.get("head_sha")
    c("round_finished", done, "The review of this commit finished" if done else "No finished review of the latest commit")
    files = jl(rnd.get("files"), []) or []
    paths = []
    for f in files:
        paths += [p for p in (f.get("path"), f.get("previous")) if p]
    allowed = m.get("paths") or []
    outside = [p for p in paths if not match_any(p, allowed)]
    if not allowed:
        c("paths", False, "No allowed paths are set")
    elif not files:
        c("paths", False, "The changed files are unknown")
    else:
        c("paths", not outside, "Every changed file is in an allowed path" if not outside
          else f"{plural(len(outside), 'file')} outside the allowed paths, e.g. {outside[0]}")
    counted = [f for f in files if not unread(f.get("path"))]
    lines = sum((f.get("additions") or 0) + (f.get("deletions") or 0) for f in counted)
    max_lines, max_files = int(m.get("max_lines") or 0), int(m.get("max_files") or 0)
    c("size", bool(files) and lines <= max_lines and len(counted) <= max_files,
      f"{plural(lines, 'line')} in {plural(len(counted), 'file')}, lockfiles and generated files not counted "
      f"(at most {max_lines} and {max_files})")
    ledger = jl(rnd.get("ledger"), []) or []
    ledger = live_ledger(ledger, findings)
    counts = ledger_counts(ledger)
    c("rules", done and counts["broken"] == 0 and counts["not_checked"] == 0,
      "Every rule in scope passed" if counts["broken"] == 0 and counts["not_checked"] == 0
      else f"{counts['broken']} broken, {counts['not_checked']} not checked")
    open_ = [f for f in findings or [] if f.get("state") == "open"]
    c("findings", not open_, "No open finding" if not open_ else f"{plural(len(open_), 'open finding')}")
    reasons = jl(pr.get("risk_reasons"), None)
    if reasons is None:
        reasons = jl(rnd.get("risk_reasons"), []) or []
    risky = [r for r in reasons if r.get("source") == "path"]
    c("risk", pr.get("risk") == "low" and not risky,
      "Touches none of the risky paths" if pr.get("risk") == "low" and not risky
      else (f"Touches {risky[0].get('glob')}" if risky else f"Risk is {pr.get('risk')}"))
    kind = pr.get("author_kind")
    bots = [b.lower() for b in (m.get("update_bots") or [])]
    prefix = m.get("update_branch_prefix") or ""
    by_updates = kind == "bot" and (str(pr.get("author") or "").lower() in bots
                                     or (prefix and str(pr.get("head_ref") or "").startswith(prefix)))
    c("author", kind == "member" or by_updates,
      "Opened by someone on the team" if kind == "member" else ("Opened by Dependency updates" if by_updates
                                                                 else f"Opened by {'an agent' if kind == 'agent' else 'a bot' if kind == 'bot' else 'someone outside the team'}"))
    checks = (live or {}).get("checks")
    c("checks", checks == "passing" or (checks == "none" and bool(m.get("allow_no_checks"))),
      {"passing": "Every GitHub check passed", "none": "GitHub reports no checks on this commit" + ("" if m.get("allow_no_checks") else ", and merging without any is off"),
       "failing": "A GitHub check failed", "running": "GitHub checks are still running"}.get(checks, "GitHub's checks are unknown"))
    mergeable = (live or {}).get("mergeable")
    c("mergeable", mergeable == "yes", "GitHub says it can merge" if mergeable == "yes"
      else ("GitHub says it can't merge (a conflict, or it is blocked)" if mergeable == "no" else "GitHub hasn't said whether it can merge"))
    gated = [p for p in paths if gate_path(p)]
    c("gate_files", not gated, "Changes no rule file, CODEOWNERS or .github/" if not gated else f"Changes {gated[0]}")
    labels = [str(x.get("name") if isinstance(x, dict) else x).lower() for x in (jl((live or {}).get("labels"), None) or jl(pr.get("labels"), []) or [])]
    held = pr.get("merge_state") == "held" or HOLD_LABEL in labels
    c("not_held", not held, "Not held" if not held else ("The lemma-hold label is on it" if HOLD_LABEL in labels else "A person held it"))
    cap = int(settings.get("daily_merge_cap") or 20)
    c("daily_cap", merged_today < cap, f"{merged_today} of {cap} merges by itself today")
    if repo.get("merge_mode") == "merge":
        how = m.get("how")
        if how == "auto":
            c("how", repo.get("allow_auto_merge") is True,
              "Auto-merge is allowed on the repository" if repo.get("allow_auto_merge") is True
              else "“Allow auto-merge” is off on GitHub, or unknown")
        elif how == "queue":
            c("how", repo.get("merge_queue") is not False, "Adds it to the merge queue")
    if at_merge:
        due = stamp(pr.get("merge_due_at"))
        c("wait", due is not None and now >= due,
          "The wait after the last push has passed" if due is not None and now >= due else "Still inside the wait after the last push")
    return out


def eligible(conditions) -> bool:
    return bool(conditions) and all(c.get("ok") for c in conditions)


def summarize_checks(check_runs, combined) -> str:
    """passing, failing, running or none, from GitHub's check runs and the
    combined commit status. The Lemma check itself is left out."""
    runs = [r for r in check_runs or [] if isinstance(r, dict) and r.get("name") != CHECK_NAME]
    combined = combined or {}
    statuses = [s for s in combined.get("statuses") or [] if isinstance(s, dict) and s.get("context") != CHECK_NAME]
    bad = {"failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"}
    if any((r.get("conclusion") or "") in bad for r in runs) or any(s.get("state") in ("failure", "error") for s in statuses):
        return "failing"
    if any(r.get("status") not in ("completed", None) for r in runs) or any(s.get("state") == "pending" for s in statuses):
        return "running"
    if not runs and not statuses:
        return "none"
    return "passing"


def mergeable_of(pull: dict, how: str = "squash") -> str:
    """yes, no or unknown from pulls_get. `blocked` (a required review or
    check still to come) is fine when GitHub's auto-merge or the merge queue
    will enforce it, and no for a squash now."""
    if not isinstance(pull, dict) or pull.get("mergeable") is None:
        return "unknown"
    if pull.get("mergeable") is False:
        return "no"
    state = str(pull.get("mergeable_state") or "unknown")
    if state in ("clean", "has_hooks", "unstable"):
        return "yes"
    if state == "blocked":
        return "yes" if how in ("auto", "queue") else "no"
    if state in ("dirty", "draft", "behind"):
        return "no"
    return "unknown"


LINKS = _re.compile(r"(?i)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+((?:[\w.-]+/[\w.-]+)?#\d+)")


def linked_issues(body, repo: str) -> list:
    out = []
    for ref in LINKS.findall(str(body or "")):
        full = ref if "/" in ref.split("#")[0] else f"{repo}{ref}"
        if full not in out:
            out.append(full)
    return out[:20]


# ---------- the reviewer's answer, checked ----------

def _unwrap(result):
    if isinstance(result, str):
        text = result.strip()
        m = _re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, _re.S)
        try:
            result = _json.loads(m.group(1) if m else text)
        except (TypeError, ValueError):
            return {}
    result = as_dict(result)
    for _ in range(3):
        if any(k in result for k in ("summary", "ledger", "findings")):
            return result
        inner = None
        for k in ("output", "result", "structured_output", "answer", "data", "value"):
            v = result.get(k)
            if isinstance(v, (dict, str)) and v:
                inner = v
                break
        if inner is None:
            return result
        result = _unwrap(inner) if isinstance(inner, str) else as_dict(inner)
    return result


def _hunk(h) -> dict | None:
    if not isinstance(h, dict) or not h.get("path"):
        return None
    return {"path": clip(h.get("path"), 500), "start": to_int(h.get("start")), "end": to_int(h.get("end"))}


def validate_review(result, rule_ids) -> tuple:
    """(clean answer, problems). The output schema is enforced only on the
    Agent Host harness, so code checks the shape itself: it keeps what fits,
    caps every list, cuts long text, maps old severity words, drops a
    finding without a title and a rule id nobody has."""
    r = _unwrap(result)
    problems = []
    rule_ids = {str(x) for x in rule_ids or []}
    if not r or not any(k in r for k in ("summary", "ledger", "findings")):
        return None, ["the review's answer could not be read"]
    out = {"summary": clip(r.get("summary"), 2000)}
    kc = []
    for k in (r.get("key_changes") or r.get("decisions") or [])[: CAPS["key_changes"]]:
        if isinstance(k, dict) and k.get("title"):
            kc.append({"title": clip(k.get("title"), 200), "why": clip(k.get("why"), 400),
                       "hunks": [h for h in (_hunk(x) for x in (k.get("hunks") or [])[: CAPS["hunks"]]) if h]})
    out["key_changes"] = kc
    mech = []
    for m in (r.get("mechanical") or [])[: CAPS["mechanical"]]:
        if isinstance(m, dict) and m.get("kind"):
            mech.append({"kind": clip(m.get("kind"), 40), "files": to_int(m.get("files")) or 0,
                         "lines": to_int(m.get("lines")) or 0,
                         "examples": [clip(x, 200) for x in (m.get("examples") or [])[:3] if x]})
    out["mechanical"] = mech
    ledger = []
    for e in (r.get("ledger") or [])[: CAPS["ledger"]]:
        if not isinstance(e, dict):
            continue
        rule = str(e.get("rule_id") or e.get("slug") or "")
        state = {"checked": "passed", "pass": "passed", "ok": "passed", "finding": "broken", "fail": "broken",
                 "failed": "broken", "skipped": "not_checked"}.get(str(e.get("state") or ""), str(e.get("state") or ""))
        if rule not in rule_ids:
            problems.append(f"ledger names an unknown rule {clip(rule, 40)!r}")
            continue
        if state not in ("passed", "broken", "not_checked"):
            problems.append(f"ledger state {clip(state, 20)!r} for {rule[:8]}")
            state = "not_checked"
        ledger.append({"rule_id": rule, "state": state, "note": clip(e.get("note"), 300)})
    out["ledger"] = ledger
    findings = []
    raw = [f for f in (r.get("findings") or []) if isinstance(f, dict)]
    if len(raw) > CAPS["findings"]:
        problems.append(f"{len(raw)} findings; kept the first {CAPS['findings']}")
    for f in raw[: CAPS["findings"]]:
        if not f.get("title"):
            problems.append("a finding without a title was dropped")
            continue
        sev = str(f.get("severity") or "should_fix")
        sev = sev if sev in SEVERITIES else SEVERITY_ALIASES.get(sev.lower(), "should_fix")
        rule = str(f.get("rule_id") or f.get("guideline") or "") or None
        if rule and rule not in rule_ids:
            problems.append(f"a finding names an unknown rule {clip(rule, 40)!r}; kept without it")
            rule = None
        findings.append({"fingerprint": clip(f.get("fingerprint"), 200) or None, "rule_id": rule, "severity": sev,
                         "path": clip(f.get("path"), 500) or None, "line": to_int(f.get("line")),
                         "end_line": to_int(f.get("end_line")), "title": clip(f.get("title"), 300),
                         "body": clip(f.get("body"), 4000), "suggestion": clip(f.get("suggestion"), 4000) or None,
                         "found_by": "reviewer"})
    out["findings"] = findings
    out["resolved"] = [clip(x, 200) for x in (r.get("resolved") or [])[: CAPS["resolved"]] if isinstance(x, str) and x]
    ltr = r.get("lines_to_read")
    out["lines_to_read"] = [h for h in (_hunk(x) for x in (ltr if isinstance(ltr, list) else [])[: CAPS["lines_to_read"]]) if h]
    out["lines_to_read_count"] = to_int(r.get("lines_to_read_count")) if isinstance(ltr, list) else to_int(ltr)
    out["lines_total"] = to_int(r.get("lines_total"))
    up = as_dict(r.get("risk_up"))
    out["risk_up"] = {"risk": up.get("risk"), "reason": clip(up.get("reason"), 300)} if up.get("risk") in ("medium", "high") else None
    return out, problems


# ---------- this Lemma's settings and people ----------

def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM prr_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM prr_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["merge"] = merge_settings(s)
    s["platform"] = jl(s.get("platform"), {}) or {}
    s["schedules"] = jl(s.get("schedules"), {}) or {}
    s.setdefault("posts_as", "reviewer")
    s.setdefault("comments", "off")
    return s


def members_of(pod) -> list:
    out = []
    for m in q(pod, "SELECT * FROM prr_member LIMIT 2000"):
        m = dict(m)
        m["owns"] = jl(m.get("owns"), []) or []
        out.append(m)
    return out


def repository_of(pod, full_name) -> dict:
    found = q(pod, f"SELECT * FROM repository WHERE LOWER(full_name) = {lit(str(full_name or '').lower())} LIMIT 1")
    return dict(found[0]) if found else {}


def pull_of(pod, pull_request_id=None, key=None) -> dict:
    if pull_request_id:
        found = q(pod, f"SELECT * FROM pull_request WHERE id = {lit(pull_request_id)} LIMIT 1")
    else:
        found = q(pod, f"SELECT * FROM pull_request WHERE key = {lit(key)} LIMIT 1")
    return dict(found[0]) if found else {}


def latest_round(pod, pull_request_id, sha=None, statuses=None) -> dict:
    where = f"pull_request_id = {lit(pull_request_id)}"
    if sha:
        where += f" AND sha = {lit(sha)}"
    if statuses:
        where += f" AND status IN ({lits(statuses)})"
    found = q(pod, f"SELECT * FROM prr_round WHERE {where} ORDER BY created_at DESC LIMIT 1")
    return dict(found[0]) if found else {}


def findings_of(pod, pull_request_id) -> list:
    return [dict(f) for f in q(pod, f"SELECT * FROM prr_finding WHERE pull_request_id = {lit(pull_request_id)} LIMIT 500")]


def pr_path(key: str) -> str:
    """Where a pull request opens in the Pull requests app."""
    repo, _, number = str(key).partition("#")
    return f"/pr/{repo}/{number}"


# ---------- GitHub ----------

def gh(pod, op: str, payload: dict, connector: str = GITHUB):
    """One GitHub call through the Lemma's shared connection (reads), or with
    ``connector=GITHUB_PERSONAL`` as the person this run is for, on their own
    account (a person's own merge); the result's body."""
    result = as_dict(pod.connectors.execute(connector, op, payload)).get("result")
    if isinstance(result, dict) and "data" in result and len(result) <= 3:
        return result["data"]
    return result


def gh_list(result) -> list:
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        for key in ("items", "data", "result", "check_runs", "statuses", "tree", "files", "commits"):
            if isinstance(result.get(key), list):
                return result[key]
    return []


def gh_why(exc) -> str:
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    code = getattr(exc, "code", None)
    return clip(f"{status or ''} {code or ''} {type(exc).__name__}: {exc}".strip(), 300)


def gh_try(pod, op: str, payload: dict, connector: str = GITHUB):
    """(result, None), or (None, why) when GitHub or the connection said no."""
    try:
        return gh(pod, op, payload, connector), None
    except Exception as exc:  # noqa: BLE001 - said, never raised
        return None, gh_why(exc)


def app_refusal(exc) -> str:
    """needs_platform (the platform can't act as the App yet), no_permission
    (the App or this call lacks GitHub's permission), or failed:<why>."""
    code = str(getattr(exc, "code", None) or "")
    text = str(exc)
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    if "APP_IDENTITY" in code or "APP_IDENTITY" in text:
        return "needs_platform"
    if status in (401, 403, 404) or "Resource not accessible" in text or "Not Found" in text \
            or _re.search(r"\b(401|403|404)\b", text):
        return "no_permission"
    return clip("failed:" + (f"{status} " if status else "") + text, 200)


def can_act_as_app(pod) -> bool:
    try:
        return "act_as" in _inspect.signature(pod.connectors.execute).parameters
    except (TypeError, ValueError, AttributeError):
        return False


def gh_app(pod, op: str, payload: dict):
    """One GitHub call as the Lemma's GitHub App (its bot): every check, bot
    review, approval, withdrawal and merge goes through here. (result, state):
    state ok, needs_platform (a platform without act_as="app", or one that
    refuses it), no_permission, or failed:<why>. Never falls back to the person."""
    if not can_act_as_app(pod):
        return None, "needs_platform"
    try:
        got = pod.connectors.execute(GITHUB, op, payload, act_as="app")
    except TypeError:
        return None, "needs_platform"
    except Exception as exc:  # noqa: BLE001 - classified, recorded, never raised
        return None, app_refusal(exc)
    result = as_dict(got).get("result")
    if isinstance(result, dict) and "data" in result and len(result) <= 3:
        result = result["data"]
    return result, "ok"


def note_platform(pod, settings: dict, what: str, state: str) -> None:
    """Keep what the bot could do when last tried, for Settings."""
    platform = dict(settings.get("platform") or {})
    if platform.get(what) == state:
        return
    platform[what] = state
    platform["at"] = now_iso()
    try:
        patch(pod, "prr_settings", settings.get("id") or SETTINGS_ID, {"platform": platform})
        settings["platform"] = platform
    except Exception:  # noqa: BLE001 - a note, not the work
        pass


def live_state(pod, pr: dict, how: str = "squash") -> dict:
    """GitHub's checks, mergeability and labels for the head commit, read as
    the run's person. Anything unreadable stays unknown."""
    owner, name = owner_name(pr.get("repo"))
    out = {"checks": None, "mergeable": "unknown", "labels": None, "node_id": None, "errors": []}
    pull, why = gh_try(pod, "pulls_get", {"owner": owner, "repo": name, "pull_number": int(pr["number"])})
    if isinstance(pull, dict):
        out["mergeable"] = mergeable_of(pull, how)
        out["labels"] = [x.get("name") for x in pull.get("labels") or [] if isinstance(x, dict)]
        out["node_id"] = pull.get("node_id")
        out["head_sha"] = (pull.get("head") or {}).get("sha")
    elif why:
        out["errors"].append(why)
    sha = pr.get("head_sha")
    if sha:
        runs, why1 = gh_try(pod, "checks_list_for_ref", {"owner": owner, "repo": name, "ref": sha, "per_page": 100})
        combined, why2 = gh_try(pod, "repos_get_combined_status_for_ref", {"owner": owner, "repo": name, "ref": sha})
        if why1 and why2:
            out["errors"] += [why1, why2]
        else:
            out["checks"] = summarize_checks(gh_list(runs) if runs is not None else [], as_dict(combined))
    return out


def diff_index(pod, pr: dict) -> dict:
    """{path: lines GitHub takes a review comment on}, from the pull
    request's own patches (read as the run's person). A comment on any other
    line makes GitHub refuse the whole review, so those go in its body."""
    owner, name = owner_name(pr.get("repo"))
    out: dict = {}
    for page in range(1, 31):
        got, why = gh_try(pod, "pulls_list_files", {"owner": owner, "repo": name, "pull_number": int(pr["number"]),
                                                    "per_page": 100, "page": page})
        batch = gh_list(got) if got is not None else []
        for f in batch:
            if isinstance(f, dict) and f.get("filename"):
                out[f["filename"]] = diff_lines(f.get("patch"))
        if len(batch) < 100:
            break
    return out


def finding_text(f: dict, rules: dict) -> str:
    """A finding as GitHub shows it: what goes wrong, the rule it breaks and
    where the rule came from, and the fix."""
    parts = [f"**{f.get('title')}**", str(f.get("body") or "").strip()]
    rule = rules.get(str(f.get("rule_id") or "")) or {}
    if rule:
        source = f" (from `{rule.get('source')}`)" if rule.get("source") and rule.get("source_kind") == "file" else ""
        parts.append(f"Breaks: {rule.get('text')}{source}")
    if f.get("suggestion"):
        parts.append("Suggested:\n```\n" + str(f["suggestion"]).strip() + "\n```")
    return clip("\n\n".join(p for p in parts if p), 6000)


def start_workflow(pod, name: str, node_id: str, inputs: dict):
    """Start a workflow whose first node is a form, and fill it: (run id, why)."""
    try:
        run = as_dict(pod.workflows.create_run(name))
        run_id = str(run.get("id"))
        pod.workflows.submit_form(run_id, node_id=node_id, inputs=inputs)
        return run_id, None
    except Exception as exc:  # noqa: BLE001 - said, never raised
        return None, clip(f"{type(exc).__name__}: {exc}", 400)


def run_function(pod, name: str, payload: dict) -> dict:
    try:
        return as_dict(as_dict(pod.functions.run(name, payload)).get("output_data"))
    except Exception as exc:  # noqa: BLE001 - said, never raised
        return {"error": clip(f"{type(exc).__name__}: {exc}", 400)}
# end pr-review:common

MAX_RULES = 40


class PrrSaveRulesInput(BaseModel):
    repo: str
    sha: str | None = None
    files: list = []
    comments: list = []
    result: Any = None


class PrrSaveRulesResult(BaseModel):
    added: int = 0
    seen: int = 0
    dropped: list = []
    message: str


def _norm(text) -> str:
    return " ".join(_re.findall(r"[a-z0-9]+", str(text or "").lower()))


def locate(file: dict, line, quote) -> int | None:
    """The 1-based line where `quote` is, preferring the one named."""
    lines = file.get("lines") or []
    want = _norm(quote)
    if not want:
        return None
    line = to_int(line)
    order = []
    if line:
        order += [n for n in range(line - 2, line + 3) if 1 <= n <= len(lines)]
    order += [n for n in range(1, len(lines) + 1) if n not in order]
    for n in order:
        window = _norm(" ".join(lines[n - 1: n + 2]))
        if want in window:
            return n
    return None


def prr_save_rules(ctx: FunctionContext, data: PrrSaveRulesInput) -> PrrSaveRulesResult:
    pod = ctx.pod
    settings = settings_of(pod)
    repo = str(data.repo or "").strip()
    raw = data.result
    if isinstance(raw, str):
        try:
            raw = _json.loads(raw)
        except ValueError:
            raw = {}
    raw = as_dict(raw)
    proposals = raw.get("rules") if isinstance(raw.get("rules"), list) else as_dict(raw.get("output")).get("rules") or []
    files = {f.get("path"): f for f in data.files or [] if isinstance(f, dict) and f.get("path")}
    comments = [c for c in data.comments or [] if isinstance(c, dict)]
    existing = {(_norm(r.get("text")), str(r.get("repo") or "")): dict(r)
                for r in q(pod, f"SELECT * FROM prr_rule WHERE repo = {lit(repo)} OR repo IS NULL LIMIT 2000")}
    out = PrrSaveRulesResult(message="")
    writes = []
    for p in proposals[:MAX_RULES]:
        p = as_dict(p)
        text = clip(p.get("text"), 400)
        if not text:
            continue
        kind = p.get("source_kind") if p.get("source_kind") in ("file", "comments") else ("file" if p.get("file") else "comments")
        sev = p.get("severity") if p.get("severity") in SEVERITIES else SEVERITY_ALIASES.get(str(p.get("severity") or "").lower(), "should_fix")
        row = {"text": text, "repo": repo, "severity": sev, "source_kind": kind, "proposed_by": "scout",
               "checkable": p.get("checkable") is not False,
               "not_checkable_why": clip(p.get("not_checkable_why"), 300) or None,
               "source_sha": data.sha, "seen_at": now_iso()}
        if kind == "file":
            f = files.get(p.get("file"))
            quote = (p.get("quotes") or [{}])[0] if isinstance(p.get("quotes"), list) and p.get("quotes") else {}
            quote = as_dict(quote).get("text") if isinstance(quote, dict) else quote
            quote = quote or p.get("quote") or text
            at = locate(f, p.get("line"), quote) if f else None
            if not f or not at:
                out.dropped.append(f"{clip(text, 80)}: its words aren't in {p.get('file') or 'any file read'}")
                continue
            row["source"] = f"{f['path']}:{at}"
            row["quotes"] = [{"who": None, "where": row["source"], "text": clip(" ".join((f.get("lines") or [])[at - 1: at + 1]), 400)}]
            row["scope"] = list(f.get("scope") or []) if f.get("kind") == "instructions" and f.get("scope") \
                else scoped(p.get("scope"), f.get("scope") or [])
        else:
            quotes, prs = [], set()
            for qt in (p.get("quotes") or [])[:10]:
                said = _norm(as_dict(qt).get("text") if isinstance(qt, dict) else qt)
                if len(said) < 8:
                    continue
                hit = next((c for c in comments if said in _norm(c.get("body"))), None)
                if hit:
                    quotes.append({"who": hit.get("who"), "where": hit.get("pr"), "url": hit.get("url"),
                                   "text": clip(as_dict(qt).get("text") if isinstance(qt, dict) else qt, 300)})
                    prs.add(hit.get("pr"))
            if len(quotes) < 2 or len(prs) < 2:
                out.dropped.append(f"{clip(text, 80)}: needs the same ask in comments on two pull requests, quoted word for word")
                continue
            people = sorted({x["who"] for x in quotes if x.get("who")})
            row["source"] = clip(f"{plural(len(quotes), 'review comment')} by {', '.join(people)}", 500)
            row["quotes"] = quotes
            row["scope"] = scoped(p.get("scope"), [])
        old = existing.get((_norm(text), repo))
        if old:
            keep = {"id": old["id"], "seen_at": row["seen_at"], "source_sha": data.sha}
            if old.get("state") == "proposed":
                keep.update({k: row[k] for k in ("source", "quotes", "scope", "severity", "checkable", "not_checkable_why")})
            writes.append(keep)
            out.seen += 1
            continue
        row["id"] = rid("rule", repo, _norm(text))
        row["state"] = "active" if kind == "file" and settings.get("accept_file_rules") else "proposed"
        existing[(_norm(text), repo)] = row
        writes.append(row)
        out.added += 1
    news = [w for w in writes if "text" in w]
    seen = [w for w in writes if "text" not in w]
    for start in range(0, len(news), 100):
        pod.records.bulk_create("prr_rule", news[start: start + 100], upsert=True)
    for start in range(0, len(seen), 100):
        pod.records.bulk_update("prr_rule", seen[start: start + 100])
    out.message = (f"{repo}: {plural(out.added, 'new rule')}, {out.seen} already known"
                   + (f", {len(out.dropped)} dropped (their source couldn't be found)" if out.dropped else "") + ".")
    return out
