// The app's working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). Every Sprints table is the team's (no row-level security);
// `task` is the shared team task table Tasks writes.
//
// Writes go through Sprints' functions when they touch the sprint's record
// (adding, taking out, estimating, starting, closing), so "in at start" and
// the events stay right however the change is made; a day off, a dismissed
// suggestion and an assignee are one row each, written here.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { client, create, items, runFunction, update, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import { world as makeWorld, type World } from "./model";
import type { Away, Item, Member, Settings, Sprint, SprintEvent, Suggestion, Task } from "./types";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM sprints_settings ORDER BY created_at LIMIT 1", tables: ["sprints_settings"] },
  sprints: { sql: "SELECT * FROM sprints_sprint ORDER BY number", tables: ["sprints_sprint"] },
  items: { sql: "SELECT * FROM sprints_item LIMIT 5000", tables: ["sprints_item"] },
  events: { sql: "SELECT * FROM sprints_event ORDER BY at LIMIT 5000", tables: ["sprints_event"] },
  estimates: { sql: "SELECT id, points FROM sprints_estimate LIMIT 5000", tables: ["sprints_estimate"] },
  away: { sql: "SELECT * FROM sprints_away ORDER BY day LIMIT 2000", tables: ["sprints_away"] },
  suggestions: { sql: "SELECT * FROM sprints_suggestion WHERE state = 'open' OR kind = 'close' ORDER BY created_at LIMIT 2000", tables: ["sprints_suggestion"] },
  tasks: {
    sql: "SELECT id, number, title, status, priority, source, source_id, source_url, assignee_kind, assignee_user_id, assignee_name, " +
      "assignee_agent, project_id, parent_id, created_at, updated_at, done_at FROM task WHERE parent_id IS NULL ORDER BY number DESC LIMIT 3000",
    tables: ["task"],
  },
  sample: { sql: "SELECT COUNT(*) AS n FROM sprints_sample_row", tables: ["sprints_sample_row"] },
};

function json<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function asSettings(r: Record<string, unknown> | undefined): Settings | null {
  if (!r) return null;
  return {
    ...(r as unknown as Settings),
    length_weeks: Number(r.length_weeks || 2),
    measure: (r.measure as Settings["measure"]) || "points",
    scale: json<number[]>(r.scale, [1, 2, 3, 5, 8]).map(Number),
    watch_sources: json<string[]>(r.watch_sources, ["incidents", "triage", "pr_review"]),
  };
}

function asSprint(r: Record<string, unknown>): Sprint {
  return {
    ...(r as unknown as Sprint),
    number: Number(r.number),
    starts_on: String(r.starts_on).slice(0, 10),
    ends_on: String(r.ends_on).slice(0, 10),
    capacity: json(r.capacity, null),
    stats: json(r.stats, null),
    summary_draft: json(r.summary_draft, null),
    capacity_total: r.capacity_total == null ? null : Number(r.capacity_total),
  };
}

interface Who {
  me: { id: string; name: string; email: string | null } | null;
  members: Member[];
  lemmaName: string;
}

const WhoContext = createContext<Who>({ me: null, members: [], lemmaName: "This Lemma" });

/** Who is signed in and who else is in the Lemma: read once. */
export function WhoProvider({ children }: { children: ReactNode }) {
  const [who, setWho] = useState<Who>({ me: null, members: [], lemmaName: "This Lemma" });
  useEffect(() => {
    void (async () => {
      const [me, members, pod] = await Promise.all([
        whoAmI(),
        client.podMembers.list(client.podId || "", { limit: 200 })
          .then((r) => items<{ user_id: string; user_name?: string | null; user_email?: string; email?: string }>(r))
          .catch(() => []),
        client.pods.get(client.podId || "").catch(() => null),
      ]);
      const list: Member[] = members.map((m) => ({
        user_id: m.user_id, email: m.user_email || m.email || "",
        name: m.user_name || (m.user_email || m.email || "").split("@")[0] || "Someone",
      }));
      const self = me ? { id: me.id, email: me.email, name: list.find((m) => m.user_id === me.id)?.name || me.name || (me.email || "").split("@")[0] || "You" } : null;
      setWho({ me: self, members: list, lemmaName: ((pod as { name?: string } | null)?.name || "This Lemma").trim() });
    })();
  }, []);
  return <WhoContext.Provider value={who}>{children}</WhoContext.Provider>;
}

export function useWho(): Who {
  return useContext(WhoContext);
}

/** Everything the screens read, indexed. */
export function useSprints() {
  const { loaded, errors, reload } = useData();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const sprintRows = useRows<Record<string, unknown>>("sprints");
  const itemRows = useRows<Item>("items");
  const eventRows = useRows<SprintEvent>("events");
  const estRows = useRows<{ id: string; points: number }>("estimates");
  const awayRows = useRows<Away>("away");
  const sugRows = useRows<Record<string, unknown>>("suggestions");
  const taskRows = useRows<Task>("tasks");
  const sampleRows = useRows<{ n: number | string }>("sample");
  return useMemo(() => {
    const settings = asSettings(settingsRows[0]);
    const w: World = makeWorld({
      measure: settings?.measure || "points",
      zone: settings?.timezone || null,
      sprints: sprintRows.map(asSprint),
      tasks: taskRows.map((t) => ({ ...t, number: Number(t.number) })),
      items: itemRows.map((i) => ({ ...i, nth: Number(i.nth || 1), points_at_add: i.points_at_add == null ? null : Number(i.points_at_add) })),
      est: estRows,
      events: eventRows.map((e) => ({ ...e, detail: json(e.detail, {}) })),
      away: awayRows.map((a) => ({ ...a, day: String(a.day).slice(0, 10) })),
      suggestions: sugRows.map((s) => ({ ...(s as unknown as Suggestion), task_ids: json<string[]>(s.task_ids, []), detail: json(s.detail, {}) })),
    });
    return { loaded, errors, reload, settings, w, sample: Number(sampleRows[0]?.n || 0) > 0 };
  }, [loaded, errors, reload, settingsRows, sprintRows, itemRows, eventRows, estRows, awayRows, sugRows, taskRows, sampleRows]);
}

