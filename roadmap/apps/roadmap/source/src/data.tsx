// The app's working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider), ranked here (rank.ts) with the rules `roadmap_rank` uses.
// Writes go through Roadmap's functions (roadmap_set, roadmap_ship,
// roadmap_project, roadmap_spec_save_edit, roadmap_setup_save), so feature
// stages move forward only and the outside page follows; a new feature is one
// `feature` row, written here as the person.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO, client, create, items, q, runFunction, update, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import { rank, type Row, type Suggested } from "./rank";
import type { Ask, Company, Deal, Feature, Heard, Item, Member, Product, Progress, Project, Quote, Settings, Spec } from "./types";

/** Every row of a read, a page at a time: one read returns at most 1,000. */
async function all<T>(sql: string, most = 20000): Promise<T[]> {
  const out: T[] = [];
  for (;;) {
    const got = await q<T>(`${sql} LIMIT 1000 OFFSET ${out.length}`);
    out.push(...got);
    if (got.length < 1000 || out.length >= most) return out;
  }
}

export const COUNTED = "('open', 'declined', 'shipped', 'told')";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM roadmap_settings ORDER BY created_at LIMIT 1", tables: ["roadmap_settings"] },
  features: {
    load: () => all("SELECT id, name, description, parent_id, state, stage, stage_at, owner_user_id, product_id, work_source, work_id FROM feature ORDER BY name"),
    tables: ["feature"],
  },
  products: { sql: "SELECT id, name, role FROM product ORDER BY name LIMIT 1000", tables: ["product"] },
  heard: {
    load: () => all("SELECT id, feature_id, product_id, handle_kind, handle, name, company_id, company_name, importance, said_at, source, state " +
      "FROM feedback WHERE feature_id IS NOT NULL AND state <> 'set_aside' ORDER BY said_at DESC"),
    tables: ["feedback"],
  },
  asks: {
    load: () => all(`SELECT id, work_source, work_id, handle_kind, handle, name, company_id, company_name, asked_at, state, source FROM ask WHERE state IN ${COUNTED} ORDER BY asked_at DESC`),
    tables: ["ask"],
  },
  deals: { load: () => all("SELECT id, name, company_id, status, stage, amount, currency FROM deal WHERE status IN ('open', 'won') ORDER BY amount DESC"), tables: ["deal"] },
  companies: { load: () => all("SELECT id, name, domain FROM company ORDER BY name"), tables: ["company"] },
  items: { sql: "SELECT * FROM roadmap_item LIMIT 1000", tables: ["roadmap_item"] },
  specs: {
    sql: "SELECT id, path, version, state, drafted_at, updated_at, error, quotes_used, quotes_total, unsourced, edited FROM roadmap_spec LIMIT 1000",
    tables: ["roadmap_spec"],
  },
  progress: {
    sql: "SELECT project_id, COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done, MAX(updated_at) AS moved " +
      "FROM task WHERE project_id IS NOT NULL AND status <> 'canceled' GROUP BY project_id LIMIT 1000",
    tables: ["task"],
  },
  projects: { sql: "SELECT id, name, state FROM project ORDER BY name LIMIT 1000", tables: ["project"] },
  unchecked: { sql: "SELECT COUNT(*) AS n FROM feedback WHERE state = 'new'", tables: ["feedback"] },
  sample: { sql: "SELECT COUNT(*) AS n FROM roadmap_sample_row", tables: ["roadmap_sample_row"] },
};

interface Who {
  me: { id: string; name: string; email: string | null } | null;
  members: Member[];
}

const WhoContext = createContext<Who>({ me: null, members: [] });

/** Who is signed in and who else is in the Lemma: read once. */
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

