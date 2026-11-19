# Tasks: design

## Thesis

> For anyone in a Lemma with more to do than they can hold, Tasks turns what
> they type, what they ask the Lemma for, and the promises they make into one
> keyboard-fast list, where any task can be handed to an agent that works it in
> its own conversation and reports back on the task, by asking one closed
> question of every new task (could an agent do this with what this Lemma
> has?) and of every promise (work to do, or just a reply?).

- **Hero moment:** a task page where a person and an agent share one
  timeline: "You handed it to Acme" · "worked: 3 web searches, 4 pages read" ·
  "asks you: what's their admin's address?" · your answer · "wants your
  approval: send this email to it-admin@…" with Approve and Decline · the
  finished guide as a file.
- **First 30 seconds:** My tasks, grouped Waiting on you, In progress, To do;
  the rows an agent could do carry "An agent could do this"; J/K, X, C, ⌘K
  shown in the toolbar and the sidebar's foot.
- **Information spine:** the task. Two tables with one shape (`personal_task`
  private, `task` the team's) read as one list; the agent's conversation hangs
  off the task (`tasks_run`), never the other way round.

## Direction: Linear's density on the kit

Dense product furniture from `../_kit`, the same look as Mail, Meetings and
Today so they read as one product in the Lemma's sidebar: Inter at 500 at
most, the host's `--c-*` roles, lucide icons, the kit's pills, menus, sheets,
cards, record layout, empty states and skeletons. `tasks.css` only places
things and draws Tasks' own small marks:

- **Status circles** (dashed to do, dotted in progress, hourglass waiting on
  you, check done), each with its word for readers; colour from `--c-info`,
  `--c-warning`, `--c-success`, never alone.
- **Priority bars**, three rising, filled by level; urgent a filled square
  with "!".
- **Due words**: Today in amber, "2 days late" in red, a weekday within the
  week, a date after.
- **Who has it**: a person's initials, the Lemma's face for its own
  assistant, a bot mark for a named agent, a dashed circle for nobody.
- **The agent's work** carries the `agent` pill and sparkles, never a colour
  of its own.

## Pages

| Path | Page | Reads | Writes |
| --- | --- | --- | --- |
| `/`, `/board` | My tasks: your own list and team tasks on you | `personal_task`, `task` | status, priority, assignee (records); delete (`tasks_delete`) |
| `/agents` | With agents: every task an agent has | the same, `tasks_run` | Stop (`conversations.stopRun`) |
| `/p/<id>`, `/p/<id>/board` | A team project | `task`, `project` | as above |
| `/promises` | From promises: to decide, made tasks, just replies | `promise` ⋈ `tasks_decision` | make a task, dismiss, both corrections |
| `/t/<id>` | A task: notes, sub-tasks, one timeline, properties | the task, `tasks_*activity`, `tasks_run`, the conversation's tool calls | comments, replies (`conversations.appendMessage`), approve/decline, share/move (`tasks_move`) |
| `/settings` | Team on/off, promises, agents, the sample | `tasks_settings` | records; `tasks_sample_data` |
| set-up | the `tasks-setup` run's forms | the run | `workflows.runs.submitForm` |

## Keys

C new task · ⌘K palette · / search · J/K or arrows move · X select · Enter
open · 1–4 status of the selection (or the row under the cursor) · B list or
board · Esc back or clear · ? the keys. Nothing is only on hover: the row's
checkbox is visible (faint) and every action is in a menu or the palette.

## States

Skeletons in the list's geometry; empty lists say what is absent and the
next step ("Type one, ask the Lemma in chat, or load the sample"); an agent
that could not start says why ("Let it take tasks in Settings"); a reply on a
task whose agent conversation is someone else's says it stayed on the task.

## 375px

One pane; the places become a drawer behind the menu button; rows drop
labels, project chips and numbers; the board scrolls sideways inside itself,
one column per screen; the task page puts properties above the timeline.
