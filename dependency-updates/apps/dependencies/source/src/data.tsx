// The app's working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). Every table here is the team's (no row-level security).
//
// Writes: a person's decisions go through deps_decide, so the item in Today
// is settled the same way from anywhere; set-up through deps_setup_save.
// What only a person can do is done here as them:
//   - the schedules (no function grant holds schedule.create);
//   - starting the deps-updater agent: Open now, its own PR, Drop, Put back,
//     Ask (conversations.createForAgent, in a checkout of the repository);
//   - Merge (the GitHub connector's pulls_merge, after a confirmation).

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO, client, demoNote, items, runFunction, update, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import type { Batch, Ignore, Repo, Rule, Settings, Update } from "./types";

export const AGENT = "deps-updater";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM deps_settings ORDER BY created_at LIMIT 1", tables: ["deps_settings"] },
  repos: { sql: "SELECT * FROM deps_repo ORDER BY repo LIMIT 500", tables: ["deps_repo"] },
  updates: { sql: "SELECT * FROM deps_update WHERE state <> 'superseded' ORDER BY created_at DESC LIMIT 3000", tables: ["deps_update"] },
  batches: { sql: "SELECT * FROM deps_batch ORDER BY created_at DESC LIMIT 500", tables: ["deps_batch"] },
  ignores: { sql: "SELECT * FROM deps_ignore ORDER BY created_at DESC LIMIT 1000", tables: ["deps_ignore"] },
  rules: { sql: "SELECT * FROM deps_rule ORDER BY created_at LIMIT 500", tables: ["deps_rule"] },
  sample: { sql: "SELECT COUNT(*) AS n FROM deps_sample_row", tables: ["deps_sample_row"] },
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

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

function asSettings(r: Record<string, unknown> | undefined): Settings | null {
  if (!r) return null;
  return {
    ...(r as unknown as Settings),
    wait_days: Number(r.wait_days ?? 3),
    wait_major_days: Number(r.wait_major_days ?? 14),
    hold_install_scripts: r.hold_install_scripts !== false,
    weekday: ((r.weekday as string) || "mon") as Settings["weekday"],
    run_time: (r.run_time as string) || "06:00",
    timezone: (r.timezone as string) || "UTC",
    alerts: (r.alerts as Settings["alerts"]) || "osv",
    platform: json(r.platform, {}),
    schedule_ids: json(r.schedule_ids, {}),
    sample: r.sample === true,
  };
}

function asRepo(r: Record<string, unknown>): Repo {
  return { ...(r as unknown as Repo), managers: json<string[]>(r.managers, []), schedule_ids: json(r.schedule_ids, {}),
    github_repo_id: num(r.github_repo_id), active: r.active !== false };
}

function asUpdate(r: Record<string, unknown>): Update {
  return {
    ...(r as unknown as Update),
    changes: json<string[]>(r.changes, []),
    uses: json(r.uses, []),
    security: json(r.security, null),
    risk: json(r.risk, null),
    touches: num(r.touches),
    downloads_week: num(r.downloads_week),
    pr_number: num(r.pr_number),
    tried: ((r.tried as string) || "none") as Update["tried"],
  };
}

function asBatch(r: Record<string, unknown>): Batch {
  return {
    ...(r as unknown as Batch),
    pr_number: num(r.pr_number),
    review_notes: Number(r.review_notes || 0),
    steps: json(r.steps, []),
    commits: json(r.commits, []),
    files: json(r.files, []),
    check_runs: json(r.check_runs, []),
    checks: ((r.checks as string) || "none") as Batch["checks"],
    review: ((r.review as string) || "none") as Batch["review"],
  };
}

