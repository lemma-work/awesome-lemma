# Coding agent

An issue turned into a pull request by an agent, and questions about your code
answered.

Hand a task to an agent: Lemma in the cloud, or Claude Code or Codex on your
Mac. It works in a branch of its own (`lemma/<slug>`), runs the repository's
set-up and checks, pushes, and opens the pull request. With **keep green** on, it
fixes failing checks and answers review comments in the same session, up to three
rounds, then asks you. Merging stays with a person. Ask how the code works and
the answer points at the lines (`path:line`, linked at the commit it read); one
press makes it a task.

The board is the one screen. A card is a piece of work (the team's `task` row);
the agent is its assignee, and every run on it (a retry, a fix round, a move from
the Mac to the cloud) hangs under the same card. What needs a person sits in a
lane across the top. A card opens its record: Activity (the task's whole life,
from assignment to ready to merge), Transcript (what the agent read, ran and
changed, grouped as "Ran 4 commands · 1 failed") and Changes.

Carries **Tasks** (`plugin.json`): a card is a team task, assigned to the agent
`coding_builder`. Reads work from **Triage** and **PR review** when they are
installed (team tasks with `source` `triage` or `pr-review`), and labelled GitHub
issues.

## How it works

| Part | What it is |
| --- | --- |
| Tables | `coding_session` (one agent run on one task: repo, start ref, runtime, conversation, branch, pull request, checks, keep-green tries, status and what it needs), `coding_event` (the Activity; id = uuid5 of its source, so a webhook that reaches every member's schedule writes once), `coding_repo` (repositories the agent may work in, with set-up commands and notes), `coding_question`, `coding_settings`, `coding_sample_row`. All team-wide; the conversation itself stays its starter's. Carries the contract's `task`, `personal_task`, `project` and `needs_you`. |
| Functions | `coding_start` (the one door: task, session, conversation on the repository, brief), `coding_report` (the agent's progress, question, pull request, result or failure), `coding_on_github`, `coding_tick`, `coding_on_task`, `coding_needs_you`, `coding_ask_start`, `coding_answer`, `coding_setup_save`, `coding_memory`, `coding_sample_data`. Shared helpers live once in `bin/common.py` and are copied in (`bin/common.py --check`). Grants: `bin/grants.sh`. |
| Agents | `coding_builder` (WORKSPACE_CLI, in the conversation's own worktree; reports through `coding_report`; never merges, force-pushes or pushes to the default branch; nothing internal reaches GitHub). `coding_ask` (reads only, by instruction; cites `path:line`; saves through `coding_answer`). |
| Workflows | `coding-on-pull-request`, `-on-check-run`, `-on-check-suite`, `-on-review-comment`, `-on-review`, `-on-issues` (GitHub events), `coding-tick` (every 15 minutes), `coding-task-handed`, `coding-task-added` (a task given to `coding_builder` in Tasks or anywhere else). |
| App | `coding`: the board with its Needs you lane, the record sheet, New task, Ask about the code, Set-up. `DESIGN.md`. |

### Who runs what

- **Starting.** `coding_start` opens a conversation with `coding_builder` on the
  repository (`repository`, and `ref` where the platform takes it), on the chosen
  runtime. The conversation's worktree is the agent's; its branch is read from
  `workspace_cwd`. A runtime on someone's Mac that is offline leaves the task
  waiting for that Mac, with **Move to the cloud** beside it.
- **Schedules are made by the app, as each person** (no function can make one):
  at set-up, and again on open when one is missing, named
  `<workflow>-<first 8 of the user id>` (`bin/app-schedules.json`). A schedule
  runs as its maker, so each member's GitHub events run as them.
- **Keep green acts only in the starter's own run.** Every member's webhook
  schedule fires for an event; each writes the same events (idempotent ids), and
  only the run whose caller started the session appends the fix round to its
  conversation. A member who never opened the app has no schedules: their
  sessions are kept current by the 15-minute tick once they do.
- **Merge conflicts send no webhook.** `coding_tick` reads each open pull
  request's `mergeable_state`.
- **Tasks.** Tasks hands a task to a named agent only when that agent is in its
  own allowed list, so it leaves `coding_builder` tasks to this plugin.

## Measured (25 Nov 2026, on a hosted Lemma)

Installed into an empty Lemma with `_build/install.py` (the server-side import):
every table, function, agent, workflow, schedule, app and grant created, status
COMPLETED. The one warning is the GitHub connector waiting for an account to be
shared, as expected. Then, from the CLI as a member:

- `coding_setup_save`: one repository with its set-up, the defaults, and the
  memory block written.
- `coding_sample_data`: 12 tasks, 9 sessions, 56 events, 2 answered questions.
- `coding_needs_you`: 3 items for Today; `coding_tick` again: 3 updated, none
  duplicated.
- `coding_start` with no GitHub account shared: refused cleanly
  (`CONNECTOR_NEEDS_ACCOUNT`); the session says so on the board.

`_contract/lint.py` ok; `_build/assemble.py --install coding-agent` ok; every
`code.py` compiles on Python 3.14; `bin/check.py` passes. The pure helpers
(payload parsing, event ids, the `ref` fallback, the branch from the worktree,
needs-you items, starter-only keep-green, the labelled-issue claim) were tested
outside the repository. The app builds; the demo was checked in light, dark and at
375 px.

## Not verified

- **A real run end to end**: an agent on a real repository opening a pull request,
  a failing check coming back through the webhook and being fixed, a review
  comment answered. It needs a GitHub account shared into the Lemma and a
  repository the agent may push to.
- **The app signed in on a hosted Lemma**: only the demo was looked at.
- **Platform changes not yet deployed** (lemma-platform pull requests): starting
  from a branch or a pull request (`ref` on create; until then the branch starts
  from the default branch and the Activity says so), cost per session (until then
  hidden), the worktree's changes before a push (until then the pull request's
  files, the branch compared with its base, or the transcript's edits added up),
  and a real checkout for Claude Code or Codex on the Mac.
- The exact shapes of the job-log operation and of the `actions` filter on
  webhook schedules.
- Ask links lines to github.com; a GitHub Enterprise host would need its own.

## Things that bit

- No function can create a schedule, so the app makes them as each person.
- A webhook reaches every member's schedule: every write from it is idempotent,
  and only the starter's run acts on the conversation.
- Tasks dispatched any named agent it was given, not only the ones allowed to
  take tasks, which would have failed every `coding_builder` task in Tasks; it
  now leaves agents outside its list alone.
- A function calling another gives up after about 30 seconds, so shared work is
  copied in from `bin/common.py` instead.

## Out of v1

Slack (`@Lemma` to the assistant to `coding_start`) is untested. Linear issues.
A live view of the agent's browser inside the app (it is in Lemma). Secrets in
the cloud sandbox: a repository whose tests need them can't run them there.
Indexing a repository for Ask: the agent searches its checkout each time.

## Try it

```bash
node _kit/bin/demo.mjs coding-agent
python3 -m http.server --directory coding-agent/.lemma/demo 8000   # then open http://127.0.0.1:8000
```
