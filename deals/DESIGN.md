# Deals: design

## Thesis

For **a person who sells, and the small team around them** (a founder, an
account lead), Deals turns **what was actually said in their mail and meeting
notes** into **a pipeline they can trust** by **proposing every change with
the sentence it came from, for a person to keep or dismiss**. It never edits a
deal on its own.

- **Hero moment:** the board, with "Waiting for you" beside it: Brightwave
  Health's renewal, *Proposal → Negotiating*, under Daniel's own sentence
  ("Finance signed off on the two-year term."), one press from kept.
- **First 30 seconds:** the board by stage with totals, the waiting changes
  on the right, the open pipeline's total in the toolbar. No introduction.
- **Information spine:** the deal. Proposals, history, conversations,
  meetings, notes and tasks hang off one deal; the board and the table are
  two views of the same list.

## Direction: one theme across every plugin

Built on the plugin kit (`../_kit`): Lemma's own tokens from the host's
`lemma-app-theme`, Inter at weight 500 at most, lucide icons, the kit's
tables, record layout, drawers, segmented filters, skeletons and empty states.
Deals brings no palette of its own. Its own marks, kept small:

- **The stage meter.** Rising bars, one per open stage, filled to where the
  deal is (won fills them in the success role, lost empties them), beside the
  stage's name. It echoes Lemma's rising-bars mark and needs no colour per
  stage, so it reads the same in light and dark.
- **The sentence.** Every proposal shows the quote it came from, with who
  said it, when, and where (opens the conversation in Mail or the meeting in
  Meetings). A proposal without its sentence is never shown.
- **The Lemma's own work** carries the sparkles icon and the `ai` pill
  ("Written by the Lemma" on the weekly summary), never a colour.

Status is never colour alone: "Quiet", "Won", "Lost", a late close date say
so in words.

## Pages

| Path | What |
| --- | --- |
| `/` | Board by stage (drag a card to another stage; a press without moving opens it), toolbar (Board/Table, Everyone's/Mine, search on `/`, the open total, New deal), "Waiting for you" rail beside it from 1180px |
| `/table` | The same deals as a sortable table |
| `/waiting` | Every proposal waiting for the person: keep, change first, dismiss (why) |
| `/review` | The weekly review: the written summary, the counts (open, new, moved, won, lost, quiet), what moved, gone quiet, pipeline by stage, closing in two weeks, earlier reviews |
| `/settings` | Stages and currency, the review's day and time, "Read my new conversations", the sample |
| `/<deal id>` | Record head (facts as pills), the stages as a stepper, waiting changes, history (the team's, with your own sentence beside what you kept), your conversations, your meetings, notes; properties beside, with Tasks and the team's last contact |

Set-up is the same app, one screen per form of `deals-setup`: People map
first (a button to it), stages, currency, existing deals (paste with a live
preview, or find them, or both), reading (counters), what it found, the
review day.

## Privacy in the layout

Deals, stages, history, notes and reviews are the team's and hold no words
anyone wrote. Proposals and their sentences, conversations and meetings are
the viewer's own (RLS): the deal page labels them "Your conversations",
"Your meetings", and says teammates see theirs. The team's last contact comes
from People map's team view (who, when, how warm), never what was said.

## States

Loading draws the board, the record and the table as skeletons in their final
shape. Empty says what will appear and why ("When a conversation or a meeting
starts a deal, it's proposed here with the sentence it came from"). Keep and
dismiss leave the list at once and say when they land (a function run takes
a few seconds); a failure puts the card back and says why. A
column with no deals says "Drop a deal here" (on a phone, where cards open
rather than drag, "No deals here"). Sample rows are labelled by a banner.

## Responsive

- 1400 and wider: six stages fit beside the 340px rail (it has its own edge).
- under 1400: the rail folds into a "N changes waiting" button and the board takes the width (six stages fit at 1280). A board with more stages than fit scrolls inside its own area; the page never scrolls sideways.
- under 720: the board becomes a list by stage; a deal moves from its page
  (the stepper wraps). The table scrolls inside its frame.
- 375: no sideways page scroll anywhere (checked on the board, a deal, the
  review, waiting, settings, the table).

## Acceptance

- Light and dark follow the host (and the device on its own); checked in
  rendered screenshots, as was 375px.
- Every proposal shows its sentence; nothing changes a deal without a press.
- Every count on the review is a count of rows read, said as such; the
  summary uses only those figures.
