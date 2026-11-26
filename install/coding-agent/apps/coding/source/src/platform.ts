// Platform calls the vendored SDK has no method for yet, through the kit
// client's raw request, and GitHub through the Lemma's shared connection.
//
// - usage (lemma-platform#1243): GET /pods/{pod}/conversations/{id}/usage
// - changes (lemma-platform#1244): GET /pods/{pod}/conversations/{id}/changes?patch=true
//
// A 404 or 422 means the server doesn't have the endpoint yet: the app stops
// asking for the page's life and hides what it would have shown. Nothing is
// ever estimated in its place. A conversation is readable only by the person
// who started it, so both are asked only for the viewer's own sessions.

import { client } from "@lemma-plugins/kit";

function statusOf(e: unknown): number {
  const err = e as { statusCode?: number; status?: number };
  return Number(err?.statusCode || err?.status || 0);
}

const missing = new Set<string>();
const NOT_YET = new Set([404, 405, 422, 501]);

async function optional<T>(feature: string, path: string, params?: Record<string, string | number | boolean>): Promise<T | null> {
  if (missing.has(feature)) return null;
  try {
    return await client.request<T>("GET", path, { params });
  } catch (e) {
    if (NOT_YET.has(statusOf(e))) missing.add(feature);
    return null;
  }
}

export interface Usage {
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  unreported: number;
}

const usageCache = new Map<string, Promise<Usage | null>>();

/** What a conversation has cost so far, or null when the server can't say. */
export function usage(conversationId: string, fresh = false): Promise<Usage | null> {
  if (!fresh && usageCache.has(conversationId)) return usageCache.get(conversationId)!;
  const p = optional<{ totals?: Record<string, unknown>; unreported_run_count?: number }>(
    "usage", `/pods/${client.podId}/conversations/${encodeURIComponent(conversationId)}/usage`,
  ).then((r) => {
    if (!r || !r.totals || typeof r.totals !== "object") return null;
    const n = (v: unknown) => (typeof v === "number" ? v : v == null ? null : Number(v));
    return {
      cost_usd: n(r.totals.cost_usd),
      input_tokens: n(r.totals.input_tokens),
      output_tokens: n(r.totals.output_tokens),
      unreported: Number(r.unreported_run_count || 0),
    };
  });
  usageCache.set(conversationId, p);
  return p;
}

export function usageMissing(): boolean {
  return missing.has("usage");
}

export interface ChangedFile {
  path: string;
  old_path?: string | null;
  status: string;
  additions: number;
  deletions: number;
  binary?: boolean;
  patch?: string | null;
}

export interface Changes {
  /** Where the list came from, said on screen. */
  from: "worktree" | "pull" | "compare" | "transcript";
  state?: string;
  branch?: string | null;
  base?: string | null;
  ahead?: number | null;
  files: ChangedFile[];
  additions: number;
  deletions: number;
  uncommitted?: boolean;
  truncated?: boolean;
}

/** The worktree's own diff (#1244), or null when the server can't give it. */
export async function worktreeChanges(conversationId: string): Promise<Changes | { state: string } | null> {
  const r = await optional<Record<string, unknown>>("changes", `/pods/${client.podId}/conversations/${encodeURIComponent(conversationId)}/changes`, { patch: true });
  if (!r || typeof r.state !== "string") return null;
  if (r.state !== "ready") return { state: r.state };
  const files = splitPatch(String(r.patch || ""));
  const list = ((r.files as ChangedFile[]) || []).map((f) => ({ ...f, patch: files.get(f.path) ?? null }));
  const totals = (r.totals || {}) as { additions?: number; deletions?: number };
  return {
    from: "worktree", state: "ready", branch: (r.branch as string) || null, base: (r.base_ref as string) || null,
    ahead: (r.ahead as number) ?? null, files: list, additions: Number(totals.additions || 0), deletions: Number(totals.deletions || 0),
    uncommitted: Boolean(r.uncommitted), truncated: Boolean(r.truncated),
  };
}

/** A unified diff, cut into each file's part. */
function splitPatch(patch: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of patch.split(/^(?=diff --git )/m)) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(part);
    if (!m) continue;
    const body = part.slice(part.indexOf("@@") >= 0 ? part.indexOf("@@") : part.length);
    out.set(m[2], body);
  }
  return out;
}

/* ---------- GitHub, through the Lemma's shared connection ---------- */

