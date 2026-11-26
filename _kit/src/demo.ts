// Demo mode: a plugin's real app on made-up sample rows, in a browser, with no
// sign-in and no server. It is what the "Try it" frame on a plugin's public
// page shows.
//
// `_kit/bin/demo.mjs` builds an app with VITE_LEMMA_DEMO=1 and puts the
// plugin's sample data in the page as `window.__LEMMA_DEMO__` (its fixtures,
// the same files `bin/shots_serve.py` answers from). Then the kit's client is
// pointed at an address that does not exist, and every call to it is answered
// here, in the page, the way shots_serve.py answers on a server:
//
// - reads from the fixture for the request's path; a datastore query from the
//   first `{match, response}` entry whose `match` is in its SQL;
// - writes (records, and functions or workflows the plugin gives a handler in
//   its `.lemma/demo.js`) change an in-memory copy, which every later read
//   sees, and tell the app's change stream, so pressing Done or dragging a
//   card stays done;
// - a call that would make the Lemma write something answers from its fixture,
//   or with a short note saying what the Lemma would write there.
//
// Nothing leaves the page: fetch, WebSocket and EventSource to anywhere but the
// page's own files are refused, and a Google Fonts sheet is swapped for the
// copy the demo build put beside the page.
//
// A normal build has VITE_LEMMA_DEMO unset, so DEMO is false at build time and
// none of this is in it.

export const DEMO: boolean = import.meta.env.VITE_LEMMA_DEMO === "1";

/** Where the demo client sends its calls. `.invalid` never resolves, so a call this file failed to answer could not reach anything either. */
export const DEMO_API = "https://lemma-demo.invalid";

export interface DemoApp {
  /** The app's name in its plugin, as `client.apps.open` names it. */
  name: string;
  label: string;
  /** Its demo page, relative to this one. */
  href: string;
}

export interface DemoData {
  plugin: string;
  /** This page's app. */
  app: string;
  /** Every app of the plugin that has a demo; the bar switches between them. */
  apps: DemoApp[];
  /** Where the app opens when the address names nowhere. */
  start?: string;
  /** Request path under the API (no `.json`) -> answer, as in shots/fixtures. */
  fixtures: Record<string, unknown>;
  /** Pod file path (or a document's file name) -> its text. */
  files?: Record<string, string>;
  /** Function or workflow name -> the note shown when it runs. */
  notes?: Record<string, string>;
  /**
   * The day the sample was written for (`2026-11-18`). Its dates move by whole
   * days so that day is today. With a time (`2026-11-18T13:30:00Z`, the moment
   * it was written), a viewer earlier in their day than that gets it as of
   * yesterday instead, so nothing it wrote reads as future.
   */
  anchor?: string;
  /**
   * The zone the sample was written in (or its names: `["Asia/Kolkata", "Asia/Calcutta"]`).
   * Its times move so their clock readings are the same in the viewer's zone,
   * and those names in the sample become the viewer's zone.
   */
  zone?: string | string[];
  /** App name -> its name on screen, for the apps of every plugin (the note for an app not in the demo names it). */
  labels?: Record<string, string>;
  /** The sample person who is signed in. */
  user?: Record<string, unknown>;
  /** Pod connector slug (or connector id) -> where `<Connect>` shows it stands: `{ state: "ready", as: "northwind" }` (the default), or `connect`, `use_mine`, `install`, `ask`, … */
  connections?: Record<string, { state?: string; as?: string; why?: string; who?: string[]; accounts?: string[] }>;
  /** Google Fonts family, in lower case -> stylesheet beside the page with that face in it. */
  fonts?: Record<string, string>;
}

type Row = Record<string, unknown>;

/** What a plugin's `.lemma/demo.js` handlers get to change the sample with. */
export interface DemoDb {
  /** Merge `fields` into the rows with these ids, wherever a read returns them. */
  patch(ids: string | string[], fields: Row, table?: string): void;
  /** Take these rows out of every read. */
  remove(ids: string | string[], table?: string): void;
  /** A new row of `table`, returned by later reads of that table. */
  add(table: string, row: Row): Row;
  /** A row as the sample has it now (with every change), or null; `table` narrows which changes apply. */
  find(id: string, table?: string): Row | null;
  /** The rows of the datastore query fixture whose `match` contains `text`; with `table`, rows added to it too. */
  rows(text: string, table?: string): Row[];
  /** Write a pod file's text, which later downloads of that path return. */
  file(path: string, text: string): void;
  /** A fixture's answer, by request path. */
  fixture(path: string): unknown;
  /** Show a short line at the bottom of the page. */
  note(text: string): void;
  /** Tell the app's change stream that `table` changed, so it reads again. */
  changed(table: string, id?: string): void;
}

export type DemoHandler = (input: Row, db: DemoDb, context: { method: string; path: string }) => unknown;

declare global {
  interface Window {
    __LEMMA_DEMO__?: DemoData;
    /** Function or workflow name (or `METHOD path` regex source) -> handler, from the plugin's `.lemma/demo.js`. */
    __LEMMA_DEMO_HANDLERS__?: Record<string, DemoHandler>;
    /** The in-memory sample, once the demo is on, for a plugin's demo.js. */
    __LEMMA_DEMO_DB__?: DemoDb;
  }
}

const EMPTY_LIST = { items: [], limit: 0, next_page_token: null, total: 0 };
const POD = "pod";

