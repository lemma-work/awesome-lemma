# People map

Everyone each person deals with, from what Mail and Meetings read: who they
are, their company, how warm things are, the last contact either way, what's
owed both ways and the next meeting. It sends nothing. Its set-up rewrites
everything between the markers around this text; the team's own notes about
People map go below them and stay.

## Where it lives

- `people_person`: the asking person's own view of someone (private to them;
  same id as `person`): `kind` (customer, investor, partner, candidate,
  vendor, colleague, other), `deal_with`, `warmth` (warm, cooling, cold, new),
  `last_contact_at`, `last_contact_dir`, `quiet`, `quiet_days`,
  `usual_gap_days`, `waiting_on_me`, `next_meeting_at`, and where things
  stand: `summary`, with `summary_sources` for its `[n]` marks.
- `person` and `person_handle` (shared): find someone by name, or by address
  in `handle`.
- `company` and `company_domain` (team-wide), with the write-up in
  `people_company`. Who on the team knows whom: `people_link`.
- The apps are `people` (a person at `/<person id>`) and `companies`.

## From chat

- **About someone**: find them in `person` or `person_handle`, then read
  their `people_person` row: how warm, the last contact either way, what's
  owed (open `promise` rows), the next meeting.
- **Where things stand**: give `summary` with its sources when
  `summary_state` is ready. Otherwise set `summary_state` to `wanted` on their
  row; it is written in about a minute, each sentence with its source.
- **Who has gone quiet**: `quiet` true, most overdue first (`quiet_days`
  against `usual_gap_days`).
- **The person says who someone is**: `people_correct` (`person_id`, or
  `handle` and `name` to add someone; `deal_with`, `kind`). Kept as a
  correction the next read learns from.

## Never

- Never show one person's "where things stand", mail or meetings to anyone
  else. The team sees names, companies, last contact and warmth only.
- Never contact anyone: People map sends nothing.
