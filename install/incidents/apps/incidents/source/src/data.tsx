// The app's working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). Every Incidents table is the team's (no row-level security);
// follow-ups are the shared team `task` table with `source` incidents.
//
// Writes go through Incidents' functions, so the channel's header, the
// timeline and Today stay in step however a change is made (the app, or the
// Lemma in Slack). The two things only a person can do (connecting a channel
// to the Lemma's bot, and making schedules) are in wire.ts.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO, client, items, runFunction, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import type { Change, Flag, Hypothesis, IncEvent, Incident, Member, Settings, Task, Update } from "./types";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM incidents_settings ORDER BY created_at LIMIT 1", tables: ["incidents_settings"] },
  incidents: { sql: "SELECT * FROM incidents_incident ORDER BY number DESC LIMIT 500", tables: ["incidents_incident"] },
  events: { sql: "SELECT * FROM incidents_event ORDER BY at DESC LIMIT 5000", tables: ["incidents_event"] },
  hypotheses: { sql: "SELECT * FROM incidents_hypothesis ORDER BY created_at DESC LIMIT 500", tables: ["incidents_hypothesis"] },
  updates: { sql: "SELECT * FROM incidents_update ORDER BY drafted_at DESC LIMIT 1000", tables: ["incidents_update"] },
  flags: { sql: "SELECT * FROM incidents_flag ORDER BY created_at LIMIT 2000", tables: ["incidents_flag"] },
  changes: { sql: "SELECT * FROM incidents_change ORDER BY at DESC LIMIT 500", tables: ["incidents_change"] },
  tasks: {
    sql: "SELECT id, number, title, status, assignee_kind, assignee_name, assignee_agent, due_on, source_id, done_at, created_at " +
      "FROM task WHERE source = 'incidents' ORDER BY number DESC LIMIT 1000",
    tables: ["task"],
  },
  sample: { sql: "SELECT COUNT(*) AS n FROM incidents_sample_row", tables: ["incidents_sample_row"] },
};

export function json<T>(value: unknown, fallback: T): T {
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

export const DEFAULT_SEVERITIES = [
  { key: "sev1", word: "Critical", update_every_min: 30 },
  { key: "sev2", word: "Major", update_every_min: 30 },
  { key: "sev3", word: "Minor", update_every_min: 60 },
];

function asSettings(r: Record<string, unknown> | undefined): Settings | null {
  if (!r) return null;
  const sevs = json<Settings["severities"]>(r.severities, []);
  return {
    ...(r as unknown as Settings),
    repos: json(r.repos, []),
    email_to: json(r.email_to, []),
    severities: sevs.length ? sevs : DEFAULT_SEVERITIES,
    schedules: json(r.schedules, {}),
    sample: Boolean(r.sample),
  };
}

function asIncident(r: Record<string, unknown>): Incident {
  return {
    ...(r as unknown as Incident),
    number: Number(r.number),
    people_affected: r.people_affected == null ? null : Number(r.people_affected),
    responders: json(r.responders, []),
    followups: json(r.followups, []),
    writeup: json(r.writeup, null),
    channel_connected: Boolean(r.channel_connected),
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

/** Everything the screens read, indexed by incident. */
export function useIncidents() {
  const { loaded, errors, reload } = useData();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const incRows = useRows<Record<string, unknown>>("incidents");
  const eventRows = useRows<Record<string, unknown>>("events");
  const hypRows = useRows<Record<string, unknown>>("hypotheses");
  const updRows = useRows<Record<string, unknown>>("updates");
  const flagRows = useRows<Flag>("flags");
  const changeRows = useRows<Change>("changes");
  const taskRows = useRows<Task>("tasks");
  const sampleRows = useRows<{ n: number | string }>("sample");
  return useMemo(() => {
    const settings = asSettings(settingsRows[0]);
    const incidents = incRows.map(asIncident).sort((a, b) => b.number - a.number);
    const events = eventRows.map((e) => ({ ...(e as unknown as IncEvent), detail: json(e.detail, null), starred: Boolean(e.starred) }))
      .sort((a, b) => b.at.localeCompare(a.at));
    const hypotheses = hypRows.map((h) => ({
      ...(h as unknown as Hypothesis), evidence: json(h.evidence, []), ruled_out: json(h.ruled_out, []), not_checked: json(h.not_checked, []),
    }));
    const updates = updRows.map((u) => ({ ...(u as unknown as Update), to: json(u.recipients, null), delivery: json(u.delivery, null) }));
    const by = <T extends { incident_id: string }>(list: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of list) m.set(x.incident_id, [...(m.get(x.incident_id) || []), x]);
      return m;
    };
    const tasksBy = new Map<string, Task[]>();
    for (const t of taskRows) if (t.source_id) tasksBy.set(t.source_id, [...(tasksBy.get(t.source_id) || []), { ...t, number: t.number == null ? null : Number(t.number) }]);
    return {
      loaded, errors, reload, settings, incidents,
      eventsBy: by(events), hypothesesBy: by(hypotheses), updatesBy: by(updates), flagsBy: by(flagRows), tasksBy,
      events, changes: changeRows, tasks: taskRows,
      sample: Number(sampleRows[0]?.n || 0) > 0,
    };
  }, [loaded, errors, reload, settingsRows, incRows, eventRows, hypRows, updRows, flagRows, changeRows, taskRows, sampleRows]);
}

export type Data = ReturnType<typeof useIncidents>;

/** Now, as the screens count from it. In the "Try it" demo the sample is a
 *  moment in time (its newest event, a few minutes on), so "38 min" stays 38
 *  minutes whenever the demo is opened. */
export function nowMs(d: Pick<Data, "events" | "incidents">): number {
  if (!DEMO) return Date.now();
  const open = new Set(d.incidents.filter((i) => i.status !== "resolved").map((i) => i.id));
  const newest = d.events.filter((e) => open.has(e.incident_id)).reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), 0);
  return newest ? newest + 6 * 60_000 : Date.now();
}

/* ---------- writes ---------- */

type Out = { message?: string } & Record<string, unknown>;

export async function call(name: string, input: Record<string, unknown>): Promise<Out> {
  const out = (await runFunction<Out>(name, input)) as Out;
  return out || {};
}

export const setIncident = (incident: string, change: Record<string, unknown>) => call("incidents_set", { incident, ...change });

let needsTimer = 0;
/** Re-write this person's items in Today, a moment after a change or on open. */
export function refreshNeedsYou(): void {
  if (DEMO) return;
  window.clearTimeout(needsTimer);
  needsTimer = window.setTimeout(() => void runFunction("incidents_needs_you", {}).catch(() => undefined), 1500);
}
