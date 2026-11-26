# Roadmap

Features ranked by who asked, with the spec drafted from what they said.

Every feature the team keeps, with the people who asked for it: how many, at
which companies, how many call it a blocker, and the deals behind them. There
is no score: each of those is a column to sort by. The team puts features in
Now, Next or Later, follows the work in Tasks, and drafts a one-page spec
whose every line carries the quotes it came from. An outside page shows only
what the team marks public.

Roadmap carries Deal tracker (and with it People map, Mail and Meetings), so
the money behind each feature is there from the first install. It is meant to
carry User feedback too, which files what people say under features; User
feedback isn't built yet, so Roadmap carries the contract tables it reads
itself (`product`, `feature`, `feedback`, `ask`, plus `project` and `task`).
When User feedback exists, `plugin.json` becomes
`"carries": ["user-feedback", "deals"]`. Installed alone, Roadmap works on the
features and quotes a team adds by hand, and on its sample.

## What a team gets

1. **The ranked list** (`/`). Every feature with its stage, people,
   companies, blockers, open deals, won, last asked and horizon; All / Not
   planned / Now / Next / Later / Shipped with counts; a window (asked in the
   last 30, 90 or 365 days, or any time) and one company; search on `/`. The
   foot of the table says it out loud: no weighted score, money is deal value,
   two handles of one person count twice. Two banners from the Lemma count
   User feedback's work waiting on a person and open its app.
2. **Who asked**, beside the list: by company, blockers first, one quote
   each, where it was said, and the company's deal (opening Companies and
   Deals).
3. **A feature** (`/f/<id>`): its numbers; the spec (Redraft, Edit, a "No
   quote" mark on any line with nothing behind it; pointing at a line or
   pressing its mark lights the quote); horizon, owner, the Tasks project
   ("Make one in Tasks"), the public title and line, and how many people
   there are to tell when it ships; its quotes, all, blockers, or not in the
   spec, 20 at a time. `/q/<id>` is one quote and where it was said: where the
   spec Page's footnotes point.
4. **The board** (`/board`): Now / Next / Later, progress from each item's
   project, "No task moved in 16 days" on a stale Now item, the most asked
   features not on the roadmap, and what waits on the lead. No dragging: a
   horizon menu on each card, J/K to move, 1-3 for Now, Next, Later.
5. **Today.** The lead gets `decide` items from a check each morning at
   07:00 (their own TIME schedule, made by the app as them):
   - "No work on Faster search in 16 days: keep it in Now?"
   - "Custom fields on deals: every task done. Mark it shipped?"
   - "Recurring invoices: 9 quotes, not a feature yet" (opens User feedback)
6. **The outside page** (`roadmap-public`), off until Settings turns it on:
   Now / Next / Later / Shipped, only the items marked public, under their
   public titles. No names, no numbers, no sign-in, no voting.

## How it works