/** Everything the screens read, parsed. */
export function useDeps() {
  const { loaded, errors, reload } = useData();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const repoRows = useRows<Record<string, unknown>>("repos");
  const updateRows = useRows<Record<string, unknown>>("updates");
  const batchRows = useRows<Record<string, unknown>>("batches");
  const ignores = useRows<Ignore>("ignores");
  const rules = useRows<Rule>("rules");
  const sampleRows = useRows<{ n: number | string }>("sample");
  return useMemo(() => {
    const settings = asSettings(settingsRows[0]);
    const repos = repoRows.map(asRepo);
    const updates = updateRows.map(asUpdate);
    const batches = batchRows.map(asBatch);
    return {
      loaded, errors, reload, settings, repos, updates, batches, ignores,
      rules: rules.map((x) => ({ ...x, active: (x.active as unknown) !== false })),
      active: repos.filter((r) => r.active),
      sample: Number(sampleRows[0]?.n || 0) > 0,
    };
  }, [loaded, errors, reload, settingsRows, repoRows, updateRows, batchRows, ignores, rules, sampleRows]);
}

export type Deps = ReturnType<typeof useDeps>;

/* ---------- who ---------- */

export interface Me { id: string; name: string; email: string | null }
const MeContext = createContext<Me | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    void whoAmI().then((m) => {
      if (m) setMe({ id: m.id, email: m.email, name: m.name || (m.email || "").split("@")[0] || "You" });
    });
  }, []);
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me | null {
  return useContext(MeContext);
}

/* ---------- writes ---------- */

type Out = { message?: string; ok?: boolean; start?: StartHint | null } & Record<string, unknown>;
export interface StartHint { kind: "own" | "comment"; repo: string; text: string; pr_number?: number | null; batch_id?: string; update_id?: string }

export async function call(name: string, input: Record<string, unknown>): Promise<Out> {
  return ((await runFunction<Out>(name, input)) as Out) || {};
}

/** A decision; then the run it asks for, started as the person. */
export async function decide(id: string, action: string, extra: Record<string, unknown> = {}): Promise<string> {
  const out = await call("deps_decide", { id, action, ...extra });
  if (out.ok === false) return out.message || "That didn't go through.";
  if (out.start) {
    const started = await startFromHint(out.start);
    return [out.message, started].filter(Boolean).join(" ");
  }
  return out.message || "Done.";
}

async function startFromHint(hint: StartHint): Promise<string | null> {
  if (hint.kind === "own") return startRun(hint.repo, `own: ${hint.text}`, hint.text, "Its own pull request");
  return startRun(hint.repo, `Comment run on ${hint.repo} #${hint.pr_number}: ${hint.text}`,
    `Comment run on ${hint.repo} #${hint.pr_number} (asked from the Dependencies app): ${hint.text}`, `#${hint.pr_number}: ${hint.text}`);
}

/**
 * Start the agent as the person, in a checkout of the repository. A
 * repository the GitHub install doesn't cover for them is refused; the run
 * then starts without one and clones by hand.
 */
export async function startRun(repo: string, title: string, message: string, label: string): Promise<string | null> {
  if (DEMO) {
    demoNote(`In a Lemma, the Lemma starts on ${repo} now: ${label}. Nothing runs in the demo.`);
    return null;
  }
  const instructions = message;
  let conversation: { id: string } | null = null;
  try {
    conversation = (await client.conversations.createForAgent(AGENT, { repository: repo, title: title.slice(0, 120), instructions })) as unknown as { id: string };
  } catch {
    conversation = (await client.conversations.createForAgent(AGENT, { title: title.slice(0, 120), instructions })) as unknown as { id: string };
  }
  await client.conversations.appendMessage(conversation.id, { content: message });
  return `Started on ${repo}.`;
}

export async function openNow(repos: Repo[]): Promise<string> {
  const ready = repos.filter((r) => r.status === "ok" || r.status === "private_registry");
  if (!ready.length) return "No repository is ready: confirm its commands first.";
  const done: string[] = [];
  for (const r of ready) {
    try {
      await startRun(r.repo, `Weekly batch for ${r.repo}, opened now`, `Weekly batch for ${r.repo}: open the batch now, without waiting for the schedule.`, "this week's batch");
      done.push(r.repo);
    } catch (e) {
      return `Couldn't start ${r.repo}: ${e instanceof Error ? e.message : e}`;
    }
  }
  if (DEMO) return "";
  return `Started ${done.join(", ")}. Each pull request shows here when it opens.`;
}

