// WCAG contrast, measured here from the colours on screen, so a number shown
// beside a pair is the pair as it is now (a fix moves it at once). The same
// formula as brand_save, which measured it when the brand was read.

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function parseHex(value: string | null | undefined): [number, number, number] | null {
  const hex = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3,4}$/i.test(hex)) return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16)) as [number, number, number];
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  return null;
}

export function luminance(value: string): number | null {
  const rgb = parseHex(value);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(ink: string, ground: string): number | null {
  const a = luminance(ink);
  const b = luminance(ground);
  if (a === null || b === null) return null;
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export function isDark(value: string): boolean {
  const l = luminance(value);
  return l !== null && l < 0.2;
}

export interface Pair {
  label: string;
  ink: string;
  ground: string;
  inkRole: string;
  groundRole: string;
  ratio: number | null;
  needs: number;
}

/** The pairs that matter, as brand_save measures them. */
export function pairs(byRole: Record<string, string>): Pair[] {
  const want: [string, string, string, number][] = [
    ["Body text on the page", "ink", "surface", 4.5],
    ["Secondary text on the page", "muted", "surface", 4.5],
    ["Body text on cards", "ink", "surface_2", 4.5],
    ["Text on the accent", "accent_ink", "accent", 4.5],
    ["The accent as text or a link", "accent", "surface", 3],
    ["Success on the page", "ok", "surface", 3],
    ["Error on the page", "bad", "surface", 3],
  ];
  return want
    .filter(([, i, g]) => byRole[i] && byRole[g])
    .map(([label, i, g, needs]) => ({ label, ink: byRole[i], ground: byRole[g], inkRole: i, groundRole: g, ratio: contrast(byRole[i], byRole[g]), needs }));
}

export function verdict(ratio: number | null, needs: number): { word: string; tone: "success" | "warning" | "danger" } {
  if (ratio === null) return { word: "Can't measure", tone: "warning" };
  if (ratio >= needs) return { word: needs >= 4.5 ? "Passes for body text" : "Passes for large text", tone: "success" };
  if (ratio >= 3) return { word: "Large text only", tone: "warning" };
  return { word: "Too faint", tone: "danger" };
}
