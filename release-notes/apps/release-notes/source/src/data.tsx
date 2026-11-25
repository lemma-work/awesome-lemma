// The app's working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). Release notes' own tables and `ask` are the team's; `draft`
// and `conversation` are each person's own (row-level security), so this
// person sees only their own replies and threads.
//
// Writes that change what was published, or reach outside the Lemma, go
// through functions (publish, send); edits to a line, a pull request left
// out, and a suggested link confirmed are one row each, written here.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { client, items, q, runFunction, sql, update, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import type { Ask, Draft, Line, Member, Note, Pr, Reply, Settings } from "./types";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM release_note_settings ORDER BY created_at LIMIT 1", tables: ["release_note_settings"] },
  notes: { sql: "SELECT * FROM release_note ORDER BY created_at DESC LIMIT 300", tables: ["release_note"] },
  lines: { sql: "SELECT * FROM release_note_line ORDER BY position LIMIT 5000", tables: ["release_note_line"] },
  prs: {
    sql: "SELECT id, repo, number, title, author, url, merged_at, labels, summary, kind, closes, note_id, live_at, left_out, sample " +
      "FROM release_note_pr ORDER BY merged_at DESC LIMIT 3000",
    tables: ["release_note_pr"],
  },
  asks: { sql: "SELECT * FROM ask ORDER BY asked_at LIMIT 5000", tables: ["ask"] },
  replies: { sql: "SELECT * FROM release_note_reply LIMIT 3000", tables: ["release_note_reply"] },
  drafts: {
    sql: "SELECT id, conversation_id, source_account, to_handles, subject, body, state, rationale, built_from, sent_at, updated_at " +
      "FROM draft WHERE built_from IS NOT NULL ORDER BY updated_at DESC LIMIT 1000",
    tables: ["draft"],
  },
  brand: { sql: "SELECT name, voice FROM brand WHERE state IN ('check', 'ready') ORDER BY is_default DESC LIMIT 1", tables: ["brand"] },
};

export function json<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

const SECTION: Record<string, number> = { lead: 0, need: 1, improved: 2, fixed: 3 };

interface Who {
  me: { id: string; name: string; email: string | null } | null;
  members: Member[];
}

const WhoContext = createContext<Who>({ me: null, members: [] });

/** Who is signed in, and everyone else in the Lemma: read once. */
export function WhoProvider({ children }: { children: ReactNode }) {
  const [who, setWho] = useState<Who>({ me: null, members: [] });
  useEffect(() => {
    void (async () => {
      const [me, members] = await Promise.all([
        whoAmI(),
        client.podMembers.list(client.podId || "", { limit: 200 })
          .then((r) => items<{ user_id: string; user_name?: string | null; user_email?: string; email?: string }>(r))
          .catch(() => []),
      ]);
      const list: Member[] = members.map((m) => ({
        user_id: m.user_id, email: m.user_email || m.email || "",
        name: m.user_name || (m.user_email || m.email || "").split("@")[0] || "Someone",
      }));
      const self = me ? { id: me.id, email: me.email, name: list.find((m) => m.user_id === me.id)?.name || me.name || (me.email || "").split("@")[0] || "You" } : null;
      setWho({ me: self, members: list });
    })();
  }, []);
  return <WhoContext.Provider value={who}>{children}</WhoContext.Provider>;
}

export function useWho(): Who {
  return useContext(WhoContext);
}

/** Everything the screens read, shaped and indexed. */
export function useRN() {
  const { loaded, errors, reload } = useData();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const noteRows = useRows<Record<string, unknown>>("notes");
  const lineRows = useRows<Record<string, unknown>>("lines");
  const prRows = useRows<Record<string, unknown>>("prs");
  const askRows = useRows<Ask>("asks");
  const replyRows = useRows<Reply>("replies");
  const draftRows = useRows<Record<string, unknown>>("drafts");
  const brandRows = useRows<{ name: string; voice: string | null }>("brand");
  return useMemo(() => {
    const s = settingsRows[0];
    const settings: Settings | null = s ? {
      ...(s as unknown as Settings),
      repos: json(s.repos, []), publishers: json(s.publishers, []), schedules: json(s.schedules, {}),
    } : null;
    const notes: Note[] = noteRows.map((n) => ({ ...(n as unknown as Note), sent: json(n.sent, []) }));
    const lines: Line[] = lineRows.map((l) => ({ ...(l as unknown as Line), prs: json<number[]>(l.prs, []).map(Number), issues: json<string[]>(l.issues, []), asked: Number(l.asked || 0), position: Number(l.position || 0) }))
      .sort((a, b) => (SECTION[a.section] ?? 9) - (SECTION[b.section] ?? 9) || a.position - b.position);
    const prs: Pr[] = prRows.map((p) => ({ ...(p as unknown as Pr), number: Number(p.number), labels: json(p.labels, []), closes: json(p.closes, []) }));
    const drafts: Draft[] = draftRows.map((d) => ({ ...(d as unknown as Draft), built_from: json<Draft["built_from"]>(d.built_from, {}), to_handles: json<string[]>(d.to_handles, []) }))
      .filter((d) => d.built_from?.plugin === "release-notes");
    const open = notes.find((n) => n.state !== "published") || null;
    const published = notes.filter((n) => n.state === "published")
      .sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
    return {
      loaded, errors, reload, settings, notes, open, published, lines, prs, asks: askRows, replies: replyRows, drafts,
      brand: brandRows[0] || null, sample: !!settings?.sample,
    };
  }, [loaded, errors, reload, settingsRows, noteRows, lineRows, prRows, askRows, replyRows, draftRows, brandRows]);
}

