# Triage

Bugs, alerts and security warnings sorted by how far they reach, each with an
owner.

Reports come in through every door a team has: New report in the app, the
Lemma wherever it answers (chat, Slack, Teams, its mailbox), watched Slack
channels, GitHub issues (issue forms read field by field, "+1"s counted), a
report form people outside can send (a link, a help page, or inside your
product), Sentry, PostHog, and GitHub's Dependabot, code scanning and secret
scanning alerts. Each report goes the same six steps: **read** (bug, alert,
security, request; a question or chatter is left alone), **match** (merged
into an open item the Lemma is sure about, otherwise a new item marked "Looks
like T-31"), **reach** (people a tracker counted, people who asked,
companies, or repository and reachability, each with when it was read),
**owner** (your routing rules, CODEOWNERS, the last change to the line, then
whoever is on triage, always with the reason), **mark down** (one browser in
a loop, a development-only dependency, your own rules; back when it changes)
and **tell** (the reporter where they wrote; whoever is on triage, in Today,
when it's urgent).

The inbox is sorted by people reached, then security, then reports. One key
per decision: `1` accept (a team task with the evidence as its description),
`2` decline (with a reason the askers are told), `3` duplicate (the askers
move onto the original), `H` snooze, `G` give to an agent, `A` change owner,
`C` new report, `J` `K` move, `/` search. When the task is done, everyone who
asked is told where they asked.

Carries **Tasks** (`plugin.json`). Uses, when installed, never carries:
**Incidents** (Declare calls `incidents_declare` with the agreed arguments),
**Coding agent** (Give to Coding agent calls `coding_start` with the task),
**Release notes** (it tells askers when the work ships; then Triage leaves
them to it), **Dependency updates** (a Dependabot item offers it) and
**Sprints** (reads Triage's tasks by `source`; Triage reads Sprints' days
away).

## How it works

| Part | What it is |
| --- | --- |
| Tables | `triage_settings` (one row), `triage_report` (one thing said in one place; id uuid5(door, source id), so a re-read never files twice; `received_at` is when it was said, `created_at` when it was filed), `triage_item` (one problem, `T-<number>`), `triage_event` (Activity), `triage_rule` (routing and mark-down), `triage_correction` (a person overriding the Lemma, sent to the Decisions API as examples), `triage_form` (the report form, opened to visitors by the app), `triage_known` (what the team published; marked Public by the app), `triage_sample_row`. All team-wide (no RLS). Carries the contract's `ask`, `away`, `task`, `project` and `needs_you` byte for byte. |
| Functions | `report_add`, `lookup`, `on_report`, `on_form`, `on_github`, `on_slack`, `poll`, `reach`, `read` + `read_save`, `decide`, `on_task`, `tell`, `publish_known`, `unpublish_known`, `join_known`, `needs_you`, `setup_save`, `away`, `memory`, `sample_data` (all `triage_`). What several share lives once in `bin/shared/` (`common`: ids, SQL, settings, Activity, who's on triage; `pipeline`: the six steps, owners, reach, telling) and is copied in by `bin/common.py` (`--check` fails on drift). Grants: `bin/grants.sh`. |
| Agent | `triage_reader`: reads one item; structured output `summary`, `evidence[]` (source, asked, answer, state checked / nothing_found / not_checked, url), `paths[]`, `fix_hint`. Every entry has an answer; every source it lacks is `not_checked` with why. It never acts. `triage_read_save` adds any missing source (logs, an unconnected Sentry or PostHog) as not checked. |
| Workflows and schedules | Bundled: `triage-report-added` (DATASTORE INSERT on `triage_report`), `triage-task-changed` (UPDATE on `task` where `source` is triage and `status` changed), `triage-poll` (TIME, every 15 minutes). Workflows the app starts schedules for, as the person: `triage-github-<event>` (issues, issue comments, Dependabot, code scanning, secret scanning), `triage-slack` (the Slack channel trigger), `triage-form-added` (with `include_outside_rows`), `triage-needs-you` (each person in the rotation, every 15 minutes). `triage-read` runs the reader (a FORM submitted at once, the AGENT step, the save). |
| App | `triage`: `/` the inbox (and `/accepted`, `/down`, `/declined`) with the detail pane; `/i/<n>` the case file; `/doors`; `/owners` (rules, rotation, away, GitHub and Slack handles); `/setup`. New report is a sheet (`C`). |
| Memory | `.lemma/agents-block.md` (200 characters with markers) and `.lemma/guide.md`, written by `triage_memory` from set-up: file with `triage_report_add` (quote it, link it), check `triage_lookup`, never decide for the team, questions stay questions. |

### What only a person can do

A function holds grants only on its own bundle's parts, and no grant holds
`schedule.create`, a table's public rows, a web widget, a table's
visibility, opening a function to contacts, or contact outreach. So the app
does these as the person (`src/wire.ts`), each step read back:

- at set-up and when Doors changes: the GitHub and Slack schedules, and
  each rotation member's own Today refresh (made when they open Triage);
- turning the form on: `triage_form` opened to visitors (`PUT
  …/public-rows`), the Lemma's web widget (`answer: anyone`: a widget whose
  chat is off is "not available" and takes no rows), the `triage-form-added`
  trigger with `include_outside_rows` (a bundle can't carry that field, and
  without it every visitor's row is dropped), `triage_known` marked Public,
  and `triage_join_known` opened to contacts for the chat beside the form;
- writing to someone who used the form when their item is fixed or
  declined: contact outreach from the Lemma's mailbox, by the member (a
  function can't; Today gives the decider an `answer` item for it);
- Declare (`incidents_declare`), Give to Coding agent (`coding_start`) and
  Dependency updates: the app calls the other plugin as the person;
- which of those plugins exist, and Sprints' days away (`sprints_away`,
  read only when that table exists), are kept in `triage_settings` for the
  functions, which can't look. Who's on triage skips the union of the shared
  `away` and Sprints' days.

## The five checks (lemma-platform `origin/main`)

1. **Email to a form reporter from a function: no.** The supported route is
   contact outreach (`POST /pods/{pod}/contacts/{id}/outreach`, `contact.message`,
   members only; no grant can hold it), to an email the contact has proven.
   Built: the app writes to them as the member ("Tell 2 who used the form" on
   the case file, and Today's `answer` item). A host-token contact with no
   proven email can't be emailed; the screen says so.
2. **A visitor's chat calling `triage_lookup`: only if opened to contacts**
   (`PUT /functions/{name}/contacts`), and it would expose internal items.
   Built: the chat reads the Public `triage_known` itself (its POD read tools
   see only Public tables) and may call `triage_join_known`, opened to
   contacts, which only adds the visitor to a published known issue.
3. **Can the app create a web widget: yes**, for editors and admins
   (`POST /pods/{pod}/web-widgets`). The hosted page takes only `?table=`:
   its title, intro and thanks can't be set; a team's own page can
   (`data-lemma-title`, `-intro`, `-thanks`). Doors says so.
4. **`table.public_rows.open`**: `PUT /pods/{pod}/datastore/tables/{t}/public-rows`
   with `{audience, columns}`. A visitor's insert fires DATASTORE events only
   for a schedule with `include_outside_rows`; the event carries
   `row_author` (`contact:<id>` or `visitor`), never an email. Files land in
   `/forms/triage_form`.
5. **Sentry's list fields: not in the repository.** Its Composio operations
   are fetched live and no Sentry account is connected here, so
   `triage_poll` reads `userCount`, `count`, `firstSeen`, `lastSeen`,
   `permalink`, `shortId`, `priority`, `substatus` and `metadata` as Sentry's
   own API documents them, unverified.

## What was measured

- `uv run --no-project python _contract/lint.py`: clean for triage. (The one
  failure left, `_kit/src/contract.ts` stale, comes from new contract tables:
  `ask`, `away` and others' `repository`, `pull_request`; the kit repack is
  another session's.)
- `_build/assemble.py --install triage`: Tasks + Triage, the app built.
- `bin/check.py`: 37 unit checks pass (issue forms, CODEOWNERS, alerts and
  Slack messages as reports, reach and priority, mark-downs coming back,
  the rotation with days away, the contract's ask and away ids, telling,
  Today's items, the sample's consistency, shared code word for word).
- The app builds; the demo builds and runs with no page errors and no
  sideways scroll at 1440 and 375, light and dark; its keys (1 2 3 H G A C J
  K /) were driven in it.
- **Installed server-side into a scratch Lemma on a hosted Lemma** (quiet mode
  on, so nothing was posted outside), and walked by CLI and API:
  - set-up saved, the memory block written;
  - `triage_report_add` filed T-1; a second report in other words merged
    into it (the Decisions API, 95% sure); a question was left alone; an
    unrelated bug became T-2;
  - accept made a team task (source triage, `/i/1`, the first person's
    words as its quote, the evidence as its description) and set `task_id`
    on the asks; marking the task done fired `triage-task-changed`: the item
    done, the member's ask told, the email ask left `shipped`;
  - decline kept the reason;
  - GitHub webhooks run through `triage_on_github`: an issue form read field
    by field (T-3), a "+1" added an asker, a Dependabot alert filed T-4 (high,
    runtime, patch 4.17.21), an unwatched repository ignored;
  - the form: as the member, the table opened to anyone, the widget made, the
    trigger made with `include_outside_rows`, `triage_known` marked Public,
    `triage_join_known` opened to contacts; then as people outside, an
    anonymous answer and one signed in with a host token were both filed by
    the trigger (`row_author` named the contact), the signed-in one merged
    into T-1, and the Public known issue was readable;
  - `triage_reader` read T-1 through `triage-read`: the structured output
    reached `triage_read_save`, every unconnected source named as not checked
    with why;
  - `lookup`, `publish_known`, `away` (three day rows), `tell` (dry run:
    who, and where), `reach`, `needs_you`, and the sample morning loaded (13
    items, Today's three `decide` items) and cleared.

## What was not verified

- **No test accounts were connected**: no GitHub, Slack, Sentry or PostHog
  account on the scratch Lemma. So no real webhook delivery, no GitHub
  comment or close, no Slack reply, no CODEOWNERS or commit read, no Sentry
  or PostHog poll, no Sentry resolve. The payloads were run through the
  functions by hand, and Sentry, PostHog, Slack channels and security alerts
  are shown on the sample morning.
- The GitHub, Slack and needs-you schedules the app makes, and the app itself
  on a hosted Lemma (only its demo was driven).
- Contact outreach to a form reporter (no proven email in the walk).
- Give to the Lemma: Triage sets the task's agent, but Tasks' own hand-over
  failed on that server (`tasks_on_task`: "Object of type Unset is not JSON
  serializable" from `workflows.create_run` with no `about`; Triage's reader
  passes `about` and works). That is a Tasks fix.
- Slack's channel trigger (lemma-platform#1245), Dependabot events (#1246)
  and code and secret scanning (Triage's GitHub fix on #1246) are not on
  main: Doors says so, and the poll reads what GitHub allows.

## Out of v1

- The Board (B): a later segment.
- Monitoring alerts from Datadog, Grafana or PagerDuty: no signed webhook a
  tool can post to; one change shared with Incidents.
- Support tools (Intercom, Zendesk, Freshdesk): later, or through Support inbox.
- Syncing with Linear or Jira.
- Sentry's own suspect commit: its connector has none; Triage names the last
  change to the line, from GitHub, and says so.
- Writing to GitHub alerts (dismiss, assign to Copilot): read only.
- Merging duplicates on its own when unsure: never.
- A Slack reaction or shortcut "report this": no such trigger.

## Try it

`node _kit/bin/demo.mjs triage` builds `.lemma/demo/` from
`.lemma/shots/fixtures/`, which `bin/demo-fixtures.py` writes offline from
`triage_sample_data`'s own `build`: T-43 to T-50 on the morning of the
canvas, and older items in Accepted and Declined.

```bash
# from the repository root
uv run --no-project python _build/install.py triage --lemma <lemma-id> --var triage_slug=<free name> --var tasks_slug=<free name>
```

Then whoever opens Triage first sets it up (or loads the sample morning).
Turning the form on needs edit access in the Lemma. `bin/lemma` is the
`lemma` CLI bound to one Lemma (`LEMMA_SERVER`, `LEMMA_ORG_ID`,
`LEMMA_POD_ID`); after any change, from the repository root:
`uv run --no-project python _build/assemble.py --install triage`, then the
lint.
