// Rows this app reads. The shared tables' types come from the kit (generated
// from ../_contract); these are People map's own and the joins it reads.

export const KINDS = ["customer", "investor", "partner", "candidate", "vendor", "colleague", "other"] as const;
export type Kind = (typeof KINDS)[number];
export type Warmth = "warm" | "cooling" | "cold" | "new";

export interface Person {
  id: string;
  handle: string | null;
  domain: string | null;
  in_scope: boolean | null;
  deal_with: boolean | null;
  kind: Kind | null;
  sorted_by: "decision" | "person" | null;
  sorted_at: string | null;
  unsure: boolean | null;
  reason: string | null;
  answers: { deal_with?: { value?: string | null; confidence?: number | null }; kind?: { value?: string | null; confidence?: number | null } } | null;
  company_id: string | null;
  first_contact_at: string | null;
  last_contact_at: string | null;
  last_contact_dir: "inbound" | "outbound" | "meeting" | null;
  conversation_count: number | null;
  meeting_count: number | null;
  episodes: number | null;
  usual_gap_days: number | null;
  warmth: Warmth | null;
  quiet: boolean | null;
  quiet_days: number | null;
  waiting_on_me: boolean | null;
  next_meeting_at: string | null;
  next_meeting_id: string | null;
  summary: string | null;
  summary_sources: { n: number; kind: "conversation" | "meeting"; id: string; label: string; at: string | null }[] | null;
  summary_state: "none" | "wanted" | "writing" | "ready" | "failed";
  summary_at: string | null;
  summary_error: string | null;
  // joined
  name: string | null;
  org: string | null;
  title: string | null;
  is_vip: boolean | null;
  company_name: string | null;
  company_domain: string | null;
}

export interface Settings {
  id: string;
  display_name: string | null;
  timezone: string | null;
  categories: string[] | null;
  own_domains: string[] | null;
  share_with_team: boolean | null;
  setup_step: "start" | "categories" | "domains" | "finding" | "review" | "done";
  setup_run_id: string | null;
  setup_done_at: string | null;
  setup_summary: { people?: number; noise?: number; unsure?: number; quiet?: number; companies?: number; waiting_on_you?: number; kinds?: Record<string, number> } | null;
  schedules: Record<string, string> | null;
  refreshed_at: string | null;
}

export interface Link {
  id: string;
  member_id: string;
  member_name: string | null;
  handle: string;
  name: string | null;
  title: string | null;
  company_id: string | null;
  last_contact_at: string | null;
  warmth: Warmth | null;
}

export interface Fact {
  id: string;
  person_id: string;
  fact: string;
  source_kind: "conversation" | "meeting" | "person";
  source_id: string | null;
  source_label: string | null;
  state: "active" | "forgotten";
  created_at?: string;
}

export interface Promise_ {
  id: string;
  person_handle: string | null;
  person_name: string | null;
  direction: "i_owe" | "owed_to_me";
  text: string;
  quote: string | null;
  due_at: string | null;
  conversation_id: string | null;
  source: string;
  source_id: string | null;
}

export interface Category {
  key: string;
  name: string;
  sentence: string | null;
  kind: string | null;
}

/** One person the team knows, gathered from every member's row. */
export interface TeamPerson {
  handle: string;
  name: string | null;
  title: string | null;
  company_id: string | null;
  last_contact_at: string | null;
  last_by: string | null;
  warmth: Warmth | null;
  members: { id: string; name: string | null; last_contact_at: string | null; warmth: Warmth | null }[];
}
