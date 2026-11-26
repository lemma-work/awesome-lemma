# Forms: the app's design

One app, `forms`, drawn with the shared kit (`_kit`): Inter, nothing heavier
than 500, lucide icons, the Lemma's own `--lemma-app-*` colours through the
kit's `--c-*` roles (light and dark follow the Lemma, switching live), tables
and record layouts rather than cards. The design canvas it follows drew three
directions, A, B and C: Answers is the home screen, Doors the second tab, and
one answer the page a row opens to.

## The frame

One bar on top everywhere: **Forms**, then three tabs (Answers, Doors,
Routing), search on `/` while on Answers, and Set-up. Until the Lemma has a
set-up the app opens on Set-up. While the sample week is loaded a banner
says so, with Clear.

## Answers (A), `/`

- **The strip** says the week honestly: how many answers from how many
  doors, how many are with someone and how many were set aside; the median
  first reply this week against the goal (the median turns orange only past
  the goal); and "No reply goes out on its own: a person sends every one".
- **Segments** Waiting · Not sure · Done · Set aside · All, with counts, and
  three filters: door, kind, owner.
- **Groups**, in this order: Not sure where this goes (first, so nothing
  sits unowned), Waiting for a reply (longest first), Replied or filed, Set
  aside as spam (with why).
- **A row**: the clock (how long it has waited; the only colour on the
  list, and only past the goal, orange then red past four times it), who and
  what they wrote, the door, the Lemma's read (kind with the `ai` sparkles
  mark, and its reason from the closed list), and who it went to.
- **Keys**: `J` `K` move, `Enter` opens, `N` not sure, `S` set aside, `U`
  put back, `R` re-route. Set aside has Undo in its toast too.
- On a wide screen a row opens a **side pane** (what they wrote, the read,
  why it went there, the reply); below 900px it opens the answer's page.
- **On a phone** each answer folds to three lines: who and how long, what
  they wrote, and kind · door · owner. Swipe left sets it aside, swipe right
  marks it not sure; both are buttons on the answer too, so nothing is only
  a gesture.

## One answer (C), `/a/<id>`

A record page. The header has the person and company, the form, where it
lives and when, the kind and state pills (each with its word), where it went
(Deal tracker, Triage) and the owner, and the clock. Actions: Re-route (a
menu of members, with who hasn't opened Forms, Triage when it's here, and
Not sure), Set aside / Put back, Not sure, and **Review and send**, the one
accent, when the reply is drafted in your mailbox. "2 of 6 waiting" with `J`
`K` walks the waiting answers.

The main column, in order:

1. **What they wrote**, in the form's own order and labels; a file is named
   and linked, never read or shown.
2. **The Lemma's read** (sparkles and `ai`): the kind, the reason, how sure.
   A not-sure answer shows the kinds as buttons: a pick routes it and
   becomes an example for the next read.
3. **Why it went to …**: every rule in order, each marked used, not needed
   or none set, with the open deal named.
4. **The reply**: from your own mailbox, to, subject and the drafted body,
   with what it was built from; Send (10 seconds to undo, then Mail sends
   it), Edit; "Also waiting in your Today". For someone else's answer:
   "Drafted for Tomás, in his mailbox". The reply modes and their limits
   are said plainly (chat only; a draft for the owner; the Lemma's address
   for a confirmed contact).
5. **Timeline**: the answer's `forms_event` lines, and "waiting for …" now.

The side column: properties (state, kind, went to, owner, door, arrived,
first reply, page, campaign, what it became), **who they are** (the owner's
People map card; for everyone else the company and its open deal, since a
person's threads stay theirs), and **Lead research's read** when it's
installed, or "Look it up now".

## Doors (B), `/doors`

Segments All · Taking answers · Needs you · Coming soon. Groups: On your
website, Connected accounts (read every 15 minutes), Other plugins' forms
(counted here, kept there), form tools through a webhook, and Coming soon
(five rows with the blue "Needs the webhook address" tag). A row has the
door and where it lives, seven days of bars and the count, the last answer,
the median first reply, who gets it in words, and its state as a pill with a
word (Taking answers, Paused by Noor, Stopped Monday, Not yet). A stopped
door gets the one banner, with "Sign in to … again" for whoever's account it
is. Add a door is a sheet: a website form to turn on, a Google Form by its
edit link, Meta (not checked yet), another form tool (coming soon until the
webhook address is live in the Lemma).

**A door's panel** (`/doors/<id>`, beside the list on a wide screen, a page
on a phone): "a table of 7 fields · held open by Ellis", Pause, Hold it open
yourself; Share it as a link, on your page (the snippet, with hidden `page`
and `campaign`) or in your product (`Lemma.addRow` with a host token);
Fields (rename a label, switch one off); Where answers go (and the default
owner); How fast they hear back (the three reply modes); and Preview, the
form as a visitor sees it with the Lemma's chat beside it. A polled door
shows the account it's read from and when it was last read. A plugin's form
opens that plugin.

## Routing, `/routing`

The rules in order, with up and down: an open deal's owner (always first),
the team's rules, each form's default owner (always last). Each rule is one
sentence: kind, form or who they are, to a member, members taking turns, or
Triage. Beside it: who's away today (turns skip them) and who hasn't opened
Forms yet (their answers wait, visible to everyone).

## Set-up, `/setup`

Seven steps, each but the first optional, each read back when done:
where people fill in forms; your website (four starter forms, Contact us on
by default, and how each is shared); Google Forms (connect, paste edit
links); Meta and another form tool (coming soon); who gets what (default
owner and three pre-filled rules); how fast. "Look around with a sample
week" sits at the top and at the bottom.

## Gaps, said on screen

Orange dashed tags say what the platform can't do yet, in plain words:
"Waits for Priya's tap: a function can't send to someone outside", "An ad
lead isn't a contact, so the Lemma's address can't reply", "Noor hasn't
opened Forms yet", "Hiring isn't built yet", "The link shows the table's
name: no title, intro or thank-you yet", "If Ellis leaves, this form stops
taking answers". Blue dashed tags mark what waits for the webhook address.
