# Release notes: design

## Thesis

Two jobs that rivals keep apart: writing the note, and telling the people who
asked. A changelog tool writes a page; a feedback tool keeps a list of who
asked. Here the note is drafted from what merged, every line keeps its
sources, and publishing it hands a reply to each person who asked, in the
place they asked: their email thread, their GitHub issue, their Slack thread.

So the app is two working screens over one release, not a page builder:

- **The draft desk** (`/`): what merged on the left, the note in the middle,
  the selected line's sources and where it goes on the right. The before and
  after no rival shows: 24 merges become nine lines, and the 15 left out say
  why.
- **Who asked** (`/asked`): everyone who asked for what is in the note,
  grouped by line, and the selected person's thread with the reply drafted
  under it.

The public page (`changelog`) is a second app, Public, read by anyone.

## Direction: a dense engineering tool on the kit

Engineers and product people use it daily, so it looks like GitHub or Linear,
not a drawn world: the kit's tokens, Inter at 500 at most, lucide icons,
tables, cards with hairlines, pills with words.

- **One accent per screen**: Publish on the desk, Send on Who asked. Nothing
  else is filled.
- **The Lemma's writing is marked**: the sparkles icon and the `ai` pill on
  the note's head and on each reply's margin ("Drafted in your voice from:"
  with what it was built from). A line a person edited says "Edited".
- **Status in words**: Live in production, Merged, not live yet, Not live
  yet, Told when published, Reply drafted, Comment drafted, Waiting on Priya,
  Suggested, Told. Colour only repeats the word.
- **Nothing only on hover**: each line has a visible pencil; each merged pull
  request a visible leave-out or put-in button; "Same thing they asked for?"
  is a row of buttons under the suggested person.

## Screens

| Route | Screen |
| --- | --- |
| `/` | The open note. Bar: version, repository and range, live state with its source ("Deploy workflow, run 4812, 5 days"), Preview page, Publish. Three columns that fold to one. |
| `/asked`, `/asked/<ask id>` | Who asked. Bar: "v2.14 shipped what 14 people asked for", live since, filters (Yours to tell, Told by others, Public places, Told). List grouped by line; pane with the person, their thread (yours only), the divider "10 weeks later · shipped in v2.14", and the reply. |
| `/published`, `/n/<id>` | Published notes, and one as it went out, with what was sent where. |
| `/settings`, `/setup` | The set-up form; the changelog page's address and switch; your own triggers; the sample. |

Who asked never shows another member's words: a person heard by Priya shows
who, where and when with a lock, and says the reply waits in Priya's Today.

## Real states instead of the mockups' annotations

The mockups' dashed "Gap" and "Needs Triage" marks are not drawn. In their
place: the live pill names its source (the deploy workflow's run; a tag);
until a release is live the bar says "Ready when the Deploy workflow
finishes". The set-up shows "Deployment" as a disabled choice with one plain
line. Who asked has an empty state that says where asks come from. The card
for the team's own product is not built, and Settings says so.

## Phone (375px)

The desk is one column (merged, note, this line, publish to); the bar wraps;
Who asked puts the list above the pane. Nothing scrolls sideways. The
segmented filters scroll inside themselves.

## Copy

"Lemma" is the only noun for the space; never pod, teammate or room. No
sample names in copy: the sample's names are in its rows only. Replies and
lines are written to the people who use the product, never about the code.
