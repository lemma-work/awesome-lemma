# Coding agent

What the Coding agent plugin holds and how to use it from a conversation.
Its set-up rewrites everything between the markers around this text; the
team's own notes about it go below them and stay.

## What it holds

- A card on its board is a team `task` assigned to the agent
  `coding_builder` (`assignee_kind` agent). Each agent run on it is a
  `coding_session`: `status` starting, working, needs_you (what for is in
  `needs` and `needs_text`), pr_open, merged, done, stopped or failed; with
  `repo`, `branch`, `pr_number`, `pr_url`, `checks`, `tries` of `max_tries`.
  `coding_event` is each task's activity, newest last.
- `coding_repo`: the repositories the team enabled, with their set-up
  commands and notes. `coding_settings`: the default agent and model, keep
  green, and the GitHub label that hands an issue over.
- `coding_question`: questions about the code, and answers citing
  `path:line` at the commit in `sha`.
- The app is `coding`: `/` the board, `/t/<task id>` one task, `/new`,
  `/ask`, `/setup`.

## From chat

- **"have the coding agent fix the export timeout in acme/web"**:
  `coding_start` with `title`, `brief` (what to change, why, how to tell it
  works) and `repo` (owner/name). Add `ref` to start from a branch, tag,
  commit or `pull/<n>/head`, and `push_to` with a pull request's branch to
  push there instead of opening another. Say it works in its own branch,
  opens a pull request and keeps it green, and that the board shows how it
  goes.
- **An existing team task**: assign it to the agent (`assignee_kind` agent,
  `assignee_agent` coding_builder). It starts on its own, in the repository
  its GitHub link names or the only one enabled; otherwise the person is
  asked which repository.
- **"where do we retry webhook deliveries?"**: `coding_ask_start` with
  `question` and `repo` (and `ref`). The answer is saved to its
  `coding_question` row (`state` answered) a minute or two later; read it
  from there and pass on its `path:line` citations. Never answer about the
  code from memory.
- **"what is the coding agent doing?"**: read the live `coding_session` rows
  and their newest `coding_event` lines. Only the person who started a
  session can read its transcript.
- An issue labelled with `coding_settings.issue_label` on GitHub is handed
  over by itself.

## Never

- Never merge, approve or close a pull request, push, or change a
  repository yourself: merging stays with a person, on GitHub.
- Never start work in a repository that is not enabled in `coding_repo`
  unless the person names it.
- Never put internal context in a title or brief that could reach GitHub:
  who reported it, how many people, chat or Lemma links, customers' names.
  Describe the problem in product terms.
- Never hand coding work to the Lemma's own assistant through Tasks; it goes
  to `coding_builder`.
