// Rows the app reads. A task lives in one of two tables with the same columns:
// `personal_task` (private to its owner, row-level security) or `task` (the
// team's). The app reads both and says which with `scope`.

export type Scope = "personal" | "team";
export type Status = "todo" | "in_progress" | "waiting" | "done" | "canceled";
export type Priority = "none" | "low" | "medium" | "high" | "urgent";

export const STATUSES: Status[] = ["waiting", "in_progress", "todo", "done"];
export const BOARD: Status[] = ["todo", "in_progress", "waiting", "done"];
export const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting: "Waiting on you",
  done: "Done",
  canceled: "Canceled",
};
export const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "none"];
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low", none: "No priority" };
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

/** "An agent could do this" is suggested from this confidence up (tasks_on_task asks with the same bar). */
export const SUGGEST_FROM = 0.6;

/** The Lemma's own assistant, as an assignee. */
export const ASSISTANT = "pod_default";

export interface Task {
  id: string;
  scope: Scope;
  number?: number | null;
  title: string;
  description?: string | null;
  status: Status;
  priority: Priority;
  due_on?: string | null;
  project_id?: string | null;
  parent_id?: string | null;
  labels?: string[] | null;
  assignee_kind: "none" | "person" | "agent";
  assignee_user_id?: string | null;
  assignee_name?: string | null;
  assignee_agent?: string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  source: string;
  source_id?: string | null;
  source_url?: string | null;
  quote?: string | null;
  done_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  state: "active" | "paused" | "done" | "canceled";
  lead_user_id?: string | null;
  lead_name?: string | null;
  target_on?: string | null;
  created_at?: string;
}

export interface Run {
  id: string;
  scope: Scope;
  agent: string;
  conversation_id?: string | null;
  workflow_run_id?: string | null;
  state: "starting" | "working" | "waiting" | "done" | "stopped" | "failed";
  started_at?: string | null;
  last_report_at?: string | null;
  turns?: number | null;
  error?: string | null;
}

export interface Activity {
  id: string;
  task_id: string;
  kind: "comment" | "question" | "approval" | "result" | "status" | "assign" | "field" | "created" | "moved" | "started" | "stopped";
  actor_kind: "person" | "agent" | "lemma";
  actor_user_id?: string | null;
  actor_name?: string | null;
  body?: string | null;
  detail?: Record<string, unknown> | null;
  state?: "pending" | "answered" | "approved" | "declined" | null;
  decided_by?: string | null;
  decided_at?: string | null;
  created_at: string;
}

export interface Decision {
  id: string;
  kind: "agent" | "promise";
  answer: string;
  confidence?: number | null;
  reason?: string | null;
  state: "open" | "accepted" | "dismissed" | "made" | "quiet";
  task_id?: string | null;
  evidence?: string | null;
}

export interface Settings {
  id: string;
  display_name?: string | null;
  timezone?: string | null;
  scope: "me" | "team";
  promises: "auto" | "ask" | "never";
  agents?: string[] | null;
  capabilities?: Capabilities | null;
  setup_step: "start" | "done";
  setup_run_id?: string | null;
  schedule_id?: string | null;
}

export interface Capabilities {
  plugins?: string[];
  accounts?: string[];
  agents?: string[];
  has_promises?: boolean;
}

export interface PromiseRow {
  id: string;
  conversation_id?: string | null;
  source: string;
  person_name?: string | null;
  person_handle?: string | null;
  text: string;
  quote?: string | null;
  due_at?: string | null;
  state: "open" | "done" | "dropped";
  created_at: string;
  subject?: string | null;
  d_answer?: string | null;
  d_confidence?: number | null;
  d_state?: string | null;
  d_reason?: string | null;
  d_task_id?: string | null;
}

export interface Member {
  user_id: string;
  name: string;
  email: string;
}