| Part | What it does |
| --- | --- |
| `roadmap_rank` | The ranked list, for chat: per active feature of the team's products, people (distinct `handle_kind:handle` across `feedback` filed under it and `ask` rows about it, either `work_source = feature` or the feature's own linked work), companies, blockers (companies with a `blocker` quote), open and won (sums of `deal.amount` for those companies, per currency, the main one first, never converted), last asked, quotes, stage, horizon. Sort by any one; window, company and horizon filters. Merged and archived features are left out; suggested ones are counted for the banner. The app ranks the same rows with the same rules in its own code (`src/rank.ts`), so sorting and moving answer at once |
| `roadmap_feature` | One feature for chat, by id or name: who asked by company, quotes 20 at a time, plan, spec, project progress |
| `roadmap_set` | Horizon, owner, public title and line, decline. Moves `feature.stage` forward only: next or later from idea → planned, now → building, decline → declined (not from beta or live). Never `live`, never back. Rewrites the outside page's table when it touches it |
| `roadmap_project` | A Tasks `project` for a feature (source `roadmap`, id fixed by the feature, so pressing twice makes one), linked on the item |
| `roadmap-spec` workflow (manual, about a feature) | `roadmap_spec_draft` brief (quotes up to ~60 KB: those an edited line cites, then blockers first and two per company, then newest; keyed q1, q2…) → agent `roadmap-spec-writer` (no tools, `output_schema`) → `roadmap_spec_draft` save: every cited key is checked against the brief, an unknown one dropped, a line left with none marked "No quote" (a "not doing" line needs none), lines a person edited kept word for word (and a writer's copy of one dropped), the Page written to `/pages/roadmap/<feature>.md` with footnotes linking `/roadmap/q/<feedback id>` |
| `roadmap_spec_save_edit` | The app's editor: changed lines are marked edited; a line whose quotes a person took off shows "No quote"; the Page is rewritten |
| `roadmap_ship` | Horizon `shipped`, `shipped_on` today. Leaves `feature.stage` to Release notes |
| `roadmap_publish` | Rewrites `roadmap_public` (Public) from the public items, plus what shipped in the last 90 days; empty while the page is off |
| `roadmap-daily` (TIME, the lead's) | `roadmap_tick`: the lead's three kinds of `decide` item; closes its own that no longer apply. A run as anyone but the lead writes nothing |
| `roadmap_setup_save` | Lead, currency (Deal tracker's, else USD), stale days (14), product name (makes the team's `product` only when there is none), outside page on/off; writes the memory block |
| `roadmap_sample_data` | A made-up product (Fernway), 14 features, 101 quotes and 93 asks from 14 made-up companies (roles, `.example` addresses), 11 deals, 4 Tasks projects; clear removes only those rows and what was made for them since (specs, Pages, outside-page lines, projects) and closes the sample's items in Today |

Tables: `roadmap_item` (per feature: horizon with every option from day one,
owner, project, public), `roadmap_spec` (lines with their quotes),
`roadmap_public` (Public; only lane, title, blurb, shipped_on, position),
`roadmap_settings`, `roadmap_sample_row`; and the shared ones above. Grants
are in `bin/grants.sh`.

Apps: `roadmap` (members) and `roadmap-public` (Public: reads `roadmap_public`
through the web widget key the host puts in `__LEMMA_CONFIG__.webWidgets`).
Settings' "Outside page" switch makes a `Roadmap` web widget answering
`known`, allowed on the page's origin, as Release notes does.

Opening other apps: a company → `companies` `/<id>`; a deal → `deals`
`/<id>` (Deal tracker's path; there is no `/d/`); a project → `tasks`
`/p/<id>`; User feedback → `FEEDBACK_APP = "feedback"` in `src/ui.ts` (and in
the functions' shared code), its slug until User feedback is built. Tasks is
not carried: without it, "open project" does nothing and progress still
shows.

## Measured (25 Nov 2026, on a hosted Lemma)

A fresh scratch Lemma ("Roadmap test", bound in the gitignored `.lemma.env`),
installed server-side with `_build/install.py roadmap`:

- install: COMPLETED, 296 parts, with Deal tracker, People map, Mail and Meetings, every
  part CREATE, no warnings; all seven apps READY;
- set-up: settings written, the team's product made, the memory block in
  `/memory/AGENTS.md` (178 characters with markers) and the guide;
- sample load: 14 features, 101 quotes, 93 asks, 4 projects, 10 s;
- `roadmap_rank`, every number hand-checked against the raw rows by a script
  that recomputes them with its own SQL: 14 of 14 features match (people,
  companies, blockers, quotes, open and won per currency). Bulk edit on
  records is 14 people, 5 companies, 3 blockers, $62k open, $18k won, as the
  sample was written to give; CSV export shows $33k + €12k open. A quote
  about a rival product is left out; an anonymous review counts as a quote,
  not a person. The app's own ranking (demo, same rows) shows the same
  numbers and the same order for people, open deals and won;
- sorts (open, won, blockers, last asked, stage), the 30-day window and the
  company filter;
- horizons on CSV export: next → stage planned, now → building, later and off
  the roadmap → stays building; decline → declined and off the outside page;
  declining a live feature is refused; ship keeps stage `beta`;
- `roadmap_project` made one project; pressed again, made none; two tasks
  added and one done → "1 of 2 tasks done";
- the spec workflow drafted Bulk edit's spec in about a minute: 18 lines from
  15 of 16 quotes, every cited key one the brief gave; the Page at
  `/pages/roadmap/bulk-edit-on-records.md` with footnotes. A save given two
  invented keys dropped both and marked the line left with none "No quote".
  An edited line and an added one were kept word for word on redraft (the
  first redraft also wrote the edited line again; save now drops such a
  copy, and the writer is told not to: the next redraft had none);
- `roadmap_tick` as the lead: "every task done" and the suggested feature
  written to Today; with stale days set to 0, both Now items with tasks were
  flagged; set back, those two closed by the source; after ship, the "mark
  shipped?" item closed; run as nobody's lead, nothing written;
- the outside page: turned on (web widget made with the app's calls), 7 rows
  in `roadmap_public`, read signed out with the widget key, and the hosted
  `roadmap-public` app drew them with no sign-in;
- the lead's TIME schedule made with the app's payload: accepted;
- sample clear: every table back to 0 rows but the team's own product, the
  Pages gone, the Today items closed by the source.

The app was checked as the "Try it" demo (built from fixtures read from that
Lemma by `bin/demo-fixtures.py`): light, dark and 375px of the list, board,
feature and outside page, no console errors, no sideways scroll; sorting by
open deals, the drawer, moving a card with its menu and with the `3` key,
pointing at a spec line and pressing a mark.

`uv run --no-project python _contract/lint.py`: ok, all plugins.
`_build/assemble.py --install roadmap`: ok, 445 files.

## Not verified

- The `roadmap` app inside a hosted Lemma's frame, signed in: its writes ran
  from the CLI and in the demo, its reads against the hosted Lemma's data as
  fixtures, but not the app itself there. So the app's own schedule and
  widget calls, `openApp` to Companies, Deals and Tasks, and the change stream
  were not seen.
- The `roadmap-daily` schedule firing at 07:00 (made, not waited for).
- A stale Now item from the sample in a Lemma: the platform stamps
  `updated_at` when a row is written, so a sample can't backdate its tasks;
  the 16-day flag shows in the demo, and the path was checked with stale days
  set to 0.
- Chat: the guide and `roadmap_rank`'s `text` were written for it; no chat
  turn was run.
- Two members, and a lead who isn't the person who set it up.
- More than a few hundred quotes: reads page 1,000 rows at a time (to 20,000).

## What it waits on

- **User feedback**: files the quotes, suggests features, settles the links
  to check. Until it exists the banners' buttons say it isn't in the Lemma.
- **Release notes**: telling the people who asked when a feature ships, and
  setting `feature.stage` to `live`. Roadmap shows "N people to tell" and
  tells nobody.
- **Triage**: telling a declined ask why. v1 sets `declined` and tells nobody.

## Out of v1

- Public voting (waits on platform #1239 and Forms).
- "Open as page" in the Lemma's page editor: an app can only open another
  app, not a file. The spec is still a Page in Files.
- Recurring revenue: money is deal value.
- A person with two handles counts twice.
- Linear, Jira or Productboard import.
- More than one product's roadmap: features of every product of the team's
  own are one list.

## Things that bit

- **`column` is a reserved word**: the platform refuses it as a column name,
  so the outside page's table says `lane`.
- **An app's path can't carry a query string** (the SDK refuses `?`), so the
  board is `/board`, not `/?view=board`.
- **A bulk delete is all or nothing**, and refuses an id that matches no row:
  clearing the sample deletes only the ids still there.
- **`updated_at` can't be set**, on create or update (see above).
- **The Decisions API can't write**, so the spec is written by an agent with
  no tools and checked by code, as Release notes' lines are.
- **A server-side install never updates a function the Lemma already has**:
  `bin/push <function>` puts this folder's code into the bound Lemma.

## Files

`bin/lemma` (the CLI bound to one Lemma), `bin/q` (one SQL read), `bin/run`
(one function run), `bin/push` (update functions in place), `bin/grants.sh`,
`bin/fnjson.py`, `bin/common.py` (the shared code in every function:
`--check`), `bin/demo-fixtures.py`. `.lemma/`: the memory block and guide,
the demo (`demo.json`, `demo.js`), `moments.json`, and the pictures.
