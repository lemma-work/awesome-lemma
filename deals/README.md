# Deal tracker

Deals that move when the conversation does. The pipeline stays current from
what was actually said in each person's mail and meeting notes, and every
change waits for a person with the sentence it came from. It never edits a
deal on its own. One app, `deals`: a board by stage that drags (or a table), a
page per deal, what is waiting for you, and the weekly review (the catalog's
Pipeline review, merged in).

It carries **People map**, which carries **Mail** and **Meetings**: one
install puts all four into an empty Lemma. It sends nothing and connects
nothing of its own.

Tested in two Lemmas: the assembled bundle (Mail + Meetings + People map +
Deal tracker) installed server-side into an empty one, and a build Lemma
where it was made. The apps are `deals`, plus `inbox`, `meetings`, `people`
and `companies`; when a name is taken platform-wide the importer adds a
suffix.

## What it does

```
Mail's, Meetings' and People map's set-ups (theirs, unchanged)
  ─▶ deals-setup (per person; the Deals app is the screen for its forms)
       stages      Lead, Talking, Proposal, Negotiating, Won, Lost proposed, each with what reaching it means (first person only)
       currency    guessed from their time zone (first person only)
       existing    paste a spreadsheet (deals_sheet parses it; a live preview first), and/or
                   find them in the last 30 days: deals_read ─▶ (only on a yes) deals-extractor ─▶ deals_propose
       review      what it found, each with its sentence: keep, change first, or dismiss
       day         the weekly review's day and time (first person only)
       done        start listening for this person; needs_you; the Lemma's memory block
  ─▶ the board

listening (bundle schedules, each run as the person whose row it is):
  conversation.sorted_at changed (Mail read new words)  ─▶ deals-listen-conversation
  meeting.summarized_at changed (Meetings read notes)   ─▶ deals-listen-meeting
     deals_read: nobody from a company ─▶ stop, no call
                 Decisions 1: does this change a deal?  yes / no   (under 0.5: not sure, nothing proposed)
                 Decisions 2, only on a yes: what kind? new_deal, stage, amount, close_date, next_step, lost
     ─▶ deals-extractor (only on that yes): the value and the exact sentence
     ─▶ deals_propose: the sentence must be in the text word for word; a proposal, never a change
     ─▶ deals_needs_you

the person keeps or dismisses in the app ─▶ deals_save: the deal and its history (team-wide, no words);
     a dismissal or a change made before keeping ─▶ deals_correction, the next reads' examples
the team's day (TIME schedule the app makes) ─▶ deals-weekly-review: deals_review counts ─▶ deals-review-writer ─▶ saved
once a day per person (TIME, made by the app) ─▶ deals-refresh: deals_needs_you
```

**Listening on the conversation's sort, not on `message` inserts.** A new
`message` row lands before Mail has written it into the conversation's
document and before Mail has said whether the conversation is people or a
broadcast; and a sync inserts one row per message. Mail's sort writes
`conversation.sorted_at` once per new words, after both. Any source that
writes the shared conversation the same way is heard the same way. Nothing in
Mail or Meetings changed.

**Who is "at a company".** People map's company for the person
(`people_person.company_id`), or the shared `company_domain` for the domain;
for someone People map hasn't met yet, a domain that is neither free webmail
nor the person's own. People map's noise and colleagues, and people it put
at no company (friends, press: kind `other`), are never asked about.

