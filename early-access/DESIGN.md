# Early access: design

## Thesis

> For a product team running a beta, Early access is one roster of everyone
> in it: who's waiting, who's in, who used it this week and the last thing
> each said, sorted by what needs the person. Letting the next batch in is
> one sheet: ranked by fit, a reason that names a fact beside each name, the
> invites already written in their own voice, and one press that does it.
> Nothing else lets anyone in or sends anything.

- **Hero moment:** the sheet (mockup C). Ten ticked rows, each with "Why
  them" ("Open deal whose next step is showing filtered exports.") and what
  they said at sign-up; on the right, what the press does, step by step, with
  the first invite open ("1 of 10") and the two buttons.
- **First 30 seconds:** the roster (mockup A): six facts (signed up, let in,
  tried it, used this week, quiet, said something), a status filter with
  counts and search on `/`, then the table. A quiet tester with a note
  drafted sits on top; the next batch follows.
- **Information spine:** `early_access_tester`, one row per person per beta,
  with its own timeline; `feedback` rows (`plugin` early-access) on the
  beta's `feature`; the person's own Mail `draft`s, matched by `built_from`.

## Direction: a dense product tool on the kit

Drawn on `../_kit` only: Inter at 500 at most, the host's `--c-*` roles (no
hex in `ea.css` or `visitor.css`), lucide icons, the kit's pills, buttons,
segmented filters with counts, menus, the Sheet drawer, search, skeletons
and empty states. Rows at 13px, meta at 12px, heads at 15px, a person's name
at 19px in the drawer.

- **One accent per view.** Roster: Pick next batch. Sheet: Let in N and send
  the invites. Drawer: Send. Set-up: Save and turn on. Sign-up page: Continue
  / Join the list.
- **The Lemma's own work** (a fit's reason, a drafted note, "In next batch")
  carries the sparkles icon and the `ai` pill, never a colour.
- **Pills carry words**: Waiting, Picked, Invited, Active, Quiet, Left, Not
  now; Strong, Maybe, Not now; Flag on, Flag waits for their first sign-in,
  Flag not turned on; Email not confirmed.
- **Usage never guessed.** Without PostHog the usage columns read "—" and the
  fact says "not connected"; nobody is called inactive.

## Screens

| Path | What it is |
| --- | --- |
| `/`, `/b/<beta>` | The roster. The beta switcher is the title (a menu). Below 760px the table becomes one card per person. |
| `/p/<tester>` | The roster with a person's drawer: pills, the fit's reason, the drafted note (Send, Edit, Not now), their beta as a timeline with quotes, Open in Mail, Open in PostHog, Set fit, the by-hand flag tick, Take out of the beta. |
| `/b/<beta>/next` | The sheet: batch size and fit filters, the ranked table with a cut line under the Nth row, the not-now band (Draft a note to each), and the side panel. Below 1100px the side drops under the table. |
| `/b/<beta>/settings`, `/setup` | One page: the feature, the flag (PostHog connected here with the kit's `<Connect>`), the questions, the pace, the mailbox, Save and turn on with each step read back, pause and close. With no beta yet, a sample to look around. |
| `/<beta>`, `/<beta>/status`, `/<beta>/check-in` | The visitor's pages: one calm column, the feature's name over a card. Sign-up with the code step, where you stand, three check-in questions. The kit's CSS, never its script (it would add sign-in headers the widget refuses). |

## Copy

Plain and specific; no sample names in headings or help text ("The only note
they get", "Your mailbox isn't set up in Mail yet, so this waits as a
draft"). Never "pod", "teammate" or "room". A platform error is never shown
as-is: a refused step says what happened and the next step, or to ask
someone who can.