const SAMPLE_USER: Row = {
  id: "user-sample",
  email: "sam@example.com",
  first_name: "Sam",
  last_name: "Rivera",
  name: "Sam Rivera",
  is_active: true,
  is_superuser: false,
  is_verified: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

let data: DemoData = { plugin: "", app: "", apps: [], fixtures: {} };
let handlers: Record<string, DemoHandler> = {};
let installed = false;

/** The sample data, once the demo is on. */
export function demoData(): DemoData {
  return data;
}

/* ---------- dates that move with the calendar ---------- */

const DAY = 86_400_000;
const ISO = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const PROSE_DATE = /(^|[^\w/.-])(\d{4}-\d{2}-\d{2})([T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\w/-])/g;
/** Whole days every date moves by. */
let shiftDays = 0;
/** And what a time of day moves by, so its clock reading in the sample's zone is the same in the viewer's. */
let shiftZone = 0;
/** The sample's zone names (and old spellings of them) -> the viewer's zone. */
let zoneNames = new Map<string, string>();

/** A zone's offset from UTC in ms, at a moment. */
function offsetOf(zone: string, at: number): number {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(new Date(at))
      .find((p) => p.type === "timeZoneName")?.value || "";
    const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) * 60_000 : 0;
  } catch {
    return 0;
  }
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/**
 * A sample date or time, moved. A date alone moves by whole days. A time moves
 * by whole days and then by the gap between the sample's zone and the
 * viewer's, so a meeting the sample put at 10:00 is at 10:00 for whoever looks.
 * It keeps the sample's spelling: seconds, fraction and zone suffix.
 */
function shiftDate(date: string, time: string | undefined): string {
  if (!shiftDays && !shiftZone) return date + (time || "");
  if (!time) {
    const d = Date.parse(date + "T12:00:00Z");
    return Number.isNaN(d) ? date : new Date(d + shiftDays * DAY).toISOString().slice(0, 10);
  }
  const m = /^([T ])(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(time);
  if (!m) return date + time;
  const [, sep, hh, mm, ss, frac, suffix] = m;
  const zoneOffset = !suffix || suffix === "Z" ? 0 : (suffix[0] === "-" ? -1 : 1) * (Number(suffix.slice(1, 3)) * 60 + Number(suffix.slice(-2))) * 60_000;
  const instant = Date.parse(`${date}T${hh}:${mm}:${ss || "00"}Z`) - zoneOffset;
  if (Number.isNaN(instant)) return date + time;
  const local = new Date(instant + shiftDays * DAY + shiftZone + zoneOffset);
  const day = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  return `${day}${sep}${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}${ss !== undefined ? ":" + pad(local.getUTCSeconds()) : ""}${frac || ""}${suffix || ""}`;
}

function moveDates<T>(value: T): T {
  if (!shiftDays && !shiftZone && !zoneNames.size) return value;
  if (typeof value === "string") {
    const zone = zoneNames.get(value);
    if (zone) return zone as T;
    const m = ISO.exec(value);
    return (m ? shiftDate(m[1], m[2]) : value) as T;
  }
  if (Array.isArray(value)) return value.map(moveDates) as T;
  if (value && typeof value === "object") {
    const out: Row = {};
    for (const [k, v] of Object.entries(value as Row)) out[k] = moveDates(v);
    return out as T;
  }
  return value;
}

function moveProseDates(text: string): string {
  if (!shiftDays && !shiftZone) return text;
  return text.replace(PROSE_DATE, (_all, before: string, date: string, time: string | undefined) => before + shiftDate(date, time));
}

/* ---------- the in-memory copy ---------- */

/** Changes by id, then by table ("*" when the writer did not say which). */
const patches = new Map<string, Map<string, Row>>();
/** Rows taken out, by id, then by table ("*": out of every table). */
const removed = new Map<string, Set<string>>();
const added = new Map<string, Row[]>();
const runs = new Map<string, Row>();
const files = new Map<string, string>();

function idOf(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Row;
  const id = r.id ?? (r.data && typeof r.data === "object" ? (r.data as Row).id : undefined);
  return id == null ? null : String(id);
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "demo-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
}

function listOf(answer: unknown): { list: unknown[]; key: string | null } | null {
  if (Array.isArray(answer)) return { list: answer, key: null };
  if (!answer || typeof answer !== "object") return null;
  for (const key of ["items", "rows", "data"]) {
    const value = (answer as Row)[key];
    if (Array.isArray(value)) return { list: value, key };
  }
  return null;
}

/** What changed for this id in these tables (null: whichever table). */
function changesFor(id: string, tables: string[] | null): Row | undefined {
  const byTable = patches.get(id);
  if (!byTable) return undefined;
  let out: Row | undefined;
  for (const [table, change] of byTable) if (table === "*" || !tables || tables.includes(table)) out = { ...(out || {}), ...change };
  return out;
}

function isRemoved(id: string, tables: string[] | null): boolean {
  const from = removed.get(id);
  if (!from) return false;
  if (from.has("*") || !tables) return true;
  return tables.some((t) => from.has(t));
}

function withChanges(row: unknown, tables: string[] | null): unknown {
  const id = idOf(row);
  const change = id ? changesFor(id, tables) : undefined;
  if (!change || !row || typeof row !== "object") return row;
  const r = row as Row;
  if (r.data && typeof r.data === "object" && !Array.isArray(r.data)) return { ...r, data: { ...(r.data as Row), ...change } };
  return { ...r, ...change };
}

/** The query with what is inside brackets and quotes blanked out, so only its top level is read. */
function topLevel(sql: string): string {
  let depth = 0;
  let quoted = false;
  let out = "";
  for (const c of sql) {
    if (c === "'") quoted = !quoted;
    if (!quoted && c === "(") depth++;
    const blank = quoted || depth > 0 || c === "'";
    if (!quoted && c === ")") depth = Math.max(0, depth - 1);
    out += blank && c !== "(" && c !== ")" ? " " : c;
  }
  return out;
}

/** The tables a query reads at its top level: `from x`, `join public.x`, `from "x"`. The first is the one it lists. */
function tablesOf(sql: string): string[] {
  return [...topLevel(sql).matchAll(/\b(?:from|join)\s+(?:"?\w+"?\.)?"?(\w+)"?/gi)].map((m) => m[1].toLowerCase()).filter((t) => t !== "lateral");
}

/* A query's WHERE, as far as plain tests go: `a = 'x'`, `a <> 'x'`, `a in ('x', 'y')`,
   `a is [not] null`, `a = true`, joined by AND and OR, in brackets. A row this page
   changed or added is held to it, so a promise marked kept leaves the list of open
   ones; a row as the sample has it is not, since the sample already answered that
   query. A part it cannot read passes. */
type Cond = { kind: "test"; column: string; test: (value: unknown) => boolean } | { kind: "and" | "or"; parts: Cond[] } | { kind: "any" };

/** Split on a keyword at the top level: not inside brackets or quotes. */
function splitTop(text: string, word: "and" | "or"): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let last = 0;
  const re = new RegExp(`^\\s${word}\\s`, "i");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")") depth--;
    else if (!quoted && depth === 0 && re.test(text.slice(i, i + word.length + 2))) {
      // `between x and y` keeps its and.
      if (word === "and" && /\bbetween\s+\S+\s*$/i.test(text.slice(last, i))) continue;
      out.push(text.slice(last, i));
      last = i + word.length + 1;
    }
  }
  out.push(text.slice(last));
  return out.map((x) => x.trim()).filter(Boolean);
}

