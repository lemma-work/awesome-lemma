# Sprints

Sprints with real capacity, carry-over and an honest summary, over the tasks
the team already keeps. Plan a sprint against each person's capacity (what
they finished in their last three sprints, less the days they're off), run it
with the work that came in after the start kept apart from what was in at the
start, and close it with a decision for every unfinished task and a summary
worked out from the numbers. One app, `sprints`: the running sprint, planning
the next, closing, and past sprints.

Sprints carries **Tasks** (`plugin.json`), so one install brings both: a
sprint is made of rows of the shared `task` table, and a task always opens in
Tasks (`openApp("tasks", "/t/<id>")`). It listens for work from **Incidents**,
**Triage** and **PR review** (team tasks whose `source` is theirs); none of
those is built yet, and any plugin, or a person, writing such a task is heard
the same way.

Tested in two hosted Lemmas (24 Nov 2026), named below as they were:

| | |
| --- | --- |
| `Sprints test` | `install/sprints/` installed server-side into an empty Lemma (`_build/install.py`); the whole loop walked by CLI and in the app |
| `Sprints sample` | the same install, with the sample sprint loaded; the demo's sample and the pictures come from it |

## What it does

```
set-up, once, by the lead (the app)          sprints_setup_save
   length, start day, zone, points or tasks, lead ─▶ Sprint 1 on the next start day
   ─▶ sprints_memory (the block in /memory/AGENTS.md)
   ─▶ as the lead: sprints-daily-<user> (TIME 06:00) and sprints-lead-<user> (DATASTORE on sprints_suggestion)

plan (/plan)          sprints_add · sprints_remove · sprints_estimate · days off (sprints_away)
   capacity per person = mean finished in their last 3 closed sprints × share of working days here
   no history ─▶ "no capacity yet"; agents counted in tasks, never in capacity
start (Start Sprint N, or the lead's daily run on the start day)          sprints_start
   every item in_at_start, its estimate frozen (points_at_add), capacity frozen on the sprint; Sprint N+1 opens for planning

run (/)
   a team task changes ─▶ sprints-task-changed (DATASTORE, every UPDATE) ─▶ sprints_on_task
        status or assignee in `changed` ─▶ sprints_event (started, done, reopened, status, assigned; {from, to} from `previous`)
        done / reopened ─▶ the item's outcome and done_at; first start ─▶ started_at; then what may slip again
   a team task comes in ─▶ sprints-task-added (DATASTORE, INSERT) ─▶ sprints_on_task
        watched source + high or urgent + a sprint running ─▶ pull_in suggestion (with what it does to capacity
        and what could move out) ─▶ the lead's "decide" in Today: "#444 came in: pull it into Sprint 47?"
   each morning, as the lead ─▶ sprints-daily ─▶ sprints_tick: start what is due, reconcile with `task`,
        prepare the close on the last day, what may slip, the lead's items

close (/close)
   sprints_close_prepare: one Decisions call per unfinished task (carry, split, backlog, drop + a reason)
        and the summary: sentences worked out from the numbers, one Decisions call picks the optional ones
   sprints_close with the lead's choice for each: carry ─▶ the next sprint, "2nd sprint";
        split ─▶ the part that carries keeps the id, the rest a new task (source sprints) in the backlog;
        backlog; drop ─▶ the task canceled. Stats, /sprints/<n>.md, the sprint closed, the lead's items resolved
```

