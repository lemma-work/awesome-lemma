# Brand kit

Everything you make looks and sounds like you. Paste your website (or upload
your logo and brand guide) and the Lemma reads your colours, type, logos and
voice, keeping the evidence it found: screenshots, the CSS, the words. A person
checks what it found and fixes anything wrong. From then on every plugin that
makes something reads the same brand (Deck maker, Proposals, LinkedIn,
Newsletter, Mail's drafts), the Lemma's own assistant follows it whenever it
writes or makes anything for the team, and graphics (a launch post, a social
image, a banner) are made in it, from chat or from the app, and checked against
it before anyone sees them. It merges the catalog's Brand studio.

Brand kit carries no other plugin. The brand is the team's, not one person's:
one person's read again changes it for everyone.

Built from `lemma-pods/brand-design` (copied, never edited): its tables, its
`extract_site_style` and `start_intake`, its two playbooks, and the
`brand-studio` app's ideas (measured contrast, "the chrome never wears the
customer's brand").

Tested in two Lemmas: this folder's bundle installed alone into an empty
one, server-side (`_build/install.py`: every part CREATE, COMPLETED, the app
built in the importer's sandbox; the app, `brand`, is for the Lemma's members),
and a build Lemma (CLI imports; the sample, a public site read, designs from
chat and app).

## What it does

```
a website (or a folder of uploads), from the app's first step, "Read again", or chat
   ─▶ brand_read: the brand (state reading; the first is the default) + a brand_job row, state wanted
   ─▶ brand-job-wanted (DATASTORE, INSERT, when state = wanted) ─▶ brand-job workflow, as the person who asked
        brand_job_start: the brief, with /brand/reading-a-brand.md in full
        AGENT step, the Lemma's own assistant (pod_default), unattended:
            brand_site_style   the static read; keeps the CSS as evidence
            a browser          screenshots of two pages ─▶ <root>/evidence/
            brand_add_assets   downloads each asset; one Decisions call each: what is it? is it theirs?
            brand_save         colours by role, faces, voice, guide, logos, evidence; measures contrast,
                               keeps a person's fixes, writes theme.css + theme.json; state check
        brand_job_end: done or failed; needs_you for the person who asked ("Check the brand")
   ─▶ the person checks it in the app (onboarding step 2): fixes (brand_fix), then Looks right (state ready)

a design: in chat the assistant makes it itself; in the app "New design" / "Ask for a change"
   adds a brand_job (make / revise) and the same workflow makes it. Both follow /brand/making-a-design.md:
        brand_start_design  the version's folder, its size, the brand's theme and logos
        index.html linking a copy of theme.css, rendered to preview.png in a browser, uploaded
        brand_save_design   one Decisions call before anyone sees it: does it follow the brand, and
                            which rule did it break? breaks ─▶ fix it and make the next version
   ─▶ needs_you for whoever asked ("Review …"); Approve or Ask for a change in the app
```

| Layer | Resources |
| --- | --- |
| Shared table it adds (in `_contract`) | `brand`: name, default, state, colours with roles, faces, tokens + `theme_css_path`, logos, `guide_path`, voice, site, `source` + `source_id` |
| Shared list it writes | `needs_you` (decide; see below) |
| Its own tables | `brand_asset` (what was collected, and what the call or a person said it is) `brand_evidence` (screenshots, CSS, quoted copy, documents) `brand_job` (the assistant's work; the row is the run's input) `brand_design` `brand_version` (every version, with its brand check) `brand_correction` (the person's fixes: the examples) `brand_sample_row` |
| Functions | `brand_setup` `brand_read` `brand_site_style` `brand_add_assets` `brand_save` `brand_start_design` `brand_save_design` `brand_job_start` `brand_job_end` `brand_needs_you` `brand_fix` `brand_design_action` `brand_sample_data` (grants from `bin/grants.sh`) |
| Workflow, schedule | `brand-job` (FUNCTION, DECISION, AGENT `pod_default`, FUNCTION), `brand-job-wanted` |
| Agents | none: the Lemma's own assistant reads brands and makes designs |
| Folders | `/brand` (playbooks, then `/brand/<slug>/`: guide.md, theme.css, theme.json, assets/, evidence/, designs/<design>/v<N>/); `/memory` (the contract's, for the memory block) |
| App | `apps/brand` (Vite, `@lemma-plugins/kit`), design in `DESIGN.md` |

Shared code is copied, not imported (a function is one `code.py`):
`bin/embed.py` copies `_shared/colour.py`, `_shared/theme.py`, the playbooks
(`_shared/*.md`), the sample's files (`_shared/sample/`), the memory block and
guide (`.lemma/`), and the contract's snippets into each function between
markers. Run it after changing any of them.

## Why a workflow, not a function

A function cannot start the Lemma's assistant (`agent.execute` on it is
checked against the pod; Tasks' README has the code references), and a
workflow run takes no input. So a `brand_job` row is the input: added with
state `wanted`, its INSERT starts `brand-job` as the person who wrote it, and
the AGENT step runs the assistant as them. The app, `brand_read` and the
design actions only write rows; chat and the app reach the same playbooks and
the same check.

## Onboarding (the app)

1. **Your website**, or **upload your logo and guide** (to `/brand/uploads/<time>/`,
   then read as files: a guide outranks the site), or **a made-up brand**. The
   read runs live on screen: five steps with the job's activity line, the
   screenshots and assets as they land.
2. **Check what it found**: the brand page with a banner. Each colour with its
   role, what it is for and where it was found; the contrast it measured
   between them, worded (passes, large text only, too faint); faces set in
   themselves; logos on the grounds they are for; the voice with quoted
   phrases; every asset with the call's answer; the evidence. Fix a colour, a
   face, the voice, what an asset is; then **Looks right**.

The app also runs `brand_setup` on open: the memory block and the playbooks.

## Memory block

`brand_setup` writes, through the contract's `agents-md` snippet:

- in `/memory/AGENTS.md` (170 characters with its markers): "Brand kit:
  whatever you write or make for the team follows its brand and voice. Read
  /memory/plugins/brand.md before you do."
- `/memory/plugins/brand.md`: where the brand is, words in its voice, anything
  visual only from its colours, faces and logo files, graphics through the
  playbook and the check, reading a brand through `brand_read` (ask first when
  one is there), and the app's addresses.

Sources: `.lemma/agents-block.md`, `.lemma/guide.md`. The playbooks are
`/brand/reading-a-brand.md` and `/brand/making-a-design.md`.

## The two questions (Decisions API)

**What is this asset?** One call per collected asset: `kind` (logo, icon,
photo, illustration, other) and `own` (the brand's, or a customer's logo, a
badge, a stock avatar). The evidence is its file name, format and size, where
it was found and what was around it. Under 0.5 is unsure ("Not sure", waiting
for a person); not the brand's own is put away. Corrections: the person saying
what it is, or whose it is.

**Does this design follow the brand?** One call per version, before anyone
sees it: `follows` (yes/no) and `broke` (none, colour, type, logo, contrast,
voice, other). The evidence is the design as measured beside the brand: every
colour written into it with the nearest brand colour (CIE76 distance, under 6
is the same colour; translucent black or white allowed), the first face of
every font stack, the images it uses (the brand's logo files, its other
assets, or neither) and any mark drawn in place of a logo, text contrast where
the CSS sets both, and its words beside the voice and the guide's voice
section. Under 0.5 is unsure (shown, "a person should look"). Corrections:
"Wrong?" on a check.

The newest corrections of each kind go with every later call as examples. A
fixed colour or face is kept over the next read (`brand_save`).

## Needs you (Today's list)

`brand_needs_you` writes the person's items with the contract's write rule:

| Verb | When | Opens |
| --- | --- | --- |
| `decide` | a design they asked for whose current version follows the brand (or the check wasn't sure): "Review “…”" | `brand` `/designs/<id>` |
| `decide` | a design they asked for whose current version breaks it and wasn't fixed: "“…” breaks the brand" | same |
| `decide` | the brand, after a read they started, waiting for a check: "Check …’s brand" | `brand` `/` |

It runs as the person: at the end of each brand job (the job's run is theirs),
after a design is kept in chat, after their fixes and design actions, and when
they open the app. Approving, Looks right and clearing the sample resolve them.

## For other plugins: reading the brand

```sql
SELECT * FROM brand WHERE state IN ('check', 'ready') ORDER BY is_default DESC, synced_at DESC NULLS LAST LIMIT 1
```

`tokens` (`--brand-ink`, `--brand-surface`, `--brand-surface-2`,
`--brand-line`, `--brand-muted`, `--brand-accent`, `--brand-accent-ink`,
`--brand-ok`, `--brand-bad`, extras by name, `--brand-font-display|body|mono`,
`--brand-radius`), or link `theme_css_path`; `colors[]` has `role`, `value`,
`name`, `for`, `from`; `fonts.{display,body,mono}` has `family`, `stack`,
`source` (google, open, licensed, system); `logos[]` has `variant` (primary,
inverse, mono, mark) and `path`; `voice` is a line, `guide_path` the guide.
Deck maker reads exactly this. A gap is to be said, never filled.

## Install

`install/brand/` at the top of this repository is Brand kit, ready to
install: **Add to your Lemma** on its page at lemma.work imports it. From the
CLI, the same server-side import:

```bash
# from the repository root
uv run --no-project python _build/install.py brand --pod <pod-id> --var brand_slug=<free slug>
```

`bin/lemma` is the `lemma` CLI bound to one Lemma (`LEMMA_SERVER`,
`LEMMA_ORG_ID` and `LEMMA_POD_ID`, from the environment or a gitignored
`.lemma.env` in this folder; `--pod` overrides). `bin/grants.sh` regenerates
every function's grants. After changing shared code, `uv run --no-project
python bin/embed.py`. After a kit change, `../_kit/bin/vendor.sh brand`;
after any change here, from the repository root, `uv run --no-project python
_build/assemble.py --install brand` and the lint. To change only Brand kit's
parts in a Lemma that has them: `bin/lemma pods import <part folder>`.

A dev server against a Lemma (nothing written to the bundle):

```bash
cd apps/brand/source
LEMMA_DEV_PROXY_TARGET=https://api.lemma.work VITE_LEMMA_BASE_URL=/api VITE_LEMMA_POD_ID=<pod-id> \
VITE_LEMMA_AUTH_URL=https://lemma.work/auth VITE_LEMMA_DEV_TOKEN_CMD="$PWD/../../../bin/lemma auth print-token" \
npx vite --host 127.0.0.1 --port 4671
```

## Verify

```bash
bin/lemma functions run brand_setup --data '{}'
bin/lemma files cat /memory/AGENTS.md
bin/lemma functions run brand_read --data '{"url":"https://<a public website>"}'
bin/lemma query run "SELECT kind, state, activity, note FROM brand_job ORDER BY created_at DESC"
bin/lemma query run "SELECT label, kind, own, confidence, state, reason FROM brand_asset"
bin/lemma chat -m "Make a banner for our docs page in our brand: …"
bin/lemma query run "SELECT d.title, v.version, v.verdict, v.broke, v.reason FROM brand_version v JOIN brand_design d ON d.id = v.design_id"
bin/lemma functions run brand_sample_data --data '{"mode":"load"}'
bin/lemma functions run brand_sample_data --data '{"mode":"clear"}'
```

## Seen working (18 Nov 2026, on a hosted Lemma)

Two public open-source projects' websites stood in for a team's own site
(called A and B here); the pictures and the sample use only the made-up
Fennel & Fig.

- **Install**: `_build/install.py` into the empty installed Lemma: 40 parts
  CREATE, COMPLETED, the app built in the importer's sandbox.
- **Onboarding from a URL, in the app** (installed Lemma, dev server with the
  CLI's session): site A typed into step 1; the read ran live (five steps,
  the activity line) and saved in about 5 minutes: 9 colours with roles and
  where each was found, 4 faces, 4 logo files (light and dark lockups, the
  mark, the favicon), 2 screenshots, quoted copy, a guide with "Not found".
  Its note flagged that the site's darker orange for text might not be the
  accent people name. Step 2: the accent fixed to the brighter orange (the
  sheet showed white on it falling to 3.53:1, large text only), Looks right,
  then Read again: the fix was kept, the brand went back to check, and "Check
  A's brand" reopened for whoever started it.
- **Site B from chat's door** (`brand_read`, build Lemma): 10 colours, three
  faces (display, body, mono), the mark, 8 assets all sorted right (logo
  1.00, og:image "other" 0.96, illustrations 0.89 to 0.98), and the accent as
  text on white flagged at 1.55:1.
- **A fix teaching it**: a drawn 500px picture from site B was called an
  illustration (0.61); a second like it, illustration (0.66). Corrected the
  first to icon in the app; asked again, the second came back icon (0.88),
  and a third, new one icon (0.76). (Those three test assets were added to the
  build Lemma's brand B for this test.)
- **Designs from chat and from the app, both on brand**: from chat, a
  banner for B (its display face, its button colour, its mark: follows,
  0.74); from the app, a post (follows, 0.63); "Ask for a change" made
  version 3 through a revise job (follows). In the installed Lemma a chat
  post's version 1 broke brand A on contrast (its orange as small text on
  white, 3.53:1, 0.91); the assistant fixed it and showed only version 2
  (follows, 0.83).
- **The check catching off-brand versions**: the sample banner's blue
  headline (colour, 0.98 to 0.99 over three loads) and a hand-edited orange
  button on the chat banner (colour, 0.98; white on it 2.87:1 measured too).
- **Memory block**: in `/memory/AGENTS.md` of both Lemmas (written by the app's
  set-up on first open). Asked in chat for a community post with no mention of
  the brand, the assistant read `/memory/plugins/brand.md` and the guide and
  wrote it "in the voice from your brand guide (plain, direct, 'you', the
  odd exclamation)".
- **Sample**: load about 90 s (five asset calls, three brand checks, all
  real). Clear in the installed Lemma, beside a real brand: removed its 14 rows,
  19 files and 9 folders; brand A, its assets, evidence and jobs untouched;
  the person's two corrections kept; its needs_you items closed by the source.
- Light, dark and 375px in rendered screenshots, no sideways scroll.

## Not verified

- **Uploaded files** (logo and guide PDF) as a source: built and wired
  (`/brand/uploads/<time>/`, read as files), never run end to end.
- The hosted app signed in (it answers 401 unsigned); every look was the
  same build through a dev server against the Lemma's API, or on fixtures.
- A second member: the brand is team-wide by design; needs_you RLS rests on
  the contract table.
- Mail's drafts in the brand voice: Mail's `mail-writer` has no MEMORY toolset,
  so the memory block does not reach it (see calls).

## Site pictures

`.lemma/shots/brand{,-design}-{light,dark}.webp`, 1440×900 at 2x: the brand
page in check mode and the sample banner's design page at version 1 (the
check catching the blue headline). The made-up sample brand only, read "from"
`fennelandfig.example`; no real company's brand. From the build Lemma's sample
rows: `bin/shot-fixtures.py --pod <id>`, then `bin/shots_serve.py --app
apps/brand/source/dist --fixtures .lemma/shots/fixtures --port 4681` and from
the repository root: `node _kit/bin/shoot.mjs http://127.0.0.1:4681 brand/.lemma/shots
brand=/ brand-design=/designs/<id>/1`, then `cwebp`.

## Things that bit

- **A sample load is ~90 s**: nested function runs cost seconds each. The app
  starts it and follows the rows rather than waiting on the call.
- **Re-checking an old version moved the design back to it**; fixed:
  only the newest version is the design's current one.
- **A title from the prompt's first sentence** cut in the middle of a URL;
  now cut at a sentence end and a word near 70 characters.
- **White illustrations vanished on white**: tiles measure their own pixels and
  go on the brand's dark ink.
- **The dev server gets no change stream**: the app polls while a job is live.
