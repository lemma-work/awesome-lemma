# PR review

What the PR review plugin holds and how to use it from a conversation. Its
set-up rewrites everything between the markers around this text; the team's
own notes about reviewing go below them and stay.

## What it holds

- `pull_request`: every open and recent pull request in the watched
  repositories (`repository`), with `waits_on` (a member's user id, `nobody`
  or `author`), `waits_for` (review, merge, fix, round), `verdict` (clean,
  changes, needs_person), `review_state` and `merge_state`. Code decides the
  verdict and who it waits on, never a model.
- `prr_round`: one per pushed commit, with the summary, the ledger (every
  rule in scope as passed, broken or not checked, and why) and what changed.
- `prr_finding`: findings on their lines, the same row on every push (open,
  fixed, dismissed, wrong). `prr_rule`: the rules (proposed, active, paused,
  retired) with where each came from.
- The apps: `pull-requests` (a pull request opens at `/pr/<owner>/<repo>/<number>`)
  and `rules`.

## From chat

- **What waits on me**: query `pull_request` where `state` is open and
  `waits_on` is the person's user id; say `waits_for` in words ("your review",
  "ready for you to merge", "returned to you to fix").
- **Why did it fail**: read the newest `prr_round` of that pull request
  (`status` done): its `ledger` entries with `state` broken or not_checked,
  and its open findings, each with `path`, `line` and the rule's text.
- **Review it again**: `prr_intake` with `event` app, `repo`, `number`,
  `queue` yes.
- **Fix it**: `prr_fix_task` with `finding_id` makes a team task (source
  pr-review); `assign_to` coding_agent hands it to Coding agent.
- **Dismiss a finding**: `prr_decide_finding` with `decision`
  not_worth_fixing, wrong or reopen, and a short `note`. Only when the person
  says so.
- **Add a rule**: write a `prr_rule` row with `text` (one sentence a reviewer
  can check from a diff), `scope` (globs, or empty for every file),
  `severity` (must_fix, should_fix, nit), `source_kind` typed, `state`
  proposed. A person accepts it in the Rules app; never make one active
  yourself.
- **Hold a merge**: `prr_hold` with `pull_request_id` and `hold` true (false
  lets it go). **Merge one**: `prr_merge` with `mode` person, only when the
  person asks; it waits while a rule is broken.
- **Send it back**: `prr_send_back` posts one review as the Lemma's bot, only
  when Settings have the bot posting; otherwise the person sends it from the
  app as themselves.

## Never

- Never post on GitHub, approve, merge or push yourself: the functions above
  do, and only the person decides to.
- Never change the merge settings, a repository's merge mode or a rule's
  state unless the person asks; say what it changes first.
- Never say a rule passed when the ledger says not checked.
