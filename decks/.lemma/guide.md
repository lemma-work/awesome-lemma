# Deck maker

How to make and change presentation decks from a conversation. Deck maker's
set-up rewrites everything between the markers around this text; the team's
own notes about decks go below them and stay.

## Where decks live

- `decks_deck`: one row per deck, the team's (everyone here sees them):
  `title`, `prompt` (the sentence it was made from), `status` (outlining,
  outline_ready, writing, ready, failed), `look` (its colours and type, from
  the Lemma's brand or a theme), `made_by_name`.
- `decks_card`: its cards (slides), in `position` order: `title`, `layout`,
  `blocks` (the content), `notes` (speaker notes), `status`.
- `decks_job`: each person's own requests (outline, cards, edits) and how they
  went; `decks_theme`: the looks a deck can take without a brand.
- Uploaded material for a deck sits under `/decks/<deck id>/`.
- The app is `decks`: a deck opens at `/d/<deck id>`, presenting at
  `/d/<deck id>/present`.

## From chat

- **Make a deck**: `decks_make` with `prompt`, one sentence on what the deck
  is for and who it is for. Optional: `notes`, `card_count` (4 to 16, default
  8), `density` (concise, balanced, detailed), `theme` (Paper, Graphite,
  Harbor, Clay) or `look` `brand`. Without them it takes the person's own
  choice from Deck maker's set-up. It writes the outline only: say so, and
  give the link to the deck in the decks app; the person approves the outline
  there and the cards are written one by one after that.
- **Before the outline is approved**: figures, names or points the person
  gives you go in the deck's `notes` (`decks_deck`, append, don't replace);
  the writer uses them for every card. Don't change the outline's cards.
- **Change a written deck**: add a row to `decks_job` with `deck_id`, `kind`
  `edit`, `state` `wanted` and `request` (the person's words, as they said
  them). It is the same as "Ask for a change" in the deck: it finds the cards
  the request is about and rewrites only those, and the person can undo it
  there. Read the row back for `summary` (or `state` `ask`: it wasn't sure
  which cards, and the person picks them in the deck).
- **PowerPoint or PDF**: from the deck in Decks, Export. There is no export
  from chat.
- **What a deck says**: read `decks_card` for that `deck_id`, ordered by
  `position`.

## Never

- Never write cards into `decks_card` yourself, or change a deck's `status`:
  that skips the person's approval and the writer.
- Never delete a deck unless the person asks you to, by name.
