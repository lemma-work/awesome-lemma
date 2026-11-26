// The app's working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). `product`, `feature`, `feedback`, `ask`, `deal` and User
// feedback's filing, listening and settings are the team's; `user_feedback_heard`
// and `user_feedback_member` are each person's own (row-level security), so this
// person sees only their own unshared sentences and choices. Counts, weeks and
// "rising" are worked out here, from those rows, so every number on screen has
// rows behind it.
//
// Writes go through functions (keep, share, note, feature, set-up), which also
// write the asks, filings and Today items that go with them.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { client, items, runFunction, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";

export type Kind = "request" | "problem" | "praise" | "question" | "comparison" | "other";
export type Importance = "unknown" | "nice" | "important" | "blocker";

export interface Product { id: string; name: string; role: "ours" | "rival"; url: string | null; aliases: string[]; keywords: string[]; active: boolean; source: string | null }
export interface Feature {
  id: string; product_id: string; name: string; description: string | null; parent_id: string | null; aliases: string[];
  state: "suggested" | "active" | "merged" | "archived"; merged_into: string | null; origin: string; stage: string; stage_at: string | null;
  owner_user_id: string | null; work_source: string | null; work_id: string | null; work_url: string | null;
}
export interface Quote {
  id: string; quote: string; point: string | null; product_id: string | null; feature_id: string | null; filed_by: string | null;
  kind: Kind; compared_with: string[]; sentiment: string | null; importance: Importance; handle_kind: string | null; handle: string | null;
  name: string | null; company_id: string | null; company_name: string | null; source: string; source_account: string | null;
  source_id: string; source_url: string | null; at_seconds: number | null; heard_by: string | null; conversation_id: string | null;
  is_public: boolean; said_at: string; state: "new" | "processed" | "set_aside"; plugin: string;
  /** From the person's own table: not shared yet. */
  mine?: boolean; role?: string | null; place?: string | null;
}
export interface Filing { id: string; options: string[]; confidence: number | null; matched: Record<string, string[]>; picked: string | null }
export interface Deal { id: string; company_id: string | null; company_name: string | null; status: string; amount: number | null; currency: string | null; stage: string }
export interface Ask { id: string; work_source: string; work_id: string; handle_kind: string; handle: string; state: string; feature_id?: string }
export interface Listen { id: string; source: string; product_id: string | null; state: string; started_at: string | null; finished_at: string | null; found: number; kept: number; records: number; error: string | null }
export interface Settings {
  id: string; products_done: boolean; features_done: boolean; filers: { user_id: string; name: string | null }[]; hn: boolean;
  hn_keywords: string[]; brightdata_account_id: string | null; brightdata_sources: string[]; brightdata_posts: number;
  brightdata_accounts: Record<string, { x?: string; linkedin?: string }>; slack_channel: string | null;
  schedules: Record<string, string>; schedule_user_id: string | null; duplicates: { a: string; b: string; confidence: number | null }[];
  kept_apart: string[][]; team_name: string | null; setup_done_at: string | null; sample: boolean;
}
export interface MemberRow { id: string; read_mail: boolean; read_meetings: boolean; auto_share: boolean; setup_done_at: string | null }
export interface Member { user_id: string; name: string; email: string }

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM user_feedback_settings LIMIT 1", tables: ["user_feedback_settings"] },
  member: { sql: "SELECT * FROM user_feedback_member LIMIT 5", tables: ["user_feedback_member"] },
  products: { sql: "SELECT * FROM product ORDER BY name LIMIT 500", tables: ["product"] },
  features: { sql: "SELECT * FROM feature ORDER BY name LIMIT 3000", tables: ["feature"] },
  feedback: { sql: "SELECT * FROM feedback ORDER BY said_at DESC LIMIT 5000", tables: ["feedback"] },
  filing: { sql: "SELECT id, options, confidence, matched, picked FROM user_feedback_filing ORDER BY filed_at DESC LIMIT 5000", tables: ["user_feedback_filing"] },
  heard: { sql: "SELECT * FROM user_feedback_heard ORDER BY said_at DESC LIMIT 1000", tables: ["user_feedback_heard"] },
  deals: { sql: "SELECT id, company_id, company_name, status, amount, currency, stage FROM deal ORDER BY amount DESC LIMIT 3000", tables: ["deal"] },
  asks: { sql: "SELECT id, work_source, work_id, handle_kind, handle, state FROM ask ORDER BY asked_at DESC LIMIT 5000", tables: ["ask"] },
  listens: { sql: "SELECT * FROM user_feedback_listen ORDER BY started_at DESC LIMIT 300", tables: ["user_feedback_listen"] },
};

export function json<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/* ---------- who ---------- */

interface Who { me: { id: string; name: string; email: string | null } | null; members: Member[] }
const WhoContext = createContext<Who>({ me: null, members: [] });

