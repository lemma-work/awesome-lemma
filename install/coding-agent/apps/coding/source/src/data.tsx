// The app's working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). The Coding agent tables are the team's (no row-level
// security); a card on the board is a row of the shared team `task` table.
// Conversations are their starter's own: only the person who started a
// session reads its transcript, so those reads happen only for them.
//
// Writes that start or move work go through the bundle's functions
// (coding_start, coding_ask_start, coding_setup_save, coding_sample_data,
// coding_needs_you), so the task, the session, its events and Today stay in
// step. Answering, steering and stopping an agent are the person's own
// messages into their own conversation, sent from here; a hand-back is three
// row writes. Schedules are made as the person in wire.ts.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEMO, client, create, items, orgId, runFunction, update, useData, useRows, whoAmI, type Loaders, errorText } from "@lemma-plugins/kit";
import { build, type Item, type Message } from "./transcript";
import { nowMs, setDemoClock } from "./marks";
import type { CodingEvent, Member, Question, Repo, Runtime, Session, Settings, Task } from "./types";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM coding_settings ORDER BY created_at LIMIT 1", tables: ["coding_settings"] },
  repos: { sql: "SELECT * FROM coding_repo ORDER BY full_name", tables: ["coding_repo"] },
  sessions: { sql: "SELECT * FROM coding_session ORDER BY created_at DESC LIMIT 1000", tables: ["coding_session"] },
  events: { sql: "SELECT * FROM coding_event ORDER BY at DESC LIMIT 5000", tables: ["coding_event"] },
  questions: { sql: "SELECT * FROM coding_question ORDER BY created_at DESC LIMIT 500", tables: ["coding_question"] },
  tasks: {
    sql: "SELECT id, number, title, description, status, priority, assignee_kind, assignee_user_id, assignee_name, assignee_agent, " +
      "source, source_url, quote, done_at, created_at FROM task ORDER BY created_at DESC LIMIT 2000",
    tables: ["task"],
  },
  // Tasks' "an agent could do this", per person.
  decisions: { sql: "SELECT task_id, answer, state FROM tasks_decision WHERE kind = 'agent'", tables: ["tasks_decision"] },
  sample: { sql: "SELECT COUNT(*) AS n FROM coding_sample_row", tables: ["coding_sample_row"] },
};

export const AGENT = "coding_builder";
/** Where a task waiting for an agent comes from. */
export const READY_SOURCES = new Set(["triage", "pr-review", "github"]);

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

const bool = (v: unknown) => v === true || v === "true" || v === 1 || v === "t";
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

function asSession(r: Record<string, unknown>): Session {
  return {
    ...(r as unknown as Session),
    keep_green: bool(r.keep_green),
    tries: Number(r.tries || 0),
    max_tries: Number(r.max_tries || 3),
    pr_number: num(r.pr_number),
    additions: num(r.additions),
    deletions: num(r.deletions),
    files_changed: num(r.files_changed),
    place: r.place === "mac" ? "mac" : "cloud",
  };
}

/* ---------- who, and which agents ---------- */

interface World {
  me: { id: string; name: string; email: string | null } | null;
  members: Member[];
  org: string | null;
  runtimes: Runtime[] | null;
  runtimesError: string | null;
  reloadRuntimes: () => void;
}

const WorldContext = createContext<World>({ me: null, members: [], org: null, runtimes: null, runtimesError: null, reloadRuntimes: () => undefined });

function asRuntimes(response: unknown): Runtime[] {
  return items<Record<string, unknown>>(response)
    .filter((p) => !p.disabled_at && !p.deleted_at && !p.archived_at)
    .map((p) => {
      const kind = p.kind === "HARNESS" ? "HARNESS" : "MODEL_PROVIDER";
      const status = String(p.availability_status ?? "READY");
      return {
        id: String(p.id),
        name: String(p.name ?? p.id),
        kind,
        model: (p.default_model_name as string) ?? null,
        models: ((p.model_catalog as { name?: string; display_name?: string }[] | null) ?? [])
          .filter((m) => m.name).map((m) => ({ name: String(m.name), label: String(m.display_name ?? m.name) })),
        status,
        ready: status === "READY",
      } as Runtime;
    })
    .sort((a, b) => (a.id === "system:lemma" ? -1 : b.id === "system:lemma" ? 1 : a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "MODEL_PROVIDER" ? -1 : 1));
}

