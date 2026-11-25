// Every number on screen, worked out in the page from the rows, the same way
// Sprints' functions work them out (functions/sprints_capacity, sprints_tick,
// sprints_close_prepare). Nothing is rounded up: `num` cuts to one decimal.

import type { Away, Item, Measure, PersonCap, Sprint, SprintEvent, Suggestion, Task } from "./types";
import { ASSISTANT } from "./types";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY = 86_400_000;
export const PRIORITY: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
export const SOURCE_NAMES: Record<string, string> = {
  incidents: "Incidents", triage: "Triage", pr_review: "PR review", tasks: "Tasks", chat: "Chat", promise: "A promise", sprints: "Sprints",
  linear: "Linear", jira: "Jira",
};

/** A number said without rounding up: cut to one decimal, no trailing .0. */
export function num(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0";
  const cut = Math.floor(value * 10 + 1e-9) / 10;
  return Number.isInteger(cut) ? String(cut) : cut.toFixed(1);
}

export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 10 && v <= 20 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] || "th";
  return `${n}${suffix}`;
}

export function joined(words: string[]): string {
  const w = words.filter(Boolean);
  if (w.length <= 1) return w.join("");
  return `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n === 1 ? one : many}`;
}

/* ---------- days ---------- */

export function todayKey(zone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function dayOf(key: string): Date {
  return new Date(`${key.slice(0, 10)}T12:00:00Z`);
}

export function keyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
  return keyOf(new Date(dayOf(key).getTime() + days * DAY));
}

export function weekday(key: string): number {
  return (dayOf(key).getUTCDay() + 6) % 7; // Monday 0
}

/** The day a moment falls on, in the Lemma's zone. */
export function localKey(at: string | null | undefined, zone?: string | null): string | null {
  if (!at) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  } catch {
    return at.slice(0, 10);
  }
}

/** Hours since local midnight, for where in its day a moment sits. */
function localHour(at: string, zone?: string | null): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
    const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
    return h + m / 60;
  } catch {
    return 12;
  }
}

export function workingDays(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start.slice(0, 10); d <= end.slice(0, 10); d = addDays(d, 1)) if (weekday(d) < 5) out.push(d);
  return out;
}

