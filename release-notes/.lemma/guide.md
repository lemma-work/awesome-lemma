# Release notes

What the Release notes plugin holds and how to use it from a conversation. Its
set-up rewrites everything between the markers around this text; the team's
own notes about releases go below them and stay.

## What it holds

- `release_note`: one row per release. `state` is drafting (merges still
  coming in), ready (it is live) or published. `live_via` says how we know it
  is live: the deploy workflow's run, a tag, or only merged (never call that
  live).
- `release_note_line`: the note's lines (`section` lead, need, improved,
  fixed), each with its sources (`prs`, `issues`) and how many people
  `asked`. A line with `edited_by` set was written by a person: never rewrite it.
- `release_note_pr`: every merged pull request, its `kind` (routine and
  internal work is left out of the note) and `left_out` reason.
- `ask` (shared): one person asking for one piece of work, and where they
  asked. Only who and where; what they said stays in the conversation of the
  member who heard it.
- `release_note_page`: what the public changelog shows. Public: never put a
  name or anything private there.

## From chat

- "Redraft the notes": start the `release-notes-redraft` workflow. It
  rebuilds the open note with `release_notes_draft` from the pull requests
  since the last tag, and keeps every line a person edited.
- "Change a line": edit the `release_note_line` row's `text` (and `title`)
  and set `edited_by` to the person, so the next merge keeps it.
- "Publish v2.14": only a publisher does this, in the app
  (`release_notes_publish`, which posts as the person who presses Publish).
  Never publish on your own initiative.
- "Who asked for X?": read `ask` rows whose `work_id` is in the line's
  `issues` or `prs`. Tell the person who heard each one; never quote another
  member's conversation.

## Never

- Never send a reply, post a comment or post to Slack yourself: replies are
  drafted and a person presses Send.
- Never write to `release_note_page` except through `release_notes_publish`.
