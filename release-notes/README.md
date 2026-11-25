# Release notes

**Notes written from what merged, and word to everyone who asked for it.**

Every pull request that merges redrafts the open release's note: routine and
internal work folds out, each line keeps its pull requests and issues, and a
line a person edited is never rewritten. When the release is live (your deploy
workflow finished, or a tag was pushed) the publisher gets "v2.14 notes are
ready" in Today. Publish puts the note on the GitHub release, a public
changelog page and Slack, and then everyone who asked for something in it gets
a reply drafted where they asked: in the member's own email thread (a Mail
draft), on their GitHub issue, or in their Slack thread. Nothing is sent until
a person presses Send.

Line dev, position 30. Carries Mail (`plugin.json`): Mail delivers the replies
in each asker's thread and brings `conversation`, `message`, `person`, `draft`
and `needs_you`. Release notes adds the shared `ask` table
(`_contract/tables/ask.json`) and reads `brand` if Brand kit filled it.

## What was verified (the brief's four early questions)

Checked against the Lemma platform as of 24 Nov 2026, and on a hosted Lemma.

1. **Can a function make a WEBHOOK schedule with installation_id and
   account_id? No.** `schedule.create` is checked on the pod, and a workload
   can only be granted, on the pod, `channel.notify_self` and `agent.execute`
   (`core/authorization/resource_actions.py`, `RESOURCE_ACTIONS[POD]`). So, as
   the brief's fallback says, the app makes them as the person setting up
   (`ensureTeamSchedules` in `src/data.tsx`), as Mail and Booking do. Two more
   findings change how: `installation_id` is a provisioned key
   (`schedule/domain/schedule.py`, `PROVISIONED_CONFIG_KEYS`) that the server
   drops from whatever an author sends and writes from the connection's
   account (`external_schedule_writer._github_binding`), so nobody sends it;
   and `account_id` is deprecated in favour of `pod_connector`, so the app
   sends `pod_connector: "github"` (the Lemma's shared connection) with
   `config: {source: github, event, actions}`. Not run against GitHub: the
   scratch Lemma has no GitHub account.
2. **The member's `ask` trigger with `rows: OWNER_READABLE`: yes.** On a
   shared table every change reaches every owner who can read it
   (`trigger_delivery.owner_can_see`: a row with no owner is delivered) and
   every fire runs as the schedule's owner (`trigger_fire.run_person`,
   `runs_as_row_owner` is false for OWNER_READABLE). On a hosted Lemma a member made
   all three of their own triggers (ask, draft, release_note) with no edit
   rights needed, and each fired on rows a function run changed and ran as
   them. Not tried with a second member (the scratch Lemma has one).
3. **Can a Mail `draft` with kind reply and `built_from` an ask go through
   `mail_send_draft` unchanged? Yes.** It reads only `state` (must be
   approved), `to_handles`, `source` (mail), `source_account` (the
   `mail_mailbox` row id, as `conversation.source_account` holds it) and
   `conversation_id`; `kind` and `built_from` are ignored. One side effect:
   after sending it marks the conversation waiting with a follow-up date, so
   Mail's hourly sweep would later offer a nudge on an "it shipped" message.
   Left as Mail's call (see Things that bit). Not sent for real: no mailbox
   was connected; the sample's Send goes through `release_notes_send_reply`.
4. **A real repository: not tried yet.** It needs a repository with the
   Lemma GitHub App installed. Nothing here has touched GitHub or Slack.

## How it works