// A refusal is thrown as the SDK gives it, code and all: say it with the kit's
// errorText(e, "github"), or hand it to <Connect error>, never as its message.

export async function github<T = unknown>(op: string, payload: Record<string, unknown>): Promise<T> {
  const r = (await client.connectors.pod.execute("github", op, payload)) as unknown as { result?: unknown; data?: unknown };
  const out = r && typeof r === "object" && "result" in r ? r.result : r && typeof r === "object" && "data" in r ? r.data : r;
  return out as T;
}

export function split(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split("/");
  return { owner, repo: name };
}

type GhFile = { filename: string; previous_filename?: string; status: string; additions: number; deletions: number; patch?: string };

function fromGh(files: GhFile[]): ChangedFile[] {
  return files.map((f) => ({
    path: f.filename, old_path: f.previous_filename || null, status: f.status, additions: f.additions || 0, deletions: f.deletions || 0,
    binary: f.patch == null && !f.additions && !f.deletions, patch: f.patch ?? null,
  }));
}

const listOf = <T,>(r: unknown, key?: string): T[] => {
  if (Array.isArray(r)) return r as T[];
  const o = r as Record<string, unknown> | null;
  if (o && key && Array.isArray(o[key])) return o[key] as T[];
  if (o && Array.isArray(o.items)) return o.items as T[];
  return [];
};

export async function pullChanges(repo: string, pr: number): Promise<Changes> {
  const files = fromGh(listOf<GhFile>(await github("pulls_list_files", { ...split(repo), pull_number: pr, per_page: 100 })));
  return { from: "pull", files, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) };
}

export async function compareChanges(repo: string, base: string, branch: string): Promise<Changes> {
  const r = await github<{ files?: GhFile[]; ahead_by?: number }>("repos_compare_commits", { ...split(repo), basehead: `${base}...${branch}` });
  const files = fromGh(r?.files || []);
  return { from: "compare", base, branch, ahead: r?.ahead_by ?? null, files,
    additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) };
}

export interface RefChoice {
  kind: "branch" | "tag" | "pull";
  name: string;
  ref: string;
  /** A pull request's own branch, to push to. */
  head?: string;
  title?: string;
}

/** Where a branch can start: branches, tags and open pull requests. */
export async function refsOf(repo: string): Promise<RefChoice[]> {
  const r = split(repo);
  const [branches, tags, pulls] = await Promise.all([
    github("repos_list_branches", { ...r, per_page: 50 }).then((x) => listOf<{ name: string }>(x)).catch(() => []),
    github("repos_list_tags", { ...r, per_page: 20 }).then((x) => listOf<{ name: string }>(x)).catch(() => []),
    github("pulls_list", { ...r, state: "open", per_page: 30 }).then((x) => listOf<{ number: number; title: string; head?: { ref?: string } }>(x)).catch(() => []),
  ]);
  return [
    ...branches.map((b) => ({ kind: "branch" as const, name: b.name, ref: b.name })),
    ...pulls.map((p) => ({ kind: "pull" as const, name: `#${p.number}`, ref: `pull/${p.number}/head`, head: p.head?.ref, title: p.title })),
    ...tags.map((t) => ({ kind: "tag" as const, name: t.name, ref: t.name })),
  ];
}

/** Pod files the agent saved as proof under /coding/<session>/. */
export async function proofFiles(sessionId: string): Promise<{ name: string; path: string }[]> {
  try {
    const r = (await client.files.list({ directoryPath: `/coding/${sessionId}`, limit: 50 })) as unknown as { items?: { name?: string; path?: string; type?: string; kind?: string }[] };
    return (r.items || [])
      .filter((f) => f.name && !/folder|directory/i.test(String(f.type || f.kind || "")) && (!f.path || f.path.startsWith(`/coding/${sessionId}/`)))
      .map((f) => ({ name: String(f.name), path: String(f.path || `/coding/${sessionId}/${f.name}`) }));
  } catch {
    return [];
  }
}

export async function openFile(path: string): Promise<void> {
  try {
    const u = (await client.files.getUrl(path)) as unknown as { app_url?: string; url?: string };
    const href = u.app_url || u.url;
    if (href) window.open(href, "_blank", "noopener");
  } catch {
    /* the toast in the caller says so */
    throw new Error("Couldn't open the file.");
  }
}
