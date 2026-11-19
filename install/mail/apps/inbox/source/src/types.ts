// Mail's rows. The shared tables' rows come from the kit (generated from
// plugins/_contract); these are Mail's own.

import type { ConversationRow, DraftRow, PromiseRow } from "@lemma-plugins/kit";

export type { DraftRow, PromiseRow };

export interface Mailbox {
  id: string;
  provider: "gmail" | "outlook";
  account_id: string;
  email: string;
  owner_name?: string | null;
  state: "backfilling" | "live" | "paused" | "error";
  last_synced_at?: string | null;
  last_error?: string | null;
}

export interface Category {
  id: string;
  key: string;
  name: string;
  sentence: string;
  kind: "system" | "custom";
  state: "proposed" | "active" | "retired";
  position?: number | null;
  hidden?: boolean | null;
  drafts?: boolean | null;
  brand_voice?: boolean | null;
  provenance?: string | null;
}

export interface Rule {
  id: string;
  scope: "general" | "sorting" | "writing";
  text: string;
  state: "proposed" | "active" | "retired";
  provenance?: string | null;
}

export interface Settings {
  id: string;
  display_name?: string | null;
  timezone?: string | null;
  setup_step: "start" | "connect" | "reading" | "categories" | "drafts" | "sorting" | "done";
  setup_run_id?: string | null;
  voice?: string | null;
  voice_traits?: string[] | null;
  schedules?: Record<string, string> | null;
  turned_on_at?: string | null;
  setup_summary?: Record<string, number | string> | null;
  follow_up_days?: number | null;
}

export interface Activity {
  id: string;
  kind: string;
  text: string;
  conversation_id?: string | null;
  created_at: string;
}

/** A conversation as Mail shows it: the shared row and Mail's own beside it. */
export interface Conv extends ConversationRow {
  unread?: boolean | null;
  in_inbox?: boolean | null;
  snoozed_until?: string | null;
  muted?: boolean | null;
  follow_up_at?: string | null;
  waiting_since?: string | null;
  unsure?: boolean | null;
  sorted_by?: "decision" | "person" | "sync" | null;
  confidence?: Record<string, number | null> | null;
  reason?: string | null;
  draft_state: "none" | "wanted" | "writing" | "ready" | "failed";
  draft_kind?: "reply" | "follow_up" | "schedule" | null;
  draft_hint?: string | null;
  promise_state?: "none" | "wanted" | "reading" | "done" | "failed" | null;
  latest_message_id?: string | null;
}
