# People map

Everyone you deal with, and where you stand: who they are and their company,
how warm things are, the last contact either way, what's owed both ways, and
the next meeting. Built from what **Mail** and **Meetings** read, and it
carries both: one install puts all three into an empty Lemma. It sends
nothing and connects nothing of its own.

When **Today** is in the same Lemma, its "gone quiet" section reads People
map's warmth (the fields are below).

Tested in two Lemmas: the assembled bundle (Mail + Meetings + People map)
installed server-side into an empty one, and a build Lemma where it was made.
The apps are `people` and `companies`, plus Mail's `inbox` and Meetings'
`meetings`; when a name is taken platform-wide the importer adds a suffix.

## What it does

```
Mail's set-up and Meetings' set-up (theirs, unchanged)
  ─▶ people-setup (per person; the People app is the screen for its forms)
       categories   which of Mail's categories are people you deal with
       domains      your own domains (colleagues aren't contacts)
       find         people_refresh: everyone in those conversations and on outside meetings
       sort         people_sort: one Decisions call per new person, a pass at a time
       share        people_refresh again: companies and the team's view
       review       the people it found: add, remove, settle (each a correction)
  ─▶ the list

hourly, as each person (their own schedule, made by the app): people-refresh = refresh ─▶ sort ─▶ refresh
on opening People (if the last count is over ten minutes old): people_refresh
a person's page asks for "where things stand"   people_person.summary_state → wanted
     ─▶ people-summary-wanted ─▶ people-where-things-stand: context ─▶ people-summary-writer ─▶ save
"Look them up" on a company                      people_company.research_state → wanted
     ─▶ people-lookup-wanted ─▶ people-company-lookup: context ─▶ people-researcher (web) ─▶ save
```

- **Decisions, one call per new person**, two closed questions together:
  *someone you deal with, or noise* (a receipt sender, a no-reply address, a
  list, a stranger's pitch) and *what they are to you* (customer, investor,
  partner, candidate, vendor, colleague, other). The evidence is the person's
  own conversations (counts, which way, Mail's categories, five newest
  subjects with a line of the newest message) and meetings. The person's
  newest twenty corrections go with every call as examples. Under 0.5 is
  "not sure" (Typesafe always answers, with a probability) and waits for the
  person. A person they settled is never asked over.
- **Counted, never asked**: last contact either way (a message in or out, or
  a meeting held), the usual gap, warmth, gone quiet, owed both ways, next
  meeting. Contact days more than three days apart start a new "episode"; the
  usual gap is the median between episodes. Warmth is the days since the last
  contact against that gap (none yet counts as two weeks): **warm** within 1.5
  gaps (at least 7 days), **cooling** within 3 (at least 21), **cold**
  beyond, **new** with no contact yet and a meeting ahead. **Gone quiet** is
  someone you deal with (not a colleague), cooling or cold, both sides have
  spoken (or met), no meeting ahead, no reply owed by you.
- **One row per human.** Mail and Meetings find a person by handle and make
  one with the same id (`uuid5(Mail's namespace, "<user>:email:<address>")`),
  so someone you write to and meet is one `person` and one `people_person`.
  People map makes a person the same way when it meets an address first.
- **Agents only write.** `people-summary-writer` (no tools): "where things
  stand" in two to four sentences, each ending with the `[n]` of the
  conversation or meeting it came from, plus durable facts with their source.
  `people_save_summary` drops a mark that points at nothing and a fact with
  no source. `people-researcher` (web search only): what a company does, and
  `found: false` when no page confirms the company at its domain, in which
  case nothing about the company is changed.

