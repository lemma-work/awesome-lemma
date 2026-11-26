# User feedback

What people say about your product and your rivals, filed under the feature
it is about.

User feedback reads each member's sorted mail and summarised meetings (as
them, keeping what it finds private until they share it) and public posts
about the product and each rival (Hacker News free; YouTube, X, Reddit,
TikTok and LinkedIn through the team's own Bright Data key). It finds the
sentences that are feedback, word for word, and files each one under one of
the team's features with what the speaker is doing and how much it matters to
them. One inbox to keep, move or set aside each quote; a page per feature with
every quote by company; and a weekly view of what is rising.

It carries People map, and with it Mail and Meetings (`plugin.json`). It
writes the shared `product`, `feature` and `feedback` tables that Roadmap,
Competitor watch, User interviews and Early access read and write
(`_contract/tables`), and the shared questions for reading a passage
(`_contract/questions/feedback-read.json`).

## What a team gets

1. **Team set-up**, once, by whoever opens the app first: the product (name,
   site, other names, phrases that can only mean it), its features (paste
   "Area > Feature" lines, or let the Lemma propose them from what people
   say), rivals (unless Competitor watch keeps them), public listening, and
   who files. Or **Look around with a sample**.
2. **Each member's set-up**: read my mail (on), read my meetings (on), share
   what customers say about the product on my own (off). Saving reads their
   last three weeks once.
3. **Every sorted people conversation and every summarised meeting** is read
   by the member's own run (`user_feedback_read`): a yes/no gate, the
   sentences that are feedback picked by number (so the quote is the
   speaker's words), then per sentence the product, feature, kind, sentiment,
   importance and rivals named. Kept in `user_feedback_heard`, which only that
   member can read, until they share it. Rival mentions stay there whether
   shared or not (Competitor watch reads them as the hearer).
4. **Public posts** land in the inbox already team-wide (`is_public`, no
   hearer), read the same way.
5. **The inbox (A)**: J/K, Enter keep, M move, X set aside. Each kept request
   from someone with a handle becomes an `ask` against the feature's linked
   work (else the feature itself), so whoever tells askers (Release notes)
   tells them where they asked when it ships.
6. **A feature (B)**: every quote by company with the company's deal, rivals'
   users on the same feature, improvements as child features, linked work and
   who is told.
7. **This week (C)**: rising and quieter against the four weeks before, what
   is said about rivals, a suggested feature and a likely duplicate to act
   on, and where listening stands with Bright Data's records.
8. **Today** (`needs_you`, verb `decide`): "4 quotes from your mail and
   meetings to share" for each member; "8 new quotes to file", "A suggested
   feature: Bulk edit" and "Looks like the same feature" for filers.

## How it works

| Part | What it does |
| --- | --- |
| `user_feedback_read` | A member's own run, started by their sorted `conversation` (kind people) or summarised `meeting`. Reads only messages after the last read (`user_feedback_read`, which also counts the Decisions calls). Mail's thread document gives the turns; a meeting's `[m:ss] Speaker:` lines give `at_seconds`; a meeting with only the member's notes is read as `source = note` (their words). Skips a thread an Early access draft started (Early access shares those). With `auto_share` on, shares at once. `catch_up` reads recent ones for a first set-up |
| `user_feedback_share` | Heard → `feedback` with the same id (the contract's FEEDBACK_NS rule): the sentence and who said it, never the thread; the filing goes with it. Or keep private |
| `user_feedback_file` | New `feedback` without a feature (any writer): the shortlist (all features up to 63; past that, those whose words the quote says, their parents, then every parent), one Decisions call, a `user_feedback_filing` row with up to three choices, the confidence and the words matching each |
| `user_feedback_keep` | keep, move, set aside, restore, unfile; kind and importance. A person's move sets `filed_by = person`, which becomes a worked example for the next reads. Writes the `ask` |
| `user_feedback_on_feedback` | Any plugin's row reaching `processed` gets its `ask` the same way: one rule, one writer of asks |
| `user_feedback_note` | A note a member types, straight to `feedback` (source `note`) |
| `user_feedback_feature` | create, update (linking work repoints the feature's asks), accept, merge (feedback, children, asks and other names move across), drop (a suggestion's quotes go back to Not filed), keep apart |
| `user_feedback_listen_hn` | Hourly: Algolia's HN search by date for each active product's phrases since the last read; at most 24 posts a run, oldest first |
| `user_feedback_listen_start`, `user_feedback_listen_poll` | Bright Data's Web Scraper API through an OpenAPI connector made from `brightdata/openapi.json` in this repository (served from GitHub's raw URL). Keyword discovery on YouTube, Reddit, TikTok; X and LinkedIn follow the product's own account. Each source and product at most once a day; the poll reads three posts at a time, 12 a run, and records what Bright Data billed |
| `user-feedback-nightly` | Files what is waiting; `user_feedback_suggest_prepare` → the `user-feedback-grouper` agent (no tools; quotes in, groups with names and the one-line `point` per quote out, in one batch) → `user_feedback_suggest_save` (a suggested feature per group of three or more, a Decisions check of its name against the shortlist for the duplicate card, points written only where empty, ids checked against rows) → Today |
| `user_feedback_needs_you` | Today's items for whoever it runs as |
| `user_feedback_setup_save`, `user_feedback_member_save`, `user_feedback_memory`, `user_feedback_sample_data` | Set-up, a member's own choices, the memory block and guide, the sample |

**Schedules.** Bundled, DATASTORE: a sorted people conversation and a
summarised meeting (run as the row's owner), new feedback (file), feedback
kept (ask). Made by the app as the person who saves set-up: hourly listening,
the nightly pass, and a 10-minute Bright Data poll while it is on. Each filer's
app makes their own trigger that keeps "new to file" current in their Today.

**Why the reason under each choice is code.** Decisions answers with a value
and a confidence, never text. The line is the words of the quote that match
the feature's name or other names ("Names “SAML”"), else "The Lemma's pick"
with sure or not sure. No agent per item.

**Bright Data.** The key is pasted in Settings; the app makes the
organisation's OpenAPI connector config from the spec URL, the account with
the key, checks the key in a function (a 401 in the browser would read as the
person's sign-in ending), and pins the account on the three functions that
call Bright Data. Set-up shows about how many records a day it will bill.

## Tables

Own: `user_feedback_heard` (RLS), `user_feedback_filing`,
`user_feedback_member` (RLS), `user_feedback_settings`,
`user_feedback_listen`, `user_feedback_post`, `user_feedback_read` (RLS, the
read cursor and cost per conversation), `user_feedback_sample_row`.
Carried from the contract: `product`, `feature`, `feedback`, `ask`, `deal`
(read for deal value; written only by the sample). From People map, Mail and
Meetings: `conversation`, `meeting`, `person`, `person_handle`, `company`,
`company_domain`, `draft`, `needs_you`.

## For other plugins

- The app is `feedback`: `openApp("feedback", "/")` (inbox), `/f/<feature
  id>`, `/week`. Roadmap's banners already use that name.
- Read feedback with the same questions: embed
  `_contract/questions/feedback-read.json` between `# contract:feedback-read`
  and `# end contract`. This plugin's reader is `bin/blocks/reader.py`.
- Write `feedback` rows with the contract's id; set `state = processed` and
  User feedback writes the `ask`. Don't write asks yourself.
- Competitor watch: `user_feedback_heard` columns as listed in the contract
  note (product_id, compared_with, feature_id, kind, handle_kind, handle,
  name, company_id, source, source_id, conversation_id, said_at, share_state).

## Measured

On a hosted test Lemma (26 November 2026), with this bundle installed by the
server-side import (`_build/install.py`: COMPLETED, every part CREATE, no
warnings) and the sample loaded by `user_feedback_sample_data`.

- **Filing accuracy on the sample** (`bin/bench-filing.py --n 30`): 30 of the
  sample's quotes copied in unfiled, filed by the bundled trigger, one
  Decisions call each.
  - First time: **25 of 30** under the sample's feature. Of the five: two
    belonged to a *suggested* feature (Bulk edit), which filing never offers,
    so they came back unfiled for the nightly pass, as designed; two were
    "Export to Excel" quotes filed under CSV export (the duplicate the sample
    plants); one was filed under the improvement "Exports over 50k rows"
    rather than its parent CSV export, arguably better than the sample's
    answer.
  - After those five were moved by hand (corrections, `filed_by person`,
    passed as worked examples): **24 of the other 25**.
  - 55 filings, 55 Decisions calls.
- **The gate on Mail's sample** (36 conversations, 26 of them people; read by
  each member's own trigger, which ran as the conversation's owner):
  - against the sample product, 5 of 26 passed the gate and 8 sentences were
    kept: two real problems (an export bug), two thank-yous, four about a
    renewal and pricing; no receipt, invoice, scheduling note or newsletter;
  - against an unrelated product, with the questions as they are now, 1 of 26
    passed the gate (the renewal thread) and 2 sentences were kept, both about
    renewal pricing. **No receipt or scheduling message passed.**
  - Cost: 28 Decisions calls for 26 conversations (one gate each; three more
    for the one that passed). The earlier run took 38.
- **Hacker News** (a real product and two real rivals, three days, 17 posts):
  the first version of the questions kept 32 sentences, most about other
  tools in the same threads (about 10 were about the product). The gate and
  sentence questions now say "one of the products named in the instruction",
  and the product question can answer none: the same 17 posts gave **11
  sentences, 9 of them about the product**, in 39 Decisions calls (63 before).
- **Nightly pass** (`user-feedback-nightly`, started by hand): four notes about
  a dark theme were added unfiled; filing left three unfiled and put one under
  an area. The grouper agent named **"Dark mode"** (suggested, 3 quotes) and
  wrote 80 one-line points in one call; the Decisions duplicate check ran.
- Keep wrote the `ask` against the feature (no linked work); a note filed
  under CSV export wrote its `ask` against the linked GitHub issue. Merge moved
  4 quotes and carried the name over as another name. Today got "4 quotes from
  your mail and meetings to share", "N new quotes to file", the suggested
  features and the duplicate. The memory block and guide were written.
- Clearing the sample left only rows a person added meanwhile (four notes and
  their ask).
- The app: in the Try it demo, light, dark and 375px, no sideways scroll on any
  view; J/K/Enter/M/X, share, keep private, merge and accept work on the
  in-memory sample.

## Not verified

- **The app signed in on the hosted Lemma** (it needs a person's sign-in in
  the frame): only the demo build and the functions from the CLI were used.
  The app's own schedule creation (hourly, nightly, the 10-minute poll, each
  filer's Today trigger) is untested; the nightly workflow ran by hand.
- **Bright Data**: no key was available. Adding a key in Settings (the
  organisation's OpenAPI connector config, the account, pinning it on the
  functions) and `listen_start` / `listen_poll` are adapted from the opinions
  pod and never ran here. The spec's URL (`brightdata/openapi.json` on GitHub)
  only resolves once this folder is on `main`. An app page may be refused
  creating an organisation account (another plugin found accounts can't be
  added or shared from an app's page); the set-up then says so and offers to
  ask someone who can.
- A real meeting transcript (only the parser, on hand-made `[m:ss]` lines),
  two members, a member with `auto_share` on receiving mail, more than 63
  features (the shortlist), and an inbox past 5,000 quotes (the app reads
  the newest 5,000).
- Slack: off. Reading a channel waits on a platform change that isn't merged.

## Working on it

```bash
uv run --no-project python bin/common.py            # copy the shared blocks into every function (--check to verify)
uv run --no-project python bin/demo-fixtures.py     # the demo's sample, from the sample function's build()
node ../_kit/bin/demo.mjs user-feedback             # the Try it demo
uv run --no-project python bin/fnjson.py <fn> "<description>" table:rw ...   # a function's grants
```

`bin/lemma` binds the CLI to a test Lemma from the environment or a
gitignored `.lemma.env`.
