# Assembling a plugin

A plugin's bundle includes its bases, so one install puts it into an empty
Lemma. Most plugins carry their base as the shared tables in their own folder
(`_contract`). A plugin built on whole other plugins says so instead, and is
assembled: People map carries Mail and Meetings, and installs as one bundle
with all three. Today carries nothing: it reads the shared `needs_you` list
every other plugin writes.

```jsonc
// <plugin>/plugin.json
{ "name": "people", "carries": ["mail", "meetings"] }
```

The plugin's own folder holds only its own parts. `assemble.py` merges the
plugins it carries from their own folders, never from a copy. Nothing here is
written into a plugin's source.

Two places it writes to:

- **`install/<plugin>/`**, committed: the folder a Lemma installs from. **Add
  to your Lemma** on a plugin's page at lemma.work imports it straight from
  this repository, and `install.py` uploads it. One per plugin, always
  current (the lint fails otherwise).
- **`_build/out/<plugin>/`**, gitignored: a scratch build for trying other
  options (another connector left out, a zip). Delete it any time.

```bash
# from the repository root
uv run --no-project python _build/assemble.py --install                # every plugin -> install/<plugin>/
uv run --no-project python _build/assemble.py --install people         # one plugin
uv run --no-project python _build/assemble.py --install --check        # write nothing; fail if install/ is stale
uv run --no-project python _build/install.py people --pod <pod-id> --var people_slug=<free slug>
uv run --no-project python _contract/lint.py                           # rules 7 and 10 check the assembly and install/

uv run --no-project python _build/assemble.py people                   # _build/out/people/
uv run --no-project python _build/assemble.py people --without-connector googlemeet --zip
```

## install/: the folders a Lemma installs from

`install/<plugin>/` is the plugin assembled with everything it carries, and
`install/<plugin>.assembly.json` beside it says where each part came from and
hashes every file. Regenerate after any change to a plugin, a base it carries,
the contract or the kit:

```bash
uv run --no-project python _build/assemble.py --install
uv run --no-project python _contract/lint.py
```

and commit what changed. The lint (rule 10) fails when a folder in `install/`
is missing, extra, or not what a fresh assembly makes, file for file; or when
it lacks what the server-side import needs (each app's `source/package.json`,
every `file:` dependency it names, which are the vendored kit and SDK
tarballs in `source/vendor/`, and `_kit/app-files/pnpm-workspace.yaml`); or
when it holds anything it must not (`node_modules`, `dist`, `.vite`,
`__pycache__`, zips, `tsbuildinfo`, logs, `.lemma.*.env`). The server builds
every app from its source, so no build output is ever committed.

Every install bundle is assembled without the connectors in
`INSTALL_WITHOUT` (`assemble.py`): today `googlemeet`, so Meetings, Booking
page, People map, Deal tracker and Lead research install without Google Meet
transcripts (Meetings falls back to the notes a person writes). The importer
refuses a bundle that declares a connector the organization has no
installation of, even one marked `"required": false`, and most organizations
have none for Google Meet.

## How parts merge

| Part | Rule |
| --- | --- |
| Order | Bases first, depth first, each plugin once (a base may carry its own bases); a circle is an error |
| Tables, functions, agents, workflows, schedules, surfaces, apps, files | Copied folder by folder. One name in two plugins only when it is the same thing: a shared contract table byte for byte, or an identical folder. Anything else is an error naming both plugins |
| Connectors | Two plugins declaring one connector (Mail's and Meetings' `outlook`) become one: the same mode or an error, required if either requires it, both purposes, each naming its plugin |
| `pod.json` | The plugin's own name and description; the variables of every plugin (each app's slug); one variable defined two ways is an error |
| Apps | `source/` without `node_modules`, builds, zips or `tsbuildinfo`: an import builds each app from its source, with its vendored kit |
| Left out | Everything outside the bundle's resource folders: `bin/`, `bench/`, `.lemma/`, `local/`, READMEs, `plugin.json` itself |

`--without-connector <id>` leaves a connector out, with every grant on it. The
importer refuses a bundle that declares a connector the organization has no
installation of, even one marked `"required": false`
(`lemma-backend/app/modules/pod_bundle/domain/connector_plan.py` in the
platform, `_resolve_one`), so a bundle for an organization without Google
Meet is assembled without it, as Meetings' own `bin/import.sh` does.

Beside each build, `<plugin>.assembly.json` says which plugin every part came
from, what was merged, what was left out, and a hash of every file.

## What the lint checks (rules 7 and 10)

`_contract/lint.py` runs on every plugin as before, and for every plugin with a
`plugin.json` that carries others:

1. **Shared tables can come from a base.** Rule 2 (a plugin carries the shared
   tables it touches) counts what its bases carry, so the plugin's own folder
   stays its own parts. A shared table it does carry must still be the
   contract's, byte for byte.
2. **It assembles.** The same merge as above, in a temporary folder: a name two
   plugins define differently fails the lint.
3. **It is whole.** Every name a part uses is a part of the assembled bundle:
   functions and agents a workflow runs, tables, functions, agents, workflows,
   connectors and folders a grant names, tables a schedule or a workflow start
   watches, foreign keys, and the variables an app's slug uses. That is what an
   install into an empty Lemma needs.
4. **A build is not stale.** If `_build/out/<plugin>/` exists it must be what a
   fresh assembly (with the same connectors left out) makes, file for file.

And for every plugin, rule 10: `install/<plugin>/` is current and ready (above).

## Installing

`install.py` is the server-side import, the path **Add to your Lemma** takes:
zip `install/<plugin>/` (or `--bundle <folder or .zip>`), upload it
(`POST /pods/{id}/bundle/uploads`), plan (`…/bundle/imports` with `kind:
URL`), print every part's planned action (CREATE, UPDATE, SKIP), apply with
the variables, and print what happened. The plan and the outcome are saved as
JSON (`--out`), so what an install did to parts a Lemma already had can be
read afterwards.

It signs in with the `lemma` CLI on your PATH (`lemma auth print-token`; on
`LEMMA_SERVER` when that is set) and talks to that server's API (`lemma config
show`), or to `LEMMA_API_URL` when that is set. `--pod` defaults to
`LEMMA_POD_ID`. Pass `--var <app>_slug=<free slug>` for each app: a default
name that is already taken gets a suffix.

The importer builds each app in its sandbox with pnpm, which is why every app
carries `_kit/app-files/pnpm-workspace.yaml`.

## The website's plugin pages

`site_catalog.py` writes what the site's `/templates` pages draw: one JSON file
and the pictures, from the plugins themselves, so nothing is copied into the
site by hand.

```bash
# from the repository root; Pillow comes from the script's own header
uv run _build/site_catalog.py --site <lemma-platform checkout>/lemma-frontend
```

It reads each built plugin's hand-written `listing.json` (name, one-line job,
intro, what it does, the jobs it is for, accounts, set-up in plain words, what
it adds to Today, and the pictures with their captions), its `plugin.json`
(carries, resolved transitively), its tables against `_contract/tables` (the
shared ones it makes, by the contract's "first written by", and the ones it
reads), and its `.lemma/agents-block.md`; and `_catalog/planned.json` for the
lines and every plugin not built yet. It copies each listed picture, light and
dark, to `public/plugins/<slug>/` at 2400 wide (webp, quality 80), and a
plugin's `.lemma/demo/` when it has an `index.html`. `install` stays null until
a plugin is published. A missing picture, a caption over 55 characters, a name
that points at no plugin, a gap in the build order, or a word the site never
says stops the run.
