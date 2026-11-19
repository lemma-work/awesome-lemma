// Rows as this app reads them. A meeting is the shared `meeting` row joined
// to Meetings' own `meetings_work` row (same id).

export type Kind = "customer" | "investor" | "candidate" | "partner" | "internal" | "other";
export const KINDS: Kind[] = ["customer", "investor", "candidate", "partner", "internal", "other"];

export interface Attendee {
  handle: string;
  name?: string | null;
  response?: "accepted" | "tentative" | "declined" | "needs_action" | string;
  organizer?: boolean;
  you?: boolean;
  outside?: boolean;
}

export interface Answer {
  value: unknown;
  confidence: number | null;
}

export interface Meeting {
  id: string;
  source_account: string;
  source_id: string;
  series_id?: string | null;
  title?: string | null;
  start_at: string;
  end_at?: string | null;
  attendees?: Attendee[] | null;
  organizer_handle?: string | null;
  agenda?: string | null;
  join_url?: string | null;
  location?: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  outside?: boolean | null;
  kind?: Kind | null;
  wants_brief?: boolean | null;
  headline?: string | null;
  brief?: string | null;
  brief_at?: string | null;
  document_path?: string | null;
  summary?: string | null;
  summarized_at?: string | null;
  // meetings_work
  sorted_by?: "domains" | "decision" | "person" | null;
  unsure?: boolean | null;
  answers?: { kind?: Answer; needs_brief?: Answer } | null;
  reason?: string | null;
  brief_state: "none" | "planned" | "wanted" | "writing" | "ready" | "failed";
  brief_due_at?: string | null;
  brief_error?: string | null;
  searched?: string[] | null;
  built_from?: { conversation_ids?: string[]; meeting_ids?: string[] } | null;
  notes_state: "none" | "waiting" | "wanted" | "reading" | "ready" | "failed" | "skipped";
  notes_from?: "meet" | "notes" | "sample" | null;
  notes_error?: string | null;
  dropped?: number | null;
}

export interface Settings {
  id: string;
  display_name?: string | null;
  timezone?: string | null;
  my_domains?: string[] | null;
  kinds_on?: Kind[] | null;
  brief_when: "evening_before" | "hour_before";
  notes_from: "meet" | "notes" | "skip";
  meet_account_id?: string | null;
  setup_step: "start" | "connect" | "reading" | "kinds" | "timing" | "after" | "done";
  setup_run_id?: string | null;
  setup_done_at?: string | null;
  schedules?: Record<string, string> | null;
}

export interface Calendar {
  id: string;
  provider: "google" | "outlook" | "sample";
  account_id?: string | null;
  email: string;
  own_domains?: string[] | null;
  state: "reading" | "live" | "stopped";
  last_read_at?: string | null;
  last_error?: string | null;
}

export interface Decision {
  id: string;
  meeting_id: string;
  text: string;
  quote: string;
  by_name?: string | null;
  by_handle?: string | null;
  state: "kept" | "dismissed";
  created_at?: string;
}

export interface PromiseRow {
  id: string;
  conversation_id?: string | null;
  source: string;
  source_id?: string | null;
  person_handle?: string | null;
  person_name?: string | null;
  direction: "i_owe" | "owed_to_me";
  text: string;
  quote?: string | null;
  due_at?: string | null;
  state: "open" | "done" | "dropped";
  created_at?: string;
}
