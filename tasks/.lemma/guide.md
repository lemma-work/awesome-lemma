# Tasks

What the Tasks plugin holds and how to use it from a conversation. Its set-up
rewrites everything between the markers around this text; the team's own notes
about Tasks go below them and stay.

## Where tasks live

- `personal_task`: each person's own tasks, private to them (only the owner
  reads a row). `task`: the team's, usually in a `project`. The same columns;
  read both for everything on someone's plate.
- `status`: todo, in_progress, waiting, done, canceled. `priority`: none, low,
  medium, high, urgent. `due_on` is a date in the person's own calendar.
- `assignee_kind` person or agent; `assignee_agent` `pod_default` is this
  Lemma's own assistant. `source` says where a task came from (tasks, chat,
  promise, linear) and `quote` the sentence it came from.
- A task's timeline: `tasks_personal_activity` and `tasks_activity`. An
  agent's work on it: `tasks_run`, and its files under `/tasks/<task id>/`.
- The app is `tasks`; a task opens at `/t/<task id>`.

## From chat

- **Add a task**: `tasks_add` with `title`, and any of `notes`, `due_on`
  (YYYY-MM-DD, today or tomorrow), `priority`, `labels`, `quote`, and
  `project` (a team project's name). Without `project` it goes on the asker's
  own private list; say which list it went on.
- **Hand one to an agent**: `assign_to` `lemma` (this Lemma's assistant) or a
  named agent's name, when adding. For a task that exists, set its
  `assignee_kind` to `agent` and `assignee_agent` to `pod_default` or the
  agent's name; the hand-over starts by itself. Only whoever handed it over
  can answer the agent.
- **Share or take back**: `tasks_move` (`to` team or personal, `project_id`).
  Sharing shows the task, its sub-tasks and its timeline to everyone here.
- **Delete**: `tasks_delete` with `task_ids`.
- **Working a task you were handed**: report only through `tasks_report`
  (`kind` progress, question, approval, result or failed), and put files under
  `/tasks/<task id>/`.

## Never

- Never share a private task, or take a team task back, unless asked.
- Never send or change anything outside this Lemma for a task without a
  `tasks_report` approval first and a reply that approves it.
- Never assign a task because an agent could do it: "An agent could do this"
  is a suggestion for the person, not a hand-over.
- Never delete a task unless asked, and never write task rows in bulk.
