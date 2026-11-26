// GitHub, from the browser. Never a token in the page. Two connectors:
// - `github`, the Lemma's one shared connection: every read (files, checks,
//   pull requests), so the inbox works for everyone without connecting;
// - `github-personal`, each person's own GitHub: only what is posted as
//   them (send back as you, approve, merge), so it carries their name and
//   never the name of whoever shared `github`.
// Posting as the Lemma's bot is a function's job (prr_send_back, prr_merge).
//
// What GitHub says is remembered for a minute per pull request and commit, so
// moving between the inbox and a pull request shows what was last seen at once
// and refreshes behind it.

import { client, errorText, isConnectionProblem } from "@lemma-plugins/kit";
import { isConnectionRequiredError } from "lemma-sdk";

export const GITHUB = "github";
export const GITHUB_PERSONAL = "github-personal";

export interface GhFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  previous_filename?: string;
  blob_url?: string;
}

export interface GhPull {
  number: number;
  state: string;
  merged?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  commits?: number;
  draft?: boolean;
  head?: { sha: string; ref: string };
  base?: { ref: string };
  user?: { login: string };
  html_url?: string;
  labels?: { name: string }[];
}

export interface GhCheck {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
  app?: { slug?: string };
}

export interface GhRepo {
  full_name: string;
  default_branch: string;
  private: boolean;
  pushed_at?: string;
  id?: number;
}

/** A GitHub connection isn't there (or expired, or is refused): which one,
 *  with the platform's code and details kept for the kit's `<Connect error>`,
 *  and never its text on screen. */
export class NeedsGithub extends Error {
  code?: string;
  status?: number;
  statusCode?: number;
  details?: Record<string, unknown> | null;
  connectUrl: string | null;
  /** Their own GitHub (to post as themselves), not the Lemma's shared one. */
  personal: boolean;
  constructor(err: unknown, personal = false) {
    const e = (err || {}) as { message?: string; code?: string; status?: number; statusCode?: number; details?: Record<string, unknown> | null; connectUrl?: string | null };
    super(e.message || String(err));
    this.code = e.code;
    this.status = e.status;
    this.statusCode = e.statusCode;
    this.details = e.details ?? null;
    this.connectUrl = e.connectUrl ?? null;
    this.personal = personal;
  }
}

/** The Lemma's shared GitHub is what is missing. */
export function needsGithub(err: unknown): err is NeedsGithub {
  return err instanceof NeedsGithub && !err.personal;
}

/** The person's own GitHub is what is missing (to post as themselves). */
export function needsMyGithub(err: unknown): err is NeedsGithub {
  return err instanceof NeedsGithub && err.personal;
}

/** GitHub's own words when it refuses, without the transport's wrapping; a
 *  missing connection in the kit's words. */
export function githubSays(err: unknown): string {
  if (err instanceof NeedsGithub) return errorText(err, "github");
  const e = err as { message?: string; details?: unknown; body?: unknown };
  const raw = e?.message || String(err);
  const m = /"message"\s*:\s*"([^"]+)"/.exec(raw);
  return (m ? m[1] : errorText(err)).replace(/^Error:\s*/, "").slice(0, 300);
}

export async function gh<T = unknown>(op: string, payload: Record<string, unknown>, connector: string = GITHUB): Promise<T> {
  try {
    const r = (await client.connectors.pod.execute(connector, op, payload)) as unknown as { result?: unknown; data?: unknown };
    const out = r && typeof r === "object" && "result" in r ? r.result : r;
    const data = out && typeof out === "object" && "data" in (out as object) && !Array.isArray(out) && Object.keys(out as object).length <= 3 ? (out as { data: unknown }).data : out;
    return data as T;
  } catch (err) {
    if (isConnectionRequiredError(err) || isConnectionProblem(err)) throw new NeedsGithub(err, connector === GITHUB_PERSONAL);
    throw err;
  }
}

const listOf = <T,>(r: unknown, key?: string): T[] => {
  if (Array.isArray(r)) return r as T[];
  const o = r as Record<string, unknown> | null;
  if (o && key && Array.isArray(o[key])) return o[key] as T[];
  if (o && Array.isArray(o.items)) return o.items as T[];
  return [];
};

export function split(full: string): { owner: string; repo: string } {
  const [owner, repo] = full.split("/");
  return { owner, repo };
}

