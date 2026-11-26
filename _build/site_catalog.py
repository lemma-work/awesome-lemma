# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10"]
# ///
"""Write the website's plugin catalog from the plugins themselves.

The site's plugin pages (lemma-frontend, `/templates` and `/templates/<slug>`)
draw everything from one generated file, so nothing about a plugin is copied
by hand into the site:

    uv run _build/site_catalog.py --site <lemma-platform checkout>/lemma-frontend

Read, for each built plugin (a folder with `pod.json` and `listing.json`):

- `listing.json`, hand-written: name, the one-line job, the intro, three lines
  of what it does, the jobs it is for, the accounts it asks for, its set-up in
  plain words, what it adds to Today, and the pictures to show with captions.
- `plugin.json`: the plugins it carries, resolved here transitively.
- its tables, against `_contract/tables`: the shared tables it makes (the
  contract's "first written by") and the ones it reads.
- `.lemma/agents-block.md` (and Mail's `agents-block-me.md`): the words every
  agent in a Lemma reads once it is installed.
- `.lemma/shots/<shot>-{light,dark}.webp`: copied to the site's
  `public/plugins/<slug>/`, 2400 wide, webp quality 80.
- `.lemma/demo/index.html`, when a try-it demo has been built: the folder is
  copied to `public/plugins/<slug>/demo/` and the page embeds it; the apps its
  own bar switches between are read from its `demo-data.js`.
- the landing page, when `listing.json` has `moments` (until then the page
  keeps the older layout): `hero`, `headings` (over how it works, better
  with, trust and questions), `steps`, `moments` (each with its eyebrow
  `label` and a `note` written in the margin), `betterWith`, `trust`, `faq`
  and `closing`, each visual named by a capture in
  `.lemma/moments/index.json`, which `_kit/bin/moments.mjs` writes with the
  close-ups and loops themselves. They are copied as they are to
  `public/plugins/<slug>/moments/`.

And `_catalog/planned.json`: the lines, and every plugin not built yet with
its line, position and what it will build on.

Written into the site:

- `src/site/plugins/generated/catalog.json`
- `public/plugins/<slug>/` for every built plugin. The script owns
  `public/plugins/`: a folder there for a slug that is no longer built is
  removed.

Nothing here writes into a plugin. The checks below fail the run rather than
publish a page with a missing picture or a name that points nowhere.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CONTRACT = ROOT / "_contract" / "tables"
PLANNED = ROOT / "_catalog" / "planned.json"

sys.path.insert(0, str(HERE))
from assemble import jsonc  # noqa: E402  (same folder; JSON with comments)

WIDTH = 2400
QUALITY = 80
CAPTION_MAX = 55
THEMES = ("light", "dark")

# The shared tables, gathered into what a person would call them. A shared
# table outside this list (and outside `needs_you`, the day's list, which
# every plugin writes and Today reads) stops the run: name it here first.
GROUPS = {
    "conversation": "conversations",
    "message": "conversations",
    "person": "people",
    "person_handle": "people",
    "promise": "promises",
    "draft": "drafts",
    "meeting": "meetings",
    "company": "companies",
    "company_domain": "companies",
    "task": "tasks",
    "personal_task": "tasks",
    "project": "projects",
    "deal": "deals",
    "brand": "brand",
    "form": "forms",
    "form_answer": "forms",
    "article": "articles",
}
DAY_TABLE = "needs_you"

TABLES = {
    "conversations": ("Conversations", "Every conversation, wherever it happened, and what was read from it"),
    "people": ("People", "Each person you deal with, found by any address they use"),
    "promises": ("Promises", "A promise made either way, with the sentence it was made in"),
    "drafts": ("Drafts", "A reply written for you, unsent until you say so"),
    "meetings": ("Meetings", "A meeting, its brief before and what was said after"),
    "companies": ("Companies", "A company your team deals with, shared by the whole team"),
    "tasks": ("Tasks", "A thing to do, private to you or shared with the team"),
    "projects": ("Projects", "A team project and the tasks in it"),
    "deals": ("Deals", "Something the team is trying to win, with its stage"),
    "brand": ("Brand", "Your colours, type, logos and voice"),
    "articles": ("Customer answers", "Checked answers customers may read, never past their check date"),
    "forms": ("Form answers", "Every answer to the team's forms, and where each one went"),
}

# The landing page's shape: how many of each part, and one-glance headlines.
LANDING_COUNTS = {"steps": (2, 4), "moments": (3, 8), "betterWith": (0, 6), "trust": (2, 4), "faq": (3, 8)}
HEADLINE_MAX = 60
TITLE_MAX = 48
# A moment's note is written in the margin by hand: a few words.
NOTE_MAX = 32
# The headings over the page's own sections, in the plugin's words.
HEADINGS = ("how", "better", "trust", "faq")
# A loop is played on the page as it is; past this it is too heavy to autoplay.
LOOP_BYTES_MAX = 1_200_000

VERBS = {"answer", "decide", "attend", "do", "waiting", "drifting"}
JOBS = {"SALES", "MARKETING", "PRODUCT", "FOUNDER", "OPERATIONS", "HR", "PROJECT_MANAGEMENT", "ENGINEERING", "SUPPORT"}

# Words the site never says (see the frontend's DESIGN.md and the plugin
# catalog test): its old nouns, anywhere in a word for the last one, and the
# sample workspace's names, which are capitalised ("Brand kit" is fine).
BANNED = re.compile(r"\b(pods?|teammates?)\b|room", re.IGNORECASE)
BANNED_NAMES = re.compile(r"\b(Kit|June|Remy|Scout)\b")


class CatalogError(Exception):
    pass


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def check_copy(where: str, text: str) -> None:
    hit = BANNED.search(text) or BANNED_NAMES.search(text)
    if hit:
        raise CatalogError(f"{where}: copy says {hit.group(0)!r}: {text}")


def makers() -> dict[str, str]:
    """Each shared group's maker, as the plugin's name: the contract's own
    "first written by" on the group's first table that says it."""
    found: dict[str, str] = {}
    for path in sorted(CONTRACT.glob("*.json")):
        name = path.stem
        if name == DAY_TABLE:
            continue
        if name not in GROUPS:
            raise CatalogError(f"_contract/tables/{path.name}: a shared table the site has no word for; add it to GROUPS")
        said = re.search(r"first written by ([A-Z][\w -]*?)\s*[.,(]", path.read_text())
        if said and GROUPS[name] not in found:
            found[GROUPS[name]] = said.group(1).strip()
    missing = sorted(set(GROUPS.values()) - set(found))
    if missing:
        raise CatalogError(f"no contract table says who first writes {missing}")
    return found