| Layer | Resources |
| --- | --- |
| Shared tables it carries (byte for byte) | `task`, `project`, `personal_task` (read, to say a private task must be shared first), `needs_you` (decide: plan, close, pull-in) |
| Sprints' own tables (team-wide, no RLS) | `sprints_settings` (one row) `sprints_sprint` `sprints_item` (a task in a sprint; id uuid5(sprint, task)) `sprints_event` `sprints_estimate` (id = the task's) `sprints_away` `sprints_suggestion` `sprints_sample_row` |
| Functions | `sprints_setup_save` `sprints_on_task` `sprints_add` `sprints_remove` `sprints_estimate` `sprints_capacity` `sprints_start` `sprints_tick` `sprints_close_prepare` `sprints_close` `sprints_needs_you` `sprints_memory` `sprints_sample_data` (grants from `bin/grants.sh`) |
| Workflows | `sprints-task-changed`, `sprints-task-added` (DATASTORE on `task`), `sprints-daily` (TIME, the lead's), `sprints-lead` (DATASTORE on `sprints_suggestion`, the lead's) |
| Schedules | `sprints-task-changed`, `sprints-task-added` in the bundle; per lead, `sprints-daily-<user>` and `sprints-lead-<user>`, made by the app as them |
| Folders | `/sprints` (each closed sprint's `<n>.md`); `/memory` (the contract's folder, so `sprints_memory`'s grant resolves) |
| Memory | Sprints' block in `/memory/AGENTS.md` and its guide `/memory/plugins/sprints.md`, from `.lemma/agents-block.md` and `.lemma/guide.md` |
| App | `apps/sprints` (Vite, `@lemma-plugins/kit`), design in `DESIGN.md` |

## The numbers, and why they can be trusted

- **In at start** is the sum of each task's estimate when the sprint started
  (`points_at_add`, frozen by `sprints_start`). Work added later is "added
  after start" forever; a task taken out stays on the record as taken out. A
  re-estimate after the start is an `estimated` event, so the graph moves by
  the difference and "in at start" does not.
- **Capacity** per person = the mean of what they finished in their last 3
  closed sprints (the last 3 they had work in) × the share of the sprint's
  working days (Monday to Friday) they're here; a half day counts half. With no
  closed sprint behind someone: "No capacity yet", and no number anywhere.
  The Lemma's assistant and named agents are counted in tasks ("2 of 2 done"),
  never in capacity. The app works it out in the page the same way as
  `sprints_capacity`; in the sample both said Sprint 48: 16 of 28.9 pts, Asha
  5.6, Maya 9, Ravi 8, Tomás 6.3.
- **A task with no estimate** counts as 0 points and the screen says so.
- **Never rounded up**: every number is cut to one decimal ("29.6", "2.4
  over", "21.6 of 37").
- **The summary** is sentences built here from the computed numbers and the
  task lines, tasks named by number. The Decisions API answers only closed
  questions (by design: free text is where evidence gets copied into what
  reads it next; `lemma-backend/app/modules/decisions/domain/questions.py`),
  so a Decisions call picks which of the optional sentences go in (what
  slipped, what was carried, who carried more than usual, the agents, the
  next sprint); the plan, what came in and what went out are always in. A
  list of praise words is checked and refused. The lead can edit it; a closed
  sprint keeps the edited text.

## For Today

`sprints_needs_you` writes the lead's items with the contract's write rule
(`_contract/snippets/needs-you.py`, embedded), all `decide`, opening the app:

| Title | When | Opens |
| --- | --- | --- |
| Plan Sprint N | from two days before a planned sprint starts until it starts | `/plan` |
| Close Sprint N | from the running sprint's last day until it is closed | `/close` |
| #444 came in: pull it into Sprint N? | an open pull-in suggestion | `/` |

`needs_you` is row-level: only the lead's own runs write these (their app,
their daily run, their trigger on a new suggestion). Anyone else's run
resolves whatever Sprints had left them, so handing the lead role on clears
the old lead's items.

## Install

`install/sprints/` at the top of this repository is Sprints with Tasks,
ready to install. From the CLI, the same server-side import as **Add to your
Lemma**:

```bash
# from the repository root
uv run --no-project python _build/install.py sprints --pod <pod-id> \
  --var sprints_slug=<free slug> --var tasks_slug=<free slug>
```

Then the lead opens Sprints once: set-up, or "Look around with a sample
sprint". `bin/lemma` is the CLI bound to one Lemma (`LEMMA_SERVER`,
`LEMMA_ORG_ID`, `LEMMA_POD_ID` from the environment or a gitignored
`.lemma.env` here); `bin/q "<sql>"` prints one JSON row per line.

