# Sprints

What the Sprints plugin holds and how to use it from a conversation. Its
set-up rewrites everything between the markers around this text; the team's
own notes about Sprints go below them and stay.

## What it holds

- One cadence for the whole Lemma: `sprints_settings` (length in weeks, start
  day, time zone, `measure` points or tasks, the lead who plans and closes).
- `sprints_sprint`: one row per sprint (`number`, `starts_on`, `ends_on`,
  `state` planned, running, closing or closed; `capacity` frozen at the start,
  `stats` and `summary` at the close; `summary_path` is `/sprints/<n>.md`).
- `sprints_item`: one team task in one sprint. `in_at_start` false means it
  came in after the start; `nth` 2 is its 2nd sprint; `outcome` open, done,
  carried, split, backlog or dropped.
- `sprints_event`: what happened to a sprint's task, with the value before.
- `sprints_estimate`: a task's points (id = the task's id).
- `sprints_away`: a person's day off. `sprints_suggestion`: what the Lemma
  proposes (risk, pull_in, move_out, close).
- Tasks themselves are the shared `task` table (Tasks plugin). The app is
  `sprints`: `/` the running sprint, `/plan`, `/close`, `/s/<n>` a past one.

## From chat

- **Add work**: `sprints_add` with `tasks` (ids or numbers, "#444") and
  `sprint` ("current", "next" or a number). Only team tasks: a private task
  is shared from Tasks first (`tasks_move`). Say whether it went in before
  or after the start.
- **Take it out**: `sprints_remove` (`to` backlog or next).
- **Estimate**: `sprints_estimate` with `task` and `points`.
- **How much fits**: `sprints_capacity`. With no closed sprint behind
  someone it says no capacity yet: say that, never a guess.
- **Days off**: write a `sprints_away` row (`name`, `member_id`, `day`, `part`).
- **Where a sprint stands**: read `sprints_sprint`, `sprints_item` and
  `task`; a closed sprint's summary is in `/sprints/<n>.md`.

## Never

- Never start or close a sprint unless the lead asks: `sprints_start` and
  `sprints_close` are theirs. Close needs a choice for every unfinished task.
- Never change "in at start" or fold added work into it.
- Never round a number up, and never praise in a summary: name tasks by
  number and say what the numbers say.
- Never add work to a running sprint on your own: an urgent task that came in
  is a suggestion for the lead.
