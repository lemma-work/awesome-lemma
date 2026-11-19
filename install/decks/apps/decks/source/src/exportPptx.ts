// A deck as a PowerPoint file: real text boxes and shapes, not pictures of
// slides, so it opens and edits in PowerPoint, Keynote and Google Slides.
// Started from the Decks desk app's export.ts and taken further: the deck's
// own look and fonts, **bold** as accent runs, the cards' icons and the
// brand's logo as images, speaker notes, and text sized to its box (no
// auto-fit: Keynote ignores it and PowerPoint only applies it on edit).

import { createElement } from "react";
import { hex, isDark, lookOf } from "./look";
import { iconOf, plain, same } from "./Slide";
import type { Block, Card, Deck } from "./types";
import { client } from "@lemma-plugins/kit";

type Pptx = import("pptxgenjs").default;
type PptxSlide = import("pptxgenjs").default.Slide;
type TextProps = import("pptxgenjs").default.TextProps;

const W = 13.333;
const H = 7.5;
const PAD = 0.83;

interface Ctx {
  ink: string;
  muted: string;
  accent: string;
  raised: string;
  surface: string;
  head: string;
  body: string;
  icons: Map<string, string>;
  /** Headings bold: a brand whose display face has one weight (400) is never bolded. */
  bold: boolean;
}

const strip = (c: string) => c.replace("#", "");

/** Inches a line of text takes up, roughly: about half an em per character. */
function lines(text: string, width: number, pt: number): number {
  const perLine = Math.max(8, Math.floor((width * 72) / (pt * 0.48)));
  return String(text || "").split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
}
function height(text: string, width: number, pt: number, spacing = 1.25): number {
  return (lines(text, width, pt) * pt * spacing) / 72 + 0.08;
}
/** The biggest size from `sizes` at which `text` fits in `maxH`. */
function fit(text: string, width: number, maxH: number, sizes: number[]): number {
  for (const pt of sizes) if (height(text, width, pt) <= maxH) return pt;
  return sizes[sizes.length - 1];
}

/** **bold** as accent runs. */
function runsOf(text: string, ctx: Ctx, base: TextProps["options"] = {}): TextProps[] {
  const parts = String(text || "").split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) => ({ text: part, options: i % 2 === 1 ? { ...base, bold: true, color: ctx.accent } : { ...base } })).filter((r) => r.text);
}

async function rasterize(svg: string, px: number): Promise<string | null> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error("image")); img.src = url; });
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    const canvas = document.createElement("canvas");
    canvas.height = px;
    canvas.width = Math.round(px * ratio);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function iconImages(cards: Card[], color: string): Promise<Map<string, string>> {
  const names = new Set<string>();
  for (const c of cards) {
    for (const b of c.blocks) {
      if (b.type === "bullets") b.items.forEach((i) => i.icon && names.add(i.icon));
      if (b.type === "stats") b.items.forEach((i) => i.icon && names.add(i.icon));
      if (b.type === "columns") b.columns.forEach((i) => i.icon && names.add(i.icon));
    }
  }
  const out = new Map<string, string>();
  if (!names.size) return out;
  const { renderToStaticMarkup } = await import("react-dom/server");
  for (const name of names) {
    const Icon = iconOf(name);
    if (!Icon) continue;
    const svg = renderToStaticMarkup(createElement(Icon, { color, size: 96, strokeWidth: 2 })).replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    const png = await rasterize(svg, 96);
    if (png) out.set(name, png);
  }
  return out;
}

async function logoImage(path: string | null | undefined): Promise<{ data: string; ratio: number } | null> {
  if (!path) return null;
  try {
    const blob = await client.files.download(path);
    const text = blob.type.includes("svg") || path.toLowerCase().endsWith(".svg") ? await blob.text() : null;
    let data: string | null;
    if (text) data = await rasterize(text, 240);
    else data = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(blob); });
    if (!data) return null;
    const img = new Image();
    await new Promise<void>((ok) => { img.onload = () => ok(); img.onerror = () => ok(); img.src = data!; });
    return { data, ratio: img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 3 };
  } catch {
    return null;
  }
}

