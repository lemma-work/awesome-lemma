# User interviews

Studies the team runs by talking to people: who fits, the invites, the calls, and what each call found.

## What it holds
- `interviews_study`: one study: `question`, `want` (calls), `feature_ids`, `fit_sentence` and how it was read (`fit_read`), `state` (draft, running, done, archived).
- `interviews_person`: one person in one study, by handle: `why` they fit, `stage` (fits, drafted, invited, booked, done, no_show, declined, opted_out, skipped), `rests_until` and `rest_rule` (the contact rules), the call (`call_at`), findings `kept`.
- `interviews_finding`: a kept finding's place in a study; its id is the `feedback` row's id.
- `interviews_proposal`: findings proposed from a call, the interviewer's own until kept.
- Kept findings are shared `feedback` rows (`plugin` user-interviews, `source` interview or note, `at_seconds`), filed under `feature`.

## From chat
- What a study found: `interviews_findings` with `study_id` (features by people, blockers, quotes with their call and minute).
- Who fits a study, again: `interviews_pool` with `study_id`.
- Mark someone: `interviews_mark` with `person_id` and `what` (no_show, declined, opted_out, thanked, override, skip, restore).
- Open the app `interviews` at `/s/<study id>` (a study), `/s/<study id>/findings`, `/s/<study id>/p/<person id>` (a call).

## Never
- Never send an invite: a person presses Send in the app, one draft at a time.
- Never invite someone resting under the contact rules unless a person overrides it, and never anyone who opted out.
- Never offer money, gifts or payment for a call.
- Never write a finding to `feedback` yourself: the interviewer keeps each one in the app.
