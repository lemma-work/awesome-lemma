// The app's working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). Row-level security scopes `personal_task`, `tasks_run`,
// `tasks_decision` and `tasks_settings` to the signed-in person; `task` and
// `project` are the team's.
//
// Writes go straight to the records API when they are one row (a status, an
// edit, a comment), and through Tasks' functions when they touch several
// (sharing a task moves it between tables; deleting takes its timeline).
// Handing a task to an agent is a write of its assignee: the `tasks-*-handed`
// schedule does the rest. A reply to an agent is sent into its conversation
// from here, as the person, because only they can talk to the Lemma's own
// assistant (a function cannot).

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { client, create, items, q, runFunction, update, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import {
  ASSISTANT, type Activity, type Capabilities, type Decision, type Member, type Project, type PromiseRow, type Run, type Scope,
  type Settings, type Status, type Task,
} from "./types";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM tasks_settings ORDER BY created_at LIMIT 1", tables: ["tasks_settings"] },
  personal: { sql: "SELECT * FROM personal_task ORDER BY created_at DESC LIMIT 2000", tables: ["personal_task"] },
  team: { sql: "SELECT * FROM task ORDER BY created_at DESC LIMIT 2000", tables: ["task"] },
  projects: { sql: "SELECT * FROM project ORDER BY created_at", tables: ["project"] },
  runs: { sql: "SELECT * FROM tasks_run", tables: ["tasks_run"] },
  decisions: { sql: "SELECT id, kind, answer, confidence, reason, state, task_id FROM tasks_decision WHERE kind = 'agent'", tables: ["tasks_decision"] },
  sample: { sql: "SELECT COUNT(*) AS n FROM tasks_sample_row", tables: ["tasks_sample_row"] },
  promises: {
    sql:
      "SELECT p.id, p.conversation_id, p.source, p.person_name, p.person_handle, p.text, p.quote, p.due_at, p.state, p.created_at, " +
      "c.subject, d.answer AS d_answer, d.confidence AS d_confidence, d.state AS d_state, d.reason AS d_reason, d.task_id AS d_task_id " +
      "FROM promise p LEFT JOIN conversation c ON c.id = p.conversation_id LEFT JOIN tasks_decision d ON d.id = p.id " +
      "WHERE p.direction = 'i_owe' ORDER BY p.created_at DESC LIMIT 300",
    tables: ["promise", "tasks_decision"],
  },
};

export const TABLE: Record<Scope, string> = { personal: "personal_task", team: "task" };
export const ACTIVITY: Record<Scope, string> = { personal: "tasks_personal_activity", team: "tasks_activity" };

function asTask(scope: Scope) {
  return (r: Record<string, unknown>): Task => {
    const labels = Array.isArray(r.labels) ? (r.labels as string[]) : typeof r.labels === "string" ? safeList(r.labels) : [];
    return { ...(r as unknown as Task), scope, labels };
  };
}

