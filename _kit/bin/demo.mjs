#!/usr/bin/env node
// Build a plugin's "Try it" demo: its real apps on its made-up sample rows, in
// a browser, with no sign-in and no server (see _kit/src/demo.ts).
//
//   node _kit/bin/demo.mjs <plugin> [<plugin> ...]     # into <plugin>/.lemma/demo/
//
// Each app is built from its own source/ with VITE_LEMMA_DEMO=1, `base: "./"`
// (so the folder works wherever it is copied), and beside its index.html:
//
//   demo-data.js      window.__LEMMA_DEMO__: the fixtures the site pictures
//                     were taken on (.lemma/shots/fixtures/), and the plugin's
//                     .lemma/demo.json (apps, start path, notes, anchor date,
//                     connections: slug -> {state, as} for the Connect piece)
//   demo-handlers.js  the plugin's .lemma/demo.js, if it has one: what its
//                     functions and workflows do to the in-memory sample
//   ../fonts/         Inter and any Google face the sample names, so the page
//                     loads no font from Google
//
// The first app is demo/index.html; any other is demo/<app>/index.html, and
// the bar on top switches between them.
//
// Viewport heights in the apps' CSS are taken down by the bar's height
// (`100vh` -> `calc(100vh - var(--c-demo-bar, 0px))`), so a full-height app
// fits under the bar. The variable is set only in a demo.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const kit = resolve(here, "..");
const root = resolve(kit, "..");
const fontCache = join(kit, ".cache", "demo-fonts");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const INTER = "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500&display=swap";

function walk(dir, base = dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split("\\").join("/"));
  }
  return out;
}

function size(dir) {
  return walk(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ---------- fonts: Google's latin faces, kept beside the page ---------- */

async function get(url, binary = false) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}

/** One family's latin @font-face rules and their files, cached in _kit/.cache. */
async function family(name, url) {
  const id = slug(name);
  const dir = join(fontCache, id);
  const sheet = join(dir, `${id}.css`);
  if (!existsSync(sheet)) {
    mkdirSync(dir, { recursive: true });
    const css = await get(url || `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap`);
    const blocks = css.split(/(?=\/\*\s*[\w-]+\s*\*\/)/).filter((b) => /^\/\*\s*latin\s*\*\//.test(b));
    let n = 0;
    const seen = new Map();
    let out = "";
    for (const block of blocks) {
      let rule = block.replace(/^\/\*[^*]*\*\/\s*/, "");
      const m = /url\((https:[^)]+\.woff2)\)/.exec(rule);
      if (!m) continue;
      if (!seen.has(m[1])) {
        const file = `${id}-${n++}.woff2`;
        writeFileSync(join(dir, file), await get(m[1], true));
        seen.set(m[1], file);
      }
      rule = rule.replace(m[1], `./${seen.get(m[1])}`);
      out += rule.trim() + "\n";
    }
    if (!out) throw new Error(`no latin face for ${name}`);
    writeFileSync(sheet, out);
  }
  return { id, dir, sheet };
}

/**
 * One @font-face per file and style: Google writes a variable face once per
 * weight asked for, all pointing at the same file, which inlined would be the
 * same font several times over.
 */
function mergeFaces(css) {
  const rules = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
  const groups = new Map();
  for (const body of rules) {
    const prop = (name) => (new RegExp(`${name}:\\s*([^;]+);`).exec(body) || [])[1]?.trim();
    const key = `${prop("font-family")}|${prop("font-style")}|${prop("src")}|${prop("unicode-range")}`;
    const weights = String(prop("font-weight") || "400").split(/\s+/).map(Number);
    const group = groups.get(key) || { body, min: Infinity, max: -Infinity };
    group.min = Math.min(group.min, ...weights);
    group.max = Math.max(group.max, ...weights);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ body, min, max }) => `@font-face {${body.replace(/font-weight:\s*[^;]+;/, `font-weight: ${min === max ? min : `${min} ${max}`};`)}}`)
    .join("\n") + "\n";
}

