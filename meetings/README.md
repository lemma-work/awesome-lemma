# Meetings

Every meeting with people from outside, prepared before and written up after.
Meetings reads a person's Google Calendar or Outlook, sorts each meeting with
outside people with one closed Decisions call (what kind of meeting, does it
need a brief), writes a one-page brief the evening before or an hour before,
and after the meeting reads Google Meet's transcript or the person's own notes
for what was decided and what was promised either way, each kept with the
sentence it came from. It never adds, changes or answers a calendar event and
sends nothing.

It needs no other plugin. When **Mail** is in the same Lemma, briefs also draw
on the person's conversations and open promises with each attendee, the sort
sees who the person writes to, and promises made in a meeting land in the same
`promise` table as the ones from mail.

Tested in two Lemmas: this folder installed alone into an empty one, and a
second with Mail installed first and then this ("stacked", below). The app,
`meetings`, is for the Lemma's members (they sign in).

## What it does

```
set-up (per person): connect ─▶ read last 30 days + next 14 ─▶ sort (Decisions) ─▶ kinds ─▶ when ─▶ after ─▶ first briefs
every 15 min (the person's own schedule): meetings-sweep = calendar_read ─▶ sort ─▶ due

meetings_calendar_read   Google / Outlook / sample fixture ─▶ meeting (shared) + meetings_work (own)
                         outside = an attendee's domain is not the owner's  (no model)
meetings_sort            one Decisions call per outside meeting (one per repeating series):
                           kind: customer | investor | candidate | partner | internal | other
                           needs_brief: yes | no
                         examples = the person's last 20 corrections; switches in the instruction
                         confidence < 0.5 (kind) or < 0.55 (brief) ─▶ unsure, waits for the person
meetings_due             brief due (18:00 the day before, or start − 1 h) ─▶ brief_state wanted
                         meeting over (≤ 7 days) ─▶ Meet transcript / sample transcript ─▶ notes_state wanted
brief_state → wanted     (meetings-brief-wanted)  meetings-brief: brief_context ─▶ meetings-brief-writer (web search) ─▶ save_brief
notes_state → wanted     (meetings-notes-wanted)  meetings-read-notes: notes_context ─▶ meetings-notes-reader ─▶ save_notes
```

- **The person's corrections teach the sort.** Settling a meeting the read
  wasn't sure of, or changing one (`meetings_settle`), is kept in
  `meetings_correction` with the evidence the read saw; the newest twenty go
  with every call as worked examples. The rest of a repeating series takes the
  answer and is never asked again. Earlier meetings with the same people show
  in the evidence with their kind, so one correction carries to the next
  meeting with them.