/** Who is signed in, who else is in the Lemma, and the agents it can run: read once. */
export function WorldProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<Omit<World, "runtimes" | "runtimesError" | "reloadRuntimes">>({ me: null, members: [], org: null });
  const [runtimes, setRuntimes] = useState<Runtime[] | null>(null);
  const [runtimesError, setRuntimesError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const [me, members, org] = await Promise.all([
        whoAmI(),
        client.podMembers.list(client.podId || "", { limit: 200 })
          .then((r) => items<{ user_id: string; user_name?: string | null; user_email?: string; email?: string }>(r))
          .catch(() => []),
        orgId(),
      ]);
      const list: Member[] = members.map((m) => ({
        user_id: m.user_id, email: m.user_email || m.email || "",
        name: m.user_name || (m.user_email || m.email || "").split("@")[0] || "Someone",
      }));
      const self = me ? { id: me.id, email: me.email, name: list.find((m) => m.user_id === me.id)?.name || me.name || (me.email || "").split("@")[0] || "You" } : null;
      setBase({ me: self, members: list, org });
    })();
  }, []);
  const loadRuntimes = useCallback(() => {
    if (!base.org) return;
    client.agentRuntime.listProfiles(base.org).then(
      (r) => { setRuntimes(asRuntimes(r)); setRuntimesError(null); },
      (e) => { setRuntimes([]); setRuntimesError(errorText(e)); },
    );
  }, [base.org]);
  useEffect(() => {
    loadRuntimes();
  }, [loadRuntimes]);
  // A Mac goes to sleep and wakes: its status is read again every minute while the app is open.
  useEffect(() => {
    if (DEMO) return;
    const t = window.setInterval(loadRuntimes, 60_000);
    return () => window.clearInterval(t);
  }, [loadRuntimes]);
  const value = useMemo(() => ({ ...base, runtimes, runtimesError, reloadRuntimes: loadRuntimes }), [base, runtimes, runtimesError, loadRuntimes]);
  return <WorldContext.Provider value={value}>{children}</WorldContext.Provider>;
}

export function useWorld(): World {
  return useContext(WorldContext);
}

export function runtimeOf(id: string | null | undefined, list: Runtime[] | null): Runtime | null {
  return list?.find((r) => r.id === (id || "system:lemma")) ?? null;
}

/** How an agent is named on a card: "Lemma", "Claude Code · your Mac". */
export function agentName(s: Pick<Session, "agent_label" | "profile_id" | "place" | "started_by">, list: Runtime[] | null, meId?: string | null): string {
  const name = s.agent_label || runtimeOf(s.profile_id, list)?.name || (s.profile_id && s.profile_id !== "system:lemma" ? "An agent" : "Lemma");
  if (s.place !== "mac") return name;
  return `${name} · ${s.started_by && s.started_by === meId ? "your Mac" : "a Mac"}`;
}

/* ---------- the board ---------- */

export type Column = "needs" | "ready" | "working" | "open" | "merged";

export interface Card {
  id: string;
  task: Task | null;
  session: Session | null;
  title: string;
  repo: string | null;
  source: string | null;
  column: Column;
  /** For a ready card: why it's here. */
  why?: string;
  at: string;
}

const WEEK = 7 * 86_400_000;

export function repoOf(url: string | null | undefined): string | null {
  // github.com, or a GitHub Enterprise host (the sample's github.example).
  const m = /^https?:\/\/github\.[\w.-]+\/([\w.-]+\/[\w.-]+)/.exec(url || "");
  return m ? m[1].replace(/\.git$/, "") : null;
}