/** Copy the families into <demo>/fonts/; returns family (lower case) -> sheet path under demo/. */
async function fonts(names, out) {
  const map = {};
  mkdirSync(join(out, "fonts"), { recursive: true });
  for (const [name, url] of [["Inter", INTER], ...names.map((n) => [n, null])]) {
    const f = await family(name, url);
    for (const file of readdirSync(f.dir)) {
      if (file.endsWith(".css")) writeFileSync(join(out, "fonts", file), mergeFaces(readFileSync(join(f.dir, file), "utf8")));
      else copyFileSync(join(f.dir, file), join(out, "fonts", file));
    }
    map[name.toLowerCase()] = `fonts/${f.id}.css`;
  }
  return map;
}

/** A sheet's faces with their files inline, for a page drawn where it cannot fetch (a design in a sandboxed frame). */
function inlineFaces(out, sheetPath) {
  const css = readFileSync(join(out, sheetPath), "utf8");
  return css.replace(/url\(\.\/([^)]+\.woff2)\)/g, (_m, file) => `url(data:font/woff2;base64,${readFileSync(join(out, "fonts", file)).toString("base64")})`);
}

/** Google Fonts imports and links in a sample file, swapped for the faces themselves. */
function withoutGoogle(text, out, map) {
  const sheetFor = (url) => {
    const fams = new URL(url.replace(/&amp;/g, "&")).searchParams.getAll("family").map((f) => f.split(":")[0].trim().toLowerCase());
    return fams.map((f) => (map[f] ? inlineFaces(out, map[f]) : "")).join("\n");
  };
  return text
    .replace(/@import\s+url\(\s*["']?(https:\/\/fonts\.googleapis\.com\/[^"')]+)["']?\s*\)\s*;?/g, (_m, url) => sheetFor(url))
    .replace(/<link\b[^>]*href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["'][^>]*>/g, (_m, url) => `<style>${sheetFor(url)}</style>`)
    .replace(/<link\b[^>]*href=["']https:\/\/fonts\.gstatic\.com[^"']*["'][^>]*>/g, "");
}

/* ---------- the sample ---------- */

function sample(plugin, out, fontMap) {
  const dir = join(root, plugin, ".lemma", "shots", "fixtures");
  const fixtures = {};
  const files = {};
  for (const file of walk(dir)) {
    const text = readFileSync(join(dir, file), "utf8");
    if (file.startsWith("documents/")) files[basename(file)] = withoutGoogle(text, out, fontMap);
    else if (file.startsWith("files/")) files["/" + file.slice("files/".length)] = withoutGoogle(text, out, fontMap);
    else if (file.endsWith(".json")) fixtures[file.slice(0, -5)] = JSON.parse(text);
  }
  return { fixtures, files };
}

/* ---------- one app ---------- */

async function buildApp(source, outDir, page) {
  const vitePath = join(source, "node_modules", "vite", "dist", "node", "index.js");
  if (!existsSync(vitePath)) throw new Error(`${source}: no vite in node_modules (run npm install there)`);
  const { build } = await import(pathToFileURL(vitePath).href);
  const demo = {
    name: "lemma-demo",
    enforce: "pre",
    transform(code, id) {
      if (!/\.css(\?|$)/.test(id)) return null;
      const next = code.replace(/\b100([dsl]?vh)\b/g, (_m, unit) => `calc(100${unit} - var(--c-demo-bar, 0px))`);
      return next === code ? null : { code: next, map: null };
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const tags = [
          { tag: "meta", attrs: { name: "robots", content: "noindex" }, injectTo: "head-prepend" },
          { tag: "link", attrs: { rel: "icon", href: "data:," }, injectTo: "head-prepend" },
          { tag: "script", attrs: { src: "./demo-data.js" }, injectTo: "head-prepend" },
        ];
        if (page.handlers) tags.push({ tag: "script", attrs: { src: "./demo-handlers.js" }, injectTo: "head-prepend" });
        return { html, tags };
      },
    },
  };
  const cwd = process.cwd();
  process.chdir(source);
  process.env.VITE_LEMMA_DEMO = "1";
  try {
    await build({
      root: source,
      configFile: join(source, "vite.config.ts"),
      mode: "production",
      base: "./",
      logLevel: "warn",
      build: { outDir, emptyOutDir: false, reportCompressedSize: false, sourcemap: false },
      plugins: [demo],
    });
  } finally {
    delete process.env.VITE_LEMMA_DEMO;
    process.chdir(cwd);
  }
  const js = walk(join(outDir, "assets")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(outDir, "assets", f), "utf8")).join("\n");
  if (!js.includes("lemma-demo.invalid")) throw new Error(`${source}: the build has no demo client in it (is the kit re-vendored?)`);
  writeFileSync(join(outDir, "demo-data.js"), `window.__LEMMA_DEMO__ = ${JSON.stringify(page.data)};\n`);
  if (page.handlers) writeFileSync(join(outDir, "demo-handlers.js"), page.handlers);
}

