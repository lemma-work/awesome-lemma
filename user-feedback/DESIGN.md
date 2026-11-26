# Feedback app: design

One app, `feedback`, with three views in its header: **Inbox · Features ·
This week**. Built on the shared kit (`_kit`): the `--c-*` roles only, Inter,
nothing heavier than 500, lucide icons, every status a pill with a word.
Light and dark come from the host; 375px works with no sideways scroll.

The approved mockups were Main (A, the inbox), Phone, Features (B) and Week
(C). The app follows them, with the differences listed at the end.

## A · Inbox (`/`, `/mine`, `/unfiled`, `/aside`)

The screen used fifty times a day. A list on the left, the selected quote on
the right.

- **Tabs**: To file (state `new`), From your mail and meetings (the person's
  own unshared sentences), Not filed (kept, no feature), Set aside. Each with
  its count. Product scope (All, Ours, Rivals) and source on the right.
- **A row**: the source's icon, the quote in two lines, who said it (role and
  company, or "A Hacker News commenter"), where and when; on the right the
  feature it is filed under (sparkles: the Lemma's filing) and the kind and
  importance pills.
- **The pane**: where and when, the quote at 15px, one line saying what the
  team can see (only the sentence; the thread stays with whoever heard it),
  the person with their earlier quotes and their company's deal, **File
  under** with up to three choices, What they're doing, How much it matters,
  the ask line for a request, and the actions.
- **Why each choice**: Decisions answers with a value and a confidence, never
  text. So the line under each choice is worked out from the filing row:
  `Names “SAML”` (the feature's name or another name, whole), `Says
  “export”` (some of its words), else "The Lemma's pick · sure / not sure",
  and for the other two, "Close to the pick, same area". No agent per quote.
- **Keys**: J/K next and previous, Enter keep as filed (share, on the private
  tab), M move (a feature picker with search), X set aside (keep private).
  Never while typing or with a sheet open.
- **The private gate**: the "From your mail and meetings" tab says only this
  person can see it, with an Always share switch (`auto_share`). Share with
  the team / Keep private.
- **Each member's set-up**: a strip at the top until they answer: read my
  mail, read my meetings, share on my own. Saving reads their last three
  weeks once.
- **Add a note**: a sheet for something said where the Lemma doesn't read.

## Phone (≤720px)

As the Phone mockup: the title with search and add as icons, the three views
under it, tabs To file · Yours · Not filed, one column of quotes at 14px. The
selected quote opens in place with Keep, Move and Set aside at 44px. Move
opens the feature picker; picking files it.

## B · Features (`/features`, `/f/<id>`)

- **Left**: the list by area, with people, companies, blockers and this
  week's count (warning colour when three or more above usual). "Not on the
  list yet" holds suggested features. Search on `/`.
- **Main**: the area, the name with its stage pill ("Stage is set by Roadmap,
  Early access and Release notes": this plugin never moves it), the facts row
  (quotes, people, companies, blockers, open deals behind them, this week
  against usual: the same columns Roadmap ranks by), then quotes **by
  company** with each company's deal, Newest, or About rivals; filter by
  kind. Rivals' users on the same feature come after.
- **Side**: product, owner, linked work, other names, what it is,
  improvements (child features with their stage and count), who is told when
  it ships, deal value.
- A suggested feature has Add to the list, Merge into… and Drop; an active
  one has Edit (name, description, other names, area, linked work) and Merge
  into…. Period: 7, 30 or 90 days.

## C · This week (`/week`, `/week/<n>`)

- Counters: new quotes, people, companies, said in public, blockers, still to
  file.
- **Rising**: this week against the average of the four weeks before, and at
  least three more people; eight weekly bars (this week in the warning
  colour); a quote, a blocker first.
- **Quieter**: fewer problems than usual (half or less).
- **About your rivals**: the last four weeks, quotes, problems, what is said
  most about, an example.
- Side cards: a suggested feature (add, merge, drop), a likely duplicate
  (merge, keep apart), and Listening: mail and meetings, Hacker News (free),
  Bright Data with records billed this week, Reddit's API date, and the Slack
  channel as not available yet.

## Set-up and Settings (`/setup`, `/settings`)

One page of cards: the product (name, site, other names, phrases that can
only mean it), features (paste "Area > Feature" lines, or let the Lemma
propose them), rivals (read-only when Competitor watch keeps them), listening
(Hacker News on; Bright Data's key added in place, sources, posts per search,
records per day), who files, and the person's own mail and meetings. "Look
around with a sample" on first run; "Clear the sample" while it is loaded.

## Copy

Plain, sentence case. Never "pod", "teammate" or "room"; "colleague" where a
person who heard something is meant. No sample names in copy: the sample's
people are roles at companies. No platform pull request numbers on screen:
Slack says "Not available yet".

## Differences from the mockups

- Slack and form rows are not in the sample: Slack reading waits on a platform
  change, and form answers come through Forms or Early access, not this plugin.
  The dashed "gap" chips of the mockups are not drawn; where something needs
  another plugin the screen says so in words (deal value "shows with Deal
  tracker").
- "Mail, heard by a teammate" reads "Mail, shared by a colleague".
- The duplicate card says what the Lemma did ("read the quotes against your
  list and says it is the same thing, sure") rather than a reason in the
  model's words, which Decisions doesn't give.
- Listening shows Bright Data's records billed, not money: prices depend on
  the team's own plan.
