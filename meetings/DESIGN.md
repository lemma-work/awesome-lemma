# Meetings: design

## Thesis

For **a person who meets people from outside** (a founder, an account lead, a
recruiter), Meetings turns **their calendar** into **a page to read before
each meeting that matters, and what was decided and promised after it** by
**sorting every meeting with one closed Decisions call, writing a brief only
where one is wanted, and reading the transcript or their notes for decisions
and promises with the sentence each came from**.

- **Hero moment:** the week, each meeting with outside people carrying the one
  line to know going in, and beside it the promises the last meetings left
  open, each with its sentence.
- **First 30 seconds:** the week by day. The next briefed meeting's headline
  in the side column. No introduction.
- **Information spine:** the meeting, by day. Promises hang off the meeting
  they were made in; people off the meeting they are on.

## Direction: one product with the other plugins

The app is drawn with the shared kit (`_kit`): Lemma's own tokens from
the frame's `lemma-app-theme` message with its light and dark fallbacks, Inter
at weight 500 at most, lucide icons, the kit's cards, pills, nav, banner,
evidence quotes, owed ledger, skeletons and empty states. The frame is the
same as Mail's: a 232px place list on the left (with counts, the calendar at
its foot), the page on the right, a drawer below 860px. No colour of its own:
`meetings.css` uses only the kit's `--c-*` roles.

What is Meetings' own, kept small:

- **The time column.** A meeting row leads with its start time and length in
  tabular figures, so the day reads down like a calendar.
- **The headline.** A ready brief puts its one line under the meeting, set as
  a quote with a hairline at its left; a written-up meeting puts its summary
  there instead.
- **The date box** on a meeting's page: weekday and day, like a desk calendar.
- **Kind icons:** customer (handshake), investor (landmark), candidate (person
  search), partner (briefcase), internal (people), other (coffee). Every kind
  pill has its word.

Status is always a pill with a word: Brief ready (success), Writing brief (the
Lemma's own, with a spinner), Brief Thu 18:00 (quiet), Not sure (warning),
No brief (quiet), Written up (success), Add notes (info), Couldn't read
(danger). Colour is never the only signal.

## Pages

| Path | What it shows | Writes |
| --- | --- | --- |
| set-up | Calendar (Google, Outlook, or the sample) → reading → which kinds get a brief, with the meetings it would brief and the ones it wasn't sure of → when → after | `meetings-setup` forms; `meetings_settle` for each settled meeting |
| `/` (`/week/±n`) | The week Monday to Sunday by day, each meeting with kind and brief state, headlines under ready briefs; Up next and Promised in meetings beside it | nothing |
| `/after` | Meetings that are over: waiting for notes first, then the last month | nothing |
| `/unsure` | What the read wasn't sure of, ahead | nothing |
| `/promised` | Promises from meetings, you owe and owed to you, each with its sentence; done ones below | `promise.state` |
| `/{meeting id}` | Header (date box, when, where, kind, outside, status, Change); settle banner when not sure; After (summary, transcript or notes, decided, promised) when over; Before (headline, brief, what it drew on, who it looked up) | `meetings_settle`, `meetings_work.brief_state` (write it now / again), `meetings_add_notes`, `meetings_due` (look for the transcript), `promise.state` |
| `/settings` | Brief me before (six switches), when, after, calendars, running for you (the 15-minute read), clear the sample | `meetings_setup_kinds`, `meetings_settings`, schedules, `meetings_sample_data` |

## States

Loading draws skeleton rows (lists) or the record skeleton (a meeting). A
brief being written shows its skeleton in place with "Writing the brief from
what your mail and earlier meetings know…"; a write-up being read says so. The
app looks again every five seconds while anything is being written, on top of
the change stream. A planned brief says when it comes and offers "Write it
now"; a meeting without one says why and offers "Brief it anyway". A failed
brief or read says what failed and offers Try again. Empty pages say what will
appear and why. The sample is labelled on every page and can be cleared from
settings.

## Acceptance

- Theme follows Lemma when framed; on its own it follows the device. Checked
  light and dark from rendered screenshots.
- No horizontal scroll at 375px (checked: page width 375 at 375); actions
  reachable without hover; the place list is a drawer.
- Every count is a count of rows read (the week's, the waiting ones'), said as
  such.
- Every decision and promise shown has its sentence, and the sentence is in
  the text word for word (checked by `meetings_save_notes`, not by the UI).