# Where "Add to a Lemma" installs from: the published repository, one
# assembled bundle per plugin under install/<folder>.
INSTALL_REPO = "lemma-work/awesome-lemma"


def built_folders() -> list[Path]:
    return sorted(p for p in ROOT.iterdir() if p.is_dir() and not p.name.startswith(("_", ".")) and (p / "pod.json").is_file() and (p / "listing.json").is_file())


def carries_of(folder: Path) -> list[str]:
    path = folder / "plugin.json"
    data = jsonc(path.read_text()) if path.is_file() else {}
    return list(data.get("carries") or [])


def carried(folder_name: str, trail: tuple[str, ...] = ()) -> list[str]:
    """Everything a plugin brings, bases first, each once, itself left out."""
    if folder_name in trail:
        raise CatalogError("plugins carry each other in a circle: " + " -> ".join([*trail, folder_name]))
    seen: list[str] = []
    for base in carries_of(ROOT / folder_name):
        if not (ROOT / base / "pod.json").is_file():
            raise CatalogError(f"{folder_name}/plugin.json carries {base!r}, which is not a plugin here")
        for name in [*carried(base, (*trail, folder_name)), base]:
            if name not in seen:
                seen.append(name)
    return seen


def shared_tables(folder: Path) -> set[str]:
    contract = {p.stem for p in CONTRACT.glob("*.json")}
    tables = folder / "tables"
    return {p.name for p in tables.iterdir() if p.is_dir() and p.name in contract} if tables.is_dir() else set()


