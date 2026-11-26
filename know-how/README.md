# Know-how

Your procedures, written once, answering questions and walking people through
each step.

Each answer, procedure and policy is a Markdown page under
`/know-how/<topic>/`, with an owner and a check date kept in Know-how's own
table. The Lemma answers from those pages wherever people ask (Teams, Slack,
its mailbox, web chat), and every answer carries one line: which page, and
who checked it when ("From *Lead times*, checked by Priya Raman on 3 Nov.").

- A question no page answers goes to the topic's owner. Their reply comes back
  as a draft page they save in one press, the people who asked are told, and
  the next person gets the answer without them.
- Past its check date, the team still gets an answer, with a warning: "Past
  its check date (due 17 Nov). I've asked Priya to look."
- Customers get only checked, in-date answers a page's owner approved for
  them. Public ones are copied to the shared `article` table, which Support
  inbox and Help center will read; a public answer leaves it at the start of
  its check date.
- A procedure is walked one step at a time in chat (or in the app), with Done,
  I'm stuck and Stop. A question asked mid-walk goes to the owner, and their
  reply becomes a proposed change to that step.
- HR-only pages stay HR-only: search returns only what the asker may read, and
  on a sensitive topic (leave, pay, health) who asked is never kept.

The app opens on **Answers** (every question, and what answered it), with
**Library** beside it (every page, its owner, next check and state; asked
most; going stale). A procedure opens as its **Playbook**. See `DESIGN.md`.

It carries no other plugin. It carries the shared `needs_you` list (Today) and
adds the shared `article` table (`_contract/tables/article.json`).

## How it works

| Part | Does |
| --- | --- |
| `knowhow_answer` | The assistant calls it from the memory block, in the asker's run: a search of `/know-how` (filtered by the platform to what that member may read), one Decisions call ("which page answers it, fully or partly"), the question logged, repeats joined, uses counted. On a miss it does the miss work inline (topic, repeat, owner and how they want to be asked), so a miss is caught even if the model calls nothing else. |
| `knowhow_answer_for_contact` | Opened to contacts at set-up. Only live, checked, in-date pages meant for customers; nothing in date means `pass_to_person` (`ask_a_person`). |
| `knowhow_missing` | An explicit miss: the page didn't fit, the asker said it was wrong, or a mid-walk question. |
| `knowhow_draft` + `knowhow-draft` (`knowhow_writer`) | The owner's reply, word for word, becomes a draft page (or, mid-walk, a proposed change to a step). The writer adds no step, number or fact the reply lacks, and lists what it didn't say as "[ask Priya: …]". |
| `knowhow_decide` | The person's decisions in the app: save, edit, covered by, set aside, ask the owner, keep, retire, approve for customers / take back, add or decline a change. |
| `knowhow_walk`, `knowhow_assign` | Walks and assignments. |
| `knowhow_check` (daily 00:15) | Past check date; the public copy out on its due day; "may disagree" when a page or its source file changed (a Decisions call on the changed passages); sheet pages made again; uses counted; websites and Drive folders read again on Mondays. |
| `knowhow_mine` (each person, every 15 min) | Their Today items (answer, decide, do), and a line in their own Lemma channel when a question they asked has an answer, including on a sensitive topic. |
| `knowhow-sweep` (daily) | The safety net for gap 3: the Lemma's assistant reads the last day's group and customer chats, as whoever ran set-up, and `knowhow_sweep` logs questions nobody logged. |
| `knowhow_on_slack` (`knowhow-slack`) | A watched Slack channel: questions are logged; a reply in a waiting question's thread becomes a draft. |
| `knowhow-setup`, `knowhow-me` | The team's set-up (sources, the reader's proposals, owners, places, audiences, memory) and each person's own (how to be asked, when to check). The app is the screen for every form. |
| `knowhow_read_source` + `knowhow_reader` | Reads uploads, a website and Drive folders, and proposes topics and drafts, each quoting its passage. A CSV or xlsx sheet becomes a Markdown table page beside it, made from it with the standard library and made again when it changes. |

### What only a person can do

A function can't be granted a table's visibility, a folder's access, opening a
function to contacts, `schedule.create`, contact outreach or a notice to
another member. So the app does these as the person, each read back on the
set-up's last screen:

- marking `article` Public (when customers or the public are on);
- opening `knowhow_answer_for_contact` and `knowhow_missing` to contacts;
- making a restricted topic's folder `RESTRICTED`, read by its role (through
  the role's own grants: the resource-access route can't take a folder's path);
- the `knowhow-sweep` schedule, each person's `knowhow-mine-<id>`, and the
  Slack channel trigger;
- telling people their question has an answer: members by a line in their
  own Lemma channel, customers by contact outreach.

