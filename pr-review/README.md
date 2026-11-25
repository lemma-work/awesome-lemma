# PR review

**Every pull request read against your team's own rules before anyone reviews
it, and the small clean ones merged without anyone having to.**

PR review reads the rules a team already wrote down (AGENTS.md, CLAUDE.md,
REVIEW.md, CONTRIBUTING.md, `.github/copilot-instructions.md`,
`.github/instructions/*.instructions.md`, `.cursor/BUGBOT.md`) and proposes the
ones its reviewers keep asking for in review comments. Every push gets a
review round at its head commit: a ledger with every rule in scope passed,
broken or not checked (and why), findings on their lines naming the rule they
break, a plain summary. A finding is the same row on every push, so it is
marked fixed in the commit that fixed it, a dismissed one is never asked
again, and nothing new is raised on lines the push didn't touch. The inbox
groups pull requests by who each waits on, decided by code. Small clean ones
can merge by themselves.

Line dev, position 27. Carries Tasks (`plugin.json`): "Fix it" makes a team
`task` with `source` pr-review, which Coding agent picks up when it is
installed and a person takes when it isn't. Adds two shared tables,
`repository` and `pull_request` (`_contract/tables`), written only by PR
review: Release notes reads `summary` and `linked_issues`; Dependency updates
and Coding agent read `review_state` and `verdict` by `key`.

Lifted from the Factory pod: intake, risk paths, rounds, findings matched by
fingerprint, the settle verdict guard, the reviewer and scout agents. Kept:
code decides queueing, risk, conflicts, the ledger, the verdict, who it waits
on and every merge condition; the model only reads.

## How it works

