# Triage: design

Picked from the canvas: **A** (Inbox) for the queue, **C** (Case file) as the
page an item opens to, **D** (Doors) for intake, **E** the report form (drawn
by the platform's `widget.js`, not this app). **B** (Board) is a later
segment.

## Screens

- **Inbox (`/`)**: the bar on top (segments Inbox, Accepted, Marked down,
  Declined; Doors and Owners; search on `/`; New report `C`), who's on triage
  with the honest note that rotation and away are set by hand, then every
  door in a line with its state in words. The list: Reach (a figure and its
  unit: "1,240 people · rising", "High reachable · acme/web", "3 people
  asked"), the report (T-number, title, door chips counted, where in the
  code), the suggested owner with the reason, and age. "Needs a decision"
  first, sorted by people reached, then security, then reports; "Marked
  down" below with why. The selected item beside it: pills, facts, reports,
  "Looks like" with Mark duplicate, the Lemma's read (sparkles, `ai`), what
  was checked, the owner, the decision buttons with their keys, and what
  deciding does in words.
- **Case file (`/i/<n>`)**: crumb with "1 of 6 to decide" and `J` `K`;
  header facts; Reports with how each was merged (and Split out); the
  Lemma's read with "it doesn't guess a confidence"; What was checked as a
  table (Source, Asked, Answer, Result); Reach by source with read times;
  Activity; properties beside (status, priority with why, owner with
  alternatives, task, related, who asked, known issue); a sticky decision
  bar (static on a phone).
- **Doors (`/doors`)**: the six steps, then People on the team, People
  outside, Machines: each door's state, what it watches, this week's count,
  how it answers the reporter, and its set-up. The form's sheet has the
  hosted link, the help-page and in-product snippets (host token signed on
  the team's server), Edit fields, and each turn-on step read back.
- **Owners (`/owners`)**: routing and mark-down rules in order, the rotation,
  who's away (Triage's days and Sprints', marked as such), and members'
  GitHub and Slack handles.
- **Set-up (`/setup`)**: six numbered steps, only the first needed, or "Look
  around with a sample morning".

## Rules kept

The kit's: `--c-*` roles only; Inter, nothing heavier than 500; lucide
icons; every pill has a word; one accent per view (Accept on the selected
item or the case file, New report elsewhere); sparkles and `ai` mark the
Lemma's read; menus and sheets open on press; 375px with no sideways scroll
(the list folds to the phone mock's three lines, a row opens the case);
light and dark from the host. Never "pod", "teammate" or "room" on screen.
Orange dashed notes are real gaps, said plainly; the canvas's blue PR tags
are not shown.