**Decisions, two questions, the second only on a yes.** The evidence is the
newest words (marked NEW) with the earlier ones as context, or the meeting's
notes and Meetings' summary, plus the team's open deals with that company and
its deals closed in the last 90 days. The instruction names the team's stages
with their meanings, and what is not a deal (the team buying, hiring,
fundraising, support with nothing about what they buy changing). The
person's dismissals go with every call twice: as examples (`changes_deal:
no`), and as lines of the instruction ("the owner dismissed these as not
deal changes"); one example alone barely moved the provider. A change of kind
is an example for question 2. A change made before keeping goes to the
extractor as a correction to follow.

| Layer | Resources |
| --- | --- |
| Shared table it adds (in `_contract`) | `deal` (team-wide) |
| Shared tables, from its bases | `conversation`, `message`, `meeting`, `person`, `person_handle`, `company`, `company_domain`, `needs_you`; People map's `people_person`, `people_settings`, `people_link` (read) |
| Own tables | `deals_stage` `deals_settings` `deals_history` `deals_note` `deals_review` (team-wide); `deals_member` `deals_read` `deals_change` `deals_correction` `deals_sample_row` (per person) |
| Functions | `deals_setup_prepare` `deals_setup_apply` `deals_sheet` `deals_find` `deals_read` `deals_propose` `deals_save` `deals_review` `deals_setup_done` `deals_needs_you` `deals_memory` `deals_sample_data` (grants from `bin/grants.sh`) |
| Agents | `deals-extractor` (no tools: the change and its sentence), `deals-review-writer` (no tools: the summary from the counts) |
| Workflows | `deals-setup` (five forms) `deals-listen-conversation` `deals-listen-meeting` `deals-weekly-review` `deals-refresh` |
| Bundle schedules | `deals-heard-conversation` (DATASTORE `conversation`, UPDATE, `sorted_at` changed, `bulk_writes: each`), `deals-heard-meeting` (DATASTORE `meeting`, UPDATE, `summarized_at` changed, `bulk_writes: each`) |
| Schedules the app makes | `deals-weekly-review-<user>` (TIME, the team's day, as whoever picked it), `deals-refresh-<user>` (TIME, daily 06:40 their zone, per person) |
| App | `apps/deals` (Vite, `@lemma-plugins/kit`), design in `DESIGN.md` |
| Memory | `.lemma/agents-block.md` and `.lemma/guide.md`, written to `/memory/AGENTS.md` and `/memory/plugins/deals.md` by `deals_memory` at the end of set-up |

## The team

Deals are the team's (`deal` has no RLS); each has an owner. Message text
stays with whoever's mail or meeting it was: proposals and their sentences
(`deals_change`), reads and corrections are per person, so the proposals a
person sees come from conversations they can see. What reaches the team is
the change and who made it, from where and with whom (`deals_history`:
"kept from a conversation with Daniel Kowalski"), never the sentence or a
subject. On a deal's page, "Your conversations" and "Your meetings" are the
viewer's own; the team's last contact is People map's team view. A proposal
waits for the person whose conversation it was: usually the deal's owner,
since they are the one talking to the customer; a teammate's own mail about
someone else's deal proposes to that teammate.

## For Today: `needs_you`

`deals_needs_you` writes, for the signed-in person: **decide**, each of their
proposals (opens the deal, or `/waiting` for a new deal); **do**, a deal they
own whose next step is due (close date within three days, or passed); and
**drifting**, a deal they own whose people have gone quiet (cooling or cold
for everyone on the team, from `people_link`). Resolved items are closed by
the source; the sample's clear deletes its items.

## Tasks

With Tasks in the Lemma (the shared `task` table is there), a deal's page
shows its tasks and **Make next step a task**: a team `task` with `source:
deals`, `source_id` the deal's id, `due_on` the close date, for the person, for
the Lemma (`assignee_kind: agent`, `assignee_agent: pod_default`) or for
nobody yet. Tasks' own `tasks-team-added` hands an agent's task over. Without
Tasks the read of `task` fails and the card is hidden: Deal tracker does not
carry `task`.

## Install

`install/deals/` at the top of this repository is Deal tracker assembled with
People map, Mail and Meetings (without Google Meet), ready to install into an
empty Lemma: **Add to your Lemma** on its page at lemma.work imports it. From
the CLI, the same server-side import:

```bash
# from the repository root
uv run --no-project python _build/install.py deals --pod <pod-id> \
  --var inbox_slug=… --var meetings_slug=… --var people_slug=… --var companies_slug=… --var deals_slug=…
