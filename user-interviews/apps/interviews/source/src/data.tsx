// The app's working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). Studies, people, findings and `feedback` are the team's;
// proposals, drafts and this member's own set-up are theirs alone (row-level
// security), so each person sees their own invites and their own calls'
// proposals.
//
// Writes that reach outside the Lemma, or touch shared rows with rules
// (sending, keeping a finding, the contact rules), go through functions; a
// study's own fields and a pasted list are written here.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO, client, errorText, items, q, runFunction, sql, update, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import type { Draft, Feature, Feedback, Finding, Member, Person, Proposal, Settings, Study } from "./types";

export const PLUGIN = "user-interviews";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM interviews_settings ORDER BY created_at LIMIT 1", tables: ["interviews_settings"] },
  studies: { sql: "SELECT * FROM interviews_study ORDER BY created_at DESC LIMIT 300", tables: ["interviews_study"] },
  people: { sql: "SELECT * FROM interviews_person ORDER BY rank DESC LIMIT 5000", tables: ["interviews_person"] },
  findings: { sql: "SELECT * FROM interviews_finding LIMIT 5000", tables: ["interviews_finding"] },
  feedback: {
    sql: "SELECT id, quote, point, feature_id, importance, kind, source, at_seconds, said_at, state, handle, name, company_name " +
      "FROM feedback WHERE plugin = 'user-interviews' AND state = 'processed' LIMIT 5000",
    tables: ["feedback"],
  },
  features: { sql: "SELECT id, name, state, stage, product_id, description, merged_into FROM feature WHERE state <> 'archived' ORDER BY name LIMIT 2000", tables: ["feature"] },
  proposals: { sql: "SELECT * FROM interviews_proposal ORDER BY n LIMIT 3000", tables: ["interviews_proposal"] },
  drafts: {
    sql: "SELECT id, to_handles, subject, body, state, built_from, error, sent_at, source_account, rationale FROM draft " +
      "WHERE built_from IS NOT NULL ORDER BY updated_at DESC LIMIT 500",
    tables: ["draft"],
  },
  member: { sql: "SELECT * FROM interviews_member LIMIT 1", tables: ["interviews_member"] },
  pasted: { sql: "SELECT id, study_id, handle FROM interviews_pasted LIMIT 5000", tables: ["interviews_pasted"] },
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

/* ---------- who ---------- */

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

/** "you", or a colleague's first name. */
export function whoName(userId: string | null | undefined, who: Who): string {
  if (!userId) return "someone";
  if (who.me?.id === userId) return "you";
  return (who.members.find((m) => m.user_id === userId)?.name || "someone").split(" ")[0];
}

/* ---------- the working set ---------- */

export function useUI() {
  const { loaded, errors, reload } = useData();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const studyRows = useRows<Record<string, unknown>>("studies");
  const peopleRows = useRows<Record<string, unknown>>("people");
  const findingRows = useRows<Finding>("findings");
  const feedbackRows = useRows<Feedback>("feedback");
  const featureRows = useRows<Feature>("features");
  const proposalRows = useRows<Proposal>("proposals");
  const draftRows = useRows<Record<string, unknown>>("drafts");
  const memberRows = useRows<Record<string, unknown>>("member");
  const pastedRows = useRows<{ id: string; study_id: string | null; handle: string }>("pasted");
  return useMemo(() => {
    const s = settingsRows[0];
    const settings: Settings | null = s ? {
      ...(s as unknown as Settings),
      invite_gap_days: Number(s.invite_gap_days || 30), no_show_days: Number(s.no_show_days || 90), nudge_days: Number(s.nudge_days || 4),
      sample: !!s.sample,
    } : null;
    const studies: Study[] = studyRows.map((r) => ({
      ...(r as unknown as Study), feature_ids: json(r.feature_ids, []), fit_read: json(r.fit_read, null),
      pool_counts: json(r.pool_counts, null), want: Number(r.want || 0), sample: !!r.sample,
    }));
    const people: Person[] = peopleRows.map((r) => ({
      ...(r as unknown as Person), sources: json(r.sources, {}), why: json(r.why, []), rank: Number(r.rank || 0),
      found: Number(r.found || 0), kept: Number(r.kept || 0), set_aside: Number(r.set_aside || 0), sample: !!r.sample,
    }));
    const drafts: Draft[] = draftRows.map((d) => ({ ...(d as unknown as Draft), built_from: json<Draft["built_from"]>(d.built_from, {}), to_handles: json<string[]>(d.to_handles, []) }))
      .filter((d) => d.built_from?.plugin === PLUGIN);
    const features = new Map(featureRows.map((f) => [f.id, f]));
    const member = memberRows[0] ? { ...memberRows[0], trigger: json(memberRows[0].trigger, {}) } as { id: string; trigger: Record<string, string>; schedule: string | null; ready_at: string | null } : null;
    return {
      loaded, errors, reload, settings, studies, people, findings: findingRows, feedback: feedbackRows, featureRows,
      features, proposals: proposalRows, drafts, member, pasted: pastedRows, sample: !!settings?.sample,
    };
  }, [loaded, errors, reload, settingsRows, studyRows, peopleRows, findingRows, feedbackRows, featureRows, proposalRows, draftRows, memberRows, pastedRows]);
}

