// Rows the app reads. `deal` is the shared contract table (team-wide); the rest
// are Deal tracker's own. Proposals (`deals_change`) are each person's own.

export type StageKind = "open" | "won" | "lost";

export interface Stage {
  id: string;
  name: string;
  kind: StageKind;
  meaning: string | null;
  position: number;
}

export interface Who {
  handle: string | null;
  name: string | null;
}

export interface Deal {
  id: string;
  name: string;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  people: Who[] | null;
  owner_user_id: string | null;
  owner_name: string | null;
  stage: string;
  status: StageKind;
  amount: number | null;
  currency: string | null;
  close_date: string | null;
  next_step: string | null;
  closed_at: string | null;
  lost_reason: string | null;
  source: string;
  source_id: string | null;
  last_activity_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export type ChangeKind = "new_deal" | "stage" | "amount" | "close_date" | "next_step" | "lost";

export interface Change {
  id: string;
  kind: ChangeKind;
  deal_id: string | null;
  deal_name: string | null;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  people: Who[] | null;
  value: Record<string, unknown> | null;
  previous: Record<string, unknown> | null;
  quote: string;
  speaker: string | null;
  said_at: string | null;
  source: string;
  source_row: string | null;
  source_label: string | null;
  read_id: string | null;
  confidence: number | null;
  state: "proposed" | "kept" | "dismissed" | "expired";
  decided_at: string | null;
  kept_value: Record<string, unknown> | null;
  sample: boolean | null;
  created_at?: string;
}

export interface Member {
  id: string;
  display_name: string | null;
  timezone: string;
  setup_step: "start" | "stages" | "currency" | "existing" | "finding" | "review" | "day" | "done";
  setup_run_id: string | null;
  setup_done_at: string | null;
  listening: boolean;
  setup_summary: Record<string, number> | null;
  refresh_schedule_id: string | null;
  needs_at: string | null;
}

export interface Settings {
  id: string;
  currency: string;
  review_day: string;
  review_time: string;
  timezone: string;
  review_schedule_id: string | null;
  review_schedule_by: string | null;
  set_up_by: string | null;
  set_up_by_name: string | null;
  set_up_at: string | null;
}

export interface History {
  id: string;
  deal_id: string;
  field: string;
  from_value: unknown;
  to_value: unknown;
  by_user_id: string | null;
  by_name: string | null;
  how: "proposal" | "person" | "spreadsheet" | "sample";
  source: string | null;
  with_name: string | null;
  at: string;
}

export interface Note {
  id: string;
  deal_id: string;
  body: string;
  by_user_id: string | null;
  by_name: string | null;
  created_at: string;
}

export interface Link {
  handle: string;
  name: string | null;
  company_id: string | null;
  member_id: string;
  member_name: string | null;
  last_contact_at: string | null;
  warmth: "warm" | "cooling" | "cold" | "new" | null;
}

export interface ReviewCounts {
  window: { from: string; to: string; days: number };
  currency: string;
  moved: { id: string; name: string; company: string | null; stage: string; amount: number | null; currency: string;
    changes: { field: string; from: unknown; to: unknown; by: string | null; how: string; with: string | null; at: string }[] }[];
  quiet: { id: string; name: string; company: string | null; stage: string; amount: number | null; currency: string;
    warmth: string; people: string[]; last_contact_at: string | null; last_contact_by: string | null; days: number | null }[];
  stages: { stage: string; deals: number; amount: number; amount_text: string; other_currency: number }[];
  closing_soon: { id: string; name: string; company: string | null; stage: string; amount: number | null; currency: string; close_date: string }[];
  totals: { open: number; open_amount: number; open_amount_text: string; open_other_currency: number; new: number;
    stage_moves: number; won: number; won_amount: number; won_amount_text: string; lost: number; quiet: number; moved: number };
}

export interface Review {
  id: string;
  week_start: string;
  week_end: string;
  counts: ReviewCounts | null;
  counted_at: string | null;
  summary: string | null;
  summary_at: string | null;
  summary_state: "none" | "writing" | "ready" | "failed";
}