Admins of a Lemma can read every row of an RLS table, so `knowhow_my_question`
(the sensitive asker's own link) is readable by them.

## What was measured

On a fresh scratch Lemma ("Know-how scratch 1125", left on the team's hosted
test server), installed server-side, in quiet mode, with one member:

- Install, sample load (20 pages, 48 questions, Today items) and clear (every
  file and row gone, Today items closed), over real set-up data too.
- Set-up through the app: two uploaded documents, a CSV and a public website;
  the reader proposed six topics and fourteen drafts and made a table page from
  the CSV; owners set, one topic restricted to an HR role, three sensitive;
  places, audiences and the memory block saved; `article` marked Public, both
  contact functions opened, the folder restricted, the sweep and the person's
  schedules made. Each person's own set-up too.
- A cited answer in web chat: the assistant read the block, called
  `knowhow_answer` and ended with the source line. A late answer with its
  warning.
- A miss → the writer drafted from the owner's reply → Save as answer → asked
  again in other words → answered from the new page.
- A sensitive question logged with no name, answered, and its asker told by
  their own `knowhow_mine`.
- `knowhow_check`: a page changed under the Lemma flagged may-disagree; a
  public answer in `article` the day before its due date and out on its due
  day.
- A walk: step by step, a question mid-walk logged for the owner, their reply
  a proposed change, added under step 2; an assignment walked to the end.
- The sweep found a question in a group chat the Lemma had never been asked.
- `bin/check.py`: 49 unit checks (steps, source line, late and in-date rules,
  the due-day rule, repeats, the sensitive split, Today items and versions,
  sheets, `article` ids, the sample, shared code).
- The app in light, dark and at 375px (Answers, a question, Library, a page,
  the Playbook, a walk, set-up), no console errors, no sideways scroll, keys.

## What was not verified

- **Microsoft Teams, all of it.** No test tenant is connected yet, so no
  answer, owner question, walk or shared file was tried in Teams; every check
  was walked in web chat and a Lemma group chat instead.
- **Slack:** no Slack account was connected, so the watched-channel trigger
  and a teammate's reply drafting an answer were not run.
- **A customer by email:** `knowhow_answer_for_contact`'s filter was run (an
  in-date customer page answered, a stale one passed on), but not from a
  contact's own run on email or Slack Connect, and no customer was told.
- **A restricted page hidden from someone outside HR:** the folder and page
  were made `RESTRICTED` and the HR role given read, but the scratch Lemma has
  one member (an admin), so nobody outside HR asked.
- **Google Drive** (no installation in the test organization; the operation
  names are from the live catalog and unchecked).
- **`channel_post` waiting across days** for the owner's reply.

## Platform gaps (each said on screen)

1. A Teams user who isn't a member gets no answer: v1 answers members only, and
   every asker is a seat.
2. Audience is per table, not per row: customer-only answers are served by a
   function; public ones are a second copy in `article`.
3. No signal when a run fails to answer: misses count when logged; the sweep
   catches the rest daily.
4. Spreadsheets, slides, images and IES files are never indexed: named per
   file; CSV and xlsx get a table page.
5. No source link for outsiders: the source line is plain words.
6. Public reads cap at 500 rows with no search (matters to Help center).
7. Teams channel messages can't start a schedule (Slack's can).
8. Files take no plugin metadata, fire no change event and keep no history;
   the Docs page can't show "checked by": the mark lives in `knowhow_article`
   and changes are polled daily against the checked text.
9. No SharePoint or OneDrive folder source: one file at a time, shared in
   Teams.

Found while building: a function can't hold `channel.read` (the sweep reads
through the assistant); a function opened to contacts must declare a
`contact_id` input; the resource-access route can't address a folder by path;
a file in a `RESTRICTED` folder stays `POD` unless set itself; a server-side
re-import keeps every existing part (updates went through `lemma pods
import`).

## Out of v1

Answering Teams users who aren't members; SharePoint or OneDrive folder sync;
Confluence, Notion and Guru imports; screen capture of a procedure; quizzes and
e-signatures; the help center itself and a link to a help page; translation;
the Lemma running a procedure for a customer.

## Try it

```bash
python3 -m http.server --directory know-how/.lemma/demo 8000   # then open http://127.0.0.1:8000
```

The same app on a sample Wednesday at Fernlow Lighting (`fernlow.example`),
with a **Where people ask** panel: a Teams channel, Slack Connect, email, and
a Teams user who isn't a member.

```bash
# from the repository root
uv run --no-project python know-how/bin/check.py
uv run --no-project python know-how/bin/demo-fixtures.py && node _kit/bin/demo.mjs know-how
uv run --no-project python _build/install.py know-how --lemma <lemma-id> --var knowhow_slug=<free name>
```