```

`bin/lemma` is the `lemma` CLI bound to one Lemma (`LEMMA_SERVER`,
`LEMMA_ORG_ID` and `LEMMA_POD_ID`, from the environment or a gitignored
`.lemma.env` in this folder); `bin/grants.sh` regenerates every function's
grants (never edit `functions/*/*.json` by hand). After the kit changes:
`../_kit/bin/vendor.sh deals`; after any change here or in a base, from the
repository root: `uv run --no-project python _build/assemble.py --install`
and `uv run --no-project python _contract/lint.py`.

## Verify

```bash
# from deals/, with bin/lemma bound to a Lemma that has the bundle installed
uv run --no-project python bench/bases_setup.py           # Mail's and Meetings' samples and set-ups
bin/lemma functions run people_sample_data --data '{"mode":"load"}'
uv run --no-project python bench/people_setup.py --finish # People map's set-up
uv run --no-project python bench/deals_setup.py           # Deal tracker's, up to "what it found" (or open the app)
uv run --no-project python bench/listen_test.py brightwave tidal ferro grace   # new mail, Mail's sort, the listener
bin/lemma functions run meetings_due --data '{"meeting_id":"<Velo rollout review>"}'  # Meetings reads the transcript
bin/lemma functions run deals_sample_data --data '{"mode":"load"}'
uv run --no-project python bench/clear_check.py           # clear removes only Deal tracker's sample rows
```

## Seen working (18 Nov 2026, on a hosted Lemma, samples)

In the fresh, installed Lemma unless it says the build Lemma.

- **Install**: the assembled bundle (Mail + Meetings + People map + Deal
  tracker, without `googlemeet`) into the empty Lemma with
  `_build/install.py`: 242 steps, every part CREATE, COMPLETED in 6 min 23 s,
  five apps built in the importer's sandbox. Then Mail's and Meetings' sample
  set-ups (`bench/bases_setup.py`, 4 min 43 s) and People map's (30 people at
  19 companies, 3 gone quiet).
- **Onboarding, from the app** (Vite dev server signed in with the CLI's
  session): before People map was set up it showed People map with a button
  to it; once it was, it started `deals-setup` by itself. Stages (Talking's
  meaning edited), currency (INR guessed from Asia/Kolkata, EUR picked),
  existing deals both ways at once: three rows pasted (a live preview read
  "Qualified" as not a stage and put it in Lead, "1.200" as 1,200, "Closed
  lost" as Lost) and the last 30 days found: 21 conversations with a company
  read in three passes, 23 Decisions calls, 18.6 s of call time, 2 yeses,
  both proposed: Brightwave Health's renewal (Proposal, "We'd like to renew
  and go from 32 to 40 seats.") and Orchard Dental's signed contract (Won,
  82%), kept, the second renamed first (a correction). Review day Monday
  08:00: the app made the team's weekly schedule and the person's daily
  `deals-refresh`; `deals_memory` wrote the block into `/memory/AGENTS.md`
  and the guide.
- **Listening on new mail** (`bench/listen_test.py`, Mail's own sort writing
  `sorted_at`): Brightwave's "finance signed off" became four proposals
  (stage → Negotiating, amount EUR 11,520, close date 28 Nov, next step),
  Tidal Foods' "quote us for 5 more seats" a new deal, Ferro Logistics' "we've
  decided to go with another vendor" a loss on the pasted deal, Orchard's
  "two more seats" a new deal, and Grace Tan's quote to the team (the team
  buying) no, 0.85. 17 to 54 s from the sort to the proposal (the extractor
  is most of it). Investors (Northgate, Quill), support (Ferro's bug, Velo's
  export fix) and the accountant all read as no.
- **Listening on meeting notes**: Meetings read the Velo Cycles rollout
  review's transcript (`meetings_due`), wrote `summarized_at`, and
  `deals-listen-meeting` proposed "Annual plan from January" (Negotiating,
  closes 30 Nov) with "So we agree the annual plan starts in January, at the
  current price per seat." (In the build Lemma the second question named
  stage, date and next step with no open Velo deal, and the extractor's new
  deal was dropped; a change with no open deal now counts as a new deal.)
- **Keep, change first, dismiss** from the app: all kept changes reached the
  team's deal with one history row each ("kept from a conversation with
  Daniel Kowalski"); a keep leaves the list at once (the function run takes
  4 to 11 s).
- **A dismissal teaching it**: Tidal's "5 more seats" dismissed as "it isn't
  about a deal" (a team that doesn't track small add-ons). Read again: the
  same conversation went from yes 1.00 to no 0.55; Orchard's similar "two
  more seats" from 0.99 to 0.94, still yes. As an example alone the
  dismissal moved nothing (0.99 → 0.99, 1.00 → 1.00, build Lemma): said as a
  line of the question, it does.
- **Decisions on the sample**: 29 reads, 37 calls, 30.1 s of call time (0.81 s
  a call), 8 yeses, 10 proposals: 7 kept, 1 dismissed, 2 left waiting. Oskar
  Lind's fee note (the team buying) was a yes at 0.88 in the build Lemma; the
  extractor found no deal change in it and nothing reached the person.
- **The board dragging** (build Lemma): Pilot for two depots dragged from Lead
  to Proposal with real mouse events; the deal moved at once and its history
  says "Moved Lead → Proposal". (Pointer events, not HTML5 drag and drop:
  works with a mouse or a pen and on a tablet; under 720px a deal moves from
  its page.)
- **The weekly review**: "Write it now" counted 6 moved, 1 quiet (Lumen Labs,
  Ana Ruiz cold for 48 days), 4 open worth EUR 66k, and the writer's summary
  used only those figures; 15 s.
- **needs_you**: 2 to decide, 1 to do (Harborview's next step, closing Fri 20
  Nov), 1 drifting (Lumen Labs); kept proposals resolved as done by the
  source.
- **Tasks** (build Lemma, with the shared `task` and `project` tables added
  from the contract; Tasks itself not installed): "Make next step a task"
  wrote task #1 with `source: deals`, the deal's id, due 20 Nov, assignee the
  Lemma (`pod_default`). Tasks' own hand-over was not run.
- **Clear** (`bench/clear_check.py`): 105 of Deal tracker's rows removed (the
  sample's deals with their history and notes, the deals kept from sample
  conversations, every read, proposal and correction from the sample, its
  needs_you items); the pasted deals, stages, settings and review stayed, and
  no row of Mail, Meetings or People map changed. The sample was then loaded
  again.
- **Light, dark and 375px** from rendered screenshots: no sideways page scroll
  on the board, a deal, the review, waiting, settings or the table.

Not verified: the hosted app signed in or framed inside Lemma's web app
(it answers 401 to the unsigned; checked through the dev server with the
CLI's session); two real members in one Lemma (team-wide rows and RLS reads
are by design, not tested with a second person); the Monday and daily
schedules firing on their own (run with "Write it now" and by hand); Tasks
handing a task to the Lemma; a real mailbox or calendar (never connected).

## Site pictures

`.lemma/shots/{board,deal,review}-{light,dark}.webp`, 1440×900 at 2x, from
the built app served on this Lemma's sample rows:
`bin/shot-fixtures.py "<deal name>"`, then from the repository root:
`_kit/bin/shots_serve.py --app deals/apps/deals/source/dist --fixtures deals/.lemma/shots/fixtures --port 4631`,
`node _kit/bin/shoot.mjs http://localhost:4631 <out> board=/ deal=/<deal id> review=/review`, then `cwebp -q 86`.
The pictures are of "Annual renewal, 32 to 40 seats" (Brightwave Health), from
the fixtures written on 18 Nov; the account's name, address and id are
replaced by the shot server's Sam Rivera.
