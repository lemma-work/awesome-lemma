#!/usr/bin/env bash
# Every function's description and grants, in one place. Regenerates
# functions/<name>/<name>.json; never edit those by hand.
#   table        read          table:rw   + write rows       table:rwd  + delete rows
#   /folder:verbs              connector:<id>
set -euo pipefail
cd "$(dirname "$0")/.."
f() { uv run --no-project python bin/fnjson.py "$@"; }
f leads_setup_prepare "Set-up: People map's relationship kinds with how many of the person's people are each (customers, investors and partners on; colleagues and other never), their customers' companies as examples of a good fit, and the team's description when someone already wrote it." leads_settings leads_profile people_settings people_person company
f leads_setup_apply "Set-up: keep who fits the team (one per Lemma; anyone may change it), and the person's own kinds of people to look up and how many look-ups a day." leads_settings:rw leads_profile:rw leads_person people_person
f leads_consider "Worth looking up? One Decisions call per person People map counts as someone the person deals with, of a kind they chose; their corrections are the examples, an answer under 0.5 waits for them. Personal addresses are skipped by rule." leads_settings leads_profile leads_person:rw leads_correction people_person person company
f leads_claim "Give queued people a place in today's look-ups, best first, up to the person's daily limit; the rest wait for tomorrow." leads_settings leads_person:rw people_person
f leads_setup_done "Set-up: everyone proposed joins the queue (today's places go best first) and the set-up is done." leads_settings:rw leads_person:rw
f leads_memory "Tell this Lemma's agents that Lead research is installed: its block in /memory/AGENTS.md and its guide at /memory/plugins/leads.md (how to ask for a look-up from chat, where lead facts live)." /memory:read,write
f leads_lookup_context "Start one look-up: mark it running, ask People map's company look-up when the company has none, and gather the person's name and the company (nothing anyone wrote). Personal addresses and reserved test domains are not found at once, with no search." leads_person:rw person people_person company people_company:rw
f leads_save "Keep what the look-up confirmed: the person's facts on their lead and the company's on the team's company row, each with its link and when it was found; drop anything without a usable link." leads_person:rw leads_company:rw
f leads_fit "How well does this company fit the team? One Decisions call against the team's description and example companies (score 1-5, what matches, what misses); the companies people corrected go into the question and their evidence goes as examples. Waits for People map's company look-up when it is running." leads_settings leads_profile:rw leads_person:rw leads_company:rw company people_company
f leads_needs_you "Lead research's part of the day on needs_you: new leads at a company the team fits 4 or 5 to, who wrote to the person or are meeting them, as 'worth a look'; resolves the rest." leads_person leads_company person people_person company needs_you:rw
f leads_correct "The person corrects 'worth looking up?' or a company's fit for the team (kept as a correction the next answer learns from), or keeps or passes a lead." leads_person:rw leads_settings leads_correction:rw leads_company:rw person
f leads_request "Ask for a look-up by person id, email address or name, from the app or from chat: it takes one of today's look-ups or waits for tomorrow; force goes past the limit or looks again." leads_settings leads_person:rw leads_correction:rw people_person person person_handle company
f leads_daily "The daily pass: mark look-ups stuck for over half an hour as failed." leads_person:rw
f leads_sample_data "Load or clear sample leads on People map's sample people: made-up facts with .example sources, then a real fit. Clear removes exactly what load made and puts back any lead it wrote over." leads_settings leads_profile:rw leads_person:rwd leads_company:rwd leads_correction:rwd needs_you:rw people_person company