export type UI = ReturnType<typeof useUI>;

/* ---------- writes ---------- */

type Out = { message?: string } & Record<string, unknown>;

export async function call(name: string, input: Record<string, unknown>): Promise<Out> {
  return ((await runFunction<Out>(name, input)) as Out) || {};
}

async function runAbout(workflow: string, table: string, id: string): Promise<void> {
  await client.request("POST", `/pods/${client.podId}/workflows/${workflow}/runs`, {
    body: { about: { table, record_id: id } },
  });
}

/** Read who fits from the study's sentence, then build its list (as this person: their own people count). */
export async function readFit(study: Study): Promise<void> {
  if (DEMO) {
    await call("interviews_fit", { mode: "save", study_id: study.id });
    return;
  }
  await update("interviews_study", study.id, { fit_state: study.fit_sentence ? "reading" : "none", fit_error: null });
  await runAbout("interviews-fit", "interviews_study", study.id);
}

/** Write one invite, as this person (their mailbox, their voice). */
export async function draftInvite(person: Person, meId: string | undefined): Promise<void> {
  await update("interviews_person", person.id, { invite_state: "writing", invite_error: null, inviter_user_id: meId || null });
  if (DEMO) {
    await call("interviews_invite", { mode: "save", person_id: person.id });
    return;
  }
  await runAbout("interviews-invite", "interviews_person", person.id);
}

export async function readCall(person: Person): Promise<void> {
  await update("interviews_person", person.id, { read_state: "waiting", read_error: null });
  if (DEMO) return;
  await runAbout("interviews-read", "interviews_person", person.id);
}

export async function sendInvite(person: Person, subject: string, body: string): Promise<{ sent: boolean; message: string }> {
  const out = await call("interviews_send", { person_id: person.id, subject, body });
  return { sent: !!out.sent, message: String(out.message || (out.sent ? "Sent." : "Not sent.")) };
}

export async function keep(p: Proposal, keepIt: boolean, edits: Partial<Pick<Proposal, "point" | "feature_id" | "feature_new" | "kind" | "importance">> = {}): Promise<string> {
  const out = await call("interviews_keep", { proposal_id: p.id, keep: keepIt, ...edits });
  return String(out.message || (keepIt ? "Kept." : "Set aside."));
}

export async function undoKeep(p: Proposal): Promise<string> {
  const out = await call("interviews_keep", { proposal_id: p.id, undo: true });
  return String(out.message || "Back to review.");
}

export async function mark(person: Person, what: string): Promise<string> {
  const out = await call("interviews_mark", { person_id: person.id, what });
  return String(out.message || "Done.");
}

/** A call's notes: Meetings' own when the call is a meeting of yours (it reads them too), else kept here. */
export async function addNotes(person: Person, text: string, kind: "notes" | "transcript"): Promise<string> {
  if (kind === "notes" && person.meeting_id && !DEMO) {
    await runFunction("meetings_add_notes", { meeting_id: person.meeting_id, text });
    return "Notes kept in Meetings; reading them for findings.";
  }
  const out = await call("interviews_paste", { person_id: person.id, text, kind });
  return String(out.message || "Kept; reading it for findings.");
}

