# Roadmap

The team's features, ranked by the people who asked for them, with what the
team plans to do about each and a spec drafted from what people said. There
is no score: people, companies, blockers, open deals and won deals are each
a column, and money is deal value from Deal tracker, never recurring revenue.

## What it holds

- `feature` (shared; User feedback keeps the list): each feature's `stage`
  (idea, planned, building, beta, live, declined). Roadmap moves it forward
  only, to planned, building or declined; never to live, never back.
- `feedback` (shared): one quote per row, filed under a feature. `ask`
  (shared): one person asking for one piece of work.
- `roadmap_item`: per feature, the horizon (none, now, next, later,
  shipped), owner, Tasks project, and how the outside page shows it.
- `roadmap_spec`: per feature, the spec's lines and the quotes behind each;
  the text is also a Page at `/pages/roadmap/<feature>.md`.
- `roadmap_public`: the outside page's lines (Public: anyone can read it).

## From chat

- "What should we build next?": `roadmap_rank` (sort people, companies,
  blockers, open, won, last_asked or quotes; since_days; company; horizon).
  Its `text` is a ready answer. Say the sort, and that it is not a score.
- "Who asked for bulk edit?": `roadmap_feature` with the feature's name: who
  asked by company, blockers first, one quote each, and their deals.
- "Put SSO in Now", "give audit log to the Admin team", "decline offline
  mode": `roadmap_set` (horizon now/next/later/none, owner_label,
  owner_user_id, decline). Say what happened to the stage.
- "Make a project for it": `roadmap_project` (a Tasks project, linked).
- "It shipped": `roadmap_ship`. It does not set the feature live and tells
  nobody: Release notes does both when the release goes out.
- "Draft the spec for X": start the `roadmap-spec` workflow with the feature
  as the record. Every line cites the quotes it came from (q1, q2...); a line
  with none says "No quote". Lines a person edited are kept on a redraft.
- "Show the roadmap on our site": the outside page is turned on in the
  Roadmap app's Settings, by a person.

## Never

- Never invent a number, a quote or who asked. Quote word for word.
- Never put a person's name, a company or money on the outside page: only
  `roadmap_set` public_title and public_blurb reach it.
- Never set a feature live, or move a stage back.
- Never tell the people who asked: that is Release notes' (shipped) and
  Triage's (declined) job.

## The app

`roadmap`: `/` ranked, `/?view=board` now / next / later, `/f/<feature id>`
a feature and its spec, `/q/<feedback id>` one quote, `/setup`.
