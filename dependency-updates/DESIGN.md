# Dependency updates: design

## Thesis

> For an engineering team that keeps its code on GitHub, Dependency updates
> turns the week's dependency churn into one pull request per repository that
> is already installed and tested, with one commit per update, and puts only
> real decisions in front of a person: a major that changes code they wrote,
> a release that adds an install script, a security fix their code reaches.
> The Lemma never merges.

- **Hero moment:** the batch pull request (`/b/<id>`): "pnpm test: 2 failed",
  "Tried the updates in halves, 3 test runs: zod 3.25.76 alone fails both
  tests", "Fixed it: parseAsync to safeParseAsync, commit a41c09e", then
  "412 passed", checks green, review approved. The halving and the fix are
  the Lemma's own work and carry the sparkles mark.
- **First 30 seconds:** the status line (next batch, last batch, the wait,
  where security fixes come from), then Security, Ready for Monday, Waiting
  for you, Waiting out the wait, Held as risky, Ignored. Beside it: rules in
  words, repositories with their status, and what the platform allowed on the
  last run.
- **Information spine:** `deps_update`, one row per package and version per
  repository, moving through states; `deps_batch`, one row per pull request
  the Lemma opened, with its timeline (`steps`).

## Direction: a dense engineering tool on the kit

The approved canvas (A the dashboard and C the batch as one app; B's drawer as
the update sheet) drawn on `../_kit`: Inter at 500 at most, the host's
`--c-*` roles only (no hex in `deps.css`), lucide icons, the kit's pills,
buttons, segmented filter with counts, search on `/`, cards, tables, sheet,
timeline and record layout. Versions, paths and code lines are in the system
monospace, as GitHub shows them. GitHub/Renovate density: 13px rows, 12px
meta, 15px heads, 21px for a record's title.

- **One accent per view.** `/`: Open Monday's batch now. `/b`: Merge (after a
  confirmation sheet). The update sheet's main decision is primary inside the
  sheet. Set-up: Save.
- **The Lemma's own reads** (the read of a changelog, "does your code reach
  it", the halving and the fix) carry the sparkles icon; "What changed" has
  the `ai` pill. Reach always says it is the Lemma reading the code, not a
  call graph; the risk check always says it is registry data, not a malware
  scan.
- **Pills always carry words:** Waiting for you, Held, Do by hand, Checks
  passing, Approved, 1 note, Private registry, Clones by hand.
- **Platform fallbacks are statuses, not settings.** "Where it runs" shows
  what the last run met: Clones by hand or Starts in a checkout, Actions
  updates by hand or pushed, OSV or Dependabot alerts, a check run or the
  description. The agent records them through `deps_record`.

## Routes

| Route | Screen |
| --- | --- |
| `/` | the week, with the repository filter (segmented, counts) and search |
| `/u/<id>` | one update, as a sheet over `/`: what changed (ai), where you use it (file:line and the line), the Lemma's read, the decision |
| `/b/<id>` | one pull request as a record: how it was checked, updates with one commit each and Drop or Put back, files with the lockfile folded and the fix as `+`/`−` lines, checks, review, held out, opened apart, Ask the Lemma |
| `/rules` | rules in words, ignores (Stop ignoring), the wait and the schedule |
| `/setup` | repositories, day and time, the wait, the commands each first look found, or the sample week |

## 375px

The header, filter, search and the primary button stack; tables scroll inside
their own box; the rail and the record's side panel fall under the main
column; the sheet is full width. Checked in screenshots, light and dark, with
no sideways scroll on the page.

## Not drawn

- A diff view: the kit has none, so the fix is plain `+`/`−` lines from the
  recorded patch. It moves to PR review's proposed `Diff` once that lands.
- Adoption and "passing" from other teams: "Tried here" is this Lemma's own
  runs only.
