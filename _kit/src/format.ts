// Dates, money and names, the way every plugin app says them.

const DAY = 86_400_000;

export function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysSince(value: string | null | undefined, now = Date.now()): number | null {
  const date = parse(value);
  return date ? Math.floor((now - date.getTime()) / DAY) : null;
}

/** "now", "5 min", "3 h", "yesterday", "4 days", "3 wk", "12 Oct". */
export function ago(value: string | null | undefined, now = Date.now()): string {
  const date = parse(value);
  if (!date) return "";
  const ms = now - date.getTime();
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`;
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)} h`;
  const days = Math.floor(ms / DAY);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.floor(days / 7)} wk`;
  return day(value);
}

/** "just now", "5 min ago", "yesterday", "4 days ago", "on 12 Oct": ago() for the middle of a sentence. */
export function agoText(value: string | null | undefined, now = Date.now()): string {
  const a = ago(value, now);
  if (!a) return "";
  if (a === "now") return "just now";
  if (a === "yesterday") return a;
  return /^\d/.test(a) ? `${a} ago` : `on ${a}`;
}

/** "13 Nov", or "13 Nov 2025" when it is not this year. */
export function day(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "Today 11:00", "Tomorrow 09:30", "Thu 14:00", "21 Nov 10:00". */
export function when(value: string | null | undefined, now = new Date()): string {
  const date = parse(value);
  if (!date) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.floor((date.getTime() - start) / DAY);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  if (diff > 1 && diff < 7) return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${day(value)} ${time}`;
}

/** A due date against today: "today", "tomorrow", "by Fri", "2 days late". */
export function due(value: string | null | undefined, now = Date.now()): { text: string; late: boolean } {
  const date = parse(value);
  if (!date) return { text: "", late: false };
  const today = new Date(now);
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startDue = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startDue - startToday) / DAY);
  if (days < 0) return { text: days === -1 ? "1 day late" : `${-days} days late`, late: true };
  if (days === 0) return { text: "today", late: false };
  if (days === 1) return { text: "tomorrow", late: false };
  if (days < 7) return { text: `by ${date.toLocaleDateString(undefined, { weekday: "short" })}`, late: false };
  return { text: `by ${day(value)}`, late: false };
}

export function money(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null || Number.isNaN(Number(amount))) return "";
  const code = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 0 }).format(Number(amount));
  } catch {
    return `${code} ${Math.round(Number(amount)).toLocaleString()}`;
  }
}

/** A compact total for a column head: "€48k". */
export function moneyShort(amount: number, currency?: string | null): string {
  const code = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code, notation: "compact", maximumFractionDigits: 1 }).format(amount);
  } catch {
    return money(amount, code);
  }
}

export function nameOf(name: string | null | undefined, email?: string | null): string {
  const clean = (name || "").replace(/["']/g, "").trim();
  if (clean && !clean.includes("@")) return clean;
  const local = (email || "").split("@")[0] || "";
  return local ? local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Someone";
}

export function firstName(name: string | null | undefined, email?: string | null): string {
  return nameOf(name, email).split(/\s+/)[0];
}

export function initials(name: string | null | undefined, email?: string | null): string {
  const parts = nameOf(name, email).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** A stable, muted colour for a person or company, from their address. */
export function tint(seed: string | null | undefined): string {
  let hash = 0;
  for (const char of seed || "?") hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const hues = [12, 28, 45, 95, 150, 175, 200, 215, 250, 285, 320, 345];
  return `hsl(${hues[Math.abs(hash) % hues.length]} 32% 48%)`;
}

/** A stable hue (0-359) for a person or company, from their address: the
 *  avatar and the company mark tint by it, light or dark. */
export function hue(seed: string | null | undefined): number {
  let hash = 0;
  for (const char of seed || "?") hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const hues = [12, 28, 42, 95, 145, 172, 196, 212, 228, 330, 350, 18];
  return hues[Math.abs(hash) % hues.length];
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function domainOf(email: string | null | undefined): string {
  return (email || "").split("@")[1]?.toLowerCase() || "";
}
