# Deck maker

A deck from one sentence, in your brand, edited by asking, and exported to
PowerPoint. One app, `decks`: write the sentence, approve the outline, watch
the cards arrive one by one, then ask for changes; only the cards a request is
about change. Present, print or save as PDF, or export a `.pptx` that opens in
PowerPoint and Keynote. It merges in the catalog's Pitch deck.

Deck maker carries no other plugin and works alone. It listens when others
are there: with **Brand kit**, decks take the Lemma's brand (its colours,
type, logo and voice); without it, the person picks one of four themes.
**Today** shows what needs the person (an outline to approve, a deck that is
ready).

Tested in Lemmas named below as they were:

| | |
| --- | --- |
| `Deck maker` | this folder's bundle installed alone (`_build/install.py`); the app, `decks`, is for its members (they sign in) |
| `Deck maker with Brand kit` | Brand kit's assembled bundle installed, its sample loaded (Fennel & Fig), then this bundle (`brand` planned UPDATE, byte-identical) |
| an earlier test | Brand kit's draft table and a made-up brand, before Brand kit landed |

## What it does

```
a sentence (the app's box, set-up, or the Lemma's assistant in chat: decks_make)
   ─▶ decks_deck (status outlining) + decks_job outline (state wanted, the person's own row)
   ─▶ decks-job-wanted (DATASTORE, decks_job INSERT/UPDATE, when state becomes wanted) ─▶ decks-work, as the person
        decks_plan ─▶ AGENT decks-outliner ─▶ decks_save_outline ─▶ decks_finish ─▶ decks_needs_you
        the deck waits: outline_ready, "Approve the outline" in needs_you (decide)

the person approves (retitles, reorders, picks the look first) ─▶ decks_job cards (wanted)
   ─▶ decks-work: decks_plan ─▶ LOOP each card: AGENT decks-writer ─▶ decks_save_card ─▶ decks_finish
        each card is saved as it lands, so the app fills in card by card; "Your deck is ready" (do)

the person asks for a change ("make the pricing card punchier") ─▶ decks_job edit (wanted)
   ─▶ decks-work: decks_plan asks the Decisions API: which cards does this request touch? what does it ask for?
        rewrite / add a card after ─▶ LOOP only those cards: decks-writer ─▶ decks_save_card
        remove / change the look ─▶ done in the plan, no agent
        unsure ─▶ the job stops at ask; the person picks the cards (decide in needs_you)
   every edit keeps what it changed (before): Undo puts it back; "Wrong cards?" puts it back,
   keeps the person's pick as a correction, and asks again on exactly those cards
```

| Layer | Resources |
| --- | --- |
| Shared list it writes | `needs_you` (decide, do; see below) |
| Shared tables it reads | `brand` (Brand kit's, carried byte for byte from `_contract`, created only if missing), and the `/brand` folder for the guide (carried as Brand kit's own folder file) |
| Its own tables | `decks_deck` (team) `decks_card` (team) `decks_job` (each person's own: what they asked for) `decks_theme` (team) `decks_correction` (team: the examples) `decks_settings` (each person's own) `decks_sample_row` |
| Functions | `decks_make` `decks_plan` `decks_save_outline` `decks_save_card` `decks_finish` `decks_undo` `decks_needs_you` `decks_setup_look` `decks_setup_done` `decks_sample_data` `decks_memory` (grants from `bin/grants.sh`) |
| Agents | `decks-outliner`, `decks-writer`: no tools, `output_schema`, they only write; the functions keep what they return |
| Workflows | `decks-setup` (FORM steps), `decks-work` (every job) |
| Schedule | `decks-job-wanted` (one, on `decks_job`) |
| Folder | `/decks` (files people add to a deck), `/memory` (the contract's), `/brand` (Brand kit's, read only) |
| App | `apps/decks` (Vite, `@lemma-plugins/kit`), design in `DESIGN.md` |

### Why the work is a per-person job row

A datastore trigger on a team table runs as the schedule's owner, not as the
person who wrote the row (`lemma-backend/app/modules/schedule/services/trigger_fire.py`,
`run_person`; `datastore/changes/capture.py` records an owner only for RLS
tables). Decks are the team's, but the work on one, and the `needs_you` items
it writes, must be the asker's. So every request is a row in `decks_job`
(RLS): the run is theirs. Runs take no input, so the row's `state` going to
`wanted` is the request.

## Each person

They open Decks. With no settings yet the app makes them and starts their own
`decks-setup` run; its two forms are the set-up screen:

