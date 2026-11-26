// The app's working set, who is looking, and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). Every table here is the team's: PR review has no private rows.
//
// Writes: PR review's functions for anything that touches GitHub as the
// Lemma's bot or more than one row (send back, fix it, a decision on a
// finding, hold, merge by itself, set-up); GitHub itself, from the browser as
// the signed-in person, for a review or a merge under their own name
// (github.ts).

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO, client, errorText, items, runFunction, update, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import type { Finding, Member, MergeLog, PullRequest, Repository, RiskPath, Round, Rule, Settings } from "./types";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM prr_settings ORDER BY created_at LIMIT 1", tables: ["prr_settings"] },
  repos: { sql: "SELECT * FROM repository ORDER BY full_name", tables: ["repository"] },
  prs: { sql: "SELECT * FROM pull_request ORDER BY updated_at DESC LIMIT 600", tables: ["pull_request"] },
  rounds: { sql: "SELECT * FROM prr_round ORDER BY created_at DESC LIMIT 1500", tables: ["prr_round"] },
  findings: { sql: "SELECT * FROM prr_finding ORDER BY created_at DESC LIMIT 4000", tables: ["prr_finding"] },
  rules: { sql: "SELECT * FROM prr_rule ORDER BY created_at", tables: ["prr_rule"] },
  members: { sql: "SELECT * FROM prr_member ORDER BY login", tables: ["prr_member"] },
  risk: { sql: "SELECT * FROM prr_risk_path ORDER BY glob", tables: ["prr_risk_path"] },
  log: { sql: "SELECT * FROM prr_merge_log ORDER BY at DESC LIMIT 600", tables: ["prr_merge_log"] },
};

/* ---------- who is looking ---------- */

export interface Person {
  user_id: string;
  name: string;
  email: string;
}

interface Who {
  me: { id: string; name: string; email: string | null } | null;
  people: Person[];
  canAdmin: boolean;
  ready: boolean;
}

const WhoContext = createContext<Who>({ me: null, people: [], canAdmin: false, ready: false });

export function WhoProvider({ children }: { children: ReactNode }) {
  const [who, setWho] = useState<Who>({ me: null, people: [], canAdmin: false, ready: false });
  useEffect(() => {
    void (async () => {
      const [me, members] = await Promise.all([
        whoAmI(),
        client.podMembers
          .list(client.podId || "", { limit: 200 })
          .then((r) => items<{ user_id: string; user_name?: string | null; user_email?: string; email?: string; roles?: string[] }>(r))
          .catch(() => []),
      ]);
      const people = members.map((m) => ({
        user_id: m.user_id,
        email: m.user_email || m.email || "",
        name: m.user_name || (m.user_email || m.email || "").split("@")[0] || "Someone",
      }));
      const mine = members.find((m) => m.user_id === me?.id);
      const roles = (mine?.roles || []).map((r) => r.toUpperCase());
      setWho({
        me: me ? { id: me.id, email: me.email, name: people.find((p) => p.user_id === me.id)?.name || me.name || (me.email || "").split("@")[0] || "You" } : null,
        people,
        canAdmin: roles.some((r) => r.includes("ADMIN") || r.includes("OWNER")),
        ready: true,
      });
    })();
  }, []);
  return <WhoContext.Provider value={who}>{children}</WhoContext.Provider>;
}

export function useWho(): Who {
  return useContext(WhoContext);
}

/* ---------- the working set ---------- */

const json = <T,>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

function asRound(r: Record<string, unknown>): Round {
  return {
    ...(r as unknown as Round),
    seq: Number(r.seq) || 1,
    ledger: json(r.ledger, []),
    key_changes: json(r.key_changes, []),
    mechanical: json(r.mechanical, []),
    lines_to_read: json(r.lines_to_read, []),
    cross_pr: json(r.cross_pr, []),
    files: json(r.files, []),
    counts: json(r.counts, null),
    github: json(r.github, null),
    risk_reasons: json(r.risk_reasons, []),
  };
}

