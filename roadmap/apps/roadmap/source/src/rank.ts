// The ranking, the same rules as the `roadmap_rank` function (its
// `# roadmap:rank` block): change both. The app ranks the rows it already
// reads so sorting, filtering and moving an item answer at once, and the
// demo works on its sample with no server.
//
// Per active feature (not about a rival's product):
// - people: distinct handle_kind:handle across its quotes and its asks (asks
//   about the feature itself, or about its own linked work); anonymous quotes
//   count as quotes, not people; two handles of one person count twice;
// - companies; blockers: companies with a quote marked blocker;
// - open / won: the sums of those companies' open and won deals, per
//   currency, never converted; sorting by money uses the main currency;
// - last asked, quotes, stage, and the team's horizon.

import type { Ask, Company, Deal, Feature, Heard, Horizon, Importance, Item, Product, Progress, Spec, Stage } from "./types";

export const IMPORTANCE: Record<Importance, number> = { blocker: 3, important: 2, nice: 1, unknown: 0 };
export const COUNTED_ASKS = ["open", "declined", "shipped", "told"];
const TELL_ASKS = ["open", "shipped"];
const HORIZON_ORDER: Record<Horizon, number> = { now: 0, next: 1, later: 2, shipped: 3, none: 4 };
const STAGE_RANK: Record<string, number> = { building: 5, beta: 4, planned: 3, idea: 2, live: 1, declined: 0 };

export type SortKey = "people" | "companies" | "blockers" | "open" | "won" | "last_asked" | "quotes" | "stage" | "horizon";

export interface Row {
  id: string;
  name: string;
  area: string;
  description: string | null;
  stage: Stage;
  parent_id: string | null;
  people: number;
  companies: number;
  blockers: number;
  quotes: number;
  last_asked: string | null;
  tell: number;
  open: Record<string, number>;
  won: Record<string, number>;
  open_main: number;
  won_main: number;
  company_ids: string[];
  horizon: Horizon;
  item: Item | null;
  progress: (Progress & { name: string | null; state: string }) | null;
  moved_days: number | null;
  stale: boolean;
  spec: Spec | null;
}

export interface Suggested { id: string; name: string; quotes: number; companies: number }

export interface Inputs {
  currency: string;
  staleDays: number;
  features: Feature[];
  products: Product[];
  heard: Heard[];
  asks: Ask[];
  deals: Deal[];
  items: Item[];
  specs: Spec[];
  progress: Progress[];
  projects: { id: string; name: string; state: string }[];
  /** Count only what was said or asked since this moment. */
  since?: string | null;
}

export function whoKey(kind: string | null | undefined, handle: string | null | undefined): string | null {
  if (!handle) return null;
  return `${String(kind || "other").trim().toLowerCase()}:${String(handle).trim().toLowerCase()}`;
}

function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function areaOf(f: Feature, byId: Map<string, Feature>): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let parent = f.parent_id;
  while (parent && byId.has(parent) && !seen.has(parent) && names.length < 3) {
    seen.add(parent);
    const p = byId.get(parent)!;
    names.push(p.name);
    parent = p.parent_id;
  }
  return names.reverse().join(" › ");
}