| Layer | Resources |
| --- | --- |
| Shared tables, its own folder | `company`, `company_domain` (new in `_contract`, team-wide) |
| Shared tables, from Mail and Meetings | `person`, `person_handle`, `conversation`, `message`, `promise`, `meeting` |
| Own tables | `people_person` (RLS, id = person.id) `people_fact` `people_correction` `people_settings` `people_sample_contact` (RLS); `people_link` `people_company` (team-wide) |
| Functions | `people_setup_prepare` `people_setup_apply` `people_setup_done` `people_refresh` `people_sort` `people_correct` `people_person_context` `people_save_summary` `people_company_context` `people_save_company` `people_company_edit` `people_sample_data` |
| Memory | `people_memory`, the last step of `people-setup`: People map's block in `/memory/AGENTS.md` and its guide `/memory/plugins/people.md`, from `.lemma/agents-block.md` and `guide.md` (`_contract/README.md`, Memory block) |
| Agents | `people-summary-writer` `people-researcher` |
| Workflows | `people-setup` (three forms) `people-refresh` `people-where-things-stand` `people-company-lookup` |
| Bundle schedules | `people-summary-wanted` (DATASTORE on `people_person`, runs as the row's owner) `people-lookup-wanted` (DATASTORE on `people_company`, team-wide so runs as the schedule's owner) |
| Per-person schedule | `people-refresh-<user>`, hourly at :17, made by the app when set-up finishes (Settings, Running for you) |
| Apps | `apps/people`, `apps/companies` (Vite, `@lemma-plugins/kit`), design in `DESIGN.md` |

## Companies (team-wide, in the contract)

`company` is one row per company and `company_domain` one row per email
domain, so acme.com and acme.co.uk are one company. Both are in `_contract`
because Deal tracker will hang deals on them, and both are team-wide (no RLS):
two members who deal with Acme share one company. The ids are made from the
domain (`uuid5(COMPANY_NS, domain)` for the domain, `uuid5(COMPANY_NS,
"company:" + domain)` for a company made from it, `COMPANY_NS =
c6fc6ea2-4356-443e-8065-e1d71b8f6359`), so two members' jobs meeting a new
domain at once write one row, and a domain belongs to one company only. A new
domain whose name part matches a company the team already has (acme.com,
acme.co.uk) joins it. Free webmail never makes a company, nor do colleagues
or people you marked "other" (friends, family, press): those stay yours. A
person can rename a company, merge it into another, or move a domain out
(`people_company_edit`). A company nobody's people point to any more, with no
notes, is removed by the next refresh.

## The team view

Each person's mail and meetings stay theirs (RLS). The team sees, for each
person anyone deals with: the person (name, title, address), their company,
the last contact and how warm, and who on the team knows them. Never message
text, a subject, the relationship, or "where things stand".

