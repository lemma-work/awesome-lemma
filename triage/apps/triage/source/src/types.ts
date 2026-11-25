// Triage's rows as the app reads them (JSON columns already parsed).

export type Door = "app" | "assistant" | "slack" | "github" | "form" | "sentry" | "posthog" | "dependabot" | "code_scanning" | "secret_scanning";
export type ItemState = "inbox" | "accepted" | "declined" | "duplicate" | "snoozed" | "marked_down" | "done";
export type Priority = "urgent" | "high" | "medium" | "low";

export interface Evidence {
  source: string;
  asked?: string | null;
  answer: string;
  state: "checked" | "nothing_found" | "not_checked";
  url?: string | null;
}

export interface Security {
  severity?: string | null;
  scope?: string | null;
  relationship?: string | null;
  reachable?: boolean | null;
  patch?: string | null;
  advisory?: string | null;
  package?: string | null;
  rule?: string | null;
  tool?: string | null;
  alert_number?: number | null;
  epss?: number | null;
}

export interface Alt {
  user_id?: string | null;
  name?: string | null;
  reason: string;
}

export interface Related {
  ref?: string | null;
  title?: string | null;
  url?: string | null;
  note?: string | null;
}

export interface Item {
  id: string;
  number: number;
  title: string;
  kind: "bug" | "alert" | "security" | "request";
  state: ItemState;
  priority: Priority;
  reach_people: number | null;
  reach_events: number | null;
  reach_asks: number;
  reach_companies: number;
  reach_unit: "people" | "asked" | "repo" | "reports";
  reach_read_at: string | null;
  reach_note: string | null;
  trend: [string, number][];
  escalating: boolean;
  regressed: boolean;
  first_seen: string | null;
  last_report_at: string | null;
  repo: string | null;
  paths: string[];
  doors: Door[];
  security: Security | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_reason: string | null;
  owner_rule: string | null;
  alternatives: Alt[];
  looks_like: string | null;
  looks_like_note: string | null;
  duplicate_of: string | null;
  task_id: string | null;
  snoozed_until: string | null;
  marked_down_reason: string | null;
  marked_down_by: string | null;
  decline_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  summary: string | null;
  evidence: Evidence[];
  fix_hint: string | null;
  read_state: "none" | "reading" | "done" | "failed";
  read_at: string | null;
  related: Related[];
  sample: boolean;
  created_at: string;
}

export interface Report {
  id: string;
  item_id: string | null;
  door: Door;
  via: string | null;
  source_id: string;
  source_url: string | null;
  title: string | null;
  body: string | null;
  quote: string | null;
  reporter_kind: "member" | "contact" | "visitor" | "machine";
  handle_kind: string | null;
  handle: string | null;
  reporter_name: string | null;
  company_name: string | null;
  page: string | null;
  app_version: string | null;
  browser: string | null;
  steps: string | null;
  expected: string | null;
  files: string[];
  people: number | null;
  events: number | null;
  sessions: number | null;
  read_at: string | null;
  security: Security | null;
  detail: Record<string, unknown> | null;
  path: string | null;
  kind: string | null;
  state: "new" | "filed" | "merged" | "question" | "not_a_report";
  match_note: string | null;
  received_at: string | null;
  created_at: string;
}

export interface TEvent {
  id: string;
  item_id: string;
  at: string;
  kind: string;
  actor: string;
  actor_name: string | null;
  text: string;
}

export interface Ask {
  id: string;
  work_id: string;
  task_id: string | null;
  handle_kind: string;
  handle: string;
  name: string | null;
  company_name: string | null;
  source: string;
  source_id: string;
  source_url: string | null;
  state: "suggested" | "open" | "declined" | "shipped" | "told" | "dropped";
  told_at: string | null;
  asked_at: string;
}

export interface Rule {
  id: string;
  kind: "route" | "mark_down";
  match: { path?: string; repo?: string; label?: string; door?: string; text?: string; kind?: string };
  owner_user_id: string | null;
  owner_name: string | null;
  reason: string | null;
  position: number;
  enabled: boolean;
}

export interface Away {
  id: string;
  member_id: string | null;
  name: string;
  day: string;
  part: "full" | "half";
}

export interface Known {
  id: string;
  item_id: string | null;
  title: string;
  state: "investigating" | "being_fixed" | "fixed";
  page: string | null;
  updated_at: string | null;
}

export interface Task {
  id: string;
  number: number | null;
  title: string;
  status: string;
  assignee_kind: string;
  assignee_name: string | null;
  assignee_agent: string | null;
  source_id: string | null;
}

export interface SourceStatus {
  state?: string;
  read_at?: string | null;
  note?: string | null;
  count?: number;
}

export interface Person {
  user_id: string;
  name: string;
  email?: string | null;
  github?: string | null;
  slack?: string | null;
}

export interface Settings {
  id: string;
  repos: { id?: number | string | null; full_name: string }[];
  slack: { account?: string; team_id?: string; channels?: { id: string; name: string }[] };
  sentry: { account?: string; org?: string; projects?: string[] };
  posthog: { account?: string; account_id?: string; project_id?: string };
  ack: Record<string, "off" | "got_it" | "got_it_known">;
  urgent_people: number;
  read_from_people: number;
  close_github_on_done: boolean;
  rotation: string[];
  rotation_start: string | null;
  people: Person[];
  form_on: boolean;
  form_audience: "anyone" | "contacts";
  widget_key: string | null;
  widget_id: string | null;
  form_link: string | null;
  form_columns: string[];
  known_public: boolean;
  setup_done_at: string | null;
  sample: boolean;
  quiet: boolean;
  status: Record<string, SourceStatus>;
  schedules: Record<string, string>;
  plugins: Record<string, boolean>;
  sprints_away: { read_at?: string; days?: { member_id?: string | null; name: string; day: string; part: string }[] };
}

export interface Member {
  user_id: string;
  name: string;
  email: string;
}
