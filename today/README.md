# Today

Your day in one place, across everything in this Lemma: what to answer, what
to decide, today's meetings, what to do, what you're waiting on, and who is
drifting, each with the reply, nudge or brief already prepared where a plugin
can prepare it. One app, `today`. It replaces the catalog's Follow-ups and
Chief of staff.

Today carries no other plugin. It reads one shared list, `needs_you`
(`../_contract/tables/needs_you.json`, see `../_contract/README.md`), which
every plugin writes for the person, and the platform's own Needs you
(questions, approvals and forms waiting on them in Lemma). Mail is one source
among many. Alone in a Lemma it says what will appear as plugins are added.

## What it shows

| Section | Verb | Written today by |
| --- | --- | --- |
| To answer | `answer` | Mail (replies people are waiting on), and the platform's agent questions |
| To decide | `decide` | Mail ("Done? …" when it is not sure a promise was kept), and the platform's approvals and workflow forms |
| Meetings today | `attend` | Meetings (today's and tomorrow's, until they end, opening on the brief) |
| To do | `do` | Mail and Meetings (promises the person made) |
| Waiting on others | `waiting` | Mail and Meetings (promises made to them), with Mail's nudge when drafted |
| Drifting | `drifting` | People map (people it counts as gone quiet) |

Sections are by what the person does, never by source. Inside a section the
order is time and lateness with no model: late first, then the due day, then
the item's weight, then how long it has waited (meetings by start; drifting
by days past the usual gap). Each item opens in its own plugin's app
(`client.apps.open(app, path)`). Today's actions are the person's own on the
item: Done and Not now (`state` done or dismissed, `closed_by` person); the
item's plugin hears a Done and settles its source (Mail and Meetings close the
promise). A dismissed item stays off the day until its source changes.

The page leads with **Next up**: the three to five most pressing things,
whatever they are (a meeting about to start, a decision waiting, a late or
due-today to-do, a reply owed), at most two of one kind, ranked by time,
lateness and weight with no model. Then the sections in the order of the day,
three each with "and N more": To decide, Meetings today, To do, To answer,
Waiting on others, Drifting. A drafted reply or nudge is one line ("Reply
drafted in your voice") that opens on press. One source shows once (a promise's
"Done? …" stands for its to-do).

Today's own work is one question, **when do you want your day?**, asked on
the page until answered: the app makes the person's TIME schedule on
`today-sweep`, which writes the day as the morning note would say it.
"Worth a nudge yet?" and "was this promise kept?" are Mail's
(`mail_nudge_check`, `mail_promise_kept`), where the conversations and the
person's meetings are; Today only passes on the person's own Draft a nudge
(`request = nudge`).

| Layer | Resources |
| --- | --- |
| Shared table | `needs_you` (carried from `_contract`, byte for byte) |
| Today's own table | `today_settings` (morning time, schedule, last check, day note) |
| Function | `today_sweep` (grants: `needs_you` read, `today_settings`; nothing of any other plugin) |
| Memory | `today_memory`, after `today_sweep` in every `today-sweep` run (Today has no set-up run; the first check is right after the person picks their time): Today's block in `/memory/AGENTS.md` and its guide `/memory/plugins/today.md`, from `.lemma/agents-block.md` and `guide.md` (`_contract/README.md`, Memory block) |
| Workflow | `today-sweep`; per person `today-morning-<user>` (TIME, made by the app) |
| App | `apps/today` (Vite, `@lemma-plugins/kit`), design in `DESIGN.md` |

## The morning note

Can a Lemma message a member at their morning time, in their own channel
(pushed on to WhatsApp, Slack or email)? **Not cleanly, today.** The channel
exists (`POST /pods/{id}/members/{member}/notices`, `pod.channels.notify`),
but it needs `channel.write` on the pod, and a function or agent cannot be
granted it:

- from a function: `403 MISSING_WORKLOAD_RESOURCE_GRANT: Missing permission channel.write on pod`
  (`lemma-backend/app/modules/agent_surfaces/api/controllers/notice_controller.py`, `require_action(Permissions.CHANNEL_WRITE)`);
- granting it: `400 PERMISSION_RESOURCE_TYPE_MISMATCH: pod:channel.write`
  (`lemma-backend/app/core/authorization/resource_actions.py` has no `POD` entry).

So the note stays in the app: every check writes it to `today_settings.day_note`
as it would be sent. Filed with `lemma feedback`.

## The platform's Needs you

