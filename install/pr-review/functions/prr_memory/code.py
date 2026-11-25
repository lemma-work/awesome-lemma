#input_type_name: PrrMemoryInput
#output_type_name: PrrMemoryResult
#function_name: prr_memory

"""Tells this Lemma's agents that PR review is installed, through the
contract's write rule (_contract/snippets/agents-md.py, embedded below): PR
review's block in /memory/AGENTS.md, which every agent reads at the start of
every run, and its guide at /memory/plugins/pr-review.md, read when a pull
request comes up. Only the text between PR review's own markers is written,
so the team's notes in either file stay.

prr-setup runs it last; running it again changes nothing unless the text
did, and puts the block back if something took it out. `remove` takes the
block and the guide's text out, for an uninstall. Never raises.

AGENTS_BLOCK and AGENTS_GUIDE are .lemma/agents-block.md and .lemma/guide.md,
copied in by `_contract/lint.py --fix`; edit those, never these.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

AGENTS_BLOCK = """\
- PR review is installed: pull requests read against the team's rules, and who each waits on. How to use it: `/memory/plugins/pr-review.md`.
"""
AGENTS_GUIDE = """\
# PR review

What the PR review plugin holds and how to use it from a conversation. Its
set-up rewrites everything between the markers around this text; the team's
own notes about reviewing go below them and stay.

## What it holds

- `pull_request`: every open and recent pull request in the watched
  repositories (`repository`), with `waits_on` (a member's user id, `nobody`
  or `author`), `waits_for` (review, merge, fix, round), `verdict` (clean,
  changes, needs_person), `review_state` and `merge_state`. Code decides the
  verdict and who it waits on, never a model.
- `prr_round`: one per pushed commit, with the summary, the ledger (every
  rule in scope as passed, broken or not checked, and why) and what changed.
- `prr_finding`: findings on their lines, the same row on every push (open,
  fixed, dismissed, wrong). `prr_rule`: the rules (proposed, active, paused,
  retired) with where each came from.
- The apps: `pull-requests` (a pull request opens at `/pr/<owner>/<repo>/<number>`)
  and `rules`.

## From chat

- **What waits on me**: query `pull_request` where `state` is open and
  `waits_on` is the person's user id; say `waits_for` in words ("your review",
  "ready for you to merge", "returned to you to fix").
- **Why did it fail**: read the newest `prr_round` of that pull request
  (`status` done): its `ledger` entries with `state` broken or not_checked,
  and its open findings, each with `path`, `line` and the rule's text.
- **Review it again**: `prr_intake` with `event` app, `repo`, `number`,
  `queue` yes.
- **Fix it**: `prr_fix_task` with `finding_id` makes a team task (source
  pr-review); `assign_to` coding_agent hands it to Coding agent.
- **Dismiss a finding**: `prr_decide_finding` with `decision`
  not_worth_fixing, wrong or reopen, and a short `note`. Only when the person
  says so.
- **Add a rule**: write a `prr_rule` row with `text` (one sentence a reviewer
  can check from a diff), `scope` (globs, or empty for every file),
  `severity` (must_fix, should_fix, nit), `source_kind` typed, `state`
  proposed. A person accepts it in the Rules app; never make one active
  yourself.
- **Hold a merge**: `prr_hold` with `pull_request_id` and `hold` true (false
  lets it go). **Merge one**: `prr_merge` with `mode` person, only when the
  person asks; it waits while a rule is broken.
- **Send it back**: `prr_send_back` posts one review as the Lemma's bot, only
  when Settings have the bot posting; otherwise the person sends it from the
  app as themselves.

## Never

- Never post on GitHub, approve, merge or push yourself: the functions above
  do, and only the person decides to.
- Never change the merge settings, a repository's merge mode or a rule's
  state unless the person asks; say what it changes first.