function unwrap(text: string): string {
  let t = text.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    let depth = 0;
    let closesAtEnd = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "(") depth++;
      else if (t[i] === ")") depth--;
      if (depth === 0 && i < t.length - 1) {
        closesAtEnd = false;
        break;
      }
    }
    if (!closesAtEnd) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

function readCond(text: string): Cond {
  const t = unwrap(text);
  const ors = splitTop(t, "or");
  if (ors.length > 1) return { kind: "or", parts: ors.map(readCond) };
  const ands = splitTop(t, "and");
  if (ands.length > 1) return { kind: "and", parts: ands.map(readCond) };
  const asText = (v: unknown) => (v == null ? null : String(v));
  let m = /^(?:\w+\.)?(\w+)\s*(=|<>|!=)\s*'([^']*)'$/.exec(t);
  if (m) {
    const [, column, op, value] = m;
    return { kind: "test", column, test: (v) => (op === "=" ? asText(v) === value : asText(v) !== value) };
  }
  m = /^(?:\w+\.)?(\w+)\s*(=|<>|!=)\s*(true|false)$/i.exec(t);
  if (m) {
    const [, column, op, value] = m;
    const want = value.toLowerCase() === "true";
    return { kind: "test", column, test: (v) => (op === "=" ? Boolean(v) === want : Boolean(v) !== want) };
  }
  m = /^(?:\w+\.)?(\w+)\s+(not\s+)?in\s*\(([^)]*)\)$/i.exec(t);
  if (m && /^\s*'[^']*'(\s*,\s*'[^']*')*\s*$/.test(m[3])) {
    const [, column, not, list] = m;
    const values = [...list.matchAll(/'([^']*)'/g)].map((x) => x[1]);
    return { kind: "test", column, test: (v) => values.includes(String(v)) !== Boolean(not) };
  }
  m = /^(?:\w+\.)?(\w+)\s+is\s+(not\s+)?null$/i.exec(t);
  if (m) {
    const [, column, not] = m;
    return { kind: "test", column, test: (v) => (v == null) !== Boolean(not) };
  }
  m = /^(?:not\s+)?(?:\w+\.)?(\w+)$/i.exec(t);
  if (m && !/^(true|false)$/i.test(m[1])) {
    const not = /^not\s/i.test(t);
    return { kind: "test", column: m[1], test: (v) => Boolean(v) !== not };
  }
  return { kind: "any" };
}

const whereCache = new Map<string, Cond>();
function whereOf(sql: string): Cond {
  let cond = whereCache.get(sql);
  if (!cond) {
    const top = topLevel(sql);
    const at = /\bwhere\b/i.exec(top);
    let where: string | undefined;
    if (at) {
      const from = at.index + at[0].length;
      const end = /\border\s+by\b|\bgroup\s+by\b|\blimit\b|\bhaving\b|\boffset\b|\bunion\b/i.exec(top.slice(from));
      where = sql.slice(from, end ? from + end.index : undefined);
    }
    cond = where && !/\bselect\b/i.test(where) ? readCond(where) : { kind: "any" };
    whereCache.set(sql, cond);
  }
  return cond;
}

/** Whether a row meets the WHERE; `only` limits it to the columns a change touched (others pass). */
function meets(cond: Cond, row: Row, only?: Row): boolean {
  switch (cond.kind) {
    case "any":
      return true;
    case "and":
      return cond.parts.every((c) => meets(c, row, only));
    case "or":
      return cond.parts.some((c) => meets(c, row, only));
    case "test":
      if (only ? !(cond.column in only) : !(cond.column in row)) return true;
      return cond.test(row[cond.column]);
  }
}

function flat(row: unknown): Row {
  const r = (row || {}) as Row;
  return r.data && typeof r.data === "object" && !Array.isArray(r.data) ? (r.data as Row) : r;
}

/** `order by col [asc|desc] [nulls first|last]`, its first key, when that is a plain column. */
function orderOf(sql: string): { column: string; desc: boolean; nullsFirst: boolean } | null {
  const m = /\border\s+by\s+(?:"?\w+"?\.)?"?(\w+)"?(\s+(?:asc|desc))?(\s+nulls\s+(?:first|last))?\s*(?:,|\blimit\b|\boffset\b|$)/i.exec(sql);
  if (!m) return null;
  const desc = /desc/i.test(m[2] || "");
  return { column: m[1], desc, nullsFirst: m[3] ? /first/i.test(m[3]) : desc };
}

function sortRows(list: unknown[], order: { column: string; desc: boolean; nullsFirst: boolean }): unknown[] {
  const key = (r: unknown) => flat(r)[order.column];
  return list
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const x = key(a.row);
      const y = key(b.row);
      if (x == null || y == null) return x == null && y == null ? a.i - b.i : (x == null) === order.nullsFirst ? -1 : 1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return c === 0 ? a.i - b.i : order.desc ? -c : c;
    })
    .map((x) => x.row);
}