/** Everything the screens read, indexed. */
export function useCoding() {
  const { loaded, errors, reload } = useData();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const repoRows = useRows<Record<string, unknown>>("repos");
  const sessionRows = useRows<Record<string, unknown>>("sessions");
  const eventRows = useRows<Record<string, unknown>>("events");
  const questionRows = useRows<Record<string, unknown>>("questions");
  const taskRows = useRows<Record<string, unknown>>("tasks");
  const decisionRows = useRows<{ task_id: string | null; answer: string; state: string }>("decisions");
  const sampleRows = useRows<{ n: number | string }>("sample");
  return useMemo(() => {
    const s0 = settingsRows[0];
    const settings: Settings | null = s0
      ? { ...(s0 as unknown as Settings), keep_green: s0.keep_green == null ? true : bool(s0.keep_green), max_tries: Number(s0.max_tries || 3), sample: bool(s0.sample) }
      : null;
    const repos = repoRows.map((r) => ({ ...(r as unknown as Repo), enabled: r.enabled == null ? true : bool(r.enabled) }));
    const sessions = sessionRows.map(asSession);
    const events = eventRows.map((e) => ({ ...(e as unknown as CodingEvent), detail: json<Record<string, unknown> | null>(e.detail, null) }))
      .sort((a, b) => a.at.localeCompare(b.at));
    const questions = questionRows.map((q) => ({ ...(q as unknown as Question), read: json<Question["read"]>(q.read, []) }));
    const tasks = taskRows.map((t) => ({ ...(t as unknown as Task), number: num(t.number) }));
    const taskById = new Map(tasks.map((t) => [t.id, t]));

    const sessionsBy = new Map<string, Session[]>();
    for (const s of sessions) sessionsBy.set(s.task_id, [...(sessionsBy.get(s.task_id) || []), s]);
    for (const list of sessionsBy.values()) list.sort((a, b) => (b.started_at || b.created_at).localeCompare(a.started_at || a.created_at));
    const eventsBy = new Map<string, CodingEvent[]>();
    for (const e of events) eventsBy.set(e.task_id, [...(eventsBy.get(e.task_id) || []), e]);
    const agentYes = new Set(decisionRows.filter((d) => d.answer === "yes" && d.state !== "dismissed" && d.task_id).map((d) => String(d.task_id)));

    const enabled = repos.filter((r) => r.enabled);
    if (DEMO) {
      const newest = sessions.reduce((m, s) => Math.max(m, Date.parse(s.last_event_at || "") || 0), 0);
      setDemoClock(newest ? newest + 60_000 : null);
    }
    const now = nowMs();
    const cards: Card[] = [];
    const seen = new Set<string>();
    for (const [taskId, list] of sessionsBy) {
      const s = list[0];
      const task = taskById.get(taskId) || null;
      seen.add(taskId);
      let column: Column | null = null;
      if (s.status === "needs_you" || s.status === "failed") column = "needs";
      else if (s.status === "starting" || s.status === "working") column = "working";
      else if (s.status === "pr_open") column = "open";
      else if (s.status === "merged" || s.status === "done") {
        const at = Date.parse(s.finished_at || s.last_event_at || s.created_at);
        if (now - at < WEEK) column = "merged";
      }
      if (!column) continue;
      cards.push({ id: taskId, task, session: s, title: task?.title || s.title, repo: s.repo, source: task?.source || s.source, column, at: s.last_event_at || s.started_at || s.created_at });
    }
    for (const t of tasks) {
      if (seen.has(t.id) || t.status === "done" || t.status === "canceled") continue;
      const handed = t.assignee_kind === "agent" && t.assignee_agent === AGENT;
      const fromSource = READY_SOURCES.has(String(t.source || "")) && t.assignee_kind !== "person";
      const suggested = agentYes.has(t.id) && t.assignee_kind !== "person";
      if (!handed && !fromSource && !suggested) continue;
      const repo = repoOf(t.source_url) || (enabled.length === 1 ? enabled[0].full_name : null);
      cards.push({
        id: t.id, task: t, session: null, title: t.title, repo, source: t.source, column: handed ? "working" : "ready",
        why: handed ? undefined : suggested ? "an agent could do this" : undefined, at: t.created_at,
      });
    }
    cards.sort((a, b) => b.at.localeCompare(a.at));
    return {
      loaded, errors, reload, settings, repos, sessions, sessionsBy, events, eventsBy, questions, tasks, taskById, cards,
      sample: Number(sampleRows[0]?.n || 0) > 0,
    };
  }, [loaded, errors, reload, settingsRows, repoRows, sessionRows, eventRows, questionRows, taskRows, decisionRows, sampleRows]);
}

