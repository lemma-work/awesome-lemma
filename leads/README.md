# Lead research

Looks up each new person and company the first time they matter: their role,
what the company does, its size, recent news, and how well the company fits
you, every fact with the page it came from and when it was found. "Not
found" is an answer. It carries **People map** (which carries Mail and
Meetings): one install puts all four into an empty Lemma. It sends nothing
and connects nothing of its own.

Tested in a Lemma where the assembled bundle (Mail + Meetings + People map +
Lead research) was installed server-side with `_build/install.py`. The apps
are `leads`, plus People map's `people` and `companies`, Mail's `inbox` and
Meetings' `meetings`.

## What it does

```
People map sorts someone (people_sort, or the person settling them)
  ─▶ leads-person-sorted / leads-person-added  (people_person, as the row's owner)
       ─▶ leads-consider: leads_consider        "worth looking up?" (Decisions), once per person
            skipped · unsure (waits for the person) · queued
  ─▶ leads-queued (state → queued)
       ─▶ leads-claim: leads_claim              today's places, best first, up to the daily limit
  ─▶ leads-wanted (state → wanted)
       ─▶ leads-lookup: leads_lookup_context    mark it running; ask People map's company look-up
                        (people_company.research_state → wanted, as its button does)
                     ─▶ leads-researcher         the person at work and the company, each fact with its page
                     ─▶ leads_save               keep only what a page confirmed
                     ─▶ leads_fit                "how well does this company fit?" (Decisions); waits for
                                                 People map's look-up, a minute more if it's still running
  ─▶ leads-needs-you-fit / -review (fit_why or review changed)
       ─▶ leads-needs-you: leads_needs_you      "worth a look" on the shared needs_you list
daily, as each person (their own schedule, made by the app): leads-daily = stuck ─▶ claim ─▶ needs_you
```

