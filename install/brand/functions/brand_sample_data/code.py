#input_type_name: BrandSampleDataInput
#output_type_name: BrandSampleDataResult
#function_name: brand_sample_data

"""A made-up brand, so Brand kit can be seen working before anyone's own.

`load` makes Fennel & Fig, a made-up neighbourhood bakery, the way a read
would: its logo, inverse logo, mark, an icon and an illustration go through
`brand_add_assets` (the real "What is this asset?" call), its colours, faces,
voice and guide through `brand_save` (contrast measured, theme.css written),
and two designs through `brand_start_design` and `brand_save_design` (the
real brand check): a launch post waiting for review, and a market banner
whose first version uses a colour that isn't the brand's and whose second,
fixed, is approved. It is the default brand only when the Lemma has no brand
of its own. Every row it makes is kept in `brand_sample_row`.

`clear` removes only what the sample made: those rows and the files it wrote,
and its items on the shared needs_you list (closed by the source). The brand
itself is put away instead of deleted when someone made something on it.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# --- sample: (embedded by bin/embed.py from _shared/sample/) ---
SAMPLE_FILES = {
    'banner-v1.html': """\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Saturday market</title>
<link rel="stylesheet" href="theme.css">
<style>
  html, body { margin: 0; }
  body { width: 1500px; height: 500px; box-sizing: border-box; padding: 64px 80px; display: flex; align-items: center; gap: 64px; background: var(--brand-surface-2); font-family: var(--brand-font-body); }
  .mark { height: 180px; }
  h1 { font: 500 84px/1.04 var(--brand-font-display); margin: 0 0 18px; color: #1e88e5; letter-spacing: -0.02em; }
  p { font-size: 32px; line-height: 1.4; margin: 0; color: var(--brand-muted); }
</style>
</head>
<body>
  <img class="mark" src="mark.svg" alt="Fennel &amp; Fig">
  <div>
    <h1>Find us at the harbour market.</h1>
    <p>Every Saturday, 8 till 1. Sourdough, buns, and the fig rolls, until they're gone.</p>
  </div>
</body>
</html>
""",
    'banner-v2.html': """\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Saturday market</title>
<link rel="stylesheet" href="theme.css">
<style>
  html, body { margin: 0; }
  body { width: 1500px; height: 500px; box-sizing: border-box; padding: 64px 80px; display: flex; align-items: center; gap: 64px; background: var(--brand-surface-2); font-family: var(--brand-font-body); }
  .mark { height: 180px; }
  .when { display: inline-block; background: var(--brand-accent); color: var(--brand-accent-ink); font: 600 24px/1 var(--brand-font-body); padding: 14px 20px; border-radius: var(--brand-radius); margin-bottom: 22px; }
  h1 { font: 500 84px/1.04 var(--brand-font-display); margin: 0 0 18px; color: var(--brand-ink); letter-spacing: -0.02em; }
  p { font-size: 32px; line-height: 1.4; margin: 0; color: var(--brand-muted); }
</style>
</head>
<body>
  <img class="mark" src="mark.svg" alt="Fennel &amp; Fig">
  <div>
    <span class="when">Every Saturday, 8 till 1</span>
    <h1>Find us at the harbour market.</h1>
    <p>Sourdough, buns, and the fig rolls, until they're gone.</p>
  </div>
</body>
</html>
""",
    'guide.md': """\
# Fennel & Fig

A neighbourhood bakery: sourdough, laminated pastry and a short seasonal menu, baked in the morning and sold until it's gone. (A made-up brand: this is Brand kit's sample.)

## Colours
- **Cream** #fbf7f0: the page. Most of every piece is cream.
- **Espresso** #2b2118: body text and headlines.
- **Terracotta** #b84a26: the accent. One button, one word or one shape per piece. Text on it is cream (4.86:1).
- **Flour** #f3eadb: cards and panels on the page.
- **Crust** #e4d8c4: hairlines and borders.
- **Rye** #6f6152: secondary text.
- **Fig** #6b3a5b: a second accent, for seasonal pieces only.
- **Sage** #3f7d4e and **Brick** #b3261e: success and errors, on the shop's own screens only.

## Type
- **Fraunces** (Google Fonts), weight 500, for headlines. Set tight (line-height about 1.05), never in capitals.
- **Source Sans 3** (Google Fonts), 400 and 600, for everything else.