def memory_line(path: Path) -> str | None:
    if not path.is_file():
        return None
    text = " ".join(line.strip() for line in path.read_text().splitlines() if line.strip())
    return re.sub(r"^- ", "", text) or None


def views_of(demo: Path, base: str) -> list[dict[str, str]]:
    """The apps a demo switches between in its own bar, as the demo build
    wrote them into `demo-data.js` (`window.__LEMMA_DEMO__ = {...};`)."""
    data = demo / "demo-data.js"
    if not data.is_file():
        return []
    text = data.read_text()
    start = text.find("{")
    try:
        apps = json.loads(text[start:].rstrip().rstrip(";"))["apps"]
    except (ValueError, KeyError) as error:
        raise CatalogError(f"{data.relative_to(ROOT)}: not the demo build's data ({error})")
    return [{"label": app["label"], "src": base + re.sub(r"^\./", "", app["href"])} for app in apps]


def picture(src: Path, out: Path) -> tuple[int, int]:
    with Image.open(src) as image:
        image = image.convert("RGB")
        height = round(image.height * WIDTH / image.width)
        image.resize((WIDTH, height), Image.Resampling.LANCZOS).save(out, "WEBP", quality=QUALITY, method=6)
        return WIDTH, height


def visual_of(name: str, captures: dict, folder: Path, out: Path, slug: str, where: str) -> dict:
    """One capture from `.lemma/moments/`, copied beside the page: a close-up
    in light and dark, or a loop as mp4 and webm with a still of it."""
    if name not in captures:
        raise CatalogError(f"{where}: no capture {name!r} in {folder.name}/.lemma/moments/index.json (run node _kit/bin/moments.mjs {folder.name})")
    capture = captures[name]
    check_copy(f"{where}: {name}'s alt", capture["alt"])
    src = folder / ".lemma" / "moments"
    dest = out / "moments"
    dest.mkdir(exist_ok=True)
    kind = capture["kind"]

    def themes(stem: str) -> dict:
        found = {}
        for theme in THEMES:
            files = {"still": f"{stem}-{theme}.webp"} if kind == "still" else {
                "still": f"{stem}-{theme}-poster.webp", "mp4": f"{stem}-{theme}.mp4", "webm": f"{stem}-{theme}.webm"}
            for role, file in files.items():
                path = src / file
                if not path.is_file():
                    raise CatalogError(f"{where}: {name} has no {file} in {folder.name}/.lemma/moments/")
                if role != "still" and path.stat().st_size > LOOP_BYTES_MAX:
                    raise CatalogError(f"{where}: {file} is {path.stat().st_size // 1024}K, over {LOOP_BYTES_MAX // 1000}K; raise its crf or narrow its width")
                shutil.copyfile(path, dest / file)
            found[theme] = {role: f"/plugins/{slug}/moments/{file}" for role, file in files.items()}
        return found

    # A moment can also be captured in the app's phone layout, which the page
    # shows on a phone instead of shrinking the wide one past reading.
    phone = capture.get("phone")
    return {"kind": kind, "width": capture["width"], "height": capture["height"], "alt": capture["alt"],
            "bleed": capture.get("bleed"), "window": capture.get("window"), **themes(name),
            "phone": {"width": phone["width"], "height": phone["height"], "bleed": phone.get("bleed"), **themes(f"{name}-phone")} if phone else None}


