# Booking page: design

For **a member who meets people from outside**, this app turns **their own
calendars** into **a page anyone can book** by **offering only times that are
free on every calendar, checked again live before each booking, and handing
each booking to Meetings for a brief**.

Two faces of one app, on the one kit (`_kit`): Lemma's tokens, Inter at 500 at
most, lucide icons, light and dark from the host or the device.

## The visitor's page, `/<handle>`

The one surface outsiders see: calm, clear, fast on a phone.

| Element | Purpose | Source |
| --- | --- | --- |
| Who: avatar, name, one line, length, video, "the invite comes from <name>'s calendar" | Know whose time this is | `booking_page` (Public) via the web widget |
| Day chips with counts, then the day's times | Pick a time, in the visitor's own zone | `booking_page.slots` (UTC), minus the notice |
| Zone select, "Times are in <zone>. <name> is in <zone>." | Never guess a time zone | `Intl`, changeable |
| The chosen slot, with the owner's own time beside it | Both zones at once | `booking_page.timezone` |
| Name, email, what about; then the 6-digit code | Confirm the email, then book | `Lemma.sendCode` / `verifyCode` / `addRow(booking_request)` |
| Checking → booked / couldn't be booked (with why) / requested | The truth of what happened | `booking_outcome` by the page's own `ref` |
| What calls are for; Ask a question | The chat answers only from what's Public | `booking_page.more`; `booking-host` |

Desk: two columns, who on the left (sticky), the picker in a card. Phone: who
and the facts in one compact block, the picker straight after, the rest below
it; the day chips scroll sideways inside the card; 44 px time buttons. One
primary action in view. States: loading skeleton in the final layout, a link
missing its key, no such page, the page off, no open times, refusals in plain
words (too many tries, code wrong or expired).

It loads the kit's CSS and none of its JS (the SDK's sign-in client would break
the widget's CORS); `visitor/marks.tsx` draws the kit's Avatar, Button and
Spinner with the kit's own classes.

## The members' side, signed in

| Screen | What it holds | Source |
| --- | --- | --- |
| Set-up (`booking-setup` forms) | Calendars; hours proposed from the calendar with a sentence each; address (checked live), name, one line, more; video and where bookings go and which mailbox emails a decline; the turn-on checklist, each step read back | `booking_propose` output, `meetings_calendar`, connector accounts, `turnOn.ts` |
| `/` | Coming up / Declined / Past with counts; each row: when (their time), who, the brief's headline or the reason, kind, brief state. Beside it: the link (copy, open), on/off, open times, hours, calls, notice, calendars, "new bookings reach you, checked …", the sample | `booking_request` ⋈ `meeting` ⋈ `meetings_work`, `booking_page`, `booking_settings` |
| `/b/<id>` | Record: who, booked/declined, kind, brief; what they want; Meetings' brief; why declined and the email sent (or why none); when in both zones, video link; what the read made of it (each answer with its confidence); settle when not sure | same, `meetings_settle` |
| `/settings` | Hours, the page, calendars and video, the decline mailbox, turn off | `booking_save`, `booking_slots` |

Product furniture: header, segmented filter with counts, list rows, record
layout with a properties side panel, cards, pills with words (never colour
alone), the `ai` pill for Meetings' brief and the read.