1. **How should your decks look?** With Brand kit in the Lemma, its brand
   first (drawn as a title slide in the brand), then four themes (Paper,
   Graphite, Harbor, Clay); without it, the themes and a line that Brand kit
   would bring their own.
2. **Make your first deck**: one sentence, or "Look around with a sample deck".

Set-up then writes Deck maker's memory block and opens the deck it made. The
run id is on the person's settings, so a reload lands where they were.

## Edit by asking: the Decisions call

One call per request (`decks_plan`), three closed questions:

- **cards**: multi-choice of the deck's cards (`c1`…`cN`, each described by its
  layout, title and a line of what it says) plus `none`: which cards does this
  request touch? For a new card, the card it goes after.
- **action**: rewrite, add (a card after), remove, look (colours and type
  only), none (not about this deck).
- **look**: for a change of look, which theme (or the brand) fits.

Under 0.5 on either is unsure (Typesafe never answers null). A
change to cards goes ahead on its own only from **0.6**, Tasks' bar; between
0.5 and 0.6 it asks, with its answer ticked (`state` ask; the app's picker,
and a `decide` item in Today). A request that names no card always asks. The
person's pick (`chosen`) is used as is; when it differs from the answer it is
kept in `decks_correction` with the evidence the call saw, and the newest
twenty go with every later call as examples. "Wrong cards?" on a finished edit
does the same after putting the edit back.

## Brand

