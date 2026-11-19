# Tasks

Everything you have to do, done by you or handed to an agent. It starts as
your own private list and grows into the team's projects. Any task can be
taken by a person or by an agent; an agent works it in a conversation of its
own, with the task as its brief, and reports back on the task. One app,
`tasks`: a keyboard-first list, a board that drags, a command palette, and a
task page whose timeline mixes people and agents.

Tasks carries no other plugin and works alone. It listens when others are
there: with **Mail** or **Meetings**, promises you made (the shared `promise`
table) can become tasks, keeping the sentence; **Today** can show tasks due
today (the fields are below).

Tested in three Lemmas, named below as they were:

| | |
| --- | --- |
| `Tasks` | this folder's bundle installed alone into an empty Lemma, server-side (`_build/install.py`); the app, `tasks`, is for its members (they sign in) |
| `Tasks stacked` | Today's assembled bundle of the time (Mail, Meetings, Today), then Tasks |
| `Tasks dev` | the build Lemma (CLI imports; holds a test named agent, `researcher`) |

## What it does

```
a task added (typed, asked for in chat, made from a promise, the sample)
   ─▶ tasks-{personal,team}-added (DATASTORE, INSERT, bulk_writes each) ─▶ tasks_on_task
        one Decisions call: could an agent do this with what this Lemma has?  yes / no / needs_person
        yes ─▶ "An agent could do this" beside the task (tasks_decision, state open). Never assigns.

a task handed to an agent (assignee_agent changed)
   ─▶ tasks-{personal,team}-handed (DATASTORE, UPDATE, when assignee_agent changed) ─▶ tasks_on_task
        the Lemma's own assistant (pod_default):
            start a tasks-agent run, submit its brief form ─▶ AGENT step (pod_default, as the person)
            ─▶ the conversation id is the run's AGENT wait (tasks_run.conversation_id) ─▶ tasks_turn_end
        a named agent: create_for_agent + send_stream (needs agent.execute on it; Settings adds it)
   the agent reports only through tasks_report: progress | question | approval | result | failed
   a reply, an Approve or a Decline on the task ─▶ the app sends it into the conversation, as the person

a promise you made (Mail or Meetings writes promise, direction i_owe)
   ─▶ tasks-promise-made (DATASTORE, INSERT, when direction = i_owe, bulk_writes each) ─▶ tasks_from_promise
        one Decisions call: is this work to do, or just a reply?
        work + automatic ─▶ a personal task (source promise, source_id the promise, quote the sentence)
        work + ask (or not sure) ─▶ waits in From promises      reply ─▶ nothing (listed under Just replies)
```

| Layer | Resources |
| --- | --- |
| Shared list it writes | `needs_you` (do, decide, waiting; see below) |
| Shared tables it adds (in `_contract`) | `project` (team), `task` (team), `personal_task` (private; the same columns as `task`) |
| Shared tables it carries, read only | `promise`, `conversation` (byte for byte; empty unless Mail or Meetings is there) |
| Tasks' own tables | `tasks_activity` (team timelines) `tasks_personal_activity` (private timelines) `tasks_run` (an agent on a task, same id) `tasks_decision` (what a Decisions call answered, same id as the task or promise) `tasks_correction` (the person's overrides: the examples) `tasks_settings` `tasks_sample_row` |
| Functions | `tasks_on_task` `tasks_report` `tasks_needs_you` `tasks_turn_end` `tasks_from_promise` `tasks_add` `tasks_move` `tasks_delete` `tasks_setup_scope` `tasks_setup_done` `tasks_memory` `tasks_sample_data` (grants from `bin/grants.sh`) |
| Workflows | `tasks-setup` (FORM steps) `tasks-agent` (the assistant's run) `tasks-personal-added` `tasks-personal-handed` `tasks-team-added` `tasks-team-handed` `tasks-promise` `tasks-needs-you` |
| Schedules | one per DATASTORE workflow above (the platform keeps one schedule per workflow); per person, `tasks-needs-you-<user>` (TIME, 06:00 in their zone, made by the app as them) |
| Agents | none: the Lemma's own assistant takes tasks; named agents in the Lemma can be allowed |
| Folder | `/tasks` (what agents make, one folder per task); `/memory` (the contract's folder only, so `tasks_memory`'s grant resolves) |
| Memory | Tasks' block in `/memory/AGENTS.md` and its guide `/memory/plugins/tasks.md`, from `.lemma/agents-block.md` and `.lemma/guide.md` (`_contract/README.md`, Memory block) |
| App | `apps/tasks` (Vite, `@lemma-plugins/kit`), design in `DESIGN.md` |

## Private until shared: two tables

The platform's row-level security lets a row through to its owner only
(`lemma-backend/app/modules/datastore/infrastructure/schema_manager.py`,
`_user_isolation_policy_sql`): there is no "shared with" on a row. So "your
own tasks are private until you share one or put it in a team project" is two
tables with one shape. `personal_task` has RLS; `task` is the team's. Sharing
(`tasks_move`) copies the task, its sub-tasks and its timeline across with
every id kept and removes the old rows, so the run, the suggestions and
anything else keyed by the task's id still find it. A timeline is split the
same way, because RLS on a shared timeline would hide each person's comments
from the others. The app reads both tables as one list.

## Who can take a task: the Lemma's own assistant, through a workflow

Asked: can the Lemma's own assistant (the pod's default agent) be assigned
through the SDK and the conversations API? **Yes, but not from a function.**

