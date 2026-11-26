// The app's working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). Every Know-how table is the team's (no row-level security),
// except knowhow_my_question, which only ever shows the person their own.
//
// Writes go through Know-how's functions (knowhow_decide, knowhow_draft, ...),
// so Activity, the questions and Today stay in step however a change is made.
// What only a person can do (Public, contact functions, a restricted folder,
// schedules, telling people) is in wire.ts.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO, client, items, runFunction, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";

export type Audience = "team" | "restricted" | "customers" | "public";
export type ArticleState = "draft" | "live" | "due" | "may_disagree" | "retired";
export type Outcome = "answered" | "late" | "partly" | "missed" | "passed_on" | "wrong";
export type Where = "teams" | "slack" | "email" | "web" | "app";

export interface Step { n: number; anchor: string; title: string; who: string | null; body: string; reached: number; asked: number }

export interface Topic {
  id: string; name: string; slug: string; folder_path: string; owner_member_id: string | null; owner_name: string | null;
  backup_member_id: string | null; backup_name: string | null; check_days: number; audience_default: Audience;
  restricted_role: string | null; sensitive: boolean; position: number; sample: boolean;
}

export interface Article {
  id: string; kind: "answer" | "procedure" | "policy" | "sheet"; title: string; asks: string[]; path: string; topic_id: string | null;
  owner_member_id: string | null; owner_name: string | null; audience: Audience; state: ArticleState; checked_at: string | null;
  checked_by_name: string | null; due_on: string | null; steps: Step[]; source: string; source_path: string | null; quote: string | null;
  quote_who: string | null; quote_where: string | null; uses_30d: number; misses_30d: number; walks_30d: number; finished_30d: number;
  last_used_at: string | null; approved_at: string | null; approved_by_name: string | null; published_at: string | null;
  article_id: string | null; missing: string[]; created_at: string; updated_at: string; sample: boolean;
}

export interface Question {
  id: string; text: string; asked_by_kind: "member" | "contact" | "unknown"; asked_by_member: string | null; asked_by_name: string | null;
  where_source: Where; where_place: string | null; topic_id: string | null; article_id: string | null; outcome: Outcome;
  owner_member_id: string | null; state: "new" | "asked" | "drafted" | "saved" | "covered" | "set_aside"; same_as: string | null;
  times: number; found: { path: string; page: number | null; text: string }[]; next_note: string | null; draft_article_id: string | null;
  sensitive: boolean; walk_id: string | null; walk_step: number | null; asked_at: string; answered_at: string | null; told_at: string | null;
}

export interface Change {
  id: string; article_id: string; kind: "add_to_step" | "new_step" | "edit" | "may_disagree"; step: number | null; text: string;
  evidence: { quote?: string; who?: string; where?: string; when?: string; page_text?: string; source_text?: string; changed_at?: string; why?: string };
  question_ids: string[]; source_path: string | null; state: "proposed" | "added" | "declined";
}

export interface Source {
  id: string; kind: "upload" | "drive_folder" | "website" | "teams_file"; name: string | null; path: string | null; url: string | null;
  last_read_at: string | null; files_seen: number; drafted: number; unreadable: { name: string; path?: string; why: string; sheet_page?: string }[]; note: string | null;
}

export interface Walk {
  id: string; article_id: string; who_member: string | null; who_name: string | null; where_source: Where; step: number; steps_total: number;
  state: "walking" | "stuck" | "stopped" | "done"; started_at: string; done_at: string | null; assignment_id: string | null;
}

export interface Assignment {
  id: string; article_id: string; member_id: string | null; member_name: string | null; role: string | null; assigned_by_name: string | null;
  assigned_at: string; due_on: string | null; walk_id: string | null; state: "assigned" | "walking" | "done";
}

export interface KEvent { id: string; subject_kind: string; subject_id: string; kind: string; actor: string | null; actor_name: string | null; text: string; at: string }