export type Data = ReturnType<typeof useSprints>;

/* ---------- writes ---------- */

type Out = { message?: string } & Record<string, unknown>;

export async function call(name: string, input: Record<string, unknown>): Promise<Out> {
  const out = (await runFunction<Out>(name, input)) as Out;
  return out || {};
}

export const addTasks = (tasks: string[], sprint: string | number, assign?: Record<string, unknown>) =>
  call("sprints_add", { tasks, sprint: String(sprint), assign: assign || null, via: "app" });
export const removeTasks = (tasks: string[], sprint: string | number, to: "backlog" | "next" = "backlog") =>
  call("sprints_remove", { tasks, sprint: String(sprint), to, via: "app" });
export const estimate = (task: string, points: number | null) => call("sprints_estimate", { task, points });

export async function dismiss(s: Suggestion, me: Who["me"]) {
  await update("sprints_suggestion", s.id, { state: "dismissed", decided_by: me?.name || null, decided_at: new Date().toISOString() });
}

export async function assign(task: Task, to: { kind: "person"; user_id: string | null; name: string } | { kind: "agent"; agent: string } | { kind: "none" }) {
  if (to.kind === "agent") await update("task", task.id, { assignee_kind: "agent", assignee_agent: to.agent, assignee_user_id: null, assignee_name: null });
  else if (to.kind === "person") await update("task", task.id, { assignee_kind: "person", assignee_user_id: to.user_id, assignee_name: to.name, assignee_agent: null });
  else await update("task", task.id, { assignee_kind: "none", assignee_user_id: null, assignee_name: null, assignee_agent: null });
}

/** Days off, one row per working day; one already there is left alone. */
export async function addAway(person: { user_id: string | null; name: string }, days: string[], part: "full" | "half", have: Away[]) {
  for (const day of days) {
    if (have.some((a) => a.day === day && a.name === person.name)) continue;
    await create("sprints_away", { ...(person.user_id ? { member_id: person.user_id } : {}), name: person.name, day, part });
  }
}

export async function removeAway(rows: Away[]) {
  for (const r of rows) await client.records.delete("sprints_away", r.id).catch(() => undefined);
}

let needsTimer = 0;
/** Re-write the lead's items in Today, a moment after a change. */
export function refreshNeedsYou(): void {
  window.clearTimeout(needsTimer);
  needsTimer = window.setTimeout(() => void runFunction("sprints_needs_you", {}).catch(() => undefined), 2000);
}

/** The lead's own schedules, made once as them: the daily 06:00 run, and the
 *  trigger that tells them when something comes in mid-sprint. A schedule
 *  runs as whoever made it, so only the lead's own app makes these. */
export async function ensureLeadSchedules(settings: Settings, me: Who["me"]): Promise<string | null> {
  if (!me || settings.lead_user_id !== me.id) return null;
  if (settings.schedule_id && settings.lead_schedule_id && settings.schedule_user_id === me.id) return null;
  const tag = me.id.slice(0, 8);
  const zone = settings.timezone || "UTC";
  const find = async (name: string) =>
    items<{ id: string; name: string }>(await client.schedules.list({ name, limit: 5 } as never)).find((x) => x.name === name)?.id;
  const made: Record<string, string> = {};
  const problems: string[] = [];
  try {
    const name = `sprints-daily-${tag}`;
    made.schedule_id = (await find(name)) || ((await client.schedules.create({
      name, schedule_type: "TIME", workflow_name: "sprints-daily", config: { cron: "0 6 * * *", timezone: zone },
    } as never)) as unknown as { id: string }).id;
  } catch (e) {
    problems.push(`the daily run (${e instanceof Error ? e.message : e})`);
  }
  try {
    const name = `sprints-lead-${tag}`;
    made.lead_schedule_id = (await find(name)) || ((await client.schedules.create({
      name, schedule_type: "DATASTORE", workflow_name: "sprints-lead",
      config: { table_name: "sprints_suggestion", operations: ["INSERT"], bulk_writes: "each" },
    } as never)) as unknown as { id: string }).id;
  } catch (e) {
    problems.push(`the trigger for work that comes in (${e instanceof Error ? e.message : e})`);
  }
  if (Object.keys(made).length) await update("sprints_settings", settings.id, { ...made, schedule_user_id: me.id }).catch(() => undefined);
  return problems.length ? `Couldn't make ${problems.join(" or ")}.` : null;
}

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return zone === "Asia/Calcutta" ? "Asia/Kolkata" : zone;
}
