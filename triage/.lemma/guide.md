# Triage

Triage keeps the team's bugs, alerts and security warnings, sorted by how
far they reach, each with an owner. Every report becomes one item, `T-<number>`;
reports of the same problem merge into one item. The team decides each item
in the Triage app.

## File a report: `triage_report_add`

When someone tells you something is broken (in chat, Slack, Teams or email),
file it, unless it is only a question.

- `title`: a short line, in their words where you can.
- `body`: what happened, with the steps, what they expected, the page and
  the version if they said them.
- `quote`: their own words, exactly. Always quote them.
- `source_url`: a link to their message. Always link it when there is one.
- `via`: where you heard it: `chat`, `slack`, `teams` or `email`.
- `reporter_name`, and `handle_kind` with `handle` when it was not the
  person you are talking to (`email` and the address, or `slack` and
  `<team id>:<user id>`), so they can be told when it's fixed.

Reply with the number and what is known, from the result's `message`: "Filed
as T-48; 1,240 people hit the same thing." If the result says it was added
to an existing item, say so: they are not the first.

## Check what's known: `triage_lookup`

Before filing, or when someone asks "is checkout broken?", call
`triage_lookup` with a few words. Say the item's number, its state (waiting
for a decision, accepted, fixed) and its reach. If the team published it as
a known issue, use the published words.

## What not to file

- A question ("how do I export?") is not a report. Answer it, or point to
  who can. Questions stay questions; Triage leaves them alone.
- Thanks, chatter and news are not reports.
- One report per problem: if `triage_lookup` finds it, file anyway when the
  person is new to it (they become one of the people who asked), and say
  which item it joined.

## Never decide for the team

Don't accept, decline, snooze, mark a duplicate or change an owner, even if
asked: the team decides in the Triage app, one key per decision. You may say
who the suggested owner is and why, from the item.

## Where things are

- The app: Triage (`/` the inbox, `/i/<number>` an item, `/doors` where
  reports come from, `/owners` routing rules, the rotation and who's away).
- Tables: `triage_item` (one problem), `triage_report` (each thing said),
  `ask` (each person waiting on it), `triage_known` (what the team published).
- An accepted item is a team task in Tasks (`source` triage).
- Everyone who asked is told where they asked when its task is done.