export function WhoProvider({ children }: { children: ReactNode }) {
  const [who, setWho] = useState<Who>({ me: null, members: [] });
  useEffect(() => {
    void (async () => {
      const [me, members] = await Promise.all([
        whoAmI(),
        client.podMembers.list(client.podId || "", { limit: 200 })
          .then((r) => items<{ user_id: string; user_name?: string | null; user_email?: string; email?: string }>(r))
          .catch(() => []),
      ]);
      const list: Member[] = members.map((m) => ({
        user_id: m.user_id, email: m.user_email || m.email || "",
        name: m.user_name || (m.user_email || m.email || "").split("@")[0] || "Someone",
      }));
      const self = me ? { id: me.id, email: me.email, name: list.find((m) => m.user_id === me.id)?.name || me.name || (me.email || "").split("@")[0] || "You" } : null;
      setWho({ me: self, members: list });
    })();
  }, []);
  return <WhoContext.Provider value={who}>{children}</WhoContext.Provider>;
}

export function useWho(): Who {
  return useContext(WhoContext);
}

/* ---------- the working set ---------- */

const DAY = 86_400_000;

export function useUF() {
  const { loaded, errors, reload } = useData();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const memberRows = useRows<Record<string, unknown>>("member");
  const productRows = useRows<Record<string, unknown>>("products");
  const featureRows = useRows<Record<string, unknown>>("features");
  const feedbackRows = useRows<Record<string, unknown>>("feedback");
  const filingRows = useRows<Record<string, unknown>>("filing");
  const heardRows = useRows<Record<string, unknown>>("heard");
  const dealRows = useRows<Record<string, unknown>>("deals");
  const askRows = useRows<Ask>("asks");
  const listenRows = useRows<Record<string, unknown>>("listens");
  return useMemo(() => {
    const s = settingsRows[0];
    const settings: Settings | null = s ? {
      ...(s as unknown as Settings),
      filers: json(s.filers, []), hn_keywords: json(s.hn_keywords, []), brightdata_sources: json(s.brightdata_sources, []),
      brightdata_accounts: json(s.brightdata_accounts, {}), schedules: json(s.schedules, {}), duplicates: json(s.duplicates, []),
      kept_apart: json(s.kept_apart, []), hn: s.hn !== false, sample: !!s.sample, brightdata_posts: Number(s.brightdata_posts || 10),
    } : null;
    const member = (memberRows[0] as unknown as MemberRow) || null;
    const products: Product[] = productRows.map((p) => ({ ...(p as unknown as Product), aliases: json(p.aliases, []), keywords: json(p.keywords, []), active: p.active !== false }));
    const productById = new Map(products.map((p) => [p.id, p]));
    const features: Feature[] = featureRows.map((f) => ({ ...(f as unknown as Feature), aliases: json(f.aliases, []) }));
    const featureById = new Map(features.map((f) => [f.id, f]));
    const shape = (r: Record<string, unknown>, mine = false): Quote => ({
      ...(r as unknown as Quote), compared_with: json(r.compared_with, []), is_public: !!r.is_public, mine,
      at_seconds: r.at_seconds == null ? null : Number(r.at_seconds),
      importance: ((r.importance as string) || "unknown") as Importance, kind: ((r.kind as string) || "other") as Kind,
    });
    const quotes = feedbackRows.map((r) => shape(r));
    const heard = heardRows.filter((r) => r.share_state === "unshared").map((r) => ({
      ...shape(r, true), state: "new" as const, heard_by: null, is_public: false,
    }));
    const filing = new Map<string, Filing>();
    for (const r of filingRows) filing.set(r.id as string, { id: r.id as string, options: json(r.options, []), confidence: r.confidence == null ? null : Number(r.confidence), matched: json(r.matched, {}), picked: (r.picked as string) || null });
    for (const r of heardRows) filing.set(r.id as string, { id: r.id as string, options: json(r.options, []), confidence: r.confidence == null ? null : Number(r.confidence), matched: json(r.matched, {}), picked: (r.feature_id as string) || null });
    const deals: Deal[] = dealRows.map((d) => ({ ...(d as unknown as Deal), amount: d.amount == null ? null : Number(d.amount) }));
    const listens: Listen[] = listenRows.map((l) => ({ ...(l as unknown as Listen), found: Number(l.found || 0), kept: Number(l.kept || 0), records: Number(l.records || 0) }));
    // A company's deal: the open one with the most money, else the won one.
    const dealOf = new Map<string, Deal>();
    for (const d of deals) {
      if (!d.company_id || (d.status !== "open" && d.status !== "won")) continue;
      const have = dealOf.get(d.company_id);
      if (!have || (have.status !== "open" && d.status === "open") || (have.status === d.status && (d.amount || 0) > (have.amount || 0))) dealOf.set(d.company_id, d);
    }
    return {
      loaded, errors, reload, settings, member, products, productById, features, featureById, quotes, heard, filing,
      deals, dealOf, asks: askRows, listens, sample: !!settings?.sample, hasDeals: deals.length > 0,
    };
  }, [loaded, errors, reload, settingsRows, memberRows, productRows, featureRows, feedbackRows, filingRows, heardRows, dealRows, askRows, listenRows]);
}

