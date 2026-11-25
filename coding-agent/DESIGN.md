# Coding agent: design

A developer tool, so it looks like one (GitHub, Linear): dense cards and rows,
a record sheet, code in monospace, no art. Drawn with the kit: `--c-*` roles
only, Inter at 500 at most, lucide icons at 12 to 15px, every status a pill
with a word, menus that open on press, search on `/`.

One app, `coding`. Its path is kept in the Lemma's address:

| Path | Screen |
| --- | --- |
| `/` | the board |
| `/t/<task>`, `/t/<task>/transcript`, `/t/<task>/changes` | the board with a task's record open on a tab |
| `/new`, `/new/t/<task>`, `/new/q/<question>` | New task, empty or filled from a task or an answer |
| `/ask`, `/ask/<question>` | Ask about the code |
| `/setup` | set-up (first run, and later changes) |

The tab is a path segment, not `?tab=`: an app's path carries no query.

## The bar on top

Coding agent · segmented **Work / Ask about the code** · **New task** (the one
accent) · set-up. Below 760px the segmented control takes its own row and New
task says **New**.

## The board

- **Filters**: repository (all, or one), Everyone / Mine (sessions you
  started, or tasks on you), search, and what your own cloud sessions cost in
  the last seven days, when the server reports usage (hidden otherwise).