- **Everyone met is a shared person.** Each read writes the attendees (not
  the owner's own addresses, not automated ones; colleagues yes, as Mail does)
  into `person` and `person_handle` (kind `email`), with Mail's own person id
  for a handle. A handle already there keeps its person whoever made it; only
  an empty name or org is filled, and Mail's counts are never touched. A
  meeting reaches its people through its attendees' handles:

  ```sql
  SELECT m.id AS meeting_id, h.person_id
  FROM meeting m
  CROSS JOIN LATERAL jsonb_array_elements(m.attendees::jsonb) AS a(att)
  JOIN person_handle h ON h.kind = 'email' AND h.handle = LOWER(a.att->>'handle')
  ```
- **Switches are not a model call.** Changing which kinds get a brief re-decides
  from the answers already stored (`meetings_work.answers`).
- **Agents only write.** `meetings-brief-writer` (WEB_SEARCH only, for people
  neither the mail nor an earlier meeting knows) and `meetings-notes-reader`
  (no tools) return JSON; functions do every write.
- **Nothing is kept that isn't in the text.** `meetings_save_notes` keeps a
  decision or promise only when its sentence is in the transcript or notes word
  for word (spacing and quote marks aside); the rest is counted as dropped.
  Reading again updates by sentence and marks what it no longer finds as
  dropped or dismissed; nothing is deleted.

| Layer | Resources |
| --- | --- |
| Shared tables (from `_contract`, carried exactly) | `meeting` (Meetings owns it), `promise`, `conversation`, `message`, `person`, `person_handle` (Mail owns these) |
| Own tables (per person) | `meetings_calendar` `meetings_settings` `meetings_work` (same id as the meeting) `meetings_correction` `meetings_decision` |
| Functions | `meetings_connect` `meetings_calendar_read` `meetings_sort` `meetings_setup_kinds` `meetings_setup_done` `meetings_due` `meetings_settle` `meetings_add_notes` `meetings_brief_context` `meetings_save_brief` `meetings_notes_context` `meetings_save_notes` `meetings_sample_data` |
| Memory | `meetings_memory`, the last step of `meetings-setup`: Meetings' block in `/memory/AGENTS.md` and its guide `/memory/plugins/meetings.md`, from `.lemma/agents-block.md` and `guide.md` (`_contract/README.md`, Memory block) |
| Agents | `meetings-brief-writer` `meetings-notes-reader` |
| Workflows | `meetings-setup` (four forms) `meetings-sweep` `meetings-brief` `meetings-read-notes` |
| Schedules | `meetings-brief-wanted` `meetings-notes-wanted` (DATASTORE on `meetings_work`, `bulk_writes: each`); per person `meetings-sweep-<user>` (TIME, every 15 min, made by the app) |
| Connectors (per member) | `google_calendar` `outlook` `googlemeet` (optional) |
| App | `meetings` |

## Install

`install/meetings/` at the top of this repository is this folder assembled
and ready, without Google Meet (below): **Add to your Lemma** on Meetings'
page at lemma.work imports it. From the CLI, the same server-side import:

```bash
# from the repository root
uv run --no-project python _build/install.py meetings --pod <pod-id> --var meetings_slug=<free slug>
```

To work on Meetings itself, import this folder from your machine instead
(Node 22 or later on PATH; the CLI builds the app here, so give the build its
config):

```bash
export VITE_LEMMA_API_URL=https://api.lemma.work VITE_LEMMA_AUTH_URL=https://lemma.work/auth \
       VITE_LEMMA_POD_ID=<pod-id> VITE_LEMMA_APP_BASE_PATH=/   # or your own server's addresses
bin/import.sh --var meetings_slug=<free slug>
```

`bin/import.sh` is `lemma pods import` with one workaround: the importer stops
on any declared connector the organisation has no installation of, even one
marked `required: false`, and refuses a grant on a connector the bundle does
not declare. When the organisation has no `googlemeet` installation (the test
organisation had none), the script imports a staged copy without
`connectors/googlemeet` and without that grant on `meetings_due`. With an
installation it imports this folder as it is. `bin/import.sh functions/<name>`
imports one function the same way. Pass `--var meetings_slug=…`: the CLI
ignores the variable's default. `install/meetings/` is always without Google
Meet, for the same reason.

`bin/lemma` is the `lemma` CLI bound to one Lemma: it reads `LEMMA_SERVER`,
`LEMMA_ORG_ID` and `LEMMA_POD_ID` from the environment or from a gitignored
`.lemma.env` in this folder. `bin/grants.sh` regenerates every function's
grants (never edit `functions/*/*.json` by hand). The app depends on the kit
as `apps/meetings/source/vendor/*.tgz`; after the kit changes, run
`../_kit/bin/vendor.sh meetings`; after any change here, from the repository
root, `uv run --no-project python _build/assemble.py --install` and
`uv run --no-project python _contract/lint.py`.

## Each person

They open Meetings. With no settings yet the app makes them and starts their
own `meetings-setup` run (so does anyone who joins later), and is the screen
for its forms:

1. **Calendar.** Google Calendar or Outlook: pick an account connected in the
   organisation or connect one (the connector's own sign-in). Or "Look around
   with a sample calendar".
2. **Read.** The last 30 days and the next 14, then the sort, in passes of 60.
3. **Briefs.** Switches for customers, investors, candidates, partners (on),
   internal and anything else (off), with the next two weeks' meetings marked
   Brief, No brief or Not sure as the switches move; the ones it wasn't sure of
   are settled here.
4. **When.** The evening before (18:00, their time) or an hour before.
5. **After.** Google Meet transcripts (Google calendars, needs the `googlemeet`
   connector), notes they write, or skip.

Finishing writes the briefs for the next two days at once. For a real calendar
the app also makes the person's own 15-minute `meetings-sweep` schedule (a
switch under Briefs and settings, Running for you).

## Verify

```bash
bin/lemma functions run meetings_sample_data --data '{"mode":"load","timezone":"Asia/Kolkata","display_name":"Sam"}'
bin/lemma workflows run meetings-setup --data '{"provider":"sample","timezone":"Asia/Kolkata"}'   # waits at kinds
bin/lemma query run "SELECT m.title, m.kind, m.wants_brief, w.unsure, w.reason FROM meeting m JOIN meetings_work w ON w.id = m.id ORDER BY m.start_at"
bin/lemma functions run meetings_settle --data '{"meeting_id":"<id>","kind":"customer"}'
bin/lemma functions run meetings_sort --data '{"meeting_ids":["<id>"],"detail":true}'
bin/lemma workflows runs submit-form <run> --node kinds --data '{"kinds_on":["customer","investor","candidate","partner"]}'
bin/lemma workflows runs submit-form <run> --node timing --data '{"brief_when":"evening_before"}'
bin/lemma workflows runs submit-form <run> --node after --data '{"notes_from":"notes"}'
bin/lemma query run "SELECT m.title, m.headline, w.brief_state, w.searched FROM meeting m JOIN meetings_work w ON w.id = m.id WHERE w.brief_state <> 'none'"
bin/lemma query run "SELECT direction, person_name, text, quote, due_at FROM promise WHERE source = 'meeting'"
bin/lemma functions run meetings_sample_data --data '{"mode":"clear"}'
```

The app against your Lemma without deploying, signed in with the CLI's
session (the API refuses a 127.0.0.1 origin, so it goes through Vite's proxy),
from `apps/meetings/source`:

```bash
LEMMA_DEV_PROXY_TARGET=https://api.lemma.work VITE_LEMMA_BASE_URL=http://127.0.0.1:5381/api \
VITE_LEMMA_POD_ID=<pod-id> VITE_LEMMA_DEV_TOKEN_CMD="$PWD/../../../bin/lemma auth print-token" \
npx vite --host 127.0.0.1 --port 5381 --strictPort
```

The change stream refuses that dev token, so the dev app re-reads on its own
(every 5 s while something is being written).

### Seen on 18 Nov 2026, on a hosted Lemma, sample calendar

- **Set-up, from the app**: sample → read (24 meetings, 18 with people from
  outside) → sorted → Briefs step (1 not sure, settled there as a customer;
  switching "anything else" on and off moved Build Notes between Brief and No
  brief) → evening before → my notes → the week opened with three briefs being
  written. About 30 s to the Briefs step.
- **Decisions**: 18 outside meetings, 18 calls, 16 s of call time (about 0.9 s
  each, four at once), Typesafe with confidences. First pass: 15 sure, 3 not
  sure (Studio Tan intro, Velo rollout review, Orchard onboarding). Arguably
  wrong but sure: Quill Partners intro as partner (0.79), the designer
  shortlist with a recruiter as candidate (0.63). A second set-up gave the same
  picture (Orchard the only one not sure ahead).
- **A correction teaching it**: Quill intro changed to investor; re-reading
  the Quill cap-table meeting went from partner 0.51 to investor 1.00. Studio
  Tan intro settled as partner; Brand refresh kick-off (same person) went from
  0.93 to 1.00. Velo rollout review settled as customer; a new Velo meeting
  added to the calendar afterwards was read as customer 0.98. The same evidence
  without the corrections (no examples, no "met before" line) is partner 0.38,
  not sure.
- **Briefs**: written for the next two days on finishing, 15 to 23 s a run
  (six runs); a write-up 17 to 24 s.
  Northgate's looked up the one stranger (Jonah Price) on the web and not Mira
  (met before); Harbor Lane's said the .example domain can't be found rather
  than invent anything.
- **Notes**: the sample transcript (Velo rollout review) gave 1 decision and 5
  promises (3 owed by you, 2 to you), each sentence verbatim, dates resolved
  from the meeting's date (by Friday → 20 Nov, next week → 27 Nov, the 3rd →
  3 Dec), "I can't promise a date" left out, 0 dropped. Notes typed in the app
  for the Ferro follow-up gave 2 decisions and 2 promises.
- **Clear**: every row and file the sample made removed (0 meetings, work
  rows, corrections, decisions, promises, calendars; settings removed when the
  sample was the only calendar; the sample folder empty). The app then started
  set-up again. Set-up runs and agent conversations stay in the Lemma's run
  history (platform history, not rows).
- **The 15-minute read**: the person's `meetings-sweep-<user>` schedule fired
  on its own at 08:15 UTC and completed (read, sort, due); the switch under
  Briefs and settings pauses and resumes it (checked both ways). It was then
  paused (it ran as the account on sample rows for nothing).
- **People**: the read made 23 people from the sample's attendees, one per
  handle; the join above counts Theo and Noor in 8 meetings, Mira in 3. Clear
  removed them all with the rest.

### Stacked on Mail, 18 Nov 2026

A fresh Lemma: Mail installed first from a copy of `mail/` (its sample and
set-up run with its own `bench/run_setup.py`), then Meetings from a copy of
this folder (with its own `meetings_slug`). The shared tables imported as
"updated" with nothing dropped; Mail's 36 conversations, 52 messages, 24
people and 10 promises were untouched.

- **The sort sees the mail.** With Mail's conversations in the evidence:
  Quill Partners intro went from partner (0.79, alone) to investor; Orchard
  onboarding from not sure (0.28 to 0.36) to customer 0.77; Harbor Lane from
  investor 0.60 to 0.94; the recruiter's shortlist from candidate to partner.
  Still off: Studio Tan intro read as customer 0.58; Velo still not sure.
- **Briefs use the conversations.** Northgate's brief cites Mira's mail ("asked
  for the data room and the last three months of revenue by Thursday"), the
  October investor update and the first pitch; `built_from` lists 2
  conversations and 1 earlier meeting; it looked up only Jonah Price. Yusuf's
  and Harbor Lane's each drew on their one conversation.
- **Promises land in Mail's table.** The Velo transcript's 5 promises are
  `promise` rows with `source = 'meeting'` beside Mail's 10 with `source =
  'mail'`; Mail's Promises page lists all open ones.
- **One person per human across both.** Of the 23 attendees, 15 were already
  Mail's people and were reused as they were (Mira keeps Mail's 2
  conversations, 1 in, 2 out); 8 were added (Jonah Price, the team, Orchard's
  staff). 32 handles, 32 people, none twice.
- **Clear is Meetings' own.** Clearing Meetings' sample there removed its rows,
  its 2 files and the 8 people only its meetings brought in, and left every
  Mail row, Mail's 24 people among them. The sample was then loaded and set
  up again, so the stacked Lemma shows both.

## Google Meet transcripts

The `googlemeet` connector's catalog has the operations (conference records by
Meet code, `GOOGLEMEET_GET_TRANSCRIPTS_BY_CONFERENCE_RECORD_ID`,
`GOOGLEMEET_LIST_TRANSCRIPT_ENTRIES`, participants for names), and
`meetings_due` reads them into `Speaker: words` lines. **Not seen working**:
the test organisation had no googlemeet installation and no real account was connected,
so whether it returns transcripts, and the operations' exact parameter names,
are unverified. Google keeps a transcript only when someone turned
transcription on, on a Workspace plan that has it. Until verified, "Notes I
write" is the dependable path; the sample's transcript stands in for Meet's.

## Things that bit

- **A bulk write skips a datastore trigger unless it asks**: both schedules
  set `"bulk_writes": "each"`.
- **Deleting rows is its own permission**: only `meetings_sample_data` holds
  `table:rwd`; nothing on a schedule deletes.
- **Old zone names**: Chrome says Asia/Calcutta; the functions' zone database
  doesn't know it and the sample landed in UTC. The app and the functions map
  old names to current ones (filed).
- **A function reads only what it is granted**: `meetings_add_notes` 403'd on
  `meetings_settings` until granted; `meetings_save_notes` needed the sample
  folder to check quotes, and without it dropped everything as "not in the
  text".
- **The dev app gets no change stream**, so pages that wait on a run re-read
  (the set-up's Briefs and After steps reload on open).

## Not built or not verified

A real Google or Outlook calendar read (code written to the CRM's verified
calendar shapes, plus series ids and descriptions); Meet transcripts; a
person's notes on a real meeting (written to `/me/meetings`; only the sample
folder was exercised); the hosted app signed in or framed inside Lemma's
web app (it answers 401 to the unsigned; checked through the dev server with
the CLI's session); Teams meetings (no transcript source); several people in
one Lemma at once.

## Needs you (for Today)

Meetings writes its part of the person's day to the shared `needs_you` list
(`../_contract/README.md`): today's and tomorrow's meetings until they end
(`attend`, opening on the meeting with "Brief ready" when written), and the
promises read from a meeting's notes (`do`, `waiting`). `meetings_needs_you`
runs as the person at the end of `meetings-setup`, `meetings-sweep`,
`meetings-brief` and `meetings-read-notes`; `meetings-needs-you-done` closes a
promise the person marked done elsewhere. The sample clear closes Meetings'
items.