function safeList(text: string): string[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Named agents that can take a task: only those with the Lemma's tools
 *  (POD), which an agent needs to report on the task. Mail's and Meetings'
 *  background writers have none and are left out. */
function takers(response: unknown): string[] {
  return items<{ name: string; toolsets?: string[] | null }>(response)
    .filter((a) => a.name && a.name !== ASSISTANT && a.name !== "POD_DEFAULT" && (a.toolsets || []).includes("POD"))
    .map((a) => a.name);
}

interface World {
  me: { id: string; name: string; email: string | null } | null;
  members: Member[];
  agents: string[];
  lemmaName: string;
  canAdmin: boolean;
}

const WorldContext = createContext<World>({ me: null, members: [], agents: [], lemmaName: "This Lemma", canAdmin: false });

/** Who is signed in, who else is in the Lemma, and its named agents: read once. */
export function WorldProvider({ children }: { children: ReactNode }) {
  const [world, setWorld] = useState<World>({ me: null, members: [], agents: [], lemmaName: "This Lemma", canAdmin: false });
  useEffect(() => {
    void (async () => {
      const [me, members, agents, pod] = await Promise.all([
        whoAmI(),
        client.podMembers
          .list(client.podId || "", { limit: 200 })
          .then((r) => items<{ user_id: string; user_name?: string | null; user_email?: string; email?: string; roles?: string[] }>(r))
          .catch(() => []),
        client.agents.list({ limit: 100 } as never).then(takers).catch(() => [] as string[]),
        client.pods.get(client.podId || "").catch(() => null),
      ]);
      const list: Member[] = members.map((m) => ({
        user_id: m.user_id,
        email: m.user_email || m.email || "",
        name: m.user_name || (m.user_email || m.email || "").split("@")[0] || "Someone",
      }));
      const mine = members.find((m) => m.user_id === me?.id);
      const roles = (mine?.roles || []).map((r) => r.toUpperCase());
      const self = me ? { id: me.id, email: me.email, name: list.find((m) => m.user_id === me.id)?.name || me.name || (me.email || "").split("@")[0] || "You" } : null;
      setWorld({
        me: self,
        members: list,
        agents,
        lemmaName: ((pod as { name?: string } | null)?.name || "This Lemma").trim(),
        canAdmin: roles.some((r) => r.includes("ADMIN") || r.includes("OWNER")),
      });
    })();
  }, []);
  return <WorldContext.Provider value={world}>{children}</WorldContext.Provider>;
}

export function useWorld(): World {
  return useContext(WorldContext);
}

/** Everything the screens read, merged and indexed. */
export function useTasks() {
  const { loaded, errors, reload } = useData();
  const personal = useRows<Record<string, unknown>>("personal");
  const team = useRows<Record<string, unknown>>("team");
  const projects = useRows<Project>("projects");
  const runs = useRows<Run>("runs");
  const decisions = useRows<Decision>("decisions");
  const promises = useRows<PromiseRow>("promises");
  const settings = useRows<Settings>("settings")[0] || null;
  const sampleRows = useRows<{ n: number | string }>("sample");
  const sample = Number(sampleRows[0]?.n || 0) > 0;
  return useMemo(() => {
    const tasks = [...personal.map(asTask("personal")), ...team.map(asTask("team"))];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const children = new Map<string, Task[]>();
    for (const t of tasks) if (t.parent_id) (children.get(t.parent_id) || children.set(t.parent_id, []).get(t.parent_id)!).push(t);
    return {
      loaded,
      errors,
      reload,
      settings,
      tasks,
      byId,
      children,
      projects,
      projectById: new Map(projects.map((p) => [p.id, p])),
      runById: new Map(runs.map((r) => [r.id, r])),
      decisionById: new Map(decisions.map((d) => [d.id, d])),
      promises,
      sample,
    };
  }, [loaded, errors, reload, personal, team, projects, runs, decisions, promises, settings, sample]);
}

export type TasksData = ReturnType<typeof useTasks>;

/* ---------- the day, in the person's own calendar ---------- */

export function todayKey(zone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return zone === "Asia/Calcutta" ? "Asia/Kolkata" : zone;
}

/* ---------- writes ---------- */

type Me = World["me"];

async function log(task: Task, me: Me, kind: Activity["kind"], body: string | null, detail?: Record<string, unknown>) {
  await create(ACTIVITY[task.scope], {
    task_id: task.id, kind, actor_kind: "person", actor_user_id: me?.id || null, actor_name: me?.name || null, body, detail: detail || null,
  });
  refreshNeedsYou();
}

/* ---------- the shared needs_you list (Today reads it) ---------- */

let needsYouTimer = 0;
/** Re-write what in Tasks needs the person, a moment after their last change. */
export function refreshNeedsYou(): void {
  window.clearTimeout(needsYouTimer);
  needsYouTimer = window.setTimeout(() => void runFunction("tasks_needs_you", {}).catch(() => undefined), 2500);
}

/** The person's own daily refresh, at 06:00 in their zone, made once as them. */
export async function ensureDaily(settings: Settings, me: Me): Promise<void> {
  if ((settings as Settings & { schedule_id?: string | null }).schedule_id) return;
  const name = `tasks-needs-you-${(me?.id || "me").slice(0, 8)}`;
  const zone = settings.timezone || browserZone();
  try {
    const existing = items<{ id: string; name: string }>(await client.schedules.list({ name, limit: 5 } as never)).find((x) => x.name === name);
    const id = existing?.id || ((await client.schedules.create({
      name, schedule_type: "TIME", workflow_name: "tasks-needs-you", config: { cron: "0 6 * * *", timezone: zone },
    } as never)) as unknown as { id: string }).id;
    await update("tasks_settings", settings.id, { schedule_id: id });
  } catch {
    /* the list still updates on every change; the morning refresh waits for the next open */
  }
}

export async function setStatus(task: Task, status: Status, me: Me) {
  if (task.status === status) return;
  await update(TABLE[task.scope], task.id, { status, done_at: status === "done" ? new Date().toISOString() : null });
  await log(task, me, "status", null, { from: task.status, to: status });
  // A task made from a promise keeps that promise: done here is the promise kept.
  if (task.source === "promise" && task.source_id && (status === "done" || task.status === "done")) {
    await update("promise", task.source_id, { state: status === "done" ? "done" : "open" }).catch(() => undefined);
  }
}

export async function patchTask(task: Task, patch: Partial<Task>, me: Me, what?: string) {
  await update(TABLE[task.scope], task.id, patch as Record<string, unknown>);
  if (what) await log(task, me, "field", null, { field: what, to: Object.values(patch)[0] ?? null });
}

export interface NewTask {
  title: string;
  description?: string;
  status?: Status;
  priority?: Task["priority"];
  due_on?: string | null;
  project_id?: string | null;
  parent?: Task | null;
  labels?: string[];
  assignee?: { kind: "none" | "person" | "agent"; user_id?: string; name?: string; agent?: string };
}

export async function createTask(input: NewTask, me: Me): Promise<Task> {
  const scope: Scope = input.parent ? input.parent.scope : input.project_id ? "team" : "personal";
  const a = input.assignee || { kind: "person" as const, user_id: me?.id, name: me?.name };
  const row = {
    title: input.title.trim().slice(0, 300),
    description: input.description?.trim() || null,
    status: input.status || "todo",
    priority: input.priority || "none",
    due_on: input.due_on || null,
    project_id: scope === "team" ? input.project_id || input.parent?.project_id || null : null,
    parent_id: input.parent?.id || null,
    labels: input.labels || [],
    assignee_kind: a.kind,
    assignee_user_id: a.kind === "person" ? a.user_id || null : null,
    assignee_name: a.kind === "person" ? a.name || null : null,
    assignee_agent: a.kind === "agent" ? a.agent || ASSISTANT : null,
    owner_user_id: me?.id || null,
    owner_name: me?.name || null,
    source: "tasks",
  };
  const made = await create<Task>(TABLE[scope], row);
  const task = { ...(made as Task), scope, labels: row.labels };
  await log(task, me, "created", null);
  return task;
}

/** Give the task to an agent. The hand-over is the `tasks-*-handed` schedule. */
export async function handOver(task: Task, agent: string, me: Me, decision?: Decision | null) {
  await update(TABLE[task.scope], task.id, { assignee_kind: "agent", assignee_agent: agent, assignee_user_id: null, assignee_name: null });
  await log(task, me, "assign", null, { to: agent, kind: "agent" });
  await settleSuggestion(decision, "accepted");
}

/** Run the hand-over again for the agent already on it (Start again). */
export async function startAgain(task: Task) {
  await runFunction("tasks_on_task", { task_id: task.id, scope: task.scope, restart: true });
}

export async function assignPerson(task: Task, member: Member | null, me: Me, run?: Run | null) {
  if (task.assignee_kind === "agent" && run && ["starting", "working", "waiting"].includes(run.state)) await stopAgent(task, run);
  await update(TABLE[task.scope], task.id, {
    assignee_kind: member ? "person" : "none", assignee_user_id: member?.user_id || null, assignee_name: member?.name || null, assignee_agent: null,
  });
  await log(task, me, "assign", null, { to: member?.name || null, kind: member ? "person" : "none" });
}

export async function stopAgent(task: Task, run: Run) {
  if (run.conversation_id) await client.conversations.stopRun(run.conversation_id).catch(() => undefined);
  await update("tasks_run", run.id, { state: "stopped" });
  refreshNeedsYou();
}

/** A reply on the task. With an agent on it, it goes into the agent's conversation too. */
export async function reply(task: Task, text: string, me: Me, run: Run | null, pending: Activity[]) {
  const body = text.trim();
  if (!body) return { sent: false };
  await log(task, me, "comment", body);
  for (const a of pending.filter((p) => p.kind === "question" && p.state === "pending")) {
    await update(ACTIVITY[task.scope], a.id, { state: "answered", decided_by: me?.name || null, decided_at: new Date().toISOString() });
  }
  const sent = await sendToAgent(task, run, `${me?.name || "The person"} replied on the task:\n\n${body}`);
  if (sent && task.status === "waiting") await update(TABLE[task.scope], task.id, { status: "in_progress" });
  return { sent };
}

export async function decide(task: Task, ask: Activity, approve: boolean, note: string, me: Me, run: Run | null) {
  const now = new Date().toISOString();
  await update(ACTIVITY[task.scope], ask.id, { state: approve ? "approved" : "declined", decided_by: me?.name || null, decided_at: now });
  const said = approve ? "Approved." : "Declined.";
  await log(task, me, "comment", note.trim() ? `${said} ${note.trim()}` : said, { decision: approve ? "approved" : "declined", approval_id: ask.id });
  const action = String((ask.detail as { action?: string } | null)?.action || "what you proposed");
  const message = approve
    ? `Approved: go ahead with ${action}.${note.trim() ? `\n\n${note.trim()}` : ""}`
    : `Declined: don't do ${action}.${note.trim() ? `\n\n${note.trim()}` : ""} Report what you'll do instead, or finish with what you have.`;
  const sent = await sendToAgent(task, run, message);
  if (sent && task.status === "waiting") await update(TABLE[task.scope], task.id, { status: "in_progress" });
  return { sent };
}

async function sendToAgent(task: Task, run: Run | null, content: string): Promise<boolean> {
  if (task.assignee_kind !== "agent" || !run?.conversation_id || ["stopped", "failed"].includes(run.state)) return false;
  try {
    await client.conversations.appendMessage(run.conversation_id, { content } as never);
    await update("tasks_run", run.id, { state: "working", last_report_at: new Date().toISOString() });
    return true;
  } catch {
    return false;
  }
}

/** The person said no to "an agent could do this". */
export async function dismissSuggestion(decision: Decision) {
  await settleSuggestion(decision, "dismissed");
}

async function settleSuggestion(decision: Decision | null | undefined, state: "accepted" | "dismissed") {
  if (!decision || decision.kind !== "agent") return;
  if (decision.state === state) return;
  await update("tasks_decision", decision.id, { state });
  const to = state === "accepted" ? "yes" : "no";
  // A correction only when it overrules the call; the examples are its mistakes.
  if (decision.answer !== to) {
    const full = (await q<{ evidence: string | null }>(`SELECT evidence FROM tasks_decision WHERE id = '${decision.id}'`))[0];
    await create("tasks_correction", {
      kind: "agent", subject_id: decision.id, from_answer: decision.answer, to_answer: to, evidence: (full?.evidence || "").slice(0, 1600),
    });
  }
}

/** A promise becomes a task (from "From promises"), keeping the sentence. */
export async function promiseToTask(p: PromiseRow, me: Me, zone?: string | null): Promise<Task> {
  const due = p.due_at ? new Intl.DateTimeFormat("en-CA", { timeZone: zone || undefined }).format(new Date(p.due_at)) : null;
  const who = p.person_name || p.person_handle || "them";
  const title = p.text.replace(/^(i|we)('ll| will)\s+/i, "").replace(/^\w/, (c) => c.toUpperCase()).replace(/\.$/, "");
  const made = await create<Task>("personal_task", {
    title: title.slice(0, 300), status: "todo", priority: "none", due_on: due, labels: [],
    description: `For ${who}${p.subject ? `, from "${p.subject}"` : ""}.`,
    assignee_kind: "person", assignee_user_id: me?.id || null, assignee_name: me?.name || null,
    owner_user_id: me?.id || null, owner_name: me?.name || null,
    source: "promise", source_id: p.id, quote: (p.quote || p.text).slice(0, 600),
  });
  const task = { ...(made as Task), scope: "personal" as const, labels: [] };
  await create("tasks_personal_activity", { task_id: task.id, kind: "created", actor_kind: "person", actor_user_id: me?.id || null,
    actor_name: me?.name || null, body: `Made from a promise you made to ${who}.`, detail: { promise_id: p.id } });
  if (p.d_answer) {
    await update("tasks_decision", p.id, { state: "accepted", task_id: task.id });
    if (p.d_answer !== "work") await correctPromise(p, "work");
  } else {
    await create("tasks_decision", { id: p.id, kind: "promise", answer: "work", state: "accepted", task_id: task.id, reason: "Made a task by you" });
  }
  return task;
}

export async function dismissPromise(p: PromiseRow) {
  if (p.d_answer) {
    await update("tasks_decision", p.id, { state: "dismissed" });
    if (p.d_answer !== "reply") await correctPromise(p, "reply");
  } else {
    await create("tasks_decision", { id: p.id, kind: "promise", answer: "reply", state: "dismissed", reason: "Just a reply, said by you" });
  }
}

async function correctPromise(p: PromiseRow, to: "work" | "reply") {
  const full = (await q<{ evidence: string | null }>(`SELECT evidence FROM tasks_decision WHERE id = '${p.id}'`))[0];
  await create("tasks_correction", { kind: "promise", subject_id: p.id, from_answer: p.d_answer || null, to_answer: to, evidence: (full?.evidence || "").slice(0, 1600) });
}

export async function moveTask(task: Task, to: Scope, projectId?: string | null) {
  const r = await runFunction<{ message: string }>("tasks_move", { task_id: task.id, to, project_id: projectId || null });
  refreshNeedsYou();
  return r;
}

export async function deleteTasks(ids: string[], notATask = false) {
  const r = await runFunction<{ message: string }>("tasks_delete", { task_ids: ids, not_a_task: notATask });
  refreshNeedsYou();
  return r;
}

export async function loadActivity(task: Task): Promise<Activity[]> {
  return q<Activity>(`SELECT * FROM ${ACTIVITY[task.scope]} WHERE task_id = '${task.id}' ORDER BY created_at LIMIT 500`);
}

/** What this Lemma has, for "could an agent do this?": plugins, accounts, agents. */
export async function findCapabilities(): Promise<Capabilities> {
  const tables = await client.tables
    .list({ limit: 500 })
    .then((r) => items<{ name?: string; table_name?: string }>(r).map((t) => t.name || t.table_name || ""))
    .catch(() => [] as string[]);
  const has = (t: string) => tables.includes(t);
  const plugins: string[] = [];
  if (has("mail_settings")) plugins.push("Mail (reads mail, drafts replies; a person presses Send)");
  if (has("meetings_settings")) plugins.push("Meetings (the calendar, and a brief before meetings)");
  if (has("today_settings")) plugins.push("Today (the day's replies, promises and meetings)");
  if (has("company")) plugins.push("People map (people and companies)");
  const accounts: string[] = [];
  try {
    const pod = (await client.pods.get(client.podId || "")) as unknown as { organization_id?: string };
    if (pod.organization_id) {
      const list = await client.connectors.accounts.list(pod.organization_id, { limit: 100 } as never);
      for (const a of items<{ connector_id?: string; status?: string }>(list)) {
        if (a.connector_id && (!a.status || ["CONNECTED", "ACTIVE"].includes(a.status))) accounts.push(a.connector_id);
      }
    }
  } catch {
    /* no access to the organisation's accounts: say none */
  }
  const agents = await client.agents.list({ limit: 100 } as never).then(takers).catch(() => [] as string[]);
  return { plugins, accounts: [...new Set(accounts)], agents, has_promises: has("mail_settings") || has("meetings_settings") };
}

/** Let a named agent take tasks: tasks_on_task needs agent.execute on it. Admins only. */
export async function letAgentTakeTasks(agent: string): Promise<boolean> {
  try {
    const current = (await client.functions.permissions.get("tasks_on_task")) as unknown as { grants?: { resource_type: string; resource_name: string; permission_ids: string[] }[] };
    const grants = (current.grants || []).filter((g) => !(g.resource_type === "agent" && g.resource_name === agent));
    grants.push({ resource_type: "agent", resource_name: agent, permission_ids: ["agent.read", "agent.execute"] });
    await client.functions.permissions.replace("tasks_on_task", { grants } as never);
    return true;
  } catch {
    return false;
  }
}