const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDay(key: string): string {
  return `${SHORT[weekday(key)]} ${dayOf(key).getUTCDate()}`;
}
export function monthDay(key: string): string {
  const d = dayOf(key);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
export function longDay(key: string): string {
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][weekday(key)];
}
export function range(start: string, end: string): string {
  const a = dayOf(start), b = dayOf(end);
  return a.getUTCMonth() === b.getUTCMonth() ? `${monthDay(start)} – ${monthDay(end)}` : `${monthDay(start)} – ${monthDay(end)}`;
}
export function clock(at: string, zone?: string | null): string {
  const key = localKey(at, zone) || at.slice(0, 10);
  const h = localHour(at, zone);
  return `${shortDay(key)}, ${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
}

/** Days off as ranges: "Thu 26 – Fri 27", "Dec 11". */
export function awayText(days: string[], withMonth = false): string {
  const sorted = [...days].sort();
  const runs: string[][] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && (addDays(prev, 1) === d || (weekday(prev) === 4 && addDays(prev, 3) === d))) last.push(d);
    else runs.push([d]);
  }
  const say = withMonth ? monthDay : shortDay;
  return runs.map((r) => (r.length > 1 ? `${say(r[0])} – ${withMonth && dayOf(r[0]).getUTCMonth() === dayOf(r[r.length - 1]).getUTCMonth() ? dayOf(r[r.length - 1]).getUTCDate() : say(r[r.length - 1])}` : say(r[0]))).join(", ");
}

/* ---------- who ---------- */

export interface Who {
  kind: "person" | "agent" | "none";
  key: string;
  name: string;
  userId?: string | null;
  agent?: string;
}

export function personKey(userId: string | null | undefined, name: string | null | undefined): string {
  return userId ? String(userId) : `name:${String(name || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ")}`;
}

export function whoOf(t: Pick<Task, "assignee_kind" | "assignee_user_id" | "assignee_name" | "assignee_agent"> | undefined): Who {
  if (!t) return { kind: "none", key: "none", name: "Nobody yet" };
  if (t.assignee_kind === "agent") {
    const agent = t.assignee_agent || ASSISTANT;
    return { kind: "agent", key: `agent:${agent}`, name: agent === ASSISTANT ? "The Lemma's assistant" : agent, agent };
  }
  if (t.assignee_kind === "person" && (t.assignee_user_id || t.assignee_name)) {
    return { kind: "person", key: personKey(t.assignee_user_id, t.assignee_name), name: t.assignee_name || "Someone", userId: t.assignee_user_id };
  }
  return { kind: "none", key: "none", name: "Nobody yet" };
}

export function firstName(name: string): string {
  return name.startsWith("The Lemma") ? "The Lemma's assistant" : name.split(/\s+/)[0] || name;
}

/* ---------- the world, indexed ---------- */

export interface World {
  measure: Measure;
  zone: string | null;
  today: string;
  sprints: Sprint[];
  running: Sprint | null;
  planned: Sprint | null;
  closed: Sprint[];
  tasks: Map<string, Task>;
  items: Item[];
  itemsBy: Map<string, Item[]>; // sprint id -> items
  itemsOfTask: Map<string, Item[]>;
  est: Map<string, number>;
  events: SprintEvent[];
  away: Away[];
  suggestions: Suggestion[];
  sprintById: Map<string, Sprint>;
  sprintByNumber: Map<number, Sprint>;
}

export function world(input: {
  measure: Measure; zone: string | null; sprints: Sprint[]; tasks: Task[]; items: Item[]; est: { id: string; points: number }[];
  events: SprintEvent[]; away: Away[]; suggestions: Suggestion[];
}): World {
  const sprints = [...input.sprints].sort((a, b) => a.number - b.number);
  const itemsBy = new Map<string, Item[]>();
  const itemsOfTask = new Map<string, Item[]>();
  for (const i of input.items) {
    (itemsBy.get(i.sprint_id) || itemsBy.set(i.sprint_id, []).get(i.sprint_id)!).push(i);
    (itemsOfTask.get(i.task_id) || itemsOfTask.set(i.task_id, []).get(i.task_id)!).push(i);
  }
  return {
    measure: input.measure,
    zone: input.zone,
    today: todayKey(input.zone),
    sprints,
    running: sprints.find((s) => s.state === "running" || s.state === "closing") || null,
    planned: sprints.find((s) => s.state === "planned") || null,
    closed: sprints.filter((s) => s.state === "closed"),
    tasks: new Map(input.tasks.map((t) => [t.id, t])),
    items: input.items,
    itemsBy,
    itemsOfTask,
    est: new Map(input.est.map((e) => [e.id, Number(e.points)])),
    events: [...input.events].sort((a, b) => a.at.localeCompare(b.at)),
    away: input.away,
    suggestions: input.suggestions,
    sprintById: new Map(sprints.map((s) => [s.id, s])),
    sprintByNumber: new Map(sprints.map((s) => [s.number, s])),
  };
}

/** A task's size in the measure: its estimate (0 when there is none), or 1. */
export function size(w: World, taskId: string, measure: Measure = w.measure): number {
  return measure === "tasks" ? 1 : w.est.get(taskId) ?? 0;
}

/** An item's size in its sprint: as it stood at the close for a closed sprint, else the task's estimate now. */
export function itemSize(w: World, i: Item, measure: Measure = w.measure): number {
  if (measure === "tasks") return 1;
  const sprint = w.sprintById.get(i.sprint_id);
  if (sprint?.state === "closed" && i.closed_points != null) return Number(i.closed_points);
  return w.est.get(i.task_id) ?? 0;
}

export function present(items: Item[]): Item[] {
  return items.filter((i) => !i.removed_at);
}

export function isDone(w: World, i: Item): boolean {
  return i.outcome === "done" || w.tasks.get(i.task_id)?.status === "done";
}

/** The sprints a task was in, by number. */
export function sprintsOf(w: World, taskId: string): number[] {
  return (w.itemsOfTask.get(taskId) || []).map((i) => w.sprintById.get(i.sprint_id)?.number || 0).filter(Boolean).sort((a, b) => a - b);
}

/* ---------- a sprint's numbers ---------- */

export interface Numbers {
  inAtStart: { size: number; tasks: number };
  added: { size: number; tasks: number; sources: number; done: number };
  removed: { size: number; tasks: number };
  done: { size: number; tasks: number; ofPlan: number };
  notDone: { size: number; tasks: number };
  scope: number;
  days: string[];
  gone: number;
  target: number;
  pace: number | null;
  unestimated: number;
}

export function numbers(w: World, sprint: Sprint, measure: Measure = w.measure): Numbers {
  const items = w.itemsBy.get(sprint.id) || [];
  const plan = items.filter((i) => i.in_at_start);
  const added = items.filter((i) => !i.in_at_start);
  const removed = items.filter((i) => i.removed_at);
  const here = present(items);
  const done = here.filter((i) => isDone(w, i));
  const s = (i: Item) => itemSize(w, i, measure);
  // In at start is frozen: the estimates as they were when the sprint started.
  const startSize = (i: Item) => (measure === "tasks" ? 1 : Number(i.points_at_add ?? 0));
  const days = workingDays(sprint.starts_on, sprint.ends_on);
  const gone = days.filter((d) => d < w.today).length;
  const scope = here.reduce((a, i) => a + s(i), 0);
  const doneSize = done.reduce((a, i) => a + s(i), 0);
  return {
    inAtStart: { size: plan.reduce((a, i) => a + startSize(i), 0), tasks: plan.length },
    added: {
      size: added.reduce((a, i) => a + s(i), 0), tasks: added.length,
      sources: new Set(added.map((i) => w.tasks.get(i.task_id)?.source || "tasks")).size,
      done: added.filter((i) => !i.removed_at && isDone(w, i)).reduce((a, i) => a + s(i), 0),
    },
    removed: { size: removed.reduce((a, i) => a + s(i), 0), tasks: removed.length },
    done: { size: doneSize, tasks: done.length, ofPlan: done.filter((i) => i.in_at_start).reduce((a, i) => a + s(i), 0) },
    notDone: { size: scope - doneSize, tasks: here.length - done.length },
    scope,
    days,
    gone,
    target: days.length ? (scope * gone) / days.length : 0,
    pace: gone >= 1 && gone < days.length ? (doneSize / gone) * days.length : null,
    unestimated: measure === "points" ? here.filter((i) => !w.est.has(i.task_id)).length : 0,
  };
}

/* ---------- the scope graph ---------- */

export interface Point { x: number; y: number }
export interface Step { n: number; x: number; y: number; at: string; delta: number; what: string; kind: "added" | "removed" }
export interface Series {
  slots: number;
  todayX: number | null;
  scope: Point[];
  future: Point[];
  started: Point[];
  done: Point[];
  target: Point[];
  projection: Point[];
  steps: Step[];
  max: number;
  labels: { x: number; text: string }[];
}

/** Where a moment sits on the sprint's working days: day index + share of the day (09:00 to 18:00). */
function xOf(at: string | null | undefined, days: string[], zone: string | null): number {
  if (!at || !days.length) return 0;
  const key = localKey(at, zone) || at.slice(0, 10);
  if (key < days[0]) return 0;
  if (key > days[days.length - 1]) return days.length;
  let i = days.indexOf(key);
  if (i < 0) {
    i = days.findIndex((d) => d > key); // a weekend: the next working day's start
    return i < 0 ? days.length : i;
  }
  const h = localHour(at, zone);
  return i + Math.min(1, Math.max(0, (h - 9) / 9));
}

export function series(w: World, sprint: Sprint, measure: Measure = w.measure): Series {
  const items = w.itemsBy.get(sprint.id) || [];
  const days = workingDays(sprint.starts_on, sprint.ends_on);
  const slots = days.length;
  const closed = sprint.state === "closed";
  const nowX = closed ? slots : w.today < days[0] ? 0 : w.today > days[slots - 1] ? slots : xOf(new Date().toISOString(), days, w.zone);
  const reest = w.events.filter((e) => e.sprint_id === sprint.id && e.kind === "estimated");
  // Each item's size at a moment: as added, then every re-estimate.
  const sizeAt = (i: Item, x: number): number => {
    if (measure === "tasks") return 1;
    if (closed && i.closed_points != null) return Number(i.closed_points);
    let v = Number(i.points_at_add ?? w.est.get(i.task_id) ?? 0);
    for (const e of reest) if (e.task_id === i.task_id && xOf(e.at, days, w.zone) <= x) v = Number((e.detail as { to?: number })?.to ?? 0);
    return v;
  };
  const inAt = (i: Item, x: number) => (i.in_at_start ? true : xOf(i.added_at, days, w.zone) <= x) && !(i.removed_at && xOf(i.removed_at, days, w.zone) <= x);
  const valueAt = (x: number, what: "scope" | "started" | "done") =>
    items.reduce((a, i) => {
      if (!inAt(i, x)) return a;
      if (what === "done" && !(i.done_at && xOf(i.done_at, days, w.zone) <= x)) return a;
      if (what === "started" && !((i.started_at && xOf(i.started_at, days, w.zone) <= x) || (i.done_at && xOf(i.done_at, days, w.zone) <= x))) return a;
      return a + sizeAt(i, x);
    }, 0);
  // Moments where something changed, up to now.
  const marks = new Set<number>([0]);
  for (const i of items) for (const at of [i.added_at, i.removed_at, i.started_at, i.done_at]) if (at) marks.add(xOf(at, days, w.zone));
  for (const e of reest) marks.add(xOf(e.at, days, w.zone));
  for (let d = 1; d <= slots; d++) marks.add(d);
  const until = Math.max(0, nowX);
  const xs = [...marks].filter((x) => x <= until + 1e-9).sort((a, b) => a - b);
  if (!xs.includes(until)) xs.push(until);
  const stepped = (what: "scope" | "started" | "done"): Point[] => {
    const out: Point[] = [];
    let last: number | null = null;
    for (const x of xs) {
      const v = valueAt(x, what);
      if (last !== null && v !== last) out.push({ x, y: last });
      out.push({ x, y: v });
      last = v;
    }
    return out;
  };
  const scope = stepped("scope");
  const done = stepped("done");
  const started = stepped("started");
  const scopeNow = scope.length ? scope[scope.length - 1].y : 0;
  const doneNow = done.length ? done[done.length - 1].y : 0;
  const gone = days.filter((d) => d < w.today).length;
  const pace = !closed && gone >= 1 && gone < slots ? (doneNow / gone) * slots : null;
  // The steps: what was added or taken out after the start, grouped by the minute and who.
  const evs = w.events.filter((e) => e.sprint_id === sprint.id && (e.kind === "added" || e.kind === "removed"));
  const groups = new Map<string, SprintEvent[]>();
  for (const e of evs) {
    const k = `${e.kind}|${e.at.slice(0, 16)}|${e.actor_name || ""}`;
    (groups.get(k) || groups.set(k, []).get(k)!).push(e);
  }
  const steps: Step[] = [];
  for (const [, grp] of [...groups.entries()].sort((a, b) => a[1][0].at.localeCompare(b[1][0].at))) {
    const e = grp[0];
    const x = xOf(e.at, days, w.zone);
    const delta = grp.reduce((a, g) => {
      const item = items.find((i) => i.task_id === g.task_id);
      return a + (item ? sizeAt(item, x) : 0);
    }, 0) * (e.kind === "removed" ? -1 : 1);
    const tags = grp.map((g) => `#${w.tasks.get(g.task_id)?.number ?? "?"}`);
    const one = grp.length === 1 ? w.tasks.get(e.task_id) : null;
    const src = one?.source && !["tasks", "chat"].includes(one.source) ? one.source : grp.map((g) => w.tasks.get(g.task_id)?.source).find((s) => s && !["tasks", "chat"].includes(s));
    const from = e.kind === "removed"
      ? ((e.detail as { to?: string })?.to === "next" ? "moved to the next sprint" : "back to the backlog")
      : src ? `from ${SOURCE_NAMES[src] || src}${one?.source_id ? `, ${one.source_id}` : ""}` : "added";
    const what = [one ? `${tags[0]} ${one.title}` : tags.join(", "), from, e.actor_name].filter(Boolean).join(" · ");
    steps.push({ n: steps.length + 1, x, y: valueAt(x, "scope"), at: e.at, delta, what, kind: e.kind as "added" | "removed" });
  }
  const max = Math.max(1, scopeNow, ...scope.map((p) => p.y), pace || 0);
  const labels = [{ x: 0, text: shortDay(days[0] || sprint.starts_on) }];
  const fri = days.findIndex((d, k) => k > 0 && k < slots - 1 && weekday(d) === 4);
  if (fri > 0) labels.push({ x: fri + 1, text: shortDay(days[fri]) });
  labels.push({ x: slots, text: shortDay(days[slots - 1] || sprint.ends_on) });
  return {
    slots,
    todayX: closed || nowX <= 0 || nowX >= slots ? null : nowX,
    scope,
    future: !closed && nowX < slots ? [{ x: until, y: scopeNow }, { x: slots, y: scopeNow }] : [],
    started,
    done,
    target: [{ x: 0, y: 0 }, { x: slots, y: scopeNow }],
    projection: pace != null ? [{ x: until, y: doneNow }, { x: slots, y: Math.min(pace, Math.max(pace, doneNow)) }] : [],
    steps,
    max,
    labels,
  };
}

/* ---------- capacity, as sprints_capacity works it out ---------- */

export interface Capacity {
  days: number;
  people: PersonCap[];
  agents: { agent: string; tasks: number; last?: { tasks: number; done: number } | null }[];
  total: number | null;
  planned: number;
  nobody: number;
}

export function capacity(w: World, sprint: Sprint, measure: Measure = w.measure): Capacity {
  const days = workingDays(sprint.starts_on, sprint.ends_on);
  const closed = w.closed.filter((c) => c.number < sprint.number).sort((a, b) => b.number - a.number);
  const field = measure === "points" ? "points" : "tasks";
  const hist = new Map<string, { sprint: number; value: number }[]>();
  const names = new Map<string, string>();
  const users = new Map<string, string | null>();
  for (const c of closed) {
    for (const [key, p] of Object.entries(c.stats?.by_person || {})) {
      (hist.get(key) || hist.set(key, []).get(key)!).push({ sprint: c.number, value: Number(p[field] || 0) });
      if (!names.has(key)) names.set(key, p.name);
      if (!users.has(key)) users.set(key, p.user_id || null);
    }
  }
  const planned = new Map<string, number>();
  const count = new Map<string, number>();
  const agents = new Map<string, number>();
  let nobody = 0;
  for (const i of present(w.itemsBy.get(sprint.id) || [])) {
    const t = w.tasks.get(i.task_id);
    const who = whoOf(t);
    const s = size(w, i.task_id, measure);
    if (who.kind === "person") {
      planned.set(who.key, (planned.get(who.key) || 0) + s);
      count.set(who.key, (count.get(who.key) || 0) + 1);
      names.set(who.key, who.name);
      users.set(who.key, who.userId || null);
    } else if (who.kind === "agent") agents.set(who.agent!, (agents.get(who.agent!) || 0) + 1);
    else nobody += s;
  }
  const off = new Map<string, { day: string; part: string }[]>();
  for (const a of w.away) {
    if (a.day < sprint.starts_on || a.day > sprint.ends_on || weekday(a.day) >= 5) continue;
    const key = personKey(a.member_id, a.name);
    (off.get(key) || off.set(key, []).get(key)!).push({ day: a.day.slice(0, 10), part: a.part });
    if (!names.has(key)) names.set(key, a.name);
  }
  const recent = new Set(closed.slice(0, 3).flatMap((c) => Object.keys(c.stats?.by_person || {})));
  const keys = [...new Set([...recent, ...planned.keys(), ...off.keys()])].filter((k) => !k.startsWith("agent:") && k !== "none")
    .sort((a, b) => (names.get(a) || "").localeCompare(names.get(b) || ""));
  let total = 0;
  let any = false;
  const people: PersonCap[] = keys.map((key) => {
    const last3 = (hist.get(key) || []).slice(0, 3);
    const usual = last3.length ? last3.reduce((a, h) => a + h.value, 0) / last3.length : null;
    const daysOff = (off.get(key) || []).reduce((a, o) => a + (o.part === "half" ? 0.5 : 1), 0);
    const presentDays = Math.max(0, days.length - daysOff);
    const cap = usual != null && days.length ? (usual * presentDays) / days.length : null;
    if (cap != null) { total += cap; any = true; }
    return { key, name: names.get(key) || "Someone", user_id: users.get(key) || null, usual, history: last3, days: days.length, days_off: daysOff,
      present_days: presentDays, away: off.get(key) || [], cap, planned: planned.get(key) || 0, tasks: count.get(key) || 0 };
  });
  const lastStats = closed[0]?.stats?.agents || {};
  const agentRows = [...agents.entries()].sort().map(([agent, tasks]) => ({ agent, tasks, last: lastStats[agent] || null }));
  for (const [agent, last] of Object.entries(lastStats)) if (!agents.has(agent)) agentRows.push({ agent, tasks: 0, last });
  return { days: days.length, people, agents: agentRows, total: any ? total : null, planned: [...planned.values()].reduce((a, b) => a + b, 0), nobody };
}

/* ---------- the plan's draft ---------- */

export interface Draft {
  adds: { taskId: string; who: PersonCap; reason: string }[];
  text: string;
  total: number | null;
}

/** What the Lemma would add to a sprint being planned: the most urgent work
 *  that fits someone's free capacity, nobody over theirs. Worked out, never
 *  guessed: with no capacity there is no draft. */
export function draft(w: World, sprint: Sprint, queue: Task[], cap: Capacity): Draft {
  const word = w.measure === "points" ? "pts" : "tasks";
  if (cap.total == null) return { adds: [], text: "", total: null };
  const free = new Map(cap.people.filter((p) => p.cap != null).map((p) => [p.key, (p.cap || 0) - p.planned]));
  const inSprint = new Set(present(w.itemsBy.get(sprint.id) || []).map((i) => i.task_id));
  const candidates = queue
    .filter((t) => !inSprint.has(t.id) && (w.measure === "tasks" || w.est.has(t.id)) && PRIORITY[t.priority] >= 3)
    .sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] || a.number - b.number);
  const adds: Draft["adds"] = [];
  let planned = cap.planned;
  for (const t of candidates) {
    if (adds.length >= 3) break;
    const s = size(w, t.id);
    const mine = whoOf(t);
    let pick = mine.kind === "person" && (free.get(mine.key) ?? -1) >= s ? cap.people.find((p) => p.key === mine.key) : undefined;
    if (!pick) {
      const best = [...free.entries()].filter(([, f]) => f >= s).sort((a, b) => b[1] - a[1])[0];
      pick = best ? cap.people.find((p) => p.key === best[0]) : undefined;
    }
    if (!pick) continue;
    const room = free.get(pick.key) || 0;
    free.set(pick.key, room - s);
    planned += s;
    const src = SOURCE_NAMES[t.source] && !["tasks", "chat"].includes(t.source) ? `, from ${SOURCE_NAMES[t.source]}${t.source_id ? ` (${t.source_id})` : ""}` : "";
    adds.push({ taskId: t.id, who: pick, reason: `#${t.number} is ${t.priority}${src}, ${num(s)} ${word}; ${firstName(pick.name)} has ${num(room)} ${word} free.` });
  }
  if (!adds.length) return { adds, text: "", total: cap.total };
  const lines = adds.map((a) => `#${w.tasks.get(a.taskId)?.number} to ${firstName(a.who.name)}`);
  const over = cap.people.some((p) => p.cap != null && p.planned > p.cap + 1e-9);
  const text = `The Lemma suggests adding ${joined(lines)}. ${adds[0].reason} That makes ${num(planned)} of ${num(cap.total)} ${word}, and ${over ? "someone is already over their capacity" : "nobody over their capacity"}.`;
  return { adds, text, total: cap.total };
}

