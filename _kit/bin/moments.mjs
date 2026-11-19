#!/usr/bin/env node
// Capture the pictures on a plugin's public page from its "Try it" demo: the
// real app on its made-up sample, so nothing on the page is drawn.
//
//   node _kit/bin/moments.mjs <plugin> [<name> ...]     # -> <plugin>/.lemma/moments/
//
// Reads <plugin>/.lemma/moments.json, a list of captures. Each one opens the
// built demo (<plugin>/.lemma/demo/, from `demo.mjs`) at a route, does a few
// things in it, and keeps one region of the screen, in light and in dark:
//
//   a close-up   <name>-{light,dark}.webp, the region at 2x
//   a loop       <name>-{light,dark}.{mp4,webm} and <name>-{light,dark}-poster.webp:
//                the region recorded while the steps run, at 2x, muted
//
// and writes <plugin>/.lemma/moments/index.json: each capture's kind, its size
// in CSS pixels and what it shows, for `_build/site_catalog.py`, which copies
// the folder to the site with the plugin's other pictures.
//
// A capture:
//
//   {
//     "name": "triage",                 // the files' name
//     "alt": "…",                       // what it shows, for people who can't see it
//     "window": "Needs reply",          // the title the page's window frame gives it (optional)
//     "loop": true,                     // a recording; a close-up without it
//     "route": "/needs",                // the app's path (the demo's #fragment)
//     "viewport": [1184, 700],          // CSS pixels
//     "before": [ … ],                  // steps done first, before a loop starts recording
//     "steps": [                        // done in order, after the app settles
//       { "wait": 800 },
//       { "click": ".m-row__open", "nth": 0 },      // "text" narrows by what it says
//       { "scroll": ".m-readerscroll", "to": "bottom", "ms": 900 },  // or a selector inside, or pixels
//       { "hover": "…" }, { "key": "j" }, { "mouse": [4, 4] }   // the last moves the mouse off whatever it hovers
//     ],
//     "clip": { "x": 0, "y": 34, "width": 1184, "height": 666 }   // or
//     "clip": { "selector": ".m-compose", "pad": 16, "height": 420 },  // its box (padded, capped)
//     "clip": { "selector": ".c-setup", "from": ".m-provider", "to": ".c-setup__row" },  // its width, between two things in it
//     "cursor": true,                   // a loop shows a pointer moving to what it presses
//     "poster": 2.5,                    // seconds into a loop for its still (default: the first frame)
//     "width": 1600,                    // a loop's video width in pixels (default: 2x the clip)
//     "crf": 25,                        // a loop's H.264 quality (default 23; VP9 takes it plus 12)
//     "bleed": "bottom",                // the crop cuts through something there: the page lets it run off its frame
//     "phone": { "viewport": [390, 720], "clip": { … } }   // the same moment in the app's phone layout,
//                                       // as <name>-phone-…: any field here replaces the capture's own
//     "patch": {                        // the sample, changed for this capture only
//       "rows": [{ "match": "from mail_settings", "set": { "setup_step": "connect" } }],
//       "fixtures": { "pods/pod/workflow-runs/x": "@.lemma/moments.setup-run.json" }
//     }
//   }
//
// A patch changes the sample the demo starts from (`window.__LEMMA_DEMO__`),
// so a screen the sample never reaches by clicking (set-up, say) can be shown
// as the app draws it. `rows` merges fields into the rows of every datastore
// query fixture whose match contains `match`; `fixtures` sets an answer by
// request path, from inline JSON or `@<file>` relative to the plugin.
//
// How a loop is recorded. Playwright's own `recordVideo` writes the page at one
// pixel per CSS pixel and at a fixed low bitrate, which is soft on any screen
// that would show the close-up at 2x. So this asks Chrome for its screencast
// directly, launched at a device scale of 2 so the frames are 2x, keeps every
// frame with the moment it was drawn, and lets ffmpeg lay them on a 30 fps
// timeline. A frame that size takes Chrome long enough to hand over that a
// scroll would show at about 15 fps, so a loop is played slowed (SLOW: every
// wait, scroll and CSS animation takes twice as long) and the video is sped
// back up: about 30 drawn frames a second, at the speed it really moves.
// Timers inside the app still run at their own pace, so a toast stays up half
// as long on the video as in the app.
//
// Uses the installed Google Chrome through playwright-core from a checkout of
// the Lemma platform (LEMMA_PLATFORM: the folder holding lemma-frontend, with
// its node_modules installed), ffmpeg (FFMPEG, else on PATH) and cwebp.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const platform = process.env.LEMMA_PLATFORM;
if (!platform || !existsSync(`${platform}/lemma-frontend/package.json`)) {
  console.error("Set LEMMA_PLATFORM to a lemma-platform checkout (the folder holding lemma-frontend, after npm ci there).");
  process.exit(2);
}
const require = createRequire(`${platform}/lemma-frontend/package.json`);
const { chromium } = require("playwright-core");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const THEMES = ["light", "dark"];
const SCALE = 2;
/** How much slower a loop is played than it is shown (see the header). */
const SLOW = 2;
/** How long the app gets to load its rows and fonts before anything is done. */
const SETTLE_MS = 1200;
/** How long the pointer takes to reach what it presses, as shown. */
const POINT_MS = 520;

