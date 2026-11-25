// The rows the app reads. The Coding agent tables are the contract with the
// bundle (coding-agent/tables/*.json); `task` is the shared team task table.

export type SessionStatus = "starting" | "working" | "needs_you" | "pr_open" | "merged" | "done" | "stopped" | "failed";
export type Needs = "none" | "question" | "approval" | "checks_failing" | "review" | "conflict" | "waiting_mac" | "failed";

export interface Session {
  id: string;
  task_id: string;
  scope: "personal" | "team";
  title: string;
  source: string | null;
  source_url: string | null;
  repo: string;
  ref: string | null;
  push_to: string | null;
  profile_id: string | null;
  model: string | null;
  place: "cloud" | "mac";
  agent_label: string | null;
  conversation_id: string | null;
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: "none" | "open" | "merged" | "closed";
  checks: "none" | "running" | "passed" | "failed";
  checks_text: string | null;
  mergeable: "unknown" | "clean" | "conflict";
  head_sha: string | null;
  keep_green: boolean;
  tries: number;
  max_tries: number;
  status: SessionStatus;
  needs: Needs;
  needs_text: string | null;
  result: string | null;
  files_changed: number | null;
  additions: number | null;
  deletions: number | null;
  started_by: string | null;
  started_by_name: string | null;
  started_at: string | null;
  last_event_at: string | null;
  finished_at: string | null;
  error: string | null;
  created_at: string;
}

export type EventKind =
  | "assigned" | "started" | "checked_out" | "setup" | "progress" | "question" | "answered" | "approval"
  | "pr_opened" | "pushed" | "check_failed" | "checks_passed" | "review_comment" | "review" | "fixing"
  | "conflict" | "merged" | "closed" | "result" | "stopped" | "failed" | "moved";

export interface CodingEvent {
  id: string;
  task_id: string;
  session_id: string | null;
  at: string;
  kind: EventKind;
  actor: string | null;
  text: string | null;
  url: string | null;
  detail: Record<string, unknown> | null;
}

export interface Repo {
  id: string;
  full_name: string;
  default_branch: string | null;
  setup: string | null;
  notes: string | null;
  enabled: boolean;
}

export interface Question {
  id: string;
  question: string;
  repo: string;
  ref: string | null;
  sha: string | null;
  conversation_id: string | null;
  state: "asking" | "answered" | "failed";
  answer: string | null;
  read: { path: string; start?: number | null; end?: number | null }[];
  task_id: string | null;
  asked_by: string | null;
  asked_by_name: string | null;
  answered_at: string | null;
  created_at: string;
}

export interface Settings {
  id: string;
  default_profile_id: string | null;
  default_model: string | null;
  keep_green: boolean;
  max_tries: number;
  issue_label: string | null;
  setup_done_at: string | null;
  sample: boolean;
}

export interface Task {
  id: string;
  number: number | null;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "waiting" | "done" | "canceled";
  priority: "none" | "low" | "medium" | "high" | "urgent";
  assignee_kind: "none" | "person" | "agent";
  assignee_user_id: string | null;
  assignee_name: string | null;
  assignee_agent: string | null;
  source: string | null;
  source_url: string | null;
  quote: string | null;
  done_at: string | null;
  created_at: string;
}

export interface Member {
  user_id: string;
  name: string;
  email: string;
}

/** One way to run an agent: Lemma's own loop on a model, or a coding agent on someone's Mac. */
export interface Runtime {
  id: string;
  name: string;
  kind: "MODEL_PROVIDER" | "HARNESS";
  model: string | null;
  models: { name: string; label: string }[];
  status: string;
  ready: boolean;
}