/** Every plugin app's name on screen: its label in that plugin's demo.json, else its name. */
function appLabels() {
  const labels = {};
  for (const plugin of readdirSync(root)) {
    if (plugin.startsWith("_") || plugin.startsWith(".") || !existsSync(join(root, plugin, "apps"))) continue;
    const configPath = join(root, plugin, ".lemma", "demo.json");
    const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
    for (const name of readdirSync(join(root, plugin, "apps"))) {
      const given = (config.apps || []).find((a) => a.name === name);
      labels[name] = given?.label || name.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    }
  }
  return labels;
}

async function buildPlugin(plugin) {
  const base = join(root, plugin);
  if (!existsSync(join(base, "apps"))) throw new Error(`${plugin}: no apps/ (is it a plugin folder?)`);
  const configPath = join(base, ".lemma", "demo.json");
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  const handlersPath = join(base, ".lemma", "demo.js");
  const handlers = existsSync(handlersPath) ? readFileSync(handlersPath, "utf8") : null;
  const found = readdirSync(join(base, "apps")).filter((a) => existsSync(join(base, "apps", a, "source", "package.json")));
  const apps = (config.apps || found.map((name) => ({ name }))).map((a, i) => ({
    name: a.name,
    label: a.label || a.name.replace(/^\w/, (c) => c.toUpperCase()),
    start: a.start,
    query: a.query,
    dir: i === 0 ? "" : a.dir || a.name,
    source: join(base, "apps", a.source || a.name, "source"),
  }));
  const out = join(base, ".lemma", "demo");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const fontMap = await fonts(config.fonts || [], out);
  const { fixtures, files } = sample(plugin, out, fontMap);
  for (const app of apps) {
    const outDir = join(out, app.dir);
    const up = app.dir ? "../".repeat(app.dir.split("/").length) : "./";
    const data = {
      plugin,
      app: app.name,
      apps: apps.map((a) => ({ name: a.name, label: a.label, href: up + (a.dir ? a.dir + "/" : "") + (a.query || "") })),
      start: app.start || config.start || "/",
      anchor: config.anchor,
      zone: config.zone,
      notes: config.notes || {},
      labels: appLabels(),
      user: config.user,
      connections: config.connections || {},
      fonts: Object.fromEntries(Object.entries(fontMap).map(([k, v]) => [k, up + v])),
      fixtures,
      files,
    };
    mkdirSync(outDir, { recursive: true });
    await buildApp(app.source, outDir, { data, handlers });
    console.log(`built     ${plugin}/${app.name} -> ${relative(root, outDir) || "."}`);
  }
  const bytes = size(out);
  console.log(`demo      ${plugin}: ${(bytes / 1024 / 1024).toFixed(2)} MB in ${relative(root, out)}`);
  if (bytes > 3 * 1024 * 1024) console.warn(`warning   ${plugin}: over 3 MB`);
}

const wanted = process.argv.slice(2);
if (!wanted.length) {
  console.error("usage: node _kit/bin/demo.mjs <plugin> [<plugin> ...]");
  process.exit(2);
}
for (const plugin of wanted) await buildPlugin(plugin);
// Vite leaves handles open (esbuild's service); the builds are done.
process.exit(0);
