#input_type_name: BrandSetupInput
#output_type_name: BrandSetupResult
#function_name: brand_setup

"""Brand kit's set-up for this Lemma: safe to run again, and run often.

- The memory block in /memory/AGENTS.md, which every agent here reads at the
  start of every conversation: whatever the Lemma writes or makes for the team
  follows its brand and voice, with a pointer to the guide at
  /memory/plugins/brand.md (the contract's agents-md snippet, embedded).
- The playbooks the Lemma's assistant follows: /brand/reading-a-brand.md and
  /brand/making-a-design.md.

Run by the Brand app when it opens, by `brand_read`, and by every brand job.
`remove` takes the block and the guide away (the plugin leaving).
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

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

AGENTS_BLOCK = """\
Brand kit: whatever you write or make for the team follows its brand and voice. Read /memory/plugins/brand.md before you do.
"""
AGENTS_GUIDE = """\
# Brand kit

The team's brand lives in this Lemma. Everything you write or make for the team follows it: a post, a draft or a reply written for someone, an email, a deck, a proposal, a graphic.

## Where it is
- The default row of the `brand` table (`is_default`, state `check` or `ready`): `colors` (each with its role and what it is for), `fonts`, `tokens` (CSS custom properties) and `theme_css_path`, `logos` and `logo_path`, `voice`, and `guide_path`, the written guide.
- Search the guide before you write: it has the voice with real phrases from the team, and its do's and don'ts.
- No brand row, or state `new` or `reading`: there is no brand yet. Say so, and never make one up.

## Words
Write in the brand's voice: its tone, its sentence length, the words it uses and avoids. Use its real phrases where they fit. Never invent facts, prices, dates or quotes to sound like it. A reply written as a person still keeps to the brand's don'ts.

## Anything visual
- Only the brand's colours, faces and logo files (`tokens` or `theme_css_path`, and `logos`). Never redraw a logo or invent a colour or a face, not even as a placeholder.
- A graphic (a launch post, a social image, a banner): read /brand/making-a-design.md first. Start it with `brand_start_design` and keep it with `brand_save_design`, which checks it against the brand before anyone sees it. Show only a version that follows the brand.
- A deck, a document or a page: link `theme_css_path` and use `var(--brand-…)`.

## Reading a brand
- Someone gives you the team's website, or a logo and a brand guide they uploaded: call `brand_read` (a url, or the folder). It runs in the background, the Brand app shows it, and a person checks what it found.
- Reading again changes the brand for the whole team: when there is one already, ask first. A fix a person made in the Brand app is kept.

## The Brand app
`brand`: the brand and its evidence at `/`, designs at `/designs`, one design at `/designs/<id>`.
"""

# --- playbooks: (embedded by bin/embed.py from _shared/*.md) ---
READING = """\
# Reading a brand

You are reading a team's brand for Brand kit: the palette they actually use, the faces they actually set, their logos and other assets, how they talk, and the evidence for each. Everything hangs off one `brand_job` row (its id is in your brief) and the brand's row in `brand`.

## You are unattended
A brand job runs with nobody in the conversation. Never call `ask_user` or `request_approval`: they wait for an answer that cannot come, and the job looks stuck forever. Never delete files; overwrite a wrong one at the same path. When something needs a person, finish everything else, then say it in your last message (it is kept on the job).

You stand between this Lemma and an invented brand. A plausible made-up palette is worse than none, because it ships. When you can't find something, write that you couldn't. Never fill a gap.

## Keep the job moving
People watch the job's `activity` line in the Brand app. Before each batch of work, set it (update the `brand_job` row: `activity`, one short present-tense line). Pass `job_id` to the Brand kit functions and they keep it too. Two minutes of silence is the most you may spend. Budget: ten minutes in all; at eight, stop collecting and save.