- Never say a rule passed when the ledger says not checked.
"""

# contract:agents-md
# The one way a plugin tells this Lemma's agents it is installed (see
# _contract/README.md, "Memory block"). Copied verbatim into the plugin's
# memory function between these markers; _contract/lint.py fails on any
# difference. Needs a folder grant on /memory (read, write), which resolves
# because the bundle carries the contract's files/memory/. /me/AGENTS.md needs
# no grant: it is the person's own, written when the function runs as them.
import re as _am_re

AGENTS_MD_POD = "/memory/AGENTS.md"
AGENTS_MD_ME = "/me/AGENTS.md"
AGENTS_MD_GUIDES = "/memory/plugins"
# A block's whole text, markers included. Every index reaches every run's
# brief cut to 2,000 characters, and to about 1,365 when all four of an
# agent's indexes are full; six plugins at 200 fit under that, at the top,
# and leave the team most of the usual room for its own notes.
AGENTS_MD_BLOCK_BUDGET = 200
AGENTS_MD_INDEX_ROOM = 2000
# A guide is read only when needed. The platform asks for a memory file past
# 8,000 characters to be condensed, and the team may add notes below the block.
AGENTS_MD_GUIDE_BUDGET = 4000


def _am_marks(slug: str):
    if not _am_re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug or ""):
        raise ValueError(f"not a plugin slug: {slug!r}")
    s = _am_re.escape(slug)
    return (f"<!-- plugin:{slug} -->", f"<!-- /plugin:{slug} -->",
            _am_re.compile(r"<!--\s*plugin:" + s + r"\s*-->"),
            _am_re.compile(r"<!--\s*/plugin:" + s + r"\s*-->"))


def agents_md_block(slug: str, body: str) -> str:
    """The block as written: markers on their own lines around the body."""
    if _am_re.search(r"<!--\s*/?plugin:", body or ""):
        raise ValueError("a block cannot hold plugin markers")
    opening, closing, _, _ = _am_marks(slug)
    return f"{opening}\n{(body or '').strip()}\n{closing}\n"


def agents_md_spans(text: str, slug: str) -> list:
    """(start, end) of each whole block of `slug`; the end takes the newline
    closing its last line. An opening marker with no closing one before the
    next opening one is not a block, and is left alone."""
    _, _, opening, closing = _am_marks(slug)
    starts = [m.start() for m in opening.finditer(text)]
    spans = []
    for i, start in enumerate(starts):
        found = closing.search(text, start, starts[i + 1] if i + 1 < len(starts) else len(text))
        if found:
            end = found.end() + (1 if text[found.end():found.end() + 1] == "\n" else 0)
            spans.append((start, end))
    return spans


def agents_md_put(text: str, slug: str, body) -> str:
    """`text` with `slug`'s block set to `body` (None removes it); nothing
    outside that plugin's markers changes. The first block is replaced in place
    and any copies of it removed. A new block goes after the last plugin block,
    else at the top, below a leading `# ` title: an index cut to fit the brief
    loses its last lines, and a block is short and changes only on set-up."""
    block = None if body is None else agents_md_block(slug, body)
    spans = agents_md_spans(text, slug)
    if spans:
        out, cursor = [], 0
        for i, (start, end) in enumerate(spans):
            out.append(text[cursor:start])
            if i == 0 and block is not None:
                out.append(block)
            cursor = end
        out.append(text[cursor:])
        return "".join(out)
    if block is None:
        return text
    ends = [m.end() for m in _am_re.finditer(r"<!--\s*/plugin:[a-z0-9-]+\s*-->[^\n]*\n?", text)]
    if ends:
        at = ends[-1]
    elif text.startswith("# "):
        at = text.find("\n") + 1 or len(text)
    else:
        at = 0
    before = text[:at]
    if before and not before.endswith("\n"):
        before += "\n"
    return before + block + text[at:]


def agents_md_write(pod, slug: str, block, guide=None, index: str = AGENTS_MD_POD) -> dict:
    """Write `slug`'s block into `index` and, given `guide`, the guide at
    /memory/plugins/<slug>.md, between the same markers, so notes the team adds
    to either outside them stay. None removes the block (an uninstall). Safe to
    run again: an unchanged file is not written. A file that cannot be read for
    any reason but being absent is never written over (that raises).

    Returns {"index": ..., "guide": ..., "warnings": [...]}."""
    warnings = []

    def read(path):
        try:
            data = pod.files.download(path)
        except Exception as exc:  # noqa: BLE001
            code = getattr(exc, "status_code", None)
            if code == 404 or (code is None and "not found" in str(exc).lower()):
                return None
            raise
        return data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else str(data)

    def put(path, body):
        before = read(path)
        text = agents_md_put(before or "", slug, body)
        if text == (before or ""):
            return {"path": path, "changed": False, "chars": len(text)}
        if before is None and path.startswith(AGENTS_MD_GUIDES + "/"):
            try:
                pod.files.create_folder(AGENTS_MD_GUIDES)
            except Exception:  # noqa: BLE001 — there already, the usual case
                pass
        wanted = None if body is None else agents_md_block(slug, body)
        for _ in range(3):
            pod.files.write_text(path, text)
            after = read(path) or ""
            if (wanted in after) if wanted is not None else not agents_md_spans(after, slug):
                return {"path": path, "changed": True, "chars": len(after)}
            text = agents_md_put(after, slug, body)  # written over meanwhile: again, on theirs
        warnings.append(f"{path}: another write kept replacing it; the block may be missing")
        return {"path": path, "changed": True, "chars": len(text)}

    guide_path = f"{AGENTS_MD_GUIDES}/{slug}.md"
    if block is not None:
        size = len(agents_md_block(slug, block))
        if size > AGENTS_MD_BLOCK_BUDGET:
            warnings.append(f"the {slug} block is {size} characters, over the {AGENTS_MD_BLOCK_BUDGET} budget")
    if guide is not None and len(agents_md_block(slug, guide)) > AGENTS_MD_GUIDE_BUDGET:
        warnings.append(f"the {slug} guide is over the {AGENTS_MD_GUIDE_BUDGET}-character budget")
    result = {"index": put(index, block), "guide": None, "warnings": warnings}
    if guide is not None or (block is None and index == AGENTS_MD_POD):
        result["guide"] = put(guide_path, guide)
    if result["index"]["chars"] > AGENTS_MD_INDEX_ROOM:
        warnings.append(f"{index} is {result['index']['chars']} characters; agents see about "
                        f"{AGENTS_MD_INDEX_ROOM}, and lose its last lines")
    return result
# end contract


class PrrMemoryInput(BaseModel):
    remove: bool = False


class PrrMemoryResult(BaseModel):
    changed: bool
    warnings: list[str]
    message: str


def prr_memory(ctx: FunctionContext, data: PrrMemoryInput) -> PrrMemoryResult:
    block = None if data.remove else AGENTS_BLOCK
    guide = None if data.remove else AGENTS_GUIDE
    try:
        done = agents_md_write(ctx.pod, "pr-review", block, guide)
    except Exception as exc:  # noqa: BLE001 - set-up goes on without it
        return PrrMemoryResult(changed=False, warnings=[f"{type(exc).__name__}: {exc}"[:500]],
                               message="Could not tell this Lemma's agents about PR review.")
    changed = bool(done["index"]["changed"] or (done["guide"] or {}).get("changed"))
    if data.remove:
        message = "Took PR review out of this Lemma's memory." if changed else "PR review was not in this Lemma's memory."
    else:
        message = "Told this Lemma's agents about PR review." if changed else "This Lemma's agents already know about PR review."
    return PrrMemoryResult(changed=changed, warnings=done["warnings"], message=message)