export type UF = ReturnType<typeof useUF>;

/* ---------- words and numbers, worked out the same way everywhere ---------- */

export const KIND_WORD: Record<Kind, string> = { request: "Request", problem: "Problem", praise: "Praise", question: "Question", comparison: "Comparison", other: "Other" };
export const KIND_TONE: Record<Kind, "info" | "warning" | "success" | "plain"> = { request: "info", problem: "warning", praise: "success", question: "plain", comparison: "plain", other: "plain" };
export const IMP_WORD: Record<Importance, string> = { unknown: "Not said", nice: "Nice to have", important: "Important", blocker: "Blocker" };
export const SOURCE_WORD: Record<string, string> = {
  mail: "Mail", meeting: "Meeting", note: "Note", slack: "Slack", teams: "Teams", form: "Form", survey: "Survey", interview: "Interview",
  hn: "Hacker News", reddit: "Reddit", x: "X", youtube: "YouTube", tiktok: "TikTok", linkedin: "LinkedIn", review: "Review", web: "Web",
};
const PUBLIC_WHO: Record<string, string> = {
  hn: "A Hacker News commenter", reddit: "A Reddit user", youtube: "A YouTube reviewer", x: "Someone on X", tiktok: "A TikTok creator",
  linkedin: "Someone on LinkedIn", review: "A reviewer", web: "Someone on the web",
};

export function clock(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** "Head of Finance, Halden Logistics", or "A Hacker News commenter". */
export function whoSaid(q: Quote, uf: UF): string {
  if (q.is_public) {
    const base = q.name && !q.name.startsWith("sample-") ? `${q.name} on ${SOURCE_WORD[q.source] || q.source}` : PUBLIC_WHO[q.source] || "Someone in public";
    const about = q.product_id ? uf.productById.get(q.product_id) : null;
    return about?.role === "rival" ? `${base}, about ${about.name}` : base;
  }
  const name = q.name || q.handle || "Someone";
  return q.company_name && !name.includes(q.company_name) ? `${name}, ${q.company_name}` : name;
}

/** Where, short: "Mail", "Meeting at 14:32", "Hacker News", "YouTube, at 6:41". */
export function whereSaid(q: Quote, me: string | null): string {
  const src = SOURCE_WORD[q.source] || q.source;
  const yours = q.mine || (me && q.heard_by === me);
  if (q.source === "meeting") return `${yours ? "Your meeting" : "Meeting"}${q.at_seconds != null ? ` at ${clock(q.at_seconds)}` : ""}`;
  if (q.source === "mail") return yours ? "Your mail" : "Mail, shared by a colleague";
  if (q.source === "note") return "A note";
  return q.at_seconds != null ? `${src}, at ${clock(q.at_seconds)}` : src;
}

export function parentOf(f: Feature | undefined | null, uf: UF): Feature | null {
  return f?.parent_id ? uf.featureById.get(f.parent_id) || null : null;
}

/** The feature a quote is under now, following a merge. */
export function featureOf(q: Quote, uf: UF): Feature | null {
  let f = q.feature_id ? uf.featureById.get(q.feature_id) || null : null;
  for (let i = 0; f && f.state === "merged" && f.merged_into && i < 4; i++) f = uf.featureById.get(f.merged_into) || f;
  return f;
}

export function weekStart(now = Date.now()): number {
  return now - 7 * DAY;
}

/** Counts per week, oldest first: weeks[7] is the last 7 days. */
export function weekly(list: Quote[], weeks = 8, now = Date.now()): number[] {
  const out = new Array(weeks).fill(0);
  for (const q of list) {
    const age = Math.floor((now - new Date(q.said_at).getTime()) / (7 * DAY));
    if (age >= 0 && age < weeks) out[weeks - 1 - age] += 1;
  }
  return out;
}

export function people(list: Quote[]): number {
  return new Set(list.map((q) => (q.handle ? `${q.handle_kind}:${q.handle}` : `q:${q.id}`))).size;
}

export function companies(list: Quote[]): number {
  return new Set(list.filter((q) => q.company_id || q.company_name).map((q) => q.company_id || q.company_name)).size;
}

/** The word alone, for a count shown beside it: word(3, "quote") is "quotes". */
export function word(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

export function since(days: number, now = Date.now()): number {
  return now - days * DAY;
}

/* ---------- writes ---------- */

type Out = { message?: string } & Record<string, unknown>;

export async function call(name: string, input: Record<string, unknown>): Promise<Out> {
  return ((await runFunction<Out>(name, input)) as Out) || {};
}

export function narrowNow(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
}

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(narrowNow);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
