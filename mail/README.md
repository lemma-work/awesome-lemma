# Mail

Your mail sorted the way you'd sort it, with the reply drafted; and read once
for everything else in the Lemma. Gmail or Outlook. One app, the Inbox. Mail
never sends on its own: a person presses Send.

Mail is the bottom of the people-and-sales stack. Meetings, People map,
Follow-ups and Deal tracker read what Mail read, from the shared tables in
`../_contract` (source-neutral: a Chat plugin writes the same rows).

Tested by installing this folder alone into an empty Lemma; the app, `inbox`,
is for the Lemma's members (they sign in).

## What it does

```
connect (Gmail, Outlook, or the sample) ─▶ first read, ~30 days ─▶ propose categories, voice, rules, VIPs
   ─▶ person edits them ─▶ which categories draft ─▶ sort everything ─▶ inbox opens on what it found

push / catch-up ─▶ mail_sync ─▶ mail_sort: one Decisions call per conversation
                                   ├─ category, state, priority      → conversation (shared)
                                   ├─ not sure (low confidence)      → mail_thread.unsure → "Not sure"
                                   ├─ reply owed in a drafting cat.  → draft_state wanted ─▶ mail-write-draft ─▶ mail-writer
                                   └─ a promise either way           → promise_state wanted ─▶ mail-find-promises ─▶ mail-promises
person moves a conversation ─▶ mail_correction (the last 20 are every read's examples)
hourly mail-sweep: snoozes back, follow-ups come back with a nudge, scheduled sends a person approved
nightly mail-nightly: people
```

Agents only write text (the voice and proposals at set-up, a promise's line
and date, a draft). Every judgement is a Decisions call; functions do every
write. Agents have no tools and no grants.

