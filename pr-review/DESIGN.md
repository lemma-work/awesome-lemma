# PR review: design

## Thesis

> For an engineering team whose review rules are scattered across AGENTS.md,
> CONTRIBUTING.md and reviewers' heads, PR review reads every pull request
> against those rules before anyone opens it, and lays out the result the way
> GitHub would: a ledger of every rule in scope (passed, broken, not checked
> and why), findings under the lines they are about, and an inbox grouped by
> who each pull request waits on, decided by code.

- **Hero moment:** the Files tab of a pull request: line 82 of
  `billing/queue.py`, and under it "Must fix · A retry can charge twice",
  the rule it breaks with the file and line it came from, the suggested
  change, and Fix it · Not worth fixing · The finding is wrong.
- **First 30 seconds:** the inbox, Needs your review on top, then Ready for
  you to merge (one press), Merging by itself (a countdown and Hold),
  Returned to you, Waiting on others, Reviewing now. Each row shows the rules
  bar ("9 passed · 2 broken · 1 not checked"), findings, live checks, the
  round and commit, and who it waits on.
- **Information spine:** the pull request (`pull_request`, a contract
  table). Rounds hang off it, one per head commit (`prr_round`); findings
  hang off it and are the same row on every push (`prr_finding`), so "fixed
  in 3e1b0d4" and "dismissed, stays dismissed" are facts, not guesses. Rules
  (`prr_rule`) have a record that is counted from findings, never stored.

## Direction: GitHub's own shapes on the kit

The pull request page is shaped like GitHub's (title, state, branches,
tabs, a file tree beside the diff), so an engineer needs no lesson. The look
is the kit's: Inter at 500 at most, the host's `--c-*` roles, lucide icons,
pills with words, cards, sheets, skeletons in the final geometry. `prr.css`
and `rules.css` only place things and draw PR review's own marks:

- **The rules bar:** passed, broken and not checked as a three-part bar
  (`--c-success`, `--c-danger`, `--c-faint`), always with its words beside.
- **The diff:** GitHub's per-file patch, parsed in the app (`diff.ts`,
  from the Factory pod), monospace from the system's `ui-monospace`. Each
  stretch of code between findings scrolls sideways in its own box, and a
  finding is always the page's width, so it reads at 375px.
- **The Lemma's own words** (What it changes, Key changes, proposed rules)
  carry the sparkles icon and the `ai` pill, never a colour of their own.
- **Honest live states:** the Lemma check row says "Can't post yet: needs
  the platform update" or "the GitHub App needs Checks write" when
  `prr_round.github.check` or `prr_settings.platform` says so; merging as the
  bot says the same. Nothing claims a check, an approval or a merge that did
  not happen.

## Pages

### Pull requests (`apps/pull-requests`)

| Path | Page | Reads | Writes |
| --- | --- | --- | --- |
| `/`, `/all`, `/merged` | Inbox (A1): sections by who it waits on; beside it rules broken most this week, not checked, merged by itself, on GitHub | `pull_request`, `prr_round`, `prr_finding`, `prr_rule`, `prr_merge_log`, `repository`, `prr_settings`; checks live from GitHub (`checks_list_for_ref`) as the person, a minute's cache | Hold (`prr_hold`); Merge on a Ready row (GitHub `pulls_merge` as the person) |
| `/pr/<owner>/<repo>/<n>` | Overview: key changes, open findings, found across open pull requests | the round, findings | findings' actions |
| `…/files[/<path>]` | Files changed (A2): Worth reading / Mechanical tree, diffs from GitHub (`pulls_list_files`) with findings under their lines | GitHub as the person | Fix it (`prr_fix_task`), Not worth fixing / The finding is wrong / Reopen (`prr_decide_finding`) |
| `…/rules`, `…/rounds`, `…/activity` | The whole ledger; every round; the timeline | rounds, findings, merge log | none |
| (beside Overview and Files) | What it changes · Rules checked · Since round 1 · Merge box | the above, GitHub `pulls_get` | Send back as the bot (`prr_send_back`) or as you (GitHub `pulls_create_review` REQUEST_CHANGES); Approve as you (`pulls_create_review` APPROVE, hidden on your own); Merge as you (`pulls_merge`, GitHub's refusal shown word for word); Hold, Merge now (`prr_merge` with `now`); Hand to (`pull_request.waits_on`) |
| `/settings` | Settings (S2): who posts, the Lemma check, approving, comments, repositories, reviews, people and risky paths, connection | `prr_settings`, `repository`, `prr_member`, `prr_risk_path` | `prr_setup_save` (flat input); `paused` and `daily_merge_cap` as row fields; risky paths as rows |
| `/settings/merging` | Merging (A3): mode, every condition, the wait, how; the watch record | `prr_merge_log`, `pull_request` | `prr_setup_save` (`merge`, `repos[].merge_mode`), `daily_merge_cap` |
| `/setup` | First run: connect GitHub, pick repositories, read the rules, or a sample | GitHub `repos_list_for_authenticated_user` as the person | `prr_setup_save` with `read_rules`, then the WEBHOOK schedules it names, made as the person (`client.schedules.create`); `prr_sample_data` |

Once per open, after set-up, each member's app makes their own
`prr-needs-you-<id>` trigger, so "Review this" and "Merge this" reach their
Today.

### Rules (`apps/rules`)

| Path | Page | Reads | Writes |
| --- | --- | --- | --- |
| `/`, `/proposed`, `/paused`, `/retired` | Rules (S1) by state with counts; the files read; the record (raised, fixed, dismissed, acted on) counted from findings and the rounds' ledgers; "Rarely acted on … Retire it"; "Not checked N times: why"; proposed cards with the comment they came from | `prr_rule`, `prr_finding`, `prr_round`, `repository` | state changes and edits as rule rows; Add a rule (a `typed` row, active at once); Read the repositories again (`prr_read_rules`); Write back as REVIEW.md (`prr_write_review_md` when the Lemma has it; no such function exists yet, so it is disabled, titled "Coming") |
| `/r/<id>` | One rule in a drawer | the above | the rule's row |

## Keys

Inbox: `/` search · `j` `k` move · `o` or Enter open · `r` the Rules app.
Rules: `/` search. Every action is a visible button or link: Hold, Merge,
Fix it and the rest are never only on hover.

## Copy rules

- Never "pod", "teammate" or "room"; the noun is "Lemma", as in "the
  Lemma's bot".
- Say who posts: "as the Lemma's bot" or "as you", every time something goes
  to GitHub.
- A state is a word: Passed, Broken, Not checked (with why), Must fix,
  Should fix, Nit, Clean, Changes needed, Needs a person, Merging by itself,
  Held.
- A rule is one checkable sentence, sentence case, ending with a full stop.
- No sample names in copy; the sample's names live only in its rows.
- When something can't happen yet, say what it needs ("needs the platform
  update", "the GitHub App needs Checks write"), never a vague "unavailable".

## Demo

`node _kit/bin/demo.mjs pr-review` builds both apps on the sample in
`.lemma/shots/fixtures/` (written by `.lemma/shots/fixtures.py`: acme/api and
acme/web, four made-up people on `.example`). `.lemma/demo.js` answers GitHub
(files and patches, checks, `pulls_get`, a review, a merge) and PR review's
functions in the page, and moves the sample's times to now so the countdowns
read as written. The six listing pictures come from it through
`.lemma/moments.json`.