| Part | What it does |
| --- | --- |
| `prr-on-pull-request` (WEBHOOK `pull_request`, made at set-up) | `prr_intake`: the pull request to a `pull_request` row (risk from risky paths and size, lockfiles not counted; who wrote it; the issues it closes), and a round queued on opened, synchronize, reopened and ready_for_review; closed settles it (`merged_by_itself` when it was merging) |
| `prr-review` (started by intake) | `prr_begin_round` (claims one live round per commit; the rules in scope, earlier findings, the lines this push touched by `repos_compare_commits`, cross-PR migration numbers and shared files) → `prr_reviewer` agent in a checkout at the head sha → `prr_save_round` (checks the answer's shape, fingerprint matching, the ledger, the verdict) → `prr_settle` |
| `prr_settle` | verdict by code (an open must-fix finding: changes; high risk or an outside author: needs a person; else clean), who it waits on and for what, merge eligibility, and on GitHub as the bot only: the Lemma check, approve-when-clean and its withdrawal, the summary comment or the findings as a review |
| `prr-on-review` (WEBHOOK `pull_request_review`) | a person's approval or dismissal: settle again |
| `prr-on-check-suite` (WEBHOOK `check_suite` completed) | settle every open pull request at that commit: the moment a clean one becomes mergeable |
| `prr-sync` (TIME, every 15 minutes, in the bundle) | `prr_sync`: missed webhooks, stuck rounds failed, merges whose wait has passed through `prr_merge` |
| `prr-setup` (per repository, from set-up) | `prr_read_rules` (rule files at the default branch with numbered lines, the last 60 merged pull requests' review comments) → `prr_scout` → `prr_save_rules` (code checks each source: a file rule's words must be at its `path:line`, a comment rule needs two pull requests' comments quoted word for word; all `proposed` unless set-up accepted the file rules) → `prr_memory` |
| `prr-needs-you` (each member's DATASTORE trigger on `pull_request`, made by the app) | `prr_needs_you`: "Review this" and "Merge this" (`decide`) in that member's Today |
| From the app | `prr_send_back` (one REQUEST_CHANGES review as the bot), `prr_fix_task`, `prr_decide_finding` (not worth fixing, wrong, reopen), `prr_hold`, `prr_merge` (`mode` person: the one-press merge, as the person), `prr_setup_save`, `prr_sample_data` |

Merging by itself (per repository `merge_mode`: off, watch, merge). Every
condition is checked by code on the latest commit and GitHub's live state
(`merge_conditions` in `bin/common.py`): every changed file inside the
allowed paths; at most N lines and M files, lockfiles and generated files not
counted; every rule in scope passed and none not checked; no open finding of
any severity; no risky path; the author on the team, or Dependency updates (a
bot on `lemma/deps-*`, or dependabot or renovate); every GitHub check green
and GitHub says it can merge; never a change to a rule file, `CODEOWNERS` or
`.github/**`; a round that didn't finish is not clean; not held and no
`lemma-hold` label; under the daily cap. Watch records `would_merge` in
`prr_merge_log`. Merge sets `merging` with a wait (10 minutes by default) after
the last push; `prr_sync` merges when it passes, checking everything again,
by turning on GitHub's auto-merge (GraphQL `enablePullRequestAutoMerge`),
adding it to the merge queue (`enqueuePullRequest`) or squashing, as the bot.
Optionally the bot approves first when the repository requires approvals.

**Who posts.** Every bot action (the check, a bot review, approve and dismiss,
merging) goes through one helper, `gh_app` (`bin/common.py`), which calls with
`act_as="app"` and records `ok`, `needs_platform` (an SDK without the keyword,
`APP_IDENTITY_UNAVAILABLE`, `APP_IDENTITY_FUNCTIONS_ONLY`), `no_permission`
(401, 403, 404) or `failed:<why>` on the round and in `prr_settings.platform`.
It never falls back to the person. Reads (`pulls_get`, `pulls_list_files`,
`repos_compare_commits`, checks, branch protection, rule files) run as the
run's person on the Lemma's shared connection (`github`, SHARED, as every
engineering plugin declares it). What is done in a person's name (sending
back, approving and merging as themselves) goes through a second connector,
`github-personal` (PER_MEMBER, optional): the app's calls from the browser and
`prr_merge`'s one-press merge. On the shared connection it would carry the
name of whoever shared it. A reviewer who hasn't connected their own GitHub
is asked to, and the bot path is untouched.

Tables: `prr_round`, `prr_finding`, `prr_rule`, `prr_risk_path`, `prr_member`,
`prr_settings`, `prr_merge_log` (all team-wide), and the shared `repository`
and `pull_request`. Ids: a pull request is `uuid5(PRR_NS, "owner/repo#n")`, a
repository `uuid5(PRR_NS, "repo:" + full_name.lower())`, the first round of a
commit `uuid5(PRR_NS, "round:<key>:<sha>")` (two webhooks for one push make
one round). Apps: `pull-requests` (the inbox, a pull request at
`/pr/<owner>/<repo>/<n>`, Settings with Merging) and `rules`.

Functions share one block, word for word (`bin/common.py`; run it after
editing, `--check` to compare). Grants are generated by `bin/grants.sh`. The
schedules the app makes are in `bin/app-schedules.json`, and
`prr_setup_save` returns the same list.

## Depends on the platform

- **lemma-platform #1248** (open, not deployed): `act_as="app"` so a function
  posts as the GitHub App's bot, and an AGENT step's `repository` and `ref`
  bindings so the reviewer starts in a checkout at the head sha. `prr-review`
  sets both; a platform without them ignores the keys (the step config
  doesn't forbid unknown fields), and the reviewer's instruction clones and
  checks out the commit itself, as Factory's does.
- **lemma-platform #1246** (not deployed): the App's `checks: write`, and the
  new permission accepted per installation. Until then the Lemma check shows
  `no_permission` or `needs_platform`.
- After #1246: a `check_run` WEBHOOK with `requested_action` for the check's
  Re-run button (not built).

Until both are deployed: rounds, the ledger, findings, the inbox and Today
work, and posting as the reviewer works from the app; the bot, the check,
approve-when-clean and merging by itself say "needs the platform update" and
do nothing.

## Not in v1

- A Slack summary.
- Rules or the merge policy from a file of our own (`.lemma/review.yml`): they
  live in the Lemma. Settings say admin-only; the functions don't check it
  yet.
- Custom classifiers, and a "same intent" check that keeps an approval across
  trivial pushes.
- Reverting a merge from the app.
- Read-only checkouts: the reviewer's instruction forbids pushing, and it
  never runs an outside author's code.
- Writing the rules back as REVIEW.md through a pull request.

## What was verified (25 Nov 2026)

Nothing has run on a Lemma yet. No install, no function run, no GitHub call,
no agent turn.

- Every function compiles (`python3 -m py_compile`), and pyflakes finds no
  undefined name.
- `bench/test_logic.py`, 26 plain-Python tests of the shared block with no
  server, pass (`uv run --no-project --with pytest python -m pytest
  pr-review/bench/test_logic.py`): globs and rule-file scope (nested files,
  `applyTo`), the merge gate on rule files, `CODEOWNERS` and `.github/**`,
  which lines a patch touched, fingerprint matching across pushes (fixed in a
  later commit, dismissed stays dismissed, nothing new on untouched lines, a
  file that left the pull request, a code finding that stopped), the ledger
  (broken by an open finding whatever the reviewer said; not checked when
  unanswered, not checkable or "broken" with no line), the verdict, risk,
  author kind, who it waits on, every merge condition one by one, GitHub's
  check and mergeable states, the reviewer's answer checked and capped, and
  `gh_app` never calling as the person.
- `_contract/lint.py`: pr-review's own parts pass (see the report for the
  repository-wide failures that aren't PR review's).

## Not verified

- Anything on a Lemma: the install, every workflow, the bundled TIME
  schedule, the WEBHOOK schedules, the per-member trigger with
  `rows: OWNER_READABLE` on `pull_request`, the importer accepting an AGENT
  step with `repository` and `ref`.
- Anything on GitHub. Each call is written to the connector's operation names
  and GitHub's REST parameters, not run: `pulls_get`, `pulls_list`,
  `pulls_list_files`, `pulls_list_reviews`, `pulls_create_review` (APPROVE,
  REQUEST_CHANGES, COMMENT with `comments[]`), `pulls_dismiss_review`,
  `pulls_merge`, `issues_create_comment`, `issues_update_comment`,
  `checks_create`, `checks_update`, `checks_list_for_ref`,
  `repos_get_combined_status_for_ref`, `repos_get_content`, `git_get_tree`,
  `repos_compare_commits`, `repos_get_branch_protection`, `repos_get`,
  `github_graphql_request` (merged pull requests' comments,
  `enablePullRequestAutoMerge`, `enqueuePullRequest`).
- Whether GitHub counts the bot's approval toward required reviews.
- The reviewer and scout agents' answers on a real pull request: the output
  shapes are checked by code, the quality isn't measured.
- The sample: `prr_sample_data` load and clear have not run.
