#input_type_name: KnowhowMemoryInput
#output_type_name: KnowhowMemoryResult
#function_name: knowhow_memory

"""Tells this Lemma's agents that Know-how is installed, through the
contract's write rule (_contract/snippets/agents-md.py, embedded below):
Know-how's block in /memory/AGENTS.md, which every agent reads at the start
of every run, and its guide at /memory/plugins/know-how.md, read when someone
asks a how, what or policy question. Only the text between Know-how's own
markers is written, so the team's notes in either file stay.

Set-up runs it last (knowhow_setup_save with `done`), so nothing waits on
it; running it again changes nothing unless the text did, and puts the block
back if something took it out. `remove` takes the block and the guide's text
out, for an uninstall. Never raises.

AGENTS_BLOCK and AGENTS_GUIDE are .lemma/agents-block.md and .lemma/guide.md,
copied in by `_contract/lint.py --fix`; edit those, never these.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

AGENTS_BLOCK = """\
- Know-how: team answers and procedures. Answer via `knowhow_answer`, say its source; walk steps: `knowhow_walk`. `/memory/plugins/know-how.md`
"""
AGENTS_GUIDE = """\
# Know-how

Know-how keeps the team's answers, procedures and policies as Markdown pages
under `/know-how/<topic>/`, each with an owner and a check date. The team sees
them in the Know-how app (Answers `/`, Library `/library`, a page `/p/<id>`).

## Answer: `knowhow_answer`

- For any how, what, when or policy question, call `knowhow_answer` with the
  asker's words (`question`), and where they asked: `source` (teams, slack,
  email, web or app), `place` ("#sales-desk", "chat"), `channel_id` or
  `conversation_id`, `asker_name`. Call it before searching other files.
- Answer only from the page it returns, and end with its `say` line, word for
  word: the page, who checked it, and when.
- If an answer is `late`, still give it, and say plainly that it's past its
  check date and that you've asked the owner (the `say` line does).
- Never invent a step, number, price or date. Give only what the page says.
- If it `partly` answers, give that part and say the rest isn't written down.

## When nothing fits

- Say so. Don't guess. `knowhow_answer` has already logged the question.
- When the result's `ask_by` is `teams`, ask the owner (`owner_member_id`)
  with `channel_post`: one question, with the `earlier` askings, and wait.
  Tell the asker you've asked them, by name.
- When the owner's reply comes, tell the asker ("Priya says…"), then call
  `knowhow_draft` with `question_ids` [the result's `question_id`], `reply`
  (the reply word for word), `reply_who` and `reply_where`.
- If the asker says an answer is wrong, call `knowhow_missing` with their
  words, `wrong` true and the page's `article_id`.

## Walk a procedure: `knowhow_walk`

- "How do I…?" for a procedure: `knowhow_walk` with `action` start and
  `text` (their words). Show one step at a time, as its `say` says, then
  `ask_user` with Done, I'm stuck, Stop. Wait for Done before the next step
  (`action` done, `walk_id`).
- A question asked mid-walk: `action` question with their words. It goes to
  the owner; carry on with the same step. When the owner replies, call
  `knowhow_draft` with `article_id`, `step` and the reply: it becomes a
  proposed change to that step.

## Make a procedure from a thread

After a long how-to thread, offer "make this a procedure". If they say yes,
read the thread (Teams: `teams_get_recent_channel_messages`; Slack: the
thread) and call `knowhow_from_thread` with its text and link.

## Never

- Sensitive topics (leave, pay, health): never repeat who asked, to anyone.
- Never approve, publish or retire a page, and never save a draft as an
  answer, for the team: the owner does that in the app.
- Customers (contacts) get only `knowhow_answer_for_contact`'s answers;
  never give a customer a team page.
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


class KnowhowMemoryInput(BaseModel):
    remove: bool = False


class KnowhowMemoryResult(BaseModel):
    changed: bool
    warnings: list[str]
    message: str


def knowhow_memory(ctx: FunctionContext, data: KnowhowMemoryInput) -> KnowhowMemoryResult:
    block = None if data.remove else AGENTS_BLOCK
    guide = None if data.remove else AGENTS_GUIDE
    try:
        done = agents_md_write(ctx.pod, "know-how", block, guide)
    except Exception as exc:  # noqa: BLE001 — set-up goes on without it
        return KnowhowMemoryResult(changed=False, warnings=[f"{type(exc).__name__}: {exc}"[:500]],
                                   message="Could not tell this Lemma's agents about Know-how.")
    changed = bool(done["index"]["changed"] or (done["guide"] or {}).get("changed"))
    if data.remove:
        message = "Took Know-how out of this Lemma's memory." if changed else "Know-how was not in this Lemma's memory."
    else:
        message = "Told this Lemma's agents about Know-how." if changed else "This Lemma's agents already know about Know-how."
    return KnowhowMemoryResult(changed=changed, warnings=done["warnings"], message=message)