export interface Settings {
  id: string; places: { teams?: boolean; slack_channels?: { id: string; name: string }[]; mailbox?: boolean; web_chat?: boolean };
  audiences: { customers?: boolean; public?: boolean }; approver_rule: string | null; default_check_days: number; customer_lead_days: number;
  schedules: Record<string, string>; made: Record<string, unknown>; proposals: { topics?: ProposedTopic[]; drafts?: { article_id: string; topic: string; title: string }[] };
  setup_run_id: string | null; setup_done_at: string | null; sweep_member_id: string | null; quiet: boolean; sample: boolean;
  checked_at: string | null; check_note: string | null; timezone: string | null;
}

export interface ProposedTopic { name: string; why?: string; owner_hint?: string | null; sensitive?: boolean; audience?: Audience }
export interface Person { id: string; member_id: string; name: string | null; ask_by: "teams" | "today"; check_rhythm: "daily" | "weekly"; check_day: number; me_done_at: string | null; schedule_name: string | null }
export interface Member { user_id: string; name: string; email: string; roles: string[] }

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM knowhow_settings ORDER BY created_at LIMIT 1", tables: ["knowhow_settings"] },
  topics: { sql: "SELECT * FROM knowhow_topic ORDER BY position, name LIMIT 500", tables: ["knowhow_topic"] },
  articles: { sql: "SELECT id, kind, title, asks, path, topic_id, owner_member_id, owner_name, audience, state, checked_at, checked_by_name, due_on, steps, source, source_path, quote, quote_who, quote_where, uses_30d, misses_30d, walks_30d, finished_30d, last_used_at, approved_at, approved_by_name, published_at, article_id, missing, created_at, updated_at, sample FROM knowhow_article ORDER BY title LIMIT 3000", tables: ["knowhow_article"] },
  questions: { sql: "SELECT * FROM knowhow_question ORDER BY asked_at DESC LIMIT 5000", tables: ["knowhow_question"] },
  changes: { sql: "SELECT * FROM knowhow_change ORDER BY created_at DESC LIMIT 1000", tables: ["knowhow_change"] },
  sources: { sql: "SELECT * FROM knowhow_source ORDER BY created_at LIMIT 200", tables: ["knowhow_source"] },
  walks: { sql: "SELECT * FROM knowhow_walk ORDER BY started_at DESC LIMIT 3000", tables: ["knowhow_walk"] },
  assignments: { sql: "SELECT * FROM knowhow_assignment ORDER BY assigned_at DESC LIMIT 2000", tables: ["knowhow_assignment"] },
  events: { sql: "SELECT * FROM knowhow_event ORDER BY at DESC LIMIT 6000", tables: ["knowhow_event"] },
  people: { sql: "SELECT * FROM knowhow_person LIMIT 500", tables: ["knowhow_person"] },
  sample: { sql: "SELECT COUNT(*) AS n FROM knowhow_sample_row", tables: ["knowhow_sample_row"] },
};

export function json<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return (JSON.parse(value) as T) ?? fallback;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

const n = (v: unknown) => Number(v || 0);

function asSettings(r: Record<string, unknown> | undefined): Settings | null {
  if (!r) return null;
  return {
    ...(r as unknown as Settings),
    places: json(r.places, {}), audiences: json(r.audiences, {}), schedules: json(r.schedules, {}), made: json(r.made, {}),
    proposals: json(r.proposals, {}), default_check_days: n(r.default_check_days) || 90, customer_lead_days: n(r.customer_lead_days) || 14,
    quiet: Boolean(r.quiet), sample: Boolean(r.sample),
  };
}

const asArticle = (r: Record<string, unknown>): Article => ({
  ...(r as unknown as Article), asks: json(r.asks, []), steps: json(r.steps, []), missing: json(r.missing, []),
  uses_30d: n(r.uses_30d), misses_30d: n(r.misses_30d), walks_30d: n(r.walks_30d), finished_30d: n(r.finished_30d), sample: Boolean(r.sample),
  due_on: r.due_on ? String(r.due_on).slice(0, 10) : null,
});

