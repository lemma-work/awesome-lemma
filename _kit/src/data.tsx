// Each app's working set: one read per named query, kept fresh by the pod's
// change stream (a burst of writes reloads once), and re-read when the tab
// comes back, so a change missed while the tab slept cannot leave it stale.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { client } from "./client";

export interface Loader {
  /** Read with SQL; RLS scopes every table to the signed-in person's own rows. */
  sql?: string;
  /** Or anything else that returns rows. */
  load?: () => Promise<unknown>;
  /** Which tables' changes make this stale. */
  tables: string[];
}

export type Loaders = Record<string, Loader>;

function norm<T>(r: unknown): T {
  const row = r as Record<string, unknown>;
  if (row && typeof row.data === "object" && row.data && !Array.isArray(row.data)) {
    const out = { ...(row.data as Record<string, unknown>) };
    for (const key of ["id", "created_at", "updated_at", "user_id"]) if (row[key] != null && out[key] == null) out[key] = row[key];
    return out as T;
  }
  return row as T;
}

export function items<T>(response: unknown): T[] {
  const r = response as { items?: unknown[]; data?: unknown[]; rows?: unknown[] };
  const list = r?.items || r?.data || r?.rows || (Array.isArray(response) ? (response as unknown[]) : []);
  return list.map((x) => norm<T>(x));
}

export function q<T>(sql: string): Promise<T[]> {
  return client.datastore.query(sql).then((r) => items<T>(r));
}

export function sql(value: unknown): string {
  return "'" + String(value ?? "").replace(/'/g, "''") + "'";
}

export async function update(table: string, id: string, data: Record<string, unknown>): Promise<void> {
  await client.records.update(table, id, data as never);
}

export async function create<T = Record<string, unknown>>(table: string, data: Record<string, unknown>): Promise<T> {
  return norm<T>(await client.records.create(table, data as never));
}

/** A function run's output, whichever shape the API hands back. */
export async function runFunction<T = Record<string, unknown>>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const run = (await client.functions.run(name, { input } as never)) as unknown as Record<string, unknown>;
  const status = String(run.status || "");
  if (status === "FAILED" || run.error) {
    const err = run.error as { message?: string } | string | undefined;
    throw new Error(typeof err === "string" ? err : err?.message || `${name} failed`);
  }
  return (run.output_data || run.output || run.result || {}) as T;
}

export async function startWorkflow(name: string): Promise<string | undefined> {
  const run = (await client.workflows.runs.create(name)) as unknown as { id?: string };
  return run?.id;
}

interface Ctx {
  data: Record<string, unknown>;
  loaded: boolean;
  errors: Record<string, string | undefined>;
  reload: (name?: string) => Promise<void>;
}

const DataContext = createContext<Ctx | null>(null);

export function DataProvider({ loaders, children }: { loaders: Loaders; children: ReactNode }) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const timers = useRef<Record<string, number>>({});
  const names = useMemo(() => Object.keys(loaders), [loaders]);

  const reloadOne = useCallback(
    async (name: string) => {
      const loader = loaders[name];
      if (!loader) return;
      try {
        const value = loader.sql ? await q(loader.sql) : loader.load ? await loader.load() : null;
        setData((d) => ({ ...d, [name]: value }));
        setErrors((e) => ({ ...e, [name]: undefined }));
      } catch (err) {
        setErrors((e) => ({ ...e, [name]: err instanceof Error ? err.message : String(err) }));
      }
    },
    [loaders],
  );

  const reload = useCallback(
    async (name?: string) => {
      await Promise.all((name ? [name] : names).map(reloadOne));
    },
    [names, reloadOne],
  );

  useEffect(() => {
    let alive = true;
    void reload().then(() => alive && setLoaded(true));
    const byTable: Record<string, string[]> = {};
    for (const name of names) for (const table of loaders[name].tables) (byTable[table] ||= []).push(name);
    const handle = client.datastore.watchChanges({
      onChange: (frame: { table_name: string }) => {
        for (const name of byTable[frame.table_name] || []) {
          window.clearTimeout(timers.current[name]);
          timers.current[name] = window.setTimeout(() => void reloadOne(name), 450);
        }
      },
      onError: (err: unknown) => console.debug("[kit] change stream:", err),
    } as never) as unknown as { close?: () => void; stop?: () => void } | undefined;
    let last = Date.now();
    const back = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 20_000) {
        last = Date.now();
        void reload();
      }
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      alive = false;
      handle?.close?.();
      handle?.stop?.();
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
      for (const t of Object.values(timers.current)) window.clearTimeout(t);
    };
  }, [loaders, names, reload, reloadOne]);

  const value = useMemo(() => ({ data, loaded, errors, reload }), [data, loaded, errors, reload]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData needs a DataProvider around it.");
  return ctx;
}

/** One named result as rows. */
export function useRows<T>(name: string): T[] {
  const { data } = useData();
  return (data[name] as T[] | undefined) || [];
}