## Logo
The fig mark beside the wordmark. On cream, the primary lockup; on Espresso or Fig, the inverse. The mark alone works small (an avatar, a sticker). Keep clear space of half the mark's width on every side. Never recolour it, never redraw it.

## Voice
Warm, plain and a little playful, like the baker behind the counter at seven in the morning. Short sentences. Real ingredients, real times. No hype.

Phrases we use:
- "Baked this morning, gone by noon."
- "Butter, flour, patience."
- "Come early for the fig rolls."

Do: name the bake and what's in it. Say when it's ready.
Don't: "delicious", "mouth-watering", "artisanal", "game-changer"; exclamation marks; emoji in headlines.

## Not found
Photography: there are no shop or product photos yet, so use the illustrations or a colour field. A mono face.
""",
    'loaf.svg': """\
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><ellipse cx="160" cy="178" rx="138" ry="12" fill="#e4d8c4"/><path d="M28 150c0-62 58-112 132-112s132 50 132 112c0 14-10 22-24 22H52c-14 0-24-8-24-22z" fill="#b84a26"/><path d="M96 70c10 18 12 40 6 62M150 54c10 22 12 48 6 76M206 62c10 20 12 44 6 70" stroke="#f3eadb" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M28 150h264" stroke="#2b2118" stroke-opacity=".18" stroke-width="4"/></svg>
""",
    'logo-inverse.svg': """\
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="104" viewBox="0 0 400 104"><path d="M52 10C35 22 26 40 26 57c0 19 11 33 26 33s26-14 26-33C78 40 69 22 52 10z" fill="#b84a26"/><path d="M52 24v58M52 46c7-6 13-8 18-8M52 60c-7-6-13-8-18-8" stroke="#fbf7f0" stroke-width="3.5" fill="none" stroke-linecap="round"/><text x="100" y="66" font-family="Georgia, 'Times New Roman', serif" font-size="38" fill="#fbf7f0" letter-spacing="-0.5">Fennel &amp; Fig</text></svg>
""",
    'logo.svg': """\
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="104" viewBox="0 0 400 104"><path d="M52 10C35 22 26 40 26 57c0 19 11 33 26 33s26-14 26-33C78 40 69 22 52 10z" fill="#b84a26"/><path d="M52 24v58M52 46c7-6 13-8 18-8M52 60c-7-6-13-8-18-8" stroke="#fbf7f0" stroke-width="3.5" fill="none" stroke-linecap="round"/><text x="100" y="66" font-family="Georgia, 'Times New Roman', serif" font-size="38" fill="#2b2118" letter-spacing="-0.5">Fennel &amp; Fig</text></svg>
""",
    'mark.svg': """\
<svg xmlns="http://www.w3.org/2000/svg" width="104" height="104" viewBox="0 0 104 104"><path d="M52 10C35 22 26 40 26 57c0 19 11 33 26 33s26-14 26-33C78 40 69 22 52 10z" fill="#b84a26"/><path d="M52 24v58M52 46c7-6 13-8 18-8M52 60c-7-6-13-8-18-8" stroke="#fbf7f0" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>
""",
    'post-v1.html': """\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>The autumn menu</title>
<link rel="stylesheet" href="theme.css">
<style>
  html, body { margin: 0; }
  body { width: 1080px; height: 1080px; box-sizing: border-box; padding: 88px; display: flex; flex-direction: column; justify-content: space-between; background: var(--brand-surface); color: var(--brand-ink); font-family: var(--brand-font-body); }
  .logo { height: 64px; align-self: flex-start; }
  .kicker { font: 600 26px/1.2 var(--brand-font-body); color: var(--brand-accent); letter-spacing: 0.02em; }
  h1 { font: 500 112px/1.02 var(--brand-font-display); margin: 22px 0 28px; letter-spacing: -0.02em; }
  p { font-size: 34px; line-height: 1.4; color: var(--brand-muted); margin: 0; max-width: 820px; }
  .foot { display: flex; align-items: flex-end; justify-content: space-between; }
  .cta { background: var(--brand-accent); color: var(--brand-accent-ink); font: 600 30px/1 var(--brand-font-body); padding: 26px 38px; border-radius: var(--brand-radius); }
  .loaf { height: 150px; }
</style>
</head>
<body>
  <img class="logo" src="logo.svg" alt="Fennel &amp; Fig">
  <div>
    <div class="kicker">The autumn menu, from Saturday</div>
    <h1>Fig, walnut and a very good bun.</h1>
    <p>Fig and walnut sourdough, pear frangipane, and a spiced bun worth getting up for. Baked this morning, gone by noon.</p>
  </div>
  <div class="foot"><span class="cta">Saturday from 7am</span><img class="loaf" src="loaf.svg" alt=""></div>