/**
 * A read as the sample has it now: rows changed, rows taken out, rows added.
 * `tables` are the tables the read touches (null: any); added rows come from the first.
 */
function current(answer: unknown, tables: string[] | null, sql = "", addRows = true): unknown {
  const found = listOf(answer);
  if (!found) return answer;
  const cond = sql ? whereOf(sql) : ({ kind: "any" } as Cond);
  let touched = false;
  let list = found.list.filter((row) => {
    const id = idOf(row);
    if (id && isRemoved(id, tables)) return false;
    const change = id ? changesFor(id, tables) : undefined;
    if (change) touched = true;
    return !change || meets(cond, flat(withChanges(row, tables)), change);
  });
  list = list.map((row) => withChanges(row, tables));
  const main = tables?.[0];
  const extra = addRows && main ? added.get(main) : undefined;
  let grew = false;
  if (extra?.length && (list.length === 0 || idOf(list[0]) !== null)) {
    const have = new Set(list.map(idOf));
    const fresh = extra.filter((row) => !have.has(idOf(row)) && !isRemoved(String(row.id), tables) && meets(cond, row));
    grew = fresh.length > 0;
    list = [...fresh.map((row) => withChanges(row, tables)), ...list];
  }
  const order = sql && (grew || touched) ? orderOf(topLevel(sql)) : null;
  if (order) list = sortRows(list, order);
  if (found.key === null) return list;
  const out: Row = { ...(answer as Row), [found.key]: list };
  if (typeof out.total === "number") out.total = list.length;
  return out;
}

function fixture(path: string): unknown {
  return Object.prototype.hasOwnProperty.call(data.fixtures, path) ? data.fixtures[path] : undefined;
}

function isMatchList(value: unknown): value is { match: string; response?: unknown }[] {
  return Array.isArray(value) && value.length > 0 && value.every((e) => e && typeof e === "object" && "match" in (e as Row));
}

/** The first entry whose `match` is in the request body as sent, or in its SQL as written. */
function matched(value: unknown, body: string): unknown {
  if (!isMatchList(value)) return value;
  const raw = body.toLowerCase();
  const sql = String(parse(body).query ?? "").toLowerCase();
  for (const entry of value) {
    const match = String(entry.match).toLowerCase();
    if (raw.includes(match) || (sql && sql.includes(match))) return entry.response ?? EMPTY_LIST;
  }
  console.debug("[demo] no sample answer for this query:", body.slice(0, 240));
  return EMPTY_LIST;
}

/* ---------- the app's change stream ---------- */

interface Watcher {
  table?: string;
  onChange: (frame: Row) => void;
  closed: boolean;
}
const watchers = new Set<Watcher>();

function changed(table: string, id = "", operation: "insert" | "update" | "delete" = "update"): void {
  const frame = {
    type: `datastore.record.${operation}`,
    pod_id: POD,
    table_name: table,
    record_id: id,
    operation,
    payload: id && operation !== "delete" ? (find(id, table) ?? {}) : {},
    occurred_at: new Date().toISOString(),
  };
  window.setTimeout(() => {
    for (const w of [...watchers]) if (!w.closed && (!w.table || w.table === table)) w.onChange(frame);
  }, 60);
}

/* ---------- what handlers can do ---------- */

function ids(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : [value]).filter((x) => x != null).map(String);
}

function patch(which: string | string[], fields: Row, table?: string): void {
  const key = table || "*";
  for (const id of ids(which)) {
    const byTable = patches.get(id) || new Map<string, Row>();
    byTable.set(key, { ...(byTable.get(key) || {}), ...fields });
    patches.set(id, byTable);
    for (const [t, rows] of added) {
      if (table && t !== table) continue;
      const i = rows.findIndex((r) => String(r.id) === id);
      if (i >= 0) rows[i] = { ...rows[i], ...fields };
    }
    if (table) changed(table, id);
  }
}

function remove(which: string | string[], table?: string): void {
  for (const id of ids(which)) {
    const from = removed.get(id) || new Set<string>();
    from.add(table || "*");
    removed.set(id, from);
    if (table) changed(table, id, "delete");
  }
}

function add(table: string, row: Row): Row {
  const now = new Date().toISOString();
  const made: Row = { created_at: now, updated_at: now, ...row, id: row.id ?? newId() };
  const id = String(made.id);
  // A row put back, or moved here from another table, is in again.
  const from = removed.get(id);
  from?.delete(table);
  from?.delete("*");
  const list = (added.get(table) || []).filter((r) => String(r.id) !== id);
  list.unshift(made);
  added.set(table, list);
  changed(table, id, "insert");
  return made;
}

/** A row by id, as the sample has it now: one this page added, or any fixture's. `table` narrows which changes apply. */
function find(id: string, table?: string): Row | null {
  const tables = table ? [table] : null;
  if (isRemoved(id, tables)) return null;
  for (const [t, rows] of added) {
    if (table && t !== table) continue;
    const row = rows.find((r) => String(r.id) === id);
    if (row) return row;
  }
  const seen = (value: unknown): Row | null => {
    if (Array.isArray(value)) {
      for (const v of value) {
        const hit = seen(v);
        if (hit) return hit;
      }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    if (idOf(value) === id) {
      const row = withChanges(value, tables) as Row;
      return row.data && typeof row.data === "object" ? { id, ...(row.data as Row) } : row;
    }
    for (const v of Object.values(value as Row)) {
      const hit = seen(v);
      if (hit) return hit;
    }
    return null;
  };
  return seen(data.fixtures);
}

/** The rows of the query fixture whose `match` contains `text`, now; with `table`, that table's added rows too. */
function rows(text: string, table?: string): Row[] {
  const all = fixture(`pods/${POD}/datastore/query`);
  const needle = text.toLowerCase();
  const entry = isMatchList(all) ? all.find((e) => String(e.match).toLowerCase().includes(needle)) : undefined;
  const tables = table ? [table, ...tablesOf(entry?.match || "")] : tablesOf(entry?.match || "");
  const answer = current(entry ? entry.response : EMPTY_LIST, tables.length ? tables : null, "", Boolean(table));
  return ((listOf(answer)?.list || []) as Row[]).map((r) => (r.data && typeof r.data === "object" ? { id: r.id, ...(r.data as Row) } : r));
}

const db: DemoDb = {
  patch,
  remove,
  add,
  find,
  rows,
  fixture,
  file: (path, text) => {
    files.set(path, text);
  },
  note: (text) => demoNote(text),
  changed: (table, id) => changed(table, id),
};

/* ---------- answering the API ---------- */

function json(value: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function parse(body: string): Row {
  if (!body) return {};
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" ? (value as Row) : {};
  } catch {
    return {};
  }
}

const TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8", html: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  svg: "image/svg+xml", json: "application/json", csv: "text/csv; charset=utf-8",
};

