# Know-how: design

One app, `know-how`, on the shared kit (`_kit`): the Lemma's own
`--lemma-app-*` colours through the kit's `--c-*` roles, Inter, nothing heavier
than 500, lucide icons, light and dark following the frame. The three screens
picked from the canvas (`Answers`, `Library`, `Playbook`) are one flow, so
they are tabs and routes of one app: a question opens the page that answered
it, a page lists its questions, and a procedure opens to its Playbook.

## Screens

| Route | Screen |
| --- | --- |
| `/`, `/q/<id>` | **Answers** (home). Segments All, Missed, Past check date, Answered; where and when filters; the summary line; the list grouped Missed, Past check date, Answered. Each row: the question in the asker's words, what answered it (or "No answer yet" and what's next), how many times, where, when, and "Name not kept" on a sensitive topic. The detail beside it: every asking, then the draft from the owner's reply (**Save as answer**), what the Lemma found (**Draft it for …**), Ask the owner, or the answer with its source line and warning; Activity. |
| `/library`, `/library/<topic>`, `/library/mine` | **Library**. Topics and where answers come from down the side, with "Can't be searched (n)". Asked most and Going stale on top (**Ask owners to check**). The table: page, owner, seen by, checked, next check, uses, missed, state; segments All, Past check date, Drafts, Procedures, For customers. |
| `/p/<id>` | A page: the page itself, its source line, facts (owner, backup, topic, seen by, check every, path, uses, misses), the questions it answered; Keep, Edit page, Approve for customers / Take back, Retire. A **procedure** opens as its **Playbook**: steps with "n reached" and "n asked here", a proposed change under its step (**Add to step n**), Assigned, Where it came from. |
| `/p/<id>/walk` | Walk a procedure here, one step at a time: Done, I'm stuck, Stop, a question. |
| `/setup` | The team's set-up: Sources, Read, Owners ("Who knows what?"), Where, Who sees, Done; then the steps only a person can do, each read back. |
| `/me` | Each person's first open: their topics, how to be asked, when to check, procedures assigned to them. |

Paths carry no query string: the Lemma's frame keeps only a plain path.

**Keys** (Answers): `J` `K` move, `W` write it, `O` ask the owner, `C` covered
by…, `S` set aside, `Enter` save the draft, `/` search, `N` new page. On a phone
the list alone; a question opens its detail with the same actions and no keys.

## Rules kept

- **One accent per view**: Save as answer, or Keep on a late page, or the
  selected row. Everything else is the default button.
- **The Lemma's own work** (a draft, a found passage, a proposed step) carries
  sparkles and the `ai` pill, never a colour.
- **Every pill has a word**: Live, Past check date, May disagree, Draft,
  Missed, Partly, Passed on, Answered.
- **Gaps are said on screen** in plain words, with a dashed warning outline:
  misses count only when logged, Teams channels read only when asked, files
  that can't be searched, no SharePoint or OneDrive folders, "checked by" not
  on the Docs page, customers as a second copy, changes checked once a day.
- **375px**: no sideways scroll (checked in light and dark); the Library table
  folds into rows; question rows stack.
- The word "pod" never appears on screen; the noun is "Lemma".

The "Try it" demo adds one panel the live app doesn't have: **Where people
ask**, the same Wednesday as the four askers saw it (a Teams channel, Slack
Connect, email, and a Teams user who isn't a member).
