# Roadmap: design

## Thesis

> For a product team whose customers' words already reach the Lemma, Roadmap
> ranks every feature by the people who asked for it, never by a score: how
> many people, at how many companies, how many call it a blocker, and the
> deals behind them, each a column to sort by. The team says when (now, next,
> later), the work happens in Tasks, and the spec is drafted from what people
> said, every line carrying the quotes it came from.

- **Hero moment:** the ranked table with the drawer beside it. Pick "Bulk
  edit on records" and the drawer lists who asked by company, blockers first:
  "Northwind Freight · 3 people · Blocker · “We re-tag 300 shipments every
  Friday, one at a time.” · Mail · Nov 12 · Open $36k · Proposal".
- **First 30 seconds:** the count, the Lemma's two banners (quotes waiting for
  a person, a suggested feature), then the table: stage, people, companies,
  blockers, open deals, won, last asked, horizon. Sorted by people.
- **Information spine:** the shared `feature` list (User feedback keeps it),
  with `feedback` and `ask` hung on it and `deal` joined through the asker's
  company. Roadmap's own state is keyed by the feature's id: `roadmap_item`
  (horizon, owner, project, public), `roadmap_spec` (lines and their quotes).

## Direction: a dense product tool on the kit

The approved canvas (A ranked + drawer, B board, C feature and spec, the
phone list and the outside page) drawn on `../_kit`: Inter at 500 at most, the
host's `--c-*` roles only (no hex anywhere in `roadmap.css`), lucide icons,
the kit's pills, buttons, segmented controls, menus, sheets, search, empty
states and skeletons. Linear density: 13px rows, 12px meta, 15px heads, 21px
for a feature's title.

- **One accent per view.** A: Open feature (in the drawer). B: Add to
  roadmap. C: the next horizon step (Move to Now, Move to Next) or Mark
  shipped when every task is done. New feature and Draft the spec are plain.
- **The Lemma's own work** (the banners, "Waiting on you", the spec) carries
  the sparkles icon and the `ai` pill, never a colour of its own.
- **Pills always carry words**: Idea, Planned, Building, Beta, Live,
  Declined; Blocker, Important, Nice; No quote; Shipped.
- **No score, said out loud.** The table's foot says sorting is by one
  column, money is deal value (main currency first, others added, never
  converted), and two handles of one person count twice.
- **Quote marks** (q1, q3) are small outlined chips in `--c-info`; pointing
  at a spec line lights its quotes on the right with a 2px `--c-info` ring,
  and pressing a mark does the same without hover (rule 7).
- **The board has no drag.** Each card has a horizon menu; J/K move between
  cards, 1, 2, 3 send the card in focus to Now, Next, Later. Progress is a
  thin `--c-muted` bar; a stale Now item gets a `--c-warning` flag with
  words ("No task moved in 16 days").

## Screens

| Route | What it is | Matches |
| --- | --- | --- |
| `/` | the ranked table: Ranked / Board switch, All / Not planned / Now / Next / Later / Shipped with counts, the window ("Asked in the last 90 days"), one company, search on `/`, sort menu; banners; the who-asked drawer | A (`Main`) |
| `/` at 760px and under | the same rows as cards: name and stage, "14 people · 5 companies · 3 blockers", "$62k open · $18k won · Next"; a card opens the feature | A (`Phone`) |
| `/board` | Now / Next / Later columns of cards, "Most asked, not on the roadmap", "Waiting on you", what shipped in 90 days | B (`Board`) |
| `/f/<id>` | the record: facts, the spec (Redraft, Edit, No quote marks, the quote behind each line lit), properties (horizon, owner, project, public title and line, people to tell), quotes (All / Blockers / Not in spec, 20 at a time) | C (`Feature`) |
| `/q/<id>` | one quote: who, company, where, when, the feature, their deal | the spec's footnotes |
| `/setup` | first run, then Settings: product, lead, currency, stale days; the outside page's switch; the sample | |
| `roadmap-public` `/` | Now / Next / Later / Shipped, public titles and lines only | `Public` |

## Left out of the mockups on purpose

The canvas's dashed blue tags were notes, not UI; their facts are in the
README ("What it waits on", "Out of v1"). "Open as page" is not drawn: the
spec's Page path is said under it instead, until an app can open a file.