function fileAnswer(path: string): Response {
  const sample = data.files || {};
  const name = path.split("/").pop() || "";
  const rooted = "/" + path.replace(/^\/+/, "");
  const text = files.get(path) ?? files.get(rooted) ?? sample[path] ?? sample[rooted] ?? sample[name];
  if (text == null) {
    console.debug("[demo] no sample file", path);
    return new Response("", { status: 404 });
  }
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "md";
  return new Response(text, { status: 200, headers: { "content-type": TYPES[ext] || "application/octet-stream" } });
}

function noteFor(name: string): void {
  const text = data.notes?.[name];
  if (text) demoNote(text);
}

async function run(kind: "function" | "workflow", name: string, input: Row, method: string, path: string): Promise<Row> {
  const handler = handlers[name];
  const id = newId();
  const now = new Date().toISOString();
  let output: unknown = {};
  if (handler) {
    output = (await handler(input, db, { method, path })) ?? {};
  } else {
    const canned = fixture(path);
    if (canned !== undefined) {
      noteFor(name);
      return (canned && typeof canned === "object" ? { id, ...(canned as Row) } : canned) as Row;
    }
  }
  if (!handler) noteFor(name);
  const record: Row =
    kind === "function"
      ? { id, function_name: name, status: "COMPLETED", input_data: input, output_data: output, created_at: now, updated_at: now, completed_at: now }
      : { id, workflow_name: name, status: "COMPLETED", output_data: output, created_at: now, updated_at: now, completed_at: now, active_wait: null };
  runs.set(id, record);
  return record;
}

