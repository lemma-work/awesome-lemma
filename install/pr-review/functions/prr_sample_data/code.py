#input_type_name: PrrSampleDataInput
#output_type_name: PrrSampleDataResult
#function_name: prr_sample_data

"""load: a made-up team's two repositories (acme/api and acme/web) to look
around with: ravi, mei, tom and you (asha), ten open pull requests in every
part of the inbox, the rules read from their files and two proposed from
review comments, findings on their lines across two pushes (one fixed, one
dismissed), the ledger, and a week of merging by itself. Nothing in it
reaches GitHub. Your Today gets the reviews and the merge waiting on you.

clear: removes only what the sample made (rows marked sample, the sample's
repositories and pull requests, tasks made from its findings), closes its
items in your Today, and set-up is next.
"""

from __future__ import annotations

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

OWN = ("prr_round", "prr_finding", "prr_rule", "prr_risk_path", "prr_member", "prr_merge_log")
GH = "https://github.example"


class PrrSampleDataInput(BaseModel):
    mode: str = "load"


class PrrSampleDataResult(BaseModel):
    loaded: dict = {}
    message: str


def sha_of(*parts) -> str:
    return _hashlib.sha1(":".join(str(p) for p in parts).encode()).hexdigest()


def build(me: str, me_name: str, now=None) -> dict:
    """Every row of the sample, by table."""
    now = now or _datetime.now(_tz.utc)
    at = lambda minutes: (now - _timedelta(minutes=minutes)).isoformat()  # noqa: E731
    out = {k: [] for k in ("repository", "prr_settings", "prr_member", "prr_risk_path", "prr_rule", "pull_request",
                           "prr_round", "prr_finding", "prr_merge_log")}
    out["repository"] = [
        {"id": repo_id("acme/api"), "full_name": "acme/api", "default_branch": "main", "html_url": f"{GH}/acme/api",
         "review_mode": "every_push", "merge_mode": "off", "allow_auto_merge": False, "merge_queue": False,
         "required_check": CHECK_NAME, "required_approvals": 1, "checked_at": at(30), "source": "sample", "source_id": "sample-api"},
        {"id": repo_id("acme/web"), "full_name": "acme/web", "default_branch": "main", "html_url": f"{GH}/acme/web",
         "review_mode": "every_push", "merge_mode": "merge", "allow_auto_merge": True, "merge_queue": False,
         "required_check": None, "required_approvals": 1, "checked_at": at(30), "source": "sample", "source_id": "sample-web"},
    ]
    out["prr_settings"] = [{
        "id": SETTINGS_ID, "posts_as": "bot", "check_on": True, "comments": "off", "approve_when_clean": False,
        "merge": dict(DEFAULT_MERGE, paths=["docs/**", "web/copy/**", "**/package-lock.json", "**/uv.lock"],
                      max_lines=40, max_files=5, wait_minutes=10, how="auto", approve_first=True),
        "daily_cap": 60, "daily_merge_cap": 20, "paused": False, "accept_file_rules": False,
        "platform": {"app": "needs_platform", "checks": "needs_platform", "at": at(30)},
        "schedules": {}, "setup_done_at": at(60 * 24 * 9), "setup_by": me, "sample": True}]
    people = {"asha": (me, me_name or "asha", ["billing/**"]), "ravi": (None, "ravi", ["api/**", "jobs/**"]),
              "mei": (None, "mei", ["web/**"]), "tom": (None, "tom", [])}
    for login, (uid, name, owns) in people.items():
        out["prr_member"].append({"id": member_id(login), "login": login, "user_id": uid, "name": name, "owns": owns,
                                  "reviews": True, "sample": True})
    waits = {"asha": me, "ravi": "sample:ravi", "mei": "sample:mei", "tom": "sample:tom"}
    out["prr_risk_path"] = [
        {"id": rid("risk", "*", "billing/**"), "glob": "billing/**", "repo": None, "tier": "high",
         "reason": "Charges customers", "reviewer_user_id": me, "reviewer_name": me_name or "asha", "state": "active", "sample": True},
        {"id": rid("risk", "acme/api", "api/**"), "glob": "api/**", "repo": "acme/api", "tier": "medium",
         "reason": "The public API", "reviewer_user_id": me, "reviewer_name": me_name or "asha", "state": "active", "sample": True},
        {"id": rid("risk", "acme/web", "web/exports/**"), "glob": "web/exports/**", "repo": "acme/web", "tier": "high",
         "reason": "Exports read every customer's data", "reviewer_user_id": None, "reviewer_name": "mei", "state": "active", "sample": True},
    ]

    def rule(slug, text, scope, sev, source, kind="file", state="active", repo=None, checkable=True, why=None, quotes=None):
        row = {"id": rid("sample-rule", slug), "text": text, "scope": scope, "repo": repo, "severity": sev, "state": state,
               "source_kind": kind, "source": source, "quotes": quotes or [], "checkable": checkable, "not_checkable_why": why,
               "proposed_by": "scout", "seen_at": at(60 * 24 * 9), "sample": True}
        if state != "proposed":
            row.update(decided_by=me, decided_at=at(60 * 24 * 9))
        out["prr_rule"].append(row)
        return row["id"]

    R = {
        "idem": rule("idem", "A write that charges money saves its idempotency key first.", ["billing/**"], "must_fix", "CONTRIBUTING.md:42", repo="acme/api"),
        "logs": rule("logs", "Log lines never include a card number or an email address.", [], "must_fix", "AGENTS.md:18"),
        "migcopy": rule("migcopy", "Migrations run on a copy of production data before merge.", ["migrations/**"], "must_fix",
                        "CONTRIBUTING.md:58", repo="acme/api", checkable=False, why="The review has no database to run them on"),
        "mignum": rule("mignum", "Two open pull requests never add the same migration number.", ["migrations/**"], "should_fix",
                       "3 review comments by mei and ravi", kind="comments", repo="acme/api",
                       quotes=[{"who": "mei", "where": "acme/api#1161", "text": "this clashes with 0087 in the other PR, renumber one"},
                               {"who": "ravi", "where": "acme/api#1172", "text": "two PRs both add 0089, whichever lands second breaks"}]),
        "openapi": rule("openapi", "Public API changes update openapi.json in the same pull request.", ["api/**"], "should_fix",
                        ".github/instructions/api.instructions.md:6", repo="acme/api"),
        "tests": rule("tests", "A pull request that changes behaviour adds or changes a test.", [], "should_fix", "REVIEW.md:9"),
        "case": rule("case", "User-facing text is sentence case.", ["web/**"], "nit", "REVIEW.md:14", repo="acme/web"),
        "early": rule("early", "Prefer early returns over nested conditions.", [], "nit", ".cursor/BUGBOT.md:5"),
    }
    rule("owner", "A new table has an owner column.", ["migrations/**"], "should_fix", "4 review comments by mei and ravi",
         kind="comments", state="proposed", repo="acme/api",
         quotes=[{"who": "mei", "where": "acme/api#1187", "text": "every new table needs an owner column, we keep backfilling these"},
                 {"who": "ravi", "where": "acme/api#1190", "text": "missing owner column again"}])
    rule("flag", "A feature flag check names the flag's owner in a comment.", [], "nit", "2 review comments by tom",
         kind="comments", state="proposed", quotes=[{"who": "tom", "where": "acme/web#1170", "text": "who owns this flag? please say so where it's read"},
                                                    {"who": "tom", "where": "acme/web#1182", "text": "flag owner please"}])
    rule("changelog", "User-visible changes add a line to CHANGELOG.md.", [], "nit", "CONTRIBUTING.md:71", state="paused")
    rule("jquery", "New code doesn't use jQuery.", ["web/**"], "should_fix", "AGENTS.md:40", state="retired", repo="acme/web")
    rules = {r["id"]: r for r in out["prr_rule"]}

    def f(path, add, dele, status="modified", prev=None):
        row = {"path": path, "status": status, "additions": add, "deletions": dele}
        if prev:
            row["previous"] = prev
        return row

    PRS = [
        # number, repo, title, author, kind, files, minutes ago opened, push minutes ago
        (1214, "acme/api", "Move billing webhooks onto the shared queue", "ravi", "member",
         [f("billing/queue.py", 38, 11), f("migrations/0091_queue.py", 24, 0, "added"), f("billing/webhooks.py", 61, 40),
          f("jobs/worker.py", 44, 20), f("jobs/retry.py", 30, 9), f("tests/test_queue.py", 80, 0, "added"), f("docs/billing.md", 12, 4)],
         60 * 26, 12),
        (1209, "acme/web", "Add the export button to reports", "mei", "member",
         [f("web/exports/button.tsx", 54, 4), f("web/exports/api.ts", 20, 6), f("web/copy/reports.json", 4, 2), f("web/exports/button.test.tsx", 10, 0, "added")],
         60 * 5, 60),
        (1203, "acme/api", "Retry failed invoice sync on 502", "tom", "member",
         [f("billing/invoice_sync.py", 41, 18), f("migrations/0091_invoice_retry.py", 14, 0, "added"), f("billing/http.py", 6, 2)],
         60 * 30, 180),
        (1210, "acme/api", "Return 404 for a deleted plan", "tom", "member",
         [f("api/plans.py", 12, 4), f("tests/test_plans.py", 6, 0)], 60 * 3, 40),
        (1217, "acme/web", "Fix a typo on the billing settings page", "mei", "member",
         [f("web/copy/billing.json", 2, 2)], 20, 2),
        (1215, "acme/web", "Bump vite and 4 dev packages", "lemma-app[bot]", "bot",
         [f("package-lock.json", 412, 388), f("package.json", 5, 5)], 70, 60),
        (1198, "acme/web", "Rename workspace to team in settings", "asha", "member",
         [f("web/settings/team.tsx", 120, 118, "renamed", "web/settings/workspace.tsx"), f("web/routes.ts", 30, 25)] +
         [f(f"web/settings/copy/{n}.json", 3, 3) for n in range(29)], 60 * 9, 300),
        (1211, "acme/web", "Stream large CSV exports", "asha", "member",
         [f("web/exports/csv.ts", 90, 30), f("web/exports/stream.ts", 30, 0, "added"), f("web/exports/csv.test.ts", 10, 11)],
         60 * 4, 120),
        (1216, "acme/api", "Add an owner column to new tables", "lemma-app[bot]", "agent",
         [f("migrations/0092_owner.py", 18, 0, "added"), f("tests/test_owner.py", 4, 0, "added")], 45, 20),
        (1219, "acme/api", "Cache plan lookups per request", "tom", "member",
         [f("api/plans.py", 40, 6), f("api/cache.py", 14, 3)], 10, 4),
    ]
    MERGED = [(1199, "acme/web", "Update the pricing FAQ", "mei", [f("docs/pricing.md", 12, 9)], 60 * 30, True),
              (1205, "acme/api", "Log the request id on every error", "ravi", [f("api/errors.py", 8, 2)], 60 * 50, False),
              (1206, "acme/web", "Fix the dark mode toggle label", "mei", [f("web/copy/settings.json", 1, 1)], 60 * 70, True),
              (1192, "acme/web", "Reword the empty state on Reports", "tom", [f("web/copy/reports.json", 4, 4)], 60 * 96, False)]

    def pr_row(number, repo, title, author, kind, files, opened, pushed, **extra):
        key = key_of(repo, number)
        member = people.get(author)
        add = sum(x["additions"] for x in files)
        dele = sum(x["deletions"] for x in files)
        row = {"id": pr_id(key), "key": key, "repository_id": repo_id(repo), "repo": repo, "number": number, "title": title,
               "url": f"{GH}/{repo}/pull/{number}", "author": author, "author_user_id": member[0] if member else None,
               "author_kind": kind, "state": "open", "draft": False, "head_sha": sha_of(key, "head"),
               "head_ref": "lemma/deps-vite" if kind == "bot" else f"{author.split('[')[0]}/{number}", "base_ref": "main",
               "additions": add, "deletions": dele, "changed_files": len(files), "labels": [], "risk": "low",
               "review_state": "reviewed", "reviewed_sha": sha_of(key, "head"), "checks": "passing", "mergeable": "yes",
               "linked_issues": [], "opened_at": at(opened), "source": "sample", "source_id": f"sample-{number}"}
        row.update(extra)
        out["pull_request"].append(row)
        return row

    def round_row(pr, files, seq, sha, minutes, status="done", since=None, summary="", answers=None, findings=(), verdict=None,
                  risk="low", reasons=None, key_changes=None, mechanical=None, touched=None):
        rid_ = rid("sample-round", pr["key"], seq)
        paths = [p for x in files for p in (x["path"], x.get("previous")) if p]
        scope = [r for r in rules.values() if in_scope(r, paths, pr["repo"])]
        said = [{"rule_id": r["id"], "state": "passed"} for r in scope]
        for k, v in (answers or {}).items():
            for a in said:
                if a["rule_id"] == R[k]:
                    a.update(v)
        ledger = build_ledger(scope, said, list(findings)) if status == "done" else None
        row = {"id": rid_, "pull_request_id": pr["id"], "key": pr["key"], "sha": sha, "since_sha": since, "seq": seq,
               "status": status, "queued_at": at(minutes), "started_at": at(minutes - 0.5) if status != "queued" else None,
               "finished_at": at(minutes - 4) if status == "done" else None, "files": files, "touched": touched or {},
               "summary": summary, "key_changes": key_changes or [], "mechanical": mechanical or [], "lines_to_read": [],
               "lines_total": sum(x["additions"] + x["deletions"] for x in files),
               "lines_to_read_count": sum(x["additions"] + x["deletions"] for x in files if not unread(x["path"])),
               "ledger": ledger, "cross_pr": [], "counts": {}, "verdict": verdict, "risk": risk, "risk_reasons": reasons or [],
               "github": {"check": "needs_platform"}, "sample": True}
        out["prr_round"].append(row)
        return row

    def finding(pr, slug, rule_key, sev, path, line, title, body, suggestion=None, state="open", first=None, last=None,
                fixed_in=None, found_by="reviewer", decided=None):
        row = {"id": rid("finding", pr["key"], f"sample:{slug}"), "fingerprint": f"{rule_key or 'bug'}:{path}:{slug}",
               "pull_request_id": pr["id"], "key": pr["key"], "rule_id": R.get(rule_key), "severity": sev, "path": path,
               "line": line, "end_line": None, "title": title, "body": body, "suggestion": suggestion, "state": state,
               "fixed_in": fixed_in, "found_by": found_by, "first_round": first, "first_sha": None, "last_seen_round": last,
               "last_seen_sha": None, "sample": True}
        if decided:
            row.update(decided_by=me, decided_at=at(decided[0]), decided_note=decided[1])
        out["prr_finding"].append(row)
        return row

    rows = {}
    for number, repo, title, author, kind, files, opened, pushed in PRS:
        rows[number] = (pr_row(number, repo, title, author, kind, files, opened, pushed), files, pushed)

    # acme/api#1214: high risk (billing), two pushes; one finding fixed, one dismissed, two open.
    pr, files, pushed = rows[1214]
    r1_sha, r2_sha = sha_of(pr["key"], "round1"), pr["head_sha"]
    reasons = [{"source": "path", "glob": "billing/**", "tier": "high", "reason": "Charges customers",
                "paths": ["billing/queue.py", "billing/webhooks.py"], "count": 2, "reviewer_user_id": me, "reviewer_name": me_name or "asha"}]
    r1_id, r2_id = rid("sample-round", pr["key"], 1), rid("sample-round", pr["key"], 2)
    f_idem = finding(pr, "retry-charges-twice", "idem", "must_fix", "billing/queue.py", 82, "A retry can charge twice",
                     "The job is queued on line 82 before its idempotency key is saved on line 83. A worker that picks it up "
                     "and fails in between retries with no key, and the customer is charged again.",
                     "    save_idempotency_key(charge.key)\n    queue.enqueue(job, retries=5)", first=r1_id, last=r2_id)
    f_mig = finding(pr, "same-migration-number", "mignum", "should_fix", "migrations/0091_queue.py", None,
                    "Migration 0091 is also added by acme/api#1203",
                    "Found by code, not the model: both open pull requests add migrations/0091_*.py. Whichever merges second fails to migrate.",
                    first=r1_id, last=r2_id, found_by="code")
    f_log = finding(pr, "card-number-in-log", "logs", "must_fix", "billing/webhooks.py", 44, "Log lines include a card number",
                    "The failed-charge log line prints the whole charge, card number included.", state="fixed", fixed_in=r2_sha,
                    first=r1_id, last=r1_id)
    f_early = finding(pr, "early-return-61", "early", "nit", "jobs/worker.py", 61, "Early return on line 61",
                      "Three nested conditions could be one early return.", state="dismissed", first=r1_id, last=r2_id,
                      decided=(60 * 20, "Kept nested: it mirrors the state machine"))
    round_row(pr, files, 1, r1_sha, 60 * 25, summary="Billing webhooks go through the shared job queue instead of running in the request.",
              findings=[dict(f_idem), dict(f_mig), dict(f_log, state="open"), dict(f_early, state="open")], verdict="changes",
              risk="high", reasons=reasons, answers={"migcopy": {"state": "not_checked"}})
    round_row(pr, files, 2, r2_sha, pushed, since=r1_sha,
              summary="Billing webhooks go through the shared job queue instead of running in the request. Retries move from the handler to the queue.",
              findings=[f_idem, f_mig, f_log, f_early], verdict="changes", risk="high", reasons=reasons,
              touched={"billing/webhooks.py": [[40, 48]], "jobs/retry.py": [[1, 30]]},
              key_changes=[{"title": "Charges are queued instead of run in the request", "why": "A retry now happens on the queue; the key must be saved first",
                            "hunks": [{"path": "billing/queue.py", "start": 78, "end": 90}]}],
              mechanical=[{"kind": "tests", "files": 1, "lines": 80, "examples": ["tests/test_queue.py"]},
                          {"kind": "docs", "files": 1, "lines": 16, "examples": ["docs/billing.md"]}])
    # A must-fix finding is open: code says changes, and it waits on its author to fix.
    pr.update(risk="high", verdict="changes", waits_on=waits["ravi"], waits_on_name="ravi", waits_for="fix",
              waits_since=at(pushed - 4), summary="Billing webhooks go through the shared job queue instead of running in the request.")

    pr, files, pushed = rows[1209]
    round_row(pr, files, 1, pr["head_sha"], pushed, summary="Reports get an Export button that downloads the report as CSV.",
              verdict="needs_person", risk="high",
              reasons=[{"source": "path", "glob": "web/exports/**", "tier": "high", "reason": "Exports read every customer's data",
                        "paths": ["web/exports/button.tsx", "web/exports/api.ts"], "count": 2}])
    pr.update(risk="high", verdict="needs_person", waits_on=me, waits_on_name=me_name or "asha", waits_for="review", waits_since=at(pushed - 4),
              summary="Reports get an Export button that downloads the report as CSV.")

    pr, files, pushed = rows[1203]
    f_test = finding(pr, "no-502-test", "tests", "should_fix", "billing/invoice_sync.py", 57, "No test covers the retry on 502",
                     "The new retry loop on line 57 runs only when the server answers 502; nothing tests it.",
                     first=rid("sample-round", pr["key"], 3), last=rid("sample-round", pr["key"], 3))
    f_mig2 = finding(pr, "same-migration-number", "mignum", "should_fix", "migrations/0091_invoice_retry.py", None,
                     "Migration 0091 is also added by acme/api#1214",
                     "Found by code, not the model: both open pull requests add migrations/0091_*.py.", found_by="code",
                     first=rid("sample-round", pr["key"], 3), last=rid("sample-round", pr["key"], 3))
    round_row(pr, files, 3, pr["head_sha"], pushed, since=sha_of(pr["key"], "round2"), summary="Invoice sync retries three times when the payment provider answers 502.",
              findings=[f_test, f_mig2], verdict="needs_person", risk="high", answers={"migcopy": {"state": "not_checked"}},
              reasons=[{"source": "path", "glob": "billing/**", "tier": "high", "reason": "Charges customers", "paths": ["billing/invoice_sync.py"],
                        "count": 1, "reviewer_user_id": me, "reviewer_name": me_name or "asha"}])
    pr.update(risk="high", verdict="needs_person", checks="failing", waits_on=me, waits_on_name=me_name or "asha", waits_for="review",
              waits_since=at(pushed - 4), summary="Invoice sync retries three times when the payment provider answers 502.")

    pr, files, pushed = rows[1210]
    round_row(pr, files, 1, pr["head_sha"], pushed, summary="Asking for a deleted plan answers 404 instead of 500.", verdict="clean", risk="medium",
              reasons=[{"source": "path", "glob": "api/**", "tier": "medium", "reason": "The public API", "paths": ["api/plans.py"],
                        "count": 1, "reviewer_user_id": me, "reviewer_name": me_name or "asha"}])
    pr.update(risk="medium", verdict="clean", waits_on=me, waits_on_name=me_name or "asha", waits_for="merge", waits_since=at(pushed - 4),
              summary="Asking for a deleted plan answers 404 instead of 500.")

    pr, files, pushed = rows[1217]
    round_row(pr, files, 1, pr["head_sha"], pushed, summary="Fixes a typo on the billing settings page.", verdict="clean")
    pr.update(verdict="clean", merge_state="merging", merge_due_at=(now + _timedelta(minutes=8)).isoformat(),
              waits_on="nobody", waits_for="nothing", waits_since=at(1), summary="Fixes a typo on the billing settings page.")

    pr, files, pushed = rows[1215]
    round_row(pr, files, 1, pr["head_sha"], pushed, summary="Updates vite and four development packages; only the lockfile and package.json change.",
              verdict="clean", mechanical=[{"kind": "lockfile", "files": 1, "lines": 800, "examples": ["package-lock.json"]}])
    pr.update(verdict="clean", merge_state="merging", merge_due_at=None, waits_on="nobody", waits_for="nothing", waits_since=at(50),
              summary="Updates vite and four development packages.")

    pr, files, pushed = rows[1198]
    f_route = finding(pr, "old-route-404", None, "must_fix", "web/routes.ts", 31, "Old links to /workspace/settings now 404",
                      "The route was renamed with no redirect, so bookmarks and links in sent emails break.",
                      "{ path: '/workspace/settings', redirect: '/team/settings' },",
                      first=rid("sample-round", pr["key"], 2), last=rid("sample-round", pr["key"], 2))
    round_row(pr, files, 2, pr["head_sha"], pushed, since=sha_of(pr["key"], "round1"), summary="Settings say team instead of workspace everywhere.",
              findings=[f_route], verdict="changes",
              mechanical=[{"kind": "fixture", "files": 29, "lines": 174, "examples": ["web/settings/copy/0.json"]}])
    pr.update(verdict="changes", waits_on=me, waits_on_name=me_name or "asha", waits_for="fix", waits_since=at(pushed - 4),
              summary="Settings say team instead of workspace everywhere.")

    pr, files, pushed = rows[1211]
    round_row(pr, files, 1, pr["head_sha"], pushed, summary="CSV exports stream row by row instead of being built in memory.",
              verdict="needs_person", risk="high",
              reasons=[{"source": "path", "glob": "web/exports/**", "tier": "high", "reason": "Exports read every customer's data",
                        "paths": ["web/exports/csv.ts"], "count": 1, "reviewer_user_id": None, "reviewer_name": "mei"}])
    pr.update(risk="high", verdict="needs_person", waits_on=waits["mei"], waits_on_name="mei", waits_for="review",
              waits_since=at(pushed - 4), summary="CSV exports stream row by row instead of being built in memory.")

    pr, files, pushed = rows[1216]
    round_row(pr, files, 1, pr["head_sha"], pushed, summary="New tables get an owner column.", verdict="clean",
              answers={"migcopy": {"state": "not_checked"}})
    pr.update(verdict="clean", checks="running", mergeable="unknown", waits_on=waits["ravi"], waits_on_name="ravi", waits_for="merge",
              waits_since=at(pushed - 4), summary="New tables get an owner column.")

    pr, files, pushed = rows[1219]
    round_row(pr, files, 1, pr["head_sha"], pushed, status="running", risk="medium")
    pr.update(review_state="reviewing", reviewed_sha=None, verdict=None, risk="medium", waits_on="nobody", waits_for="round",
              waits_since=at(pushed))

    for number, repo, title, author, files, minutes, itself in MERGED:
        pr = pr_row(number, repo, title, author, "member", files, minutes + 90, minutes + 60)
        pr.update(state="merged", merged_at=at(minutes), closed_at=at(minutes), verdict="clean", waits_on="nobody",
                  waits_for="nothing", merge_state="merged_by_itself" if itself else None,
                  summary=title + ".")
        round_row(pr, files, 1, pr["head_sha"], minutes + 60, summary=title + ".", verdict="clean")
    log = [(1217, "merging", 2, "Merges after the 10-minute wait unless held"),
           (1215, "merged", 55, "Auto-merge turned on as the Lemma's bot"),
           (1199, "would_merge", 60 * 31, "Watching: you merged it 34 min later"),
           (1192, "would_merge", 60 * 98, "Watching"), (1192, "held", 60 * 97, "Held: you asked for a screenshot first"),
           (1199, "merged", 60 * 30, "Squashed and merged as the Lemma's bot"), (1206, "merged", 60 * 70, "Squashed and merged as the Lemma's bot")]
    for number, action, minutes, note in log:
        repo = "acme/web"
        key = key_of(repo, number)
        out["prr_merge_log"].append({"id": rid("sample-merge-log", key, action), "pull_request_id": pr_id(key), "key": key,
                                     "sha": sha_of(key, "head"), "action": action, "how": "auto",
                                     "conditions": [{"name": n, "ok": True, "detail": d} for n, d in (
                                         ("paths", "Every changed file is in an allowed path"), ("size", "Small"),
                                         ("rules", "Every rule in scope passed"), ("findings", "No open finding"),
                                         ("risk", "Touches none of the risky paths"), ("checks", "Every GitHub check passed"))],
                                     "by": me if action == "held" else None, "at": at(minutes), "note": note, "sample": True})
    return out


