# User interviews

The right users found and booked, and each call turned into findings.

A study starts from a question ("Why do admins rebuild our reports in a
spreadsheet?"), how many calls the team wants and the features it is about.
Who fits is said in a sentence, which the Lemma reads into filters a person
can check, over the people the team already knows. Each person gets an invite
in the member's voice, sent only when they press Send; a booking from that
address joins the study; after the call the Lemma proposes findings from the
transcript or the member's notes, each a quote checked word for word, which
the member keeps or sets aside. Kept findings are the team's `feedback`, filed
under their feature, and counted across calls in people.

User interviews carries People map and Booking page (and with them Mail and
Meetings). It is meant to carry User feedback too, whose `feedback` and
`feature` its findings are filed in; until that plugin is in `carries`, it
carries the contract tables it uses itself (`product`, `feature`, `feedback`,
`ask`, `deal`), the way Roadmap does. When it is, `plugin.json` becomes
`"carries": ["user-feedback", "people", "booking"]`.

## What a team gets

1. **Studies** (`/`): one line each, calls booked and done of those wanted,
   findings kept, where it stands; New study.
2. **A new study** (`/new`, and `/s/<id>/edit`): the question, calls wanted,
   the features it is about, who fits in a sentence, and the line every invite
   carries. Saving starts the read of who fits.
3. **A study** (`/s/<id>`, the home): its counts; All / To invite / Invited /
   Booked / Done / Resting with counts; everyone who fits with why (Deal won,
   Said 3 things, Your contact, Pasted list, Plan: Team), their best quote,
   where they stand and the one thing to do (Draft invite, Review, Open, Why);
   "Findings so far" by feature; and beside it who fits as the Lemma read it
   ("Read as", with anything no table holds struck through, "no data for
   this"), Paste a list, the contact rules, and how invites, booking, the call
   and thanks work. The primary action is **Draft N invites** (up to five, as
   many as the study still needs), then **Review N invites**: a drawer with
   each invite, editable, Send / Write again / Leave out.
4. **A call** (`/s/<id>/p/<person>`): the person and the call; the transcript
   or notes, with the proposed findings numbered in it; the proposals, each
   with its quote, minute, point, feature (or a new one, suggested), kind and
   how much it mattered, Keep / Set aside, J K A X, "Keep the N left" and the
   next call waiting. Before the call: Join, "press Transcribe in Meet", why
   they fit, what they said before. After it with nothing to read: "Did they
   show up?" (They came / They didn't), Your notes, Paste a transcript. Mark
   no-show, Thanked.
5. **Findings** (`/s/<id>/findings`, a tab of the study): features by people
   (a number is that person's findings, a filled square a blocker), "N of M
   people" with a bar, Roadmap's stage, a suggested feature to Accept or Merge,
   "Since the last call", By person or By company, and the chosen feature's
   quotes, each opening its call at its minute; your own proposals still to
   review under that feature, with Keep; who said it by won or open deal; Open
   in Roadmap.
6. **Set-up** (`/setup`): the product findings file under and the contact
   rules (the team's); then each person's part, each a button: Set up Mail
   (their mailbox), After a call (Meet transcript or My notes, written to
   Meetings' own setting), Turn on your booking page (Booking's set-up), and
   their own checks, made on Save. Or Look around with a sample.
7. **Today**: "3 findings from the call with Kettle & Co to review"
   (`decide`), "Did Mei show up for your call?" (`decide`, two hours after a
   booked call with nothing to read), "3 invites to send" (`do`). Each closes
   by itself when its reason goes.

## How it works

| Part | What it does |
| --- | --- |
| `interviews_fit` + `interviews-fit-reader` (workflow `interviews-fit`) | brief: the sentence, and the fields and values this Lemma holds (feature ids and names, the team's deal stages, companies, pasted columns). The agent (no tools, an output schema) returns filters and unknowns; save keeps only real fields and values, writes `fit_read`, and builds the pool |
| `interviews_pool` | Everyone the team knows, by handle, from `feedback`, `ask`, `deal.people`, the member's own `person`/`person_handle`/`people_person` (customer or partner) and `interviews_pasted`; the filters (all must hold; a title nobody has recorded passes, marked "Title not known"); ranked by said something about the study's features, then a won or open deal, then recency; why chips and the best quote. Never reads mail or meeting text |
| Contact rules (`rest_for`, in every function) | Over every study's rows for a handle: never after an opt-out (no override); `no_show_days` after a no-show; `invite_gap_days` after an invite from another study. A person's override is kept (`override_by`, `override_at`). Worked out again after a send, a no-show, an opt-out and each pool |
| `interviews_invite` + `interviews-inviter` (workflow `interviews-invite`) | As the member who will send it. brief refuses a resting or opted-out person, no mailbox, no booking page; else the study, the person, why, their quote, the member's voice from Mail, the booking link and length. save: a Mail `draft` (kind new, proposed, no conversation; `built_from` {plugin, study_id, person_id}; id from the person, so writing again replaces it) |
| `interviews_send` | The Send button, one draft: saves the edits, sets `approved`, runs Mail's `mail_send_draft` as the member. Sent: invited, rules start elsewhere, the study runs. Not sent: stays drafted, Mail's reason said plainly. A sample mailbox's draft is only marked sent |
| `interviews_on_meeting` (workflow `interviews-on-meeting`) | Each member's two triggers on their own `meeting` (INSERT; UPDATE when `document_path` changes; rows OWNER_READABLE), made by the app: an attendee handle invited in a running study, the call after the invite, books them; a booked call's document starts the read; a cancelled one goes back to invited |
| `interviews_read` + `interviews-reader` (workflow `interviews-read`) | As the member (the document is in their files). save keeps a proposal only when its quote is in the document word for word (spacing, case and quote marks aside), takes `at_seconds` from the nearest `[m:ss]` at or above it, drops lines spoken by the member, keeps what they already kept or set aside, numbers them in the order said |
| `interviews_keep` | One proposal: kept is a `feedback` row by the contract's id (`FEEDBACK_NS`, `<source>:<source_id>|<quote key>`), `source` interview or note, `source_id` the call's `meeting.source_id` (no meeting: `interviews:<person id>`), `at_seconds`, `heard_by` the member, `plugin` user-interviews, `state` processed, `filed_by` person when they changed the feature; a new feature's name becomes a suggested `feature` (origin lemma); `interviews_finding` (same id). Undo sets the `feedback` row aside |
| `interviews_paste` | A transcript (Name: words, `[m:ss]`, or Zoom/Teams VTT) or typed notes for a call with no document, kept at `/me/interviews/<person>.md`, then read. A call that is a meeting of the member's takes typed notes through Meetings' own `meetings_add_notes` instead |
| `interviews_mark` | no_show, showed, declined, opted_out, thanked / unthanked (a tick; nobody is paid), override, skip, restore |
| `interviews_findings` | The Findings grid for chat: per feature the distinct people with kept findings, findings, blockers, stage, a person-by-feature grid, "since the last call", one feature's quotes; a ready text answer. The app works the same numbers out from its rows (`src/grid.ts`) so the grid moves the moment a finding is kept |
| `interviews_daily` (workflow `interviews-daily`) | Each member's TIME schedule, 09:00 in their zone (made by the app), and the app's refresh on open: bookings and documents a trigger missed (their meetings of the last 30 and next 60 days), a nudge after `nudge_days` working days with no booking (Mail's own drafting handshake in that invite's thread, `draft_kind` follow_up, once Mail has synced the sent message), and their `needs_you` |
| `interviews_setup` | check: the product, contact rules, Mail, Meetings' `notes_from`, the booking page, what is missing. save: picks or makes the team's product, the rules, the memory block |
| `interviews_memory` | The block in `/memory/AGENTS.md` and the guide at `/memory/plugins/user-interviews.md` |
| `interviews_sample_data` | load / clear the sample (below) |

Tables: `interviews_study`, `interviews_person` (one person in one study, id
from the study and handle), `interviews_pasted`, `interviews_proposal` (RLS:
the interviewer's own until kept), `interviews_finding` (a kept finding's
study, id the `feedback` id), `interviews_settings`, `interviews_member` (RLS),
`interviews_sample_row`. Grants: `bin/grants.sh`; shared helpers:
`bin/common.py` (copies them and the contract snippets into each function).

## Set-up and development

```bash
# from the repository root
uv run --no-project python _build/assemble.py --install user-interviews
uv run --no-project python _build/install.py user-interviews --lemma <id> \
  --var inbox_slug=… --var meetings_slug=… --var people_slug=… \
  --var companies_slug=… --var booking_slug=… --var interviews_slug=…
uv run --no-project python _contract/lint.py
```

From this folder: `bin/lemma` (bound by a gitignored `.lemma.env`), `bin/run
<function> '<json>'`, `bin/q '<sql>'`, `bin/start <workflow> <table> <id>`
(a run about a record, as the app starts one), `bin/push <function>…` (code
and grants into a Lemma that has them; an install never updates them),
`bin/grants.sh`, `bin/common.py [--check]`, `bin/demo-fixtures.py` (the demo's
sample, from a Lemma holding it).

A dev server against a Lemma, signed in with the CLI's session, from
`apps/interviews/source`:

```bash
LEMMA_DEV_PROXY_TARGET=<api url> VITE_LEMMA_BASE_URL=http://127.0.0.1:5461/api \
VITE_LEMMA_POD_ID=<pod-id> VITE_LEMMA_DEV_TOKEN_CMD="$PWD/../../../bin/lemma auth print-token" \
npx vite --host 127.0.0.1 --port 5461 --strictPort
```

**The sample**: a reporting product (Fernway), its six features, a running
study with 15 people at `.example` companies in every stage (four calls done,
two booked, two invited, three invites drafted, one to invite, and three
resting: an invite from an older study, a no-show, an opt-out), their deals
and earlier quotes, one call's Meet transcript with six proposals (two kept,
one set aside, three to review) and three calls' findings kept. Its invites
are only marked sent. Clear removes only what it made, and keeps the sample's
product if real work was filed under it since.

## Seen on 26 Nov 2026, on a hosted Lemma

A fresh scratch Lemma, server-side install of `install/user-interviews/` (283
steps), then:

- **Sample**: load wrote 15 people, Today's two items (3 findings to review,
  3 invites to send); `interviews_findings` answered "CSV export 4 of 4
  people … Since the last call: CSV export went from 3 to 4 people". Clear
  removed 229–230 rows and the sample files and kept a real study's rows and
  findings; loading again worked.
- **Set-up**: check named the missing parts in words; save made the memory
  block (read back in `/memory/AGENTS.md`). Opening the app made the member's
  two meeting triggers (OWNER_READABLE, the second with `document_path
  changed`) and the 09:00 schedule, read back through the API.
- **Who fits**: a new study's sentence ("Admins or ops people at paying
  customers who said something about exports or sharing, and who opened a
  shared report in the last month") came back as three filters and "Opened a
  shared report in the last month" as unknown, in about 15 s; the pool held 5
  people, all resting ("Invited 14 Nov to another study"). A list pasted in
  the app (three people, plan and seats columns) and a new sentence ("… on the
  Team plan …") read as a `pasted` filter on `plan`; the pool became the two
  Team-plan admins and the sample's pasted person, the engineer left out.
- **Invites**: Draft 3 invites wrote three drafts in under a minute, each
  naming why that person, the study's line, the call's length and the booking
  link on its own line, and "say so" to decline; no money. Send in the drawer
  (Mail's sample mailbox) marked the draft sent and the person invited, set
  the study running, and rested that address in the sample study ("Invited 26
  Nov to another study"); "N invites to send" counted down and closed.
- **Booked**: a `meeting` inserted on the member's calendar with the invited
  attendee was booked by the member's own trigger in seconds.
- **After the call**: notes added through Meetings' `meetings_add_notes` →
  the member's document trigger → read: five proposals, all quotes in the
  notes, `at_seconds` empty (notes). A pasted transcript with `[m:ss]` lines:
  five proposals with `at_seconds` 31, 69, 160, 198, 242; no line of "You".
  `interviews_read` save given a made-up quote and one of the member's own
  lines dropped both, and kept a quote with different spacing.
- **Keep**: three kept with A and one set aside with X in the app: three
  `feedback` rows whose ids match the contract's rule recomputed, `source`
  note, `source_id` the meeting's, `heard_by` the member, `processed`,
  `plugin` user-interviews; a new name became a suggested feature (origin
  lemma); a kept transcript finding has `source` interview and `at_seconds`
  69; the Findings tab counted them by person.
- **No-show**: a booked call moved into the past opened "Did Elena show up
  for your call?" on the next refresh; They didn't (in the app) marked the
  no-show, rested the address for 90 days in the other study ("Missed a call
  on 26 Nov", until 24 Feb) and closed the Today item.
- **Pictures**: light, dark and 375px of the study, a call, Findings and
  set-up from the demo; no sideways scroll at 375px (page width measured
  375). The demo built (0.8 MB) and the moments captured (the people table,
  a proposal kept with A, the grid going from 3 to 4 of 4).

## Things that bit

- **The install failed three times on the Outlook pod connector** ("Apply
  failed due to a transient error", every time at that step, with the
  organization's Outlook installed). Creating the pod connector by hand
  (`POST /pods/<id>/connectors`, outlook, PER_MEMBER) let the same install go
  through. Not filed yet.
- **A sample calendar's notes live in `/meetings-sample`**, a folder the read
  had no grant on: the first read failed ("Only the person who had the call
  can read…"). `interviews_read` now has `/meetings-sample:read`; real notes
  and transcripts are in the member's own `/me`, which needs none.
- **An app path can't carry `?`**, so a study's segment and the invites
  drawer are path parts (`/s/<id>/booked`, `/s/<id>/invites`).
- **`lemma files cat` prints a header line** before the text; the demo's
  documents are read with `--json --text`.

## Not built or not verified

- **A real send through `mail_send_draft`**: unseen. The scratch Lemma's Mail
  ran on its sample mailbox, and setting up Mail on a member's own Gmail would
  have read their real mailbox; every send here was the sample's "marked
  sent". The Gmail path (`GMAIL_SEND_EMAIL` for a draft with no thread) is
  Mail's own code, still never seen sending for real by any plugin.
- **The nudge**: written to Mail's drafting handshake on the invite's thread,
  but it needs a sent message Mail has synced; not seen.
- **A booking through the Booking page itself** (its turn-on, a visitor
  confirming their address): the walk inserted the `meeting` row; Booking's
  own README covers its page. The booking link in the walk was written into
  `booking_settings` by hand.
- **Meet transcripts**: no `googlemeet` installation (and installs leave it
  out); the transcript path was walked with a pasted `[m:ss]` transcript and
  the sample's.
- **Two members**: another member's view of someone else's call (they see
  the kept findings, not the document or proposals) is built, not seen.
- Out of v1, as the brief says: uploading a recording (needs `listen`
  segments merged; then a workflow agent with the SPEECH toolset writes
  `[m:ss] Speaker N:` lines and the read runs as usual); auto-transcription
  on Meets Booking creates (unverified, needs a `googlemeet` installation; the
  row says "Press Transcribe in Meet"); a booking page per study (length,
  questions, consent tick: a Booking change); a screener (Forms); usage data
  (no table holds it, only a pasted list's columns); Teams and Zoom transcripts
  (pasting works); paying incentives and bought panels (never).
