# Plugin kit

The one look for every plugin app: one design theme across all of them.
Plugins install side by side in one Lemma and open next to each
other in its sidebar; apps that each look different read as a bag of tools,
not one product.

Started from the CRM's `kit/`. A plugin brings its own layout and a few small
marks of its own (a mail client's unread dot, a deal's stage); never its own
palette, type, buttons, tables, menus or drawers.

## What is in it

| | |
| --- | --- |
| `boot(<App />)` | theme and location from the host, Inter, sign-in (`AuthGuard`), toasts |
| `client`, `whoAmI`, `orgId` | one `LemmaClient` for the page; the pod comes from the host's `__LEMMA_CONFIG__` |
| `q`, `items`, `sql`, `create`, `update`, `runFunction`, `startWorkflow`, `DataProvider`/`useRows` | reads and writes, whatever shape the API answers in |
| `usePath`, `go`, `useRecordId`, `openApp`, `isFramed` | the app's path in the Lemma's address; opening another app of the Lemma |
| `applyTheme`, `startTheme` | the host's `lemma-app-theme` message, as `--lemma-app-*` custom properties |
| `Connect`, `Connections`, `useConnection`, `connectionProblem`, `errorText` | connecting an account from inside the app (below) |
| `DEMO`, `demoNote`, `demoData` | demo mode: the app on its sample, in a browser, with no server (below) |
| `Button`, `Pill`, `Switch`, `Field`, `Kbd`, `Spinner` | controls |
| `Menu`, `MenuItem`, `MenuLabel` | a short list that opens on press (never on hover) |
| `Header`, `Toolbar`, `Segmented`, `SearchField` (`/` focuses it), `Card`, `Banner`, `Sheet` (a drawer) | frame |
| `Empty`, `Skeleton`, `Notice` | states: what is absent and the next action; placeholders in the final geometry |
| `Avatar`, `Logo`, `Face`, `Brief`, `Evidence`, `Rel`, `Money`, `Markdown` | marks |
| `ago`, `day`, `when`, `due`, `money`, `nameOf`, `plural`, … | dates, money and names, said the same way everywhere |
| `ConversationRow`, `PersonRow`, … | row types of the shared tables, generated from `../_contract` |
| `kit.css` | the tokens and every class above (`c-*`) |

## Using it in a plugin app

```jsonc
// apps/<name>/source/package.json
"dependencies": {
  "@lemma-plugins/kit": "file:vendor/lemma-plugins-kit-0.1.0-<hash>.tgz",
  "lemma-sdk": "file:vendor/lemma-sdk-0.10.1.tgz",
  "lucide-react": "^0.468.0", "react": "^19.2.0", "react-dom": "^19.2.0",
  "@tanstack/react-query": "^5"
}
```

```tsx
// src/main.tsx
import { boot } from "@lemma-plugins/kit";
import App from "./App";
import "./my-app.css";   // layout only, on the --c-* roles
boot(<App />);
```