function addBlock(slide: PptxSlide, block: Block, x: number, y: number, w: number, room: number, ctx: Ctx): number {
  const { ink, muted, accent, raised, head, body } = ctx;
  switch (block.type) {
    case "heading": {
      const pt = fit(plain(block.text), w, Math.min(room, 1.4), [24, 22, 20, 18]);
      const h = height(plain(block.text), w, pt, 1.15);
      slide.addText(runsOf(block.text, ctx, { color: ink, bold: ctx.bold, fontFace: head, fontSize: pt }), { x, y, w, h, valign: "top", margin: 0 });
      return y + h + 0.14;
    }
    case "text": {
      const pt = fit(plain(block.text), w, Math.min(room, 3), [18, 16, 15, 14, 13, 12]);
      const h = height(plain(block.text), w, pt, 1.4);
      slide.addText(runsOf(block.text, ctx, { color: ink, fontFace: body, fontSize: pt }), { x, y, w, h, valign: "top", margin: 0, lineSpacingMultiple: 1.2 });
      return y + h + 0.16;
    }
    case "bullets": {
      const iconed = block.items.length > 0 && block.items.every((i) => i.icon && ctx.icons.has(i.icon));
      const all = block.items.map((i) => plain(i.text)).join("\n");
      const indent = iconed ? 0.48 : 0.34;
      const pt = fit(all, w - indent, Math.min(room, 4.6) - block.items.length * 0.14, [18, 17, 16, 15, 14, 13, 12]);
      let cy = y;
      for (const item of block.items) {
        const h = Math.max(height(plain(item.text), w - indent, pt, 1.3), pt / 72 * 1.4);
        if (iconed && item.icon) {
          slide.addImage({ data: ctx.icons.get(item.icon)!, x, y: cy + 0.02, w: 0.28, h: 0.28 });
        } else {
          slide.addShape("rect", { x, y: cy + (pt / 72) * 0.48, w: 0.16, h: 0.05, fill: { color: strip(accent) }, line: { color: strip(accent), width: 0 } });
        }
        slide.addText(runsOf(item.text, ctx, { color: ink, fontFace: body, fontSize: pt }), { x: x + indent, y: cy, w: w - indent, h, valign: "top", margin: 0 });
        cy += h + 0.14;
      }
      return cy + 0.06;
    }
    case "quote": {
      const pt = fit(block.text, w - 0.35, Math.min(room - 0.5, 3), [26, 24, 22, 20, 18]);
      const h = height(block.text, w - 0.35, pt, 1.35);
      slide.addShape("rect", { x, y, w: 0.06, h: h + (block.attribution ? 0.45 : 0), fill: { color: strip(accent) }, line: { color: strip(accent), width: 0 } });
      slide.addText(`“${block.text}”`, { x: x + 0.32, y, w: w - 0.32, h, fontFace: head, fontSize: pt, color: ink, valign: "top", margin: 0 });
      if (block.attribution) {
        slide.addText(block.attribution, { x: x + 0.32, y: y + h + 0.05, w: w - 0.32, h: 0.35, fontFace: body, fontSize: 13, color: muted, margin: 0 });
      }
      return y + h + (block.attribution ? 0.6 : 0.2);
    }
    case "stats": {
      const n = Math.max(1, block.items.length);
      const gap = 0.24;
      const cw = (w - gap * (n - 1)) / n;
      const ch = Math.min(2.2, Math.max(1.7, room - 0.1));
      block.items.forEach((s, i) => {
        const cx = x + i * (cw + gap);
        slide.addShape("roundRect", { x: cx, y, w: cw, h: ch, rectRadius: 0.08, fill: { color: strip(raised) }, line: { color: strip(raised), width: 0 } });
        let top = y + 0.2;
        if (s.icon && ctx.icons.has(s.icon)) {
          slide.addImage({ data: ctx.icons.get(s.icon)!, x: cx + 0.22, y: top, w: 0.32, h: 0.32 });
          top += 0.42;
        }
        const vpt = fit(s.value, cw - 0.44, 0.75, [36, 32, 28, 24, 20]);
        slide.addText(s.value, { x: cx + 0.22, y: top, w: cw - 0.44, h: 0.7, fontFace: head, fontSize: vpt, bold: ctx.bold, color: accent, valign: "top", margin: 0 });
        slide.addText(s.label, { x: cx + 0.22, y: top + 0.72, w: cw - 0.44, h: Math.max(0.4, y + ch - top - 0.8), fontFace: body, fontSize: fit(s.label, cw - 0.44, 0.7, [14, 13, 12, 11]), color: muted, valign: "top", margin: 0 });
      });
      return y + ch + 0.24;
    }
    case "columns": {
      const n = Math.max(1, block.columns.length);
      const gap = 0.36;
      const cw = (w - gap * (n - 1)) / n;
      const longest = block.columns.reduce((a, c) => (c.body.length > a.length ? c.body : a), "");
      const bpt = fit(plain(longest), cw, Math.min(room - 0.7, 3.4), [16, 15, 14, 13, 12]);
      let bottom = y;
      block.columns.forEach((c, i) => {
        const cx = x + i * (cw + gap);
        let hx = cx;
        if (c.icon && ctx.icons.has(c.icon)) {
          slide.addImage({ data: ctx.icons.get(c.icon)!, x: cx, y: y + 0.04, w: 0.28, h: 0.28 });
          hx += 0.38;
        }
        slide.addText(c.heading, { x: hx, y, w: cw - (hx - cx), h: 0.4, fontFace: head, fontSize: 17, bold: ctx.bold, color: ink, valign: "top", margin: 0 });
        slide.addShape("rect", { x: cx, y: y + 0.48, w: cw, h: 0.035, fill: { color: strip(accent) }, line: { color: strip(accent), width: 0 } });
        const bh = height(plain(c.body), cw, bpt, 1.4);
        slide.addText(runsOf(c.body, ctx, { color: ink, fontFace: body, fontSize: bpt }), { x: cx, y: y + 0.62, w: cw, h: bh, valign: "top", margin: 0, lineSpacingMultiple: 1.15 });
        bottom = Math.max(bottom, y + 0.62 + bh);
      });
      return bottom + 0.2;
    }
    case "visual": {
      const h = Math.min(2.4, Math.max(1.2, room - 0.1));
      slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.08, fill: { color: strip(accent), transparency: 78 }, line: { color: strip(accent), width: 0, transparency: 100 } });
      return y + h + 0.2;
    }
    default:
      return y;
  }
}

