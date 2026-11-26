# Early access

Everyone in your beta, what they tried and what they said: a public sign-up
page for each beta with the email confirmed by a code, the next batch ranked
by fit with a one-line reason each, invites drafted in your own mailbox,
usage from PostHog, one check-in and at most one note to anyone gone quiet,
and their words filed as `feedback`. Nobody is let in and nothing is sent
until a person presses.

It carries **Mail**, which drafts and sends the notes: one install puts both
into an empty Lemma. It writes the contract's `feature` (stage beta),
`feedback` (`plugin` early-access) and `form` (its sign-up, `owner_plugin`
early-access), and carries `product`, `feature`, `feedback`, `form`, `deal`,
`ask`, `company` and `company_domain` byte for byte. It uses Forms, User
feedback and Deal tracker when they are there, and carries none of them.

## What it does

```
set-up (the app, as the person)  /setup or /b/<beta>/settings
   the feature (shared `feature`, made at stage beta when new, with a `product` if the team has none)
   the page's address, one line, the sign-up questions (four, editable), batch size, check-in day, quiet days
   the flag: PostHog (flag + the static cohort it targets, connected here with the kit's <Connect>), by hand, or none
   the mailbox notes go from (Mail's)
 ─▶ Turn on, each step read back (wire.ts):
   open      early_access_signup to confirmed contacts, 8 columns, contact-owned
   checkin   early_access_checkin to anyone with the link, 6 columns
   widget    the Lemma's web widget "Early access", chat off
   triggers  early-access-signup and early-access-checkin, INSERT, include_outside_rows (read back)
   sweep     the person's own early-access-sweep-<id>, hourly
   page      state open, the link with the widget's key, the memory block

visitor  /<beta>?k=<key>  ─▶ name, email, the questions ─▶ code ─▶ Lemma.addRow(early_access_signup, ref)
         /<beta>/status?ref=…    Waiting, You're in, or Not this time (Public early_access_status by ref)
         /<beta>/check-in?ref=…  used it? what worked, what got in the way, would you miss it
early-access-signup (as whoever turned it on)
   early_access_on_signup  contact check, the tester (one per person per beta), Waiting, the form count
   early_access_fit        facts (sign-up, open deal, mail, asks) ─ one Decisions call: strong / maybe / not_now
   early-access-picker     the one-line reason, which must name a fact (else the strongest fact is the reason)
   early_access_needs_you  "Next 10 for <beta> are ready"
the sheet /b/<beta>/next ─▶ invites drafted (early-access-draft: brief ─ early-access-writer ─ Mail draft)
   ─▶ Let in N and send the invites (early_access_let_in as the person: PostHog cohort; then each draft approved
      and sent with mail_send_draft) or Let in, I'll write myself
early-access-sweep (hourly, as the owner): HogQL usage ─ active / quiet ─ day-6 check-in ─ the one chase ─
   PostHog people found later added to the cohort ─ survey answers to feedback ─ Today
early-access-on-draft (a sent note) and early-access-on-reply (a tester's reply in that thread, words to feedback)
```

| Layer | Resources |
| --- | --- |
| From Mail (carried) | `conversation`, `message`, `person`, `person_handle`, `draft`, `needs_you`, `mail_mailbox`, … and Mail's functions, agents, workflows, schedules, app |
| Contract tables carried | `product`, `feature`, `feedback`, `form`, `deal`, `ask`, `company`, `company_domain` |
| Own tables | `early_access_beta`, `early_access_tester`, `early_access_batch` (team-wide); `early_access_signup` (contact-owned, open to confirmed contacts), `early_access_checkin` (open to anyone with the link); `early_access_page`, `early_access_status` (Public, nothing about anyone); `early_access_settings` (per person); `early_access_sample_row` |
| Functions | `early_access_setup_options`, `_setup_save`, `_on_signup`, `_fit`, `_rank`, `_draft`, `_let_in`, `_take_out`, `_sweep`, `_on_checkin`, `_on_draft`, `_on_reply`, `_needs_you`, `_memory`, `_sample_data` |
| Agents | `early-access-picker` (the reason), `early-access-writer` (the notes). No tools, structured output; neither sends or lets anyone in |
| Workflows | `early-access-signup`, `early-access-draft`, `early-access-checkin`, `early-access-sweep`, `early-access-on-draft`, `early-access-on-reply` |
| Schedules | bundled: `early-access-on-draft` (draft UPDATE to sent), `early-access-on-reply` (inbound message INSERT); made by the app at Turn on: the two triggers and each owner's hourly sweep |
| Connector | `posthog` (SHARED, optional): PostHog's MCP server through the generic MCP connector (catalog `mcp`) |
| App | `early-access` (Public): `/`, `/b/<beta>`, `/b/<beta>/next`, `/b/<beta>/settings`, `/p/<tester>`, `/setup` for members; `/<beta>`, `/<beta>/status`, `/<beta>/check-in` for visitors |
| Memory | block in `/memory/AGENTS.md` (193 characters with markers), guide at `/memory/plugins/early-access.md` |