async function answer(method: string, url: URL, body: string, form: FormData | null): Promise<Response> {
  const path = url.pathname.replace(/^\/+/, "");
  const key = `${method} ${path}`;
  for (const [pattern, handler] of Object.entries(handlers)) {
    if (!pattern.includes(" ")) continue;
    if (new RegExp(`^${pattern}$`).test(key)) return json((await handler(parse(body), db, { method, path })) ?? {});
  }

  if (path === "users/me") return json(data.user || SAMPLE_USER);
  if (path.startsWith("health")) return json({ status: "ok" });

  // A pod file: the sample's own text.
  if (/datastore\/files\/download$/.test(path)) return fileAnswer(url.searchParams.get("path") || "");

  // Records: the in-memory copy.
  const rec = /^pods\/[^/]+\/datastore\/tables\/([^/]+)\/records(?:\/(bulk\/(?:create|update|delete))|\/([^/]+))?$/.exec(path);
  if (rec && method !== "GET") {
    const [, table, bulk, id] = rec;
    const given = parse(body);
    if (bulk === "bulk/delete") {
      remove((given.record_ids || given.ids || []) as string[], table);
      return json({ deleted: ((given.record_ids || given.ids || []) as unknown[]).length });
    }
    if (bulk) {
      const list = ((given.records || given.items || []) as Row[]).map((r) => (r.data && typeof r.data === "object" ? { id: r.id, ...(r.data as Row) } : r));
      const out = list.map((r) => {
        if (bulk === "bulk/update" && r.id) {
          patch(String(r.id), r, table);
          return { id: r.id, data: find(String(r.id), table) || r };
        }
        const made = add(table, r);
        return { id: made.id, data: made };
      });
      return json({ items: out });
    }
    if (method === "DELETE" && id) {
      remove(id, table);
      return json({}, 200);
    }
    const fields = (given.data && typeof given.data === "object" ? given.data : given) as Row;
    if (id) {
      patch(id, fields, table);
      const row = find(id, table) || { id, ...fields };
      return json({ id, data: row, ...row });
    }
    const made = add(table, fields);
    return json({ id: made.id, data: made, created_at: made.created_at, updated_at: made.updated_at });
  }

  // Functions and workflows: a handler, the fixture, or done with nothing to show.
  const fn = /^pods\/[^/]+\/functions\/([^/]+)\/runs$/.exec(path);
  if (fn && method === "POST") return json(await run("function", fn[1], (parse(body).input_data as Row) || {}, method, path));
  const wf = /^pods\/[^/]+\/workflows\/([^/]+)\/runs$/.exec(path);
  if (wf && method === "POST") return json(await run("workflow", wf[1], parse(body), method, path));
  const wr = /^pods\/[^/]+\/workflow-runs\/([^/]+)(?:\/(form|cancel|retry))?$/.exec(path);
  if (wr && runs.has(wr[1])) {
    const record = runs.get(wr[1])!;
    if (wr[2] === "cancel") record.status = "CANCELLED";
    else if (wr[2]) record.status = "COMPLETED";
    return json(record);
  }

  // A fixture for this path, made current.
  const canned = fixture(path);
  if (canned !== undefined) {
    const answered = matched(canned, body);
    let tables: string[] | null = null;
    let sql = "";
    let grows = true;
    if (path.endsWith("/datastore/query")) {
      sql = String(parse(body).query || body);
      tables = tablesOf(sql);
      grows = !/\bcount\s*\(|\bgroup\s+by\b/i.test(sql);
    }
    const list = /^pods\/[^/]+\/datastore\/tables\/([^/]+)\/records$/.exec(path);
    if (list) tables = [list[1]];
    return json(current(answered, tables && tables.length ? tables : null, sql, grows));
  }

  if (path.endsWith("/datastore/query")) {
    const sql = String(parse(body).query || body);
    const tables = tablesOf(sql);
    if (tables[0] && added.get(tables[0])?.length && !/\bcount\s*\(|\bgroup\s+by\b/i.test(sql)) return json(current(EMPTY_LIST, tables, sql));
    console.debug("[demo] no sample answer for this query:", sql.slice(0, 240));
    return json(EMPTY_LIST);
  }
  const list = /^pods\/[^/]+\/datastore\/tables\/([^/]+)\/records$/.exec(path);
  if (list) return json(current(EMPTY_LIST, [list[1]]));

  if (/^organizations\/[^/]+\/connectors\/connect-requests/.test(path)) {
    demoNote("In a Lemma, this is where you connect your own account. The demo has nothing to connect.");
    return json({});
  }
  if (path === `pods/${POD}` && method === "GET") return json({ id: POD, name: "Sample Lemma", organization_id: "org-sample" });
  const schedule = /^pods\/[^/]+\/schedules(?:\/([^/]+))?$/.exec(path);
  if (schedule && method !== "GET") {
    const id = schedule[1] || newId();
    return json({ id, is_active: true, ...parse(body) });
  }
  if (/members\/lookup\/by-user-id\//.test(path)) {
    const user = data.user || SAMPLE_USER;
    return json({ pod_member_id: "member-sample", user_id: user.id, email: user.email, user_email: user.email, roles: ["POD_EDITOR"] });
  }
  if (/datastore\/files$/.test(path) && method === "POST") {
    const file = form?.get("file");
    const name = (form?.get("name") as string) || (file instanceof File ? file.name : "file");
    const folder = String(form?.get("directory_path") || form?.get("directoryPath") || "");
    demoNote("In the demo, files you add stay in this page.");
    return json({ path: `${folder.replace(/\/$/, "")}/${name}`, name });
  }
  if (method !== "GET") {
    console.debug("[demo] nothing changes for", method, path);
    return json({ ...EMPTY_LIST, id: newId(), ...parse(body) });
  }
  console.debug("[demo] no sample answer for", path);
  return json(EMPTY_LIST);
}

/* ---------- nothing leaves the page ---------- */

function sameOrigin(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin || u.protocol === "data:" || u.protocol === "blob:";
  } catch {
    return false;
  }
}

const GOOGLE_FONTS = /^https:\/\/fonts\.googleapis\.com\/css2?\?/;

/** A Google Fonts sheet as the copy beside the page, or nothing. */
function fontSheet(url: string): string {
  const families = new URL(url).searchParams.getAll("family").map((f) => f.split(":")[0].replace(/\+/g, " ").trim().toLowerCase());
  const fonts = data.fonts || {};
  const sheets = [...new Set(families.map((f) => fonts[f]).filter(Boolean))];
  if (!sheets.length) return "data:text/css,";
  if (sheets.length === 1) return new URL(sheets[0], window.location.href).href;
  const css = sheets.map((s) => `@import url("${new URL(s, window.location.href).href}");`).join("\n");
  return "data:text/css;charset=utf-8," + encodeURIComponent(css);
}

type Kind = "style" | "script" | "image" | "frame" | "other";
const NOTHING: Record<Kind, string> = {
  style: "data:text/css,",
  script: "data:text/javascript,",
  image: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  frame: "about:blank",
  other: "data:,",
};

function guardUrl(url: string, kind: Kind): string {
  if (!url || url.startsWith("about:") || sameOrigin(url)) return url;
  if (kind === "style" && GOOGLE_FONTS.test(url)) return fontSheet(url);
  console.debug("[demo] kept from the network:", url);
  return NOTHING[kind];
}

function guardProperty(proto: object, prop: string, kind: (el: Element) => Kind | null): void {
  const desc = Object.getOwnPropertyDescriptor(proto, prop);
  if (!desc?.set || !desc.get) return;
  Object.defineProperty(proto, prop, {
    ...desc,
    set(this: Element, value: string) {
      const k = kind(this);
      desc.set!.call(this, k ? guardUrl(String(value), k) : value);
    },
  });
}

function linkKind(el: Element): Kind | null {
  const rel = (el.getAttribute("rel") || "").toLowerCase();
  return rel.includes("stylesheet") ? "style" : rel.includes("preload") || rel.includes("prefetch") || rel.includes("modulepreload") ? "other" : null;
}

function guardNetwork(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const href = request ? request.url : input instanceof URL ? input.href : String(input);
    const method = (init?.method || request?.method || "GET").toUpperCase();
    if (href.startsWith(DEMO_API)) {
      let body = "";
      let form: FormData | null = null;
      const given = init?.body ?? null;
      if (typeof given === "string") body = given;
      else if (given instanceof FormData) form = given;
      else if (given instanceof URLSearchParams) body = given.toString();
      else if (given instanceof Blob) body = await given.text();
      else if (request && method !== "GET" && method !== "HEAD") body = await request.clone().text();
      await new Promise((r) => window.setTimeout(r, 40));
      return answer(method, new URL(href.slice(DEMO_API.length) || "/", "https://x.invalid"), body, form);
    }
    if (sameOrigin(href)) return realFetch(input as RequestInfo, init);
    console.debug("[demo] kept from the network:", href);
    throw new TypeError("The demo makes no network calls.");
  };

  class Quiet extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly readyState = 0;
    readonly url: string;
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;
    constructor(url: string | URL) {
      super();
      this.url = String(url);
      console.debug("[demo] kept from the network:", this.url);
    }
    send(): void {}
    close(): void {}
  }
  (window as unknown as { WebSocket: unknown }).WebSocket = Quiet;
  (window as unknown as { EventSource: unknown }).EventSource = Quiet;
  if (navigator.sendBeacon) navigator.sendBeacon = () => true;

  // Stylesheets and scripts an app adds itself (a brand's Google face, a widget's script).
  guardProperty(HTMLLinkElement.prototype, "href", linkKind);
  guardProperty(HTMLScriptElement.prototype, "src", () => "script");
  guardProperty(HTMLImageElement.prototype, "src", () => "image");
  guardProperty(HTMLIFrameElement.prototype, "src", () => "frame");
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    const n = name.toLowerCase();
    let kind: Kind | null = null;
    if (this instanceof HTMLLinkElement && n === "href") kind = linkKind(this);
    else if (n === "src") kind = this instanceof HTMLScriptElement ? "script" : this instanceof HTMLImageElement ? "image" : this instanceof HTMLIFrameElement ? "frame" : null;
    return setAttribute.call(this, name, kind ? guardUrl(String(value), kind) : value);
  };

  // Links and windows that would leave the demo: say where they go instead. A
  // demo is framed by a web page, so leaving would take that page (or the
  // frame) somewhere the demo cannot follow.
  const open = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    const href = url == null ? "" : String(url);
    if (!href || /^(blob:|data:)/.test(href) || (insideDemo(href) && target !== "_top" && target !== "_parent")) return open(url, target, features);
    leaving(href);
    return null;
  };
  document.addEventListener(
    "click",
    (event) => {
      const a = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#") || /^(blob:|data:|javascript:)/i.test(href)) return;
      const target = (a.getAttribute("target") || "").toLowerCase();
      if (insideDemo(a.href) && target !== "_top" && target !== "_parent") return;
      event.preventDefault();
      leaving(a.href);
    },
    true,
  );
}

