# Forms

Every form outside people fill in, on your site, in Google Forms or from an
ad, each answer sent to the work it belongs to.

Answers come in through every door a team has: its own website forms
(Contact us, Request a demo, Careers and Beta sign-up, as a link, on its own
page, or inside its product), Google Forms, and Meta lead ads. Each answer
becomes one row in the shared `form_answer` table and goes the same way:
**read** (one Decisions call: lead, support, bug, feedback, beta,
application or spam, why, and which of the team's descriptions fits who they
are), **route** (an open deal's owner first, then the team's rules in order,
then the form's default owner, always with the reason), and **hand** (the
owner's own run writes their conversation, their person, a reply drafted in
their own mailbox, and "Reply drafted" in their Today). Under 50% sure is
**Not sure**: the form's owner is asked to pick, and after an hour with no
pick it goes to them anyway, still marked not sure. Spam is set aside with
the reason, never deleted. **Nothing goes out until a person presses Send.**

Answers is the home screen, with a clock on each answer and the honest
median time to first reply. One key per decision: `J` `K` move, `Enter`
open, `N` not sure, `S` set aside, `U` put back, `R` re-route, `/` search.
Doors lists every place answers come from, with its count, its rule and its
state. Routing holds the rules.

Carries **People map**, and with it **Mail** and **Meetings**
(`plugin.json`): the reply is a Mail draft, sent with Mail's
`mail_send_draft`, and the answer lands on the owner's People map card.
Uses, when installed, never carries: **Deal tracker** (an open deal's owner
gets the answer; Deal tracker hears the owner's conversation as it hears
mail), **Triage** (bugs are filed there: Triage listens on `form_answer`
and writes back `T-<n>`), **Lead research** ("Look it up now" on an answer)
and **Today** (Forms' `answer` and `decide` items).

## How it works

| Part | What it is |
| --- | --- |
| Shared tables | `form` (one door; id `uuid5(FORMS_NS, "<source>:<source_id>")`) and `form_answer` (one answer; id `uuid5(FORMS_NS, "<form id>:<source answer id>")`, so a re-read or a redelivery never files twice), both new in `_contract`, team-wide: an answer was said to the team, so the team keeps its words. Also carries `deal`, `away` and `needs_you`; `company`, `company_domain`, `conversation`, `message`, `person`, `person_handle` and `draft` come with People map and Mail. |
| Own tables | `forms_settings` (one row), `forms_rule` (the team's rules in order), `forms_correction` (a person overriding the read; the newest go with each read as examples), `forms_event` (an answer's timeline), the four starter web forms `forms_contact`, `forms_demo`, `forms_careers`, `forms_beta` (one raw table each, opened to outsiders by the app), `forms_hooked` (webhook deliveries, for later), `forms_sample_row`. |
| Functions | `on_web`, `poll`, `on_hook`, `read`, `take`, `let_go`, `writing_context`, `save_draft`, `on_sent`, `decide`, `unsure_sweep`, `needs_you`, `lookup`, `setup_save`, `door_save`, `memory`, `sample_data` (all `forms_`). The read and the route, the owner's side and the shared helpers live once in `bin/shared/` and are copied in by `bin/common.py` (`--check` fails on drift). Grants: `bin/grants.sh`. |
| Agent | `forms-writer`: writes one reply from the brief `forms_writing_context` gathers (the answer, the owner's voice, People map's read, past lines, the open deal's facts, the brand). No tools; structured output `subject`, `body`, `rationale`, `assumed[]`. |
| Workflows and schedules | Bundled: `forms-read` (INSERT on `form_answer`), `forms-sent` (a new mail draft became sent), `forms-unsure` (every 15 minutes). Made by the app, as a person: `forms-web-<form>` (INSERT on its table, `include_outside_rows`), and each member's own `forms-take-…`, `forms-let-go-…`, `forms-write-…` (UPDATE on `form_answer`, `rows: OWNER_READABLE`, run as them), `forms-poll-…` when they add a Google Form, and `forms-hooked` for webhook doors. |
| App | `forms`: `/` Answers, `/a/<id>` one answer, `/doors` and `/doors/<form id>`, `/routing`, `/setup`. See `DESIGN.md`. |
| Memory | `.lemma/agents-block.md` (192 characters with markers) and `.lemma/guide.md`, written by `forms_memory` from set-up with the team's forms and who gets what. |

### What only a person can do

A function holds grants only on its own bundle's parts, and no grant holds
`schedule.create`, a table's public rows, a web widget, a hook or contact
outreach. So the app does these as the person (`src/wire.ts`), each step
read back:

- turning a website form on: its table opened to outsiders, the Lemma's web
  widget (`answer: anyone`), and its trigger with `include_outside_rows` (a
  bundle can't carry that field, and without it every visitor's row is
  dropped);
- each member's own three schedules, on their first visit: only a run as the
  owner can write their conversation, person, draft and Today item;
- sending: the draft approved with a ten-second undo, then Mail's
  `mail_send_draft`;
- the reply from the Lemma's own address (`lemma_address`), only to a
  contact the platform proved: contact outreach, as the member;
- which plugins this Lemma has, kept in the set-up for the functions.

## What was measured

Installed server-side (`_build/install.py forms`) into a fresh scratch Lemma
on a hosted Lemma, with Triage installed beside it, and walked by API as the
one member there:

- **Set-up**: the member's three schedules; Contact us and Request a demo
  opened to anyone, the widget made, both triggers read back with
  `include_outside_rows: true`; rules saved; the memory block written.
- **A real visitor**, in a browser on the hosted link, sent Request a demo
  with a file. `forms-web-demo` filed it (the run's `start.payload` is the
  row); the read said lead, 96%; a seeded open deal routed it to its owner
  with the reason in words; the owner's run wrote the conversation, the
  person, the document and the Today item; `forms-writer` drafted the reply
  in the owner's real (test) Gmail mailbox; Send delivered it from Gmail to a
  test inbox; `forms-sent` set the first-reply time, the conversation to
  waiting and closed the Today item. About a minute from answer to sent.
- **A signed-in user of a product** (a host token) sent Contact us: filed
  with its `contact_id`.
- **Bugs**: a bug from a company with no open deal went to Triage by rule
  and became T-2, with `work_label` written back; re-routing another to
  Triage filed T-1, closed the old owner's Today item and conversation.
- **Not sure and spam**: `U` put a set-aside answer back as Not sure (a
  `decide` in Today); a pick wrote a correction and routed it; `S` set a
  pitch aside with the reason; `N` marked one not sure again, and the sweep
  (its hour shortened to a minute) moved it to the form's owner, still not
  sure, where it was drafted.
- **Sample week**: loaded (20 answers, 9 doors, a draft in a sample mailbox,
  a Today item) and cleared to nothing, real answers and `/memory` untouched.
- **The app** against that Lemma (the real build in `vite dev`, signed in
  as the member): Answers, one answer, Doors, Routing and Set-up, light and
  dark, and 375px with no sideways scroll. The demo was driven in full (all
  six screens, light, dark and 375px, the keys).
- `_contract/lint.py` has nothing for Forms (the one failure left,
  `_kit/src/contract.ts` stale, comes from new contract tables and is the
  kit repack's); `_build/assemble.py --install forms` writes Mail + Meetings +
  People map + Forms; the site catalog builds with Forms in it.

### The checks the brief asked for

1. **Meta leads (`METAADS_LIST_LEADS`)**: not checked. No Meta account or
   `metaads` installation was available, so Meta is shown as Coming soon and
   `forms_poll`'s Meta path reads Meta's documented lead shape, unverified.
2. **A row written by a run that an outside row started is not an outside
   row**: `forms-read` (no `include_outside_rows`) fired on the answer
   `forms_on_web` wrote from a visitor's row. It stays bundled.
3. **`mail_send_draft` on a `kind: new` draft with no conversation**: sent
   live from Gmail. Outlook not tried.
4. **Can the app make a workflow** for a team's own extra form: not tried;
   v1 is the four starter forms, renamed and re-fielded.
5. **A second member's `PUT …/public-rows` moving `opened_by`**: not tried
   (one member).
6. **Hidden inputs on your own page**: the widget sends every field of a
   marked form (`sendPageForm` in the platform's `widget.js`), so `page` and
   `campaign` arrive as open columns. Read from the code, not run. They open
   only when a form is shared on a page or in a product: the hosted link
   draws every open column and would ask visitors for them.
7. **Webhook deliveries**: the webhook address isn't live in any Lemma we
   could reach, so Typeform, Tally, Webflow, Fillout, Google Ads and Zapier
   are drawn as Coming soon; `forms_on_hook`'s parsers and the app's hook
   path are written against the address's published shape and unverified.
8. **The visitor's chat in the timeline**: not built; the timeline leaves
   it out.
9. **`when` with `equals` on a USER column with `rows: OWNER_READABLE`**:
   fired, for the member's own write. Not tried for another member's write.

## What was not verified

- **A second member**: only one member was in the scratch Lemma, so the
  open deal belonged to that same member; the take, write and let-go
  schedules ran for them only. Turns between members are unverified.
- **Google Forms**: no Google Forms installation was available, so no form
  was polled; `forms_poll` reads Google's documented shapes, unverified.
- **Meta lead ads** and **every webhook door** (above).
- **Outlook** sending, the **Lemma's own address** reply mode (contact
  outreach), **Deal tracker** hearing the owner's conversation and **Lead
  research**'s "Look it up now": neither plugin was installed.
- **Triage's report form in Doors**: Triage registers it when its own form
  files an answer; its form wasn't turned on in the walk.
- What ran only on the sample: the broken Meta door's banner, Google Forms
  and Meta rows, turns, "hasn't opened Forms yet", and the Hiring and
  Support inbox gaps.

## Platform gaps it works around

- No webhook address per Lemma yet: the webhook doors wait for it.
- A form answer from a contact isn't a line in their chat, so the Lemma
  can't reply on its own: the owner's draft waits for Send.
- The hosted form page takes only `?table=`: it shows the table's name, with
  no title, intro or thank-you. A team's own page can set them.
- One member holds every form open (the table's opening and its trigger).
- A member who never opened Forms has no schedules of their own, so their
  answers wait in Answers, visible to everyone.
- A function can't send outreach, make a schedule or carry
  `include_outside_rows`: the app does each as the person.

## Try it

`node _kit/bin/demo.mjs forms` builds `.lemma/demo/` from
`.lemma/shots/fixtures/`, which `bin/demo-fixtures.py` writes offline from
`forms_sample_data`'s own `build`: Halvard Lighting's week, on a Tuesday at
10:42.

```bash
# from the repository root
uv run --no-project python _build/install.py forms --lemma <lemma-id> --var forms_slug=<free name> \
  --var people_slug=<free name> --var companies_slug=<free name> --var inbox_slug=<free name> --var meetings_slug=<free name>
```

Then whoever opens Forms first sets it up (or loads the sample week).
Turning a form on needs edit access in the Lemma. After any change, from the
repository root: `uv run --no-project python forms/bin/common.py`, then
`uv run --no-project python _build/assemble.py --install forms` and the lint.
Installing again into a Lemma that already has Forms keeps its functions as
they are; update one with `bin/lemma functions update`.