/** A started sprint's capacity as it was frozen at the start, with what each
 *  person has in it now. In the other measure, worked out afresh. */
export function capacityAtStart(w: World, sprint: Sprint, measure: Measure = w.measure): Capacity {
  const live = capacity(w, sprint, measure);
  const frozen = sprint.capacity?.people;
  if (!frozen || measure !== w.measure || sprint.state === "planned") return live;
  const had = sprint.state === "closed" ? sprint.stats?.by_person || null : null;
  const people = frozen.map((p) => {
    const now = live.people.find((x) => x.key === p.key);
    const then = had?.[p.key];
    return then ? { ...p, planned: measure === "points" ? Number(then.had_points || 0) : Number(then.had_tasks || 0), tasks: Number(then.had_tasks || 0) }
      : { ...p, planned: now?.planned || 0, tasks: now?.tasks || 0 };
  });
  for (const p of live.people) if (!people.some((x) => x.key === p.key)) people.push(p);
  return { ...live, people, total: sprint.capacity_total };
}

/** Where a task came from, said in a few words: "Incidents · INC-16", "split from #412"; empty for a task typed in Tasks. */
export function sourceText(w: World, t: Task | undefined): string {
  if (!t?.source || t.source === "tasks" || t.source === "chat") return "";
  if (t.source === "sprints") {
    const from = t.source_id ? w.tasks.get(t.source_id) : undefined;
    return from ? `split from #${from.number}` : "split at a close";
  }
  const ref = t.source_id && t.source_id.length <= 24 ? ` · ${t.source_id}` : "";
  return `${SOURCE_NAMES[t.source] || t.source}${ref}`;
}