| Layer | Resources |
| --- | --- |
| Shared tables (carried from `_contract`, byte for byte) | `conversation` `message` `person` `person_handle` `promise` `draft` |
| Mail's own tables | `mail_mailbox` `mail_thread` (one per conversation, same id) `mail_category` `mail_rule` `mail_correction` `mail_sync_state` `mail_settings` `mail_activity` `mail_sample_row` (what the sample made) |
| Carried, read only | `meeting` (Meetings'), so the sample's clear can see who is on a meeting; `brand` and the `/brand` folder (Brand kit's), for the team's brand voice |
| Functions | `mail_sync` `mail_sort` `mail_thread_action` `mail_writing_context` `mail_save_draft` `mail_send_draft` `mail_promise_context` `mail_save_promises` `mail_people` `mail_sweep` `mail_resort` `mail_settings_ensure` `mail_connect` `mail_setup_report` `mail_setup_proposals` `mail_setup_apply` `mail_setup_drafts` `mail_setup_done` `mail_sample_data` `mail_search` |
| Memory | `mail_memory`, the last step of `mail-setup`: Mail's block in `/memory/AGENTS.md`, its guide `/memory/plugins/mail.md`, and the person's own block in `/me/AGENTS.md` pointing at their voice (written as them, no grant). Text in `.lemma/agents-block.md`, `guide.md`, `agents-block-me.md`; `_contract/README.md`, Memory block |
| Agents | `mail-setup` `mail-writer` `mail-promises` |
| Workflows | `mail-setup` (three FORM steps) `mail-sort` `mail-catch-up` `mail-on-{gmail,outlook}-{received,sent}` `mail-write-draft` `mail-find-promises` `mail-sweep` `mail-nightly` |
| Bundle schedules | `mail-draft-wanted`, `mail-promise-wanted` (datastore on `mail_thread`, `bulk_writes: each`) |
| Per-person schedules | made from the app (Settings, Mailboxes, "Running for you") as the person: push per mailbox, catch-up every 15 min, hourly sweep, nightly |
| Connectors | `gmail`, `outlook` (per member, optional). No calendar: that is Meetings. |
| Folder | `/mail-sample` (the sample's fixture and documents; real documents are each person's own `/me/mail/conversations`) |
| App | `apps/inbox` (Vite, `@lemma-plugins/kit`), design in `DESIGN.md` |

## Search

`mail_search` is for the Lemma's own assistant (people talk to it, not to a
Mail agent). Plain words, optionally `from_handle` and `after`/`before`
(YYYY-MM-DD), `where` all, synced or provider. It searches what Mail read (the
conversation documents, then subject, sender and preview) and, through
Gmail's search (`GMAIL_FETCH_EMAILS` with `from:`/`after:`/`before:`) or
Outlook's (`OUTLOOK_SEARCH_MESSAGES`, KQL), mail of any age outside the first
read. Each hit says where it was found, whether Mail holds that conversation
(`conversation_id`) and a link to open it in Gmail or Outlook. Reads only.

## Brand voice

A person's own replies stay in their own voice. Mail they send on the team's
behalf can take the team's brand voice: `mail_category.brand_voice`, "Write in
the team's brand voice", off by default, one switch per category (Settings,
"Team voice"). Set-up suggests it on the drafts step for categories whose key
or name says customer, client, support, help, sales, partner, order or booking
(`mail_setup_apply.brand_default`, with the brand's name).

When the switch is on and the Lemma has Brand kit's `brand` table,
`mail_writing_context` adds `brand` (`name`, `voice`, and the guide at
`guide_path`, cut to 5,000 characters) from the default brand in state `check`
or `ready`. `mail-writer` lets the brand win on tone and wording, keeps the
person's greeting and sign-off, and writes "brand voice" in `built_from`.
Without Brand kit, or with the switch off, `brand` is null and nothing changes.

## Install

`install/mail/` at the top of this repository is this folder assembled and
ready: **Add to your Lemma** on Mail's page at lemma.work imports it. From the
CLI, the same server-side import:

```bash
# from the repository root
uv run --no-project python _build/install.py mail --pod <pod-id> --var inbox_slug=<free slug>
```

Pass `--var inbox_slug=...`: the app's default name, `inbox`, is taken
platform-wide, so without a free one the app lands on `inbox-<pod-id>`.

The server-side import (upload a zip to `POST /pods/{id}/bundle/uploads`,
`POST …/bundle/imports` with `kind: URL`, then `…/apply` with `variables`)
builds the app in the importer's sandbox with pnpm. It needs
`apps/inbox/source/pnpm-workspace.yaml` (from the kit): pnpm refuses esbuild's
install script without it, and the import fails with only "App build failed."

To work on Mail itself, import this folder with the CLI instead (it builds the
app on your machine, so give the build its config):

```bash
export VITE_LEMMA_API_URL=https://api.lemma.work VITE_LEMMA_AUTH_URL=https://lemma.work/auth \
       VITE_LEMMA_POD_ID=<pod-id> VITE_LEMMA_APP_BASE_PATH=/   # or your own server's addresses
bin/lemma pods import . --var inbox_slug=<free slug>
```

`bin/lemma` is the `lemma` CLI bound to one Lemma: it reads `LEMMA_SERVER`,
`LEMMA_ORG_ID` and `LEMMA_POD_ID` from the environment or from a gitignored
`.lemma.env` in this folder. `bin/grants.sh` regenerates every function's
grants (never edit `functions/*/*.json` by hand); `bin/fnjson.py` is what it
calls. After changing `../_kit`, run `../_kit/bin/pack.sh` and
`../_kit/bin/vendor.sh mail`; after any change here,
`uv run --no-project python _build/assemble.py --install` (People map, Deal
tracker and Lead research carry Mail too) and
`uv run --no-project python _contract/lint.py`, from the repository root.

## Each person

They open the Inbox. With no settings yet it makes them (and the five starting
categories) and shows set-up, which starts their own `mail-setup` run:

1. **Connect.** Gmail or Outlook: pick an account already connected in the
   organisation or connect one (the connector's own sign-in, back to the app).
   Or "Look around with a sample mailbox".
2. **Read.** About the last 30 days (`mail_settings.backfill_days`), up to
   eight 90-second passes; anything left is finished by the catch-up.
3. **Categories.** People, VIP, Updates, Newsletters, Cold, plus up to four it
   found, each one editable sentence: keep, rename, drop, add. The voice, up to
   three rules and up to five VIPs beside them.
4. **Drafts.** Which categories get replies drafted without asking.
5. **Sort.** Every conversation read once; the inbox opens on what it found.

A run waits on its forms indefinitely; the run id is on the person's
`mail_settings`, so a reload lands where they were. Anyone who joins later
gets the same steps on their first open. Turning on the per-person schedules
is in Settings, Mailboxes, for a real mailbox.

## The sort

`mail_sort` asks the Decisions API (`pod.decisions.make`) one call per
conversation, all five questions together: category (the person's categories,
their sentences as descriptions), state (needs reply, waiting, FYI, done),
priority 0 to 3, did you promise something, did they. A broadcast is asked the
first three. The questions are the shared contract's
(`_contract/questions/conversation-read.json`, embedded verbatim and linted),
worded for any source, so Chat asks a Slack thread the same thing.

- **Examples**: the person's last 20 corrections (`mail_correction`: they
  moved a conversation, or said what it needs), each with the evidence the read
  saw, capped to fit the 32 KiB examples limit.
- **Not sure**: the Decisions provider it was tested with, Typesafe System
  One, always answers and reports a probability. Category or state under 0.5 (the
  contract's `unsure_below`), or a set-aside category that also "needs a reply"
  under 0.8, goes to Not sure. Moving it out is a correction.
- **Why a function, not DECISION nodes**: a DECISION node asks one question and
  routes, so five questions would be five calls and five steps per
  conversation. One call answers all five; six run at once.
- **Pacing**: at most `rate_per_minute` call starts per pass (150), spaced
  evenly; a 429 holds every worker for its `Retry-After` and releases what was
  not read for the next pass. The organisation's limit is per minute and
  shared by everyone (600 per priority by default; a server's own setting is
  not visible from a Lemma). The first read's sort runs in passes of 40.
- **Promises** are read once per new words: `mail_sync` resets
  `promise_state` when a message arrives, and the reader never repeats an open
  promise.

## Measured on the sample (18 Nov 2026)

36 conversations, the same nine categories and rules for both. "Before" is the
Inbox Lemma's own `triage` agent, unchanged, run in a scratch Lemma the way the
Inbox ran it (8 conversations a batch, bulk 40 a batch, 4 batches at once):
`bench/old_triage.py`. "After" is `mail_sort` inside set-up:
`bench/run_setup.py`, compared by `bench/compare.py`.

| | Before (triage agent) | After (Decisions) |
| --- | --- | --- |
| Calls to sort 36 | 5 agent runs | 36 Decisions calls (1 per conversation) |
| Model time | 92 s of agent time (2.6 s a conversation) | 22 s of call time (0.62 s a call) |
| Wall time | 28 s (4 batches at once) | 22 s (6 at once, paced at 150/min, no 429) |
| Text-writing agent runs | 12 drafts (promises came inside triage) | 11 drafts + 10 promise reads |
| Agent runs per conversation | 0.47 | 0.58 (plus 1 Decisions call) |

Agreement with the old triage: category 34/36 (94%); state 28/36 (78%);
priority 22/36 exact, 36/36 within one; "a promise was made" 32/36 (89%);
drafted or not 35/36 (97%). Half the state disagreements (4 of 8) were the
ones the new read put under Not sure (confidence 0.44 to 0.48: waiting versus
FYI after someone else promised something). Two corrections, re-read: the
podcast invitation went from Cold at 0.50 to People at 0.93, and the Lumen
intro from Not sure to Hiring at 0.93.

## Verify

```bash
bin/lemma functions run mail_sample_data --data '{"mode":"load"}'
uv run --no-project python bench/run_setup.py           # the whole set-up, as the app drives it (~3 min)
bin/lemma query run "SELECT c.category, c.state, t.unsure, t.draft_state, t.promise_state FROM conversation c JOIN mail_thread t ON t.id = c.id"
bin/lemma functions run mail_thread_action --data '{"conversation_ids":["<id>"],"action":"move","category":"people"}'
bin/lemma functions run mail_sort --data '{"conversation_ids":["<id>"],"detail":true}'
bin/lemma functions run mail_thread_action --data '{"conversation_ids":["<id>"],"action":"draft","hint":"say yes"}'
bin/lemma functions run mail_sample_data --data '{"mode":"clear"}'
```

Seen on 18 Nov 2026, on a hosted Lemma, with the sample: set-up from the app (read,
proposals, categories renamed, dropped and added in the form, drafting chosen,
sort, the inbox opening on what it found); 9 to 11 drafts written in the
learned voice ("Cheers" sign-off), one asked for with a hint; promises with
their sentence and date; Not sure, and moving out of it from the app;
re-sort after a category change; snooze and the sweep bringing it back; clear
leaving 0 rows in every table and an empty `/mail-sample`. Light, dark (device
and host message, through a local frame) and 375px looked at in rendered
screenshots.

Not verified: a real Gmail or Outlook mailbox (never connected, by design),
push and catch-up schedules firing, a real send, the deployed app signed in
or framed inside Lemma's own web app (it needs a person's sign-in),
several people at once, a 30-day mailbox at real volume against the
organisation's Decisions rate.

## Site pictures

`.lemma/shots/inbox{,-reader}-{light,dark}.webp`, 1440×900 at 2x. Made from
the built app served on the sample's rows (`.lemma/shots/fixtures`, the
account's address replaced): `bin/shot-fixtures.py`, then from the repository root:
`_kit/bin/shots_serve.py --app mail/apps/inbox/source/dist --fixtures mail/.lemma/shots/fixtures --port 4611`
and `node _kit/bin/shoot.mjs http://localhost:4611 <out> inbox=needs "inbox-reader=needs#click=.m-row__open"`,
then `cwebp`.

The page's moments (the hero loop, the set-up steps, the close-ups) come
from the Try it demo: `node _kit/bin/moments.mjs mail`, from
`.lemma/moments.json`, into `.lemma/moments/`. The categories step is the
real set-up form on the proposals the set-up made from the sample
(`.lemma/moments.setup-run.json`, taken from a `bench/run_setup.py` run).

## Things that bit

- **Typesafe never answers null.** The docs say a decision's value is null
  when the evidence does not support one; System One always picks and gives a
  probability, so "not sure" is a threshold here.
- **A bulk write skips a datastore trigger** unless the schedule sets
  `bulk_writes: each` (both bundle schedules do).
- **Row deletes are their own grant** (`table:rwd`); only `mail_sample_data`
  holds them. **`/me` folder grants are refused**, so the sample's documents
  live in the bundle folder `/mail-sample`.
- **Server-side app builds use pnpm**, which needs `pnpm-workspace.yaml` to let
  esbuild run its install script; the failure says only "App build failed."
- **The CLI import ignores a slug variable's default.** Pass `--var`.
- **The sample's clear removes only what the sample made.** Load makes the
  sample's people (with the ids Mail's people refresh and Meetings would give
  them) unless they exist, and marks every row it made in `mail_sample_row`.
  Clear removes a person only when all their handles are marked and nothing
  else names them: no meeting, and no promise, conversation, message or draft
  left from anything but the sample. Whoever stays keeps their handles, with
  Mail's counts reset. Checked in a Lemma with Mail then Meetings, both samples
  loaded: Meetings' 24 meetings and all 23 attendees' people survived Mail's
  clear; then Meetings' clear left 0. Alone, Mail's clear leaves 0 rows. A
  plugin's own table keyed by a person id is invisible to Mail (no grant), so
  it should also hold a handle, or a row in a shared table, to keep its people.
