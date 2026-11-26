// The members' working set: one read per name, kept fresh by the Lemma's
// change stream (the kit's DataProvider). Betas, testers, batches and
// feedback are team-wide; drafts and settings are each person's own (RLS),
// so a member sees the notes drafted in their own mailbox.

import type { ReactNode } from "react";
import { DataProvider, useData, useRows, type Loaders } from "@lemma-plugins/kit";

export type Status = "waiting" | "picked" | "invited" | "active" | "quiet" | "left" | "not_now";
export type Fit = "strong" | "maybe" | "not_now";
export type FlagTool = "posthog" | "none" | "by_hand";
export type DraftKind = "invite" | "checkin" | "chase" | "not_now";

export interface Question { key: string; label: string; on?: boolean }

export interface Step { step: string; ok: boolean; said: string; at?: string }

export interface Beta {
  id: string;
  feature_id: string | null;
  product_id: string | null;
  slug: string;
  name: string;
  intro: string | null;
  state: "draft" | "open" | "paused" | "closed";
  flag_tool: FlagTool;
  flag_key: string | null;
  cohort_id: string | null;
  cohort_name: string | null;
  posthog_account: string | null;
  posthog_account_id: string | null;
  posthog_url: string | null;
  usage_events: (string | { url: string })[] | null;
  survey_id: string | null;
  batch_size: number;
  checkin_day: number;
  quiet_days: number;
  questions: Question[] | null;
  owner_user_id: string | null;
  opened_at: string | null;
  page_url: string | null;
  widget_key: string | null;
  turned_on: Step[] | null;
  sweep_at: string | null;
  sweep: { usage?: "read" | "not_connected" | "failed"; note?: string; people?: number; at?: string } | null;
  sample: boolean | null;
  created_at?: string;
}

export interface TimelineLine { at: string; what: string; quote?: string; source?: string; ai?: boolean }

export interface Tester {
  id: string;
  beta_id: string;
  handle_kind: string;
  handle: string;
  name: string | null;
  company_id: string | null;
  company_name: string | null;
  role: string | null;
  ref: string | null;
  contact_id: string | null;
  answers: Record<string, string> | null;
  email_proof: "unchecked" | "code" | "not_confirmed" | "member";
  status: Status;
  fit: Fit | null;
  fit_reason: string | null;
  fit_sure: number | null;
  fit_at: string | null;
  fit_by: "lemma" | "person" | null;
  batch_id: string | null;
  invited_by: string | null;
  invited_at: string | null;
  invite_draft_id: string | null;
  flag_state: "on" | "waiting_for_person" | "failed" | "by_hand" | "none" | null;
  flag_note: string | null;
  posthog_person_id: string | null;
  first_used_at: string | null;
  last_used_at: string | null;
  uses_7d: number | null;
  last_heard_at: string | null;
  last_said: string | null;
  last_said_source: string | null;
  checkin_draft_id: string | null;
  checkin_at: string | null;
  chase_draft_id: string | null;
  chased_at: string | null;
  not_now_draft_id: string | null;
  left_reason: string | null;
  timeline: TimelineLine[] | null;
  signed_up_at: string | null;
  sample: boolean | null;
  created_at?: string;
}

export interface Batch { id: string; beta_id: string; picked_by: string | null; picked_at: string | null; size: number; sent: boolean | null }

export interface Draft {
  id: string;
  state: "proposed" | "approved" | "sending" | "sent" | "discarded" | "failed";
  subject: string | null;
  body: string | null;
  to_handles: string[] | null;
  source_account: string | null;
  built_from: { plugin?: string; tester_id?: string; beta_id?: string; kind?: DraftKind; used?: string[] } | null;
  sent_at: string | null;
  error: string | null;
}

export interface Said {
  id: string;
  quote: string;
  handle: string | null;
  source: string;
  said_at: string;
  importance: string;
  kind: string;
  feature_id: string | null;
}

export interface Mailbox { id: string; provider: string; email: string; account_id: string | null; state: string | null }

export interface Settings { id: string; mailbox: string | null; schedules: Record<string, string> | null }

export const LOADERS: Loaders = {
  betas: { sql: "SELECT * FROM early_access_beta ORDER BY created_at LIMIT 50", tables: ["early_access_beta"] },
  testers: { sql: "SELECT * FROM early_access_tester ORDER BY signed_up_at DESC LIMIT 3000", tables: ["early_access_tester"] },
  batches: { sql: "SELECT id, beta_id, picked_by, picked_at, size, sent FROM early_access_batch ORDER BY picked_at DESC LIMIT 300", tables: ["early_access_batch"] },
  drafts: {
    sql: "SELECT id, state, subject, body, to_handles, source_account, built_from, sent_at, error FROM draft WHERE kind = 'new' ORDER BY updated_at DESC LIMIT 1500",
    tables: ["draft"],
  },
  said: {
    sql: "SELECT id, quote, handle, source, said_at, importance, kind, feature_id FROM feedback WHERE plugin = 'early-access' ORDER BY said_at DESC LIMIT 3000",
    tables: ["feedback"],
  },
  settings: { sql: "SELECT id, mailbox, schedules FROM early_access_settings LIMIT 1", tables: ["early_access_settings"] },
  mailboxes: { sql: "SELECT id, provider, email, account_id, state FROM mail_mailbox ORDER BY connected_at LIMIT 20", tables: ["mail_mailbox"] },
};

export function EAProvider({ children }: { children: ReactNode }) {
  return <DataProvider loaders={LOADERS}>{children}</DataProvider>;
}

export function useEA() {
  const { loaded, errors, reload } = useData();
  const betas = useRows<Beta>("betas");
  const testers = useRows<Tester>("testers");
  const batches = useRows<Batch>("batches");
  const drafts = useRows<Draft>("drafts").filter((d) => d.built_from?.plugin === "early-access");
  const said = useRows<Said>("said");
  const settings = useRows<Settings>("settings")[0] || null;
  const mailboxes = useRows<Mailbox>("mailboxes");
  return { loaded, errors, reload, betas, testers, batches, drafts, said, settings, mailboxes };
}

/** The note drafted for this tester and not yet sent or set aside, newest kind first. */
export function openDraft(t: Tester, drafts: Draft[]): Draft | null {
  const mine = drafts.filter((d) => d.built_from?.tester_id === t.id && (d.state === "proposed" || d.state === "approved" || d.state === "failed"));
  const order: DraftKind[] = ["chase", "checkin", "invite", "not_now"];
  return mine.sort((a, b) => order.indexOf(a.built_from?.kind as DraftKind) - order.indexOf(b.built_from?.kind as DraftKind))[0] || null;
}

/** The mailbox a note goes from: the one chosen in settings, else the first real one. */
export function sendingBox(settings: Settings | null, mailboxes: Mailbox[]): Mailbox | null {
  const real = mailboxes.filter((m) => m.account_id !== "sample");
  return real.find((m) => m.id === settings?.mailbox) || real[0] || null;
}
