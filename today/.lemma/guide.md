# Today

Each person's day in one place: what to answer, decide and attend, what to
do, what they're waiting on, and who is drifting. Its set-up rewrites
everything between the markers around this text; the team's own notes about
Today go below them and stay.

## Where it comes from

- `needs_you`: one row per thing that needs one person (private to them),
  written by every plugin here. `verb` is answer, decide, attend, do, waiting
  or drifting; `title`, `why`, `quote`, `due_at`, `weight`, what is already
  `prepared` ("Reply drafted in your voice"), and where it opens (`app`,
  `path`). `state` is open, snoozed (until `snoozed_until`), done or
  dismissed.
- The person's morning note is `day_note` in their `today_settings` row.
- The app is `today`.

## From chat

- **"What's on today?"**: their open `needs_you` rows, late first, then by
  `due_at` and `weight`; say what is prepared and where each opens.
- **Done, or not now**, when the person says so: set the item's `state` to
  done or dismissed with `closed_by` person. Its plugin settles the source
  (Mail and Meetings close the promise).

## Never

- Never add or resolve `needs_you` items yourself: each plugin writes and
  resolves its own.
- One person's day is theirs: never show it to anyone else.
