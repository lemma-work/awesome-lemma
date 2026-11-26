// The app's working set and its writes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). `form`, `form_answer` and Forms' own tables are the team's;
// `draft` and `mail_mailbox` are the person's own (Mail's, per person), so a
// draft shows only to the owner it was written for.
//
// Writes go through Forms' functions (forms_decide, forms_door_save,
// forms_setup_save, ...), so the timeline, corrections and each owner's
// Today stay in step however a change is made. What only a person can do
// (open a table, the widget, schedules, sending, hooks) is in wire.ts.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO, client, items, runFunction, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import type { Answer, Away, Draft, FEvent, Form, Mailbox, Member, Rule, Settings } from "./types";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM forms_settings ORDER BY created_at LIMIT 1", tables: ["forms_settings"] },
  forms: { sql: "SELECT * FROM form ORDER BY name LIMIT 500", tables: ["form"] },
  answers: { sql: "SELECT * FROM form_answer ORDER BY received_at DESC LIMIT 3000", tables: ["form_answer"] },
  events: { sql: "SELECT * FROM forms_event ORDER BY at LIMIT 10000", tables: ["forms_event"] },
  rules: { sql: "SELECT * FROM forms_rule ORDER BY position LIMIT 500", tables: ["forms_rule"] },
  away: { sql: "SELECT * FROM away ORDER BY day LIMIT 2000", tables: ["away"] },
  drafts: { sql: "SELECT * FROM draft WHERE source = 'mail' AND kind = 'new' ORDER BY updated_at DESC LIMIT 500", tables: ["draft"] },
  mailboxes: { sql: "SELECT id, provider, account_id, email, owner_name, state FROM mail_mailbox ORDER BY connected_at LIMIT 20", tables: ["mail_mailbox"] },
  sample: { sql: "SELECT COUNT(*) AS n FROM forms_sample_row", tables: ["forms_sample_row"] },
};

export function json<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return (JSON.parse(value) as T) ?? fallback;
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
    members: json(r.members, []),
    plugins: json(r.plugins, {}),
    schedules: json(r.schedules, {}),
    doors_wanted: json(r.doors_wanted, []),
    goal_minutes: Number(r.goal_minutes || 60),
    unsure_after_minutes: Number(r.unsure_after_minutes || 60),
    quiet: Boolean(r.quiet),
    sample: Boolean(r.sample),
  };
}

function asForm(r: Record<string, unknown>): Form {
  return {
    ...(r as unknown as Form),
    fields: json(r.fields, []),
    share: json(r.share, null),
    week: json(r.week, []),
    reply_mode: (r.reply_mode as Form["reply_mode"]) || "draft",
    owner_plugin: (r.owner_plugin as string) || "forms",
    state: (r.state as Form["state"]) || "off",
    sample: Boolean(r.sample),
  };
}

function asAnswer(r: Record<string, unknown>): Answer {
  return {
    ...(r as unknown as Answer),
    fields: json(r.fields, []),
    files: json(r.files, []),
    came_from: json(r.came_from, {}),
    rules_checked: json(r.rules_checked, []),
    hand_version: Number(r.hand_version || 0),
    kind_sure: num(r.kind_sure),
    sample: Boolean(r.sample),
  };
}

function asRule(r: Record<string, unknown>): Rule {
  return { ...(r as unknown as Rule), members: json(r.members, []), position: Number(r.position || 0), enabled: r.enabled !== false, next_turn: Number(r.next_turn || 0) };
}

function asDraft(r: Record<string, unknown>): Draft {
  return { ...(r as unknown as Draft), to_handles: json(r.to_handles, []) };
}

interface Who {
  me: { id: string; name: string; email: string | null } | null;
  members: Member[];
}

const WhoContext = createContext<Who>({ me: null, members: [] });

/** Who is signed in and who else is in the Lemma: read once. */
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

export const OPEN: Answer["state"][] = ["new", "unsure", "routed", "drafted"];
export const isOpen = (a: Answer) => OPEN.includes(a.state);
export type Segment = "waiting" | "unsure" | "done" | "aside" | "all";
export function segmentOf(a: Answer): Exclude<Segment, "all"> {
  if (a.state === "unsure") return "unsure";
  if (a.state === "set_aside") return "aside";
  if (a.state === "replied" || a.state === "filed") return "done";
  return "waiting";
}

const t = (s: string | null | undefined) => Date.parse(s || "") || 0;