Ids: a tester is `uuid5(EA_NS, "<beta id>|email:<address>")` with `EA_NS =
43265d5b-adc8-4882-aeed-b4433a61b096`, so one person is in one beta once.
Feedback rows use the contract's rule (`FEEDBACK_NS`, source `form` and the
check-in row's id; `survey` and the response's id; `mail` and the message's
id). A draft is `uuid5(EA_NS, "draft|<kind>|<tester id>")`: one chase per
tester, ever, and `chased_at` says it went.

## Choices worth knowing

- **Fit is one closed Decisions call; the reason is the agent's.** Decisions
  answers closed questions only, so `early-access-picker` writes the line
  from the same facts, and `early_access_fit` keeps it only when it shares
  words with a fact (else the strongest non-sign-up fact is the reason). A
  member's own fit (`Set fit` in the drawer) is kept and goes to the next
  read as an example.
- **"Picked" until the invite goes.** Let in sets `picked`; Mail sending the
  invite (`early_access_on_draft`) makes them `invited` and turns their
  status page to You're in. "I'll write myself" does both at once.
- **Without PostHog nobody is inactive.** Usage reads "not connected" and the
  sweep marks nobody quiet and drafts no chase; the day-6 check-in still
  comes.
- **Replies count as shared** (decided 2026-11-26): a tester's reply in a
  thread whose subject is an Early access note the member sent goes to
  `feedback` (`source` mail, `heard_by` the member, `conversation_id` set).
  Matching is by sender and subject, since a new draft has no thread yet.
- **The check-in page is open to anyone with the link**, not to confirmed
  contacts: a tester opening it from their mail in a new browser would have
  to prove their email again. The random `ref` in the link is what ties an
  answer to a tester; an answer whose ref names nobody let in is dropped.
- **The drawer is `/p/<tester>`**, not `?p=`: the SDK refuses a query string
  in an app's path.
- **`early_access_publish` is not a function of its own**: `setup_save`
  writes the page row and `set_status` (shared code) each status row.

## Install

```bash
# from the repository root
uv run --no-project python _build/install.py early-access --pod <pod-id> --var early_access_slug=<free slug> --var inbox_slug=<free slug>
```

Then open Early access: set up a beta (or load the sample) and press Turn
on. Turning on needs edit access in the Lemma (a table opened to visitors,
the widget, triggers on shared tables); a member without it is told so.
`bin/grants.sh` regenerates every function's grants; `bin/common.py` copies
`bin/shared/*.py` into the functions (`--check` to verify);
`bin/demo-fixtures.py` writes the demo's sample. `bin/lemma` is the CLI bound
to one Lemma from a gitignored `.lemma.env`.

## Seen on 26 Nov 2026, on a hosted scratch Lemma

Installed server-side into an empty Lemma (Mail + Early access): COMPLETED.
Walked as the one member, the members' side through the dev server signed
in with the CLI's session, the visitor pages on the hosted app in headless
Chrome.

- **Set-up and Turn on**: PostHog connected from the app, its flags listed
  from PostHog's MCP server (`feature-flag-get-all`, read-only), a beta saved
  with the shared `feature` made at stage beta; every Turn on step read back
  ok: sign-up table open to contacts for 8 fields and contact-owned, the
  check-in table open for 6, the widget, both triggers with
  `include_outside_rows: true`, the hourly sweep, the page on. The memory
  block landed in `/memory/AGENTS.md`.