- From a function (Agentboard's dispatcher): `403 MISSING_WORKLOAD_RESOURCE_GRANT:
  Missing permission(s): agent.execute on pod`. Opening a conversation with the
  assistant checks `agent.execute` against the *pod*
  (`lemma-backend/app/modules/agent/services/conversation_access.py`,
  `require_agent_actions`: `ResourceType.POD if is_default`), and a workload
  cannot be granted any pod-typed permission (`app/core/authorization/resource_actions.py`
  has no `POD` entry; an `agent: pod_default` grant is accepted and still 403s).
  Listing the assistant's conversations from a function fails the same way
  (`agent.read on pod`).
- As the person (the app, the CLI): yes. A reply sent into the assistant's
  conversation as its owner resumes it.
- From a workflow's AGENT step: yes. The step checks `agent.execute` as the
  run's person (`app/modules/workflow/infrastructure/agent_access.py`), so
  `agent_name: pod_default` runs the assistant as them.

So the hand-over starts a `tasks-agent` run from the function (workflows can be
granted), submits its form with the brief (runs take no inputs at start), and
reads the conversation id off the run's AGENT wait at once. The assistant is
the default; named agents in the Lemma that have its tools (the POD toolset,
which reporting on a task needs; Mail's and Meetings' background writers have
none and are not offered) can be allowed too (Settings), through
the function path, which needs `agent.execute` on each: Settings adds it to
`tasks_on_task`'s grants when an admin turns one on. Re-importing the bundle
resets those grants. A reply is sent from the app as the person in both cases,
so only whoever handed a task over can resume its agent; anyone else's reply
stays on the task (the app says so).

**Outside the Lemma waits for approval.** The brief and the step's
instructions say: before sending or changing anything outside the Lemma, report
`approval` (what, to whom, the full text) and stop; act only on a reply that
approves it. The task then waits on the person, with Approve and Decline on the
task page; either is sent back into the conversation. The assistant runs with
the person's own permissions, so this is its instructions plus the platform's
own gates, not a grant the plugin can withhold. Seen: asked to email
Brightwave's admin, it drafted the email, saw that the only sender was the
Lemma's own address, asked for approval (and the address), and after Decline
finished with the email on the task, sending nothing.

## Asking the Lemma in chat

The assistant finds `tasks_add` by its description. "Add a task to my list in
Tasks: send Grace Tan the signed brand refresh quote, due Friday, high
priority" made a private task (source `chat`, due Friday, high) and answered
"Added it … on your own list (only you see it)". It can name a team project
(`project`), labels, and hand the task to itself (`assign_to: lemma`), which
starts the usual hand-over.

**Every agent is told Tasks is here.** The last step of `tasks-setup` runs
`tasks_memory`, which writes Tasks' block into `/memory/AGENTS.md` (read into
every agent's brief on every run) and its guide to `/memory/plugins/tasks.md`,
with the contract's write rule (`_contract/snippets/agents-md.py`, embedded):
only the text between Tasks' markers, so the team's notes stay. Edit the text
in `.lemma/agents-block.md` and `.lemma/guide.md`, then
`uv run --no-project python _contract/lint.py --fix` from the repository root copies it
into the function. Run it again any time (`bin/lemma functions run
tasks_memory --data '{}'`); `{"remove": true}` takes both out. In `Tasks`
(18 Nov 2026), asked "Is Tasks installed in this Lemma? If it is, add a task to
my list…", the assistant answered from the block ("the runtime context shows
tasks installed"), read the guide, called `tasks_add`, and said only the person
sees the task.

## Each person

They open Tasks. With no settings yet the app makes them and starts their own
`tasks-setup` run; its forms are the set-up screen:

1. **Just you, or your team too** (and the first team project's name), or
   "Look around with a sample list", which loads the sample and goes on.
2. **Promises you made**, only when Mail or Meetings is in the Lemma:
   automatically, ask each time, or never.
3. **Who can take tasks**: the Lemma's own assistant (on), and each named
   agent with the Lemma's tools (off; an admin can turn one on).

Then it asks about promises from the last 30 days and every open task, once,
and opens on My tasks. The run id is on the person's settings, so a reload
lands where they were. Settings changes all three later.

## The two questions (Decisions API)

**Could an agent do this with what this Lemma has?** One call per new task
(not sub-tasks, not done ones, not ones made for an agent): `agent` (yes, no,
needs_person), `uses` (web, writing, records, files, mail, calendar, browser)
and `missing` (account, private_info, presence, judgement, payment), from which
the reason line is made. The evidence is the task and what the Lemma has
(`tasks_settings.capabilities`: plugins, connected accounts, agents, found by
the app at set-up and by "Look again"). Under 0.5 is unsure; a yes is
suggested only from 0.6 up (decided 18 Nov), so a 0.59 yes stays quiet. A
suggestion sits beside the task, never an assignment.
Corrections: handing over a task the call did not say yes to, and "Not this
one" on a yes.

**Is this work to do, or just a reply?** One call per promise the owner made:
`kind` (work, reply). Under 0.5 is offered, never made automatically.
Corrections: making a "reply" a task, "Just a reply" on a suggestion, and "Not
a task, just a reply" on a promise-made task (`tasks_delete` with
`not_a_task`, which leaves the promise itself alone: it is still a promise).

The newest twenty corrections of each kind go with every later call.

## For Today: tasks due today

Today is not edited here; these are the fields to read.

```sql
-- the person's own (RLS) and the team's on them; parents only
SELECT 'personal' AS scope, id, title, status, priority, due_on, project_id, assignee_kind, assignee_agent, source, source_id
  FROM personal_task WHERE parent_id IS NULL AND status IN ('todo', 'in_progress', 'waiting') AND due_on <= :today
UNION ALL
SELECT 'team', id, title, status, priority, due_on, project_id, assignee_kind, assignee_agent, source, source_id
  FROM task WHERE assignee_user_id = :me AND parent_id IS NULL AND status IN ('todo', 'in_progress', 'waiting') AND due_on <= :today
```

- `due_on` is a DATE in the person's own calendar: compare with today in their
  zone (`today_settings.timezone`); before today is late.
- `status = 'waiting'` with `assignee_kind = 'agent'` is an agent waiting on
  them (a question or an approval), worth showing whatever the due date.
- `source = 'promise'` and `source_id` = the promise's id: show the task in
  place of that promise, not both.
- `project_id` → `project.name`; `priority` none/low/medium/high/urgent.
- Open one with `openApp("tasks", "/t/<id>")`.
- Both tables exist only where Tasks is installed: check before querying.

## Needs you (Today's list)

`tasks_needs_you` writes the person's items to the shared `needs_you` table
with the contract's write rule (`_contract/snippets/needs-you.py`, embedded):

| Verb | When | Opens |
| --- | --- | --- |
| `do` | a task of theirs (their own list, or a team task on them) due today or late, not done | `tasks` `/t/<id>` |
| `decide` | an agent waiting on them on a task they handed over: its question, or the outside action it wants approved (`prepared` "Ready to approve", the text in `prepared_text`) | same |
| `waiting` | a team task they own that someone else has, still open; a task an agent is working for them | same |

It runs as the person: after every task trigger (the added and handed
workflows), after the agent's first turn (`tasks-agent`), after the agent
reports a question, an approval or a result (`tasks_report`), from the app a
moment after their changes and on open, and each morning on their own
schedule. What no longer applies is resolved by the source (seen: the
Brightwave email's `decide` and `waiting` closed when the agent finished). The
sample makes some (the invoice due today is a `do`); its clear deletes them.

## Install

`install/tasks/` at the top of this repository is Tasks, ready to install:
**Add to your Lemma** on its page at lemma.work imports it. From the CLI, the
same server-side import:

```bash
# from the repository root
uv run --no-project python _build/install.py tasks --pod <pod-id> --var tasks_slug=<free slug>
```

`bin/lemma` is the `lemma` CLI bound to one Lemma (`LEMMA_SERVER`,
`LEMMA_ORG_ID` and `LEMMA_POD_ID`, from the environment or a gitignored
`.lemma.env` in this folder; `--pod` overrides). `bin/grants.sh` regenerates
every function's grants (`bin/fnjson.py`, which here also knows `workflow:`
and `agent:`). After a kit change, `../_kit/bin/vendor.sh tasks`; after any
change here, from the repository root, `uv run --no-project python
_build/assemble.py --install tasks` and `uv run --no-project python
_contract/lint.py`. To change only Tasks' own parts in a Lemma that has them:
`bin/lemma pods import <part folder>`.

## Verify

```bash
bin/lemma functions run tasks_sample_data --data '{"mode":"load","timezone":"Asia/Kolkata"}'
bin/lemma query run "SELECT d.answer, d.confidence, d.reason, p.title FROM tasks_decision d JOIN personal_task p ON p.id = d.id"
bin/lemma records update personal_task <id> --data '{"assignee_kind":"agent","assignee_agent":"pod_default"}'   # hand it over
bin/lemma query run "SELECT kind, actor_name, state, body FROM tasks_personal_activity WHERE task_id = '<id>' ORDER BY created_at"
bin/lemma query run "SELECT state, conversation_id FROM tasks_run"
bin/lemma conversations send <conversation id> "…"          # what the app does with a reply
bin/lemma chat -m "Add a task to my list in Tasks: …"        # the Lemma adds one
bin/lemma functions run tasks_sample_data --data '{"mode":"clear"}'
```

## Measured (18 Nov 2026, on a hosted Lemma)

The install into the empty `Tasks` Lemma, server-side (`_build/install.py`):
every part CREATE, COMPLETED, the app built in the importer's sandbox. The
same install on top of Today's assembled bundle (`Tasks stacked`): `promise`
and `conversation` planned UPDATE (byte-identical), everything else CREATE,
COMPLETED. Later changes went in with `bin/lemma pods import`.

**Could an agent do this?** On the sample in `Tasks`, 12 calls, one per new
task, 0.65 to 1.63 s each (Typesafe System One, background priority):

| Answer | Tasks (confidence) |
| --- | --- |
| yes, suggested | SSO guide (0.99), error-monitoring comparison (0.75), reply to Jonas (0.71) |
| yes, under the 0.6 bar, not suggested | pricing page v2 to Hannah (0.59) |
| no | Tidal invoice (0.55), Brightwave quote (0.53), Brightwave tickets summary (0.65) |
| needs_person | two-year discount (0.54) |
| unsure (< 0.5), nothing suggested | onboarding call (0.40), Brightwave SSO check (0.46), renewal date with Daniel (0.38), board pack (0.42) |

`Tasks dev` gave the same split on its first load (SSO guide yes 0.96). The
two promise-made tasks in the stacked Lemma were asked too: yes 0.65 and 0.69
(writing, records); "Ship the CSV export fix" at 0.69 is a doubtful yes, the
kind a correction should teach.

**Work or a reply?** In `Tasks stacked`, Mail's sample read made 3 promises
the owner made: "Send pricing page v2…" work 1.00, "Ship the CSV export fix
and tell Lena…" work 0.99, both made into personal tasks at once (set-up said
automatically) with their sentence ("I'll revise it and send you v2
tomorrow.") and date; "Be in touch about next steps after Chloé's interview"
reply 0.80. 0.75 to 2.8 s a call. Owed-to-me promises are not asked.

**Agents.** The assistant took the SSO guide in 85 s (Tasks dev) and 2 min
20 s (Tasks, where it also made HTML and PDF versions), each time: web
searches and page reads, a file under `/tasks/<id>/`, a result, Done. A named
agent (`researcher`, Tasks dev) took the monitoring comparison through the
function path and finished with a result.

## Seen working

- Set-up end to end in the empty `Tasks` Lemma, through the app: first open
  started the run; "Look around with a sample list" loaded the sample and went
  on; the agents step; the list opened with four "An agent could do this".
  In `Tasks stacked` the Promises step appeared (Mail is there), "Make them
  tasks automatically" was chosen, and Mail's sample read then turned two
  promises into tasks by itself (the `tasks-promise-made` trigger), shown in
  From promises under Tasks with their sentences.
- A task handed to the assistant, end to end, in the app: "Hand it to Tasks"
  on the SSO guide (Decisions' suggestion); "Email Brightwave's IT admin how to
  turn on SSO with Microsoft Entra ID" made with C and given to the Lemma: it
  worked (its steps listed on the task), asked a question (the admin's
  address; the task went to Waiting on you, and `decide` appeared in
  needs_you), the answer typed on the task went into its conversation and
  resumed it, and it finished with the email as a result and a file, Done. In
  Tasks dev the same task asked for **approval to send the email** from the
  Lemma's own address; Decline with a note went back into the conversation and
  it finished without sending anything.
- Chat: the Lemma added a task when asked (`tasks_add`).
- The board: a card dragged from To do to In progress moved (pointer drag;
  the browser tool's own drag sends no pointer moves, so this was driven with
  pointer events in the page).
- Keys: C opened New task (and ⌘Enter made and opened it), J/K moved, X
  selected two, 3 moved both to Waiting on you, ⌘K then "in progress" and
  Enter moved them back, Esc kept the selection when closing the palette.
- Sharing: a private task moved into the Brightwave project (`tasks_move`)
  kept its id, got a team number (#8), took its timeline with it and added
  "Moved to Brightwave renewal."; "Make it private" moved it back the same way.
  The first try failed half-way (no grant on `tasks_settings`), which is why
  it now reads everything before it writes.
- The sample's clear in Tasks dev removed the 41 rows it made and left a
  chat-added private task, a non-sample team task with its 7-row timeline, and
  the project they are in.
- Light, dark and 375px in rendered screenshots: no sideways scroll (the board
  scrolls inside itself), properties under the title on a phone.

## Not verified

- **Privacy with a second member.** No second account could be made honestly,
  so "a teammate can't see my list" rests on the table definition
  (`personal_task`, `tasks_personal_activity`, `tasks_run`, `tasks_decision`
  are RLS) and the platform's policy, not on a second person's session.
- The deployed app signed in (it answers 401 without a session); every look
  was the same build through a local dev server against the Lemma's API.
- A reply from someone other than whoever handed the task over (by design it
  stays on the task); a named agent asking a question or an approval.
- The 06:00 schedule firing by itself; promises made in a meeting.
- Sending after an approval: never approved anything outside, by design.

## Site pictures

`.lemma/shots/tasks{,-board,-agent}-{light,dark}.webp`, 1440×900 at 2x: My
tasks, the board, and the Brightwave email task an agent worked (question,
answer, result). From the built app served on the `Tasks` Lemma's rows
(`.lemma/shots/fixtures`; the person shown as "You"/"Sam", the Lemma named
"Ops", the sample banner off): `bin/shot-fixtures.py --task <id> …`, then from
the repository root: `_kit/bin/shots_serve.py --app tasks/apps/tasks/source/dist --fixtures tasks/.lemma/shots/fixtures --port 4613`
and `node _kit/bin/shoot.mjs http://127.0.0.1:4613 <out> tasks=/ tasks-board=/board tasks-agent=/t/<id>`, then `cwebp`.

## Things that bit

- **One schedule per workflow.** A second DATASTORE schedule on the same
  workflow is refused ("Global workflow already has a schedule for this
  user…"), after the first was made; so added and handed are two workflows.
- **A DECISION node's default is its first-listed edge**, not a labelled one.
- **Workflow runs take no inputs at start**: the hand-over passes the brief
  through the run's first FORM.
- **The assistant's conversation from an AGENT step is titled "Workflow run:
  pod_default"**, and it is the person's; only they can resume it.
- **Imports fail now and then** with "Function schema extraction failed:
  ReadError"; rerunning works.
- **The browser tool's drag** does not produce pointer moves; HTML5
  drag-and-drop did not work either, so the board drags with pointer events.
- **Web search for agents** was refused by DuckDuckGo's bot check once; the
  agent read pages directly instead.