</body>
</html>
""",
    'site-css.txt': """\
/* Brand kit's sample: a made-up bakery's stylesheet, as a read would keep it. */

/* Custom properties that resolve to a colour (the site's own names) */
--ff-cream: #fbf7f0;  /* used 41x */
--ff-espresso: #2b2118;  /* used 37x */
--ff-terracotta: #b84a26;  /* used 12x */
--ff-flour: #f3eadb;  /* used 9x */
--ff-crust: #e4d8c4;  /* used 8x */
--ff-rye: #6f6152;  /* used 14x */
--ff-fig: #6b3a5b;  /* used 3x */
--ff-sage: #3f7d4e;  /* used 2x */
--ff-brick: #b3261e;  /* used 2x */

/* Font stacks, most used first */
font-family: "Source Sans 3", system-ui, sans-serif;  /* 22x */
font-family: Fraunces, Georgia, serif;  /* 9x */

/* Corner radii */
border-radius: 14px;  /* 11x */
""",
    'wheat.svg': """\
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2b2118" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V8"/><path d="M12 8c-2.5-1-3.5-3-3.5-5 2.5.5 3.5 2.5 3.5 5zM12 8c2.5-1 3.5-3 3.5-5-2.5.5-3.5 2.5-3.5 5z"/><path d="M12 13c-2.5-1-3.5-3-3.5-5 2.5.5 3.5 2.5 3.5 5zM12 13c2.5-1 3.5-3 3.5-5-2.5.5-3.5 2.5-3.5 5z"/><path d="M12 18c-2.5-1-3.5-3-3.5-5 2.5.5 3.5 2.5 3.5 5zM12 18c2.5-1 3.5-3 3.5-5-2.5.5-3.5 2.5-3.5 5z"/></svg>
""",
}
# --- end sample ---

ROOT = "/brand/fennel-and-fig"
NAME = "Fennel & Fig"
COLORS = [
    {"role": "ink", "value": "#2b2118", "name": "Espresso", "purpose": "Body text and headlines", "found_in": "--ff-espresso in site.css"},
    {"role": "surface", "value": "#fbf7f0", "name": "Cream", "purpose": "The page; most of every piece", "found_in": "--ff-cream in site.css"},
    {"role": "surface_2", "value": "#f3eadb", "name": "Flour", "purpose": "Cards and panels", "found_in": "--ff-flour in site.css"},
    {"role": "line", "value": "#e4d8c4", "name": "Crust", "purpose": "Hairlines and borders", "found_in": "--ff-crust in site.css"},
    {"role": "muted", "value": "#6f6152", "name": "Rye", "purpose": "Secondary text", "found_in": "--ff-rye in site.css"},
    {"role": "accent", "value": "#b84a26", "name": "Terracotta", "purpose": "One button, one word or one shape per piece", "found_in": "--ff-terracotta in site.css"},
    {"role": "ok", "value": "#3f7d4e", "name": "Sage", "purpose": "Success, on the shop's own screens", "found_in": "--ff-sage in site.css"},
    {"role": "bad", "value": "#b3261e", "name": "Brick", "purpose": "Errors, on the shop's own screens", "found_in": "--ff-brick in site.css"},
    {"role": "extra", "value": "#6b3a5b", "name": "Fig", "purpose": "A second accent, for seasonal pieces only", "found_in": "--ff-fig in site.css"},
]
FONTS = {
    "display": {"family": "Fraunces", "stack": "Fraunces, Georgia, serif", "weight": 500, "source": "google", "note": "Headlines, set tight, never in capitals"},
    "body": {"family": "Source Sans 3", "stack": '"Source Sans 3", system-ui, sans-serif', "weight": 400, "source": "google", "note": "Everything else"},
}
VOICE = ("Warm, plain and a little playful, like the baker behind the counter at seven in the morning. "
         "Short sentences, real ingredients, real times; no hype and no exclamation marks.")
ASSETS = [
    {"file": "logo.svg", "label": "Fennel & Fig", "variant": "primary",
     "found": "The site header, top left, linking to the home page; alt \"Fennel & Fig home\". The fig mark beside the name."},
    {"file": "logo-inverse.svg", "label": "Fennel & Fig (light lettering)", "variant": "inverse",
     "found": "The footer, on the Espresso band; the same lockup with cream lettering."},
    {"file": "mark.svg", "label": "Fig mark", "variant": "mark",
     "found": "The favicon and the round sticker on the about page: the fig shape alone, no name."},
    {"file": "wheat.svg", "label": "Wheat", "variant": "",
     "found": "Beside 'Sourdough' in the menu list, one of six small line pictograms (wheat, cup, croissant, clock, pin, bag)."},
    {"file": "loaf.svg", "label": "Loaf", "variant": "",
     "found": "The home page hero, right of the headline: a drawn loaf in Terracotta on a Crust shadow."},
]
DESIGNS = [
    {"title": "Autumn menu launch post", "kind": "social_post",
     "prompt": "A post announcing the autumn menu: fig and walnut sourdough, pear frangipane, a spiced bun. From Saturday.",
     "versions": [("post-v1.html", ["logo.svg", "loaf.svg"])], "approve": False},
    {"title": "Saturday market banner", "kind": "banner",
     "prompt": "A banner for the Saturday market stall: find us at the harbour market, 8 till 1.",
     "versions": [("banner-v1.html", ["mark.svg"]), ("banner-v2.html", ["mark.svg"])], "approve": True},
]
TABLE_ORDER = ["brand_version", "brand_job", "brand_design", "brand_evidence", "brand_asset", "brand"]


class BrandSampleDataInput(BaseModel):
    mode: str = "load"
    by_name: str = ""


class BrandSampleDataResult(BaseModel):
    made: dict = {}
    removed: dict = {}
    kept: list[str] = []
    checks: list[dict] = []
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _dict(obj: Any) -> dict:
    if obj is None:
        return {}
    return obj.to_dict() if hasattr(obj, "to_dict") else (dict(obj) if isinstance(obj, dict) else {})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run(pod, name: str, data: dict) -> dict:
    run = _dict(pod.functions.run(name, data))
    if str(run.get("status") or "").upper() == "FAILED" or run.get("error"):
        err = run.get("error")
        raise RuntimeError(f"{name}: {err.get('message') if isinstance(err, dict) else err}")
    return run.get("output_data") or run.get("output") or run.get("result") or {}


def brand_sample_data(ctx: FunctionContext, data: BrandSampleDataInput) -> BrandSampleDataResult:
    pod = ctx.pod
    if data.mode == "clear":
        return _clear(pod)
    if data.mode != "load":
        raise ValueError("mode is load or clear.")
    if _rows(pod.query("SELECT id FROM brand_sample_row WHERE table_name = 'brand' LIMIT 1")):
        return BrandSampleDataResult(message="The sample is already here.")
    by = (data.by_name or "").strip() or ((ctx.user_email or "").split("@")[0].replace(".", " ").title() or None)
    me = str(ctx.user_id) if ctx.user_id else None
    made: dict[str, list[str]] = {t: [] for t in TABLE_ORDER}

    def keep(table: str, row_id: str) -> None:
        made[table].append(row_id)
        pod.records.create("brand_sample_row", {"table_name": table, "row_id": row_id})

    others = _rows(pod.query("SELECT id FROM brand WHERE is_default = true AND state <> 'archived' LIMIT 1"))
    brand = _dict(pod.records.create("brand", {
        "name": NAME, "is_default": not others, "state": "reading", "source": "sample", "source_id": "sample",
        "root_path": ROOT}))
    keep("brand", brand["id"])
    started = _now()
    job = _dict(pod.records.create("brand_job", {
        "kind": "read", "state": "working", "brand_id": brand["id"], "source": "sample", "source_ref": "Brand kit's sample",
        "activity": "Loading the sample", "requested_by": me, "requested_name": by, "brand_state_before": "new",
        "started_at": started}))
    keep("brand_job", job["id"])

    for asset in ASSETS:
        pod.files.write_text(f"{ROOT}/assets/{asset['file']}", SAMPLE_FILES[asset["file"]], search_enabled=False)
    pod.files.write_text(f"{ROOT}/evidence/css-sample.txt", SAMPLE_FILES["site-css.txt"], search_enabled=False)
    added = _run(pod, "brand_add_assets", {"brand_id": brand["id"], "assets": [
        {"path": f"{ROOT}/assets/{a['file']}", "label": a["label"], "found": a["found"], "variant": a["variant"]} for a in ASSETS]})
    ids = {}
    for out in added.get("assets") or []:
        if out.get("id"):
            keep("brand_asset", out["id"])
            ids[(out.get("path") or "").rsplit("/", 1)[-1]] = out["id"]
    logos = [{"asset_id": ids[a["file"]], "variant": a["variant"], "on": "dark" if a["variant"] == "inverse" else "light"}
             for a in ASSETS if a["variant"] and a["file"] in ids]
    saved = _run(pod, "brand_save", {
        "brand_id": brand["id"], "job_id": job["id"], "name": NAME, "colors": COLORS, "fonts": FONTS, "voice": VOICE,
        "guide": SAMPLE_FILES["guide.md"], "logos": logos, "radius": "14px",
        "evidence": [
            {"kind": "css", "about": "colors", "path": f"{ROOT}/evidence/css-sample.txt",
             "excerpt": "\n".join(line for line in SAMPLE_FILES["site-css.txt"].splitlines() if line.startswith(("--", "font-family", "border-radius"))),
             "note": "The made-up site's stylesheet: its own names for its colours"},
            {"kind": "copy", "about": "voice", "excerpt": "Baked this morning, gone by noon.\nButter, flour, patience.\nCome early for the fig rolls.",
             "note": "The made-up site's home page and menu"},
        ]})
    for row in _rows(pod.query(f"SELECT id FROM brand_evidence WHERE brand_id = {_sql(brand['id'])}")):
        keep("brand_evidence", row["id"])
    pod.records.update("brand_job", job["id"], {"state": "done", "finished_at": _now(), "activity": "Read. Waiting for a person to check it.",
                                                "note": "The sample brand: a made-up bakery."})

    theme = _text(pod.files.download(saved.get("theme_css_path") or f"{ROOT}/theme.css"))

    def make(spec: dict) -> tuple[str, list[dict]]:
        """One design, version by version, through the same functions the assistant uses."""
        out = []
        design_id = ""
        for i, (html, files) in enumerate(spec["versions"], 1):
            started_design = _run(pod, "brand_start_design", {"design_id": design_id} if design_id else {
                "title": spec["title"], "kind": spec["kind"], "prompt": spec["prompt"], "made_from": "sample", "by_name": by or ""})
            if not design_id:
                keep("brand_design", started_design["design_id"])
            design_id = started_design["design_id"]
            folder = started_design["folder"]
            pod.files.write_text(folder + "index.html", SAMPLE_FILES[html], search_enabled=False)
            pod.files.write_text(folder + "theme.css", theme, search_enabled=False)
            for f in files:
                pod.files.write_text(folder + f, SAMPLE_FILES[f], search_enabled=False)
            verdict = _run(pod, "brand_save_design", {"design_id": design_id, "version": started_design["version"],
                                                      "note": "Brand kit's sample", "quiet": True})
            out.append({"design": spec["title"], "version": started_design["version"], "verdict": verdict.get("verdict"),
                        "broke": verdict.get("broke"), "reason": verdict.get("reason"), "confidence": verdict.get("confidence")})
        if spec["approve"]:
            pod.records.update("brand_design", design_id, {"state": "approved", "approved_at": _now(), "approved_by": by})
        return design_id, out

    checks = []
    with ThreadPoolExecutor(max_workers=len(DESIGNS)) as pool:
        for _, out in pool.map(make, DESIGNS):
            checks += out
    for row in _rows(pod.query(f"SELECT id FROM brand_version WHERE design_id IN ({_in(made['brand_design'])})")):
        keep("brand_version", row["id"])
    try:
        pod.functions.run("brand_needs_you", {})
    except Exception:  # noqa: BLE001
        pass
    counts = {t: len(v) for t, v in made.items() if v}
    return BrandSampleDataResult(made=counts, checks=checks,
                                 message=f"Loaded {NAME}, a made-up bakery: " + ", ".join(f"{n} {t}" for t, n in counts.items()) + ".")


def _text(blob: Any) -> str:
    return blob.decode("utf-8", "replace") if isinstance(blob, (bytes, bytearray)) else str(blob or "")


def _clear(pod) -> BrandSampleDataResult:
    marks = _rows(pod.query("SELECT id, table_name, row_id FROM brand_sample_row LIMIT 5000"))
    if not marks:
        return BrandSampleDataResult(message="No sample to clear.")
    mine: dict[str, set[str]] = {}
    for m in marks:
        mine.setdefault(m["table_name"], set()).add(str(m["row_id"]))
    removed: dict[str, int] = {}
    kept: list[str] = []
    brands = mine.get("brand", set())
    designs = _rows(pod.query(f"SELECT id, folder, version FROM brand_design WHERE id IN ({_in(mine.get('brand_design', []))})"))
    # Files the sample wrote: its designs' versions, its assets, its evidence and the brand's own files.
    paths = [f"{ROOT}/assets/{a['file']}" for a in ASSETS] + [f"{ROOT}/evidence/css-sample.txt"]
    for d in designs:
        spec = next((s for s in DESIGNS if (d.get("folder") or "").rstrip("/").rsplit("/", 1)[-1].startswith(
            s["title"].lower().replace(" ", "-")[:40])), None)
        for i, (_, files) in enumerate((spec or {}).get("versions") or [], 1):
            base = f"{(d.get('folder') or '').rstrip('/')}/v{i}/"
            paths += [base + "index.html", base + "theme.css"] + [base + f for f in files]

    def drop(table: str, ids: list[str]) -> None:
        ids = [i for i in ids if i]
        for start in range(0, len(ids), 100):
            pod.records.bulk_delete(table, ids[start:start + 100])
        if ids:
            removed[table] = removed.get(table, 0) + len(ids)

    drop("brand_version", list(mine.get("brand_version", [])))
    drop("brand_job", list(mine.get("brand_job", [])))
    # A design someone else asked for a change on still has jobs or versions of theirs: keep it.
    left_designs = []
    for d in designs:
        theirs = _rows(pod.query(f"SELECT id FROM brand_version WHERE design_id = {_sql(d['id'])} LIMIT 1")) or \
            _rows(pod.query(f"SELECT id FROM brand_job WHERE design_id = {_sql(d['id'])} LIMIT 1"))
        if theirs:
            kept.append(f"the design {d['id']}: someone added to it")
            left_designs.append(d["id"])
    drop("brand_design", [d["id"] for d in designs if d["id"] not in left_designs])
    drop("brand_evidence", list(mine.get("brand_evidence", [])))
    drop("brand_asset", list(mine.get("brand_asset", [])))
    for brand_id in brands:
        used = any(_rows(pod.query(f"SELECT id FROM {t} WHERE brand_id = {_sql(brand_id)} LIMIT 1"))
                   for t in ("brand_design", "brand_asset", "brand_evidence", "brand_job"))
        was_default = bool(_rows(pod.query(f"SELECT id FROM brand WHERE id = {_sql(brand_id)} AND is_default = true")))
        if used:
            pod.records.update("brand", brand_id, {"state": "archived", "is_default": False})
            kept.append(f"{NAME}: put away, not deleted, because something made on it is still here")
        else:
            drop("brand", [brand_id])
            paths += [f"{ROOT}/guide.md", f"{ROOT}/theme.css", f"{ROOT}/theme.json"]
        if was_default:
            nxt = _rows(pod.query("SELECT id FROM brand WHERE state <> 'archived' AND source <> 'sample' ORDER BY synced_at DESC NULLS LAST LIMIT 1"))
            if nxt:
                pod.records.update("brand", nxt[0]["id"], {"is_default": True})
    files = 0
    for path in paths:
        try:
            pod.files.delete(path)
            files += 1
        except Exception:  # noqa: BLE001 — gone already
            pass
    removed["files"] = files
    # Folders the sample made, deepest first, once nothing is left in them.
    folders = sorted({p.rsplit("/", 1)[0] for p in paths} | {f"{ROOT}/designs", f"{ROOT}/assets", f"{ROOT}/evidence", ROOT}
                     | {p.rsplit("/", 2)[0] for p in paths if "/designs/" in p}, key=lambda f: -f.count("/"))
    for folder in folders:
        if not folder.startswith(ROOT):
            continue
        try:
            if not pod.files.list_all(folder):
                pod.files.delete(folder)
                removed["folders"] = removed.get("folders", 0) + 1
        except Exception:  # noqa: BLE001 — not there, or not empty
            pass
    drop("brand_sample_row", [m["id"] for m in marks])
    try:
        pod.functions.run("brand_needs_you", {})
    except Exception:  # noqa: BLE001
        pass
    return BrandSampleDataResult(removed=removed, kept=kept,
                                 message="Cleared the sample: " + ", ".join(f"{n} {t}" for t, n in removed.items()) + "."
                                 + (" Kept: " + "; ".join(kept) if kept else ""))