function asSettings(r: Record<string, unknown> | undefined): Settings | null {
  if (!r) return null;
  return { ...(r as unknown as Settings), merge: json(r.merge, null), platform: json(r.platform, null), schedules: json(r.schedules, null) };
}

function asRule(r: Record<string, unknown>): Rule {
  return { ...(r as unknown as Rule), scope: json(r.scope, []), quotes: json(r.quotes, []) };
}

/** A posting state's first word: ok, off, needs_platform, no_permission, failed. */
export function postWord(state: string | null | undefined): string | null {
  return state ? String(state).split(":")[0] : null;
}

export const WEEK = 7 * 86_400_000;
export const isOpenFinding = (f: Finding) => f.state === "open";

export type Section = "review" | "merge" | "itself" | "returned" | "others" | "reviewing" | "merged" | "closed";

export const SECTIONS: { id: Section; label: string }[] = [
  { id: "review", label: "Needs your review" },
  { id: "merge", label: "Ready for you to merge" },
  { id: "itself", label: "Merging by itself" },
  { id: "returned", label: "Returned to you" },
  { id: "others", label: "Waiting on others" },
  { id: "reviewing", label: "Reviewing now" },
];

export function usePrr() {
  const { loaded, errors, reload } = useData();
  const { me } = useWho();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const repos = useRows<Repository>("repos");
  const prs = useRows<PullRequest>("prs");
  const roundRows = useRows<Record<string, unknown>>("rounds");
  const findings = useRows<Finding>("findings");
  const ruleRows = useRows<Record<string, unknown>>("rules");
  const members = useRows<Member>("members");
  const risk = useRows<RiskPath>("risk");
  const log = useRows<MergeLog>("log");

  return useMemo(() => {
    const settings = asSettings(settingsRows[0]);
    const rules = ruleRows.map(asRule);
    const repoById = new Map(repos.map((r) => [r.id, r]));
    const rounds = roundRows.map(asRound);
    const roundsByPr = new Map<string, Round[]>();
    for (const r of rounds) (roundsByPr.get(r.pull_request_id) || roundsByPr.set(r.pull_request_id, []).get(r.pull_request_id)!).push(r);
    for (const list of roundsByPr.values()) list.sort((a, b) => b.seq - a.seq);
    const roundById = new Map(rounds.map((r) => [r.id, r]));
    /** A finding's round, by id, as the pull request counts it (1, 2, ...). */
    const seqOf = (roundId: string | null | undefined) => (roundId ? roundById.get(roundId)?.seq ?? null : null);
    const findingsByPr = new Map<string, Finding[]>();
    for (const f of findings) (findingsByPr.get(f.pull_request_id) || findingsByPr.set(f.pull_request_id, []).get(f.pull_request_id)!).push(f);
    const ruleById = new Map(rules.map((r) => [r.id, r]));
    const memberByUser = new Map(members.filter((m) => m.user_id).map((m) => [m.user_id as string, m]));
    const memberByLogin = new Map(members.map((m) => [m.login.toLowerCase(), m]));
    const myLogins = new Set(members.filter((m) => me && m.user_id === me.id).map((m) => m.login.toLowerCase()));

    const repoOf = (pr: PullRequest) => pr.repo || (pr.repository_id && repoById.get(pr.repository_id)?.full_name) || pr.key.split("#")[0];
    /** The newest round that is not superseded. */
    const latest = (pr: PullRequest) => roundsByPr.get(pr.id)?.find((r) => r.status !== "superseded") || null;
    const isMine = (pr: PullRequest) => (!!me && pr.author_user_id === me.id) || (!!pr.author && myLogins.has(pr.author.toLowerCase()));
    const waitsOnMe = (pr: PullRequest) => !!me && pr.waits_on === me.id;

    const sectionOf = (pr: PullRequest): Section => {
      if (pr.state === "merged" || pr.merged_at) return "merged";
      if (pr.state === "closed") return "closed";
      if (pr.merge_state === "merging" || pr.merge_state === "held") return "itself";
      const r = latest(pr);
      if (pr.review_state === "queued" || pr.review_state === "reviewing" || r?.status === "queued" || r?.status === "running") return "reviewing";
      if (waitsOnMe(pr)) {
        if (pr.waits_for === "fix" || (isMine(pr) && pr.waits_for !== "merge")) return "returned";
        if (pr.waits_for === "merge" || (!pr.waits_for && pr.verdict === "clean")) return "merge";
        return "review";
      }
      return "others";
    };

    /** In this person's inbox: what waits on them, what merges by itself, what is being read, and their own (or an agent's) waiting on others. */
    const inInbox = (pr: PullRequest) => {
      const sec = sectionOf(pr);
      if (sec === "merged" || sec === "closed") return false;
      if (sec !== "others") return true;
      return isMine(pr) || pr.author_kind === "agent";
    };

    const sample = prs.some((p) => p.source === "sample") || !!settings?.sample;
    /** What the platform lets the Lemma's own GitHub App do yet, as last tried. */
    const platform = settings?.platform || null;
    const botBlocked = postWord(platform?.app) === "needs_platform" ? "needs_platform" : postWord(platform?.app) === "no_permission" ? "no_permission" : null;
    return {
      loaded,
      errors,
      reload,
      settings,
      repos,
      prs,
      rounds,
      findings,
      rules,
      members,
      risk,
      log,
      sample,
      repoById,
      roundsByPr,
      roundById,
      seqOf,
      platform,
      botBlocked,
      findingsByPr,
      ruleById,
      memberByUser,
      memberByLogin,
      repoOf,
      latest,
      isMine,
      sectionOf,
      inInbox,
    };
  }, [loaded, errors, reload, me, settingsRows, repos, prs, roundRows, findings, ruleRows, members, risk, log]);
}