The kit is a package, packed once and handed to every app byte for byte. A
bundle import builds each app alone from its own `source/` (on your machine
for `lemma pods import`, in the importer's sandbox for a server-side import),
so an app cannot reach `../../_kit`; it carries the packed tarball in
`source/vendor/`. The tarball's version carries the kit's source hash, so a
changed kit is a new file and no lockfile can hold on to the old one.

```bash
_kit/bin/pack.sh            # build, generate src/contract.ts, pack to dist/
_kit/bin/vendor.sh [plugin] # copy the tarball, the SDK and app-files/ into each app; npm install
uv run --no-project python _contract/lint.py    # from the repository root: fails on a stale or hand-copied kit
```

`app-files/pnpm-workspace.yaml` goes into every app too: a server-side import
builds with pnpm, which refuses esbuild's install script without it.

The SDK tarball (`vendor/lemma-sdk-0.10.1.tgz`) is packed from the Lemma platform's
`lemma-typescript` (after lemma-work/lemma-platform#1206): the published 0.10.1 lacks the
app-location functions and `apps.open`. Point apps back at the registry once it
has them.

## The rules

1. **Colour comes from the host.** Use the `--c-*` roles (`--c-page`,
   `--c-panel`, `--c-subtle`, `--c-text`, `--c-muted`, `--c-faint`,
   `--c-border`, `--c-border-strong`, `--c-accent`, `--c-info`, `--c-success`,
   `--c-warning`, `--c-danger`), never a hex value. Framed, they are the
   Lemma's own (light or dark, switching live); on its own an app follows the
   device with the same values.
2. **Inter, weight 500 at most.** 13px body, 12px meta, 15px section and page
   heads, 19 to 21px for a record's title. Hierarchy from size, colour and space.
3. **lucide icons**, 13 to 15px, in `--c-muted` or `--c-faint`.
4. **Product furniture, not posters.** Tables, record layouts (header with
   facts, main column, properties beside), segmented filters with counts,
   search on `/`, drawers for editing, skeletons in the final layout, empty
   states with the next action. Density follows the job.
5. **One accent, used once.** `--c-accent` fills the one primary action in
   view. The Lemma's own work is marked with the sparkles icon and the `ai`
   pill, never a colour of its own.
6. **Status is never colour alone.** Every pill has a word.
7. **Nothing only on hover.** Menus open on press; a hover shortcut must also
   be reachable without hover.
8. **375px works**, with no sideways scroll. Check light, dark and 375px in
   rendered screenshots before calling an app done.
9. **Copy**: plain, specific, sentence case. Never "pod", "teammate" or
   "room" on screen; the noun is "Lemma". No sample names in copy.

## Connecting accounts: `<Connect>`

Every plugin is a self-sufficient app: it connects its own accounts from
inside the app, and never sends anyone to the Lemma's connector pages to come
back later (`_contract/lint.py` rule 11 fails on that copy, on connecting by
hand, and on a connector call's error shown as its own text).

```tsx
<Connect connector="github" slug="github" mode="shared" purpose="One GitHub connection for this Lemma: …" onReady={reload} />
<Connect connector="gmail" mode="per_member" quiet />          // nothing at all once connected
const gh = useConnection({ connector: "github", mode: "shared" }); // gh.state.kind, gh.connect(), gh.report(e)
toast(`Couldn't merge: ${errorText(e, "github")}`);            // a connection problem in words, never the platform's text
```

It reads where one pod connector stands for the person looking (the pod
connector, their own accounts, whether they may share one, whether the
organization has the connector) and shows the one next step:

| State | What it shows |
| --- | --- |
| connected | "Connected as X · Change", or nothing with `quiet` |
| per member, none yet | **Connect Gmail**: signs in in a new tab and comes back |
| shared, I have an account | **Use my GitHub (name)**: shares it as the Lemma's in one step (`pod.accounts.add` + `shareAs`) |
| shared, I have none | **Connect GitHub**, and shares it automatically once back |
| GitHub signed in, App on no repository | **Choose repositories on GitHub**; with several installations, pick one |
| sign-in expired | **Reconnect** (a shared one is shared again once back) |
| I can't (not an editor here, the organization lacks the connector, someone else's account expired) | says so plainly, and **Ask someone who can**: a line in their own channel (`channels.notify`) |

A sign-in opens in a new tab (a provider's page can't load in the Lemma's
frame) with `return_to` the Lemma's `/oauth/complete`, which reports back and
closes; the app sees the return by looking again (focus, and every few
seconds while it waits). The raw error is kept behind a Details toggle.

In a demo build it draws from `.lemma/demo.json`'s `connections`
(`{ "<slug>": { "state": "ready", "as": "northwind" } }`; ready is the
default), and its buttons only show a note.

## Pictures for the site

`bin/shots_serve.py` serves a built app on fixture JSON (it wraps the
platform's `cover_serve.py` and adds document downloads); `bin/shoot.mjs`
captures 1440×900 at 2x, light and dark, with the installed Chrome. See the
Mail runbook for the whole recipe.

## Page moments: the pictures on a plugin's page

A plugin's page on the website shows its real app, never a drawing: close-ups
and short loops of the "Try it" demo, captured by

```bash
node _kit/bin/demo.mjs <plugin>          # the demo they are taken from
node _kit/bin/moments.mjs <plugin> [<name> ...]   # -> <plugin>/.lemma/moments/
```

from the plugin's `.lemma/moments.json`: per capture, the route, the steps
to do (click, scroll, wait), the region to keep, and whether it is a still or
a loop. Stills are webp at 2x; loops are H.264 mp4 and VP9 webm, muted, with a
poster, recorded from Chrome's own screencast at 2x (Playwright's
`recordVideo` writes 1x at a low bitrate, too soft for close-ups). Every
capture comes in light and dark, and with `phone` again in the app's phone
layout. A `patch` changes the sample for one capture, to reach a screen the
sample never clicks to (Mail's set-up). The script's header has the format;
`listing.json` names captures by `name`, and `_build/site_catalog.py` copies
them to the site.

## Demo mode: "Try it"

A plugin's public page frames its real apps on made-up sample rows, with no
sign-in and no server. Build one with

```bash
node _kit/bin/demo.mjs <plugin> [<plugin> ...]     # -> <plugin>/.lemma/demo/
```

It builds each app from its own `source/` with `VITE_LEMMA_DEMO=1` and
`base: "./"`, so the folder works wherever it is copied (the site serves it at
`/plugins/<slug>/demo/`). The first app is `demo/index.html`, any other
`demo/<app>/index.html`. A normal build leaves demo mode out entirely:
`DEMO` is false at build time and the bundler drops `src/demo.ts`.

In a demo build the kit's client is pointed at `https://lemma-demo.invalid`
and every call is answered in the page (`src/demo.ts`), the way
`bin/shots_serve.py` answers on a server, from the plugin's
`.lemma/shots/fixtures/`:

- reads from the fixture for the path; a datastore query from the first
  `{match, response}` whose `match` is in the request or its SQL; pod files
  from `fixtures/files/<path>` or `fixtures/documents/<name>`;
- record writes change an in-memory copy that later reads return (held to the
  query's plain WHERE tests and its ORDER BY), and the app's change stream is
  told, so Done stays done;
- functions and workflows run the plugin's handler from `.lemma/demo.js`
  (`window.__LEMMA_DEMO_HANDLERS__ = { name(input, db) { ... } }`; `db` is
  `DemoDb` in demo.ts), else answer from `fixtures/pods/pod/functions/<name>/runs.json`,
  else finish with nothing; a note from `.lemma/demo.json` says what the Lemma
  would have written;
- nothing leaves the page: fetch, WebSocket and EventSource to anywhere but the
  page's own files are refused, external images and scripts load nothing, a
  link or window that would leave the demo shows a note, and Google Fonts come
  from copies the build puts in `demo/fonts/`;
- the app's path is the page's `#fragment`; `openApp` to another app of the
  plugin goes to that app's demo, to any other app shows a note;
- a bar on top says the data is made up and nothing is saved, with a switcher
  when the plugin has several apps;
- light or dark follows the device, or the framing page's
  `{ type: "lemma-app-theme", theme: "light" | "dark" }` message (tokens
  optional). The demo posts `{ type: "lemma-demo-ready" }` to its parent once
  it listens, so the page can send its theme again then: an app that loads in
  parts may start listening after the frame's `load` event.

`.lemma/demo.json` sets the apps and their order, labels and first path,
notes, Google families to bundle, and `anchor`: the day the sample was written
for (it becomes today), or that moment (`2026-11-18T13:30:00Z`), in which case
someone earlier in their day gets the sample as of yesterday, so nothing in it
reads as future.