function json<T>(value: unknown, fallback: T): T {
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

export const WINDOWS = [
  { id: "90", label: "Asked in the last 90 days", days: 90 },
  { id: "30", label: "Asked in the last 30 days", days: 30 },
  { id: "365", label: "Asked in the last year", days: 365 },
  { id: "all", label: "Asked any time", days: 0 },
] as const;
export type WindowId = (typeof WINDOWS)[number]["id"];

/** Everything the screens read, ranked. */
export function useRoadmap(windowId: WindowId = "all") {
  const { loaded, errors, reload } = useData();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const features = useRows<Feature>("features");
  const products = useRows<Product>("products");
  const heard = useRows<Heard>("heard");
  const asks = useRows<Ask>("asks");
  const deals = useRows<Deal>("deals");
  const companies = useRows<Company>("companies");
  const itemRows = useRows<Item>("items");
  const specRows = useRows<Spec>("specs");
  const progress = useRows<Progress>("progress");
  const projects = useRows<Project>("projects");
  const unchecked = useRows<{ n: number | string }>("unchecked");
  const sampleRows = useRows<{ n: number | string }>("sample");
  return useMemo(() => {
    const raw = settingsRows[0];
    const settings = raw ? ({ ...(raw as unknown as Settings), stale_days: Number(raw.stale_days || 14) } as Settings) : null;
    const currency = String(settings?.currency || "USD").toUpperCase();
    const w = WINDOWS.find((x) => x.id === windowId);
    const since = w && w.days ? new Date(Date.now() - w.days * 86_400_000).toISOString() : null;
    const base = {
      currency, staleDays: Number(settings?.stale_days || 14), features, products, heard, asks,
      deals: deals.map((d) => ({ ...d, amount: d.amount == null ? null : Number(d.amount) })),
      items: itemRows.map((i) => ({ ...i, public: i.public === true || (i.public as unknown) === "true" })),
      specs: specRows, projects,
      progress: progress.map((p) => ({ ...p, total: Number(p.total || 0), done: Number(p.done || 0) })),
    };
    const ranked = rank({ ...base, since });
    const companyNames = new Map(companies.map((c) => [c.id, c.name]));
    return {
      loaded, errors, reload, settings, currency, ranked, rows: ranked.rows as Row[], suggested: ranked.suggested as Suggested[],
      byId: ranked.byId, companies, companyNames, deals: base.deals, asks, heard, projects, products,
      unchecked: Number(unchecked[0]?.n || 0), sample: Number(sampleRows[0]?.n || 0) > 0,
    };
  }, [loaded, errors, reload, settingsRows, features, products, heard, asks, deals, companies, itemRows, specRows, progress, projects, unchecked, sampleRows, windowId]);
}

export type Data = ReturnType<typeof useRoadmap>;

/* ---------- one feature's page ---------- */

const QUOTE_FIELDS = "id, feature_id, product_id, quote, point, kind, importance, handle_kind, handle, name, company_id, company_name, source, source_url, said_at, state";

export async function quotesOf(featureId: string): Promise<Quote[]> {
  return q<Quote>(`SELECT ${QUOTE_FIELDS} FROM feedback WHERE feature_id = '${featureId.replace(/'/g, "''")}' AND state <> 'set_aside' ORDER BY said_at DESC LIMIT 500`);
}

export async function quoteById(id: string): Promise<Quote | null> {
  const got = await q<Quote>(`SELECT ${QUOTE_FIELDS} FROM feedback WHERE id = '${id.replace(/'/g, "''")}'`);
  return got[0] || null;
}

export async function specOf(featureId: string): Promise<Spec | null> {
  const got = await q<Record<string, unknown>>(`SELECT * FROM roadmap_spec WHERE id = '${featureId.replace(/'/g, "''")}'`);
  const r = got[0];
  if (!r) return null;
  return { ...(r as unknown as Spec), lines: json(r.lines, []), labels: json(r.labels, {}) };
}

/* ---------- writes ---------- */

type Out = { message?: string } & Record<string, unknown>;

export async function call(name: string, input: Record<string, unknown>): Promise<Out> {
  return ((await runFunction<Out>(name, input)) as Out) || {};
}

export const setItem = (featureId: string, change: Record<string, unknown>) => call("roadmap_set", { feature_id: featureId, ...change });
export const ship = (featureId: string, undo = false) => call("roadmap_ship", { feature_id: featureId, undo });
export const makeProject = (featureId: string) => call("roadmap_project", { feature_id: featureId });
export const saveSpec = (featureId: string, lines: unknown[]) => call("roadmap_spec_save_edit", { feature_id: featureId, lines });

/** Start the spec workflow about this feature. */
export async function draftSpec(featureId: string): Promise<void> {
  await client.request("POST", `/pods/${client.podId}/workflows/roadmap-spec/runs`, {
    body: { about: { table: "feature", record_id: featureId } },
  } as never);
}

/** A feature the team names by hand, on its product. */
export async function newFeature(name: string, settings: Settings | null, products: Product[], parentId?: string | null) {
  const product = settings?.product_id || products.find((p) => p.role === "ours")?.id;
  if (!product) throw new Error("Name your product in Settings first.");
  return create<Feature>("feature", { name: name.trim().slice(0, 120), product_id: product, state: "active", origin: "team", stage: "idea", source: "roadmap", ...(parentId ? { parent_id: parentId } : {}) });
}

export async function renameFeature(id: string, name: string) {
  await update("feature", id, { name: name.trim().slice(0, 120) });
}

let tickTimer = 0;
/** Re-write the lead's items in Today, a moment after a change. */
export function refreshToday(): void {
  if (DEMO) return;
  window.clearTimeout(tickTimer);
  tickTimer = window.setTimeout(() => void runFunction("roadmap_tick", {}).catch(() => undefined), 2500);
}

/** The lead's own daily run, made once as them: a schedule runs as whoever made it. */
export async function ensureLeadSchedule(settings: Settings, me: Who["me"]): Promise<string | null> {
  if (DEMO || !me || settings.lead_user_id !== me.id) return null;
  if (settings.schedule_id && settings.schedule_user_id === me.id) return null;
  const name = `roadmap-daily-${me.id.slice(0, 8)}`;
  try {
    const found = items<{ id: string; name: string }>(await client.schedules.list({ name, limit: 5 } as never)).find((x) => x.name === name)?.id;
    const id = found || ((await client.schedules.create({
      name, schedule_type: "TIME", workflow_name: "roadmap-daily", config: { cron: "0 7 * * *", timezone: settings.timezone || "UTC" },
    } as never)) as unknown as { id: string }).id;
    await update("roadmap_settings", settings.id, { schedule_id: id, schedule_user_id: me.id });
    return null;
  } catch (e) {
    return `Couldn't make the daily check (${e instanceof Error ? e.message : e}).`;
  }
}

export const WIDGET = "Roadmap";

/** The outside page's web widget: made (or opened to the page's address) when the page goes on. */
export async function ensureWidget(pageUrl: string | null): Promise<{ id: string | null; url: string | null }> {
  if (DEMO) return { id: "demo", url: "https://fernway-roadmap.apps.lemma.work" };
  let url = pageUrl;
  if (!url) {
    const app = await client.request<{ url?: string | null }>("GET", `/pods/${client.podId}/apps/roadmap-public`).catch(() => null);
    url = app?.url || null;
  }
  if (!url) return { id: null, url: null };
  const origin = new URL(url).origin;
  const list = items<{ id: string; name: string; allowed_origins: string[]; answer: string }>(await client.request("GET", `/pods/${client.podId}/web-widgets`));
  const w = list.find((x) => x.name === WIDGET);
  // "known": anonymous readers can read what's Public; only the Lemma's contacts could chat.
  if (w) {
    await client.request("PATCH", `/pods/${client.podId}/web-widgets/${w.id}`, { body: { allowed_origins: [...new Set([...(w.allowed_origins || []), origin])].slice(0, 20), answer: "known" } } as never);
    return { id: w.id, url };
  }
  const made = await client.request<{ id: string }>("POST", `/pods/${client.podId}/web-widgets`, { body: { name: WIDGET, allowed_origins: [origin], answer: "known" } } as never);
  return { id: made?.id || null, url };
}

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return zone === "Asia/Calcutta" ? "Asia/Kolkata" : zone;
}