- **A visitor end to end**: the page drew the beta and its questions; a code
  was sent to a `.example` address and the page reached its code step. The
  code itself couldn't be entered (no inbox; the server has no test code), so
  the sign-up was made as a contact vouched by a host token signed with the
  widget's secret, as Booking did. `early-access-signup` ran: tester waiting,
  Decisions fit strong (0.99), the picker's reason naming what they said,
  the status page read **Waiting** within seconds. A second visitor the same.
- **Email proof**: the roster checked both contacts as the member and marked
  them **Email not confirmed** (a host-token contact has no code-proven
  address), which is right.
- **The sheet**: both ranked with reasons; the invites drafted by
  `early-access-writer` in the member's voice, quoting their sign-up; **Let
  in 2 and send the invites** let both in (`picked`, flag "No cohort chosen",
  said in words), the batch recorded, and the invites stayed drafts: the
  scratch Lemma has no mailbox, so nothing was sent.
- **Sweep on a real PostHog read**: HogQL over `$feature_flag_called` for the
  flag, by person email, ran on PostHog (`execute-sql`); usage "read", 0
  people (the testers aren't PostHog users).
- **Check-in**: answered on the hosted page by ref; two `feedback` rows
  (praise; a blocker, since they hadn't used it yet) under the beta's feature.
- **Sent and replied (simulated)**: with no mailbox, an invite draft was set
  `sent` by hand and an inbound reply row added in Mail's tables: the bundled
  triggers ran `early_access_on_draft` (invited, status You're in) and
  `early_access_on_reply` (one `feedback` row, source mail, the quoted
  history cut off).
- **Today**: "Next 2 for … are ready" (closed by the press), "2 invites …
  ready to send", "1 new blocker from … testers".
- **Sample**: load wrote 99 rows (40 testers, 5 batches, 9 feedback rows, a
  drafted chase); clear removed exactly those 99 and left the real beta.
- **Light, dark and 375px** from rendered screenshots of the demo (roster,
  drawer, sheet, settings, sign-up, status), and of the live roster, drawer,
  sheet and set-up: no sideways scroll.

## Things that bit

- **A bundled MCP connector lands on the wrong server.** The importer binds
  `posthog` (catalog `mcp`) to the organization's first MCP install (here
  another server's), sharing a PostHog account under it is refused
  ("installation_mismatch"), and a connector's installation can't be
  changed. The app removes an empty, unshared `posthog` on a non-PostHog
  install just before sharing, so sharing declares it anew.
- **Removing a connector drops the functions' grants on it**, and declaring
  it again doesn't restore them. Once PostHog reads as connected the app
  puts `connector.use` back on the four functions that call it.
- **`contact_owned` needs `contact_columns`** on import (the first install
  stopped there); the sign-up table gives its contact only `ref`.
- **`draft.source_account` can't be null**: a draft made before Mail has a
  mailbox carries an empty one, and the app says it waits for a mailbox.
- **A host-token session reads as not a contact until it starts**: the page
  treats "already a contact" with nothing kept in the browser as confirmed.

## Not built or not verified

- **Adding to the PostHog cohort**: written to PostHog's API
  (`PATCH …/cohorts/{id}/add_persons_to_static_cohort/`, body `{"person_ids":
  [uuid]}`, cohort:write) as the MCP tool
  `cohorts-add-persons-to-static-cohort-partial-update` with `{"id", "person_ids"}`
  and `call --json --confirm`. The test key has no write scope, so its schema
  couldn't even be printed, and it was never run. Same for removing someone.
- **The email code itself** (see above), and a **real Mail send**: no mailbox
  on the scratch Lemma, so no invite, check-in or chase left a mailbox.
- **PostHog survey answers to feedback**: written to
  `surveys-responses-list`'s schema; no survey ran.
- A second member, the check-in and chase drafted by a real sweep on day 6
  and day 7, and a member without contact access seeing "Email not checked".
- LaunchDarkly, Statsig, GrowthBook and Mixpanel flags; referral
  leaderboards, places in line, invite codes; a whole company let in at
  once; a Slack beta channel (needs lemma-platform#1245). Out of v1.
