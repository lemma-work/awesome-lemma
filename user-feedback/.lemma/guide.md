# User feedback

What the User feedback plugin holds and how to use it from a conversation.
Its set-up rewrites everything between the markers around this text; the
team's own notes about feedback go below them and stay.

## What it holds

- `feedback` (shared): one thing one person said about one feature, word for
  word (`quote`), with `kind` (request, problem, praise, question,
  comparison), `importance` (blocker means they won't buy or can't use it),
  who said it (`name`, `company_name`, `handle`) and where (`source`,
  `source_url`, `at_seconds`). `state` new is the inbox; processed is kept;
  set_aside is noise. Rows with `source` note are a member's own words about
  what was said.
- `feature` (shared): the team's list, by area (`parent_id`). `state`
  suggested is the Lemma's proposal; `stage` (idea to live) is set by Roadmap,
  Early access and Release notes.
- `product` (shared): the team's product (`role` ours) and rivals.
- `user_feedback_heard`: sentences from a member's own mail and meetings.
  Only that member can read their rows; never quote one to anyone else, and
  never copy one into `feedback` yourself. They share it, or it stays theirs.
- `user_feedback_filing`: the Lemma's choices for each quote and the words
  that matched.

## Answering questions

- "What do people say about CSV export?" Read `feedback` joined to `feature`
  by name; quote the words as they are, with who said it and when. Group by
  company; say how many people and how many call it a blocker.
- "What's rising?" Compare the last 7 days with the four weeks before, per
  feature. The app's This week view does the same.
- "What do people say about a rival?" `feedback` where `product_id` is the
  rival's, or `compared_with` names it.

## Doing things

- A customer said something the Lemma didn't read: `user_feedback_note`
  (`quote`, `name`, `company_name`, `email`, optional `feature_id`, `kind`,
  `importance`). It goes to the team's inbox, as the member's note.
- Keep, move or set aside a quote: `user_feedback_keep` (`id`, `action` keep,
  move, set_aside, restore; `feature_id` for a move). Keeping a request from
  someone with an email makes an `ask`, so they are told when it ships.
- A new feature, a merge or a drop: `user_feedback_feature` (`action` create,
  update, accept, merge with `into`, drop).
- Open the app: `feedback`, paths `/` (inbox), `/features`, `/f/<feature id>`,
  `/week`.

## Never

- Never paraphrase into `quote`, never invent who said something, and never
  move words out of a person's own mail or meetings into `feedback`.
- Never change `feature.stage`: that belongs to Roadmap, Early access and
  Release notes.
