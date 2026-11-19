# Meetings

Each person's meetings with people from outside, from their Google Calendar
or Outlook: a brief before, and after, what was decided and what was promised
either way, each kept with the sentence it came from. Its set-up rewrites
everything between the markers around this text; the team's own notes about
Meetings go below them and stay.

## Where meetings live

- `meeting`: each person's own (private to them): `title`, `start_at`,
  `attendees`, `outside`, `kind` (customer, investor, candidate, partner,
  internal, other) and `wants_brief`. The brief is `headline` and `brief`.
  After it: `summary`, and the notes or transcript as a document at
  `document_path` (a person's own under `/me/meetings`).
- What was decided: `meetings_decision` (`text`, and `quote` the sentence).
  What was promised either way: the shared `promise`, with its `quote`.
- The people on a meeting are shared `person` rows, found by address in
  `person_handle`.
- The app is `meetings`; a meeting opens at `/<meeting id>`.

## From chat

- **Notes after a meeting**: `meetings_add_notes` with `meeting_id` and the
  `text` as the person gave it. They become the meeting's document, and the
  reader keeps what was decided and promised, only sentences found in the
  text word for word. Promises the person made then show in Today.
- **A brief**: read `meeting.brief`. One not written yet comes the evening
  before or an hour before, as the person chose.
- **How a meeting was sorted**: `meetings_settle` with `meeting_id` and
  `kind` or `wants_brief`; kept as a correction the next read learns from.

## Never

- Never add, move, accept or decline a calendar event, or write to an
  attendee: Meetings sends nothing.
- Never add a decision or promise that is not in the notes or transcript.
- A person's meetings, briefs and notes are theirs: never show them to anyone
  else.
