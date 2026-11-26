// Rows as the app reads them (JSON columns parsed in data.tsx).

export interface Settings {
  id: string;
  product_id: string | null;
  product_label: string | null;
  invite_gap_days: number;
  no_show_days: number;
  nudge_days: number;
  setup_done_at: string | null;
  sample: boolean;
}

export interface FitFilter { field: string; values: string[]; line: string; column?: string }
export interface FitRead { filters: FitFilter[]; unknown: { line: string }[]; read_at?: string }

export interface Study {
  id: string;
  question: string;
  feature_ids: string[];
  want: number;
  owner_user_id: string | null;
  owner_name: string | null;
  state: "draft" | "running" | "done" | "archived";
  fit_sentence: string | null;
  fit_read: FitRead | null;
  fit_state: "none" | "reading" | "ready" | "failed";
  fit_error: string | null;
  invite_line: string | null;
  pool_at: string | null;
  pool_counts: Record<string, number> | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at?: string;
  sample: boolean;
}

export type Stage = "fits" | "drafted" | "invited" | "booked" | "done" | "no_show" | "declined" | "opted_out" | "skipped";

export interface Person {
  id: string;
  study_id: string;
  handle_kind: string;
  handle: string;
  name: string | null;
  title: string | null;
  company_id: string | null;
  company_name: string | null;
  sources: Record<string, string[]>;
  why: string[];
  quote: string | null;
  quote_from: string | null;
  deal_status: string | null;
  deal_stage: string | null;
  rank: number;
  stage: Stage;
  rests_until: string | null;
  rest_rule: string | null;
  override_by: string | null;
  override_at: string | null;
  inviter_user_id: string | null;
  inviter_name: string | null;
  draft_id: string | null;
  invite_state: "none" | "writing" | "drafted" | "failed";
  invite_error: string | null;
  invited_at: string | null;
  nudged_at: string | null;
  meeting_id: string | null;
  call_at: string | null;
  call_end_at: string | null;
  join_url: string | null;
  read_state: "none" | "waiting" | "reading" | "ready" | "failed";
  read_error: string | null;
  doc_kind: "transcript" | "notes" | "pasted" | null;
  doc_path: string | null;
  doc_lines: number | null;
  found: number;
  kept: number;
  set_aside: number;
  no_show_at: string | null;
  thanked_at: string | null;
  updated_at?: string;
  sample: boolean;
}

export type Kind = "request" | "problem" | "praise" | "question" | "comparison" | "other";
export type Importance = "unknown" | "nice" | "important" | "blocker";

export interface Proposal {
  id: string;
  person_id: string;
  study_id: string;
  meeting_id: string | null;
  n: number | null;
  quote: string;
  at_seconds: number | null;
  line: number | null;
  point: string | null;
  feature_id: string | null;
  feature_new: string | null;
  kind: Kind;
  importance: Importance;
  reason: string | null;
  state: "open" | "kept" | "set_aside";
  feedback_id: string | null;
}

export interface Finding { id: string; study_id: string; person_id: string; meeting_id: string | null; kept_at: string | null }

export interface Feedback {
  id: string;
  quote: string;
  point: string | null;
  feature_id: string | null;
  importance: Importance;
  kind: Kind;
  source: string;
  at_seconds: number | null;
  said_at: string | null;
  state: string;
  handle: string | null;
  name: string | null;
  company_name: string | null;
}

export interface Feature {
  id: string;
  name: string;
  state: "suggested" | "active" | "merged" | "archived";
  stage: "idea" | "planned" | "building" | "beta" | "live" | "declined";
  product_id: string;
  description: string | null;
  merged_into: string | null;
}

export interface Draft {
  id: string;
  to_handles: string[];
  subject: string | null;
  body: string;
  state: string;
  built_from: { plugin?: string; study_id?: string; person_id?: string; used?: string[] };
  error: string | null;
  sent_at: string | null;
  source_account: string;
  rationale: string | null;
}

export interface Member { user_id: string; name: string; email: string }
