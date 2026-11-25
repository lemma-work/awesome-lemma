// The app's working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). Every Triage table is the team's (no row-level security);
// accepted items are the shared team `task` table with `source` triage, and
// the people waiting on an item are the shared `ask` table.
//
// Writes go through Triage's functions (triage_decide, triage_report_add,
// ...), so Activity, the askers and Today stay in step however a change is
// made. What only a person can do (schedules, the form, the widget, Public,
// writing to a form reporter, other plugins) is in wire.ts.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO, client, items, runFunction, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import type { Ask, Away, Item, Known, Member, Report, Rule, Settings, Task, TEvent } from "./types";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM triage_settings ORDER BY created_at LIMIT 1", tables: ["triage_settings"] },
  items: { sql: "SELECT * FROM triage_item ORDER BY number DESC LIMIT 1000", tables: ["triage_item"] },
  reports: { sql: "SELECT * FROM triage_report ORDER BY received_at DESC LIMIT 3000", tables: ["triage_report"] },
  events: { sql: "SELECT * FROM triage_event ORDER BY at DESC LIMIT 5000", tables: ["triage_event"] },
  asks: { sql: "SELECT * FROM ask WHERE work_source = 'triage' ORDER BY asked_at LIMIT 3000", tables: ["ask"] },
  rules: { sql: "SELECT * FROM triage_rule ORDER BY position LIMIT 500", tables: ["triage_rule"] },
  away: { sql: "SELECT * FROM away ORDER BY day LIMIT 2000", tables: ["away"] },
  known: { sql: "SELECT * FROM triage_known ORDER BY updated_at DESC LIMIT 200", tables: ["triage_known"] },
  tasks: {
    sql: "SELECT id, number, title, status, assignee_kind, assignee_name, assignee_agent, source_id FROM task " +
      "WHERE source = 'triage' ORDER BY number DESC LIMIT 1000",
    tables: ["task"],
  },
  sample: { sql: "SELECT COUNT(*) AS n FROM triage_sample_row", tables: ["triage_sample_row"] },
};

export function json<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return (JSON.parse(value) as T) ?? fallback;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

const n = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

function asSettings(r: Record<string, unknown> | undefined): Settings | null {
  if (!r) return null;
  return {
    ...(r as unknown as Settings),
    repos: json(r.repos, []),
    slack: json(r.slack, {}),
    sentry: json(r.sentry, {}),
    posthog: json(r.posthog, {}),
    ack: { app: "off", assistant: "got_it_known", slack: "off", github: "got_it", form: "got_it_known", ...json(r.ack, {}) },
    urgent_people: Number(r.urgent_people || 100),
    read_from_people: Number(r.read_from_people || 25),
    close_github_on_done: Boolean(r.close_github_on_done),
    rotation: json(r.rotation, []),
    people: json(r.people, []),
    form_on: Boolean(r.form_on),
    form_audience: (r.form_audience as Settings["form_audience"]) || "anyone",
    form_columns: json(r.form_columns, []),
    known_public: Boolean(r.known_public),
    sample: Boolean(r.sample),
    quiet: Boolean(r.quiet),
    status: json(r.status, {}),
    schedules: json(r.schedules, {}),
    plugins: json(r.plugins, {}),
    sprints_away: json(r.sprints_away, {}),
  };
}

function asItem(r: Record<string, unknown>): Item {
  return {
    ...(r as unknown as Item),
    number: Number(r.number),
    reach_people: n(r.reach_people),
    reach_events: n(r.reach_events),
    reach_asks: Number(r.reach_asks || 0),
    reach_companies: Number(r.reach_companies || 0),
    trend: json(r.trend, []),
    paths: json(r.paths, []),
    doors: json(r.doors, []),
    security: json(r.security, null),
    alternatives: json(r.alternatives, []),
    evidence: json(r.evidence, []),
    related: json(r.related, []),
    escalating: Boolean(r.escalating),
    regressed: Boolean(r.regressed),
    sample: Boolean(r.sample),
  };
}

function asReport(r: Record<string, unknown>): Report {
  return {
    ...(r as unknown as Report),
    people: n(r.people),
    events: n(r.events),
    sessions: n(r.sessions),
    files: json(r.files, []),
    security: json(r.security, null),
    detail: json(r.detail, null),
  };
}

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

const SEV: Record<string, number> = { critical: 4, high: 3, medium: 2, moderate: 2, low: 1 };
export const sevRank = (it: Item) => SEV[String(it.security?.severity || "").toLowerCase()] || 0;

/** The inbox order: people reached, then security, then how many reported it. */
export function byReach(reportsBy: Map<string, Report[]>) {
  return (a: Item, b: Item) =>
    (b.reach_people ?? -1) - (a.reach_people ?? -1) ||
    sevRank(b) - sevRank(a) ||
    (b.reach_asks + (reportsBy.get(b.id)?.length || 0)) - (a.reach_asks + (reportsBy.get(a.id)?.length || 0)) ||
    b.number - a.number;
}

