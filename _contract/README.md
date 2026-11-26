# Shared contract

The tables plugins share, and the questions they ask about a conversation.
Mail writes them first; Meetings, People map, Follow-ups, Deal tracker and a
Chat plugin read and write the same rows. Every place a person works is
first-class, so nothing here belongs to one source.

## Tables

| Table | One row is | Key columns |
| --- | --- | --- |
| `conversation` | a conversation anywhere: an email thread, a Slack thread or DM, a Teams or WhatsApp chat; and what was read from it | `source` (mail, slack, teams, whatsapp…), `source_account`, `source_id`, `kind` (people, broadcast), `state`, `priority`, `category`, `ask` |
| `message` | one message in a conversation | `conversation_id`, `source`, `source_id`, `direction`, `from_handle`, `to_handles` |
| `person` | one human the owner deals with, from every source | `name`, `org`, `is_vip`, counts, `weight` |
| `person_handle` | one way to reach a person: an email, a phone, a Slack or Teams user | `person_id`, `kind`, `handle` |
| `promise` | a promise made either way, with its sentence | `conversation_id`, `source`, `direction`, `text`, `quote`, `due_at` |
| `draft` | a message written for the owner, unsent until a person says so | `conversation_id`, `source`, `source_account`, `to_handles`, `body`, `state` |
| `meeting` | added by Meetings | see its file |
| `company` | a company the team deals with, added by People map | `name`, `domain` (the main one), `name_from`, `description` |
| `company_domain` | one email domain of a company | `company_id`, `domain` |
| `project` | a team project, added by Tasks | `name`, `state`, `lead_user_id`, `target_on`, `source`, `source_id` |
| `task` | a task the team sees (in a project, or shared), added by Tasks | `title`, `status`, `priority`, `due_on`, `project_id`, `parent_id`, `assignee_kind`/`_user_id`/`_agent`, `owner_user_id`, `source`, `source_id`, `quote` |
| `personal_task` | a person's own private task: the same columns as `task` | as `task` |
| `deal` | something the team is trying to win from another company, added by Deal tracker | `name`, `company_id`/`_name`/`_domain`, `people` (handles), `owner_user_id`, `stage`, `status` (open, won, lost), `amount`, `currency`, `close_date`, `next_step`, `source`, `source_id` |
| `brand` | the team's brand, added by Brand kit; read by every plugin that makes something | `name`, `is_default`, `state` (new, reading, check, ready, archived), `colors` (each with its `role`), `fonts` (display, body, mono), `tokens`/`theme_css_path`, `logo_path`/`logos`, `guide_path`, `voice`, `site_url`, `source`, `source_id` |
| `ask` | one person asking for one piece of work, and where they asked; added by Triage and Release notes | `work_source`/`work_id`, `task_id`, `handle_kind`, `handle`, `source`, `source_id`, `heard_by`, `conversation_id`, `state` (suggested, open, declined, shipped, told, dropped), `plugin` |
| `repository` | a GitHub repository the team watches; added by PR review | `full_name`, `default_branch`, `review_mode` (off, once, every_push), `merge_mode` (off, watch, merge), `allow_auto_merge`, `merge_queue`, `required_check`, `required_approvals`, `source`, `source_id` (GitHub's repository id) |
| `pull_request` | one pull request, as of its latest push; added by PR review | `key` (`owner/repo#n`), `repository_id`/`repo`, `number`, `title`, `author`, `author_kind` (member, agent, bot, outside), `state`, `head_sha`, `risk`, `waits_on`/`waits_for`, `review_state`, `verdict` (clean, changes, needs_person), `summary`, `linked_issues`, `merge_state`, `source`, `source_id` |
| `away` | one person away for one day (or half of one); a stretch away is one row per day; added by Triage and Sprints | `member_id`, `name`, `day`, `part` (full, half); id `uuid5(AWAY_NS, "<member id or name>:<day>")` |
| `product` | your product or a rival's, added by User feedback (yours) and Competitor watch (rivals) | `name`, `role` (ours, rival), `company_id`, `aliases`, `keywords`, `active` |
| `feature` | one thing one of the team's products does or could do, in the team's words: what feedback files under; added by User feedback | `product_id` (always ours), `name`, `parent_id`, `aliases`, `state` (suggested, active, merged, archived), `merged_into`, `stage` (idea, planned, building, beta, live, declined), `owner_user_id`, `work_source`/`work_id`, `task_id` |
| `feedback` | one thing one person said about one feature, word for word; added by User feedback, written too by User interviews, Early access, Competitor watch | `quote`, `point`, `product_id`, `feature_id`, `filed_by`, `kind`, `compared_with`, `sentiment`, `importance`, `handle_kind`/`handle`, `company_id`, `source`/`source_id`, `heard_by`, `is_public`, `said_at`, `state` (new, processed, set_aside), `plugin` |
| `article` | the published copy of one answer customers or the public may read, never past its check date; added by Know-how, read by Support inbox and Help center | `title`, `slug`, `summary`, `body_md`, `topic`, `kind` (answer, procedure, policy), `checked_at`, `checked_by_name`, `good_until` (it leaves at the start of the next day), `help_path`, `source_plugin`/`source_id`; Public, no RLS; id `uuid5(ARTICLE_NS, "<source_plugin>:<source_id>")`, `ARTICLE_NS = 60a094a9-68d4-4995-8508-e9a616fcd38c` |
| `form` | one door an answer can come through: a website form, a Google Form, a Meta lead form, a form tool's webhook, or another plugin's own form (Triage's report form); added by Forms, registered by the plugin whose form it is | `name`, `source`, `source_account`, `source_id`, `place`, `share`, `owner_plugin`, `purpose`, `default_owner_user_id`, `reply_mode` (chat_only, draft, lemma_address), `audience`, `state` (on, paused, off, broken, soon), `state_why`, `held_by_user_id`, `fields`, `cursor`, `last_read_at`, `last_answer_at`, `week`; id `uuid5(FORMS_NS, "<source>:<source_id>")`, `FORMS_NS = ba341d0a-0b0a-4d01-9869-2c8791b9f203` |
| `form_answer` | one answer to one form, from someone outside the team, with their words; added by Forms, filed by the plugin it is routed to (Triage for bugs) | `form_id`, `source`/`source_id`, `received_at`, `handle_kind`/`handle`, `name`, `company_name`/`company_id`, `contact_id`, `row_author`, `fields`, `message`, `files`, `came_from`, `kind`, `kind_sure`, `kind_why`, `routed_to`, `owner_user_id`, `owner_why`, `owner_rule`, `rules_checked`, `state` (new, unsure, routed, drafted, replied, filed, set_aside), `hand_version`, `draft_state`/`draft_id`, `work_source`/`work_id`/`work_label`, `first_reply_at`; id `uuid5(FORMS_NS, "<form id>:<source answer id>")` |
| `needs_you` | one thing that needs one member, from any plugin, for Today | `verb`, `title`, `why`, `quote`, `due_at`, `source_plugin`/`_table`/`_id`, `source_version`, `app`/`path`, `state`, `weight` |

`conversation` to `meeting` and `personal_task` are per person (RLS): each
member sees their own. `company`, `company_domain`, `project`, `task`,
`deal`, `brand`, `ask`, `away`, `repository`, `pull_request`, `product`, `feature`, `feedback`, `form` and `form_answer` are team-wide.
`company` and `company_domain` are team-wide: two members who both deal with
Acme share one company, and Deal tracker hangs deals on it. Nothing anyone
said lives there.

- **A company is found by domain**, the way a person is found by handle:
  `company_domain` rather than a domains list on the company, so a lookup is a
  join and merging two companies (acme.com and acme.co.uk) is moving rows. A
  domain row's id is `uuid5(COMPANY_NS, domain)` and a company made from a
  domain is `uuid5(COMPANY_NS, "company:" + domain)`, with `COMPANY_NS =
  c6fc6ea2-4356-443e-8065-e1d71b8f6359`: a domain belongs to one company, and
  two members' jobs meeting a new domain at once write one row. Free webmail
  never makes a company.

- **A deal is the team's; what was said stays with whoever heard it.** `deal`
  holds the facts (stage, amount, close date, next step, who owns it) and no
  words: the sentence a change came from is in Deal tracker's own
  `deals_change`, per person, and a deal names its people by handle, since a
  `person` row is each member's own. `stage` is the team's own word (Deal
  tracker keeps the list in `deals_stage`); `status` says what it means to
  anyone else. `company_id` has no foreign key: People map tidies away a
  company nobody's people point to, and a deal keeps `company_name` and
  `company_domain` to say who it is with. Proposals, Fundraising, Partners and
  Customer health read it. A deal from a CRM later is the same row, told
  apart by `source` and the CRM's id.
- **A form answer was said to the team, so the team keeps its words.**
  `form_answer` keeps what someone wrote into one of the team's forms, word
  for word, as `triage_report` does, and everyone in the Lemma can read it
  (Careers answers and CVs too: the Careers form says so when it is turned
  on). The owner's conversation about it is still their own (`conversation`,
  `source` form, written only by their own run). A plugin that owns a kind
  of work listens for answers routed to it (`routed_to`) and writes back
  what they became (`work_source`, `work_id`, `work_label`, `state` filed);
  a plugin with a form of its own registers it in `form` (`owner_plugin`)
  and keeps its `last_answer_at` and `week`, so every door is counted in one
  place while its answers stay that plugin's. `FORMS_NS =
  ba341d0a-0b0a-4d01-9869-2c8791b9f203`.

- **A task is one shape in two tables.** The platform's row-level security
  lets a row through to its owner only (`schema_manager.py`,
  `_user_isolation_policy_sql`), so "private until shared" cannot be a column:
  a person's own tasks are `personal_task` (RLS), the team's are `task`, with
  identical columns, and sharing one moves it across keeping its id (Tasks'
  `tasks_move`). Read both for everything on someone's plate. A task is
  source-neutral: typed in Tasks (`source` tasks), added by the Lemma in chat
  (chat), made from a promise (promise, `source_id` the promise's id, `quote`
  its sentence), or synced from Linear (linear, the issue's id): the same row.
  `assignee_agent` `pod_default` is the Lemma's own assistant. An agent's run
  on a task is Tasks' own state (`tasks_run`, same id), not the contract's.
- **Every row says where it came from**: a `source` and the provider's own id.
  Nothing Gmail- or Outlook-specific is a shared column. A source's own
  working state (Mail's mailbox, labels, sync cursor, drafting handshake)
  lives in that plugin's own table, whose row id is the conversation's id
  (Mail: `mail_thread`).
- **A person is found by handle.** `person_handle` rather than an emails list
  on the person: a lookup is a plain join, two plugins adding handles at once
  never overwrite each other, and merging two people is moving rows. A plugin
  that meets a handle looks it up, and adds it to an existing person when it
  can tell (a Slack profile's email) instead of making a second person.
- **A brand is the team's, and only read by everyone else.** Brand kit
  writes `brand` (one row per brand; readers take the default one whose
  `state` is `check` or `ready`); Deck maker, Proposals, LinkedIn, Newsletter
  and Mail's drafts read it. Apply `tokens` (`--brand-ink`, `--brand-surface`,
  `--brand-accent`, `--brand-accent-ink`, `--brand-font-display`, …) or link
  `theme_css_path`; take logos from `logos` by `variant` (primary, inverse,
  mono, mark); read the guide at `guide_path` (its voice section) before
  writing words for the team. A colour, face or logo the row lacks is a gap
  to say, never one to fill. What a read found it from (screenshots, CSS) and
  the person's fixes are Brand kit's own (`brand_evidence`,
  `brand_correction`); a fixed colour stays fixed when the brand is read
  again.
- **Who asked is the team's; what they said stays with whoever heard it.**
  `ask` is one row per person, per place they asked, per piece of work, so
  "six people asked" is six rows and each can be told where they asked. It
  holds facts only, as `deal` does: the work (`work_source`/`work_id`, a
  Triage item before there is a task, then `task_id` too), the person by
  handle, where (`source`, `source_id` of the thread, `conversation_id`), who
  heard it (`heard_by`) and how far it has got. The words stay in the
  hearer's own `conversation`, and only their own run reads them to write
  back (a `draft` there, through Mail). A row's id is
  `uuid5(ASK_NS, "<handle_kind>:<handle>|<source>:<source_id>|<work_source>:<work_id>")`,
  with `ASK_NS = 9972cf8e-4f42-4b98-86fc-fa5697c1f089`, from the values it
  was first written with; merging a duplicate repoints the work and keeps the
  id. Triage writes it at intake (each reporter: an issue's author and its
  "me too"s, a Slack reporter; people an error tracker only counts are reach,
  not askers). Release notes writes a link a person confirms (`suggested`
  until they do). **One teller**: with Release notes installed (its
  `release_note` table exists) it tells askers when the work ships and sets
  `told`; without it Triage tells them when the task is done; Triage always
  tells a `declined` ask why. Roadmap and User feedback read it.
- **A pull request's facts are the team's; the review stays PR review's.**
  `repository` and `pull_request` are written only by PR review and read by
  the rest, and hold facts only, as `deal` does: where a pull request stands
  (`state`, `head_sha`, `risk`, `checks`, `mergeable`), who it waits on and
  for what (`waits_on` a member's user id, `nobody` or `author`;
  `waits_for` review, merge, fix, round or nothing), what the latest round
  decided (`review_state`, `verdict`: code decides it, never the model) and
  a plain-language `summary`. The findings, rules, rounds and the merge log
  are PR review's own (`prr_*`). A row's id is `uuid5(PRR_NS, key)` for a
  pull request and `uuid5(PRR_NS, "repo:" + full_name.lower())` for a
  repository, with `PRR_NS = 3f0b6c1e-8a2d-4e57-9c41-7d5e2a9b6f03`, so two
  webhooks meeting a new pull request at once write one row. Release notes
  reads `summary` and `linked_issues` of what merged; Dependency updates and
  Coding agent read `review_state` and `verdict` by `key` before they call a
  pull request done. `merge_state` `merged_by_itself` says nobody pressed
  Merge.
- **Categories are not shared yet.** `conversation.category` holds a key from
  the owner's own categories, which today are Mail's (`mail_category`). If
  Chat should sort into the same categories, move that table here.

## Needs you

`needs_you` is one list of what needs each member, written by every plugin
and read by Today, so the day is never one plugin's view. One row is one thing
that needs one person, and says what they do about it (`verb`):

| Verb | Means | Written by (today) |
| --- | --- | --- |
| `answer` | someone is waiting on their reply | Mail (replies owed) |
| `decide` | a choice only they can make | Mail ("was this promise kept?" when not sure) |
| `attend` | a meeting or call, with `due_at` its start and `ends_at` its end | Meetings (today's and tomorrow's) |
| `do` | something they said they would do | Mail, Meetings (promises they made) |
| `waiting` | something someone else owes them | Mail, Meetings (promises owed to them) |
| `drifting` | someone who matters going quiet | People map |

Why this shape:

- **By verb, not by source.** The day is organised by what the person does.
  A Slack plugin's waiting reply is `answer` like Mail's, and Today needs no
  change to show it.
- **One id per (plugin, source table, source row, verb, member)**:
  `needs_you_id` in `snippets/needs-you.py` (`uuid5`, namespace
  `6b1d9a2e-4c37-4f0a-9e58-2d7c1b3f8a65`). Writers upsert and never
  duplicate; the member is in the key so a team-wide source (a deal, a task)
  gives each person their own row. The member is the row's owner (RLS): a
  writer runs as the person (a trigger on their own row, their own schedule).
- **Each writer owns its items and resolves them**: an item its source no
  longer supports is set `done`, closed by the source.
- **Dismissed stays dismissed until the source changes.** `source_version` is
  a fingerprint of the source as written (a conversation's state and newest
  message, a promise's text and date); an item the person dismissed or did
  opens again only when it changes. One resolved by its source opens again
  whenever the source needs the person again.
- **It says where to open**: `app` and `path` in this Lemma
  (`client.apps.open(app, path)`), and `conversation_id` when it belongs to a
  conversation.
- **What is already done** for the person: `prepared` ("Reply drafted in your
  voice", "Brief ready") and `prepared_text` to preview.
- **A plugin can ask the item's source for something** without carrying it:
  `request` (`nudge`) and `request_hint`. Mail watches for `request = nudge` on
  its own items and drafts the follow-up; Today sets it.

Every writer embeds `snippets/needs-you.py` between `# contract:needs-you`
and `# end contract`, word for word (the lint checks), and calls
`needs_you_write(pod, plugin, member, items, scope_where)` with the items that
are current in what it looked at. A plugin's sample clear closes its items
(`done`, closed by the source): they leave the day without a delete grant on a
table every plugin shares.

## Memory block

Every agent in a Lemma reads `/memory/AGENTS.md` at the start of every run:
the Lemma's shared memory index (the platform's
`docs/architecture/agent-memory.md`). A plugin tells the Lemma's agents it is
installed there, in a block of its own between markers, and keeps the detail
in a guide an agent reads only when it needs it.