export async function rebuild(study: Study): Promise<string> {
  const out = await call("interviews_pool", { study_id: study.id });
  return String(out.message || "Built the list again.");
}

/** A suggested feature, accepted onto the team's list. */
export async function acceptFeature(f: Feature): Promise<void> {
  await update("feature", f.id, { state: "active" });
}

/** A suggested feature folded into another: its feedback repointed, its name kept as another word for it. */
export async function mergeFeature(from: Feature, into: Feature): Promise<number> {
  const rows = await q<{ id: string }>(`SELECT id FROM feedback WHERE feature_id = ${sql(from.id)} LIMIT 1000`);
  for (const r of rows) await update("feedback", r.id, { feature_id: into.id, filed_by: "person" });
  const props = await q<{ id: string }>(`SELECT id FROM interviews_proposal WHERE feature_id = ${sql(from.id)} LIMIT 1000`);
  for (const r of props) await update("interviews_proposal", r.id, { feature_id: into.id });
  const target = (await q<{ aliases: unknown }>(`SELECT aliases FROM feature WHERE id = ${sql(into.id)}`))[0];
  const aliases = json<string[]>(target?.aliases, []);
  if (!aliases.map((a) => a.toLowerCase()).includes(from.name.toLowerCase())) await update("feature", into.id, { aliases: [...aliases, from.name] });
  await update("feature", from.id, { state: "merged", merged_into: into.id });
  return rows.length;
}

/* ---------- a pasted list ---------- */

export interface PastedRow { handle: string; name: string | null; company_name: string | null; title: string | null; fields: Record<string, string> }

/** CSV with a header (email, name, company, title, anything else), or one person a line. */
export function parseList(text: string): PastedRow[] {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
      } else if ((ch === "," || ch === "\t" || ch === ";") && !quoted) { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const email = /[^\s<>,;"]+@[^\s<>,;"]+\.[a-z]{2,}/i;
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = !email.test(lines[0]) && head.some((h) => /mail/.test(h));
  const rows: PastedRow[] = [];
  if (hasHeader) {
    const at = (re: RegExp) => head.findIndex((h) => re.test(h));
    const ie = at(/mail/), inm = at(/^name|full.?name|person/), ic = at(/company|org|account/), it = at(/title|role|job/);
    for (const line of lines.slice(1)) {
      const cells = split(line);
      const handle = (cells[ie] || "").toLowerCase().match(email)?.[0];
      if (!handle) continue;
      const fields: Record<string, string> = {};
      head.forEach((h, i) => { if (![ie, inm, ic, it].includes(i) && cells[i]) fields[h] = cells[i]; });
      rows.push({ handle, name: cells[inm] || null, company_name: cells[ic] || null, title: cells[it] || null, fields });
    }
  } else {
    for (const line of lines) {
      const handle = line.toLowerCase().match(email)?.[0];
      if (!handle) continue;
      const rest = split(line.replace(/<[^>]*>/, "")).filter((c) => c && !email.test(c));
      rows.push({ handle, name: rest[0] || null, company_name: rest[1] || null, title: rest[2] || null, fields: {} });
    }
  }
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.handle) ? false : (seen.add(r.handle), true)));
}

const NS = "119b800c-47d6-43fe-9576-6e281b149300";