export async function prFiles(repo: string, number: number, max = 1000): Promise<GhFile[]> {
  const out: GhFile[] = [];
  for (let page = 1; page <= Math.ceil(max / 100); page++) {
    const batch = listOf<GhFile>(await gh("pulls_list_files", { ...split(repo), pull_number: number, per_page: 100, page }));
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export async function pull(repo: string, number: number): Promise<GhPull> {
  return gh<GhPull>("pulls_get", { ...split(repo), pull_number: number });
}

export async function checks(repo: string, ref: string): Promise<GhCheck[]> {
  const runs = listOf<GhCheck>(await gh("checks_list_for_ref", { ...split(repo), ref, per_page: 100 }), "check_runs");
  // GitHub lists every attempt; the newest run of each name is the one that counts.
  const latest = new Map<string, GhCheck>();
  for (const c of runs) if (!latest.has(c.name) || c.id > latest.get(c.name)!.id) latest.set(c.name, c);
  return [...latest.values()];
}

export async function myRepos(): Promise<GhRepo[]> {
  return listOf<GhRepo>(await gh("repos_list_for_authenticated_user", { per_page: 100, sort: "pushed", direction: "desc" }));
}

export interface ReviewComment {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

/** A review under the person's own name: changes requested, or approved. */
export async function postReview(repo: string, number: number, sha: string, event: "REQUEST_CHANGES" | "APPROVE" | "COMMENT", body: string, comments: ReviewComment[] = []) {
  return gh("pulls_create_review", { ...split(repo), pull_number: number, commit_id: sha, event, body, ...(comments.length ? { comments } : {}) }, GITHUB_PERSONAL);
}

export async function mergePull(repo: string, number: number, sha: string, method: "squash" | "merge" | "rebase") {
  return gh<{ merged?: boolean; message?: string }>("pulls_merge", { ...split(repo), pull_number: number, sha, merge_method: method }, GITHUB_PERSONAL);
}

/* ---------- a minute's memory ---------- */

interface Entry<T> {
  at: number;
  value?: T;
  error?: unknown;
  next: Promise<T>;
}
const store = new Map<string, Entry<unknown>>();
const TTL = 60_000;

/** What we already know (maybe nothing), and the fresh answer when it comes. */
export function remembered<T>(key: string, load: () => Promise<T>): { now: T | undefined; next: Promise<T> } {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at < TTL) return { now: hit.value, next: hit.next };
  const entry: Entry<T> = { at: Date.now(), value: hit?.value, next: Promise.resolve(undefined as T) };
  entry.next = load().then((v) => {
    entry.value = v;
    return v;
  });
  entry.next.catch(() => store.delete(key));
  store.set(key, entry as Entry<unknown>);
  return { now: entry.value, next: entry.next };
}

export const checksOf = (repo: string, sha: string) => remembered(`checks:${repo}@${sha}`, () => checks(repo, sha));
export const filesOf = (repo: string, n: number, sha: string) => remembered(`files:${repo}#${n}@${sha}`, () => prFiles(repo, n));
export const pullOf = (repo: string, n: number) => remembered(`pull:${repo}#${n}`, () => pull(repo, n));
/** After a write that changes GitHub's answer (a merge, a review), forget it. */
export function forget(repo: string, n: number): void {
  for (const k of [...store.keys()]) if (k.includes(`${repo}#${n}`)) store.delete(k);
}

/* ---------- reading checks ---------- */

export const FAILED = ["failure", "timed_out", "cancelled", "action_required"];
export const LEMMA_CHECK = "Lemma check";

export type ChecksSummary = { state: "passing" | "failing" | "running" | "none"; passed: number; failing: string[]; running: number; total: number };

export function summarize(list: GhCheck[]): ChecksSummary {
  const real = list.filter((c) => c.name !== LEMMA_CHECK);
  const failing = real.filter((c) => c.status === "completed" && FAILED.includes(c.conclusion || "")).map((c) => c.name);
  const running = real.filter((c) => c.status !== "completed").length;
  const passed = real.length - failing.length - running;
  const state = !real.length ? "none" : failing.length ? "failing" : running ? "running" : "passing";
  return { state, passed, failing, running, total: real.length };
}

/** Why GitHub will turn a merge away right now, read from what GitHub decides on. */
export function mergeBlock(p: GhPull | null | undefined, ci: GhCheck[] | null | undefined, reviewedSha?: string | null): string | null {
  if (!p) return null;
  const base = p.base?.ref || "the base branch";
  if (p.merged) return "Already merged on GitHub.";
  if (p.state !== "open") return "Closed on GitHub.";
  if (p.draft || p.mergeable_state === "draft") return "Still a draft: mark it ready for review on GitHub first.";
  if (p.mergeable_state === "dirty") return `Conflicts with ${base}: resolve them on the branch first.`;
  if (p.mergeable_state === "behind") return `Behind ${base}: this repository merges only branches that are up to date.`;
  if (reviewedSha && p.head?.sha && p.head.sha !== reviewedSha) return "New commits since the review: wait for the next round.";
  if (p.mergeable_state === "blocked") {
    const s = summarize(ci || []);
    if (s.failing.length) return `Blocked: ${s.failing.join(", ")} failing.`;
    if (s.running) return `Blocked until ${s.running} ${s.running === 1 ? "check finishes" : "checks finish"}.`;
    return "Blocked by the repository's rules: a required review or check is missing.";
  }
  return null;
}