/** Everything the screens read, indexed by item. */
export function useTriage() {
  const { loaded, errors, reload } = useData();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const itemRows = useRows<Record<string, unknown>>("items");
  const reportRows = useRows<Record<string, unknown>>("reports");
  const eventRows = useRows<TEvent>("events");
  const askRows = useRows<Ask>("asks");
  const ruleRows = useRows<Record<string, unknown>>("rules");
  const awayRows = useRows<Away>("away");
  const knownRows = useRows<Known>("known");
  const taskRows = useRows<Task>("tasks");
  const sampleRows = useRows<{ n: number | string }>("sample");
  return useMemo(() => {
    const settings = asSettings(settingsRows[0]);
    const all = itemRows.map(asItem).sort((a, b) => b.number - a.number);
    const reports = reportRows.map(asReport);
    const group = <T,>(list: T[], key: (x: T) => string | null | undefined) => {
      const m = new Map<string, T[]>();
      for (const x of list) {
        const k = key(x);
        if (k) m.set(k, [...(m.get(k) || []), x]);
      }
      return m;
    };
    const reportsBy = group(reports, (r) => r.item_id);
    for (const list of reportsBy.values()) list.sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
    const eventsBy = group([...eventRows].sort((a, b) => String(a.at).localeCompare(String(b.at))), (e) => e.item_id);
    const asksBy = group(askRows.filter((a) => a.state !== "dropped"), (a) => a.work_id);
    const tasksBy = new Map(taskRows.map((t) => [String(t.source_id), { ...t, number: t.number == null ? null : Number(t.number) }]));
    const byId = new Map(all.map((i) => [i.id, i]));
    const byNumber = new Map(all.map((i) => [i.number, i]));
    const rules = ruleRows.map((r) => ({ ...(r as unknown as Rule), match: json(r.match, {}), enabled: r.enabled !== false, position: Number(r.position || 0) }));
    const order = byReach(reportsBy);
    const inbox = all.filter((i) => i.state === "inbox").sort(order);
    const down = all.filter((i) => i.state === "marked_down").sort(order);
    const accepted = all.filter((i) => i.state === "accepted" || i.state === "done");
    const declined = all.filter((i) => i.state === "declined" || i.state === "duplicate");
    const snoozed = all.filter((i) => i.state === "snoozed");
    const notReports = reports.filter((r) => r.state === "question" || r.state === "not_a_report");
    return {
      loaded, errors, reload, settings, items: all, reports, reportsBy, eventsBy, asksBy, tasksBy, byId, byNumber,
      rules, away: awayRows, known: knownRows, inbox, down, accepted, declined, snoozed, notReports,
      sample: Number(sampleRows[0]?.n || 0) > 0,
    };
  }, [loaded, errors, reload, settingsRows, itemRows, reportRows, eventRows, askRows, ruleRows, awayRows, knownRows, taskRows, sampleRows]);
}

export type Data = ReturnType<typeof useTriage>;

/** Now, as the screens count from it. In the "Try it" demo the sample is a
 *  moment (its newest report, a few minutes on), so "22m" stays 22 minutes
 *  whenever the demo is opened. */
export function nowMs(d: Pick<Data, "reports">): number {
  if (!DEMO) return Date.now();
  const newest = d.reports.reduce((m, r) => Math.max(m, Date.parse(r.received_at || "") || 0), 0);
  return newest ? newest + 6 * 60_000 : Date.now();
}

/* ---------- writes ---------- */

export type Out = { message?: string; ok?: boolean } & Record<string, unknown>;

export async function call(name: string, input: Record<string, unknown>): Promise<Out> {
  const out = (await runFunction<Out>(name, input)) as Out;
  return out || {};
}

export const decide = (item: Item, action: string, extra: Record<string, unknown> = {}) =>
  call("triage_decide", { item: item.id, action, ...extra });

let needsTimer = 0;
/** Re-write this person's items in Today, a moment after a change or on open. */
export function refreshNeedsYou(): void {
  if (DEMO) return;
  window.clearTimeout(needsTimer);
  needsTimer = window.setTimeout(() => void runFunction("triage_needs_you", {}).catch(() => undefined), 1500);
}

/** Who is on triage on a day: the rotation, a week each, skipping anyone away all day. */
export function onTriage(s: Settings | null, away: Away[], extra: { member_id?: string | null; name: string; day: string; part: string }[], day: Date): string | null {
  const order = s?.rotation || [];
  if (!order.length) return null;
  const start = new Date(s?.rotation_start ? `${s.rotation_start.slice(0, 10)}T00:00:00Z` : day.toISOString());
  const monday = new Date(start);
  monday.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const week = Math.max(0, Math.floor((day.getTime() - monday.getTime()) / (7 * 86_400_000)));
  const key = day.toISOString().slice(0, 10);
  const off = new Set([...away, ...extra].filter((a) => String(a.day).slice(0, 10) === key && a.part !== "half").map((a) => String(a.member_id || a.name)));
  for (let step = 0; step < order.length; step++) {
    const who = order[(week + step) % order.length];
    if (!off.has(who)) return who;
  }
  return null;
}

export function nameOf(d: { settings: Settings | null }, members: Pick<Member, "user_id" | "name">[], id: string | null | undefined): string {
  if (!id) return "";
  return members.find((m) => m.user_id === id)?.name || d.settings?.people.find((p) => p.user_id === id)?.name || "a member";
}