```markdown
<!-- plugin:tasks -->
- Tasks is installed: each person's private list and the team's projects. Add a task with `tasks_add`; how to use the rest: `/memory/plugins/tasks.md`.
<!-- /plugin:tasks -->
```

- **The block** is one or two lines: what is installed, and the guide's path.
  At most **200 characters with its markers** (`AGENTS_MD_BLOCK_BUDGET`). An
  index reaches a run's brief cut to 2,000 characters
  (`AGENT_MEMORY_INDEX_MAX_CHARS`), and to about 1,365 when all four of an
  agent's indexes are full (the 6,000-character section split four ways, less
  headings: `guaranteed_index_chars` in the platform's
  `context_brief/memory.py`). Six plugins at 200 are 1,200: under that floor,
  so the blocks are never cut, and the team keeps most of the usual 2,000 for
  its own notes. At 300, five plugins already pass the floor.
- **The guide** is `/memory/plugins/<plugin>.md`: what the plugin holds, which
  functions, apps and tables to use from chat, and what never to do. At most
  4,000 characters (`AGENTS_MD_GUIDE_BUDGET`; the platform asks for a memory
  file past 8,000 to be condensed). Everyone in the Lemma can read `/memory`,
  the Lemma's assistant reads it as the person, and file search finds it.