/** Every active feature's numbers, and the suggested ones with quotes. */
export function rank(inp: Inputs): { rows: Row[]; suggested: Suggested[]; byId: Map<string, Feature> } {
  const main = inp.currency;
  const rival = new Set(inp.products.filter((p) => p.role === "rival").map((p) => p.id));
  const byId = new Map(inp.features.map((f) => [f.id, f]));
  const mine = inp.features.filter((f) => !(f.product_id && rival.has(f.product_id)));
  const active = mine.filter((f) => f.state === "active");
  const suggested = mine.filter((f) => f.state === "suggested");
  const since = inp.since || null;
  const heardBy = new Map<string, Heard[]>();
  for (const h of inp.heard) {
    if (h.state === "set_aside" || (h.product_id && rival.has(h.product_id))) continue;
    if (since && String(h.said_at) < since) continue;
    const list = heardBy.get(h.feature_id) || [];
    list.push(h);
    heardBy.set(h.feature_id, list);
  }
  const works = new Map<string, string>();
  for (const f of active) {
    works.set(`feature|${f.id}`, f.id);
    if (f.work_source && f.work_id) works.set(`${f.work_source}|${f.work_id}`, f.id);
  }
  const asksBy = new Map<string, Ask[]>();
  for (const a of inp.asks) {
    if (!COUNTED_ASKS.includes(a.state)) continue;
    if (since && String(a.asked_at) < since) continue;
    const fid = works.get(`${a.work_source}|${a.work_id}`);
    if (!fid) continue;
    const list = asksBy.get(fid) || [];
    list.push(a);
    asksBy.set(fid, list);
  }
  const dealsBy = new Map<string, Deal[]>();
  for (const d of inp.deals) {
    if (!d.company_id || (d.status !== "open" && d.status !== "won")) continue;
    const list = dealsBy.get(d.company_id) || [];
    list.push(d);
    dealsBy.set(d.company_id, list);
  }
  const items = new Map(inp.items.map((i) => [i.id, i]));
  const specs = new Map(inp.specs.map((s) => [s.id, s]));
  const progress = new Map(inp.progress.map((p) => [p.project_id, p]));
  const projects = new Map(inp.projects.map((p) => [p.id, p]));
  const rows: Row[] = active.map((f) => {
    const heard = heardBy.get(f.id) || [];
    const asks = asksBy.get(f.id) || [];
    const people = new Set<string>();
    const tell = new Set<string>();
    const companies = new Set<string>();
    const blockers = new Set<string>();
    let last: string | null = null;
    for (const h of heard) {
      if (!last || String(h.said_at) > last) last = String(h.said_at);
      const k = whoKey(h.handle_kind, h.handle);
      if (k) people.add(k);
      if (h.company_id) {
        companies.add(h.company_id);
        if (h.importance === "blocker") blockers.add(h.company_id);
      }
    }
    for (const a of asks) {
      if (!last || String(a.asked_at) > last) last = String(a.asked_at);
      const k = whoKey(a.handle_kind, a.handle);
      if (k) {
        people.add(k);
        if (TELL_ASKS.includes(a.state)) tell.add(k);
      }
      if (a.company_id) companies.add(a.company_id);
    }
    const open: Record<string, number> = {};
    const won: Record<string, number> = {};
    for (const c of companies) {
      for (const d of dealsBy.get(c) || []) {
        const cur = String(d.currency || main).toUpperCase().slice(0, 3);
        const pot = d.status === "open" ? open : won;
        pot[cur] = (pot[cur] || 0) + Number(d.amount || 0);
      }
    }
    const item = items.get(f.id) || null;
    const horizon = (item?.horizon || "none") as Horizon;
    const p = item?.project_id ? progress.get(item.project_id) : undefined;
    const proj = item?.project_id ? projects.get(item.project_id) : undefined;
    const prog = item?.project_id
      ? { project_id: item.project_id, total: Number(p?.total || 0), done: Number(p?.done || 0), moved: p?.moved || null,
          name: proj?.name || null, state: proj?.state || "gone" }
      : null;
    const movedDays = prog && prog.total ? daysSince(prog.moved) : null;
    const stale = horizon === "now" && movedDays !== null && movedDays >= inp.staleDays && !!prog && prog.done < prog.total;
    return {
      id: f.id, name: f.name, area: areaOf(f, byId), description: f.description, stage: f.stage || "idea", parent_id: f.parent_id,
      people: people.size, companies: companies.size, blockers: blockers.size, quotes: heard.length, last_asked: last,
      tell: tell.size, open, won, open_main: open[main] || 0, won_main: won[main] || 0, company_ids: [...companies].sort(),
      horizon, item, progress: prog, moved_days: movedDays, stale, spec: specs.get(f.id) || null,
    };
  });
  const sugg: Suggested[] = suggested
    .map((f) => {
      const hs = heardBy.get(f.id) || [];
      return { id: f.id, name: f.name, quotes: hs.length, companies: new Set(hs.map((h) => h.company_id).filter(Boolean)).size };
    })
    .filter((s) => s.quotes > 0)
    .sort((a, b) => b.quotes - a.quotes || b.companies - a.companies);
  return { rows, suggested: sugg, byId };
}

/** A live feature nobody asked about is an area, not a request: left off the list. */
export function listed(r: Row): boolean {
  return r.people > 0 || r.quotes > 0 || r.horizon !== "none" || r.stage !== "live";
}

export function notPlanned(r: Row): boolean {
  return r.horizon === "none" && (r.stage === "idea" || r.stage === "planned");
}

export function sortRows(rows: Row[], by: SortKey, desc = true): Row[] {
  const first = (r: Row): number | string => {
    switch (by) {
      case "stage": return STAGE_RANK[r.stage] ?? 0;
      case "horizon": return -HORIZON_ORDER[r.horizon];
      case "last_asked": return r.last_asked || "";
      case "open": return r.open_main;
      case "won": return r.won_main;
      default: return r[by];
    }
  };
  const cmp = (x: number | string, y: number | string) => (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)));
  const out = [...rows].sort((a, b) =>
    cmp(first(b), first(a)) || b.people - a.people || b.companies - a.companies
    || String(b.last_asked || "").localeCompare(String(a.last_asked || "")) || a.name.localeCompare(b.name));
  return desc ? out : out.reverse();
}

/* ---------- saying it ---------- */

const SIGN: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥", AUD: "A$", CAD: "C$" };

/** "$62k", "€1.2M": a column's figure, cut, never rounded up. */
export function moneyShort(amount: number, currency: string): string {
  const sign = SIGN[currency] || "";
  const a = Math.max(0, amount);
  const text = a >= 1_000_000 ? `${Math.floor(a / 100_000) / 10}M` : a >= 1000 ? `${Math.floor(a / 1000)}k` : `${Math.floor(a)}`;
  return sign ? `${sign}${text}` : `${text} ${currency}`;
}

/** The main currency first, the others added: "$62k + €12k". Null when there is none. */
export function moneySaid(by: Record<string, number>, main: string): string | null {
  const keys = Object.keys(by).filter((k) => by[k]).sort((a, b) => (a === main ? -1 : b === main ? 1 : a.localeCompare(b)));
  return keys.length ? keys.map((k) => moneyShort(by[k], k)).join(" + ") : null;
}

export const STAGE_WORD: Record<Stage, string> = {
  idea: "Idea", planned: "Planned", building: "Building", beta: "Beta", live: "Live", declined: "Declined",
};
export const STAGE_TONE: Record<Stage, "plain" | "info" | "warning" | "success"> = {
  idea: "plain", planned: "info", building: "warning", beta: "warning", live: "success", declined: "plain",
};
export const HORIZON_WORD: Record<Horizon, string> = { none: "Not planned", now: "Now", next: "Next", later: "Later", shipped: "Shipped" };
export const IMPORTANCE_WORD: Record<Importance, string> = { blocker: "Blocker", important: "Important", nice: "Nice", unknown: "Said" };
export const IMPORTANCE_TONE: Record<Importance, "danger" | "warning" | "plain"> = { blocker: "danger", important: "warning", nice: "plain", unknown: "plain" };