const [plugin, ...only] = process.argv.slice(2);
if (!plugin) {
  console.error("usage: node _kit/bin/moments.mjs <plugin> [<name> ...]");
  process.exit(2);
}
const folder = resolve(root, plugin);
const demo = join(folder, ".lemma", "demo");
const spec = join(folder, ".lemma", "moments.json");
const out = join(folder, ".lemma", "moments");
if (!existsSync(join(demo, "index.html"))) throw new Error(`${plugin}: no demo; run node _kit/bin/demo.mjs ${plugin} first`);
if (!existsSync(spec)) throw new Error(`${plugin}: no .lemma/moments.json`);
const all = JSON.parse(readFileSync(spec, "utf8")).captures;
const captures = all.filter((c) => !only.length || only.includes(c.name));
if (!captures.length) throw new Error(`${plugin}: nothing to capture${only.length ? ` named ${only.join(", ")}` : ""}`);
mkdirSync(out, { recursive: true });

/* ---------- the demo, served from its folder ---------- */

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".md": "text/markdown; charset=utf-8",
};

function serve(dir) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = normalize(join(dir, path));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/* ---------- the sample, changed for one capture ---------- */

function resolved(value) {
  if (typeof value === "string" && value.startsWith("@")) return JSON.parse(readFileSync(join(folder, value.slice(1)), "utf8"));
  return value;
}

function patchScript(patch) {
  if (!patch) return "";
  const fixtures = Object.fromEntries(Object.entries(patch.fixtures || {}).map(([path, value]) => [path, resolved(value)]));
  const rows = patch.rows || [];
  return `
;(function (data, rows, fixtures) {
  for (const [path, value] of Object.entries(fixtures)) data.fixtures[path] = value;
  for (const entries of Object.values(data.fixtures)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry.match !== "string") continue;
      for (const rule of rows) {
        if (!entry.match.includes(rule.match)) continue;
        const items = entry.response && (entry.response.items || entry.response.data || entry.response.rows);
        if (Array.isArray(items)) for (const item of items) Object.assign(item, rule.set);
      }
    }
  }
})(window.__LEMMA_DEMO__, ${JSON.stringify(rows)}, ${JSON.stringify(fixtures)});
`;
}

/* ---------- a pointer, for loops: where the press lands ---------- */

const POINTER = (ms) => `
(() => {
  if (document.getElementById("__moment_pointer")) return;
  const p = document.createElement("div");
  p.id = "__moment_pointer";
  p.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M4 2.5v15.2l4.1-3.9 2.7 6.1 2.6-1.1-2.6-6h5.7z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  Object.assign(p.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none",
    transform: "translate(var(--x, -40px), var(--y, -40px))", transition: "transform ${ms}ms cubic-bezier(.3,.7,.2,1)" });
  document.documentElement.appendChild(p);
})();
`;

async function pointTo(page, box, slow) {
  const x = Math.round(box.x + Math.min(box.width / 2, 40));
  const y = Math.round(box.y + box.height / 2);
  await page.evaluate(([x, y]) => {
    const p = document.getElementById("__moment_pointer");
    if (p) { p.style.setProperty("--x", x + "px"); p.style.setProperty("--y", y + "px"); }
  }, [x, y]);
  await page.waitForTimeout((POINT_MS + 100) * slow);
}

/* ---------- doing things in the app ---------- */

function target(page, step, key) {
  let loc = page.locator(step[key]);
  if (step.text) loc = loc.filter({ hasText: step.text });
  return loc.nth(step.nth || 0);
}