- **Clear can't reach platform history**: the set-up runs and the agents'
  conversations stay in the Lemma's run history.
- **Re-reading a conversation re-asked for its promises** and the reader
  worded them differently, so they doubled; fixed by reading promises once per
  new words.

## Needs you (for Today)

Mail writes its part of the person's day to the shared `needs_you` list
(`../_contract/README.md`): replies owed (`answer`, with the drafted reply),
promises the person made (`do`) and promises owed to them (`waiting`, with the
drafted nudge), from `mail_needs_you`, run as the person by three schedules,
each with its own workflow (the server allows one schedule per workflow,
person and Lemma): `mail-needs-you-conversation` → `mail-needs-you-on-conversation`
(a mail conversation's state changes), `mail-needs-you-promise` →
`-on-promise` and `mail-needs-you-draft` → `-on-draft` (bulk writes each), and
by the hourly sweep for everything. It watches its own items too: Done on a
promise item elsewhere closes the promise (`mail-needs-you-done` →
`-on-done`); `request = nudge` drafts the follow-up through
`mail_thread_action` (`mail-needs-you-nudge` → `-on-nudge`).

"Worth a nudge yet?" lives here as `mail_nudge_check` (moved from Today), run
before each needs_you write: one Decisions call per conversation where a
promise owed to the person is late, with their meetings with that person as
evidence (the shared `meeting` table); a yes asks the writer for the
follow-up, anything else holds it, and the person's `waiting` item says which
("Nudge drafted in your voice", or "No nudge yet: it looks done another way,
84% sure"). Answers in `mail_nudge` (one row per conversation).

"Was this promise kept?" lives here as `mail_promise_kept` (moved from Today):
when a mail conversation gets a new message, one Decisions call per
conversation, one question per open promise. A yes at 0.8 or more closes the
promise; a weaker yes or unsure becomes a `decide` item ("Done? …") for the
person. The sample clear closes Mail's items.