- **Needs you**: one card per task whose latest session waits on a person,
  with what it waits on (`needs_text`) quoted and one action:
  - a question or an approval: **Answer** (opens the transcript with the
    reply box focused);
  - failing checks, review comments, a failed session: **Look**;
  - waiting for a Mac that is offline: **Move to the cloud** (`coding_start`
    on Lemma in the cloud for the same task);
  - a conflict: **Fix conflicts** (a message into the agent's conversation),
    for the person who started it; **Look** for everyone else.
- **Columns**: **Ready for an agent** (open team tasks from Triage, PR review
  or a labelled GitHub issue with no session, and tasks Tasks marked "an
  agent could do this", each with **Assign** and the agents' live status),
  **Working** (the agent's last command in monospace, for the person who
  started it), **Pull request open**, **Merged this week**. A card shows
  where it came from, the repository, its status in words, the agent, the
  change's size (`+N −M`) and, for your own cloud sessions, its cost.
- **Phone**: one list with a segmented filter per lane (counts beside), the
  first lane with anything in it chosen; a record opens full screen.

## The record sheet

Beside the board from 1100px, over it below that, full screen on a phone.

- **Header**: where it came from, the repository, the agent and model; the
  title; status, branch, cost so far, and a link to the issue or pull
  request it came from.
- **Activity** (everyone's): the facts (status, assignee, pull request with
  its size, checks, keep green with its tries, cost or "your own plan" for an
  agent on a Mac), what the agent said it did, then the `coding_event`
  timeline with an icon per kind (a failing check's log tail and a review
  comment's `path:line` under it). For the person who started it, the first
  event carries the run in one line ("Worked for 9 min · Read 10 files ·
  Edited 4 files · Ran 9 commands · 1 failed") and a link to the transcript.
  The foot: **Merge on GitHub** (a link: merging stays with a person),
  **Move to the cloud**, **Start again**, **Hand back to a person** (stops the
  agent and gives the task to a member), **Stop**.
- **Transcript** (the starter's only): the brief, what the agent said, and its
  steps grouped the way a person reports them: reads and searches as one
  line, edits as a box of files with their size, commands as a box with each
  command, ✓ or ✗ and the last line it printed; a running command has a
  spinner. Proof the agent saved under `/coding/<session>/` is listed with a
  link. Below: the reply box (**Answer** when it asks, **Steer** while it
  works), **Stop**, ⌘ Enter sends.
- **Changes**: the files and their diffs, the first one open, and where the
  list came from, said in words.

## New task

One composer ("Describe the change, or paste an issue or pull request
link"), and under it: **Cloud / Your Mac** (from the organization's agent
profiles; Your Mac is off when none is set up), the repository (enabled ones
first, then whatever GitHub lets the person open), where its branch starts
(branches, open pull requests, tags), the agent with its live status, the
model, "Its own branch" (untick on a pull request to push to its branch) and
"Keep the pull request green". **Start** calls `coding_start` and opens the
task on the board. Below: **Waiting for an agent** (the Ready list) with
**Hand over** / **Fix it**, which fill the composer. Beside: the
repository's set-up commands, the week's cost, the person's Mac.

## Ask about the code

Questions on the left (Today, This week, Earlier), the thread in the middle,
what it read beside. The answer's `path:line` (bare or in backticks) is a
link to that line on GitHub at the commit it read; the first cited lines are
shown, read from GitHub at that commit. **Make this a task** opens New task
with the question and answer as the brief, on the same repository and
commit; the task's status shows back under the answer. A follow-up box asks
again at the same commit. The rail says how it answers: read-only by
instruction, not enforced; no index, it searches the checkout each time.

## Set-up

GitHub (connected or **Connect GitHub**), the repositories GitHub lists with
a tick each and, once ticked, its set-up commands and notes for the agent;
the defaults (agent and model, keep green, tries before it asks, the issue
label). **Save and start**, or **Look around with a sample**. Saving also
makes the person's own schedules and says which couldn't be made.

## Data

| Read | How | When it can't |
| --- | --- | --- |
| `coding_settings`, `coding_repo`, `coding_session`, `coding_event`, `coding_question`, `task`, `tasks_decision`, `coding_sample_row` | SQL through the kit's data provider, kept fresh by the change stream | an error notice on the board |
| members, the signed-in person, the organization | the kit client | names fall back to the email |
| agent profiles (`agentRuntime.listProfiles`) | read on open and every minute | the agent menus say none are set up; Assign falls back to Lemma in the cloud |
| a conversation's messages and status | `conversations.get` and `messages.list` (after the last sequence seen), every 3 s while running, 30 s otherwise, only for its starter | "Only <name> can see the transcript" |
| usage (`GET …/conversations/{id}/usage`, platform PR 1243) | raw request, the starter's cloud sessions only | 404 or 422: never asked again that page, cost hidden everywhere |
| changes (`GET …/conversations/{id}/changes?patch=true`, platform PR 1244) | raw request, for the starter | then the pull request's files (`pulls_list_files`), then the branch against its base (`repos_compare_commits`), then the transcript's edits added up; each says so |
| repositories | `conversations.repositories()` | set-up offers Connect GitHub and a box to type `owner/name` |
| branches, tags, open pull requests, a file's lines | GitHub through the Lemma's connection, as the person | the menu says GitHub listed none; the lines aren't shown |
| proof files | the pod's files under `/coding/<session>/` | nothing listed |

| Write | Through |
| --- | --- |
| start, assign, hand over, move to the cloud, start again | `coding_start` (with the agent's name, place and status from the profiles) |
| a question | `coding_ask_start` |
| set-up | `coding_setup_save`, then the person's schedules |
| the sample | `coding_sample_data` (`load`, `clear`) |
| answer, steer, fix conflicts | `conversations.appendMessage` into the starter's own conversation, then the session row and an `answered` event |
| stop | `conversations.stopRun`, the session row, a `stopped` event |
| hand back | the task's assignee, the session row, a `stopped` event |
| Today | `coding_needs_you`, a moment after any of the above and once on open |

Schedules, made as the person (no function can make one), named
`<prefix>-<first 8 characters of the user id>`, as `bin/app-schedules.json`
lists them: `coding-tick` (every 15 minutes) and six GitHub webhooks
(`coding-on-pull-request`, `-check-run`, `-check-suite`, `-review-comment`,
`-review`, `-issues`). Made at set-up and again on open when one is missing.

## States

- **Loading**: the board's four columns as skeleton cards; lists and the
  transcript as skeleton rows; a spinner where one value is coming.
- **Empty**: every column says what lands in it; an empty board offers New
  task; no questions says what Ask does; no transcript says why (not started,
  waiting for a Mac, no conversation behind it).
- **Errors**: a function's refusal arrives as a toast in its own words; a
  GitHub call that fails says so in place; a table that can't be read stops
  the app with a notice.
- **Permissions**: the transcript is the starter's; others get a plain line
  and the Activity tab. Steer, Stop and Fix conflicts appear only for the
  starter.
- **Sample**: a banner while sample rows exist, with Clear the sample.
