#!/usr/bin/env bash
# Every function's description and grants, in one place. Regenerates
# functions/<name>/<name>.json; never edit those by hand.
#   table        read          table:rw   + write rows       table:rwd  + delete rows
#   /folder:verbs              connector:<id>
set -euo pipefail
cd "$(dirname "$0")/.."
f() { uv run --no-project python bin/fnjson.py "$@"; }
f booking_propose "Set-up: propose when the person takes calls (days, hours, call length, buffer, notice, how far ahead, a daily limit) from the meetings Meetings read from the calendars they chose, each with the reason. Counted, never a model." meetings_settings booking_settings:rw meetings_calendar meeting booking_page
f booking_save "Keep the person's booking settings and their page (address, name, one line about them, video, where declines are emailed from), from the set-up's forms or the settings screen. The address is checked: its form, words the app keeps, and nobody else's." booking_settings:rw booking_page:rw meetings_calendar /memory:read,write
f booking_slots "Work out the open times on the person's page from their live calendars (Google, Outlook or Meetings' sample), their rules and the bookings already taken, and put them on the page. A calendar that cannot be read leaves the times as they were." booking_settings booking_page:rw meetings_calendar booking_request /meetings-sample:read connector:google_calendar connector:outlook
f booking_confirm "Take a visitor's booking or decline it: who sent it, the page's rules, who booked first, one Decisions call (genuine? what kind of meeting?), the live calendars; then the event with its video link, the Meetings meeting with its brief asked for, the visitor as a shared person. A decline is emailed with the reason and the page's link." booking_request:rw booking_settings booking_page booking_outcome:rwd meetings_calendar meeting:rw meetings_work:rw meetings_correction person:rw person_handle:rw /meetings-sample:read,write connector:google_calendar connector:outlook connector:gmail
f booking_needs_you "Write what the person's booking page needs of them into the shared needs_you list: each booking ahead to attend, and each the Decisions read was not sure of to decide; close the rest." booking_settings booking_request meeting needs_you:rw
f booking_sample_data "Load or clear one sample visitor (at a .example address) booking the person's page, handled like any booking against Meetings' sample calendar. Clear removes only what the sample made." booking_settings booking_page booking_request:rwd booking_outcome:rwd meeting:rwd meetings_work:rwd meetings_correction:rwd promise:rwd needs_you:rwd person:rwd person_handle:rwd message meetings_calendar /meetings-sample:read,write