const asQuestion = (r: Record<string, unknown>): Question => ({
  ...(r as unknown as Question), found: json(r.found, []), times: n(r.times) || 1, sensitive: Boolean(r.sensitive),
  walk_step: r.walk_step == null ? null : Number(r.walk_step),
});

interface Who { me: { id: string; name: string; email: string | null } | null; members: Member[]; roles: { id: string; name: string }[] }
const WhoContext = createContext<Who>({ me: null, members: [], roles: [] });

/** Who is signed in, who else is in the Lemma, and its roles: read once. */
export function WhoProvider({ children }: { children: ReactNode }) {
  const [who, setWho] = useState<Who>({ me: null, members: [], roles: [] });
  useEffect(() => {
    void (async () => {
      const [me, members, roles] = await Promise.all([
        whoAmI(),
        client.podMembers.list(client.podId || "", { limit: 200 })
          .then((r) => items<{ user_id: string; user_name?: string | null; user_email?: string; email?: string; roles?: unknown[]; role?: string }>(r))
          .catch(() => []),
        DEMO ? Promise.resolve([{ id: "hr", name: "HR" }, { id: "cs", name: "Customer service" }, { id: "wh", name: "Warehouse" }])
          : client.podRoles.list(client.podId || "").then((r) => items<{ id: string; name: string }>(r)).catch(() => []),
      ]);
      const list: Member[] = members.map((m) => ({
        user_id: m.user_id, email: m.user_email || m.email || "",
        name: m.user_name || (m.user_email || m.email || "").split("@")[0] || "Someone",
        roles: (m.roles || (m.role ? [m.role] : [])).map((x) => (typeof x === "string" ? x : String((x as { name?: string }).name || ""))).filter(Boolean),
      }));
      const self = me ? { id: me.id, email: me.email, name: list.find((m) => m.user_id === me.id)?.name || me.name || (me.email || "").split("@")[0] || "You" } : null;
      setWho({ me: self, members: list, roles });
    })();
  }, []);
  return <WhoContext.Provider value={who}>{children}</WhoContext.Provider>;
}

export function useWho(): Who {
  return useContext(WhoContext);
}

/** Now, as the screens count from it. The demo is a fixed Wednesday: now is
 *  its newest question, a few minutes on, whenever it is opened. */
export function nowMs(questions: Question[]): number {
  if (!DEMO) return Date.now();
  const newest = questions.reduce((m, q) => Math.max(m, Date.parse(q.asked_at || "") || 0), 0);
  return newest ? newest + 9 * 60_000 : Date.now();
}

