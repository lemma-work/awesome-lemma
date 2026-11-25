// Rows as the app reads them (functions/*/code.py write them; tables/ says what each column means).

export interface RepoCfg {
  name: string;
  live_via: "workflow" | "tag" | "deployment" | "merge";
  workflow?: string | null;
  environment?: string | null;
  paths?: string[];
}

export interface Settings {
  id: string;
  product: string | null;
  repos: RepoCfg[];
  slack_channel: string | null;
  slack_channel_name: string | null;
  publishers: { user_id: string; name: string | null }[];
  schedules: Record<string, string>;
  schedule_user_id: string | null;
  page_url: string | null;
  setup_done_at: string | null;
  sample: boolean | null;
}

export interface Note {
  id: string;
  repo: string;
  name: string;
  tag: string | null;
  from_ref: string | null;
  to_sha: string | null;
  state: "drafting" | "ready" | "published";
  title: string | null;
  live_at: string | null;
  live_env: string | null;
  live_via: "deployment" | "workflow" | "tag" | "merge" | null;
  live_ref: string | null;
  drafted_at: string | null;
  draft_error: string | null;
  published_at: string | null;
  published_by: string | null;
  github_release_url: string | null;
  slack_ts: string | null;
  page_id: string | null;
  sent: { to: string; ok: boolean; text: string; url?: string | null; at?: string }[];
  sample: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Line {
  id: string;
  note_id: string;
  section: "lead" | "need" | "improved" | "fixed";
  position: number;
  title: string | null;
  text: string;
  prs: number[];
  issues: string[];
  asked: number;
  edited_by: string | null;
  edited_at: string | null;
  hidden: boolean | null;
}

export interface Pr {
  id: string;
  repo: string;
  number: number;
  title: string;
  author: string | null;
  url: string | null;
  merged_at: string | null;
  labels: string[];
  summary: string | null;
  kind: "feature" | "improvement" | "fix" | "breaking" | "routine" | "internal" | null;
  closes: { ref: string; title?: string | null; url?: string | null }[];
  note_id: string | null;
  live_at: string | null;
  left_out: string | null;
}

export interface Ask {
  id: string;
  work_source: string;
  work_id: string;
  work_url: string | null;
  work_title: string | null;
  handle_kind: string;
  handle: string;
  name: string | null;
  company_name: string | null;
  source: string;
  source_account: string | null;
  source_id: string;
  source_url: string | null;
  heard_by: string | null;
  conversation_id: string | null;
  asked_at: string;
  state: "suggested" | "open" | "declined" | "shipped" | "told" | "dropped";
  shipped_in: string | null;
  shipped_at: string | null;
  told_at: string | null;
  plugin: string;
}

export interface Reply {
  id: string;
  ask_id: string;
  note_id: string | null;
  channel: "github" | "slack";
  target: string;
  body: string;
  state: "proposed" | "approved" | "sent" | "failed" | "discarded";
  sent_by: string | null;
  sent_at: string | null;
  url: string | null;
  error: string | null;
}

export interface Draft {
  id: string;
  conversation_id: string | null;
  source_account: string | null;
  to_handles: string[];
  subject: string | null;
  body: string;
  state: "proposed" | "approved" | "sending" | "sent" | "discarded" | "failed";
  rationale: string | null;
  built_from: { plugin?: string; ask_id?: string; note_id?: string; line_id?: string; used?: string[] };
  sent_at: string | null;
}

export interface Member {
  user_id: string;
  name: string;
  email: string;
}