export type Data = ReturnType<typeof useCoding>;

/* ---------- a conversation, read by its starter ---------- */

export interface Live {
  items: Item[];
  status: string | null;
  pending: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** A conversation's messages, read once and then as they come: every 3 s while
 *  it runs (the messages after the last one seen), every 30 s otherwise. */
export function useConversation(id: string | null | undefined, enabled = true): Live {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const last = useRef<number | null>(null);
  const known = useRef<Map<string, Message>>(new Map());

  useEffect(() => {
    known.current = new Map();
    last.current = null;
    setMessages([]);
    setLoading(true);
    setError(null);
  }, [id]);

  useEffect(() => {
    if (!id || !enabled) {
      setLoading(false);
      return;
    }
    let alive = true;
    let timer = 0;
    const load = async () => {
      try {
        const [conv, page] = await Promise.all([
          client.conversations.get(id).catch(() => null),
          client.conversations.messages.list(id, { limit: 500, ...(last.current != null ? { after_sequence: last.current } : {}) }),
        ]);
        if (!alive) return;
        const list = items<Message>(page);
        for (const m of list) {
          known.current.set(m.id, m);
          if (typeof m.sequence === "number") last.current = Math.max(last.current ?? -1, m.sequence);
        }
        setMessages([...known.current.values()]);
        const st = String((conv as { status?: string } | null)?.status || "");
        setStatus(st || null);
        setPending(Boolean((conv as { has_pending_interaction?: boolean } | null)?.has_pending_interaction));
        setError(null);
        setLoading(false);
        if (!DEMO) timer = window.setTimeout(load, st === "RUNNING" || st === "STOP_REQUESTED" ? 3000 : 30_000);
      } catch (e) {
        if (!alive) return;
        setError(errorText(e));
        setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id, enabled, tick]);

  const itemsOut = useMemo(() => build(messages), [messages]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { items: itemsOut, status, pending, loading, error, refresh };
}

/* ---------- writes ---------- */

type Out = { ok?: boolean; message?: string; task_id?: string; session_id?: string; question_id?: string } & Record<string, unknown>;

export async function call(name: string, input: Record<string, unknown>): Promise<Out> {
  const out = ((await runFunction<Out>(name, input)) as Out) || {};
  if (out.ok === false) throw new Error(String(out.message || `${name} didn't finish`));
  return out;
}

let needsTimer = 0;
/** Re-write this person's items in Today, a moment after a change or on open. */
export function refreshNeedsYou(): void {
  if (DEMO) return;
  window.clearTimeout(needsTimer);
  needsTimer = window.setTimeout(() => void runFunction("coding_needs_you", {}).catch(() => undefined), 1500);
}

export interface StartInput {
  task_id?: string;
  title: string;
  brief: string;
  repo: string;
  ref?: string | null;
  push_to?: string | null;
  profile_id?: string | null;
  model?: string | null;
  keep_green?: boolean;
  max_tries?: number | null;
  source?: string | null;
  source_url?: string | null;
}

/** Hand a task to an agent (coding_start). Says what the app knows of the
 *  agent, which the function uses when it can't read the profile itself. */
export async function startWork(input: StartInput, runtimes: Runtime[] | null): Promise<Out> {
  const r = runtimeOf(input.profile_id, runtimes);
  const out = await call("coding_start", {
    ...input, source: input.source || "coding-agent",
    ...(r ? { agent_label: r.name, place: r.kind === "HARNESS" ? "mac" : "cloud", availability: r.status } : {}),
  });
  if (out.ok === false) throw new Error(String(out.message || "the agent couldn't start"));
  refreshNeedsYou();
  return out;
}

type Me = World["me"];

async function event(s: Session, kind: string, actor: string | null, text: string) {
  await create("coding_event", { task_id: s.task_id, session_id: s.id, at: new Date().toISOString(), kind, actor, text });
}

/** The person's answer or steer, into their own conversation with the agent. */
export async function sendToAgent(s: Session, text: string, me: Me): Promise<void> {
  if (!s.conversation_id) throw new Error("This task has no conversation to send to.");
  await client.conversations.appendMessage(s.conversation_id, { content: text } as never);
  if (s.status === "needs_you" && (s.needs === "question" || s.needs === "approval")) {
    await update("coding_session", s.id, { status: "working", needs: "none", needs_text: null, last_event_at: new Date().toISOString() });
    await event(s, "answered", me?.name || null, text.slice(0, 4000));
  }
  refreshNeedsYou();
}

export async function stopAgent(s: Session, me: Me): Promise<void> {
  if (s.conversation_id) await client.conversations.stopRun(s.conversation_id).catch(() => undefined);
  await update("coding_session", s.id, { status: "stopped", needs: "none", needs_text: null, finished_at: new Date().toISOString() });
  await event(s, "stopped", me?.name || null, `${me?.name || "Someone"} stopped it`);
  refreshNeedsYou();
}

/** Take the task back from the agent and give it to a person. */
export async function handBack(s: Session, task: Task | null, to: Member, me: Me): Promise<void> {
  const live = ["starting", "working", "needs_you"].includes(s.status);
  if (live && s.conversation_id && s.started_by === me?.id) await client.conversations.stopRun(s.conversation_id).catch(() => undefined);
  if (task) {
    await update("task", task.id, { assignee_kind: "person", assignee_user_id: to.user_id, assignee_name: to.name, assignee_agent: null, status: "todo" });
  }
  if (!["merged", "done"].includes(s.status)) {
    await update("coding_session", s.id, { status: "stopped", needs: "none", needs_text: null, finished_at: new Date().toISOString() });
  }
  await event(s, "stopped", me?.name || null, `${me?.name || "Someone"} handed it back to ${to.user_id === me?.id ? "themselves" : to.name}`);
  refreshNeedsYou();
}

/** A task waiting for a Mac that's asleep, started again on Lemma in the cloud. */
export function moveToCloud(s: Session, task: Task | null, runtimes: Runtime[] | null, model?: string | null): Promise<Out> {
  return startWork({
    task_id: s.task_id, title: task?.title || s.title, brief: task?.description || s.title, repo: s.repo, ref: s.ref, push_to: s.push_to,
    profile_id: "system:lemma", model: model || null, keep_green: s.keep_green, source: task?.source || s.source, source_url: task?.source_url || s.source_url,
  }, runtimes);
}

/** Ask the agent on the pull request to bring its branch up to date. */
export async function fixConflicts(s: Session, me: Me): Promise<void> {
  const base = s.ref && !s.ref.startsWith("pull/") ? s.ref : "the base branch";
  await sendToAgent(s, `The pull request conflicts with ${base}. Merge ${base} into your branch, fix the conflicts, run the checks, push, and report.`, me);
  await event(s, "fixing", me?.name || null, `${me?.name || "Someone"} asked the agent to fix the conflicts`);
}

export const isLive = (s: Session | null) => !!s && ["starting", "working", "needs_you"].includes(s.status);