/** The steps, `slow` times slower than written (1 for a close-up). */
async function run(page, steps, cursor, slow) {
  for (const step of steps) {
    if (step.wait) await page.waitForTimeout(step.wait * slow);
    else if (step.click) {
      const loc = target(page, step, "click");
      await loc.scrollIntoViewIfNeeded();
      if (cursor) await pointTo(page, await loc.boundingBox(), slow);
      await loc.click();
    } else if (step.hover) {
      const loc = target(page, step, "hover");
      if (cursor) await pointTo(page, await loc.boundingBox(), slow);
      await loc.hover();
    } else if (step.key) await page.keyboard.press(step.key);
    else if (step.mouse) await page.mouse.move(step.mouse[0], step.mouse[1]);
    else if (step.scroll) {
      await page.evaluate(async ({ sel, to, ms }) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`nothing to scroll at ${sel}`);
        const from = el.scrollTop;
        let end = to === "bottom" ? el.scrollHeight - el.clientHeight : to === "top" ? 0 : typeof to === "number" ? to : null;
        if (end === null) {
          const inner = el.querySelector(to);
          if (!inner) throw new Error(`nothing at ${to} inside ${sel}`);
          end = from + inner.getBoundingClientRect().top - el.getBoundingClientRect().top - 16;
        }
        end = Math.max(0, Math.min(end, el.scrollHeight - el.clientHeight));
        const start = performance.now();
        await new Promise((done) => {
          // The clock, not the frame's time: a slowed animation rate slows that too.
          const tick = () => {
            const t = Math.min(1, (performance.now() - start) / ms);
            const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            el.scrollTop = from + (end - from) * eased;
            if (t < 1) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame(tick);
        });
      }, { sel: step.scroll, to: step.to ?? "bottom", ms: (step.ms || 800) * slow });
    } else throw new Error(`a step that does nothing: ${JSON.stringify(step)}`);
  }
}

async function clipOf(page, clip, [vw, vh]) {
  let box;
  if (clip.selector) {
    const loc = page.locator(clip.selector).nth(clip.nth || 0);
    await loc.waitFor();
    box = await loc.boundingBox();
    const pad = clip.pad || 0;
    box = { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
    if (clip.from) {
      const top = (await page.locator(clip.from).first().boundingBox()).y - pad;
      box = { ...box, y: top, height: box.y + box.height - top };
    }
    if (clip.to) {
      const to = await page.locator(clip.to).first().boundingBox();
      box = { ...box, height: to.y + to.height + pad - box.y };
    }
    if (clip.width) box.width = Math.min(box.width, clip.width);
    if (clip.height) box.height = Math.min(box.height, clip.height);
  } else box = { x: clip.x || 0, y: clip.y || 0, width: clip.width || vw, height: clip.height || vh };
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  return { x, y, width: Math.min(vw - x, Math.round(box.width)), height: Math.min(vh - y, Math.round(box.height)) };
}

/* ---------- one capture, in one theme ---------- */

const tmp = mkdtempSync(join(tmpdir(), "moments-"));
const server = await serve(demo);
const base = `http://127.0.0.1:${server.address().port}/index.html`;
/* At a device scale of 2 from the start, so the screencast's frames are 2x
   (an emulated scale alone leaves them at 1x). */
const browser = await chromium.launch({ channel: "chrome", headless: true, args: [`--force-device-scale-factor=${SCALE}`] });

async function open(capture, theme) {
  const [vw, vh] = capture.viewport;
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: SCALE, colorScheme: theme });
  const page = await context.newPage();
  const extra = patchScript(capture.patch);
  if (extra) {
    await page.route("**/demo-data.js", async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()) + extra });
    });
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}#${capture.route || "/"}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SETTLE_MS);
  return { context, page, errors };
}

function sh(cmd, args) {
  execFileSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
}

async function still(capture, theme) {
  const { context, page, errors } = await open(capture, theme);
  await run(page, [...(capture.before || []), ...(capture.steps || [])], false, 1);
  await page.waitForTimeout(400);
  const clip = await clipOf(page, capture.clip || {}, capture.viewport);
  const png = join(tmp, `${capture.name}-${theme}.png`);
  await page.screenshot({ path: png, clip });
  await context.close();
  if (errors.length) throw new Error(`${capture.name} (${theme}): ${errors.join("; ")}`);
  sh("cwebp", ["-quiet", "-q", "84", "-m", "6", png, "-o", join(out, `${capture.name}-${theme}.webp`)]);
  return clip;
}