- **A standing rule is a block too.** Brand kit's line is the rule itself:
  follow the team's brand and voice in everything you write or make, with the
  guide's path. In a test the assistant read the guide before drafting a reply
  and wrote in its voice.
- **A personal block** goes in each person's `/me/AGENTS.md` (Mail: where that
  person's voice is). The same call with `index=AGENTS_MD_ME`, from a function
  running as that person: their own set-up workflow run, the app's
  `runFunction`, the CLI. It needs no grant, and none can be given (the
  importer refuses `/me` grants); the datastore lets a person's own tree
  through (`authorizer.require_path_write_permission`). Both a function run
  and a set-up workflow's FUNCTION step wrote it in testing. A schedule or
  trigger writes the `/me` of the person it runs as, so write a personal block
  only from that person's own run.

**The set-up writes it, never the bundle.** The importer creates a bundled
file only where there is none (`applier._apply_file`), so a bundled
`AGENTS.md` would be skipped or kept over the team's own, and never updated.
A plugin carries only the folder, `files/memory/.folder.json` (the
contract's, `--fix` copies it), so its function's folder grant on `/memory`
resolves in an empty Lemma, and runs a memory function from its set-up that
embeds `snippets/agents-md.py` between `# contract:agents-md` and
`# end contract` and calls `agents_md_write`:

| | |
| --- | --- |
| Re-running set-up | replaces only that plugin's block, in the index and in its guide; an unchanged file is not written; a block something took out is put back |
| Where set-up calls it | the last step of `tasks-setup`, `mail-setup`, `meetings-setup`, `people-setup` (`<prefix>_memory`); Booking's `booking_save` on its set-up save. Today has no set-up run: every `today-sweep` (the first is right after the person picks their time) runs `today_memory`, which reads two files and writes nothing when the block is there |
| Clearing the sample | does not touch it (no sample function has a grant on `/memory`) |
| Uninstall (not built yet) | the uninstaller runs the plugin's memory function with `remove` (`agents_md_write(pod, slug, None)`): the block leaves the index and the plugin's text leaves its guide, the team's notes stay; deleting the emptied guide needs `folder.delete`. A personal block leaves only by a run as that person |

What `agents_md_write(pod, slug, block, guide=None, index=AGENTS_MD_POD)`
promises:

- Nothing outside the plugin's markers changes. A new block goes after the
  last plugin block, else at the top below a leading `# ` title: an index cut
  to fit the brief loses its last lines, and blocks are short and fixed.
- Creates `/memory/AGENTS.md` and `/memory/plugins/` when missing. A file it
  cannot read for any reason but its absence is never written over.
- Markers are found with any spacing and written in one form. Copies of a
  block become one. An opening marker whose closing one was lost is left
  alone (whatever follows it may be the team's), and a whole block is written.
- Reads back what it wrote, and writes again on top of anything written in
  between (two plugins' set-ups at once).
- Warns, without failing, when the block or guide is over budget, or the index
  is past 2,000 characters.

**The memory keeper.** After a conversation, a background pass keeps what the
turn said, and its only write is a whole file (`pod_write_file`); nothing in
the platform tells it to leave marked blocks alone. On a hosted Lemma (18 Nov
2026), six turns in a scratch Lemma with two blocks in `/memory/AGENTS.md`,
two in `/me/AGENTS.md` and the team's notes: the keeper rewrote
`/memory/AGENTS.md` twice (changing the team's lines, once with the index at
3,122 characters, past what the brief shows) and the assistant edited both
indexes in its turns three times; every block came through word for word.
Re-running set-up puts back one that does not.

### In a plugin

```
.lemma/agents-block.md                 the block's lines, no markers
.lemma/guide.md                        the guide, no markers
.lemma/agents-block-me.md              optional: each person's block in /me/AGENTS.md (Mail's), same budget
functions/<prefix>_memory/code.py      AGENTS_BLOCK, AGENTS_GUIDE, AGENTS_BLOCK_ME (lint --fix copies them in), the snippet, the call
functions/<prefix>_memory/<…>.json     a folder grant on /memory: bin/fnjson.py <prefix>_memory "…" /memory:read,write
files/memory/.folder.json              the contract's (lint --fix)
```

Tasks, worked through: `tasks_memory` is the last step of `tasks-setup`.

```python
AGENTS_BLOCK = """\
- Tasks is installed: each person's private list and the team's projects. Add a task with `tasks_add`; how to use the rest: `/memory/plugins/tasks.md`.
"""
AGENTS_GUIDE = """\
# Tasks
…
"""

# contract:agents-md
…  (snippets/agents-md.py, word for word)
# end contract


def tasks_memory(ctx: FunctionContext, data: TasksMemoryInput) -> TasksMemoryResult:
    block = None if data.remove else AGENTS_BLOCK
    guide = None if data.remove else AGENTS_GUIDE
    try:
        done = agents_md_write(ctx.pod, "tasks", block, guide)
    except Exception as exc:  # set-up goes on without it
        ...
```

A Lemma whose team already had notes then reads:

```markdown
# Memory
<!-- plugin:tasks -->
- Tasks is installed: each person's private list and the team's projects. Add a task with `tasks_add`; how to use the rest: `/memory/plugins/tasks.md`.
<!-- /plugin:tasks -->

- Replies to customers go out in British English.
```

Asked "Is Tasks installed? If it is, add a task to my list…", the Tasks
Lemma's assistant answered from the block, read the guide, called `tasks_add`
and said only the person can see it. In `Today with everything` (Mail,
Meetings, People map and Today, each block written by its memory function),
asked what is installed, it named each one in its block's words (replies
drafted in your voice and nothing sent without you; briefs before and notes
after; how warm, last contact, what's owed; the day from one shared list).

## Questions

`questions/conversation-read.json` is what any plugin asks the Decisions API
about one conversation: what it needs from the owner, how soon, and whether a
promise was made either way, worded for any source. The caller adds the
category question from the owner's categories. Code embeds the object verbatim
between `# contract:conversation-read` and `# end contract`.

## The rules, enforced by `lint.py`

Run from the repository root: `uv run --no-project python _contract/lint.py` (`--fix`
copies contract tables into the plugins that need them, and a memory block's
text and the `/memory` folder into the plugin that writes one).

1. A plugin carries every shared table it touches, byte for byte, plus the
   shared tables those reference.
2. No table, function, agent, workflow, schedule or app name is used by two
   plugins (prefix your own: `mail_thread`, `mail-setup`), and no two plugins
   default to the same app slug.
3. A resource folder's name is its `name`.
4. Embedded questions equal `questions/*.json`.
5. Every plugin app depends on the packed kit, byte-identical to
   `_kit/dist/`, carries `_kit/app-files/`, and the kit is packed from its
   current source.
6. A plugin that carries other plugins (`plugin.json`, e.g. Today carries
   Mail and Meetings) gets the shared tables from them, assembles without a
   conflict, and the assembled bundle names nothing it lacks; a build left in
   `_build/out/` is current. See `../_build/README.md`.
7. A plugin's memory block (above): `.lemma/agents-block.md` under 200
   characters with its markers, naming `.lemma/guide.md` (under 4,000) by its
   path `/memory/plugins/<plugin>.md`; the function that embeds
   `snippets/agents-md.py` word for word holds both as `AGENTS_BLOCK` and
   `AGENTS_GUIDE`, calls `agents_md_write` and has a folder grant on
   `/memory`; the plugin carries `files/memory/` exactly as the contract's.
   **A plugin with no block is a warning** (`WARN`), so lint stays clean while
   plugins get theirs. When every plugin has one, set
   `MEMORY_BLOCK_REQUIRED = True` at the top of `lint.py` and a missing block
   fails.
8. `install/<plugin>/`, the folder a Lemma installs from, exists for every
   plugin, is exactly what `_build/assemble.py --install` makes now, and holds
   what the server-side import needs and nothing it must not. See
   `../_build/README.md`.

Changing a shared table changes it for every plugin: add columns, never rename
or repurpose one, and run `--fix` and each plugin's import.