export type RN = ReturnType<typeof useRN>;

/** Refs a line answers: its issues, and its pull requests as "owner/repo#n". */
export function refsOf(line: Line, repo: string): string[] {
  return [...line.issues, ...line.prs.map((n) => `${repo}#${n}`)];
}

export function asksFor(line: Line, repo: string, asks: Ask[]): Ask[] {
  const refs = new Set(refsOf(line, repo));
  const seen = new Set<string>();
  return asks.filter((a) => {
    if (!refs.has(a.work_id) || a.state === "dropped" || a.state === "declined") return false;
    const key = `${a.handle_kind}:${a.handle}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function issueNumber(ref: string): string {
  const n = ref.split("#")[1];
  return n ? `#${n}` : ref;
}

/* ---------- writes ---------- */

type Out = { message?: string } & Record<string, unknown>;

export async function call(name: string, input: Record<string, unknown>): Promise<Out> {
  return ((await runFunction<Out>(name, input)) as Out) || {};
}

export async function redraft(noteId: string): Promise<void> {
  await client.request("POST", `/pods/${client.podId}/workflows/release-notes-redraft/runs`, {
    body: { about: { table: "release_note", record_id: noteId } },
  });
}

export async function startTell(askId: string): Promise<void> {
  await client.request("POST", `/pods/${client.podId}/workflows/release-notes-tell/runs`, {
    body: { about: { table: "ask", record_id: askId } },
  });
}

export async function saveLine(line: Line, patch: { title?: string | null; text?: string; hidden?: boolean }, me: Who["me"]) {
  await update("release_note_line", line.id, { ...patch, edited_by: me?.id || null, edited_at: new Date().toISOString() });
}

export async function leaveOut(pr: Pr, out: boolean, me: Who["me"]) {
  await update("release_note_pr", pr.id, out
    ? { left_out: `Left out by ${me?.name || "a person"}` }
    : { left_out: null, kind: pr.kind === "routine" || pr.kind === "internal" ? "improvement" : pr.kind });
}

/** "Same thing they asked for?" Yes ships it (the work is out), which drafts the reply. */
export async function confirmAsk(a: Ask, yes: boolean, shippedIn: string | null) {
  await update("ask", a.id, yes
    ? { state: shippedIn ? "shipped" : "open", shipped_in: shippedIn, shipped_at: shippedIn ? new Date().toISOString() : null }
    : { state: "dropped" });
}

/** Send a reply you heard: a Mail draft goes through Mail; a sample one is only marked sent. */
export async function sendMailDraft(d: Draft, body: string): Promise<string> {
  if (d.source_account === "sample") {
    const out = await call("release_notes_send_reply", { draft_id: d.id, body });
    return out.message || "Sample: marked sent.";
  }
  await update("draft", d.id, { body, state: "approved", send_at: null });
  const out = await call("mail_send_draft", { draft_id: d.id });
  if (out.sent === false) throw new Error(String(out.message || "Mail didn't send it."));
  return String(out.message || "Sent.");
}

export async function sendReply(r: Reply, body: string): Promise<string> {
  const out = await call("release_notes_send_reply", { reply_id: r.id, body });
  if (out.sent === false) throw new Error(String(out.message || "Not sent."));
  return String(out.message || "Sent.");
}

export async function messagesOf(conversationId: string) {
  return q<{ id: string; direction: string; from_name: string | null; from_handle: string | null; sent_at: string; snippet: string | null }>(
    `SELECT id, direction, from_name, from_handle, sent_at, snippet FROM message WHERE conversation_id = ${sql(conversationId)} ORDER BY sent_at LIMIT 20`);
}

export async function conversationOf(id: string) {
  const rows = await q<{ id: string; subject: string | null; source_account: string | null; counterpart_handle: string | null }>(
    `SELECT id, subject, source_account, counterpart_handle FROM conversation WHERE id = ${sql(id)}`);
  return rows[0] || null;
}

/* ---------- each person's own triggers ---------- */

/** A schedule runs as whoever made it, so each person's app makes their own:
 *  the reply drafted when someone they heard has their work ship, told when
 *  it is sent, and "notes are ready" in a publisher's Today. Each sees only
 *  rows its owner can read (rows: OWNER_READABLE). */
export async function ensureMine(me: NonNullable<Who["me"]>): Promise<string | null> {
  const tag = me.id.replace(/-/g, "").slice(0, 8);
  const wanted = [
    { name: `release-notes-ask-${tag}`, workflow_name: "release-notes-tell",
      config: { table_name: "ask", operations: ["UPDATE"], rows: "OWNER_READABLE", bulk_writes: "each",
        when: { heard_by: { equals: me.id }, state: { equals: "shipped", changed: true } } } },
    { name: `release-notes-sent-${tag}`, workflow_name: "release-notes-on-sent",
      config: { table_name: "draft", operations: ["UPDATE"], rows: "OWNER_READABLE", bulk_writes: "each",
        when: { state: { in: ["sent", "discarded"], changed: true } } } },
    { name: `release-notes-note-${tag}`, workflow_name: "release-notes-on-note",
      config: { table_name: "release_note", operations: ["UPDATE"], rows: "OWNER_READABLE", bulk_writes: "each",
        when: { state: { changed: true } } } },
  ];
  const problems: string[] = [];
  for (const w of wanted) {
    try {
      const found = items<{ id: string; name: string }>(await client.schedules.list({ name: w.name, limit: 5 } as never)).find((x) => x.name === w.name);
      if (!found) await client.schedules.create({ name: w.name, schedule_type: "DATASTORE", workflow_name: w.workflow_name, config: w.config } as never);
    } catch (e) {
      problems.push(`${w.workflow_name} (${e instanceof Error ? e.message : e})`);
    }
  }
  return problems.length ? `Couldn't make your own triggers: ${problems.join("; ")}` : null;
}

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return zone === "Asia/Calcutta" ? "Asia/Kolkata" : zone;
}

/** The Lemma-wide schedules set-up makes, as the person setting up. A GitHub
 *  schedule names the shared GitHub connection; the platform writes its
 *  installation id from that connection's account. */
export async function ensureTeamSchedules(settings: Settings, me: NonNullable<Who["me"]>): Promise<{ ok: boolean; said: string[] }> {
  const repos = settings.repos || [];
  const want: { name: string; title: string; request: Record<string, unknown> }[] = [
    { name: "release-notes-merges", title: "Pull requests as they merge",
      request: { schedule_type: "WEBHOOK", workflow_name: "release-notes-on-merge", pod_connector: "github",
        config: { source: "github", event: "pull_request", actions: ["closed"] } } },
  ];
  if (repos.some((r) => (r.live_via || "workflow") === "workflow"))
    want.push({ name: "release-notes-deploys", title: "Deploy workflow runs",
      request: { schedule_type: "WEBHOOK", workflow_name: "release-notes-on-deploy", pod_connector: "github",
        config: { source: "github", event: "workflow_run", actions: ["completed"] } } });
  if (repos.some((r) => r.live_via === "tag"))
    want.push({ name: "release-notes-tags", title: "Tags pushed",
      request: { schedule_type: "WEBHOOK", workflow_name: "release-notes-on-tag", pod_connector: "github",
        config: { source: "github", event: "push" } } });
  want.push({ name: "release-notes-nightly", title: "Nightly catch-up",
    request: { schedule_type: "TIME", workflow_name: "release-notes-nightly", config: { cron: "40 3 * * *", timezone: browserZone() } } });
  const made: Record<string, string> = { ...(settings.schedules || {}) };
  const said: string[] = [];
  let ok = true;
  for (const w of want) {
    try {
      const found = items<{ id: string; name: string; is_active?: boolean }>(await client.schedules.list({ name: w.name, limit: 5 } as never)).find((x) => x.name === w.name);
      if (found) {
        made[w.name] = found.id;
        said.push(`${w.title}: already on.`);
        continue;
      }
      const row = (await client.schedules.create({ name: w.name, ...w.request } as never)) as unknown as { id: string };
      made[w.name] = row.id;
      said.push(`${w.title}: on.`);
    } catch (e) {
      ok = false;
      said.push(`${w.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await update("release_note_settings", settings.id, { schedules: made, schedule_user_id: me.id }).catch(() => undefined);
  return { ok, said };
}
