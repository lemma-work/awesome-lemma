# Incidents

What the Incidents plugin holds and how to use it from a conversation,
mostly in Slack. Its set-up rewrites everything between the markers around
this text; the team's own notes about incidents go below them and stay.

## What it holds

- `incidents_incident`: one row per incident, INC-`number`. `status`
  declared, investigating, fixing, monitoring, resolved; `severity` a key of
  `incidents_settings.severities` (sev1 to sev3 unless the team renamed
  them); lead, comms, `responders`; `channel_name`; `summary` (Now);
  `update_due_at`; `writeup_state` none, drafting, to_review, reviewed.
- `incidents_event`: the timeline. `incidents_change`: what changed in the
  watched repositories. `incidents_hypothesis`: likely causes, with evidence,
  ruled out and not checked. `incidents_update`: updates, drafted then sent.
  `incidents_flag`: write-up claims nothing backs.
- Write-ups are files: `/incidents/INC-<n>.md`. Follow-ups are team tasks
  (`task`, `source` incidents). The app is `incidents`: `/`, `/i/<n>`,
  `/i/<n>/writeup`.

## From chat

- **"declare checkout 502s"**: `incidents_declare` with `title`, and
  `severity`, `service`, `impact` if said. The person asking leads unless
  they name someone. Say the channel it opened.
- **"sev1"**, **"we're fixing"**, **"I'm lead"**, **"Ines is comms"**:
  `incidents_set` with `incident` (INC-n, or the channel you are in) and
  `severity`, `status`, `lead_me`, or `comms_name`/`comms_user_id`.
- **"what changed?"**: read `incidents_change` for the hour before the
  incident started, and run `incidents_investigate` for a likely cause.
- **"catch me up"**: `incidents_gather` with the incident, then answer from
  its `summary` and newest events.
- **"draft an update"**: `incidents_draft_update`, then show the draft.
- **Sending an update**: only the lead sends. Call `request_approval` with
  the full text and where it goes (the channel, #incidents, the email list),
  and only on their yes call `incidents_send_update` (with `body` if they
  changed it). Never send on anyone else's word.
- **"hand the revert to the coding agent"**: `incidents_followup` with
  `revert: true` and `change` (#2291). It becomes a task on an agent; say so.
- **A follow-up**: `incidents_followup` with `title` and who it is on.
- **"resolve"**: `incidents_resolve` (with `note`, how it was fixed). The
  write-up is drafted after; the lead reviews it in the app.

## Never

- Never send an update, resolve, or change severity on your own: a person
  asks, and sending needs the lead's approval.
- Never state a cause, a number of people or an amount that no event gives.
  A source that isn't connected is "not checked", never "fine".
- Never post in an incident channel except through these functions.
- There is no status page, no paging, no `/inc` command and no live call
  notes: say so if asked.
