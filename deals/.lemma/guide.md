# Deal tracker

What Deal tracker holds and how to use it from a conversation. Its set-up
rewrites everything between the markers around this text; the team's own
notes about deals go below them and stay.

## Where deals live

- `deal`: every deal the team has, team-wide. `name` (what is being bought),
  `company_name` and `company_id`, `people` ([{handle, name}], the main
  contact first), `owner_name`, `stage` and `status` (open, won, lost),
  `amount` and `currency`, `close_date`, `next_step`, `lost_reason`,
  `source` (mail, meeting, spreadsheet, person, sample) and `source_id`.
- The team's stages, in order, each with what reaching it means:
  `deals_stage`. The team's currency and review day: `deals_settings`.
- What happened to a deal: `deals_history` (field, from, to, who, how).
  The team's notes on it: `deals_note`.
- The weekly review: `deals_review`, one row a week, with what was counted
  and the summary written from it.
- The app is `deals`: a deal opens at `/<deal id>`, what waits for the
  person at `/waiting`, the weekly review at `/review`.

## Changes are proposals

Deal tracker reads each person's new conversations and meeting notes with
someone at a company. When what was said changes a deal (a new deal, a stage,
an amount, a close date, a next step, a loss), it proposes the change with the
sentence it came from (`deals_change`, state `proposed`). A proposal waits
for the person whose conversation it was, usually the deal's owner, and
nothing changes the deal until they keep it. What they dismiss teaches the
next read. A proposal's sentence is private to that person: never quote one
to anyone else.

## From chat

- **Where the pipeline stands**: run `deals_review` with `{"mode": "count"}`:
  what moved in the last seven days, what went quiet, the open pipeline by
  stage, what closes in the next two weeks. Say the figures as given.
- **About one deal or company**: read `deal` (match `name` or
  `company_name`), then its `deals_history` and `deals_note`. The asker's own
  conversations with its people are in `conversation` (by
  `counterpart_handle`), their meetings in `meeting`.
- **What is waiting for me**: the asker's own `deals_change` rows with state
  `proposed`, each with its `quote`.
- **Change a deal** only when someone asks you to, with `deals_save`:
  `{"action": "edit", "deal_id": ..., "fields": {"stage": "Won"}}` (also
  amount, currency, close_date, next_step, name, lost_reason). It keeps the
  history; never write `deal` rows yourself.
- **Add a deal** when asked: `deals_save` with `{"action": "create",
  "fields": {"name", "company_name", "stage", "amount", "currency",
  "close_date", "next_step", "people": [{"handle", "name"}]}}`.
- **Keep or dismiss a proposal** only on the person's word: `deals_save`
  with `{"action": "keep" | "dismiss", "change_id": ...}`.