Deck maker reads the shared `brand` table (`_contract/tables/brand.json`,
Brand kit's), as the contract says: the default row in state `check` or
`ready`. `decks_make` and `decks_plan` hold a read grant on it and on
`/brand` (for the guide), and share one way of reading it
(`bin/brand_block.py`, copied into both by `bin/brand-block.py`; `--check`
fails on a difference): colours by role (`--brand-*` tokens first, `colors`
roles second), the display and body faces (and the display weight), the logo
(the inverse one on a dark ground), and the voice: the `voice` line plus the
voice section of the guide at `guide_path`. A colour, face or logo the row
lacks falls back to a neutral, never to something made up.

- A new deck takes the brand when the person chose it at set-up, or when
  they never set up (a deck asked for in chat by someone who never opened
  Decks gets the team's brand); a theme only when they chose one.
- A brand deck follows the brand. The app draws it from the brand row as it is
  now (`useDecks`), and every job on it takes the look and voice afresh
  (`decks_plan`), so the outline and every card are written in the voice the
  brand has at that moment. `decks_deck.look`/`voice` hold the last ones
  taken, used when the brand is gone.
- The app shows the brand in set-up, the outline's look picker, a deck's
  menu and Settings, drawn by `brandLook` (`src/look.ts`, the same reading).

Carrying `brand` and `/brand` does not need Brand kit: installed alone, Deck
maker creates them empty (only if missing) and offers its themes.

## Needs you (Today's list)

`decks_needs_you`, with the contract's write rule (`_contract/snippets/needs-you.py`):

| Verb | When | Opens |
| --- | --- | --- |
| `decide` | an outline they asked for waits for approval | `decks` `/d/<deck id>` |
| `decide` | an edit they asked for where the call was unsure which cards | `decks` `/d/<deck id>/ask/<job id>` |
| `do` | a deck they had written is ready and they haven't opened it (7 days) | `decks` `/d/<deck id>` |

Runs at the end of every `decks-work` run, and from the app on approve and on
open. Approving closes the `decide` (by the source); opening the ready deck
closes the `do`.

## From chat

The memory block (`.lemma/agents-block.md`, written into `/memory/AGENTS.md`
by `decks_memory` at set-up) points the assistant at `decks_make` and the
guide (`.lemma/guide.md`, at `/memory/plugins/decks.md`). Seen: "Make me a deck
for our Monday team meeting: a 6-card update on the customer support backlog"
made the deck (source `chat`), read back its outline and gave the link to
approve it. "In the nurse overtime deck, make the closing card's ask sharper"
wrote an edit job; the call picked card 8 at 0.97 and only card 8 changed.

## Figures that stay current

A stat's `source` (`decks_card.blocks[].items[].source`) is the place for it:
`null` today. When a Numbers plugin exists, it sets `{ "plugin": "numbers",
"metric": <its id>, "as_of": <when read> }` on a figure it owns and rewrites
`value` when the metric moves (a job of its own, or a `decks_job` kind
`figures` added here). `decks_save_card` keeps `source` through rewrites;
nothing reads or writes it yet.

## Install

`install/decks/` at the top of this repository is Deck maker, ready to
install: **Add to your Lemma** on its page at lemma.work imports it. From the
CLI, the same server-side import:

```bash
# from the repository root
uv run --no-project python _build/install.py decks --pod <pod-id> --var decks_slug=<free slug>
```

After a change here, from the repository root: `_kit/bin/vendor.sh decks`
(after a kit change), `uv run --no-project python _build/assemble.py --install
decks`, then `uv run --no-project python _contract/lint.py`.

`bin/lemma` is the `lemma` CLI bound to one Lemma (`LEMMA_SERVER`,
`LEMMA_ORG_ID` and `LEMMA_POD_ID`, from the environment or a gitignored
`.lemma.env` in this folder; `--pod` overrides). `bin/grants.sh` regenerates
every function's grants. To change only Deck maker's parts in a Lemma that
has them: `bin/lemma pods import <part folder>`.

Local app against a Lemma (the API refuses a 127.0.0.1 origin, so use the
dev proxy):

```bash
cd apps/decks/source
LEMMA_DEV_PROXY_TARGET=https://api.lemma.work VITE_LEMMA_BASE_URL=http://127.0.0.1:4621/api \
VITE_LEMMA_AUTH_URL=https://lemma.work/auth VITE_LEMMA_POD_ID=<pod-id> \
VITE_LEMMA_DEV_TOKEN_CMD="$PWD/../../../bin/lemma auth print-token" npx vite --port 4621
```

## Verify

```bash
bin/lemma functions run decks_make --data '{"prompt":"…","source":"app"}'      # outline in ~15 s
bin/lemma query run "SELECT kind, state, summary FROM decks_job"
bin/lemma records create decks_job --data '{"deck_id":"…","kind":"cards","state":"wanted"}'   # approve
bin/lemma records create decks_job --data '{"deck_id":"…","kind":"edit","state":"wanted","request":"Remove card 7"}'
bin/lemma query run "SELECT action, cards, confidence, reason, summary FROM decks_job WHERE kind='edit'"
bin/lemma functions run decks_undo --data '{"job_id":"…"}'                    # or with "cards": [...] to correct
bin/lemma functions run decks_sample_data --data '{"mode":"load"}'           # and "clear"
```

## Measured (18 Nov 2026, on a hosted Lemma, `Deck maker`)

- **Outline**: 12 s from the job starting to the outline saved (~15 s from
  the sentence); the `decide` item written.
- **Cards**: 8 cards in 68 s, one at a time (~8.5 s each); the whole deck
  rewritten ("more formal"): 75 s.
- **An edit**: 19 to 23 s for one card, request to done; a look change or a
  removal, 9 s. The Decisions call itself: 0.59 to 1.38 s.

**Which cards does this request touch?** (Typesafe, interactive priority):

| Request | Answer | Confidence | What happened |
| --- | --- | --- | --- |
| Make the pilot card punchier and shorter | c1, rewrite | 0.56 | under the 0.5 rule it rewrote card 1 (the title card reads "a nurse-scheduling pilot…"); "Wrong cards?" put it back, kept c1→c6 and rewrote card 6 |
| Tighten the pilot card, fewer words (after that correction) | c1, rewrite | 0.54 | the example did not move it; this is why the bar for acting is 0.6 |
| Make the pilot card punchier and shorter (with the 0.6 bar) | c1, rewrite | 0.57 | asked; picked card 6 in the app (the Today link opens the question); correction kept |
| Card 3: turn the bullets into two short columns | c3, rewrite | 0.80 | card 3 only |
| Add a card about what the pilot costs after card 5 | c5, add | 0.65 | a new card 6, the rest moved down |
| Use a dark look for this deck | look, Graphite | 0.90 | look changed, no card's words |
| Remove card 7 | c7, remove | 0.98 | removed, renumbered |
| Make the whole deck more formal | c1–c8, rewrite | 0.76 | all eight |
| Make it better | no card, rewrite | 0.61 | asked (no card named) |
| Make the hiring card... sorry, make the card about missed calls shorter and punchier (app) | c3, rewrite | 0.60 | card 3 only |
| Card 8, the closing card: make the ask sharper (written by the assistant from chat) | c8, rewrite | 0.97 | card 8 only |
| Make the closing card's ask shorter and warmer | c8, rewrite | 0.98 | card 8 only |

Every Undo put the deck back exactly (card hashes and versions compared before
and after; added cards gone, removed ones back in place, the look restored).

## Seen working

- Set-up in the app, in both Lemmas: themes (and the brand where there is
  one), then a sentence; it opened the new deck. The outline review: retitle,
  layouts, look, approve; the cards filling in with "Writing card 5 of 8".
- Edit by asking from the app's panel, with the chips of changed cards, Undo
  and "Wrong cards?"; the unsure picker via its Today link.
- A file in the sentence box: "A short Q3 update for shop leads on the online
  booking roll-out" with a made-up `q3-numbers.md` attached went to
  `/decks/upload-…/` and every figure in it (1,240 bookings, 14% to 6%
  no-shows, 5.4 to 3.1 idle hours, 9 of 12 shops) is in the outline.
- Present mode: → ← Space, N for notes, Esc back to the deck; the counter.
- Print: 8 PDF pages at 13.33 × 7.5 in, one card each (Chrome's print to PDF).
- **Export**: the `.pptx` from the app opened in **Keynote** (8 slides; text,
  colours, accent runs, icons, the picture panel, notes; checked on the slide
  images Keynote exported) and in python-pptx (13.333 × 7.5 in, notes on every
  slide). A brand deck's export first failed to open in Keynote: pptxgenjs
  writes `Company` unescaped, and "Quarry & Kiln" broke `docProps/app.xml`;
  escaped now, and the brand deck opens with its logo.
- **With Brand kit** (`Deck maker with Brand kit`): Brand kit installed, its
  sample loaded (Fennel & Fig), Deck maker installed on top (`brand` UPDATE,
  identical; Brand kit's files and row untouched). `decks_make` with no
  set-up took Fennel & Fig (Fraunces, its logo, #b84a26) and its voice with
  the guide's voice section; the cards came out in it ("Butter, flour,
  patience.", "Baked this morning, gone by noon"). In the app, set-up offered
  the brand first, the deck showed its logo and faces, the Ask panel said it
  writes in Fennel & Fig's voice, and the export opened in Keynote (8 slides,
  the logo on the title and closing cards).
- The sample's load and clear: clear removed exactly its 20 rows and closed its
  Today item, leaving three other decks, their jobs and the corrections.
- Light, dark and 375px in rendered screenshots: no sideways scroll; the
  filmstrip becomes a row and the Ask panel sits under the cards on a phone.

## Not verified

- **PowerPoint itself**: no PowerPoint was at hand. The file is
  pptxgenjs's standard output, valid XML throughout, and Keynote opens it.
- **The deployed app signed in** (it answers 401 without a session); every
  look was the same build on a local dev server against the Lemma's API.
- **Full screen inside the Lemma's frame**: the frame's iframe has no
  `allow="fullscreen"` (`lemma-frontend/src/desktop/app-frame.tsx`), so the
  Full screen button opens present mode in a tab of its own instead. Not
  seen in the real frame.
- **A second member**: decks are the team's and jobs each person's own by the
  table definitions; not seen from a second account.
- Brand fonts in an export: the `.pptx` names the brand's faces; a machine
  without them substitutes (fonts are not embedded).

## Site pictures

`.lemma/shots/decks{,-editor,-present}-{light,dark}.webp`, 1440×900 at 2x: the
decks, the editor with two asks answered (card 8 marked as changed by the
last), and a figures card presenting. From the built app served on the Deck
maker Lemma's rows (`.lemma/shots/fixtures`; the person as "you", the Lemma
"Studio", no sample banner, no brand): `uv run --no-project python
bin/shot-fixtures.py`, then from the repository root:
`uv run --no-project python _kit/bin/shots_serve.py --app decks/apps/decks/source/dist --fixtures decks/.lemma/shots/fixtures --port 4630`
and `node _kit/bin/shoot.mjs http://127.0.0.1:4630 <out> decks=/ "decks-editor=/d/<id>#click=.dk-thumb >> nth=7" decks-present=/d/<id>/present/3`,
then `cwebp`.

## Things that bit

- **A LOOP has one outgoing edge.** Its body starts at `child_node_id` and the
  body's last node edges back to it; an edge from the loop to its own body
  fails the import ("loop 'each' has 2 outgoing edges; at most 1"), and only at
  apply, after the plan said CREATE.
- **An app's path takes no query string** (`normalizeAppPath` refuses `?`):
  `/d/<id>/ask/<job>`, not `?ask=`.
- **A slide is `container-type: inline-size`, so it has no width of its own**:
  inside an auto grid column it collapses; give the column `minmax(0, 1fr)`.
- **Google Fonts fails the whole stylesheet** for a weight a family lacks (DM
  Serif Display has only 400): ask only for the weights a look uses.
- **pptxgenjs leaves `Company` unescaped** (title and subject are escaped).
