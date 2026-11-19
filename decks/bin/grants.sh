#!/usr/bin/env bash
# Every function's description and grants, in one place. Regenerates
# functions/<name>/<name>.json; never edit those by hand (bin/fnjson.py, as Tasks').
#   table   read        table:rw  + write rows        table:rwd  + delete rows
set -euo pipefail
cd "$(dirname "$0")/.."
f() { uv run --no-project python bin/fnjson.py "$@"; }
f decks_make "Make a presentation deck from one sentence in Deck maker (Decks app). prompt is the sentence (what the deck is for, who it is for); optional notes, card_count (4 to 16, default 8), density (concise, balanced, detailed), theme (Paper, Graphite, Harbor, Clay) or look 'brand' for the Lemma's brand. Writes the outline only: the person approves it in Decks, then the cards are written. Returns the deck's path in the decks app." decks_deck:rw decks_job:rw decks_theme:rw decks_settings brand /brand:read
f decks_plan "decks-work, step 1: reads the job a person asked for and says what to write. An edit asks the Decisions API which cards the request touches (and what it asks for), so only those are rewritten." decks_deck:rw decks_card:rwd decks_job:rw decks_theme decks_correction:rw brand /decks:read /brand:read
f decks_save_outline "decks-work: keeps the outline the outliner wrote as cards, waiting for the person's approval." decks_deck:rw decks_card:rwd decks_job:rw
f decks_save_card "decks-work: keeps one card the writer wrote, the moment it lands." decks_card:rw decks_job
f decks_finish "decks-work, last step: closes the job and says what was done." decks_deck:rw decks_card:rw decks_job:rw
f decks_undo "Put an edit back as it was. With cards: also keeps the person's pick as a correction and asks the same request again on those cards." decks_deck:rw decks_card:rwd decks_job:rw
f decks_needs_you "What in Deck maker needs the person, written to the shared needs_you list (Today reads it): an outline to approve, an edit to pick cards for, a deck that's ready. Runs as the person." decks_deck decks_job needs_you:rw
f decks_setup_look "Set-up, step 1: the look the person's new decks take (the Lemma's brand, or a theme)." decks_settings:rw
f decks_setup_done "Set-up, last step: the person is set up." decks_settings:rw
f decks_sample_data "load: a made-up roaster's written pitch deck with one edit, and an outline waiting for approval. clear: removes only what the sample made." decks_deck:rwd decks_card:rwd decks_job:rwd decks_correction:rwd decks_sample_row:rwd needs_you:rw
f decks_memory "Tells this Lemma's agents that Deck maker is installed: its block in /memory/AGENTS.md and its guide at /memory/plugins/decks.md, leaving the team's notes alone. Set-up runs it; safe to run again. remove takes both out." /memory:read,write