/** Everything the screens read, indexed. */
export function useForms() {
  const { loaded, errors, reload } = useData();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const formRows = useRows<Record<string, unknown>>("forms");
  const answerRows = useRows<Record<string, unknown>>("answers");
  const eventRows = useRows<FEvent>("events");
  const ruleRows = useRows<Record<string, unknown>>("rules");
  const awayRows = useRows<Away>("away");
  const draftRows = useRows<Record<string, unknown>>("drafts");
  const mailboxRows = useRows<Mailbox>("mailboxes");
  const sampleRows = useRows<{ n: number | string }>("sample");
  return useMemo(() => {
    const settings = asSettings(settingsRows[0]);
    const forms = formRows.map(asForm);
    const formsById = new Map(forms.map((f) => [f.id, f]));
    const answers = answerRows.map(asAnswer).sort((a, b) => t(b.received_at) - t(a.received_at));
    const byId = new Map(answers.map((a) => [a.id, a]));
    const eventsBy = new Map<string, FEvent[]>();
    for (const e of [...eventRows].sort((a, b) => t(a.at) - t(b.at))) eventsBy.set(e.answer_id, [...(eventsBy.get(e.answer_id) || []), e]);
    const rules = ruleRows.map(asRule).filter((r) => r.enabled).sort((a, b) => a.position - b.position);
    const drafts = new Map(draftRows.map(asDraft).map((d) => [d.id, d]));
    const answersBy = new Map<string, Answer[]>();
    for (const a of answers) answersBy.set(a.form_id, [...(answersBy.get(a.form_id) || []), a]);
    return {
      loaded, errors, reload, settings, forms, formsById, answers, byId, eventsBy, rules, away: awayRows, drafts,
      mailboxes: mailboxRows, answersBy, sample: Number(sampleRows[0]?.n || 0) > 0 || Boolean(settings?.sample),
    };
  }, [loaded, errors, reload, settingsRows, formRows, answerRows, eventRows, ruleRows, awayRows, draftRows, mailboxRows, sampleRows]);
}

export type Data = ReturnType<typeof useForms>;

/** Now, as the screens count from it. In the "Try it" demo the sample is a
 *  moment (its newest answer, a few minutes on), so "3 min" stays 3 minutes
 *  whenever the demo is opened. */
export function nowMs(d: Pick<Data, "answers">): number {
  if (!DEMO) return Date.now();
  const newest = d.answers.reduce((m, a) => Math.max(m, t(a.received_at)), 0);
  return newest ? newest + 3 * 60_000 : Date.now();
}

/** A member's name: the Lemma's members, then who opened Forms, then the answer's own word. */
export function nameOf(d: { settings: Settings | null }, members: Pick<Member, "user_id" | "name">[], id: string | null | undefined, fallback = ""): string {
  if (!id) return fallback;
  return members.find((m) => m.user_id === id)?.name || d.settings?.members.find((m) => m.user_id === id)?.name || fallback || "a member";
}

export function ownerName(d: Data, members: Member[], a: Answer): string {
  return a.owner_user_id ? nameOf(d, members, a.owner_user_id, a.owner_name || "") : a.owner_name || "";
}

export function hasOpened(d: Data, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return Boolean(d.settings?.members.find((m) => m.user_id === userId)?.schedules?.take);
}

/* ---------- writes ---------- */

export type Out = { message?: string; ok?: boolean; state?: string } & Record<string, unknown>;

export async function call(name: string, input: Record<string, unknown>): Promise<Out> {
  const out = (await runFunction<Out>(name, input)) as Out;
  return out || {};
}

export const decide = (a: Answer, action: string, extra: Record<string, unknown> = {}) =>
  call("forms_decide", { answer: a.id, action, ...extra });

let needsTimer = 0;
/** Re-write this person's items in Today, a moment after a change or on open. */
export function refreshNeedsYou(): void {
  if (DEMO) return;
  window.clearTimeout(needsTimer);
  needsTimer = window.setTimeout(() => void runFunction("forms_needs_you", {}).catch(() => undefined), 1500);
}

/** The median of some minutes, or null. */
export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

export function replyMinutes(a: Answer): number | null {
  if (!a.first_reply_at || !a.received_at) return null;
  return Math.max(0, Math.round((t(a.first_reply_at) - t(a.received_at)) / 60_000));
}

export function minutes(m: number | null | undefined): string {
  if (m == null) return "";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 24) return r ? `${h}h ${r}m` : `${h}h`;
  const dd = Math.floor(h / 24);
  return h % 24 ? `${dd}d ${h % 24}h` : `${dd}d`;
}