/** Builds the .pptx and saves it; returns the file's name. */
export async function exportPptx(deck: Deck, all: Card[]): Promise<string> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const look = lookOf(deck.look);
  const ctx: Ctx = {
    ink: hex(look.ink, "#111111"), muted: hex(look.muted, "#666666"), accent: hex(look.accent, "#C2410C"),
    raised: hex(look.raised, "#F2F2F2"), surface: hex(look.surface, "#FFFFFF"),
    head: look.heading_office || look.heading_font, body: look.body_office || look.body_font, icons: new Map(),
    bold: (look.heading_weight ?? 600) >= 600,
  };
  const cards = all.filter((c) => c.status === "ready" && c.blocks.length).sort((a, b) => a.position - b.position);
  ctx.icons = await iconImages(cards, ctx.accent);
  const logo = await logoImage(isDark(ctx.surface) ? look.logo_inverse_path || look.logo_path : look.logo_path);

  const pptx: Pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = deck.title || deck.prompt;
  pptx.subject = deck.prompt;
  // pptxgenjs writes Company into docProps/app.xml unescaped (it escapes the
  // title and subject): "Quarry & Kiln" made a file Keynote refused to open.
  pptx.company = look.source === "brand" ? (look.name || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
  pptx.theme = { headFontFace: ctx.head, bodyFontFace: ctx.body };

  for (const card of cards) {
    const slide = pptx.addSlide();
    slide.background = { color: strip(ctx.surface) };
    if (card.notes) slide.addNotes(card.notes);
    const blocks = card.blocks;
    const big = card.layout === "hero" || card.layout === "closing";
    if (big) {
      slide.addShape("ellipse", { x: W * 0.55, y: -H * 0.55, w: W * 0.75, h: H * 1.1, fill: { color: strip(ctx.accent), transparency: 88 }, line: { color: strip(ctx.accent), width: 0, transparency: 100 } });
      if (logo) slide.addImage({ data: logo.data, x: PAD, y: 0.55, h: 0.42, w: Math.min(2.8, 0.42 * logo.ratio) });
      const heading = blocks.find((b) => b.type === "heading") as Extract<Block, { type: "heading" }> | undefined;
      const sub = blocks.find((b) => b.type === "text") as Extract<Block, { type: "text" }> | undefined;
      const titleText = card.layout === "closing" && heading ? plain(heading.text) : card.title || "";
      const tw = W * 0.72;
      const tpt = fit(titleText, tw, 2.6, [48, 44, 40, 36, 32]);
      const th = height(titleText, tw, tpt, 1.08);
      const top = Math.max(1.4, (H - th - (sub ? 1.1 : 0)) / 2);
      if (card.layout === "closing" && heading && !same(heading.text, card.title)) {
        slide.addText((card.title || "").toUpperCase(), { x: PAD, y: top - 0.55, w: tw, h: 0.4, fontFace: ctx.body, fontSize: 13, bold: true, color: ctx.accent, charSpacing: 2, margin: 0 });
      }
      slide.addText(titleText, { x: PAD, y: top, w: tw, h: th, fontFace: ctx.head, fontSize: tpt, bold: ctx.bold, color: ctx.ink, valign: "top", margin: 0 });
      if (sub) slide.addText(runsOf(sub.text, ctx, { color: ctx.muted, fontFace: ctx.body, fontSize: 20 }), { x: PAD, y: top + th + 0.25, w: W * 0.66, h: height(plain(sub.text), W * 0.66, 20, 1.35), valign: "top", margin: 0 });
      slide.addShape("rect", { x: PAD, y: H - 0.75, w: 0.95, h: 0.075, fill: { color: strip(ctx.accent) }, line: { color: strip(ctx.accent), width: 0 } });
      continue;
    }
    const split = (card.layout === "visual-left" || card.layout === "visual-right") && blocks.some((b) => b.type === "visual");
    const panelW = W * 0.46;
    if (split) {
      const px = card.layout === "visual-left" ? 0 : W - panelW;
      slide.addShape("rect", { x: px, y: 0, w: panelW, h: H, fill: { color: strip(ctx.raised) }, line: { color: strip(ctx.raised), width: 0 } });
      slide.addShape("ellipse", { x: px + panelW * 0.1, y: -H * 0.25, w: panelW * 1.1, h: H * 0.95, fill: { color: strip(ctx.accent), transparency: 62 }, line: { color: strip(ctx.accent), width: 0, transparency: 100 } });
      slide.addShape("ellipse", { x: px + panelW * 0.45, y: H * 0.55, w: panelW * 0.8, h: H * 0.7, fill: { color: strip(ctx.accent), transparency: 80 }, line: { color: strip(ctx.accent), width: 0, transparency: 100 } });
    }
    const x = split && card.layout === "visual-left" ? panelW + 0.6 : PAD;
    const w = split ? W - panelW - 0.6 - PAD : W - PAD * 2;
    const title = card.title || "";
    const tpt = fit(title, w, 1.2, [30, 28, 26, 24, 22]);
    const th = height(title, w, tpt, 1.12);
    const content = blocks.filter((b) => !(split && b.type === "visual"));
    // Centre the content when it is short, as the slide does.
    const estimate = content.reduce((sum, b) => sum + (b.type === "stats" ? 2.2 : b.type === "columns" ? 2.6 : b.type === "bullets" ? b.items.length * 0.62 : b.type === "quote" ? 2 : b.type === "visual" ? 2.2 : height(plain((b as { text?: string }).text || ""), w, 17, 1.4) + 0.2), 0);
    let y = Math.max(0.6, (H - th - 0.35 - estimate) / 2);
    slide.addText(title, { x, y, w, h: th, fontFace: ctx.head, fontSize: tpt, bold: ctx.bold, color: ctx.ink, valign: "top", margin: 0 });
    y += th + 0.35;
    for (const block of content) {
      if (y > H - 0.7) break;
      y = addBlock(slide, block, x, y, w, H - 0.5 - y, ctx);
    }
  }

  const name = `${(deck.title || deck.prompt).replace(/[^\p{L}\p{N} .,&'-]+/gu, "").trim().slice(0, 80) || "Deck"}.pptx`;
  await pptx.writeFile({ fileName: name });
  return name;
}