Readable. The app calls `client.channels.inbox(podId)` (the same
`GET /pods/{id}/channels/inbox` the web app's waiting panel reads,
`lemma-frontend/src/channels/api.ts`) as the signed-in person, and shows every
open question in `waiting`: an agent's question under To answer, an approval
or a workflow form under To decide. They are answered in Lemma itself: the
item links to the chat it was asked in (`/l/<lemma>/chats/<channel>` on the
web app's address, from `client.authUrl`). An app cannot open a chat in the
frame the way it opens another app (`client.apps.open` takes apps only), so
the link opens the web app at the top level.

## Install

`install/today/` at the top of this repository is Today, ready to install:
**Add to your Lemma** on its page at lemma.work imports it. From the CLI, the
same server-side import:

```bash
# from the repository root
uv run --no-project python _build/install.py today --pod <pod-id> --var today_slug=<free slug>
```

With other plugins, install each the same way, in any order; Today reads
whatever they write. After changing this folder, `uv run --no-project python
_build/assemble.py --install today` rewrites `install/today/` (the lint fails
until it does). `bin/lemma` is the `lemma` CLI bound to one Lemma
(`LEMMA_SERVER`, `LEMMA_ORG_ID` and `LEMMA_POD_ID`, from the environment or a
gitignored `.lemma.env` in this folder).

## Verify

On a Lemma with Mail, Meetings and People map set up on their samples:

```bash
bin/lemma query run "SELECT source_plugin, verb, state, count(*) FROM needs_you GROUP BY 1, 2, 3 ORDER BY 1, 2, 3"
bin/lemma functions run today_sweep --data '{"detail": true}'
```

## Tested in (18 Nov 2026, on a hosted Lemma server)

| Lemma | What it is |
| --- | --- |
| `Today alone` | Today installed alone, server-side: the empty state and the morning question |
| `Today with everything` | Mail, then Meetings, then People map, then Today, each installed server-side |
| earlier builds | the first build, which carried Mail and Meetings |

## Seen working

In `Today alone`: the install COMPLETED (needs_you, Today's three tables, one
function, one workflow, the app); the page shows the morning question and the
empty state; the platform's Needs you read answered (200, nothing waiting).

In `Today with everything`, on the samples (Mail's and Meetings' set-ups as
their apps run them, People map's set-up and its sample of four people):

- Every section filled from three plugins: 12 to answer (Mail, each with the
  reply drafted), 2 to decide (Mail, "Done? …" from weak yeses of the kept
  check: 54% and 72%), meetings tomorrow with briefs (Meetings; today's had
  ended), 5 to do and 9 waiting on others from Mail and Meetings (the Velo
  Cycles notes read for Meetings' promises), 3 drifting (People map: Ivo
  Petrov, Ana Ruiz, Maya Chen, most overdue first).
- Items open in their apps: Open in Inbox to `/needs/<conversation>`, Open in
  Meetings and Read the brief to `/<meeting>`, Open in People to `/<person>`
  (outside a frame the SDK goes to the app's address; framed, the Lemma opens
  it).
- Done and Not now: "Yes, done" on a decide item closed the promise in Mail and
  resolved its To do; Not now on a drifting person stayed dismissed when People
  map wrote again (kept_closed 1).
- The nudge loop through the list: the morning check asked about Tomás's late
  promise (yes, 0.83), set `request = nudge`; Mail's trigger drafted it ("Hi
  Tomás, Still keen to talk. Could you send a few times…? Cheers") and the
  item showed "Nudge drafted in your voice".
- Clearing each sample (People map, Meetings, Mail) closed every one of its
  items (`done`, closed by the source); the page went back to the empty state.
- Light, dark and 375px in rendered screenshots, through a local dev server
  against the Lemma.
- Later, with Tasks installed too (server-side) and its sample loaded, and one
  sample task handed to the Lemma's agent: Next up mixed five things from
  three places (a "Done? …" from Mail, the agent waiting for approval to reply
  to Jonas from Tasks, a to-do from Mail and one from Tasks due today, a reply
  owed); Mail's nudge check held Tomás back again ("No nudge yet: it looks
  done another way, 84% sure"), his intro call on Friday being the evidence.

Not seen: the deployed app signed in inside Lemma's own web app; a platform
question actually waiting (none was asked, and assigning a form would push a
real message); the morning schedule firing at 08:00 by itself; Meetings'
15-minute sweep moving tomorrow's meetings into today (the person's sweep is
made by Meetings' app for a real calendar only).

## Site pictures

`.lemma/shots/today{,-sections}-{light,dark}.webp`, 1440×900 at 2x: the first
screen (Next up over the sections) and the sections further down. From the
built app served on `Today with everything`'s rows with Tasks added
(`bin/shot-fixtures.py`, the person's name and address replaced), then from
the repository root:
`_kit/bin/shots_serve.py --app today/apps/today/source/dist --fixtures today/.lemma/shots/fixtures --port 4612`
and `node _kit/bin/shoot.mjs http://localhost:4612 <out> today=/ "today-sections=/#click=#answer .t-name"`,
then `cwebp`.