- **Decisions, two questions per person, three per company.** *Worth looking
  up?* (`look_up` / `skip`, and *what decides it*: a new relationship, one
  growing, known for years, a routine contact, personal, too little). The
  evidence is People map's own read of the person (its `evidence` text:
  conversations, subjects, meetings) with when they first and last spoke and
  their company. *How well does this company fit?* (a 1-5 scale, *which parts
  it matches* and *which it misses*, from what they do, who they sell to,
  size, where, stage) against the team's sentence and example companies.
  "Why" is said from the matches and misses, never written by a model. The
  person's newest twenty worth corrections go with every worth call as
  examples; for the fit, the companies anyone corrected go into the question
  itself, newest first, at most six ("Fits like: Corbel Studio (4) because
  product design studio working with SaaS companies; 18 people; Copenhagen.
  Doesn't fit like: ...") and their evidence goes as examples.
  Under 0.5 is "not sure": a worth answer waits for the person, a fit shows
  as not sure and never goes on the day.
- **Rules before calls, cost nothing**: colleagues and "other" are never
  considered; a personal address (no company) is skipped; a reserved test
  domain (`.example`, `.test`, `.invalid`, `.localhost`, example.com) is "not
  found" at once with no search.
- **The agent only writes.** `leads-researcher` has web search and nothing
  else, and is given only the person's name, the title their own mail shows,
  their email domain, and what the whole team may see about the company.
  `leads_save` keeps a fact only with an http(s) link (never a reserved
  domain), stamps when it was found, drops person facts unless a page
  confirmed the person at that company and company facts unless a page
  confirmed the company at its domain.
- **People map's look-up, reused by listening.** Lead research never calls or
  changes People map: it asks for the company look-up the way the
  Look-them-up button does (`research_state → wanted`) when the company has
  none, it failed, or it is over 180 days old, and reads the result
  (`company` columns, `people_company.research` and `research_sources`) when
  scoring the fit. Its own researcher adds the person and per-fact company
  facts: size, funding, news, each with its link.
- **A daily limit** (`leads_settings.daily_limit`, 10 by default, 1-100). A
  place is taken when a lead becomes `wanted` (`wanted_at`, in the person's
  own day); `leads-claim` runs one at a time, so the limit holds exactly.
  Past it, the rest wait for the next morning's pass, best first: a meeting
  ahead, then someone who wrote, then the most recent contact. Asking for
  someone yourself can go past it (`force`): it says so, and takes no place.

| Layer | Resources |
| --- | --- |
| Shared tables, from People map, Mail and Meetings | `person`, `person_handle`, `company`, `needs_you` (and People map's `people_person`, `people_company`, `people_settings`) |
| Own tables | `leads_settings` `leads_person` (id = person.id) `leads_correction`, per person (RLS); `leads_profile` (who fits the team, one row) and `leads_company` (id = company.id: facts, news and the team's fit), team-wide |
| Functions | `leads_setup_prepare` `leads_setup_apply` `leads_consider` `leads_claim` `leads_setup_done` `leads_memory` `leads_lookup_context` `leads_save` `leads_fit` `leads_needs_you` `leads_correct` `leads_request` `leads_daily` `leads_sample_data` |
| Agent | `leads-researcher` (web search only) |
| Workflows | `leads-setup` (three forms) `leads-consider` `leads-claim` (one at a time) `leads-lookup` `leads-needs-you` `leads-daily` |
| Bundle schedules | `leads-person-sorted` `leads-person-added` `leads-company-known` (People map's `people_person`: a kind, someone added back, a company found) `leads-queued` `leads-wanted` `leads-needs-you-fit` `leads-needs-you-review` (`leads_person`); all DATASTORE on per-person tables with `bulk_writes: each`, so each runs as the row's owner |
| Per-person schedule | `leads-daily-<user>`, 07:07 their time, made by the app when set-up finishes (Settings, Every morning) |
| App | `apps/leads` (Vite, `@lemma-plugins/kit`): "Worth a look" shows fit 3 and up (not-sure ones marked) with a Show all switch; the day's count shows look-ups asked for past the limit beside it |
| Memory | `.lemma/agents-block.md` and `.lemma/guide.md`, written by `leads_memory` (last step of set-up) into `/memory/AGENTS.md` and `/memory/plugins/leads.md` |

Who fits is the team's (decided 18 Nov): one sentence and examples per
Lemma (`leads_profile`), written by whoever sets up first and editable by
anyone; the fit is one per company, on the team-wide `leads_company` row. A
person's run that scores a company copies the score onto their own leads there
(so their day updates); everyone's list reads it from the company. A Lemma set
up before this kept the sentence on the person's `leads_settings`: the first
fit call copies it into the team's row.

## LinkedIn

Not used. It isn't in the set-up; Settings says so in one line. Lemma's `linkedin` connector (Composio) has
no search. `LINKEDIN_GET_PERSON` reads a member only by a person id "unique to
the context of your application" (lite fields: name, picture), so it cannot
find someone by name or email; `LINKEDIN_GET_COMPANY_INFO` lists only
organisations the signed-in member administers; `LINKEDIN_GET_NETWORK_SIZE`
needs an organisation's numeric id. The rest post, comment, upload media, or
read ad-targeting and page statistics of the member's own organisations.
Public LinkedIn pages a web search turns up are read like any page.

## needs_you

`decide`, "worth a look": a lead looked up in the last fourteen days, at a
company the team fits 4 or 5 to (sure, or set by someone), who wrote to them
(`people_person.last_inbound_at`) or is meeting them (`next_meeting_at`
ahead), not yet kept or passed. Opens `leads` at `/<person id>`. `weight` is
fit × 10, plus 5 with a meeting ahead; `due_at` is the meeting;
`prepared` "Looked up: n facts with sources", `prepared_text` the one-line
summary. Resolved (done, closed by the source) when the person keeps or
passes the lead, after fourteen days, or when the sample is cleared.

## For People map: a "Looked up" section

People map's own pages are unchanged. What a section on a person's page
would read, from `leads_person` (same id as `people_person`, per person):

```sql
SELECT lp.state, lp.role, lp.location, lp.profile_url, lp.summary, lp.facts, lp.not_found,
       lc.fit, lc.fit_sure, lc.fit_why, lp.looked_up_at, lc.facts AS company_facts, lc.news
FROM leads_person lp LEFT JOIN leads_company lc ON lc.id = lp.company_id
WHERE lp.id = :person_id
```

(`lc.fit`, `lc.fit_sure` and `lc.fit_why` are the team's fit.)

- **Looked up 3 Nov** · Head of Operations at Lumen Labs · Lisbon ·
  *Fits 5 of 5: matches on what they do, size and where they are.*
- Each fact as `label · value · source ↗ · found <date>`; "Not found: their
  role." when `found` is false.
- A link "Everything in Leads" (`openApp("leads", "/<person id>")`).
- No row: "Not looked up. Look them up" (`leads_request` with `person_id`);
  `skipped`: the reason (`worth_reason`) and "Look up anyway".

On a company page, from `leads_company` (team-wide, same id as `company`):
size, funding and founded with their links, and the news list. People map
hides the section when the query fails (Lead research not installed).

## Install

`install/leads/` at the top of this repository is Lead research assembled
with People map, Mail and Meetings (without Google Meet), ready to install
into an empty Lemma: **Add to your Lemma** on its page at lemma.work imports
it. From the CLI, the same server-side import:

```bash
# from the repository root
uv run --no-project python _build/install.py leads --pod <pod-id> --var leads_slug=<free slug> \
  --var people_slug=<free slug> --var companies_slug=<free slug> \
  --var inbox_slug=<free slug> --var meetings_slug=<free slug>
```

`bin/lemma` is the `lemma` CLI bound to one Lemma (`LEMMA_SERVER`,
`LEMMA_ORG_ID` and `LEMMA_POD_ID`, from the environment or a gitignored
`.lemma.env` in this folder); `bin/grants.sh` regenerates every function's
grants (never edit `functions/*/*.json` by hand). After the kit changes:
`../_kit/bin/vendor.sh leads`; after any change here or in a base, from the
repository root: `uv run --no-project python _build/assemble.py --install`
and `uv run --no-project python _contract/lint.py`.

## Seen on 18 Nov 2026, on a hosted Lemma

- **Install**: the assembled bundle (Mail + Meetings + People map + Lead
  research, without `googlemeet`) into a new, empty Lemma
  with `_build/install.py`: COMPLETED, no warnings, all five apps built in the
  importer's sandbox. Then Mail's and Meetings' sample set-ups and People
  map's set-up from the CLI (`bench/`), and People map's sample: 26 + 4 people.
- **Onboarding, from the app** (dev server signed in with the CLI's session):
  until People map was set up it showed only People map with a button to it;
  then it started `leads-setup` itself. Who fits you: sentence, two examples
  (one chip from the person's own customers in People map, one typed); who to
  look up: customers 10, investors 5, partners 3 ticked, candidates and
  vendors offered, colleagues and other locked, limit set to 5, the LinkedIn
  card; reading: 22 people, about 20 s; review: 20 to look up ("5 today, the
  other 15 over the next 3 days"), 2 skipped; skipped two more there (each a
  correction); "Start looking up". The memory block and guide were written
  (`/memory/AGENTS.md`, `/memory/plugins/leads.md`) and the daily schedule made.
- **Worth looking up?** (22 Decisions calls): skipped Marcus Lee
  (`ap@tidal-foods`, an accounts-payable address: "too little to go on", 61%)
  and Sofia Marin (a customer known for five months, 56%); everyone else in the
  samples is a new relationship from the last month, and was worth it (51% to
  100%). Four people added by hand at real companies with no mail at all were
  "worth it, though too little to go on". A person whose kind arrived before
  People map had made their company waits for it (`leads-company-known`)
  instead of being skipped as a personal address (found in testing, fixed).
- **The daily limit held**: 5 places given, best first, 13 people queued; 18
  `leads-claim` runs, one at a time, none gave a sixth. Four look-ups asked for
  past it (`force`) ran and said so. The daily pass ran by hand: 0 claimed,
  1 waits for tomorrow.
- **Look-ups on real public companies** (people added by hand at five
  well-known software companies; none belongs to anyone involved, and every
  row about them was removed afterwards, below): every fact kept has its page
  and when it was found; the founders' roles, cities and public profiles were
  found (LinkedIn, the company's own pages, Crunchbase, Wikipedia); a made-up
  "Test Contact" at one of them was "not found" for every person fact while
  the company was found (6 facts, 1 news).
  People map's company look-up ran beside each (asked by `research_state →
  wanted`) and the fit waited for it. Time per lead 64-155 s with 3-10
  searches and 3-11 page reads before the instruction capped searches; 65 s
  with 2 searches and 1 page read after (5 person facts, 6 company facts).
  `bench/lookup_cost.py`. Sample `.example` people: "not found" at
  once with no search (zero cost).
- **Fit** (one Decisions call per company), first pass, per person: one real
  company 5, Brightwave Health and Lumen Labs 5 (samples), two real companies
  3 (miss on size), two larger ones 2 (240+ and 350+ people, head office
  elsewhere), service firms 2-3, funds 2-3 and mostly not sure, a bike maker
  and a dental group 2. Corrections then, as worked examples only: in three
  tries (Corbel Studio → 4; Volkov Advisory → 4; one of the real companies →
  4) no other company's score moved, and confidences moved within the noise
  of a re-score (±0.1); naming the scores in the instruction didn't move them
  either (three runs of `bench/fit_teaches.py`; their output is not kept
  here, as it names the real companies).
- **needs_you**: 4 `decide` items, "worth a look" (Brightwave Health ×2 with a
  meeting Tuesday, Lumen Labs, and Volkov Advisory after its correction);
  passing on a lead closed its item (done, closed by the source), and People
  map's own `drifting` item for the same person stayed.
- **From chat**: the Lemma's assistant read the guide and ran
  `leads_request`, then, against it, ran `leads_claim` and forced the look-up;
  the guide was tightened, and a second ask had it decline to look up a
  `.example` person and skip him unasked (put back). See "Calls" in the report.
- **Clear** (`bench/clear_check.py`): 15 sample leads put back exactly as they
  were (queued or not found), 13 sample companies' facts and fits and 2
  corrections on them removed, 4 open items done; People map's, Mail's and
  Meetings' tables, the real companies' facts and fits, and every other lead
  unchanged. The sample was loaded again afterwards.
- **People map's apps from Leads**: "Open in People" went to
  `<people app address>/<person id>` (asks for sign-in outside the frame).
- **Light, dark and 375px** from rendered screenshots: list, lead, settings,
  skipped; no sideways scroll at 375 (page width 375).

After review (18 Nov): who fits became the team's and the fit one per company
(`leads_profile`, fit columns on `leads_company`; the per-person `leads_fit`
table was removed from the bundle and from this Lemma); corrected companies
go into the fit question; "Worth a look" shows fit 3 and up with Show all;
LinkedIn left the set-up; and the real founders and the made-up contact at a
real company were removed from this Lemma with every row about them (People
map's and Lead research's, their five companies), and their ten look-up
conversations archived (conversations can't be deleted; their workflow runs
keep the step outputs). Only the `.example` sample remains.

Corrections in the question, three tries on the sample companies
(`bench/fit_teaches.py`, `bench/results/team_fit_teaches_*.txt`), each scoring
every company fresh before and after:

- Corbel Studio (design studio for SaaS, 18 people) → 4: no other service
  firm moved up (Volkov Advisory 2, Quill Partners 3, Talentbridge 3; their
  confidence fell 0.1).
- Volkov Advisory (go-to-market advisory for B2B software) → 4, with Corbel
  in the question too: Quill and Talentbridge stayed 3.
- Northgate VC (a seed fund) → 1: every other fund followed. Harborlane 3 → 1,
  Kestrel Capital 2 → 1, Parkhill 2 → 1 (and from 36% to 79% sure).

So a correction now teaches a clear kind of company ("funds aren't
customers"), and pulls alike companies down; two corrections did not pull
service firms up against a sentence that says "software companies".

Not verified: a second member in the Lemma (leads are per person, company
facts and the fit are the team's); the hosted app framed inside Lemma's web
app; the 07:07 daily schedule firing on its own.

## Site pictures

`.lemma/shots/{leads,lead}-{light,dark}.webp`, 1440×900 at 2x, from the built
app served on this Lemma's sample leads: `bin/shot-fixtures.py "Daniel
Kowalski"` (only `.example` people; the sample's own labels answered off),
then from the repository root: `_kit/bin/shots_serve.py --app leads/apps/leads/source/dist
--fixtures leads/.lemma/shots/fixtures --port 4693`, `node _kit/bin/shoot.mjs
http://127.0.0.1:4693 <out> leads=/ lead=/<person id>`, then `cwebp`.

## Verify

```bash
uv run --no-project python bench/bases_setup.py          # Mail's and Meetings' samples and set-ups (copied from People map's bench)
uv run --no-project python bench/people_setup.py --finish # People map's set-up (copied too)
bin/lemma functions run people_sample_data --data '{"mode":"load"}' && bin/lemma workflows run people-refresh
# Lead research's own set-up: open the app (it starts leads-setup and is the screen for its forms)
bin/lemma functions run leads_request --data '{"handle":"someone@<a real company domain>","force":true}'
bin/lemma functions run leads_sample_data --data '{"mode":"load"}'
uv run --no-project python bench/fit_teaches.py "<company>" <score>   # score all, correct one, score again
uv run --no-project python bench/lookup_cost.py                      # searches, page reads and time per look-up
uv run --no-project python bench/clear_check.py                      # clear the sample, compare every table
uv run --no-project python bench/q.py "select ..."                   # a read-only query
```

The app on a dev server, signed in with the CLI's session (the API allows no
CORS from 127.0.0.1, so it goes through Vite's proxy), from
`apps/leads/source`:

```bash
LEMMA_DEV_PROXY_TARGET=https://api.lemma.work VITE_LEMMA_BASE_URL=http://127.0.0.1:4687/api \
VITE_LEMMA_POD_ID=<pod-id> VITE_LEMMA_DEV_TOKEN_CMD="$PWD/../../../bin/lemma auth print-token" \
npx vite --host 127.0.0.1 --port 4687 --strictPort
```

Re-deploying the app alone needs the build's fallback config:
`VITE_LEMMA_API_URL=https://api.lemma.work VITE_LEMMA_AUTH_URL=https://lemma.work/auth VITE_LEMMA_POD_ID=<pod-id> bin/lemma pods import apps/leads`
(or your own server's addresses).
