// A deck's look: its colours, type and logo, from the Lemma's brand or a theme.
// The slides are the deck's own renderer, so they draw in the deck's look;
// the app around them stays on the kit's --c-* roles.

import { useEffect, useState, type CSSProperties } from "react";
import { client } from "@lemma-plugins/kit";
import type { BrandRow, Look, Theme } from "./types";

export const FALLBACK: Look = {
  source: "theme", name: "Paper", surface: "#FBFAF7", raised: "#F1EEE7", ink: "#1C1B19", muted: "#67635B",
  accent: "#C2410C", accent_ink: "#FFFFFF", heading_font: "Source Serif 4", body_font: "Inter",
  heading_office: "Georgia", body_office: "Arial", radius: "10px", dark: false,
};

const GOOGLE = new Set(["Inter", "Source Serif 4", "Space Grotesk", "Fraunces", "DM Sans", "DM Serif Display", "Manrope",
  "IBM Plex Sans", "IBM Plex Serif", "Playfair Display", "Lora", "Poppins", "Montserrat", "Work Sans", "Outfit", "Albert Sans"]);

export function lookOf(look: Partial<Look> | null | undefined): Look {
  return { ...FALLBACK, ...(look || {}) } as Look;
}

export function themeLook(theme: Theme): Look {
  return lookOf({ ...theme.tokens, source: "theme", theme_id: theme.id, name: theme.name });
}

function stack(family: string, given: string | null | undefined, serif: boolean): string {
  if (given) return given;
  return `"${family}", ${serif ? "Georgia, serif" : "ui-sans-serif, system-ui, -apple-system, Helvetica, Arial, sans-serif"}`;
}

const serifish = (f: string) => /serif|fraunces|georgia|lora|playfair|garamond|times/i.test(f) && !/sans/i.test(f);

/** CSS custom properties the slide renderer reads. */
export function lookVars(raw: Partial<Look> | null | undefined): CSSProperties {
  const t = lookOf(raw);
  return {
    "--sl-surface": t.surface,
    "--sl-raised": t.raised,
    "--sl-ink": t.ink,
    "--sl-muted": t.muted,
    "--sl-accent": t.accent,
    "--sl-accent-ink": t.accent_ink || "#FFFFFF",
    "--sl-heading": stack(t.heading_font, t.heading_stack, serifish(t.heading_font)),
    "--sl-body": stack(t.body_font, t.body_stack, serifish(t.body_font)),
    "--sl-radius": t.radius || "10px",
    "--sl-heading-weight": String(t.heading_weight ?? 600),
  } as CSSProperties;
}

const loaded = new Set<string>();
/** Load the look's fonts from Google Fonts, once each, when they are there.
 *  Only the weights the look uses: asking Google for a weight a family lacks
 *  (DM Serif Display has only 400) fails the whole stylesheet. */
export function useLookFonts(raw: Partial<Look> | null | undefined): void {
  const t = lookOf(raw);
  const heading = t.heading_weight ?? 600;
  const wanted: [string, boolean, number[]][] = [
    [t.heading_font, t.heading_google ?? GOOGLE.has(t.heading_font), [heading]],
    [t.body_font, t.body_google ?? GOOGLE.has(t.body_font), t.source === "theme" ? [400, 600] : [400]],
  ];
  const key = wanted.map(([f, g, w]) => `${f}:${g}:${w.join(",")}`).join("|");
  useEffect(() => {
    const byFamily = new Map<string, Set<number>>();
    for (const [family, google, weights] of wanted) {
      if (!google || !family) continue;
      const set = byFamily.get(family) || new Set<number>();
      weights.forEach((w) => set.add(w));
      byFamily.set(family, set);
    }
    for (const [family, weights] of byFamily) {
      const spec = [...weights].sort((a, b) => a - b).join(";");
      const id = `${family}:${spec}`;
      if (loaded.has(id)) continue;
      loaded.add(id);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${spec}&display=swap`;
      document.head.appendChild(link);
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ---------- colours ---------- */

let probe: CanvasRenderingContext2D | null = null;
/** Any CSS colour as #RRGGBB (for PowerPoint); the fallback when it can't be read. */
export function hex(color: string | null | undefined, fallback = "#000000"): string {
  if (!color) return fallback;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) return ("#" + color.slice(1).split("").map((c) => c + c).join("")).toUpperCase();
  try {
    probe = probe || document.createElement("canvas").getContext("2d");
    if (!probe) return fallback;
    probe.fillStyle = "#000";
    probe.fillStyle = color;
    const out = String(probe.fillStyle);
    if (out.startsWith("#")) return out.toUpperCase();
    const m = out.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  } catch {
    /* fall through */
  }
  return fallback;
}

export function isDark(color: string): boolean {
  const h = hex(color, "#FFFFFF").slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45;
}

/* ---------- the brand ---------- */

function family(stackText: string | undefined | null): string | null {
  if (!stackText) return null;
  const first = stackText.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first || null;
}

/** Brand kit's row as a deck's look. Never invents a colour or a font: what
 *  the row lacks falls back to a neutral, never to something made up. */
export function brandLook(b: BrandRow): Look {
  const tokens = b.tokens || {};
  const colors = Array.isArray(b.colors) ? b.colors : [];
  const role = (r: string) => colors.find((c) => c.role === r)?.value || null;
  const fonts = b.fonts || {};
  const display = fonts.display || fonts.heading || {};
  const body = fonts.body || fonts.text || {};
  const surface = tokens["--brand-surface"] || role("surface") || "#FFFFFF";
  const ink = tokens["--brand-ink"] || role("ink") || (isDark(surface) ? "#F5F5F5" : "#111111");
  const heading = display.family || family(tokens["--brand-font-display"]) || "Inter";
  const bodyFamily = body.family || family(tokens["--brand-font-body"]) || heading;
  const logos = Array.isArray(b.logos) ? b.logos : [];
  const dark = isDark(surface);
  const pick = (variant: string) => logos.find((l) => l.variant === variant)?.path || null;
  return {
    source: "brand", brand_id: b.id, name: b.name,
    surface, ink,
    raised: tokens["--brand-surface-2"] || role("surface_2") || (dark ? "#202020" : "#F4F4F4"),
    muted: tokens["--brand-muted"] || role("muted") || ink,
    accent: tokens["--brand-accent"] || role("accent") || ink,
    accent_ink: tokens["--brand-accent-ink"] || role("accent_ink") || (isDark(tokens["--brand-accent"] || role("accent") || ink) ? "#FFFFFF" : "#111111"),
    heading_font: heading, body_font: bodyFamily,
    heading_stack: display.stack || tokens["--brand-font-display"] || null,
    body_stack: body.stack || tokens["--brand-font-body"] || null,
    heading_google: display.source === "google", body_google: body.source === "google",
    heading_weight: typeof display.weight === "number" ? display.weight : null,
    heading_office: heading, body_office: bodyFamily,
    radius: tokens["--brand-radius"] || "12px",
    logo_path: (dark ? pick("inverse") : null) || b.logo_path || pick("primary") || pick("mark"),
    logo_inverse_path: pick("inverse"),
    dark,
  };
}

/* ---------- logos ---------- */

const urls = new Map<string, Promise<string | null>>();
/** A pod file as an object URL, read once a page. */
export function fileUrl(path: string): Promise<string | null> {
  if (!urls.has(path)) {
    urls.set(path, client.files.download(path).then((blob) => URL.createObjectURL(blob)).catch(() => null));
  }
  return urls.get(path)!;
}

export function useFileUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!path) {
      setUrl(null);
      return;
    }
    void fileUrl(path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}
