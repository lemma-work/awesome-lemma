// The rows Roadmap reads: its own tables, and the shared ones it ranks by.

export type Horizon = "none" | "now" | "next" | "later" | "shipped";
export type Stage = "idea" | "planned" | "building" | "beta" | "live" | "declined";
export type Importance = "unknown" | "nice" | "important" | "blocker";

export interface Settings {
  id: string;
  lead_user_id: string | null;
  lead_name: string | null;
  timezone: string | null;
  currency: string | null;
  stale_days: number | null;
  public_on: boolean | null;
  product_id: string | null;
  product_label: string | null;
  widget_id: string | null;
  page_url: string | null;
  setup_done_at: string | null;
  sample: boolean | null;
  schedule_id: string | null;
  schedule_user_id: string | null;
}

export interface Feature {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  state: "suggested" | "active" | "merged" | "archived";
  stage: Stage;
  stage_at: string | null;
  owner_user_id: string | null;
  product_id: string | null;
  work_source: string | null;
  work_id: string | null;
}

export interface Product { id: string; name: string; role: "ours" | "rival" }

/** One quote, as the ranking reads it (no words). */
export interface Heard {
  id: string;
  feature_id: string;
  product_id: string | null;
  handle_kind: string | null;
  handle: string | null;
  name: string | null;
  company_id: string | null;
  company_name: string | null;
  importance: Importance;
  said_at: string;
  source: string;
  state: string;
}

/** One quote with its words: a feature's page reads these. */
export interface Quote extends Heard {
  quote: string;
  point: string | null;
  kind: string;
  source_url: string | null;
}

export interface Ask {
  id: string;
  work_source: string;
  work_id: string;
  handle_kind: string;
  handle: string;
  name: string | null;
  company_id: string | null;
  company_name: string | null;
  asked_at: string;
  state: string;
  source: string;
}

export interface Deal { id: string; name: string; company_id: string | null; status: "open" | "won"; stage: string | null; amount: number | null; currency: string | null }
export interface Company { id: string; name: string; domain: string | null }

export interface Item {
  id: string;
  horizon: Horizon;
  horizon_at: string | null;
  owner_user_id: string | null;
  owner_label: string | null;
  project_id: string | null;
  public: boolean | null;
  public_title: string | null;
  public_blurb: string | null;
  shipped_on: string | null;
}

export interface SpecLine { section: "problem" | "who" | "need" | "not" | "open"; key: string; text: string; quotes: string[]; edited: boolean; unsourced: boolean }

export interface Spec {
  id: string;
  path: string | null;
  version: number | null;
  state: "drafting" | "ready" | "failed";
  drafted_at: string | null;
  updated_at?: string | null;
  error: string | null;
  quotes_used: number | null;
  quotes_total: number | null;
  lines?: SpecLine[];
  labels?: Record<string, string>;
  unsourced: number | null;
  edited: number | null;
}

export interface Progress { project_id: string; total: number; done: number; moved: string | null }
export interface Project { id: string; name: string; state: string }
export interface Member { user_id: string; name: string; email: string }
