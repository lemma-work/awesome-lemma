// Who asked for one feature, grouped by company: companies with a blocker
// first, then by how many people; one quote each (the strongest, then the
// newest), where it was said, and the company's deal. The same grouping as
// roadmap_feature's.

import { IMPORTANCE, moneySaid, whoKey, type Row } from "./rank";
import type { Ask, Deal, Importance, Quote } from "./types";

export interface AskerGroup {
  companyId: string | null;
  company: string;
  people: number;
  importance: Importance;
  quote: Quote | null;
  where: { source: string; at: string } | null;
  deal: string;
  dealId: string | null;
}

export function asksFor(row: Row, asks: Ask[], work: { source: string | null; id: string | null }): Ask[] {
  return asks.filter((a) => (a.work_source === "feature" && a.work_id === row.id) || (work.source && a.work_source === work.source && a.work_id === work.id));
}

export function dealText(deals: Deal[], main: string): { text: string; id: string | null } {
  const open = deals.filter((d) => d.status === "open");
  const won = deals.filter((d) => d.status === "won");
  const sum = (list: Deal[]) => {
    const by: Record<string, number> = {};
    for (const d of list) {
      const cur = String(d.currency || main).toUpperCase();
      by[cur] = (by[cur] || 0) + Number(d.amount || 0);
    }
    return moneySaid(by, main) || "";
  };
  if (open.length) return { text: `Open ${sum(open)} · ${open[0].stage || "open"}`, id: open[0].id };
  if (won.length) return { text: `Won ${sum(won)}`, id: won[0].id };
  return { text: "No deal", id: null };
}

export function askersOf(quotes: Quote[], asks: Ask[], deals: Deal[], names: Map<string, string>, main: string): AskerGroup[] {
  const groups = new Map<string, { companyId: string | null; company: string; people: Set<string>; importance: Importance; quote: Quote | null; ask: Ask | null }>();
  const group = (cid: string | null, name: string | null) => {
    const key = cid || "";
    let g = groups.get(key);
    if (!g) {
      g = { companyId: cid, company: (cid && names.get(cid)) || name || "No company", people: new Set(), importance: "unknown", quote: null, ask: null };
      groups.set(key, g);
    }
    return g;
  };
  for (const h of quotes) {
    const g = group(h.company_id, h.company_name);
    const k = whoKey(h.handle_kind, h.handle);
    if (k) g.people.add(k);
    if (IMPORTANCE[h.importance] > IMPORTANCE[g.importance]) g.importance = h.importance;
    if (!g.quote || IMPORTANCE[h.importance] > IMPORTANCE[g.quote.importance]) g.quote = h;
  }
  for (const a of asks) {
    const g = group(a.company_id, a.company_name);
    const k = whoKey(a.handle_kind, a.handle);
    if (k) g.people.add(k);
    if (!g.ask) g.ask = a;
  }
  const dealsBy = new Map<string, Deal[]>();
  for (const d of deals) if (d.company_id) dealsBy.set(d.company_id, [...(dealsBy.get(d.company_id) || []), d]);
  const out: AskerGroup[] = [...groups.values()].map((g) => {
    const d = g.companyId ? dealText(dealsBy.get(g.companyId) || [], main) : { text: "", id: null };
    const where = g.quote ? { source: g.quote.source, at: g.quote.said_at } : g.ask ? { source: g.ask.source, at: g.ask.asked_at } : null;
    return { companyId: g.companyId, company: g.company, people: g.people.size, importance: g.importance, quote: g.quote, where, deal: d.text, dealId: d.id };
  });
  return out.sort((a, b) =>
    Number(!!b.companyId) - Number(!!a.companyId) || IMPORTANCE[b.importance] - IMPORTANCE[a.importance] || b.people - a.people || a.company.localeCompare(b.company));
}