/** Merge as the person, through the Lemma's GitHub connector. */
export async function merge(batch: Batch): Promise<string> {
  if (DEMO) {
    demoNote(`In a Lemma, this merges #${batch.pr_number} on GitHub as you. Nothing is merged in the demo.`);
    return "";
  }
  const [owner, repo] = batch.repo.split("/");
  await client.connectors.pod.execute("github", "pulls_merge", { owner, repo, pull_number: batch.pr_number, merge_method: "squash" });
  return `Merged #${batch.pr_number}. GitHub tells the Lemma, and its updates move to merged.`;
}

export async function addRule(text: string, me: Me | null) {
  await client.records.create("deps_rule", { text: text.trim(), by_name: me?.name || null, active: true } as never);
}

export async function removeRule(rule: Rule) {
  await client.records.delete("deps_rule", rule.id);
}

let needsTimer = 0;
/** The owner's items in Today, written again a moment after they open the app. */
export function refreshNeedsYou(): void {
  window.clearTimeout(needsTimer);
  needsTimer = window.setTimeout(() => void runFunction("deps_needs_you", {}).catch(() => undefined), 1500);
}

/* ---------- schedules, made as the owner ---------- */

const CRON_DAY: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function slug(repo: string): string {
  return repo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

async function findSchedule(name: string): Promise<string | undefined> {
  return items<{ id: string; name: string }>(await client.schedules.list({ name, limit: 5 } as never)).find((x) => x.name === name)?.id;
}

type Made = { made: Record<string, string>; problems: string[]; platform: Record<string, { state: string; note: string }> };

/**
 * The owner's schedules: per repository the weekly batch and the daily
 * security run (TIME, in a checkout of the repository when the platform
 * allows it: lemma-platform#1246; refused, made without it, and the run
 * clones by hand); once, the Dependabot alert event, GitHub's pull request,
 * check suite and review events, and @lemma comments.
 */
export async function ensureSchedules(settings: Settings, repos: Repo[], me: Me): Promise<Made> {
  const out: Made = { made: {}, problems: [], platform: {} };
  if (DEMO) return out;
  const [h, m] = (settings.run_time || "06:00").split(":").map((x) => Number(x));
  const zone = settings.timezone || "UTC";
  const timeSchedule = async (name: string, cron: string, instruction: string, repo: string) => {
    const existing = await findSchedule(name);
    if (existing) return existing;
    const base = { name, schedule_type: "TIME", agent_name: AGENT, instruction };
    try {
      const made = (await client.schedules.create({ ...base, config: { cron, timezone: zone, repository: repo } } as never)) as unknown as { id: string };
      return made.id;
    } catch (e) {
      out.platform.repository_schedule = { state: "no", note: `A time schedule can't name a repository yet (${e instanceof Error ? e.message : e}); each run clones by hand.` };
      const made = (await client.schedules.create({ ...base, config: { cron, timezone: zone } } as never)) as unknown as { id: string };
      return made.id;
    }
  };
  for (const r of repos.filter((x) => x.active)) {
    const ids: Record<string, string> = { ...r.schedule_ids };
    const s = slug(r.repo);
    try {
      ids[`deps-weekly-${s}`] = await timeSchedule(`deps-weekly-${s}`, `${m || 0} ${h || 6} * * ${CRON_DAY[settings.weekday] ?? 1}`,
        `Weekly batch for ${r.repo}.`, r.repo);
    } catch (e) {
      out.problems.push(`${r.repo}'s weekly batch (${e instanceof Error ? e.message : e})`);
    }
    try {
      ids[`deps-security-${s}`] = await timeSchedule(`deps-security-${s}`, "0 7 * * *", `Security run for ${r.repo}.`, r.repo);
    } catch (e) {
      out.problems.push(`${r.repo}'s daily security run (${e instanceof Error ? e.message : e})`);
    }
    if (JSON.stringify(ids) !== JSON.stringify(r.schedule_ids)) await update("deps_repo", r.id, { schedule_ids: ids }).catch(() => undefined);
  }
  const ids: Record<string, string> = { ...settings.schedule_ids };
  try {
    // One for every watched repository: the run keeps only watched ones.
    const name = "deps-alert";
    ids[name] = (await findSchedule(name)) || ((await client.schedules.create({
      name, schedule_type: "WEBHOOK", agent_name: AGENT, pod_connector: "github", connector_trigger_id: "github:http:dependabot_alert",
      config: { source: "github", event: "dependabot_alert", actions: ["created", "reintroduced"] },
      instruction: "Security run: a Dependabot alert was raised. Act only on a repository Dependency updates watches (deps_repo).",
    } as never)) as unknown as { id: string }).id;
    out.platform.alert_trigger = { state: "yes", note: "Wakes on a Dependabot alert." };
  } catch (e) {
    out.platform.alert_trigger = { state: "no", note: `No Dependabot alert event yet (${e instanceof Error ? e.message : e}); the daily run finds them.` };
  }
  const events: [string, string][] = [["deps-github-pr", "deps-on-pull-request"], ["deps-github-checks", "deps-on-check-suite"], ["deps-github-review", "deps-on-review"]];
  for (const [name, workflow] of events) {
    try {
      ids[name] = (await findSchedule(name)) || ((await client.schedules.create({
        name, schedule_type: "WEBHOOK", workflow_name: workflow, pod_connector: "github", config: { source: "github" },
      } as never)) as unknown as { id: string }).id;
    } catch (e) {
      out.problems.push(`GitHub's ${workflow.replace("deps-on-", "").replace("-", " ")} events (${e instanceof Error ? e.message : e})`);
    }
  }
  try {
    const name = "deps-comment";
    ids[name] = (await findSchedule(name)) || ((await client.schedules.create({
      name, schedule_type: "WEBHOOK", agent_name: AGENT, pod_connector: "github", connector_trigger_id: "github:http:issue_comment",
      config: { source: "github", event: "issue_comment" },
      filter_instruction: "Only a new comment that starts with @lemma, on a pull request (not an issue) labelled dependencies.",
      instruction: "Comment run: carry out the @lemma request in this comment on the dependency pull request.",
    } as never)) as unknown as { id: string }).id;
  } catch (e) {
    out.problems.push(`@lemma comments (${e instanceof Error ? e.message : e})`);
  }
  out.made = ids;
  const patch: Record<string, unknown> = { schedule_ids: ids, schedule_user_id: me.id };
  if (Object.keys(out.platform).length) {
    const platform = { ...settings.platform };
    const at = new Date().toISOString();
    for (const [k, v] of Object.entries(out.platform)) platform[k] = { state: v.state as "yes" | "no", note: v.note, at };
    patch.platform = platform;
  }
  await update("deps_settings", settings.id, patch).catch(() => undefined);
  return out;
}

/** The repositories the GitHub install covers for this person. */
export async function coveredRepos(): Promise<{ repos: { full_name: string; default_branch?: string | null; private?: boolean }[]; problem: string | null }> {
  if (DEMO) return { repos: [], problem: null };
  try {
    const out = await client.conversations.repositories();
    return {
      repos: (out.items || []).map((r) => ({ full_name: r.full_name, default_branch: r.default_branch ?? null, private: r.private === true }))
        .filter((r) => r.full_name.includes("/")),
      problem: null,
    };
  } catch (e) {
    return { repos: [], problem: e instanceof Error ? e.message : String(e) };
  }
}

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return zone === "Asia/Calcutta" ? "Asia/Kolkata" : zone;
}
