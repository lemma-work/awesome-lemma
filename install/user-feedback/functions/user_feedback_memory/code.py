#input_type_name: UserFeedbackMemoryInput
#output_type_name: UserFeedbackMemoryResult
#function_name: user_feedback_memory

"""Tells this Lemma's agents that User feedback is installed, through the
contract's write rule (_contract/snippets/agents-md.py, embedded below): its
block in /memory/AGENTS.md, which every agent reads at the start of every run,
and its guide at /memory/plugins/user-feedback.md, read when feedback comes
up. Only the text between User feedback's own markers is written, so the
team's notes in either file stay.

Set-up runs it (the app's set-up); running it again changes nothing unless
the text did, and puts the block back if something took it out. `remove` takes
the block and the guide's text out, for an uninstall. Never raises: a Lemma
whose memory could not be written still finishes set-up, and the reason is in
the result.

AGENTS_BLOCK and AGENTS_GUIDE are .lemma/agents-block.md and .lemma/guide.md,
copied in by `_contract/lint.py --fix`; edit those, never these.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

AGENTS_BLOCK = """\
- User feedback is installed: what people say about the product, by feature. Guide: `/memory/plugins/user-feedback.md`.
"""
AGENTS_GUIDE = """\
# User feedback

What the User feedback plugin holds and how to use it from a conversation.
Its set-up rewrites everything between the markers around this text; the
team's own notes about feedback go below them and stay.

## What it holds

- `feedback` (shared): one thing one person said about one feature, word for
  word (`quote`), with `kind` (request, problem, praise, question,
  comparison), `importance` (blocker means they won't buy or can't use it),
  who said it (`name`, `company_name`, `handle`) and where (`source`,
  `source_url`, `at_seconds`). `state` new is the inbox; processed is kept;
  set_aside is noise. Rows with `source` note are a member's own words about
  what was said.
- `feature` (shared): the team's list, by area (`parent_id`). `state`
  suggested is the Lemma's proposal; `stage` (idea to live) is set by Roadmap,
  Early access and Release notes.
- `product` (shared): the team's product (`role` ours) and rivals.
- `user_feedback_heard`: sentences from a member's own mail and meetings.
  Only that member can read their rows; never quote one to anyone else, and
  never copy one into `feedback` yourself. They share it, or it stays theirs.
- `user_feedback_filing`: the Lemma's choices for each quote and the words
  that matched.

## Answering questions

- "What do people say about CSV export?" Read `feedback` joined to `feature`
  by name; quote the words as they are, with who said it and when. Group by
  company; say how many people and how many call it a blocker.
- "What's rising?" Compare the last 7 days with the four weeks before, per
  feature. The app's This week view does the same.
- "What do people say about a rival?" `feedback` where `product_id` is the
  rival's, or `compared_with` names it.

## Doing things

- A customer said something the Lemma didn't read: `user_feedback_note`
  (`quote`, `name`, `company_name`, `email`, optional `feature_id`, `kind`,
  `importance`). It goes to the team's inbox, as the member's note.
- Keep, move or set aside a quote: `user_feedback_keep` (`id`, `action` keep,
  move, set_aside, restore; `feature_id` for a move). Keeping a request from
  someone with an email makes an `ask`, so they are told when it ships.
- A new feature, a merge or a drop: `user_feedback_feature` (`action` create,
  update, accept, merge with `into`, drop).
- Open the app: `feedback`, paths `/` (inbox), `/features`, `/f/<feature id>`,
  `/week`.

## Never

- Never paraphrase into `quote`, never invent who said something, and never
  move words out of a person's own mail or meetings into `feedback`.
- Never change `feature.stage`: that belongs to Roadmap, Early access and
  Release notes.
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


class UserFeedbackMemoryInput(BaseModel):
    remove: bool = False


class UserFeedbackMemoryResult(BaseModel):
    changed: bool
    warnings: list[str]
    message: str


def user_feedback_memory(ctx: FunctionContext, data: UserFeedbackMemoryInput) -> UserFeedbackMemoryResult:
    block = None if data.remove else AGENTS_BLOCK
    guide = None if data.remove else AGENTS_GUIDE
    try:
        done = agents_md_write(ctx.pod, "user-feedback", block, guide)
    except Exception as exc:  # noqa: BLE001 — set-up goes on without it
        return UserFeedbackMemoryResult(changed=False, warnings=[f"{type(exc).__name__}: {exc}"[:500]],
                                   message="Could not tell this Lemma's agents about User feedback.")
    changed = bool(done["index"]["changed"] or (done["guide"] or {}).get("changed"))
    if data.remove:
        message = "Took User feedback out of this Lemma's memory." if changed else "User feedback was not in this Lemma's memory."
    else:
        message = "Told this Lemma's agents about User feedback." if changed else "This Lemma's agents already know about User feedback."
    return UserFeedbackMemoryResult(changed=changed, warnings=done["warnings"], message=message)
