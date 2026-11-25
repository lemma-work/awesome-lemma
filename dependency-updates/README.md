# Dependency updates

Dependency updates batched, checked and opened as one pull request. Each week
the Lemma opens one pull request per watched repository with every update
that has waited long enough, installed and tested, one commit per update. A
failing test is traced to one update by trying the updates in halves; the
Lemma makes at most one small fix for it, as its own commit, or holds it out.
Majors and risky releases wait for a person, who decides in the app or from
Today. Security fixes open the same day, outside the batch and the wait. The
Lemma never merges. One app, `dependencies`: the week, an update's sheet, each
pull request the Lemma opened, the rules, and set-up.

It carries nothing (`plugin.json`). It reads a pull request's review straight
from GitHub's `pull_request_review` event, so it works with or without PR
review; once PR review is built it carries `pr-review`, which wakes on a
batch like on any other pull request.

## What it does

```
set-up, once, by whoever opens it first (the owner who decides)      deps_setup_save
   repositories (those the GitHub install covers for them), day and time (Monday 06:00),
   the wait (3 days, 14 for a major), hold install scripts ─▶ deps_memory
   the app, as the owner: per repository deps-weekly-<repo> (TIME, the day and time) and
   deps-security-<repo> (TIME, daily 07:00), both with `repository` (lemma-platform#1246);
   once: deps-alert (dependabot_alert), deps-github-pr / -checks / -review
   (pull_request, check_suite, pull_request_review ─▶ deps_on_github), deps-comment (issue_comment)
   then a "first look" run per repository: managers and commands ─▶ a person confirms them

weekly, per repository            agent deps-updater, as the owner
   checkout (or clone by hand) ─▶ what is outdated per manager ─▶ the registry (age, publisher,
   install scripts, downloads) ─▶ the wait, ignores, rules ─▶ changelogs, and rg for what changed
   majors ─▶ needs_you; risky ─▶ risky (both "decide" in the owner's Today)
   the rest: one commit each ─▶ test ─▶ on a failure, halves until one is to blame ─▶ one fix,
   or held out ─▶ build ─▶ push lemma/deps-<date> ─▶ pulls_create as the App, label dependencies
   ─▶ checks_create "Dependency updates" ─▶ every step through deps_record (deps_batch.steps)

security, daily or on a Dependabot alert       agent deps-updater
   Dependabot alerts, or OSV / npm audit / pip-audit ─▶ does the code reach it (the Lemma's
   reading, not a call graph) ─▶ its own pull request at once, whatever the wait

on GitHub                         deps_on_github
   pull_request ─▶ open, closed, merged (its updates ─▶ merged), new commits
   check_suite ─▶ checks passed or failed; pull_request_review ─▶ approved, changes, notes
   "@lemma drop vite" on a dependencies pull request ─▶ deps-comment ─▶ a comment run

in the app, as the person         deps_decide, then the run it asks for
   Add to Monday · Its own PR · Not yet · Let it through · Take it now · Ignore (a range, a reason)
   Drop · Put back · Ask the Lemma (a comment run) · Stop ignoring · Merge (pulls_merge, after a confirmation)
```

| Layer | Resources |
| --- | --- |
| Shared tables it carries (byte for byte) | `needs_you` (decide: a held major, a risky release) |
| Its own tables (team-wide, no RLS) | `deps_settings` (one row) `deps_repo` `deps_update` (id uuid5(repo, ecosystem, package, version)) `deps_batch` (id uuid5(repo, branch)) `deps_ignore` `deps_rule` `deps_sample_row` |
| Agent | `deps-updater`: `WORKSPACE_CLI`, the GitHub connector, `deps_record`, read on its own tables |
| Functions | `deps_setup_save` `deps_record` `deps_decide` `deps_on_github` `deps_needs_you` `deps_memory` `deps_sample_data` (grants from `bin/grants.sh`) |
| Workflows | `deps-on-pull-request`, `deps-on-check-suite`, `deps-on-review` (GitHub events ─▶ `deps_on_github`) |
| Schedules | none in the bundle: they need the repository and the owner, so the app makes them at set-up, as the owner |
| Connector | `github` (shared) |
| Memory | its block in `/memory/AGENTS.md` and its guide `/memory/plugins/dependency-updates.md`, from `.lemma/agents-block.md` and `.lemma/guide.md` |
| App | `apps/dependencies` (Vite, `@lemma-plugins/kit`), design in `DESIGN.md` |

## Before and after lemma-platform#1246

The platform change gives a time schedule a checkout of its repository, lets
the GitHub App push workflow files, read Dependabot alerts and wake on them,
and write check runs. v1 works without it. Each fallback is found at run time
and recorded through `deps_record` as a status the app shows under "Where it
runs"; none is a setting.

| Without #1246 | What happens | Status shown |
| --- | --- | --- |
| A time schedule's `repository` | The run starts without a checkout and clones by hand (`gh repo clone`, `git worktree add`). The app still makes the schedule with `repository`; a server that refuses it gets the schedule without. | Checkout: Clones by hand |
| The App's `workflows` permission | A push touching `.github/workflows/` is refused; the Actions commits come out, the push goes again, and those updates are `by_hand` | Actions updates: Listed to do by hand |
| Dependabot alerts (403) | OSV, `npm audit` or `pip-audit` from the sandbox, daily | Security source: OSV, daily |
| The `dependabot_alert` trigger | The schedule can't be made; the daily run finds them | (recorded as `alert_trigger`) |
| `checks: write` | No check run; the pull request's description carries the same line ("Dependency updates: 8 in, 3 held") | Check run: In the description |

