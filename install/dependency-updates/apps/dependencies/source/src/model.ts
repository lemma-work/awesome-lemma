// What the screens say, worked out once: the week's sections, the dates a
// release joins, and the status line.

import type { Batch, Repo, Settings, Update } from "./types";

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
export const WEEKDAY_LONG: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function short(repo: string): string {
  return repo.split("/").pop() || repo;
}

export function change(u: Pick<Update, "from_version" | "to_version">): string {
  return u.from_version ? `${u.from_version} → ${u.to_version}` : u.to_version;
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The wall clock in a zone: its date and weekday, as plain numbers. */
function wall(at: Date, zone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), wd: DAY_NAMES.indexOf(get("weekday")), h: Number(get("hour")) % 24, min: Number(get("minute")) };
  } catch {
    return { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate(), wd: at.getDay(), h: at.getHours(), min: at.getMinutes() };
  }
}

function dateLabel(y: number, m: number, d: number): string {
  const day = new Date(Date.UTC(y, m - 1, d));
  return `${DAY_NAMES[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
}

/** The next weekly batch: "Mon 30 Nov, 06:00", in the set-up's zone. */
export function nextBatch(s: Settings, now = new Date()): string {
  const w = wall(now, s.timezone || "UTC");
  const [hh, mm] = (s.run_time || "06:00").split(":").map(Number);
  let ahead = ((WEEKDAY_INDEX[s.weekday] ?? 1) - w.wd + 7) % 7;
  if (ahead === 0 && (w.h > hh || (w.h === hh && w.min >= mm))) ahead = 7;
  const day = new Date(Date.UTC(w.y, w.m - 1, w.d + ahead));
  return `${dateLabel(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate())}, ${s.run_time || "06:00"}`;
}

const DAY_MS = 86400000;

export function waitOf(u: Update, s: Settings | null): number {
  return u.bump === "major" ? (s?.wait_major_days ?? 14) : (s?.wait_days ?? 3);
}

/** How long it has been out, in words: "out today", "out 2 days", "out 9 hours". */
export function outFor(u: Update, now = Date.now()): string {
  if (!u.released_at) return "";
  const ms = now - new Date(u.released_at).getTime();
  if (ms < DAY_MS) {
    const h = Math.max(1, Math.floor(ms / 3600000));
    return `out ${plural(h, "hour")}`;
  }
  return `out ${plural(Math.floor(ms / DAY_MS), "day")}`;
}

/** Age as a column: "9 h", "6 days", "21 days". */
export function age(u: Update, now = Date.now()): string {
  if (!u.released_at) return "";
  const ms = now - new Date(u.released_at).getTime();
  if (ms < DAY_MS) return `${Math.max(1, Math.floor(ms / 3600000))} h`;
  return plural(Math.floor(ms / DAY_MS), "day");
}

/** The batch a waiting release joins: the first batch day on or after its wait ends. */
export function joins(u: Update, s: Settings | null): string {
  if (!u.released_at || !s) return "";
  const ready = new Date(new Date(u.released_at).getTime() + waitOf(u, s) * DAY_MS);
  const w = wall(ready, s.timezone || "UTC");
  const ahead = ((WEEKDAY_INDEX[s.weekday] ?? 1) - w.wd + 7) % 7;
  const day = new Date(Date.UTC(w.y, w.m - 1, w.d + ahead));
  return dateLabel(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
}

export function downloads(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e6) return `${(Math.floor(n / 1e5) / 10).toString()}M`;
  if (n >= 1e3) return `${Math.floor(n / 1e3)}k`;
  return String(n);
}

export interface Week {
  security: Update[];
  ready: Update[];
  you: Update[];
  waiting: Update[];
  risky: Update[];
  ignored: Update[];
}

export function week(updates: Update[], repo: string | null, search: string): Week {
  const q = search.trim().toLowerCase();
  const list = updates.filter((u) => (!repo || u.repo === repo) && (!q || u.package.toLowerCase().includes(q) || u.repo.toLowerCase().includes(q)));
  const openSecurity = (u: Update) => !!u.security && ["opened", "in_batch", "ready", "waiting", "needs_you", "risky"].includes(u.state);
  return {
    security: list.filter(openSecurity),
    ready: list.filter((u) => !openSecurity(u) && ["ready", "dropped", "by_hand"].includes(u.state)),
    you: list.filter((u) => !openSecurity(u) && u.state === "needs_you"),
    waiting: list.filter((u) => !openSecurity(u) && u.state === "waiting"),
    risky: list.filter((u) => !openSecurity(u) && u.state === "risky"),
    ignored: list.filter((u) => u.state === "ignored"),
  };
}

/** Counted for the repository filter: what is still to happen or open now. */
export function counted(u: Update): boolean {
  return ["waiting", "ready", "needs_you", "risky", "dropped", "by_hand", "in_batch", "opened"].includes(u.state);
}

export function lastBatch(batches: Batch[], repo: string | null): Batch | null {
  return batches.filter((b) => b.kind === "batch" && (!repo || b.repo === repo) && b.state !== "preparing")
    .sort((a, b) => String(b.opened_at || b.created_at).localeCompare(String(a.opened_at || a.created_at)))[0] || null;
}

export function repoReady(r: Repo): boolean {
  return r.status === "ok" || r.status === "private_registry";
}

export const SEVERITY_TONE: Record<string, "danger" | "warning" | "plain"> = { critical: "danger", high: "danger", moderate: "warning", medium: "warning", low: "plain" };

export function cap(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** "06:13", the wall clock of a moment in the viewer's zone. */
export function clock(at: string | null | undefined): string {
  if (!at) return "";
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "Mon 23 Nov": the viewer's own day of a moment. */
export function dayOf(at: string | null | undefined): string {
  if (!at) return "";
  const d = new Date(at);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
