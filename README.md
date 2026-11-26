# Awesome Lemma

Plugins for [Lemma](https://lemma.work). A plugin is a ready-made piece of
work you add to your Lemma: a few apps your team opens every day, the tables
they keep, the agents and workflows that do the work, and the set-up that
fits it to you. Add one and it starts working on its own data; add a few and
they work together, because they share the same people, conversations,
promises and to-do list.

Every plugin here is real, tested end to end on a hosted Lemma, and comes
with a demo you can try in a browser with no account.

## The plugins

| Plugin | What it does | Folder |
| --- | --- | --- |
| **Mail** | Your mail sorted, with the reply already written | [`mail/`](mail/) |
| **Meetings** | Briefed before every meeting, written up after | [`meetings/`](meetings/) |
| **Today** | Everything that needs you today, on one page | [`today/`](today/) |
| **People map** | Everyone you deal with, and where you stand | [`people/`](people/) |
| **Tasks** | Everything you have to do, done by you or an agent | [`tasks/`](tasks/) |
| **Deal tracker** | Deals that move when the conversation does | [`deals/`](deals/) |
| **Booking page** | A page where people book your time | [`booking/`](booking/) |
| **Lead research** | Know who someone is before you reply | [`leads/`](leads/) |
| **Brand kit** | Everything you make looks and sounds like you | [`brand/`](brand/) |
| **Deck maker** | A deck from one sentence, edited by asking | [`decks/`](decks/) |
| **Sprints** | Sprints with real capacity, carry-over and an honest summary | [`sprints/`](sprints/) |
| **Triage** | Bugs, alerts and security warnings sorted by how far they reach, each with an owner | [`triage/`](triage/) |
| **Incidents** | An incident's timeline gathered as it happens, and the write-up after | [`incidents/`](incidents/) |
| **Release notes** | Notes written from what merged, and word to everyone who asked for it | [`release-notes/`](release-notes/) |
| **Dependency updates** | Dependency updates batched, checked and opened as one pull request | [`dependency-updates/`](dependency-updates/) |
| **Coding agent** | An issue turned into a pull request by an agent, and questions about your code answered | [`coding-agent/`](coding-agent/) |
| **Know-how** | Your procedures, written once, answering questions and walking people through each step | [`know-how/`](know-how/) |
| **Forms** | Every form outside people fill in, on your site, in Google Forms or from an ad, each answer sent to the work it belongs to | [`forms/`](forms/) |

Each line is the plugin's own, from its `listing.json`. Its README says how
it works, what was measured and what was not verified.

## Try one

Every plugin has a **Try it** demo: its real apps, built in demo mode, on
made-up sample data (people and companies at `.example` addresses). There is
no sign-in and no server; nothing you do leaves the page. The same demo runs
on each plugin's page at lemma.work, and is in this repository at
`<plugin>/.lemma/demo/`:

```bash
python3 -m http.server --directory mail/.lemma/demo 8000   # then open http://127.0.0.1:8000
```

## Install one

`install/<plugin>/` holds each plugin assembled and ready: its own parts plus
every plugin it carries (below), with app sources that the server builds on
install.

- **On lemma.work**: open the plugin's page and press **Add to your Lemma**.
  It imports `install/<plugin>/` from this repository into the Lemma you
  pick, shows what it will create, and builds the apps.
- **From the command line**: the same server-side import, with the `lemma`
  CLI signed in:

  ```bash
  uv tool install lemma-terminal && lemma auth login
  # from the repository root
  python3 _build/install.py people --lemma <lemma-id> \
    --var people_slug=<free name> --var companies_slug=<free name> \
    --var inbox_slug=<free name> --var meetings_slug=<free name>
  ```

  It prints every part's planned action (create, update or skip) before it
  applies anything. Each app needs a free name (`--var <app>_slug=…`); a name
  already taken gets a suffix.

Then each person opens the plugin's app once: it walks them through its
set-up (their mailbox or calendar, or the sample to look around with first).

Plugins that read a calendar install without Google Meet transcripts, so
after a meeting Meetings reads the notes a person writes about it (the
meeting itself still comes from their calendar, or the sample). A connector a
plugin marks optional that your organization has not set up (Google Calendar,
Outlook, Gmail) is left out at install, and the parts that use it come
without access to it: set the connector up in your organization before you
add the plugin.

## How a plugin is laid out

```
mail/
  tables/ functions/ agents/   the bundle: what installs into a Lemma, with
  workflows/ schedules/        its manifest (name, description, the name of
  connectors/ apps/ files/     each app) beside them
  plugin.json                  the plugins it carries, when it carries any
  listing.json                 its page: name, one-line job, set-up in plain words, pictures
  README.md                    how it works, what was measured, what bit
  DESIGN.md                    the app's design (most plugins)
  bin/                         a `lemma` CLI wrapper bound to one Lemma, grants and fixture scripts
  bench/                       test drivers that run its set-up and checks from the CLI (some plugins)
  .lemma/
    agents-block.md, guide.md  its memory block (below)
    demo/, demo.json           the Try it demo
    shots/                     the pictures on its page, and the sample rows they were taken from
```

Each app is a Vite and React project under `apps/<app>/source/`, drawn with
the shared kit, which it carries as a packed tarball in `source/vendor/` so it
builds on its own.

## How plugins build on each other

- **Carrying.** A plugin can carry others, so one install brings everything
  it needs. People map carries Mail and Meetings; Deal tracker and Lead
  research carry People map (and so Mail and Meetings); Booking page carries
  Meetings. It says so in `plugin.json`, and `_build/assemble.py` merges the
  carried plugins from their own folders.
- **Shared tables.** People, conversations, messages, promises, drafts,
  meetings, companies, tasks, deals and the brand live in tables every plugin
  agrees on (`_contract/tables`), so what Mail reads, Meetings, People map and
  Deal tracker use too, and one person is one row however they reached you.
  Each plugin carries the shared tables it touches, byte for byte.
- **Needs you.** Every plugin writes what needs a person into one shared list,
  `needs_you`: a reply to send, a choice to make, a meeting to attend, a
  promise to keep, someone going quiet. **Today** shows it as one page, and
  Done or Not now there settles the item in the plugin it came from.
- **Memory blocks.** When a plugin is set up it writes a short block into the
  Lemma's `/memory/AGENTS.md` and a guide at `/memory/plugins/<plugin>.md`,
  so the Lemma's assistant knows the plugin is there and how to use it ("add
  this to my tasks", "make a deck in our brand").
- **Listening.** A plugin that finds another at work uses it: Tasks turns the
  promises Mail and Meetings find into tasks, Deck maker writes in Brand kit's
  brand, Deal tracker proposes changes from new mail and meeting notes.

## Build your own

The three folders that start with `_` are the shared parts:

- [`_contract/`](_contract/) holds the shared tables, the questions every
  plugin asks about a conversation the same way, the shared code snippets
  (writing to `needs_you`, writing a memory block), and **`lint.py`**, which
  checks every plugin against them and against each other.
- [`_kit/`](_kit/) is the design kit every app is drawn with
  (`@lemma-plugins/kit`): the look, controls, frame, sign-in, reads and writes,
  demo mode, and the scripts that take the pictures and moments for a
  plugin's page.
- [`_build/`](_build/) assembles bundles (`assemble.py`), installs them
  (`install.py`) and writes the website's plugin catalog (`site_catalog.py`).

A new plugin, roughly:

1. Copy the plugin closest to yours (Today is the smallest) to a new folder
   and rename its parts with your own prefix: names are unique across
   plugins.
2. Use the shared tables you need from `_contract/tables`
   (`python3 _contract/lint.py --fix` copies them in), and write what needs a
   person into `needs_you` with the shared snippet.
3. Draw the app with the kit (`_kit/bin/vendor.sh <plugin>` puts it in), and
   write its memory block in `.lemma/agents-block.md` and `.lemma/guide.md`.
4. Bind `bin/lemma` to a test Lemma (it reads its server, organization and
   Lemma from the environment or a gitignored `.lemma.env`; the script says
   which), import, and try it on a sample.
5. Assemble and check:

   ```bash
   python3 _build/assemble.py --install      # writes install/<plugin>/ for every plugin
   python3 _contract/lint.py                 # must print ok
   ```

`_contract/README.md` has every rule the lint enforces, `_kit/README.md` the
design rules, and `_build/README.md` how assembling and installing work. The
lint, the assembler and the installer need only the Python standard library
(3.11 or later); the apps need Node 22 or later.

## License

[AGPL-3.0](LICENSE), the same as the Lemma platform. The vendored Lemma SDK
in each app keeps its own license (Apache-2.0).