## Install

`install/dependency-updates/` at the top of this repository is ready to
install. From the CLI, the same server-side import as **Add to your Lemma**:

```bash
# from the repository root
uv run --no-project python _build/install.py dependency-updates --lemma <lemma-id> \
  --var deps_slug=<free slug>
```

Then share a GitHub account with the Lemma's `github` connector (the import
says it needs one), and open the app: set-up, or "Look around with a sample
week". `bin/lemma` is the CLI bound to one Lemma (`LEMMA_SERVER`,
`LEMMA_ORG_ID`, `LEMMA_POD_ID` from the environment or a gitignored
`.lemma.env` here); `bin/q "<sql>"` prints one JSON row per line.

The functions share code they cannot import: `bin/common.py` copies the
helpers (`# deps:common`) and the contract's snippets into every function.
After editing them:

```bash
uv run --no-project python bin/common.py      # --check fails on a copy that differs
bin/grants.sh                                  # every function's grants
uv run --no-project python bin/demo-fixtures.py   # the demo's sample, from deps_sample_data's build()
# from the repository root
uv run --no-project python _build/assemble.py --install dependency-updates
node _kit/bin/demo.mjs dependency-updates
```

## What was measured (25 Nov 2026, a hosted Lemma)

- **Install**: `install/dependency-updates/` (54 files) imported server-side
  into an empty Lemma: 30 parts, all created, the app built and ready. One
  warning: the shared `github` connector imports needing an account.
- **Set-up and sample, by CLI as the owner**: `deps_setup_save` wrote the
  settings and the memory block (`/memory/AGENTS.md` holds the block,
  194 characters with its markers); `deps_sample_data` loaded 38 rows in
  about 10 s. Today then held three items: "react-router 7: add to Monday,
  its own PR, or not yet?", "tailwindcss 4: …" and "color-convert 3.1.1 adds
  an install script: let it through?".
- **Decisions**: `deps_decide` monday, not_yet and let_through each moved the
  update and closed its item in Today (done, closed by the source); not_yet
  made an ignore for that exact version.
- **The agent's writer**: one `deps_record` call as the agent would send it
  (repository facts, five updates, a batch with steps, platform notes) made
  three new items in Today, applied the `19.x` ignore to a new @types/react,
  superseded react-router 7.9.4 with 7.9.5 (a person's choice is per
  version), kept commands a person had confirmed, refused an update with an
  unknown ecosystem by name, and set the security source to Dependabot alerts
  from `alerts: yes`.
- **GitHub events**: `deps_on_github` with hand-made payloads: a failed
  check suite set checks failed; a review with a body counted a note and kept
  its text as text; a merged `pull_request` moved the batch to merged and its
  seven updates to merged; an event from an unwatched repository was ignored.
- **The app** under `vite dev`, signed in with the CLI's token, against that
  Lemma: the week rendered from the live rows with no failed request.
- **Clearing the sample** removed its 38 rows and closed its items in Today.
- **Schedules**: a TIME schedule with `config.repository` was **accepted**
  by a server without #1246 (the key is stored and, without #1246, not
  acted on), so the refusal fallback in the app does not fire there; the
  agent's "no checkout, clone by hand" is what detects it. A GitHub WEBHOOK
  schedule was refused with `CONNECTOR_NEEDS_ACCOUNT` until a GitHub account
  is shared; the app reports that as a problem at set-up.
- **The demo** builds (0.76 MB) and runs on the sample week with no console
  error; screenshots of `/`, `/u/<id>`, `/b/<id>`, `/setup` and `/rules`,
  light, dark and 375px, with no sideways scroll. Moments: `batch`, `major`,
  `halving`, `security`, `risky` (a loop).

## What was not verified

- **The agent has not run.** Everything it does (clone, outdated, registry,
  changelogs, install, test, halving, the fix, push, `pulls_create`,
  `checks_create`, comment runs, security runs) waits for the walk-through
  against a test repository with real outdated npm and Python dependencies.
  So the time per batch and the test runs a halving needs are not measured.
- The app's runs (Open now, its own PR, Drop, Put back, Ask), Merge
  (`pulls_merge` as the person) and the set-up's schedules were not made
  from the app: they need a shared GitHub account and a repository.
- Real GitHub webhook deliveries; the `@lemma` comment filter; a Dependabot
  alert event.
- That an agent left unattended never calls `ask_user`: it has no switch for
  it, so its instruction says never to, and nothing enforces it.
- Merge as a member who is not the owner.

## Out of v1

- **Private registries**: the repository shows "Private registry"; its
  updates are read but not tested, and the pull request says so.
- **Go, Cargo, Maven and Gradle.**
- **Adoption and "passing" across other teams** (Renovate's fleet data):
  "Tried here" counts this Lemma's own runs only.
- **A malware scan**: the risk check reads registry metadata only (age,
  publisher, install scripts).
- **Reaching a vulnerable function** is the Lemma reading the code, not a
  call graph; the app says so beside each answer.
- **Merging on its own.**
- **Monorepo grouping** beyond one pull request per repository.
- **A machine of its own**: the agent runs in the cloud workspace of the
  person a run is for, not a pod machine of its own (2 vCPU, 4 GB), until
  `_build/assemble.py` carries a bundle's `machines/`.