export type Prr = ReturnType<typeof usePrr>;

/** A person's name from a member id, a GitHub login, or "nobody". */
export function whoIs(prr: Prr, people: Person[], meId: string | undefined, idOrLogin: string | null | undefined, name?: string | null): string {
  if (!idOrLogin || idOrLogin === "nobody") return "nobody";
  if (idOrLogin === "author") return name || "the author";
  if (meId && idOrLogin === meId) return "you";
  const person = people.find((p) => p.user_id === idOrLogin);
  const member = prr.memberByUser.get(idOrLogin) || prr.memberByLogin.get(idOrLogin.toLowerCase());
  if (member && meId && member.user_id === meId) return "you";
  return member?.login || name || person?.name.split(" ")[0].toLowerCase() || idOrLogin;
}

/* ---------- writes ---------- */

export const act = {
  sendBack: (prId: string, findingIds: string[], note?: string) =>
    runFunction<{ message?: string; review_url?: string }>("prr_send_back", { pull_request_id: prId, finding_ids: findingIds, note: note || null }),
  fixTask: (findingId: string) => runFunction<{ task_id?: string; number?: number; message?: string }>("prr_fix_task", { finding_id: findingId }),
  decide: (findingId: string, decision: "not_worth" | "wrong" | "reopen") => runFunction<{ message?: string }>("prr_decide_finding", { finding_id: findingId, decision }),
  hold: (prId: string, hold: boolean) => runFunction<{ message?: string }>("prr_hold", { pull_request_id: prId, hold }),
  mergeNow: (prId: string) => runFunction<{ message?: string; merged?: boolean }>("prr_merge", { pull_request_id: prId, now: true }),
  /** Flat: repos [{full_name, review_mode, merge_mode}], posts_as, check_on, comments, approve_when_clean, merge, daily_cap, accept_file_rules, read_rules. */
  setup: (input: Record<string, unknown>) => runFunction<SetupResult>("prr_setup_save", input),
  readRules: (repositoryIds?: string[]) => runFunction<{ message?: string }>("prr_read_rules", repositoryIds ? { repository_ids: repositoryIds } : {}),
  sample: (mode: "load" | "clear") => runFunction<{ message?: string }>("prr_sample_data", { mode }),
};