/** The folder the demo's pages are in (where the first app's page is). */
function demoRoot(): string {
  const first = data.apps[0];
  const here = data.apps.find((a) => a.name === data.app);
  try {
    const root = new URL(first && here ? first.href : "./", window.location.href);
    return root.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  } catch {
    return window.location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  }
}

function insideDemo(href: string): boolean {
  try {
    return new URL(href, window.location.href).href.startsWith(demoRoot());
  } catch {
    return false;
  }
}

function leaving(href: string): void {
  let where = "";
  try {
    const u = new URL(href, window.location.href);
    where = u.origin === window.location.origin ? "another page of the Lemma" : u.hostname.replace(/^www\./, "");
  } catch {
    where = "another page";
  }
  demoNote(`In a Lemma, this opens ${where}. The demo stays on this page.`);
}

/* ---------- where the app is: the page's #fragment ---------- */

let path = "/";
const pathListeners = new Set<(path: string) => void>();

function clean(value: string): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 512) return null;
  const trimmed = value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
  if (trimmed === "/") return "/";
  const parts = trimmed.slice(1).split("/");
  return parts.every((p) => p && p !== "." && p !== ".." && !/[?#\\\s]/.test(p)) ? "/" + parts.join("/") : null;
}

function fromHash(): string | null {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;
  try {
    return clean(decodeURI(raw));
  } catch {
    return clean(raw);
  }
}

export function demoPath(): string {
  return path;
}

/** Move inside the app. Its own step in the frame's history, so the app's Back goes back inside it. */
export function demoMove(next: string): string | null {
  const at = clean(next);
  if (at === null) return null;
  if (at !== path) {
    path = at;
    try {
      window.history.pushState(window.history.state, "", "#" + at);
    } catch {
      /* the frame may refuse; the app still moves */
    }
  }
  document.getElementById("root")?.scrollTo({ top: 0 });
  return at;
}

export function demoWatchPath(listener: (path: string) => void): () => void {
  pathListeners.add(listener);
  return () => pathListeners.delete(listener);
}

/** Open an app of this plugin at `path`; any other app gets a note. */
export function demoOpenApp(app: string, at = "/"): Promise<boolean> {
  const target = clean(at) || "/";
  const entry = data.apps.find((a) => a.name === app);
  if (entry?.name === data.app) {
    demoMove(target);
    for (const l of [...pathListeners]) l(path);
    return Promise.resolve(true);
  }
  if (entry) {
    window.location.assign(new URL(entry.href, window.location.href).href.replace(/#.*$/, "") + "#" + target);
    return Promise.resolve(true);
  }
  const name = data.labels?.[app] || app.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  demoNote(`In a Lemma, this opens the ${name} app. It isn't part of this demo.`);
  return Promise.resolve(false);
}

/* ---------- the bar and its notes ---------- */

const STYLE = `
:root.c-demo-on { --c-demo-bar: 34px; }
:root.c-demo-on, :root.c-demo-on body { height: 100%; overflow: hidden; }
:root.c-demo-on #root { height: calc(100vh - var(--c-demo-bar)); height: calc(100dvh - var(--c-demo-bar)); overflow: auto; overscroll-behavior: contain; }
.c-demo { position: relative; z-index: 40; display: flex; align-items: center; gap: 10px; height: var(--c-demo-bar); padding: 0 var(--gutter); background: var(--c-subtle); border-bottom: 1px solid var(--c-border); color: var(--c-muted); font: 400 12px/1 var(--c-font); white-space: nowrap; overflow: hidden; }
.c-demo__text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.c-demo__text b { color: var(--c-text); font-weight: 500; }
.c-demo__short { display: none; }
.c-demo .c-seg { flex: none; }
.c-demo .c-seg a { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 7px; color: var(--c-muted); font-size: 12px; font-weight: 500; }
.c-demo .c-seg a:hover { color: var(--c-text); }
.c-demo .c-seg a[aria-current="page"] { background: var(--c-panel); color: var(--c-text); box-shadow: var(--c-shadow); }
.c-demo-notes { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 90; display: grid; gap: 6px; pointer-events: none; width: max-content; max-width: min(560px, 92vw); }
.c-demo-notes .c-toast { white-space: normal; }
@media (max-width: 640px) { .c-demo { gap: 8px; } .c-demo__long { display: none; } .c-demo__short { display: inline; } .c-demo-notes { bottom: 72px; } }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function drawBar(): void {
  const style = el("style", "");
  style.textContent = STYLE;
  document.head.appendChild(style);
  document.documentElement.classList.add("c-demo-on");
  const bar = el("div", "c-demo");
  bar.setAttribute("role", "note");
  const text = el("span", "c-demo__text");
  const long = el("span", "c-demo__long");
  long.append(el("b", "", "Sample data, made up."), " Nothing you do here is saved.");
  const short = el("span", "c-demo__short");
  short.append(el("b", "", data.apps.length > 1 ? "Sample." : "Sample data."), " Nothing is saved.");
  text.append(long, short);
  bar.append(text);
  if (data.apps.length > 1) {
    const nav = el("nav", "c-seg");
    nav.setAttribute("aria-label", "Apps in this demo");
    for (const app of data.apps) {
      const a = el("a", "", app.label);
      a.href = app.href;
      if (app.name === data.app) a.setAttribute("aria-current", "page");
      nav.append(a);
    }
    bar.append(nav);
  }
  document.body.prepend(bar);
}

let notes: HTMLElement | null = null;

/** A short line at the bottom of the page, in the kit's toast. */
export function demoNote(text: string): void {
  if (typeof document === "undefined") return;
  if (!notes) {
    notes = el("div", "c-demo-notes");
    notes.setAttribute("role", "status");
    notes.setAttribute("aria-live", "polite");
    document.body.appendChild(notes);
  }
  const toast = el("div", "c-toast", text);
  notes.appendChild(toast);
  while (notes.children.length > 2) notes.firstElementChild?.remove();
  window.setTimeout(() => toast.remove(), 5200);
}

/* ---------- turning it on ---------- */

/** Turn the demo on and say how the client should be made. Once per page, before the client. */
export function startDemo(): { apiUrl: string; authUrl: string; podId: string; token: string; app: { name: string } } {
  const config = { apiUrl: DEMO_API, authUrl: DEMO_API + "/auth", podId: POD, token: "demo", app: { name: "Demo" } };
  if (installed || typeof window === "undefined") return config;
  installed = true;
  const given = window.__LEMMA_DEMO__;
  if (given) data = given;
  handlers = window.__LEMMA_DEMO_HANDLERS__ || {};
  config.app.name = data.apps.find((a) => a.name === data.app)?.label || data.app || "Demo";
  const now = Date.now();
  const sampleZones = (Array.isArray(data.zone) ? data.zone : data.zone ? [data.zone] : []).filter(Boolean);
  if (sampleZones.length) {
    let viewer = "UTC";
    try {
      viewer = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      /* UTC */
    }
    shiftZone = offsetOf(sampleZones[0], now) - offsetOf(viewer, now);
    zoneNames = new Map(sampleZones.map((z) => [z, viewer]));
  }
  if (data.anchor) {
    // The sample's day becomes today. An anchor with a time is the moment the
    // sample was written: if that moment would still be ahead today, the
    // sample's day becomes yesterday, so nothing it wrote reads as future.
    const [day, time] = data.anchor.split("T");
    const anchor = Date.parse(day + "T12:00:00Z");
    if (!Number.isNaN(anchor)) {
      const today = new Date(now);
      shiftDays = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12) - anchor) / DAY);
      const written = time ? Date.parse(data.anchor) : NaN;
      if (!Number.isNaN(written) && written + shiftDays * DAY + shiftZone > now) shiftDays -= 1;
    }
  }
  if (shiftDays || shiftZone || zoneNames.size) {
    data = { ...data, fixtures: moveDates(data.fixtures), files: Object.fromEntries(Object.entries(data.files || {}).map(([k, v]) => [k, moveProseDates(v)])) };
  }
  // A plugin's demo.js reads the sample with its dates moved, and can change it
  // from code that is not a handler (a stand-in for a script the app loads).
  window.__LEMMA_DEMO__ = data;
  window.__LEMMA_DEMO_DB__ = db;
  guardNetwork();
  path = fromHash() || clean(data.start || "/") || "/";
  try {
    window.history.replaceState(window.history.state, "", "#" + path);
  } catch {
    /* refused: the app still starts there */
  }
  window.addEventListener("popstate", () => {
    const next = fromHash() || "/";
    if (next === path) return;
    path = next;
    for (const l of [...pathListeners]) l(path);
  });
  const draw = () => drawBar();
  if (document.body) draw();
  else document.addEventListener("DOMContentLoaded", draw, { once: true });
  return config;
}

interface ClientParts {
  datastore: { watchChanges: unknown };
  apps: { open: unknown };
}

/** The client's change stream and app opening, answered here. */
export function wireDemo(client: unknown): void {
  const c = client as ClientParts;
  c.datastore.watchChanges = (options: { table?: string; onChange: (frame: Row) => void; onStatus?: (s: string) => void; onReady?: (i: { since: string }) => void }) => {
    const watcher: Watcher = { table: options.table, onChange: options.onChange, closed: false };
    watchers.add(watcher);
    window.setTimeout(() => {
      options.onStatus?.("open");
      options.onReady?.({ since: "demo" });
    }, 0);
    const handle = {
      get closed() {
        return watcher.closed;
      },
      close() {
        watcher.closed = true;
        watchers.delete(watcher);
      },
    };
    return Object.assign(handle, { stop: handle.close, unsubscribe: handle.close });
  };
  c.apps.open = (app: string, at?: string) => demoOpenApp(app, at);
}
