#!/usr/bin/env bash
# Every function's description and grants, in one place. Regenerates
# functions/<name>/<name>.json; never edit those by hand.
#   table        read          table:rw   + write rows       table:rwd  + delete rows
#   /folder:verbs              connector:<id>
set -euo pipefail
cd "$(dirname "$0")/.."
f() { uv run --no-project python bin/fnjson.py "$@"; }
f deals_setup_prepare "Set-up: propose the team's stages (Lead, Talking, Proposal, Negotiating, Won, Lost) and a currency, or say the team's are set and go straight to bringing in deals." deals_member:rw deals_settings deals_stage people_settings deal
f deals_setup_apply "Keep the team's stages (renamed ones rename on every deal; a removed one's deals move to the first open stage) and currency." deals_member:rw deals_settings:rw deals_stage:rwd deal:rw deals_history:rw
f deals_find "Set-up: how many conversations and meeting notes from the last 30 days there are to read for deals, as passes." deals_member:rw conversation meeting
f deals_read "Read conversations and meeting notes with someone at a company for deal changes: one Decisions call (does this change a deal?) and, on a yes, a second (what kind?). The person's dismissals and corrections are the examples. Returns the yeses for the extractor." deals_member deals_settings deals_stage deal deals_read:rw deals_change deals_correction conversation message meeting person_handle people_person people_settings company company_domain mail_mailbox meetings_calendar /mail-sample:read /meetings-sample:read
f deals_propose "Keep what the extractor found as proposals, each with its sentence word for word from what was said; never changes a deal." deals_stage deal deals_change:rw deals_read:rw
f deals_save "A person's change to a deal: keep or dismiss a proposal (a dismissal or an edit becomes an example), edit a deal (drag on the board), add one, note one, delete one. Every change leaves the team-wide history." deals_member deals_stage deals_settings deal:rwd deals_history:rwd deals_note:rwd deals_change:rw deals_read deals_correction:rw deals_sample_row:rw company company_domain conversation meeting
f deals_sheet "Read deals pasted from a spreadsheet (preview), or add them to the team's deals (import)." deals_member deals_stage deals_settings deal:rw deals_history:rw company company_domain
f deals_review "The weekly review, counted with no model: what moved, what went quiet (People map's warmth on the deal's people, team-wide), the pipeline by stage, what closes soon. Keeps this week's review and its written summary." deals_settings deals_stage deal deals_history deals_review:rw people_link
f deals_setup_done "Set-up, last step: keep the team's review day, count what set-up found, and start reading this person's new conversations and meeting notes." deals_member:rw deals_settings:rw deals_change deals_read deal
f deals_sample_data "Load or clear four made-up deals with weeks of history at People map's sample companies. Clear removes exactly what load made, and Deal tracker's own rows read from the sample mailbox and calendar." deals_member deals_settings deals_stage deal:rwd deals_history:rwd deals_note:rwd deals_change:rwd deals_read:rwd deals_correction:rwd deals_sample_row:rwd company company_domain needs_you:rwd
f deals_needs_you "What Deal tracker needs of the person, in the shared needs_you (Today shows it): proposals to decide, next steps due on deals they own, their deals gone quiet; and what no longer does, resolved. Counted, never asked." needs_you:rw deals_member:rw deals_change deal people_link
f deals_memory "Tells this Lemma's agents that Deal tracker is installed: its own block in /memory/AGENTS.md and its guide at /memory/plugins/deals.md, leaving the team's notes alone. Set-up runs it; safe to run again. remove takes both out." /memory:read,write