**How a team-wide last contact gets written when a job runs as one person:**
each person's own refresh, running as them, reads their own mail and meetings
under RLS and writes only **their own rows** of the team-wide `people_link`
(id = `uuid5(LINK_NS, "<member id>:<address>")`): one row per person they
deal with, holding just those columns. The team's last contact with someone
is the newest of those rows, read at the time. So two members' jobs never
write the same row (no read-modify-write race, nobody's contact overwrites
anybody else's), it says whose contact it was, and when someone stops dealing
with a person (or leaves the Lemma and their rows are removed) their part goes
with their rows. A person can turn sharing off (Settings, Your team).

## For Today: "gone quiet"

Read People map's own row; it is computed for exactly this and needs no rule
of Today's:

```sql
SELECT pp.id, p.name, c.name AS company, pp.kind, pp.last_contact_at, pp.last_contact_dir,
       pp.quiet_days, pp.usual_gap_days, pp.warmth
FROM people_person pp
JOIN person p ON p.id = pp.id
LEFT JOIN company c ON c.id = pp.company_id
WHERE pp.quiet IS TRUE AND pp.in_scope IS TRUE
ORDER BY pp.quiet_days - COALESCE(pp.usual_gap_days, 14) DESC   -- most overdue first
LIMIT 5
```

| Field | Meaning |
| --- | --- |
| `people_person.quiet` | gone quiet: someone you deal with (not a colleague), cooling or cold, both sides spoke or met, no meeting ahead, no reply owed by you |
| `people_person.quiet_days` | whole days since the last contact (set only while quiet) |
| `people_person.usual_gap_days` | their usual gap between episodes; null with one (counted as 14) |
| `people_person.warmth` | `warm` · `cooling` · `cold` · `new` |
| `people_person.last_contact_at`, `last_contact_dir` | the newest contact, `inbound` · `outbound` · `meeting` |
| `person.name`, `company.name` (via `people_person.company_id`) | who, where |

People map may not be installed beside Today: a query on `people_person` that
fails means it isn't, and the section stays hidden. Open someone with
`openApp("people", "/<people_person.id>")`, the whole list with
`openApp("people", "/quiet")`. `quiet` is written by the hourly refresh and
on opening People; it is per person (RLS), so Today reads the signed-in
person's own.

## Install

`install/people/` at the top of this repository is People map assembled with
Mail and Meetings, ready to install into an empty Lemma: **Add to your Lemma**
on its page at lemma.work imports it. From the CLI, the same server-side
import:

```bash
# from the repository root
uv run --no-project python _build/install.py people --pod <pod-id> \
  --var inbox_slug=<free slug> --var meetings_slug=<free slug> --var people_slug=<free slug> --var companies_slug=<free slug>
```

The bundle is assembled without Google Meet: the importer refuses a connector
the organisation has no installation of, even an optional one (as Meetings'
own `bin/import.sh` explains). After changing this folder or a base,
`uv run --no-project python _build/assemble.py --install` rewrites
`install/` (the lint fails until it does). `bin/lemma` is the `lemma` CLI
bound to one Lemma (`LEMMA_SERVER`, `LEMMA_ORG_ID` and `LEMMA_POD_ID`, from the
environment or a gitignored `.lemma.env` in this folder); `bin/grants.sh`
regenerates every function's grants (never edit `functions/*/*.json` by hand).
After the kit changes: `../_kit/bin/vendor.sh people`, then from the
repository root: `uv run --no-project python _contract/lint.py`.

## Each person

They open People. Until Mail or Meetings is set up for them, it shows both with
a button to each. Then it makes their settings and starts their own
`people-setup` run (so does anyone who joins later), and is the screen for it:

1. **Conversations.** Mail's categories, with VIP, People and their own on;
   Newsletters, Updates and Cold are shown and can't be ticked.
2. **Your domains.** Proposed from their own addresses (Mail's mailboxes,
   Meetings' calendars and the domains either knows), never free webmail.
3. **Reading.** Everyone found, each new person read once.
4. **Review.** The people it found with what each is; remove anyone, add
   anyone missing by address or from what it left out as noise, settle the
   ones it wasn't sure of. Each change is a correction the next read learns
   from. "These look right" opens the list and makes their hourly refresh.

## Verify

```bash
uv run --no-project python bench/bases_setup.py           # Mail's and Meetings' samples and set-ups, as their apps do
uv run --no-project python bench/people_setup.py --finish # People map's own set-up from the CLI (or use the app)
bin/lemma functions run people_sample_data --data '{"mode":"load"}' && bin/lemma workflows run people-refresh
uv run --no-project python bench/correction_teaches.py    # re-read, correct two, re-read
uv run --no-project --with pydantic python bench/warmth_rule.py
bin/lemma functions run people_sample_data --data '{"mode":"clear"}'
```

### Seen on 18 Nov 2026, on a hosted Lemma, samples

- **Install**: the assembled bundle (Mail + Meetings + People map, without
  `googlemeet`) into a fresh, empty Lemma with `_build/install.py`:
  every part CREATE, COMPLETED, the four apps built in the importer's sandbox.
  Mail's and Meetings' sample set-ups then ran as their apps run them
  (`bench/bases_setup.py`).
- **Onboarding, from the app** (Vite dev server signed in with the CLI's
  session): before Mail and Meetings were set up it showed both with a button
  to each; once they were, it started `people-setup` by itself. Categories
  (VIP, People, Investors, Customers, Hiring, Finance on; Updates, Newsletters,
  Cold shown and locked), domains (`yourcompany.example` proposed from the
  sample calendar; the account's own webmail domain left out), reading (26 people,
  about 30 s), review: settled Paul Girard as a customer, removed Felix Brandt,
  added Arjun Mehta by address (then asked what he is: Other), "These look
  right". The list opened and the app made the person's hourly
  `people-refresh-<user>` schedule.
- **One row per human**: 27 people in scope, 27 distinct addresses, no
  address on two people; 6 are in both the mail and the meetings (Mira
  Okafor: 2 conversations and 1 meeting on one row).
- **Decisions**: 26 calls for 26 people, about 20 s of call time, six at once;
  at the default categories every one was someone you deal with, 1 not sure
  (Paul Girard: closest "other", 41%; he is only on a meeting). Noise, with
  Updates, Newsletters and Cold counted for the test: the 4 new people (cold
  pitches) all read as noise, 84 to 99% sure. A correction teaching it
  (`bench/correction_teaches.py`, with Paul settled as a customer already):
  after Lucia Romano (an introducer) → partner and Grace Tan (quotes you for
  design work) → vendor, Rafael Costa (also an introducer) went partner 0.69
  → 0.76, Ruth Adeyemi (the landlord) vendor 0.49, not sure → 0.57, Inès
  Moreau (Paul's company) customer 0.82 → 0.89; two partners it was already
  sure of drifted down (0.95 → 0.86, 0.93 → 0.80), still partners.
- **Warmth and gone quiet**: everyone in Mail's and Meetings' samples is warm
  or new (their month has no gaps yet); with People map's sample, Ivo Petrov
  (monthly, 89 days) is cooling, Ana Ruiz (fortnightly, 48 days) and Maya
  Chen (every 10 days, 34 days) are cold, all three gone quiet, most overdue
  first; Sofia Marin (every 3 weeks, 24 days) stays warm. The rule on made-up
  days: `bench/warmth_rule.py`.
- **Where things stand**: Mira Okafor's, four sentences, every one with its
  `[n]` (2 conversations, 3 meetings), times in her owner's zone; pressing a
  mark scrolls to and lights the conversation; two facts remembered, each
  with its source. About 25 s.
- **Company look-up**: on Northgate (`.example`) it said no company could be
  confirmed and changed nothing about the company (`found: false`); on a
  well-known public company's domain (made for the test and tidied away by
  the next refresh) it filled what they do, size, location and website, with
  three sources.
- **Companies**: merge (Costa into Lumen Labs: domain and person moved),
  move a domain out (Costa back, same id), rename, in the build Lemma.
- **People and Companies open each other**: from the dev servers, `apps.open`
  went to `<companies app address>/<company id>` and
  `<people app address>/team/<address>` (the hosted apps then ask for
  sign-in).
- **Team view**: with the sample colleague, Mira's team last contact is the
  colleague's (yesterday), Priya Nair (only the colleague knows her) shows
  under Orchard Dental and on her own team page with nothing said.
- **Clear** (build Lemma, `bench/clear_leaves_nothing.py`): Meetings'
  clear, Mail's, then People map's, then a refresh: every row the three
  samples made is gone (people, handles, conversations, messages, meetings,
  promises, People map's people, facts, corrections, team rows, sample
  contacts, companies, domains, look-ups); People map's clear tidied 83 rows
  left for people and companies that were gone. Clearing Mail *before*
  Meetings leaves anyone on both (Mail's clear keeps a person a meeting still
  names; Meetings' clear never removes people): the first run left Mira Okafor
  and Eleanor Park that way, and People map keeps its two out-of-scope rows
  for them, because those people still exist.
- **Light, dark and 375px**, both apps, from rendered screenshots: no
  sideways scroll at 375 (page width 375).

Not verified: two real members in one Lemma (the team view was checked with
the sample colleague's rows, not a second person's own refresh); the hosted
apps signed in or framed inside Lemma's web app (they answer 401 to the
unsigned; checked through the dev servers with the CLI's session, which get
no change stream, so the review re-reads when it opens); a real mailbox or
calendar (never connected, by design); the hourly schedule firing on its own.

## Site pictures

`.lemma/shots/{people,person,company}-{light,dark}.webp`, 1440×900 at 2x,
from the built apps served on this Lemma's sample rows: `bin/shot-fixtures.py
"<person>" "<company>"`, then from the repository root:
`_kit/bin/shots_serve.py --app people/apps/people/source/dist --fixtures people/.lemma/shots/fixtures --port 4621`
(and the Companies build on 4622), `node _kit/bin/shoot.mjs …`, then `cwebp`.

## Needs you (for Today)

People map writes everyone it counts as gone quiet to the shared `needs_you`
list as `drifting` (`people_needs_you`, weight = days quiet past the usual
gap), run as the person when a row's `quiet` changes
(`people-needs-you-quiet` → `people-needs-you`, `people-needs-you-new` →
`people-needs-you-on-new`: one workflow per schedule). Today reads it there and
no longer queries `people_person`. The sample clear closes those items.
