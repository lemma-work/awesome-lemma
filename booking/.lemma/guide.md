# Booking page

Each member who turns it on has a public page where people outside book their time. Open times come from the calendars they connected in Meetings, read live; a booking becomes one of their Meetings meetings, with Meetings' brief on who's coming.

## Sharing a link
- A member's own link is `page_url` in their `booking_settings` row (one row each; you see the asking member's). Give it as it is: it ends in `?k=` and a code the page needs, and the page drops it from the address once opened.
- Someone else's page: `booking_page` has every page (`handle`, `name`, `state`), but not its link. Ask them to copy theirs in the Booking app.
- `booking_page.state` `off`: the page says it isn't taking bookings. Turning it on or off is done in the Booking app (it also pauses their schedules).
- Never book for a visitor, and never add a calendar event for one yourself: send the link. A person outside confirms their email with a code on the page.

## Changing hours from chat
Run `booking_save` as the person with only what changes, then `booking_slots` with `{"force": true}` so the page follows at once:
- `days` (Monday = 0), `day_starts`, `day_ends` (HH:MM, their time), `minutes` (call length), `buffer_minutes`, `notice_hours`, `days_ahead`, `max_per_day`;
- the page: `name`, `about` (one line), `more` (what calls are for; the chat beside the page answers from it), `chat` (true or false);
- `video`: `google_meet` (Google calendars), `teams` (Outlook, work or school accounts) or `none`.
It answers `ok: false` with the reason when something doesn't fit (an end before the start, a taken address). Say what changed and how many open times the page has now.

## Where bookings are
- `booking_request`: every request to a page, with `state` requested, confirmed or declined, `reason`, the visitor's `zone`, and `meeting_id`.
- A confirmed booking is a `meeting` row (source `calendar`, the event on their calendar) with `kind` from one Decisions read, and Meetings writes its brief at once (`meeting.headline`, `meeting.brief`). Open it in the Meetings app at `/<meeting id>`.
- A declined one says why in `reason`; `told` holds the email sent to the visitor from the member's own mailbox (or why none was).
- Upcoming bookings are also in the person's `needs_you` (verb `attend`), and one the read wasn't sure of (verb `decide`).
- Never share a visitor's email or what they wrote with anyone but the page's owner.

## The Booking app
`booking`: the member's bookings at `/`, one booking at `/b/<request id>`, settings at `/settings`. A person's page is `/<handle>`.