export function todayIso(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function isLate(a: Article, now: number): boolean {
  if (a.state === "due") return true;
  return a.kind !== "sheet" && !!a.due_on && a.due_on <= todayIso(now);
}

/** Everything the screens read, indexed. */
export function useKnowhow() {
  const { loaded, errors, reload } = useData();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const topicRows = useRows<Record<string, unknown>>("topics");
  const articleRows = useRows<Record<string, unknown>>("articles");
  const questionRows = useRows<Record<string, unknown>>("questions");
  const changeRows = useRows<Record<string, unknown>>("changes");
  const sourceRows = useRows<Record<string, unknown>>("sources");
  const walkRows = useRows<Walk>("walks");
  const assignRows = useRows<Assignment>("assignments");
  const eventRows = useRows<KEvent>("events");
  const peopleRows = useRows<Record<string, unknown>>("people");
  const sampleRows = useRows<{ n: number | string }>("sample");
  return useMemo(() => {
    const settings = asSettings(settingsRows[0]);
    const topics = topicRows.map((t) => ({ ...(t as unknown as Topic), sensitive: Boolean(t.sensitive), check_days: n(t.check_days) || 90 }));
    const topicBy = new Map(topics.map((t) => [t.id, t]));
    const articles = articleRows.map(asArticle);
    const articleBy = new Map(articles.map((a) => [a.id, a]));
    const questions = questionRows.map(asQuestion);
    const questionBy = new Map(questions.map((q) => [q.id, q]));
    const repeats = new Map<string, Question[]>();
    for (const q of questions) if (q.same_as) repeats.set(q.same_as, [...(repeats.get(q.same_as) || []), q]);
    const changes = changeRows.map((c) => ({ ...(c as unknown as Change), evidence: json<Change["evidence"]>(c.evidence, {}), question_ids: json<string[]>(c.question_ids, []) }));
    const sources = sourceRows.map((s) => ({ ...(s as unknown as Source), unreadable: json<Source["unreadable"]>(s.unreadable, []), files_seen: n(s.files_seen), drafted: n(s.drafted) }));
    const eventsBy = new Map<string, KEvent[]>();
    for (const e of [...eventRows].sort((a, b) => String(a.at).localeCompare(String(b.at)))) eventsBy.set(e.subject_id, [...(eventsBy.get(e.subject_id) || []), e]);
    const people = peopleRows.map((p) => ({ ...(p as unknown as Person), check_day: n(p.check_day) }));
    const walks = walkRows.map((w) => ({ ...w, step: n(w.step), steps_total: n(w.steps_total) }));
    return {
      loaded, errors, reload, settings, topics, topicBy, articles, articleBy, questions, questionBy, repeats, changes, sources,
      walks, assignments: assignRows, eventsBy, people, sample: n(sampleRows[0]?.n) > 0,
    };
  }, [loaded, errors, reload, settingsRows, topicRows, articleRows, questionRows, changeRows, sourceRows, walkRows, assignRows, eventRows, peopleRows, sampleRows]);
}

export type Data = ReturnType<typeof useKnowhow>;

/* ---------- writes ---------- */

export type Out = { message?: string; ok?: boolean } & Record<string, unknown>;

export async function call<T extends Out = Out>(name: string, input: Record<string, unknown>): Promise<T> {
  const out = (await runFunction<T>(name, input)) as T;
  return out || ({} as T);
}

export const decide = (action: string, input: Record<string, unknown>) => call<Out & {
  tell_members?: { question_id: string; member_id: string; name: string | null; text: string; where: string }[];
  tell_contacts?: { question_id: string; contact_id: string; name: string | null; text: string; where: string }[];
  tell_hidden?: number; owner_member_id?: string | null; owner_name?: string | null;
}>("knowhow_decide", { action, ...input });

let mineTimer = 0;
/** Re-write this person's items in Today, a moment after a change or on open. */
export function refreshMine(): void {
  if (DEMO) return;
  window.clearTimeout(mineTimer);
  mineTimer = window.setTimeout(() => void runFunction("knowhow_mine", {}).catch(() => undefined), 1500);
}

/* ---------- words ---------- */

export const WHERE: Record<string, string> = { teams: "Teams", slack: "Slack", email: "Email", web: "Web chat", app: "App" };
export const AUDIENCE: Record<string, string> = { team: "The team", restricted: "Restricted", customers: "Customers", public: "Public" };
export const KIND: Record<string, string> = { answer: "Answer", procedure: "Procedure", policy: "Policy", sheet: "Sheet" };

export function fmtDay(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function sourceLine(a: Article): string {
  if (a.kind === "sheet") return `From the sheet ${a.title}, made from ${(a.source_path || "").split("/").pop()} on ${fmtDay(a.checked_at)}.`;
  const who = a.checked_by_name || a.owner_name;
  return who && a.checked_at ? `From ${a.title}, checked by ${who} on ${fmtDay(a.checked_at)}.` : `From ${a.title}.`;
}

export function firstOf(name: string | null | undefined): string {
  return (name || "").split(" ")[0] || "the owner";
}
