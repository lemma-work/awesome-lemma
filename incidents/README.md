# Incidents

An incident's timeline gathered as it happens, and the write-up drafted after.

Declare an incident from the app or by asking your Lemma in Slack ("@Lemma
declare checkout 502s"). Incidents opens a channel for it, pins a header the
Lemma keeps current, and tells #incidents. The timeline fills from the
channel, GitHub and Triage; the Lemma names a likely cause with its evidence,
what it ruled out and what it couldn't check; it drafts each update for the
lead to send. On resolve it drafts the write-up: every claim links to the
event behind it, the claims nothing backs are flagged, and follow-ups become
team tasks.

Carries **Tasks** (`plugin.json`), for follow-ups. Listens for **Triage**: a
Triage item's Declare calls `incidents_declare` with `source: triage`, its id,
link and evidence. Triage joins `carries` once it ships.

## How it works

| Part | What it is |
| --- | --- |
| Tables | `incidents_settings` (one row), `incidents_incident`, `incidents_event` (id = uuid5 of incident, source, source id, so gathering twice never duplicates), `incidents_change` (the "what changed" ledger, kept with no incident open), `incidents_hypothesis`, `incidents_update`, `incidents_flag`, `incidents_sample_row`. All team-wide (no RLS). Carries the contract's `task`, `needs_you` and `project` byte for byte. |
| Functions | `setup_save`, `declare`, `on_message`, `on_github`, `gather`, `refresh`, `investigate` + `investigate_save`, `scribe_save`, `set`, `draft_update`, `send_update`, `resolve` + `writeup_save`, `followup`, `tick`, `needs_you`, `memory`, `sample_data` (all `incidents_`). Shared helpers live once in `bin/common.py` and are copied in (`bin/common.py --check`). Grants: `bin/grants.sh`. |
| Agents | `incidents_investigator` (structured: text, confidence, evidence, ruled_out, not_checked; must name every source it lacks; may say inconclusive; reads only). `incidents_writer` (sections of one-sentence claims, each with the event ids behind it; no figure an event doesn't give). `incidents_scribe` (the Now line and status update drafts, from the events only). |
| Workflows | `incidents-investigate`, `incidents-writeup`, `incidents-scribe` (MANUAL with a FORM the function submits at once, then AGENT, then a save FUNCTION, as Tasks' `tasks-agent`); `incidents-tick`; `incidents-on-message` (Slack channel trigger); `incidents-on-push`, `-on-pull-request`, `-on-workflow-run`, `-on-release` (GitHub). |
| Schedules | None in the bundle. The app makes them as the person (below): `incidents-tick` (TIME, every 15 min), one WEBHOOK schedule per GitHub event, and `incidents-channel-<n>` per incident. |
| App | `incidents`: `/` active (and write-ups to review), `/followups`, `/resolved`, `/i/<n>` the incident, `/i/<n>/writeup`, `/setup`. |
| Memory | `.lemma/agents-block.md` (145 characters) and `.lemma/guide.md`, written by `incidents_memory` from set-up. The guide tells the assistant to use `request_approval` before `incidents_send_update`, so the lead's button in Slack is the Send. |

### Connecting a channel, and schedules

The Lemma's bot hears a Slack channel (and a channel message can start a
schedule) only once the channel is in its surface's `config.channels`, which
match an exact id or name. One helper does it, `connect_channel` (in
`bin/common.py`; the app's twin is `src/wire.ts`): read the Slack surface,
append `{channel_id, channel_name}`, `PATCH /pods/{pod}/surfaces/{name}`.

**From a function this is refused, by design of the grant model.** The PATCH
route asks for `agent.update` on the Lemma itself (`require_action` with the
pod as the resource). A grant on the Lemma (resource `/`) may hold only
`channel.notify_self` and `agent.execute` (`RESOURCE_ACTIONS[POD]` in
`core/authorization/resource_actions.py`), and a named function is checked
on the grant-and-person intersection. Reading the surface needs `agent.read`
on the Lemma, also ungrantable. Likewise no grant holds `schedule.create`.
So `incidents_declare` tries both and records `channel_connected: false` /
no `channel_schedule_id`; then the app does both **as the person**: right
after Declare in the app, and when any member opens an incident that isn't
connected (an incident declared from Slack). Until someone opens it, the
15-minute tick reads the channel through the Slack connector (the bot made
the channel, so it can read it), so nothing is lost, only late. A platform
change would remove the gap: a surface route that matches a name prefix
(`inc-`), or `agent.update` made grantable on the Lemma.

The Slack channel trigger itself (`slack_channel_message`) is
lemma-platform#1245, not merged: until then the schedule is refused (or never
fires) and the screen says "Not live yet". GitHub `deployment_status` is not
on main either: deploys come from the deploy workflow's `workflow_run`;
`incidents_on_github` already handles `deployment_status`, and an
`incidents-on-deployment-status` workflow is the one thing to add.

Email goes through the `resend` connector (the Lemma's own mailbox,
`RESEND_SEND_EMAIL`) from set-up's `email_from`: Resend sends only from a
verified domain, and a sending-only key can't list them. Without a mailbox or
a sender, the update goes to Slack only and the result says why.

Writing is an agent's job. The Decisions API answers only closed questions
(a choice, yes or no, a scale) and refuses free text, so the Now line and a
status update are written by `incidents_scribe` through the `incidents-scribe`
workflow, kept by `incidents_scribe_save` about a minute later; the review's
flags stay a Decisions call (which claims does an event back: a closed
multiple choice). An open incident's page reloads every 20 seconds, so they
show up without a refresh.

## What was measured

- `uv run --no-project python _contract/lint.py`: clean for incidents.
- `_build/assemble.py --install incidents`: assembles with Tasks, builds the app.
- `bin/check.py`: 28 unit checks pass (slugs, Slack messages and GitHub
  webhooks as events, the review's flag rules, Today's items, and the sample's
  citations all pointing at its own events).
- The app builds (`npm run build`), and the demo builds and runs with no page
  errors and no sideways scroll at 1440 and 375, light and dark
  (`.lemma/shots/`).
- **A live run, end to end, on a scratch Lemma** with a real Slack workspace
  and a throwaway GitHub repository. Installed server-side
  (`_build/install.py`), set up, then:
  - GitHub: a merged pull request, its push and its deploy workflow run
    reached `incidents_change` within seconds through the four WEBHOOK
    schedules (made as the person; the trigger comes from each workflow's
    EVENT start, and the platform adds the installation).
  - Declare: made INC-1, opened its channel, set the topic, invited the lead
    (found by email), posted the header, and announced it in the set-up's
    channel.
  - The investigator named the merged change as the likely cause, from the
    diff and the 8 seconds between its deploy and the first sign, and said
    that no error telemetry was connected; it was posted to the channel.
  - Two updates were drafted by the scribe, sent by the lead, and posted to
    the incident's channel and the announce channel.
  - Status set to Fixing; a revert merged and deployed landed on the open
    incident's timeline live.
  - Resolve: the writer drafted the write-up into `/incidents/INC-1.md`,
    every claim linked to its event (commits, pull requests, deploy runs),
    saying where it had no count; the review flagged five claims with no
    event behind them.

## What was not verified

- Email: the test mailbox's Resend account refused every operation (a 422
  from the connector, even listing domains), so no email went out. The code
  path sends `from`, `to`, `subject`, `text` as Resend's operation asks.
- Pins: the test Slack account's token lacked `pins:read` and `pins:write`
  (the catalog asks for both; that account was connected before), so the
  header wasn't pinned and pins weren't read. Both fail quietly; reconnect
  Slack to grant them.
- Messages from people: the test channel had only the Lemma's own posts,
  which are skipped on purpose, so a person's message becoming an event
  was checked by `bin/check.py`, not live.
- `connect_channel` and the channel's message schedule from the app as a
  person (the live run used the CLI; the app needs a sign-in in the browser),
  and the Slack trigger itself (lemma-platform#1245, not merged).
- `@Lemma` in Slack (the scratch Lemma had no Slack bot of its own).

## Out of v1

- a public status page
- live call notes (only after the call, through Fireflies, Granola, Zoom or
  Meet when connected; not in v1 either)
- Microsoft Teams
- paging and on-call
- a `/inc` slash command
- alerts from Datadog, PagerDuty or Grafana (they arrive through Triage, or
  not at all)
- export to Notion or Confluence

## Try it

`node _kit/bin/demo.mjs incidents` builds `.lemma/demo/` from
`.lemma/shots/fixtures/`, which `bin/demo-fixtures.py` writes offline from
`incidents_sample_data`'s own `build`: INC-14 open on checkout-api, INC-11 to
INC-13 resolved. Resolve INC-14 in the demo to see its write-up drafted.
