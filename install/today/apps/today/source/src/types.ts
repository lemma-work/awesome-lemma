// What Today reads: the shared needs_you list (whatever plugins wrote it),
// its settings, and the platform's own Needs you (questions waiting on the
// person in Lemma).

import type { NeedsYouRow } from "@lemma-plugins/kit";

export interface Settings {
  id: string;
  display_name: string | null;
  timezone: string | null;
  morning_at: string | null;
  setup_step: "start" | "done";
  setup_done_at: string | null;
  schedule_id: string | null;
  last_swept_at: string | null;
  last_sweep: { calls?: number; nudges?: number; late?: number; asked?: number; held?: number; unsure?: number } | null;
  day_note: string | null;
  day_note_at: string | null;
}

export type Verb = NeedsYouRow["verb"];

/** One needs_you item, as its plugin wrote it. */
export type Item = NeedsYouRow & {
  created_at?: string;
  updated_at?: string;
};

/** A question waiting on the person in Lemma itself: an agent's question, an approval, a workflow form. */
export interface PlatformAsk {
  channel: { id: string; kind: string; title?: string | null; person?: { name?: string | null } | null };
  message: {
    id: string;
    text?: string | null;
    created_at?: string | null;
    sender?: { display_name?: string | null; name?: string | null } | null;
    question?: { kind: "ASK" | "APPROVAL" | "FORM"; state: string; question?: Record<string, unknown> | null; expires_at?: string | null } | null;
  };
}