def landing_of(folder: Path, data: dict, slug: str, out: Path) -> dict:
    """A plugin's landing page, from `listing.json`: the hero, how it works,
    the moments, what builds on it, what stays private, and questions."""
    where = f"{folder.name}/listing.json"
    for key in ("hero", "headings", "steps", "moments", "betterWith", "trust", "faq", "closing"):
        if key not in data:
            raise CatalogError(f"{where}: has moments, so it needs {key!r} too")
    for key, (low, high) in LANDING_COUNTS.items():
        if not low <= len(data[key]) <= high:
            raise CatalogError(f"{where}: {len(data[key])} {key}, not {low} to {high}")
    index = folder / ".lemma" / "moments" / "index.json"
    captures = json.loads(index.read_text()) if index.is_file() else {}

    hero = data["hero"]
    for key in ("eyebrow", "headline", "sub", "visual"):
        if not hero.get(key):
            raise CatalogError(f"{where}: hero has no {key!r}")
    headlines = [("hero headline", hero["headline"], HEADLINE_MAX), ("closing", data["closing"], HEADLINE_MAX)]
    headlines += [(f"step {i + 1}", step["title"], TITLE_MAX) for i, step in enumerate(data["steps"])]
    headlines += [(f"moment {i + 1}", moment["title"], TITLE_MAX) for i, moment in enumerate(data["moments"])]
    headlines += [(f"trust {i + 1}", item["title"], TITLE_MAX) for i, item in enumerate(data["trust"])]
    headlines += [(f"{key} heading", data["headings"].get(key) or "", TITLE_MAX) for key in HEADINGS]
    headlines += [(f"moment {i + 1}'s note", moment["note"], NOTE_MAX) for i, moment in enumerate(data["moments"])]
    for key in HEADINGS:
        if not data["headings"].get(key):
            raise CatalogError(f"{where}: headings has no {key!r}")
    for i, moment in enumerate(data["moments"]):
        for key in ("label", "note"):
            if not moment.get(key):
                raise CatalogError(f"{where}: moment {i + 1} has no {key!r}")
    for what, text, most in headlines:
        if len(text) > most:
            raise CatalogError(f"{where}: {what} is over {most} characters, more than a glance: {text!r}")

    copy = [hero["eyebrow"], hero["headline"], hero["sub"], data["closing"]]
    copy += [t for step in data["steps"] for t in (step["title"], step.get("body") or "")]
    copy += [t for moment in data["moments"] for t in (moment["label"], moment["title"], moment["body"], moment["note"])]
    copy += [data["headings"][key] for key in HEADINGS]
    copy += [item["line"] for item in data["betterWith"]]
    copy += [t for item in data["trust"] for t in (item["title"], item["body"])]
    copy += [t for item in data["faq"] for t in (item["q"], item["a"])]
    for text in copy:
        check_copy(where, text)

    def visual(name: str) -> dict:
        return visual_of(name, captures, folder, out, slug, where)

    return {
        "hero": {"eyebrow": hero["eyebrow"], "headline": hero["headline"], "sub": hero["sub"], "visual": visual(hero["visual"])},
        "steps": [{"title": s["title"], "body": s.get("body"), "visual": visual(s["visual"])} for s in data["steps"]],
        "headings": {key: data["headings"][key] for key in HEADINGS},
        "moments": [{"label": m["label"], "title": m["title"], "body": m["body"], "note": m["note"], "visual": visual(m["visual"])} for m in data["moments"]],
        # Named by plugin name here, checked against the whole catalog once it is read.
        "betterWith": [{"slug": slugify(b["plugin"]), "line": b["line"]} for b in data["betterWith"]],
        "trust": [{"title": t["title"], "body": t["body"]} for t in data["trust"]],
        "faq": [{"q": f["q"], "a": f["a"]} for f in data["faq"]],
        "closing": data["closing"],
    }