def prr_sample_data(ctx: FunctionContext, data: PrrSampleDataInput) -> PrrSampleDataResult:
    pod = ctx.pod
    me = str(ctx.user_id) if ctx.user_id else ""
    if data.mode == "clear":
        return _clear(pod, me)
    settings = settings_of(pod)
    if settings.get("setup_done_at") and not settings.get("sample"):
        return PrrSampleDataResult(message="PR review is set up for real here; the sample would mix with it.")
    name = None
    try:
        for m in as_dict(pod.members.list()).get("items") or []:
            if str(m.get("user_id")) == me:
                name = m.get("user_name") or m.get("name")
    except Exception:  # noqa: BLE001 - a name is nice, not needed
        name = None
    built = build(me, name or "asha")
    counts = {}
    for table, items in built.items():
        for start in range(0, len(items), 100):
            pod.records.bulk_create(table, items[start: start + 100], upsert=True)
        counts[table] = len(items)
    run_function(pod, "prr_needs_you", {})
    return PrrSampleDataResult(loaded=counts, message=(
        f"Loaded acme/api and acme/web: {counts['pull_request']} pull requests, {counts['prr_rule']} rules, "
        f"{counts['prr_finding']} findings. Nothing in it reaches GitHub."))


def _clear(pod, me: str) -> PrrSampleDataResult:
    counts = {}
    findings = [r["id"] for r in q(pod, "SELECT id FROM prr_finding WHERE sample IS TRUE LIMIT 5000")]
    if findings:
        tasks = [r["id"] for r in q(pod, f"SELECT id FROM task WHERE source = 'pr-review' AND source_id IN ({lits(findings)}) LIMIT 1000")]
        for start in range(0, len(tasks), 100):
            pod.records.bulk_delete("task", tasks[start: start + 100])
        counts["task"] = len(tasks)
    for table in OWN:
        ids = [r["id"] for r in q(pod, f"SELECT id FROM {table} WHERE sample IS TRUE LIMIT 5000")]
        for start in range(0, len(ids), 100):
            pod.records.bulk_delete(table, ids[start: start + 100])
        counts[table] = len(ids)
    for table in ("pull_request", "repository"):
        ids = [r["id"] for r in q(pod, f"SELECT id FROM {table} WHERE source = 'sample' LIMIT 5000")]
        for start in range(0, len(ids), 100):
            pod.records.bulk_delete(table, ids[start: start + 100])
        counts[table] = len(ids)
    s = settings_of(pod)
    if s.get("sample") and s.get("id"):
        pod.records.bulk_delete("prr_settings", [s["id"]])
    open_items = q(pod, f"SELECT id FROM needs_you WHERE source_plugin = {lit(PLUGIN)} AND state IN ('open', 'snoozed') LIMIT 500")
    if open_items:
        pod.records.bulk_update("needs_you", [{"id": r["id"], "state": "done", "closed_by": "source"} for r in open_items])
    counts["needs_you"] = len(open_items)
    return PrrSampleDataResult(loaded=counts, message="Cleared the sample. Set-up is next.")