The functions share code they cannot import: `bin/common.py` copies the
helpers (`# sprints:common`), capacity (`# sprints:capacity`, owned by
`sprints_capacity`) and the close's numbers and sentences (`# sprints:numbers`,
owned by `sprints_close_prepare`) into every function that uses them, and the
contract's snippets too. After editing any of them:

```bash
uv run --no-project python bin/common.py      # --check fails on a copy that differs
bin/grants.sh                                  # every function's grants
# from the repository root
uv run --no-project python _contract/lint.py --fix
uv run --no-project python _build/assemble.py --install sprints
```

The server-side import only creates: a Lemma that has Sprints keeps its
functions and app as they were. Change them with `bin/lemma pods import
functions` (or the part's folder).

## Verify

```bash
bin/q "SELECT number, state, starts_on, ends_on, capacity_total FROM sprints_sprint ORDER BY number"
bin/lemma functions run sprints_capacity --data '{"sprint":"next"}'
bin/lemma records update task <id> --data '{"status":"in_progress"}'          # the trigger records it
bin/q "SELECT e.kind, e.detail, e.via FROM sprints_event e ORDER BY e.at"
bin/lemma records create task --data '{"title":"…","priority":"urgent","source":"incidents","source_id":"INC-16"}'
bin/q "SELECT kind, state, text FROM sprints_suggestion"; bin/q "SELECT title, state FROM needs_you"
bin/lemma functions run sprints_close_prepare --data '{}'
bin/lemma functions run sprints_close --data '{"take_suggestions": true}'
bin/lemma functions run sprints_sample_data --data '{"mode":"clear"}'
```

## Measured (24 Nov 2026, on a hosted Lemma)

**Install.** `install/sprints/` (Tasks + Sprints, 151 files) into the empty
`Sprints test` Lemma: every part CREATE, COMPLETED. A second install on top planned SKIP for every
existing function and app and UPDATE for one table (a new column).

**The loop, in `Sprints test`** (by CLI and in the app, through a local dev
server against the Lemma's API):

1. **Set-up** in the app (two weeks, Tuesday, Asia/Kolkata, points, lead =
   the person): Sprint 1 Tue Nov 24 – Mon Dec 7, planned; the block in
   `/memory/AGENTS.md`; the app made `sprints-daily-<user>` (TIME) and
   `sprints-lead-<user>` (DATASTORE) as the lead.
2. **Plan**: six team tasks estimated and added with the keys (4 = 5 pts, 2,
   3, 1, 2), one left in the backlog; two days off for Ravi (Dec 3–4) in the
   sheet. "Plan Sprint 1" appeared in Today (it starts today) and resolved at
   the start.
3. **Start**: 6 tasks in at start, 18 pts frozen, capacity frozen as none
   (no closed sprint behind anyone), Sprint 2 opened for planning.
4. **Status changes** by CLI: six `sprints_event` rows from the trigger,
   each with the value before: #1 started {todo → in_progress}, #6 done,
   #2 started {todo → waiting}, #5 assigned {Ravi Menon → the lead}, #4 done
   then reopened {done → in_progress}; the items' outcome, started_at and
   done_at followed. Actor `unknown`: a CLI write names nobody (see below).
5. **Urgent work**: a task with `source` incidents, `source_id` INC-16,
   urgent, created mid-sprint: in about 5 s a pull-in suggestion ("#8 came in
   from Incidents (INC-16), urgent, not estimated. The sprint has no capacity
   yet to weigh it against.") and the lead's `decide` "#8 came in: pull it
   into Sprint 1?" in `needs_you`; the lead's own `sprints-lead` run also
   completed. Estimated at 3 by CLI, pulled in from the app: added after
   start +3 pts, in at start still 18, the graph's step ① "#8 … from
   Incidents, INC-16", the suggestion taken and the Today item done.
6. **Close**: "Ask the Lemma" made 6 suggestions (carry 0.95, carry 0.74,
   backlog 0.94, carry 0.85, carry 0.65, carry 0.87) and a summary with 4 of
   4 optional sentences picked. Closed with all four choices: #1 split (3 pts
   carry; the rest "Stream the report export: the read path", 2 pts, became
   #9, source sprints), #2, #4, #8 carry, #3 backlog, #5 drop (canceled).
   Stats by hand: planned 18 (5+5+2+1+3+2), added 3, done 2 (#6), not done
   19, carried 9 (#2 5, #4 1, #8 3), split 5, backlog 2, dropped 3: as
   stored and as on `/s/1`. `/sprints/1.md` written.
7. **Next sprint**: Sprint 2 with #1, #2, #4, #8 carried, each `nth` 2,
   shown "2nd sprint" on `/plan`; capacity 2 pts (the lead finished 2, Ravi
   finished 0 of his 5), said as "8 of 2 pts planned · 6 pts over".

**The sample, in `Sprints sample`**: 85 tasks, Sprints 42–48, 47 running
(day 7 of 10 on the day). Its numbers by hand match the screens: in at start
31 pts (12 tasks), added 8 (#431 3, #436 3, #437 2), taken out 2 (#409),
done 13, scope 37, target by today 37 × 6 ⁄ 10 = 22.2, pace 13 ⁄ 6 × 10 =
21.6; capacity 29.6 (Maya 9 · Ravi 8 · Asha 7 × 8⁄10 = 5.6 · Tomás 7);
Sprint 48 28.9 with Tomás out a day. The pull-in for #444 said "10.4 pts
over its capacity of 29.6"; what may slip: #412 in its 3rd sprint, #420
waiting since Fri 20, three people over, and the pace (moving the three
not-started tasks still leaves 9.3 at risk). The close's 7 suggestions
came from Decisions; the summary kept all 10 optional sentences. Loading took
70 s with nested function calls and 47 s once capacity and the numbers were
worked out in-process; clearing removed 568 rows and opened Sprint 1.

## Seen working

- Every screen in a browser against both Lemmas, and in the built demo:
  `/`, `/plan`, `/close`, `/s`, `/s/<n>`, `/setup` (first run and settings),
  light, dark and 375px, no sideways scroll on any (rendered screenshots).
- Keys on the plan: J/K, 1–5, A; the assign sheet (M); the days-off sheet.
- The plan's draft: in the sample, "adding #444 to Tomás … That makes 19 of
  28.9 pts, and nobody over their capacity"; Use the draft put it in his lane.
- The daily run by hand (`sprints_tick`) in both Lemmas; the sample's clear.

## Not verified

- The two TIME and DATASTORE schedules the app makes firing on their own (the
  trigger one ran once; the 06:00 run was only run by hand).
- A lead who is not the installer: the bundle's triggers then run as the
  installer, and the lead's own `sprints-lead` trigger is what reaches their
  Today; seen only with one person.
- The deployed app signed in (the looks were a local dev server on each
  Lemma's API, and the demo build).
- A change made in Tasks' app naming its author on the event: no Tasks app
  set-up was walked here; CLI writes are `unknown` by design.
- The assistant working the agent-assigned task (Tasks' hand-over; Tasks was
  not set up in the scratch Lemma).

## Things that bit

- **The Decisions API has no free text.** The brief asked for the summary
  "drafted with `pod.decisions.make`"; the API refuses anything but a
  choice, choices, yes/no or a scale. So the sentences are computed and a
  Decisions call picks which go in. Honest by construction, and it cannot
  round up or praise.
- **A `when` has no OR.** "status, assignee_user_id or assignee_agent
  changed" cannot be one condition, so `sprints-task-changed` watches every
  update and `sprints_on_task` returns at once unless one of them is in
  `changed`.
- **A column named `user_id` is the platform's row owner.** Creating a
  `sprints_away` row with `user_id` null was refused as "Table or relation
  'sprints_away' does not exist." The column is `member_id`. (In `Sprints
  test` the old column stays: an import adds columns, never removes them.)
- **A trigger on the team's `task` table runs as the schedule's owner** (the
  installer) and does not say who wrote the row. The actor comes from
  `tasks_activity` when Tasks' app logged the change a moment before, else
  `unknown`. And because `needs_you` is row-level, the lead's items need runs
  as the lead: hence the lead's own `sprints-lead` trigger, made by the app.
- **A function calling a function waits about 30 s.** The sample's first
  load called others 14 times and its caller failed with `LemmaTimeoutError`
  while the work went on to finish in 70 s. Capacity and the close's numbers
  are now shared code (`bin/common.py`), the load takes 47 s, and the app runs
  it on its own and says "still loading" if the answer is slow.
- **The server-side import only creates.** Changed functions go in with
  `bin/lemma pods import functions`.
- **Task numbers are the table's.** The sample's tasks are numbered by the
  Lemma (#1…); the demo's are the mock's (#398, #412…), renumbered by
  `bin/demo-fixtures.py` in every sentence.
- **The demo moves its dates by whole days**, so in the demo a sprint starts
  on whatever weekday the anchor's offset gives; in a Lemma, on the set-up's
  start day.
- **Local dev**: `vite` caches pre-bundled dependencies with the env values
  of the first run (`node_modules/.vite`; `--force` clears it), and an
  `.env*.local` left in `source/` would be copied into `install/` by the
  assembler, so delete it before assembling.

## Decisions the brief left open

- The next sprint opens for planning when a sprint starts (the plan screen
  needs it while the current one runs); closing carries into it.
- A planned sprint is started by the lead's daily run on its start day if
  nobody pressed Start; a running sprint is never closed for anyone. The close
  is prepared on its last day and waits.
- The close needs a choice for every unfinished task; "Take the Lemma's
  suggestions" fills them, nothing is chosen silently. The suggestions are
  asked for from the close screen (or the last day's run), not on opening it.
- Start and Close are shown to everyone but enabled for the lead only, in the
  app; the functions do not check who calls them.
- "2nd sprint" counts every earlier sprint the task was in and did not
  finish, including one it was taken out of.
- Someone who finished nothing in their last sprints has a usual of 0, not
  "no capacity yet": they had work and finished none of it.
- The plan's draft is worked out in the page (urgent and high work first, to
  whoever has the most free capacity, at most three, nobody pushed over).

## Out of v1

- Reading days off from calendars: typed in Sprints. Whether the calendar
  connector passes `eventTypes` (out of office) needs one live call.
- Posting the summary to Slack or Teams: it is in the app, `/sprints/<n>.md`
  and Copy.
- A sprint per project: one cadence per Lemma.
- Personal tasks in a sprint: share them from Tasks first (`sprints_add`
  says so).
- A "Sprint 47" chip on the Tasks task page (a Tasks change).
- Linear or Jira cycle sync.

## Pictures and demo

- `.lemma/shots/sprints{,-plan,-close}-{light,dark}.webp`: 1440×900 at 2x
  from the built demo (below its sample bar).
- `.lemma/moments/`: `scope` (still, and phone), `lanes` (loop: Use the
  draft), `decide` (loop: take the suggestions, split #412), `summary`
  (still), by `node _kit/bin/moments.mjs sprints` from `.lemma/moments.json`.
- `.lemma/demo/` by `node _kit/bin/demo.mjs sprints`, on
  `.lemma/shots/fixtures/` (from `Sprints sample` by `bin/demo-fixtures.py`)
  and `.lemma/demo.js` (adding, taking out and estimating change the sample;
  starting and closing say what they would do).
