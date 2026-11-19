#input_type_name: LeadsMemoryInput
#output_type_name: LeadsMemoryResult
#function_name: leads_memory

"""Tells this Lemma's agents that Lead research is installed, through the
contract's write rule (_contract/snippets/agents-md.py, embedded below): its
block in /memory/AGENTS.md, which every agent reads at the start of every run,
and its guide at /memory/plugins/leads.md, read when a lead comes up: how to
ask for a look-up from chat and where lead facts live. Only the text between
its own markers is written, so the team's notes in either file stay.

Set-up runs it last (leads-setup); running it again changes nothing unless the
text did. `remove` takes the block and the guide's text out, for an
uninstall. Never raises: a Lemma whose memory could not be written still
finishes set-up, and the reason is in the result.

AGENTS_BLOCK and AGENTS_GUIDE are .lemma/agents-block.md and .lemma/guide.md,
copied in by `_contract/lint.py --fix`; edit those, never these.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

AGENTS_BLOCK = """\
- Lead research is installed: people and companies looked up, each fact with its link. Ask with `leads_request`; more: `/memory/plugins/leads.md`.
"""
AGENTS_GUIDE = """\
# Lead research

What the Lead research plugin holds and how to use it from a conversation. Its
set-up rewrites everything between the markers around this text; the team's
own notes about it go below them and stay.

## What it does

- Looks up each new person People map counts as someone you deal with
  (customers, investors and partners unless the person chose otherwise; never
  colleagues or "other") the first time they matter: their role, what their
  company does, its size, recent news, and how well the company fits the
  team's description of a good fit, 1 to 5.
- "Worth looking up?" and the fit are Decisions calls; corrections are the
  examples, and corrected companies go into the fit question. A daily limit
  (`leads_settings.daily_limit`, 10 by default) holds the automatic look-ups;
  the rest wait for the next day, best first.

## Where lead facts live

- `leads_person`, each person's own, id = the person's id: `state` (skipped,
  unsure, proposed, queued, wanted, looking, ready, failed), `role`,
  `location`, `profile_url`, `summary`, `facts` (each `{key, label, value,
  url, source, found_at}`), `not_found`, `review` (new,
  kept, passed), `worth_reason`.
- `leads_company`, team-wide, id = the company's id: `facts` and `news` (each
  with `url`, `source`, `found_at`, and a news item's `date`), and the team's
  fit: `fit` 1 to 5, `fit_sure`, `fit_why`, `fit_by` (decision or person).
- `leads_profile`, team-wide, one row: who fits the team (`fit_sentence`,
  `fit_examples`). Any member may change it.
- What a company does, its size and head office: the shared `company` row and
  People map's `people_company.research` with its `research_sources`.
- The app is `leads`; a lead opens at `/<person id>`.

## From chat

- **Look someone up**: run the function `leads_request` straight away, with
  one of `person_id`, `handle` (their email address) or `name`, and nothing
  else; it finds the person itself. Someone at a made-up `.example` address
  is sample data: their look-up says "not found" at once and costs nothing.
  Its `message` says what happened: looking them up now, already looked up,
  or today's look-ups are used and they wait for tomorrow. Tell the person
  that, in those words, and stop. Only when they then say to go past the
  limit (or to look again), run it once more with `force: true`.
- **Read a lead**: query `leads_person` by the person's id (see above); a
  look-up takes one to three minutes.
- **Correct an answer**: `leads_correct` with `person_id` and `worth` (true or
  false), `fit` (1 to 5) or `review` (kept or passed). A correction teaches
  the next answer.
- **Answer from the facts**: give a fact with its link and the date it was
  found. "Not found" is an answer: say so, and never fill the gap from memory.

## Never

- Never state a fact about a person or a company without its source link.
- Never look up colleagues, people marked "other", or anyone for personal
  reasons: Lead research is for people at work.
- Never put personal details (home, family, health, private contact details)
  in a lead, even when a page shows them.
- Never skip, correct, keep or pass a lead unless the person asked.
- Never get round the daily limit yourself: no `force` unless the person
  said so after hearing the limit was used, and never run `leads_claim`.
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


class LeadsMemoryInput(BaseModel):
    remove: bool = False


class LeadsMemoryResult(BaseModel):
    changed: bool
    warnings: list[str]
    message: str


def leads_memory(ctx: FunctionContext, data: LeadsMemoryInput) -> LeadsMemoryResult:
    block = None if data.remove else AGENTS_BLOCK
    guide = None if data.remove else AGENTS_GUIDE
    try:
        done = agents_md_write(ctx.pod, "leads", block, guide)
    except Exception as exc:  # noqa: BLE001 - set-up goes on without it
        return LeadsMemoryResult(changed=False, warnings=[f"{type(exc).__name__}: {exc}"[:500]],
                                 message="Could not tell this Lemma's agents about Lead research.")
    changed = bool(done["index"]["changed"] or (done["guide"] or {}).get("changed"))
    if data.remove:
        message = "Took Lead research out of this Lemma's memory." if changed else "Lead research was not in this Lemma's memory."
    else:
        message = "Told this Lemma's agents about Lead research." if changed else "This Lemma's agents already know about Lead research."
    return LeadsMemoryResult(changed=changed, warnings=done["warnings"], message=message)
