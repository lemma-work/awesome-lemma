# People map: design

## Thesis

> For a founder or operator who deals with many people across mail and
> meetings, People map turns what Mail and Meetings read into one list of
> everyone they deal with and where they stand with each (their company, how
> warm it is against their own rhythm, the last contact either way, what is
> owed both ways, the next meeting), by reading each new person once with two
> closed Decisions questions and counting everything else without a model.

- **Hero moment:** a person's page. "Where things stand" in three sentences,
  each with a small source mark that lights up the conversation or meeting it
  came from; beside it what you owe them and they owe you, each promise with
  its sentence; the warmth pill says "Cooling · usually every 2 wk".
- **First 30 seconds** (after set-up): the list, newest contact first, with
  the filters counted (Waiting on you 14, They owe you 6, Gone quiet 3,
  Meeting this week 12) and one line for anyone it was not sure of.
- **Information spine:** the person. Companies hang off people (by email
  domain); conversations, meetings and promises hang off a person's handles.

## Direction: a CRM table and a record page, on the kit

The same look as Mail, Meetings and Today (`../_kit`): Inter at 500 at most,
the host's `--c-*` roles with Lemma's light and dark fallbacks, lucide icons,
the kit's table, record head with fact pills, cards, owed ledger, timeline,
evidence quotes, segmented filters with counts, search on `/`, menus that
open on press, drawers, skeletons and empty states. Apps' own CSS
(`people.css`, `companies.css`) only places things.

People map's own marks, kept small:

- **What someone is to you**: an icon and a word (Customer with a handshake,
  Investor with a landmark, Partner, Candidate, Vendor, Other); "Not sure" is
  a warning pill until the person settles it.
- **Warmth**: Warm, Cooling, Cold or New, always a word; the person's own
  usual gap beside it on their page ("usually every 10 days").
- **Last contact**: an arrow for who wrote last (in or out) or a calendar for
  a meeting, then how long ago.
- **Citations**: `[n]` marks in "where things stand" as small buttons; pressing
  one scrolls to the conversation or meeting and lights it for two seconds.

Status is never colour alone; every pill has its word. The one accent fills
the one primary action in view (Count these, Look them up, These look right).

## Resource map

| UI | Purpose | Resource | Surface | Live |
| --- | --- | --- | --- | --- |
| List | everyone you deal with | `people_person` ⋈ `person` ⋈ `company` (in scope, someone, not a colleague) | query | change stream |
| Owed column, filters | owed both ways | `promise` (open) by `person_handle` → `person_handle.person_id`; `people_person.waiting_on_me` | query | change stream |
| Gone quiet | warmth against their own gap | `people_person.quiet`, `quiet_days`, `usual_gap_days` | query | change stream |
| Team | who the team knows | `people_link` (team-wide), grouped by address | query | change stream |
| Not sure, settle | a correction | `people_correct` → `people_person`, `people_correction` | function | write |
| Person: where things stand | the summary | `people_person.summary_state = wanted` → `people-summary-wanted` → `people-where-things-stand` | records update | polled while writing |
| Person: activity | conversations and meetings | `conversation` (by participant), `meeting` (attendees contain a handle), `people_sample_contact` | query | on open |
| Person: remembered | facts | `people_fact` (writer's, with source; or typed) | records | write |
| Person: open a conversation / meeting | the source | Mail's `inbox` `/inbox/<id>`, Meetings' `/<id>` | `apps.open` | — |
| Company link, People in a company | each other | Companies `/<company id>`, People `/<person id>` or `/team/<address>` | `apps.open` | — |
| Companies list | companies of your people, or the team's | `company`, `company_domain`, `people_person`, `people_link` | query | change stream |
| Company: what they do | the look-up | `people_company.research_state = wanted` → `people-lookup-wanted` → `people-company-lookup` | records | polled while looking |
| Company: rename, merge, move a domain out | edit | `people_company_edit` | function | write |
| Company: notes | the team's notes | `people_company.notes` | records | write |
| Settings | categories, domains, sharing, the hourly count, the sample | `people_settings`, `schedules`, `people_sample_data` | records, SDK, function | write |
| Set-up | three questions | `people-setup` run and its forms | `workflows.runs.create/get/submitForm` | polled every 2 s |

## Pages

People: `/` everyone, `/waiting`, `/owed`, `/quiet`, `/meeting`, `/unsure`,
`/team`, `/settings`, `/<person id>`, `/team/<address>` (someone only the team
knows: who knows them and the last contact, never what was said).
Companies: `/` yours, `/team`, `/<company id>`.

## States

Loading draws the table as skeleton rows and a record as the record skeleton.
"Where things stand" being written shows its skeleton lines and "Writing…";
a look-up shows "Looking them up…". Empty lists say what fills them. A
failed summary or look-up says so and offers Try again. Sample data is a
banner naming which samples are in. Until Mail or Meetings is set up, People
shows both with a button to each; Companies shows a banner to open People.

## Responsive

Tables scroll inside their card; below 980px the record's side column drops
under the main one; at 640px and below the company, relationship, owed and
next-meeting columns hide (warmth and the person stay), and the toolbar
wraps. Checked at 375px from rendered screenshots: no sideways scroll.
Nothing is reachable only on hover: rows open on press or Enter.