export interface ScheduleSpec {
  name: string;
  schedule_type: string;
  workflow_name: string;
  pod_connector?: string;
  connector_trigger_id?: string;
  config: Record<string, unknown>;
}

export interface SetupResult {
  saved?: boolean;
  message?: string;
  schedules?: ScheduleSpec[];
  member_schedule?: Partial<ScheduleSpec> & { name_prefix?: string };
}

/** The Lemma-wide GitHub webhooks, made as the person setting up (prr_setup_save names them). */
export const TEAM_SCHEDULES: ScheduleSpec[] = [
  { name: "prr-pull-requests", schedule_type: "WEBHOOK", workflow_name: "prr-on-pull-request", pod_connector: "github", connector_trigger_id: "github:http:pull_request",
    config: { source: "github", event: "pull_request", actions: ["opened", "synchronize", "reopened", "ready_for_review", "closed", "labeled", "unlabeled"] } },
  { name: "prr-reviews", schedule_type: "WEBHOOK", workflow_name: "prr-on-review", pod_connector: "github", connector_trigger_id: "github:http:pull_request_review",
    config: { source: "github", event: "pull_request_review", actions: ["submitted", "dismissed"] } },
  { name: "prr-check-suites", schedule_type: "WEBHOOK", workflow_name: "prr-on-check-suite", pod_connector: "github", connector_trigger_id: "github:http:check_suite",
    config: { source: "github", event: "check_suite", actions: ["completed"] } },
];

/** Each member's own: what waits on them becomes Review this / Merge this in their Today. */
export const MEMBER_SCHEDULE = {
  name_prefix: "prr-needs-you", schedule_type: "DATASTORE", workflow_name: "prr-needs-you",
  config: { table_name: "pull_request", operations: ["INSERT", "UPDATE"], rows: "OWNER_READABLE", bulk_writes: "each", when: { waits_since: { changed: true } } },
};

async function haveSchedule(name: string): Promise<{ id: string } | null> {
  return items<{ id: string; name: string }>(await client.schedules.list({ name, limit: 5 } as never)).find((x) => x.name === name) || null;
}

/** Make the team's GitHub webhooks, once, as this person; record them on the settings row. */
export async function ensureTeamSchedules(settingsId: string | null | undefined, meId: string, specs: ScheduleSpec[] = TEAM_SCHEDULES): Promise<string | null> {
  if (DEMO) return null;
  const made: Record<string, string> = {};
  const problems: string[] = [];
  for (const spec of specs) {
    try {
      const found = await haveSchedule(spec.name);
      const { why: _why, ...request } = spec as ScheduleSpec & { why?: string };
      made[spec.name] = found ? found.id : ((await client.schedules.create(request as never)) as unknown as { id: string }).id;
    } catch (e) {
      problems.push(`${spec.workflow_name} (${errText(e)})`);
    }
  }
  if (settingsId) await update("prr_settings", settingsId, { schedules: made, schedule_user_id: meId }).catch(() => undefined);
  return problems.length ? `Couldn't turn on the GitHub triggers: ${problems.join("; ")}` : null;
}

/** This person's own needs_you trigger, once per open. */
export async function ensureMine(meId: string): Promise<string | null> {
  if (DEMO) return null;
  const name = `${MEMBER_SCHEDULE.name_prefix}-${meId.replace(/-/g, "").slice(0, 8)}`;
  try {
    if (!(await haveSchedule(name))) await client.schedules.create({ name, schedule_type: MEMBER_SCHEDULE.schedule_type, workflow_name: MEMBER_SCHEDULE.workflow_name, config: MEMBER_SCHEDULE.config } as never);
    return null;
  } catch (e) {
    return `Couldn't make your own trigger for Today: ${errText(e)}`;
  }
}

export function errText(e: unknown): string {
  return errorText(e);
}
