# Decks: design

## Thesis

> For anyone in a Lemma who has to present, Decks turns one sentence into a
> deck in the team's own brand, by having them approve an outline before
> anything is written, writing the cards one at a time where they can watch,
> and taking changes the way a colleague would: a request touches only the
> cards it is about, which one closed question to the Decisions API decides.

- **Hero moment:** the editor, the deck on the left and in the middle, the Ask
  panel on the right: "Make the pricing card punchier" · Decisions: rewrite
  card 6, 86% sure · "Rewrote card 6. Nothing else changed." · Undo, Wrong
  cards? · and card 6 marked "Changed by your last ask".
- **First 30 seconds:** the sentence box at the top of the decks, with three
  example sentences and the look new decks take ("in Quarry & Kiln's brand");
  under it every deck as its title card, with its state.
- **Information spine:** the deck and its cards; every piece of work on a deck
  is a job of the person who asked (outline, cards, edit), which is how an
  edit can be shown, undone and corrected.

## Direction

The frame is the kit, the same as Mail, Tasks and the other plugins in the
Lemma's sidebar: Inter at 500 at most, the host's `--c-*` roles, lucide icons,
the kit's header, segmented filters, menus, sheet, empty states, skeletons.
`decks.css` only places things.

The slides are the deck's own renderer (`Slide.tsx`, `slides.css`, from the
Decks desk app): 16:9, every size in container-query units so a thumbnail, the
canvas, present mode and print are the same picture, drawn in the deck's look
(`--sl-*`: the brand's colours, faces and logo, or a theme's). That is the one
place the app shows colour and type of its own, because it is the work.

Small marks of its own: the filmstrip's dot on a card the last ask changed,
the card number chips in the Ask panel, the `Decisions` ai pill beside what it
chose and how sure it was.

## Pages

| Path | Page | Reads | Writes |
| --- | --- | --- | --- |
| `/`, `/mine`, `/approve` | The decks, with the sentence box | `decks_deck`, `decks_card` (title cards), `decks_settings` | `decks_make` (and files to `/decks/…`) |
| `/d/<id>` while outlining | The sentence, the outline being written | the deck, its outline job | Try again (the job back to wanted) |
| `/d/<id>` outline ready | The outline: titles, lines, layouts, order; the look; how much text | `decks_card`, `decks_theme`, the brand copy | records (cards, deck); a `cards` job |
| `/d/<id>` writing or ready | Filmstrip, cards, Ask panel | cards, the person's edit jobs | `edit` jobs; `decks_undo`; card words by hand (sheet); move, remove |
| `/d/<id>/ask/<job>` | The same, the unsure question highlighted (Today's link) | | the job's `chosen`, back to wanted |
| `/d/<id>/present[/<n>]` | One card at a time | cards | |
| `/d/<id>/print` | Every card a 16:9 page | cards | |
| `/settings` | The look of new decks, length, chat, the sample | settings, themes, brand | settings; `decks_memory`; `decks_sample_data` |
| set-up | the `decks-setup` run's two forms | the run, themes, brand | `workflows.runs.submitForm` |

## States

Skeleton tiles and cards in the final 16:9 geometry; an unwritten card shows
its outline with shimmering lines while it is being written; a stalled job
(four minutes without a change) says so and offers to carry on from where it
stopped; a card the writer failed on stays with its outline and a "Write it
again"; an edit the call is unsure about asks, with its answer ticked; a deck
that isn't there says so and goes back.

## 375px

One pane; the places become a drawer; the decks one per row; the composer's
examples a row that scrolls; in the editor the filmstrip becomes a row above
the cards and the Ask panel sits below them; present mode fills the screen and
a tap on the right goes on.