async function loop(capture, theme) {
  const { context, page, errors } = await open(capture, theme);
  await run(page, capture.before || [], false, 1);
  if (capture.cursor) await page.evaluate(POINTER(POINT_MS));
  const clip = await clipOf(page, capture.clip || {}, capture.viewport);
  const name = `${capture.name}-${theme}`;
  const dir = join(tmp, name);
  mkdirSync(dir);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / SLOW });
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, at: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 94, everyNthFrame: 1 });
  await page.waitForTimeout(300 * SLOW);
  await run(page, capture.steps || [], capture.cursor, SLOW);
  const ended = Date.now() / 1000;
  await cdp.send("Page.stopScreencast");
  await context.close();
  if (errors.length) throw new Error(`${capture.name} (${theme}): ${errors.join("; ")}`);
  if (frames.length < 2) throw new Error(`${capture.name} (${theme}): the screencast sent ${frames.length} frames`);

  // Each frame stays up until the next one was drawn; the last until the steps ended.
  const lines = ["ffconcat version 1.0"];
  frames.forEach((frame, i) => {
    const until = i + 1 < frames.length ? frames[i + 1].at : ended;
    lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, until - frame.at).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  const list = join(dir, "frames.txt");
  writeFileSync(list, lines.join("\n") + "\n");

  const even = (n) => Math.round(n / 2) * 2;
  const width = even(capture.width || clip.width * SCALE);
  const filters = [
    `setpts=PTS/${SLOW}`,
    `crop=${even(clip.width * SCALE)}:${even(clip.height * SCALE)}:${clip.x * SCALE}:${clip.y * SCALE}`,
    `scale=${width}:-2:flags=lanczos`,
    "fps=30",
    "format=yuv420p",
  ].join(",");
  const input = ["-f", "concat", "-safe", "0", "-i", list];
  const crf = capture.crf ?? 23;
  sh(FFMPEG, ["-y", "-loglevel", "error", ...input, "-an", "-vf", filters, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf),
    "-movflags", "+faststart", join(out, `${name}.mp4`)]);
  sh(FFMPEG, ["-y", "-loglevel", "error", ...input, "-an", "-vf", filters, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf + 12),
    "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", join(out, `${name}.webm`)]);
  const poster = join(dir, "poster.png");
  sh(FFMPEG, ["-y", "-loglevel", "error", "-ss", String(capture.poster || 0), "-i", join(out, `${name}.mp4`), "-frames:v", "1", poster]);
  sh("cwebp", ["-quiet", "-q", "84", "-m", "6", poster, "-o", join(out, `${name}-poster.webp`)]);
  return { ...clip, seconds: Math.round(((ended - frames[0].at) / SLOW) * 10) / 10 };
}

/* ---------- all of them ---------- */

/** A capture in light and dark, which must come out the same size. */
async function both(capture) {
  const sizes = [];
  for (const theme of THEMES) sizes.push(capture.loop ? await loop(capture, theme) : await still(capture, theme));
  if (sizes[0].width !== sizes[1].width || sizes[0].height !== sizes[1].height) {
    throw new Error(`${capture.name}: light is ${sizes[0].width}x${sizes[0].height}, dark ${sizes[1].width}x${sizes[1].height}; give it a fixed clip`);
  }
  const files = readdirSync(out).filter((f) => /-(light|dark)/.test(f) && f.replace(/-(light|dark).*$/, "") === capture.name);
  const sizesOnDisk = files.map((f) => `${f} ${Math.round(statSync(join(out, f)).size / 1024)}K`);
  console.log(`${capture.name}: ${capture.loop ? `loop ${sizes[0].seconds}s` : "still"} ${sizes[0].width}x${sizes[0].height} · ${sizesOnDisk.join(", ")}`);
  return sizes[0];
}

const indexPath = join(out, "index.json");
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
try {
  for (const capture of captures) {
    if (!capture.name || !capture.viewport || !capture.alt) throw new Error(`a capture needs a name, a viewport and its alt: ${JSON.stringify(capture).slice(0, 120)}`);
    const size = await both(capture);
    index[capture.name] = { kind: capture.loop ? "loop" : "still", width: size.width, height: size.height, alt: capture.alt, bleed: capture.bleed || null, window: capture.window || null };
    if (capture.phone) {
      // The same moment on a phone: the app's own narrow layout, so the page
      // shows it at a size a phone can read instead of shrinking the wide one.
      const phone = { ...capture, ...capture.phone, name: `${capture.name}-phone` };
      delete phone.phone;
      const small = await both(phone);
      index[capture.name].phone = { width: small.width, height: small.height, bleed: phone.bleed || null };
    }
  }
  const names = new Set(all.map((c) => c.name));
  for (const name of Object.keys(index)) if (!names.has(name)) delete index[name];
  // What a capture shows and how the page frames it need no new pictures:
  // they follow moments.json for every capture, taken this run or not.
  for (const c of all) {
    if (!index[c.name]) continue;
    Object.assign(index[c.name], { alt: c.alt, bleed: c.bleed || null, window: c.window || null });
    if (index[c.name].phone) index[c.name].phone.bleed = (c.phone && "bleed" in c.phone ? c.phone.bleed : c.bleed) || null;
  }
  writeFileSync(indexPath, JSON.stringify(Object.fromEntries(all.filter((c) => index[c.name]).map((c) => [c.name, index[c.name]])), null, 2) + "\n");
} finally {
  await browser.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
