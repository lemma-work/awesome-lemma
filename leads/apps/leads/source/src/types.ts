// Rows as Leads reads them. Lead research's own tables are leads_*; person,
// people_person and company are People map's and the contract's.

export const KINDS = ["customer", "investor", "partner", "candidate", "vendor"] as const;
export type Kind = (typeof KINDS)[number] | "colleague" | "other";

export type State = "skipped" | "unsure" | "proposed" | "queued" | "wanted" | "looking" | "ready" | "failed";
export type Review = "new" | "kept" | "passed";

export interface Fact {
  key: string;
  label: string;
  value: string;
  url: string;
  source?: string;
  found_at?: string;
  date?: string;
}

export interface Lead {
  id: string;
  state: State;
  company_id: string | null;
  kind: string | null;
  worth: boolean | null;
  worth_by: "decision" | "person" | "rule" | null;
  worth_confidence: number | null;
  worth_reason: string | null;
  wanted_at: string | null;
  forced: boolean | null;
  looked_up_at: string | null;
  lookup_seconds: number | null;
  lookup_error: string | null;
  found: boolean | null;
  facts: Fact[] | null;
  not_found: string[] | null;
  role: string | null;
  location: string | null;
  profile_url: string | null;
  summary: string | null;
  fit: number | null;
  fit_sure: boolean | null;
  fit_why: string | null;
  review: Review;
  reviewed_at: string | null;
  sample: boolean | null;
  created_at: string;
  // joined
  name: string | null;
  mail_title: string | null;
  handle: string | null;
  last_inbound_at: string | null;
  last_contact_at: string | null;
  next_meeting_at: string | null;
  company_name: string | null;
  company_domain: string | null;
}

export interface CompanyFacts {
  id: string;
  looked_up_at: string | null;
  found: boolean | null;
  facts: Fact[] | null;
  news: Fact[] | null;
  sample: boolean | null;
}

export interface Settings {
  id: string;
  display_name: string | null;
  timezone: string | null;
  fit_sentence: string | null;
  fit_examples: string[] | null;
  fit_version: string | null;
  kinds: string[] | null;
  daily_limit: number | null;
  setup_step: "start" | "fit" | "kinds" | "reading" | "review" | "done";
  setup_run_id: string | null;
  setup_done_at: string | null;
  schedules: Record<string, string> | null;
}

export interface Candidate {
  id: string;
  name: string | null;
  handle: string | null;
  kind: string | null;
  company_name: string | null;
  company_domain: string | null;
  last_contact_at: string | null;
}

export interface Profile {
  id: string;
  fit_sentence: string | null;
  fit_examples: string[] | null;
  fit_version: string | null;
  set_by: string | null;
  set_by_name: string | null;
  set_at: string | null;
}
