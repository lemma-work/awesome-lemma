// Take a plugin app's site pictures: 1440x900 at 2x, light and dark, as PNG
// (then cwebp makes webp). Uses the installed Google Chrome through
// playwright-core from a checkout of the Lemma platform: LEMMA_PLATFORM is the
// folder holding lemma-frontend, with its node_modules installed.
//
//   node _kit/bin/shoot.mjs <base url> <out dir> <name>=<path> [<name>=<path> ...]
//
// A path may end in "#click=<css selector>" to press something first, e.g.
// "needs#click=.m-row__open" opens the first conversation.
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";

const platform = process.env.LEMMA_PLATFORM;
if (!platform || !existsSync(`${platform}/lemma-frontend/package.json`)) {
  console.error("Set LEMMA_PLATFORM to a lemma-platform checkout (the folder holding lemma-frontend, after npm ci there).");
  process.exit(2);
}
const require = createRequire(`${platform}/lemma-frontend/package.json`);
const { chromium } = require("playwright-core");

const [base, out, ...shots] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const scheme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await context.newPage();
  for (const shot of shots) {
    const [name, spec] = shot.split("=", 2).length === 2 ? [shot.slice(0, shot.indexOf("=")), shot.slice(shot.indexOf("=") + 1)] : [shot, shot];
    const [path, click] = spec.split("#click=");
    await page.goto(`${base}/${path.replace(/^\//, "")}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    if (click) {
      await page.locator(click).first().click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
    }
    const file = `${out}/${name}-${scheme}.png`;
    await page.screenshot({ path: file });
    console.log("shot", file);
  }
  await context.close();
}
await browser.close();
