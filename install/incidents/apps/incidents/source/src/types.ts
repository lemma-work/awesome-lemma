// Rows as the app reads them (JSON columns parsed in data.tsx).

export interface Severity { key: string; word: string; update_every_min: number }
export interface Repo { repo: string; service?: string | null; deploy_workflow?: string | null }

export interface Settings {
  id: string;
  slack_account: string | null;
  slack_team_id: string | null;
  announce_channel_id: string | null;
  announce_channel_name: string | null;
  channel_prefix: string | null;
  repos: Repo[];
  email_to: string[];
  email_from?: string | null;
  severities: Severity[];
  setup_done_at: string | null;
  sample: boolean;
  schedules: Record<string, string>;
  schedule_user_id: string | null;
}

export interface Person { user_id?: string | null; name?: string | null; email?: string | null; slack_id?: string | null }

export interface Followup { key: string; title: string; why?: string; owner_name?: string | null; state: "proposed" | "accepted" | "dismissed"; task_id?: string | null }

export interface WriteupItem { key: string; kind: "p" | "li"; text: string; cites: string[] }
export interface Writeup {
  title: string;
  drafted_at?: string;
  sections: { key: string; heading: string; items: WriteupItem[] }[];
  timeline: { at: string; text: string; cites: string[] }[];
  built_from?: { messages?: number; pinned?: number; changes?: number; deploys?: number; triage?: number; channel?: string; triage_label?: string };
  not_used?: string[];
}

export interface Incident {
  id: string;
  number: number;
  title: string;
  severity: string;
  status: "declared" | "investigating" | "fixing" | "monitoring" | "resolved";
  lead_user_id: string | null;
  lead_name: string | null;
  comms_user_id: string | null;
  comms_name: string | null;
  responders: Person[];
  service: string | null;
  impact: string | null;
  people_affected: number | null;
  people_source: string | null;
  started_at: string | null;
  started_source: string | null;
  noticed_at: string | null;
  noticed_source: string | null;
  declared_at: string;
  declared_by: string | null;
  resolved_at: string | null;
  channel_id: string | null;
  channel_name: string | null;
  channel_connected: boolean;
  channel_schedule_id: string | null;
  source: "app" | "slack" | "triage";
  source_id: string | null;
  source_url: string | null;
  source_label: string | null;
  summary: string | null;
  summary_at: string | null;
  gathered_at: string | null;
  update_due_at: string | null;
  writeup_state: "none" | "drafting" | "to_review" | "reviewed";
  writeup_path: string | null;
  writeup: Writeup | null;
  writeup_at: string | null;
  reviewed_by: string | null;
  followups: Followup[];
}

export interface IncEvent {
  id: string;
  incident_id: string;
  at: string;
  kind: "message" | "pin" | "status" | "severity" | "role" | "change" | "deploy" | "triage" | "lemma" | "update" | "declared";
  source: "slack" | "github" | "triage" | "lemma" | "app";
  source_id: string | null;
  actor: string | null;
  text: string | null;
  url: string | null;
  starred: boolean;
  detail: Record<string, unknown> | null;
}

export interface Change { id: string; repo: string; kind: "merge" | "push" | "deploy" | "release"; ref: string | null; title: string | null; author: string | null; at: string; url: string | null; outcome: string | null }

export interface Evidence { text: string; event_id?: string | null; url?: string | null; source?: string | null }
export interface Hypothesis {
  id: string;
  incident_id: string;
  text: string;
  confidence: "likely" | "possible" | "inconclusive";
  agree: number | null;
  signs: number | null;
  evidence: Evidence[];
  ruled_out: { text: string }[];
  not_checked: { text: string; source?: string | null }[];
  state: "open" | "confirmed" | "not_it";
  posted_at: string | null;
  created_at: string;
}

export interface Update {
  id: string;
  incident_id: string;
  body: string;
  to: { channel?: boolean; announce?: boolean; email?: string[] } | null;
  state: "draft" | "sent" | "discarded";
  drafted_at: string | null;
  sent_at: string | null;
  sent_by: string | null;
  delivery: Record<string, string> | null;
}

export interface Flag { id: string; incident_id: string; section: string; claim: string; reason: string | null; offer: string | null; state: "open" | "fixed" | "kept" }

export interface Task {
  id: string;
  number: number | null;
  title: string;
  status: "todo" | "in_progress" | "waiting" | "done" | "canceled";
  assignee_kind: "none" | "person" | "agent";
  assignee_name: string | null;
  assignee_agent: string | null;
  due_on: string | null;
  source_id: string | null;
  done_at: string | null;
}

export interface Member { user_id: string; name: string; email: string }
