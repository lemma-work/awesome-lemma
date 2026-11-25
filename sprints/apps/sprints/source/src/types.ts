// The rows Sprints reads: its own tables and the shared `task`.

export type Measure = "points" | "tasks";
export type SprintState = "planned" | "running" | "closing" | "closed";
export type Outcome = "open" | "done" | "carried" | "split" | "backlog" | "dropped";
export type Choice = "carry" | "split" | "backlog" | "drop";

export interface Settings {
  id: string;
  length_weeks: number;
  start_weekday: string;
  timezone: string | null;
  measure: Measure;
  lead_user_id: string | null;
  lead_name: string | null;
  scale: number[];
  watch_sources: string[];
  setup_done_at: string | null;
  sample: boolean | null;
  schedule_id: string | null;
  lead_schedule_id: string | null;
  schedule_user_id: string | null;
}

export interface PersonCap {
  key: string;
  name: string;
  user_id?: string | null;
  usual: number | null;
  history: { sprint: number; value: number }[];
  days: number;
  days_off: number;
  present_days: number;
  away: { day: string; part: string }[];
  cap: number | null;
  planned: number;
  tasks: number;
}

export interface Stats {
  measure?: Measure;
  planned?: Block;
  added?: Block;
  added_done?: Block;
  removed?: Block;
  done?: Block;
  done_of_plan?: Block;
  not_done?: Block;
  scope?: Block;
  carried?: Block;
  split?: Block;
  backlog?: Block;
  dropped?: Block;
  by_person?: Record<string, { name: string; points: number; tasks: number; had_points: number; had_tasks: number; user_id?: string | null }>;
  agents?: Record<string, { tasks: number; done: number; tags: string[]; done_tags: string[] }>;
  slipped_twice?: string[];
}

export interface Block {
  points: number;
  tasks: number;
  tags: string[];
}

export interface Sprint {
  id: string;
  number: number;
  starts_on: string;
  ends_on: string;
  state: SprintState;
  started_at: string | null;
  closed_at: string | null;
  capacity: { people?: PersonCap[]; agents?: { agent: string; tasks: number }[]; days?: number } | null;
  capacity_total: number | null;
  stats: Stats | null;
  summary: string | null;
  summary_path: string | null;
  summary_draft: { picked?: string[]; how?: string } | null;
  summary_edited: boolean | null;
  sample: boolean | null;
}

export interface Item {
  id: string;
  sprint_id: string;
  task_id: string;
  in_at_start: boolean | null;
  added_at: string | null;
  added_by: string | null;
  removed_at: string | null;
  removed_by: string | null;
  outcome: Outcome;
  carried_from: string | null;
  nth: number | null;
  points_at_add: number | null;
  started_at: string | null;
  done_at: string | null;
  closed_assignee: string | null;
  closed_points: number | null;
}

export interface SprintEvent {
  id: string;
  sprint_id: string;
  task_id: string;
  kind: "added" | "removed" | "started" | "done" | "reopened" | "estimated" | "assigned" | "status";
  at: string;
  actor_kind: string | null;
  actor_name: string | null;
  detail: Record<string, unknown> | null;
  via: string;
}

export interface Away {
  id: string;
  member_id: string | null;
  name: string;
  day: string;
  part: "full" | "half";
}

export interface Suggestion {
  id: string;
  sprint_id: string;
  kind: "risk" | "pull_in" | "move_out" | "close";
  task_ids: string[];
  text: string | null;
  choice: string | null;
  reason: string | null;
  confidence: number | null;
  detail: Record<string, unknown> | null;
  state: "open" | "taken" | "dismissed";
  updated_at?: string;
}

export interface Task {
  id: string;
  number: number;
  title: string;
  status: "todo" | "in_progress" | "waiting" | "done" | "canceled";
  priority: "none" | "low" | "medium" | "high" | "urgent";
  source: string;
  source_id: string | null;
  source_url: string | null;
  assignee_kind: "none" | "person" | "agent";
  assignee_user_id: string | null;
  assignee_name: string | null;
  assignee_agent: string | null;
  project_id: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

export interface Member {
  user_id: string;
  name: string;
  email: string;
}

export const ASSISTANT = "pod_default";
