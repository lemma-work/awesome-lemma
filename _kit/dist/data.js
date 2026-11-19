import { jsx as _jsx } from "react/jsx-runtime";
// Each app's working set: one read per named query, kept fresh by the pod's
// change stream (a burst of writes reloads once), and re-read when the tab
// comes back, so a change missed while the tab slept cannot leave it stale.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { client } from "./client";
function norm(r) {
    const row = r;
    if (row && typeof row.data === "object" && row.data && !Array.isArray(row.data)) {
        const out = { ...row.data };
        for (const key of ["id", "created_at", "updated_at", "user_id"])
            if (row[key] != null && out[key] == null)
                out[key] = row[key];
        return out;
    }
    return row;
}
export function items(response) {
    const r = response;
    const list = r?.items || r?.data || r?.rows || (Array.isArray(response) ? response : []);
    return list.map((x) => norm(x));
}
export function q(sql) {
    return client.datastore.query(sql).then((r) => items(r));
}
export function sql(value) {
    return "'" + String(value ?? "").replace(/'/g, "''") + "'";
}
export async function update(table, id, data) {
    await client.records.update(table, id, data);
}
export async function create(table, data) {
    return norm(await client.records.create(table, data));
}
/** A function run's output, whichever shape the API hands back. */
export async function runFunction(name, input = {}) {
    const run = (await client.functions.run(name, { input }));
    const status = String(run.status || "");
    if (status === "FAILED" || run.error) {
        const err = run.error;
        throw new Error(typeof err === "string" ? err : err?.message || `${name} failed`);
    }
    return (run.output_data || run.output || run.result || {});
}
export async function startWorkflow(name) {
    const run = (await client.workflows.runs.create(name));
    return run?.id;
}
const DataContext = createContext(null);
export function DataProvider({ loaders, children }) {
    const [data, setData] = useState({});
    const [loaded, setLoaded] = useState(false);
    const [errors, setErrors] = useState({});
    const timers = useRef({});
    const names = useMemo(() => Object.keys(loaders), [loaders]);
    const reloadOne = useCallback(async (name) => {
        const loader = loaders[name];
        if (!loader)
            return;
        try {
            const value = loader.sql ? await q(loader.sql) : loader.load ? await loader.load() : null;
            setData((d) => ({ ...d, [name]: value }));
            setErrors((e) => ({ ...e, [name]: undefined }));
        }
        catch (err) {
            setErrors((e) => ({ ...e, [name]: err instanceof Error ? err.message : String(err) }));
        }
    }, [loaders]);
    const reload = useCallback(async (name) => {
        await Promise.all((name ? [name] : names).map(reloadOne));
    }, [names, reloadOne]);
    useEffect(() => {
        let alive = true;
        void reload().then(() => alive && setLoaded(true));
        const byTable = {};
        for (const name of names)
            for (const table of loaders[name].tables)
                (byTable[table] ||= []).push(name);
        const handle = client.datastore.watchChanges({
            onChange: (frame) => {
                for (const name of byTable[frame.table_name] || []) {
                    window.clearTimeout(timers.current[name]);
                    timers.current[name] = window.setTimeout(() => void reloadOne(name), 450);
                }
            },
            onError: (err) => console.debug("[kit] change stream:", err),
        });
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
            for (const t of Object.values(timers.current))
                window.clearTimeout(t);
        };
    }, [loaders, names, reload, reloadOne]);
    const value = useMemo(() => ({ data, loaded, errors, reload }), [data, loaded, errors, reload]);
    return _jsx(DataContext.Provider, { value: value, children: children });
}
export function useData() {
    const ctx = useContext(DataContext);
    if (!ctx)
        throw new Error("useData needs a DataProvider around it.");
    return ctx;
}
/** One named result as rows. */
export function useRows(name) {
    const { data } = useData();
    return data[name] || [];
}
