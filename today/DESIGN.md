# Today: design

## Thesis

> For a person whose day is spread across mail, a calendar, people and tasks,
> Today turns everything in their Lemma that needs them into one page of what
> to do now, sorted by what they do (answer, decide, attend, do, wait on,
> keep in touch), each with the reply, nudge or brief already prepared where a
> plugin can prepare it, and each one press from the app it lives in.

- **Hero moment:** under Waiting on others, a promise from a meeting
  ("Paul Girard said in Velo Cycles: rollout review", due today) beside one
  from mail ("Tomás Reyes", 3 days late) with "Nudge drafted in your voice"
  under it: two plugins, one list, by what the person does.
- **First 30 seconds:** one line counts the day ("12 to answer · 1 to decide ·
  4 to do · 9 waiting on others, 2 late · 2 drifting"), then the sections,
  most pressing first.
- **Information spine:** the item (`needs_you`): what, why, their own
  sentence, when, who, what is prepared, where it opens.

## Direction: a day planner on the kit

Dense product furniture from `../_kit`, the same look as every plugin app:
Inter, weight 500 at most, the host's `--c-*` roles, lucide icons, the kit's
cards, queue items, evidence quotes, draft previews, pills, sheets and empty
states. `apps/today/source/src/today.css` only places things.

- **Sections are verbs, never sources.** The plugin an item came from is a
  faint word beside the name ("Inbox", "Meetings", "People"), and the open
  button names the app.
- **Late is red and says so** ("3 days late"), due today amber, later plain;
  a waiting item with no date says "no date" and how long.
- **Prepared work** (a draft, a nudge, a brief) is the kit's draft preview
  with the `ai` pill, and opens in its app.
- **Meetings as a day planner:** today, then tomorrow; time on the left, the
  headline in the evidence rule, "Read the brief".

## Resource map

| UI | Purpose | Resource | Surface | Live |
| --- | --- | --- | --- | --- |
| Count line | the day in one line | the items read, counted | `datastore.query` | change stream |
| Sections | what needs the person, by verb | `needs_you` (open, or snoozed and due back) ⋈ `today_item` | query | change stream |
| Platform questions | agent questions, approvals, forms | `channels.inbox` (`waiting`) | SDK | on load |
| Open in … | the item where it lives | `client.apps.open(app, path)` | SDK | — |
| Answer in Lemma | a platform question | the chat's address on the web app (`client.authUrl`) | link | — |
| Done / Not now | the person's own word on an item | `needs_you.state` done or dismissed, `closed_by` person | records | write; the source plugin settles it |
| Draft a nudge | ask the item's plugin for a nudge | `needs_you.request = nudge`, `request_hint` | records | write; Mail drafts |
| Why it was held back | the morning check's answer | `today_item.reason` | query | change stream |
| Check again | run the day now | the person's morning schedule, `schedules.runNow` | SDK | write |
| When do you want your day? | the morning time | `today_settings`, the person's TIME schedule | records + `schedules.create/update` | write |

## Pages

One page. Header: Today, the date; Check again and the morning time as a menu
once the time is set. Until it is set, the morning question sits on top of the
page (a time, the zone, Start my day); the day is there either way.

Two columns above 980px: To answer, To decide, To do, Waiting on others on the
left; Meetings today and Drifting on the right. Each section shows five, most
pressing first, with "Show n more".

## States

Loading: both columns as skeleton lists. Nothing at all: one empty state that
says what Today gathers and that adding Mail, Meetings, People map or Tasks to
the Lemma fills it, and that questions waiting in Lemma show too. A nudge
asked for shows "Inbox is drafting the nudge…" until the draft lands. A late
item the morning check held back says why ("Late, but it looks done another
way, 77% sure"). A made-up sample (reserved `.example` addresses) gets one
faint line. A failed read is one line in the danger colour.

## Responsive

Below 980px one column in the order of the day: answer, decide, meetings, do,
waiting, drifting. At 640px and below Check again is an icon, the date is
short, names wrap above their pills. Checked at 375px: no sideways scroll.
Nothing is reachable only on hover.

## Acceptance

- Light and dark follow the Lemma when framed and the device otherwise.
- No section is named for a plugin; every item says where it opens and opens
  there.
- Every count is a count of items read.
- Today sends nothing and writes no message; it writes only the person's own
  state on an item and a request to the item's own plugin.