| Part | What it does |
| --- | --- |
| `release-notes-on-merge` (WEBHOOK `pull_request`, made at set-up) | `release_notes_on_merge`: keeps the merged pull request, its kind (one Decisions call; a dependency bot's is routine without asking) and the issues it closes (`closingIssuesReferences`), writes an `ask` for each issue author and "me too" commenter outside the team; then `release_notes_draft` (brief) → the `release-notes-writer` agent → `release_notes_draft` (save) |
| `release-notes-redraft` (manual, about a note) | the same brief → writer → save, from the app's Redraft, the nightly catch-up or chat |
| `release-notes-on-deploy` (WEBHOOK `workflow_run`) / `release-notes-on-tag` (WEBHOOK `push`) | `release_notes_on_live`: the named deploy workflow's successful run on the default branch, or a new tag, marks every pull request whose merge commit it contains live, and the note `ready` |
| `release_notes_publish` (Publish, as the person) | GitHub release, `release_note_page` row (Public), Slack post; linked asks to `shipped`; a comment or thread reply proposed for each public asker |
| `release-notes-tell` (each member's trigger on `ask`) | `release_notes_tell` brief → `release-notes-replier` agent → a Mail draft in the member's thread and "Tell Jo it shipped" in their Today |
| `release-notes-on-sent` (each member's trigger on `draft`) | sent: the ask is `told` and the Today item done; thrown away: the item is done |
| `release-notes-on-note` (each member's trigger on `release_note`) | `release_notes_on_note`: a publisher's "notes are ready" decide; after publishing, `release_notes_suggest` (one Decisions call per candidate conversation) |
| `release-notes-nightly` (TIME, made at set-up) | `release_notes_reconcile`: merges and deploys a webhook missed |
| `release_notes_send_reply` | Send on a public reply: `issues_create_comment` as the person, or Slack `chat_post_message` with `thread_ts` |

Tables: `release_note`, `release_note_line`, `release_note_pr`,
`release_note_reply`, `release_note_page` (Public), `release_note_settings`,
`release_note_sample_row`, and the shared `ask`. Function and table names are
prefixed and unique across plugins (the lint checks).

Apps: `release-notes` (members: `/` the draft desk, `/asked` who asked,
`/published` and `/n/<id>`, `/settings`, `/setup`) and `changelog` (Public:
the page, reading `release_note_page` through the web widget key the host puts
in `__LEMMA_CONFIG__.webWidgets`, at most 500 rows). Settings' "Turn the page
on" makes a `Changelog` web widget answering `known` and allowing the page's
origin (an `off` widget is neither handed to the page nor answers reads).

## Measured (24 Nov 2026, on a hosted Lemma)

A fresh scratch Lemma ("Release notes test", bound in the gitignored
`.lemma.env`), installed server-side with `_build/install.py release-notes`:

- install: COMPLETED, 113 parts, with Mail; two warnings, GitHub and Slack are
  shared connectors with no account shared yet;
- sample load: 24 pull requests, 9 lines, 14 asks, 3 mail threads; Today got
  "v2.14 notes are ready" (decide) from the publisher's own run;
- my three triggers made with `rows: OWNER_READABLE` and `when` conditions,
  accepted as written;
- publish (sample): 13 asks shipped, 11 public replies proposed, page row
  written, GitHub and Slack said "Sample: nothing was posted";
- a line whose only pull request isn't live yet (#1219, merged after the
  deploy) was held: left off the release, the page row and Slack, the line
  hidden on this note and the pull request back to no note, so the next
  release's draft writes it ("Held for the next release, not live yet: 1
  line(s)");
- the ask trigger fired twice (Jo, Kofi): the replier agent wrote each reply
  in the member's voice from the thread, with sorry for the wait (73 and 35
  days), saved as Mail drafts in the thread, and two answer items "Tell Jo it
  shipped" with "Reply drafted";
- the note trigger closed the decide item when the note was published;
  suggest ran and found nothing new (the one sample match was already linked);
- Send on Jo's sample draft: the draft trigger made the ask `told` and closed
  the Today item; Send on Ela's issue comment (sample): `told`;
- a person's edit of one line, then Redraft: Decisions picked #1209 and #1211
  to lead, the writer wrote 8 lines in plain words, and the edited line came
  through word for word;
- on_merge's skip paths (not merged; another repository; GitHub not
  connected) and on_live's (another workflow) answered skip;
  `release_notes_setup_options` said "not connected" for both;
- `release_notes_memory` wrote the block (183 characters with markers) into
  `/memory/AGENTS.md`;
- sample clear removed every row it made (asks, threads, drafts, notes,
  settings) and closed its Today items.

`uv run --no-project python _contract/lint.py`: ok, all plugins.
`_build/assemble.py --install release-notes`: ok, 217 files.

## Not verified

- Anything on GitHub or Slack: the merge webhook, `workflow_run` and tag
  push, `repos_compare_commits` (since the last tag, and "is it live"), the
  GitHub release, issue comments, the Slack post and thread reply, and the
  set-up lists of repositories, workflows and channels. Each call is written
  to the ops on main (`pulls_get`, `pulls_list_files`,
  `github_graphql_request`, `repos_compare_commits`, `repos_get_latest_release`,
  `repos_get_release_by_tag`, `repos_create_release`, `repos_update_release`,
  `issues_create_comment`, `actions_list_workflow_runs_for_repo`,
  `apps_list_repos_accessible_to_installation`, `actions_list_repo_workflows`,
  Slack `conversations_list`, `chat_post_message`), not run. Waiting on the
  test repository (question 4).
- The WEBHOOK schedules themselves: never created (no GitHub account).
- A real Mail send through `mail_send_draft`.
- Two members: another member's asker, their own trigger, their Today.
- The apps inside a hosted Lemma's frame: checked as the demo build only. The
  changelog app on its hosted address, the widget turn-on and
  `__LEMMA_CONFIG__.webWidgets` were not tried.
- `release_notes_reconcile` and the nightly schedule; `release_notes_setup_save`
  end to end from the app.

## Things that bit

- **Decisions can't write.** The Decisions API answers closed questions only
  (choice, multi-choice, yes or no, a short scale:
  `decisions/domain/questions.py`). The brief's "writes the lines with one
  decisions.make" and "writes the reply with one decisions.make" can't be
  done; the lines and replies are written by two agents with no tools in a
  workflow step, as Mail's `mail-writer` does, and Decisions makes every
  judgment (kind, leads, does an ask match).
- **Bulk writes don't fire triggers by default.** Publish moves asks with
  `intent: "normal"`, and every member trigger says `bulk_writes: each`.
- **Today is per person.** A webhook run can only write its own owner's
  `needs_you`, so "notes are ready" comes from each publisher's own trigger on
  `release_note`, an extra per-member trigger the brief didn't list.
- **The vendored SDK (0.10.1) has no `about` on workflow runs**, so the app
  starts Redraft and Tell with `POST /pods/{id}/workflows/{name}/runs`.
- **Mail's follow-up after an "it shipped" reply** (question 3). A fix belongs
  in Mail: skip the follow-up date for a draft whose `built_from.plugin` is
  release-notes.
- **The replier named its brief's fields** in the margin
  (`waited_days 73, say_sorry true`) despite the instruction;
  `release_notes_tell` now turns those into "asked 10 weeks ago, so it says
  sorry". Seen before the change; the demo's two replies were cleaned the same
  way.
- **A Slack sample ask whose id moved** between loads (its thread ts came
  from the clock): fixed, the sample's ids are the same on every load.
- `lemma schedules create -d` (CLI 0.8) still wants `--workflow`.

## Where it differs from the brief

- Lines, PR summaries and replies are written by agents, not Decisions (above).
- The WEBHOOK and nightly schedules are made by the app, not
  `release_notes_setup_save` (question 1); `pod_connector`, no installation id.
- An extra per-member trigger on `release_note` (Today is per person); it also
  starts `release_notes_suggest` after publishing.
- Public replies (GitHub, Slack) are drafted from a fixed sentence and the
  note's line, not by the agent; the person edits them before Send.
- The voice comes from `brand.voice`, not the file at `brand.guide_path` (no
  folder grant needed).
- Extra columns: `release_note.live_ref`, `draft_error`, `github_release_url`,
  `page_id`, `sent`; `release_note_page.product` and `brand` (the page can't
  read `brand`, which isn't Public, so publishing copies its tokens; no logo,
  since Lemma files aren't public: the page shows the product's initial);
  `release_note_settings.product`, `page_url`, `schedules`; and the table
  `release_note_sample_row`.
- `deployment_status`: set-up shows "Deployment" disabled with a plain line,
  and no workflow ships for it, since the trigger isn't on main.
  `release_notes_on_live` already handles the event.
- Not built: a picture per line ("Add a picture of it"), the card script
  (`card.js`) and its "Card in your product" destination (Settings says so),
  the page moments.
- The demo's second member (Priya, with one ask she heard) exists only in the
  demo's fixtures: a sample can't name a real second member.

## Out of v1

- A custom domain for the page (not on the platform).
- A subscriber mailing list: that's Newsletter, which builds on this.
- Teams, Linear or Jira as sources.
- Several products in one repository beyond path globs.
- Slack DMs to askers.
- Telling people a declined ask "won't do": that's Triage's job.

## Install

```bash
# from the repository root
uv run --no-project python _build/install.py release-notes --lemma <lemma-id> \
  --var release_notes_slug=<free name> --var changelog_slug=<free name> --var inbox_slug=<free name>
```

Then share a GitHub account (and optionally Slack) with the Lemma's shared
connectors, and open the app: set-up picks the repositories, how each goes
live, the channel and the publishers, and turns the triggers on as you. Each
member opens the app once, so replies to the people who asked them are
drafted in their own threads. Or "Look around with a sample release".

`bin/lemma` is the CLI bound to one Lemma (`.lemma.env`); `bin/grants.sh`
writes every function's grants; `bin/common.py` copies the shared helpers and
the needs_you snippet into each function; `bin/demo-fixtures.py` makes the
demo's sample from a Lemma holding the sample (`before`, then `after` once it
is published).

## Pictures and demo

`node _kit/bin/demo.mjs release-notes` builds `.lemma/demo/` (both apps;
Publish in the demo plays back what publishing made on a hosted Lemma). Pictures in
`.lemma/shots/`, taken from the demo build at 1440×900 and 375×812, light and
dark: `release-notes-*` (the desk), `release-notes-asked-*` (who asked, after
Publish), `changelog-*`. No sideways scroll at 375px on any of them.
