# Sprints: design

## Thesis

> For an engineering team whose work already lives in a Lemma's tasks,
> Sprints plans, runs and closes sprints from numbers nobody has to make up:
> each person's capacity is what they finished in their last three sprints
> less the days they're off, what was in at the start is frozen and kept apart
> from what came in after, every unfinished task gets a decision at the close,
> and the summary is sentences worked out from the numbers, never praise.

- **Hero moment:** the running sprint's scope graph. Scope steps up at
  numbered marks, each listed under the graph: "② Thu 19, 15:05 · +5 pts ·
  #436, #437 · from Triage · Maya". Done climbs under it, the target is a
  dashed diagonal, the pace runs on as a dotted line: "at this pace: 21.6 of
  37 pts".
- **First 30 seconds:** the numbers row (in at start, added after start,
  taken out, done against today's target, capacity), the graph, then the
  tasks grouped in at start · added · taken out, and on the right capacity
  by person and what may slip.
- **Information spine:** the sprint, made of rows of the shared `task` table.
  Membership, estimates, events and suggestions are Sprints' own tables keyed
  by the task's id; the task itself is always opened in Tasks.

## Direction: a dense engineering tool on the kit

The approved canvas (A run, B plan, C close) drawn on `../_kit`: Inter at 500
at most, the host's `--c-*` roles only (no hex anywhere in `sprints.css`),
lucide icons, the kit's pills, buttons, segmented controls, sheets, search,
empty states and skeletons. GitHub/Linear density: 13px rows, 12px meta,
15px heads, 19px figures. No hero art, no decoration, no metaphor.

- **One accent per view.** Plan: Start Sprint N. Close: Close N and open
  N+1. Run: Close sprint turns primary only on the sprint's last day.
- **The Lemma's own work** (what may slip, the pull-in, the plan's draft, the
  close suggestions, the summary) carries the sparkles icon and the `ai` pill,
  never a colour of its own. All of it is worked out from the rows; only the
  close's carry/split/backlog/drop and the summary's choice of sentences come
  from Decisions calls, and both are closed questions.
- **Pills always carry words**: Running, Ends Fri 27, 3rd sprint, added,
  taken out, 2.4 over, Out Thu 26 – Fri 27, urgent.
- **Charts are SVG drawn in the app** on the roles: scope `--c-faint`,
  target `--c-border-strong` dashed, started `--c-warning`, done `--c-info`,
  pace `--c-info` dotted; the last-six-sprints bars scope `--c-subtle` on
  `--c-border-strong`, done `--c-info`. They are drawn at the width they have,
  so their 11px labels stay 11px on a phone.
- **Capacity bars** fill to this sprint's capacity, `--c-info`, or
  `--c-warning` when over; "no capacity yet" is a hatched empty bar with its
  pill, never a guessed fill. The plan's stacked bar shades `--c-info` towards
  `--c-page` per person.
- **Who**: a person's initials (kit Avatar), the sparkles mark for the
  Lemma's assistant, a hatched circle for nobody.

## Screens

| Route | What it is | Matches |
| --- | --- | --- |
| `/` | the running sprint: numbers, scope graph and steps, tasks by in at start / added / taken out or by person, capacity as frozen at the start, what came in mid-sprint, what may slip | A |
| `/plan` | the next sprint: capacity meter, the Lemma's draft, the queue (still open in the running sprint, came in since it started, backlog) with estimate pickers and Add, lanes by person, days off | B |
| `/close` | closing: numbers, one row per unfinished task with the sprints it was in and Carry / Split / Backlog / Drop beside the Lemma's suggestion, what came in after the start, the last six sprints, the summary (Edit, Draft again, Copy) | C |
| `/s`, `/s/<n>` | past sprints; one as it closed (sizes and outcomes at the close), with its summary | A's layout |
| `/setup` | first run, then settings | — |

The mocks' dashed "gap" chips are left out or said plainly: "Typed here;
Sprints doesn't read anyone's calendar" under days off; no Slack or Teams
button at all.

## Keys, no drag

Plan: J/K move, A adds or takes out, 1–5 estimate on the scale (1, 2, 3, 5, 8),
M opens "Who does #N?", / searches, Enter opens the task in Tasks. Run and a
past sprint: J/K and Enter. Every key has a button beside it, so a phone works
the same with taps.

## Phone (375px)

One column; the numbers row two by two; the graph redraws at its width; task
rows fold onto two lines (number, title, who and points; then status and
flag); the plan's rows put the estimate picker under the title; close rows put
the choice on its own line. No sideways scroll on any screen (checked in
rendered screenshots, light and dark).

## Copy

Plain and specific, tasks named by number, numbers cut to one decimal and
never rounded up ("29.6 pts", "2.4 over"). Never "pod", "teammate" or
"room"; the noun is "Lemma". No sample names in copy: the sample's people
appear only in its rows.