/** uuid5, as the functions make ids (so a pasted person pasted twice is one row). */
export async function uuid5(name: string, ns = NS): Promise<string> {
  const hex = ns.replace(/-/g, "");
  const bytes = new Uint8Array([...hex.match(/../g)!.map((h) => parseInt(h, 16)), ...new TextEncoder().encode(name)]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const h = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function savePasted(studyId: string, rows: PastedRow[], meId: string | undefined): Promise<number> {
  const list = await Promise.all(rows.slice(0, 500).map(async (r) => ({
    id: await uuid5(`pasted:${studyId}:${r.handle}`), study_id: studyId, handle: r.handle, name: r.name,
    company_name: r.company_name, title: r.title, fields: r.fields, pasted_by: meId || null,
  })));
  for (let i = 0; i < list.length; i += 100) {
    await client.records.bulk.create("interviews_pasted", list.slice(i, i + 100), { upsert: true });
  }
  return list.length;
}

/* ---------- this member's own triggers and morning run ---------- */

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return zone === "Asia/Calcutta" ? "Asia/Kolkata" : zone;
}

/** A schedule runs as whoever made it, so each person's app makes their own:
 *  a new meeting of theirs (a booking), a meeting of theirs whose document
 *  changed (a call to read), and their morning run at 09:00. Each sees only
 *  their own meetings (rows: OWNER_READABLE). */
export async function ensureMine(me: NonNullable<Who["me"]>, member: UI["member"]): Promise<string | null> {
  const tag = me.id.replace(/-/g, "").slice(0, 8);
  const zone = browserZone();
  const wanted = [
    { key: "new", name: `interviews-meeting-new-${tag}`, schedule_type: "DATASTORE", workflow_name: "interviews-on-meeting",
      config: { table_name: "meeting", operations: ["INSERT"], rows: "OWNER_READABLE", bulk_writes: "each" } },
    { key: "doc", name: `interviews-meeting-doc-${tag}`, schedule_type: "DATASTORE", workflow_name: "interviews-on-meeting",
      config: { table_name: "meeting", operations: ["UPDATE"], rows: "OWNER_READABLE", bulk_writes: "each", when: { document_path: { changed: true } } } },
    { key: "daily", name: `interviews-daily-${tag}`, schedule_type: "TIME", workflow_name: "interviews-daily",
      config: { cron: "0 9 * * *", timezone: zone } },
  ];
  const made: Record<string, string> = {};
  const problems: string[] = [];
  for (const w of wanted) {
    try {
      const found = items<{ id: string; name: string }>(await client.schedules.list({ name: w.name, limit: 5 } as never)).find((x) => x.name === w.name);
      const id = found?.id || ((await client.schedules.create({ name: w.name, schedule_type: w.schedule_type, workflow_name: w.workflow_name, config: w.config } as never)) as unknown as { id: string }).id;
      made[w.key] = id;
    } catch (e) {
      problems.push(errorText(e));
    }
  }
  const row = { trigger: { new: made.new, doc: made.doc }, schedule: made.daily || null, timezone: zone,
    ready_at: problems.length ? null : new Date().toISOString() };
  try {
    if (member?.id) await update("interviews_member", member.id, row);
    else await client.records.create("interviews_member", { id: await uuid5(`member:${me.id}`), ...row } as never);
  } catch {
    /* the triggers stand; the row only says so */
  }
  return problems.length ? `Couldn't turn on your own checks: ${problems[0]}` : null;
}

/** Your part of the set-up, as interviews_setup reads it. */
export interface Where {
  settings: Partial<Settings>;
  products: { id: string; name: string }[];
  mail: { ok: boolean; email?: string | null; provider?: string | null; sample?: boolean };
  meetings: { ok: boolean; notes_from?: string | null; calendar?: boolean; sample?: boolean; display_name?: string | null };
  booking: { ok: boolean; page_url?: string | null; minutes?: number | null; on?: boolean };
  missing: { step: string; text: string }[];
  message: string;
}

export async function where(): Promise<Where> {
  return (await runFunction<Where>("interviews_setup", { mode: "check" })) as Where;
}

/** Meetings' "after" setting: where a call's words come from afterwards. */
export async function setNotesFrom(value: "meet" | "notes"): Promise<void> {
  const rows = await q<{ id: string }>("SELECT id FROM meetings_settings LIMIT 1");
  if (!rows[0]) throw new Error("Set up Meetings first.");
  await update("meetings_settings", rows[0].id, { notes_from: value });
}

/** People map's page for someone: theirs when they are one of your people, else the team's view of the address. */
export async function peoplePath(handle: string): Promise<string> {
  try {
    const rows = await q<{ person_id: string }>(`SELECT person_id FROM person_handle WHERE handle = ${sql(handle.toLowerCase())} LIMIT 1`);
    if (rows[0]?.person_id) return `/${rows[0].person_id}`;
  } catch {
    /* no People map rows of yours */
  }
  return `/team/${encodeURIComponent(handle.toLowerCase())}`;
}