## A website
1. **The static read.** Call `brand_site_style` with the url, `brand_id` and `job_id`. It returns ranked candidates (the site's own custom properties that resolve to colours, colours by use, font stacks, @font-face families, radii, logo and icon candidates) and keeps the CSS it read as evidence. Read its `notes` first: a JS-rendered page or unresolved custom properties mean the browser read matters more. If it could not fetch the site, say exactly that and stop.
2. **Look at it.** Load the `browser` skill and use its default session. Set the display to 1440×900, open the home page, take a screenshot, and look at it: you are judging a brand. Then one interior page (pricing, product, about). Upload each screenshot to `<folder>/evidence/<page>.png` (absolute pod paths). Read computed styles for what the static read couldn't resolve (`getComputedStyle(document.body).fontFamily`, `getPropertyValue('--name')`).
3. **Collect the assets.** Logos (the header and footer lockups and every variant: inverse, mono, the mark alone), the favicon or app icon (prefer SVG), the social card (`og:image`), illustrations, photos, icons. Prefer SVG, then the largest raster (drop `?w=` resizing). Pass them to `brand_add_assets` as `url`s, each with `found` (where on the page, its alt text, what it sat next to), a `label`, and for logos a `variant`. It downloads each, keeps it, and asks what each is (logo, icon, photo, illustration, other) and whether it is the brand's own. At most 8 of a kind, 24 in all. Leave out what is plainly not theirs: customer logo walls, payment and app-store badges, cookie banners.
4. **Logos: capture, never recreate.** Never redraw a mark, outline type into paths or rebuild a lockup you couldn't download: a rebuilt logo is a forgery that ends up on real material. No clean file, no logo, and the guide says so.
5. **Faces.** Record each one: family, the site's full fallback stack, where it is used, and `source`: google (on Google Fonts), open (another open licence), licensed (sold per seat, such as Söhne, Circular or GT America: named, never stored), system.
6. **Voice.** Read the real copy: the headline, the subhead, a product page, the footer. Write how they talk in two or three sentences, and quote three to five real phrases word for word. Never paraphrase into something that "sounds like them".

## Uploaded files
When the source is a folder (`/brand/uploads/…`), a person uploaded a logo and perhaps a brand guide. List the folder. A document is converted for you: read it as markdown and look at its page images. Pass logo and image files to `brand_add_assets` as `path`s. A brand guide outranks a website; when they disagree, the guide wins, and the guide you write says so.

## Save it
Call `brand_save` once, at the end, with `brand_id` and `job_id` and:
- `colors`: every colour with its role: ink (body text), surface (the page), surface_2 (cards, panels), line (borders), muted (secondary text), accent (the one a stranger would name as theirs), accent_ink (text on the accent), ok, bad; any other is extra. Each with `name`, `purpose` (what it is for) and `found_in` (where you found it: a custom property and its file, a screenshot).
- `fonts`: `display`, `body`, `mono`, each with family, stack, weight, source.
- `voice` (two or three sentences) and `guide` (the whole guide, markdown: below).
- `logos`: the asset ids from `brand_add_assets` that are logos, each with its `variant` (primary, inverse, mono, mark) and `on` (light or dark).
- `evidence`: each screenshot you uploaded (`kind` screenshot, `path`, `url`, `about`: colors, fonts, logos or voice), and the copy you quoted (`kind` copy, `excerpt`, `url`, `about` voice). The CSS is kept already.
- `radius`: the corner radius the site uses most, when there is one.

It measures the contrast of every pair that matters, picks the text colour for the accent when you didn't (measured, never assumed white), keeps any colour or face a person fixed, writes `theme.css` and `theme.json`, and asks a person to check the brand. Read what it returns. When a pair fails, look again at which colour has which role. Never invent a colour to make it pass.

## The guide
Markdown prose, because people read it and every other plugin searches it: what the brand is; the palette and what each colour is for; the type and how it is set; the logo and its clear space; the voice, with its real quoted phrases; a short do and don't. End with **Not found**: everything you looked for and couldn't establish. That section is the most valuable part.

## When it goes wrong
The site is unreachable or behind a login: say exactly that in your last message, and don't call `brand_save`; the brand keeps what it had. Never go and find another company with a similar name.

## Your last message
Three lines at most: what you found, what you couldn't, and anything a person should check.
"""

MAKING = """\
# Making a design

You are making a graphic in the team's brand: a launch post, a social image, a banner, a poster. You plan it and build it.

## The brand
The default row of the `brand` table (state `check` or `ready`): `tokens`, `theme_css_path`, `logos`, `voice`, `guide_path`. Search the guide for what this piece touches. Look at the team's past designs (`brand_design`, approved first) for a near neighbour: a fourth launch post should look like it came from the same team as the first three. No brand yet: in chat, ask for the team's website (then `brand_read`); never make one up.

## Plan
Ask at most one question, and only when the answer changes the work. "What's the headline?" changes it; "What vibe?" doesn't, because the brand answered that. Where you can decide, decide, and say what you decided. In a brand job nobody is there: never ask, decide.

## Build
1. Call `brand_start_design` with a short `title`, the `kind` (social_post 1080×1080, social_card 1200×630, story 1080×1920, banner 1500×500, poster 1080×1350, one_pager 816×1056, other) and the `prompt` in the person's words; for a new version of a design, just its `design_id`. It returns the version, the folder to upload to, the size, and the brand's theme and logo paths.
2. Work in a run directory of your own. Write one self-contained `index.html` at exactly that size. Copy the brand's `theme.css` beside it and link it (`<link rel="stylesheet" href="theme.css">`). Copy the logo file you use beside it too.
3. Every colour, face and radius comes from the `--brand-*` properties. A colour written into your HTML is a bug, except translucent black or white for a shadow or an overlay. The logo is the brand's own file, untouched: never redraw it, never set the name in a font to stand in for it, never put it on a ground it disappears into (use the inverse variant on dark). The words are in the brand's voice (the guide): short and specific, real details from the request, nothing invented (no made-up prices, dates or quotes).
4. Load the `browser` skill, open the file at its size, screenshot it to `preview.png`, and look at it. Fix what you see: text overflowing its box, a logo that disappears, text you can't read, a face that didn't load. Look again.
5. Upload `index.html`, `theme.css`, the logo file and `preview.png` to the folder it gave you (absolute pod paths).
6. Call `brand_save_design` with the `design_id` and `version`. It checks the version against the brand before anyone sees it ("Does this design follow the brand?") and names the rule it broke:
   - **follows**: done.
   - **breaks**: fix the rule it names and make the next version (`brand_start_design` with the `design_id`), twice at most. Never show a version that breaks the brand.
   - **unsure**: show it, and say a person should check it in the Brand app.

## Tell them
In chat: show the preview (`display_resource` on the preview image), say in a line what you decided, and that it waits for review in the Brand app. Lead with the thing, not the process. In a brand job, your last message says the same in two lines.

A change ("make the headline bigger") is a new version of the same design (`brand_start_design` with its `design_id`), never a new design.

## Not yours to decide
Never invent brand values, not as a placeholder. Reading the brand again changes it for the whole team: confirm with the person before calling `brand_read` on a brand that is already there.
"""
# --- end playbooks ---

PLAYBOOKS = {"/brand/reading-a-brand.md": READING, "/brand/making-a-design.md": MAKING}


class BrandSetupInput(BaseModel):
    remove: bool = False


class BrandSetupResult(BaseModel):
    memory: dict = {}
    playbooks: list[str] = []
    warnings: list[str] = []
    message: str


def _text(blob) -> str:
    return blob.decode("utf-8", "replace") if isinstance(blob, (bytes, bytearray)) else str(blob or "")


def brand_setup(ctx: FunctionContext, data: BrandSetupInput) -> BrandSetupResult:
    pod = ctx.pod
    if data.remove:
        result = agents_md_write(pod, "brand", None)
        return BrandSetupResult(memory=result, warnings=result.get("warnings") or [], message="Took Brand kit's block out of /memory/AGENTS.md.")
    written = []
    for path, text in PLAYBOOKS.items():
        try:
            current = _text(pod.files.download(path))
        except Exception:  # noqa: BLE001 — not there yet
            current = None
        if current != text:
            pod.files.write_text(path, text)
            written.append(path)
    result = agents_md_write(pod, "brand", AGENTS_BLOCK, AGENTS_GUIDE)
    changed = [p["path"] for p in (result.get("index"), result.get("guide")) if p and p.get("changed")]
    return BrandSetupResult(memory=result, playbooks=written, warnings=result.get("warnings") or [],
                            message=("Wrote " + ", ".join(written + changed) + ".") if (written or changed) else "Already set up.")
