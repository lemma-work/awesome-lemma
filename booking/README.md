# Booking page

A page where people book your time. It fits around your calendars, and each
booking arrives with a brief on who's coming.

It carries **Meetings**, which already reads the calendars: one install puts
both into an empty Lemma. A booking becomes a Meetings `meeting` (the same row
Meetings' own calendar read makes for that event) and Meetings writes its
brief at once, so there is no brief agent here. The visitor becomes a shared
`person` by handle, as Meetings does for attendees, so People map (when it is
in the Lemma) sees them. It needs no Mail.

Personal first: each member who turns it on gets their own page at
`<app address>/<handle>`. A shared team page (round robin) is not built.

Tested in two Lemmas: the install test (the assembled bundle, Booking page +
Meetings, installed server-side with `_build/install.py`), whose sample
member's page is `<app address>/sam?k=<page key>`, and a build Lemma where it
was built and probed.

## What it does

```
Meetings' set-up (theirs)  ─▶ booking-setup (per person; the app is the screen for its forms)
   calendars  which of Meetings' calendars the page keeps clear of
   propose    booking_propose: hours, call length, buffer, notice, how far ahead, daily limit,
              counted from how those calendars are used (no model), each with its reason
   hours ─ page (handle, one line, what calls are for) ─ video (Meet / Teams / none, where
   bookings go, which mailbox emails a decline)
   save       booking_save, which also writes the memory block; booking_slots
 ─▶ turn on (the app, as the person; each step read back):
   booking_request contact-owned and open to confirmed visitors (7 columns) · the Lemma's
   web widget (booking-host, answers anyone, allowed on the app's address) · the person's
   own trigger booking-request-<id> (INSERT, when page_id = theirs, include_outside_rows,
   bulk_writes each) · their booking-refresh-<id> (every 15 min) · page_url, page on (left
   off while bookings go on Meetings' sample calendar: a sample booking still goes through)

visitor: /<handle>?k=<widget key> ─▶ open times in their own zone ─▶ name, email, what about
   ─▶ email code ─▶ Lemma.addRow(booking_request) ─▶ waits for booking_outcome
the person's trigger ─▶ booking-confirm, as them:
   booking_confirm   who (row_author contact:<id>) ─ rules ─ who booked first ─ one Decisions
                     call (genuine? which of Meetings' kinds?) ─ live calendars ± buffer ─
                     event with video link, inviting the visitor ─ meeting + meetings_work
                     (brief_state wanted: Meetings' writer starts) ─ person ─ outcome
                     or: decline, emailed from the person's mailbox with reason and link
   booking_slots     the page's open times again
   booking_needs_you the call to attend; a booking the read wasn't sure of, to decide
```

- **Decisions, one call per request**, two closed questions: *is this a
  genuine request* (spam and nonsense are declined politely) and *what kind of
  meeting* in Meetings' own kinds, so the brief fits. Under 0.5 is not sure
  (Typesafe always answers): a request not surely genuine is still booked and
  marked; an unsure kind leaves the meeting's kind empty and `meetings_work.unsure`
  set, as Meetings does. Settling it in the app calls Meetings' `meetings_settle`,
  so it becomes one of Meetings' corrections; the newest twelve corrections go
  with every call as examples. A colleague (own domain) is `internal` with no ask.
- **Checked live, twice.** The page's times are worked out from the live
  calendars (Google free/busy, Outlook's calendar view, or Meetings' sample
  fixture) every 15 minutes and after each booking; each request is checked
  again against every calendar, with the buffer, before the event is made.
- **Who may book.** `booking_request` is open to confirmed contacts only, for
  `page_id, starts_at, name, email, about, zone, ref`. A function can't read a
  contact's proven handles (`contact.read` is pod-scoped), so the confirmed
  email travels on the row and `booking_confirm` requires the insert's
  `row_author` to be `contact:<id>`. A row a member typed is declined and
  nobody is emailed; the owner's own sample (flagged, at `.example`) is the one
  exception.
- **The page can't read requests**, so the outcome comes back through the
  Public `booking_outcome` (the page's own random `ref`, booked or declined, a
  reason in general words; nothing about anyone). Rows older than two days go.
- **Time zones.** Stored in UTC. The visitor sees their own zone (detected,
  changeable) and the owner's time beside the chosen slot; the request keeps
  their zone, so a decline email speaks their time. The owner's hours are in
  their zone (Meetings' setting). Old browser names (Asia/Calcutta) are mapped.

| Layer | Resources |
| --- | --- |
| From Meetings (carried) | `meeting`, `meetings_work`, `meetings_calendar`, `meetings_settings`, `meetings_correction`, `person`, `person_handle`, `needs_you`, … and Meetings' functions, agents, workflows, schedules, app |
| Own tables | `booking_page` (Public, one row per page: handle, name, about, more, minutes, video, zone, notice, state, `slots`) `booking_settings` (per person) `booking_request` (shared, contact-owned, open to confirmed visitors) `booking_outcome` (Public) |
| Functions | `booking_propose` `booking_save` `booking_slots` `booking_confirm` `booking_needs_you` `booking_sample_data` |
| Agent | `booking-host`: the chat beside the page, reads only `booking_page` |
| Workflows | `booking-setup` (four forms) `booking-confirm` `booking-refresh` |
| Schedules | none in the bundle; per person, made by the app at turn-on: `booking-request-<id>` (DATASTORE) and `booking-refresh-<id>` (TIME) |
| Connectors (per member) | `google_calendar`, `outlook` (shared with Meetings); `gmail` (optional: a decline email for a Google calendar) |
| App | `booking` (Public): `/<handle>` for visitors; `/`, `/b/<request>`, `/settings` for members |
| Memory | block in `/memory/AGENTS.md`, guide at `/memory/plugins/booking.md` (`.lemma/agents-block.md`, `.lemma/guide.md`), written by `booking_save` at the end of set-up |

## Install

`install/booking/` at the top of this repository is Booking page assembled
with Meetings (without Google Meet), ready to install into an empty Lemma:
**Add to your Lemma** on its page at lemma.work imports it. From the CLI, the
same server-side import:

```bash
# from the repository root
uv run --no-project python _build/install.py booking --pod <pod-id> --var booking_slug=<free slug> --var meetings_slug=<free slug>
```

Then each person: Meetings' set-up, then open Booking. The turn-on needs edit
access in the Lemma (opening a table, the widget, a trigger on a shared
table); a member with the default role is told so. `bin/grants.sh`
regenerates every function's grants; `bin/share.py` copies
`bin/shared/calendar.py` into the functions that read calendars. The app
depends on the kit as `apps/booking/source/vendor/*.tgz` (`../_kit/bin/vendor.sh booking`).
`bin/lemma` is the `lemma` CLI bound to one Lemma (`LEMMA_SERVER`,
`LEMMA_ORG_ID` and `LEMMA_POD_ID`, from the environment or a gitignored
`.lemma.env` in this folder). After any change here, from the repository
root: `uv run --no-project python _build/assemble.py --install booking`, then
the lint.

A dev server against your Lemma, signed in with the CLI's session, from
`apps/booking/source` (`VITE_BOOKING_APP_ORIGIN` names the hosted app's
address, for the links the page shares):

```bash
LEMMA_DEV_PROXY_TARGET=https://api.lemma.work VITE_LEMMA_BASE_URL=http://127.0.0.1:5397/api \
VITE_LEMMA_POD_ID=<pod-id> VITE_LEMMA_DEV_TOKEN_CMD="$PWD/../../../bin/lemma auth print-token" \
VITE_BOOKING_APP_ORIGIN=<app address> npx vite --host 127.0.0.1 --port 5397 --strictPort
```

## Seen on 18 Nov 2026, on a hosted Lemma

- **Onboarding**, in a real browser (dev server, the CLI's session, the install
  Lemma): calendars → hours proposed from 25 sample meetings (Mon–Fri,
  10:00–17:00, 45-minute calls from 18 outside meetings, 10-minute buffer,
  12 h notice, 14 days, 2 a day, each with its sentence) → page `/sam` (free)
  → video → on. Every turn-on step read back: table open to contacts for the 7
  columns, `contact_owned` true, widget answering anyone on the app's address,
  the trigger's `include_outside_rows: true` (also read through the API), the
  refresh made. 90 open times over 10 days. The refresh fired on its own at
  12:00 and completed.
- **A visitor end to end on the hosted page** (headless Chrome, zone
  Asia/Dubai): the key came from the link and left the address; the code was
  sent to a `.example` address and the page reached its code step; the visitor
  was then confirmed through a widget host token (below) and booked. Request
  row stamped with its contact, run as the member, Decisions 0.6–0.9 s, the
  page showed the outcome 7 s after the insert; a `meeting` (source calendar,
  kind customer) and its `meetings_work` row; Meetings' brief ready about 20 s
  later; the visitor a `person` by handle; a `needs_you` attend item. A second
  visitor in dark mode the same.
- **Declines**: a time busy on the sample calendar (New York visitor) → "That
  time filled up on the calendar", email written in New York time, first
  person, with the page link; a slot someone booked first; a spam request
  (genuine false, 0.95) declined politely; a row a member typed declined with
  no email. Nothing is ever sent from a sample calendar (`told.why` says so).
- **Time zones**: New York visitor saw Kolkata 10:00 as 11:30 pm the night
  before; Dubai and London likewise; the owner's time shown beside each pick;
  the chat answered "Monday afternoon, I'm in London" in London time.
- **The chat** (`booking-host`) refused to give the owner's email.
- **From the Lemma's own chat** (memory block): "what's the link to my booking
  page, and end my day by 16:00" gave the link and ran `booking_save` and
  `booking_slots` (65 open times).
- **Sample**: load booked the sample visitor through the real pipeline; clear
  removed exactly its request, outcome, fixture event, meeting, work row,
  needs item, person and handle, and left the other bookings.
- **Settling** a not-sure booking in the app: `meetings_settle` made one
  correction and set the meeting's kind; the `decide` item opened and closed.
- **Light, dark and 375px** from rendered screenshots, no sideways scroll.
- **No member's name** anywhere in the plugin (grep).

## Things that bit

- **The SDK breaks the widget on a hosted Public app**: its sign-in client
  adds `st-auth-mode` and `rid` headers to every fetch to the API, and the
  widget's public CORS refuses them. The visitor page loads the kit's CSS but
  never its JS (`visitor/marks.tsx`, split by `main.tsx`). Filed.
- **A Public app can't learn its widget's key**: the shared link carries
  `?k=` (kept in the browser, dropped from the address). Filed.
- **The server-side import drops `contact_owned`**: the turn-on sets it.
  Re-importing a contact-owned table can plan to drop `contact_id`. Filed.
- **Outside rows run as the schedule's owner**, so each person needs their own
  trigger, and making one needs `datastore.table.update`: members with the
  default role can't turn their page on. Filed.
- **UUID columns can't be opened to visitors**: `page_id` is text. Filed.
- **Two tabs open at the end of set-up both run the turn-on** (guarded only
  within a page). Seen once: one trigger and one widget resulted, but nothing
  stops a race from making two triggers.

## Not built or not verified

- **The email code itself**: sent (the page reached its code step; the API
  accepted it) but never entered: no test inbox could receive it, and
  codes are stored hashed. The booking was made as a contact confirmed by a
  host token signed with the widget's own secret, which stamps the row the same
  way. Filed as a gap.
- **A real calendar**: Google free/busy, Outlook's view, creating an event
  with Meet (`create_meeting_room`) or Teams (`is_online_meeting`,
  `teamsForBusiness`, work or school accounts only) and the decline email
  through Gmail or Outlook are written to the connectors' schemas and the
  October build's verified Google calls, but no real account was connected.
- The hosted members' side signed in or framed in Lemma's web app (checked through
  the dev server); a real Decisions answer under 0.5 (none came; the settle
  path was exercised by marking one); two members in one Lemma; round robin.
