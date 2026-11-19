# Lead research

What the Lead research plugin holds and how to use it from a conversation. Its
set-up rewrites everything between the markers around this text; the team's
own notes about it go below them and stay.

## What it does

- Looks up each new person People map counts as someone you deal with
  (customers, investors and partners unless the person chose otherwise; never
  colleagues or "other") the first time they matter: their role, what their
  company does, its size, recent news, and how well the company fits the
  team's description of a good fit, 1 to 5.
- "Worth looking up?" and the fit are Decisions calls; corrections are the
  examples, and corrected companies go into the fit question. A daily limit
  (`leads_settings.daily_limit`, 10 by default) holds the automatic look-ups;
  the rest wait for the next day, best first.

## Where lead facts live

- `leads_person`, each person's own, id = the person's id: `state` (skipped,
  unsure, proposed, queued, wanted, looking, ready, failed), `role`,
  `location`, `profile_url`, `summary`, `facts` (each `{key, label, value,
  url, source, found_at}`), `not_found`, `review` (new,
  kept, passed), `worth_reason`.
- `leads_company`, team-wide, id = the company's id: `facts` and `news` (each
  with `url`, `source`, `found_at`, and a news item's `date`), and the team's
  fit: `fit` 1 to 5, `fit_sure`, `fit_why`, `fit_by` (decision or person).
- `leads_profile`, team-wide, one row: who fits the team (`fit_sentence`,
  `fit_examples`). Any member may change it.
- What a company does, its size and head office: the shared `company` row and
  People map's `people_company.research` with its `research_sources`.
- The app is `leads`; a lead opens at `/<person id>`.

## From chat

- **Look someone up**: run the function `leads_request` straight away, with
  one of `person_id`, `handle` (their email address) or `name`, and nothing
  else; it finds the person itself. Someone at a made-up `.example` address
  is sample data: their look-up says "not found" at once and costs nothing.
  Its `message` says what happened: looking them up now, already looked up,
  or today's look-ups are used and they wait for tomorrow. Tell the person
  that, in those words, and stop. Only when they then say to go past the
  limit (or to look again), run it once more with `force: true`.
- **Read a lead**: query `leads_person` by the person's id (see above); a
  look-up takes one to three minutes.
- **Correct an answer**: `leads_correct` with `person_id` and `worth` (true or
  false), `fit` (1 to 5) or `review` (kept or passed). A correction teaches
  the next answer.
- **Answer from the facts**: give a fact with its link and the date it was
  found. "Not found" is an answer: say so, and never fill the gap from memory.

## Never

- Never state a fact about a person or a company without its source link.
- Never look up colleagues, people marked "other", or anyone for personal
  reasons: Lead research is for people at work.
- Never put personal details (home, family, health, private contact details)
  in a lead, even when a page shows them.
- Never skip, correct, keep or pass a lead unless the person asked.
- Never get round the daily limit yourself: no `force` unless the person
  said so after hearing the limit was used, and never run `leads_claim`.