def build(site: Path) -> dict:
    owners = makers()
    folders = built_folders()
    listings = {f.name: json.loads((f / "listing.json").read_text()) for f in folders}
    slug_of = {name: slugify(data["name"]) for name, data in listings.items()}
    folder_of_name = {data["name"]: name for name, data in listings.items()}

    planned_doc = json.loads(PLANNED.read_text())
    lines = planned_doc["lines"]
    line_ids = [line["id"] for line in lines]
    planned = planned_doc["planned"]

    public = site / "public" / "plugins"
    public.mkdir(parents=True, exist_ok=True)
    keep = set(slug_of.values())
    for old in public.iterdir():
        if old.is_dir() and old.name not in keep:
            shutil.rmtree(old)

    built = []
    for folder in folders:
        name = folder.name
        data = listings[name]
        slug = slug_of[name]
        where = f"{name}/listing.json"
        for key in ("name", "line", "position", "job", "intro", "does", "jobs", "accounts", "setup", "today", "pictures"):
            if key not in data:
                raise CatalogError(f"{where}: no {key!r}")
        if data["line"] not in line_ids:
            raise CatalogError(f"{where}: line {data['line']!r} is not one of {line_ids}")
        for job in data["jobs"]:
            if job not in JOBS:
                raise CatalogError(f"{where}: job {job!r} is not a server job id")
        for item in data["today"]:
            if item["verb"] not in VERBS:
                raise CatalogError(f"{where}: Today verb {item['verb']!r} is not one of {sorted(VERBS)}")
        copy = [data["name"], data["job"], data["intro"], *data["does"], *data["setup"],
                *(i["line"] for i in data["today"]), *(p["caption"] for p in data["pictures"]),
                *(a["why"] for a in data["accounts"])]
        for text in copy:
            check_copy(where, text)

        own = shared_tables(folder)
        groups = {GROUPS[t] for t in own if t in GROUPS}
        makes = sorted(g for g in groups if owners[g] == data["name"])
        reads = sorted(g for g in groups if owners[g] != data["name"])
        brings = carried(name)
        has_day = DAY_TABLE in own or any(DAY_TABLE in shared_tables(ROOT / b) for b in brings)
        day = ("writes" if data["today"] else "reads") if has_day else None

        out = public / slug
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        pictures = []
        for shot in data["pictures"]:
            caption = shot["caption"]
            if len(caption) > CAPTION_MAX:
                raise CatalogError(f"{where}: caption over {CAPTION_MAX} characters: {caption!r}")
            sizes = set()
            for theme in THEMES:
                src = folder / ".lemma" / "shots" / f"{shot['shot']}-{theme}.webp"
                if not src.is_file():
                    raise CatalogError(f"{where}: no picture {src.relative_to(ROOT)}")
                sizes.add(picture(src, out / src.name))
            if len(sizes) != 1:
                raise CatalogError(f"{where}: {shot['shot']} is not one size in light and dark")
            width, height = sizes.pop()
            pictures.append({
                "light": f"/plugins/{slug}/{shot['shot']}-light.webp",
                "dark": f"/plugins/{slug}/{shot['shot']}-dark.webp",
                "width": width,
                "height": height,
                "caption": caption,
            })

        demo = None
        demo_views: list[dict[str, str]] = []
        demo_src = folder / ".lemma" / "demo"
        if (demo_src / "index.html").is_file():
            shutil.copytree(demo_src, out / "demo", ignore=shutil.ignore_patterns(".DS_Store", "node_modules"))
            demo = f"/plugins/{slug}/demo/index.html"
            demo_views = views_of(demo_src, f"/plugins/{slug}/demo/")

        landing = landing_of(folder, data, slug, out) if "moments" in data else None

        memory = memory_line(folder / ".lemma" / "agents-block.md")
        memory_personal = memory_line(folder / ".lemma" / "agents-block-me.md")
        for text in (memory, memory_personal):
            if text:
                check_copy(f"{name}/.lemma/agents-block", text)

        built.append({
            "slug": slug,
            "folder": name,
            "name": data["name"],
            "line": data["line"],
            "position": data["position"],
            "job": data["job"],
            "intro": data["intro"],
            "does": data["does"],
            "jobs": data["jobs"],
            "accounts": [{"any": a["any"], "why": a["why"], "optional": bool(a.get("optional"))} for a in data["accounts"]],
            "setup": data["setup"],
            "today": data["today"],
            "pictures": pictures,
            "carries": [slug_of[b] for b in brings],
            "carriesDirect": [slug_of[b] for b in carries_of(folder)],
            "makes": makes,
            "reads": reads,
            "day": day,
            "memory": memory,
            "memoryPersonal": memory_personal,
            "demo": demo,
            "demoViews": demo_views,
            "landing": landing,
            "install": f"/import/github/{INSTALL_REPO}?path=install/{folder.name}",
        })

    for group, maker in owners.items():
        if maker not in folder_of_name:
            raise CatalogError(f"{group} is first written by {maker!r}, which is not a built plugin")

    known = {p["slug"] for p in built}
    later = []
    for item in planned:
        slug = slugify(item["name"])
        if slug in known:
            raise CatalogError(f"_catalog/planned.json: {item['name']!r} is built or named twice")
        known.add(slug)
        later.append({**{k: v for k, v in item.items() if k != "buildsOn"}, "slug": slug, "buildsOn": item.get("buildsOn", []), "merges": item.get("merges", [])})
    for item in later:
        where = f"_catalog/planned.json: {item['name']}"
        if item["line"] not in line_ids:
            raise CatalogError(f"{where}: line {item['line']!r} is not one of {line_ids}")
        for base in item["buildsOn"]:
            if base not in known:
                raise CatalogError(f"{where}: builds on {base!r}, which is not in the catalog")
        for text in [item["name"], item["one"], *item["merges"]]:
            check_copy(where, text)

    for plugin in built:
        for item in (plugin["landing"] or {}).get("betterWith", []):
            if item["slug"] not in known or item["slug"] == plugin["slug"]:
                raise CatalogError(f"{plugin['folder']}/listing.json: betterWith names {item['slug']!r}, which is not another plugin in the catalog")

    everything = sorted([*built, *later], key=lambda p: p["position"])
    positions = [p["position"] for p in everything]
    if positions != list(range(1, len(everything) + 1)):
        raise CatalogError(f"positions are not 1 to {len(everything)}, each once: {positions}")
    order = [line_ids.index(p["line"]) for p in everything]
    if order != sorted(order):
        raise CatalogError("build order runs out of line order: a line's plugins must sit together, lines in planned.json's order")

    return {
        "//": "Generated by awesome-lemma/_build/site_catalog.py from each plugin's listing.json and _catalog/planned.json. Do not edit by hand.",
        "lines": lines,
        "tables": {key: {"name": n, "line": line} for key, (n, line) in TABLES.items()},
        "built": sorted(built, key=lambda p: p["position"]),
        "planned": sorted(later, key=lambda p: p["position"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--site", required=True, type=Path, help="the lemma-frontend folder")
    args = parser.parse_args()
    site = args.site.resolve()
    if not (site / "src" / "site").is_dir() or not (site / "public").is_dir():
        print(f"{site} is not lemma-frontend (no src/site or public)", file=sys.stderr)
        return 2
    try:
        catalog = build(site)
    except CatalogError as error:
        print(f"site catalog: {error}", file=sys.stderr)
        return 1
    out = site / "src" / "site" / "plugins" / "generated" / "catalog.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")
    shots = sum(len(p["pictures"]) for p in catalog["built"])
    demos = sum(1 for p in catalog["built"] if p["demo"])
    print(f"site catalog: {len(catalog['built'])} built ({shots} pictures, {demos} demos), {len(catalog['planned'])} planned -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
