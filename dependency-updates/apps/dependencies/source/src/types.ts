// Rows as the app reads them: Dependency updates' own tables (team-wide).

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type Bump = "patch" | "minor" | "major";
export type UpdateState =
  | "waiting" | "ready" | "needs_you" | "risky" | "in_batch" | "opened" | "merged"
  | "dropped" | "by_hand" | "ignored" | "superseded";
export type RepoStatus = "new" | "needs_confirm" | "ok" | "private_registry" | "cant_install" | "unsupported";

export interface PlatformNote { state: "yes" | "no" | "unknown"; note?: string | null; at?: string | null }

export interface Settings {
  id: string;
  owner_user_id: string | null;
  owner_name: string | null;
  weekday: Weekday;
  run_time: string;
  timezone: string;
  wait_days: number;
  wait_major_days: number;
  hold_install_scripts: boolean;
  alerts: "github" | "osv";
  platform: Record<string, PlatformNote>;
  setup_done_at: string | null;
  sample: boolean;
  schedule_ids: Record<string, string>;
  schedule_user_id: string | null;
}

export interface Repo {
  id: string;
  repo: string;
  github_repo_id: number | null;
  default_branch: string | null;
  managers: string[];
  install_cmd: string | null;
  test_cmd: string | null;
  build_cmd: string | null;
  status: RepoStatus;
  status_note: string | null;
  commands_confirmed_by: string | null;
  schedule_ids: Record<string, string>;
  last_run_at: string | null;
  last_run_note: string | null;
  active: boolean;
}

export interface Use { at: string; line?: string | null }

export interface Security {
  ghsa?: string | null;
  cve?: string | null;
  severity?: "low" | "moderate" | "high" | "critical" | string | null;
  summary?: string | null;
  source?: string | null;
  reach?: "yes" | "not_found" | "unknown" | null;
  reach_note?: string | null;
  reach_at?: string | null;
}

export interface Risk { install_script?: string | boolean | null; new_publisher?: boolean | null; age_hours?: number | null; note?: string | null; let_through_by?: string | null }

export interface Update {
  id: string;
  created_at: string;
  updated_at: string;
  repo: string;
  ecosystem: "npm" | "pypi" | "actions";
  manager: string | null;
  package: string;
  from_version: string | null;
  to_version: string;
  bump: Bump;
  released_at: string | null;
  downloads_week: number | null;
  state: UpdateState;
  why: string | null;
  lemma_read: string | null;
  changes: string[];
  uses: Use[];
  touches: number | null;
  read_from: string | null;
  tried: "none" | "passed" | "failed" | "fixed";
  tried_note: string | null;
  security: Security | null;
  risk: Risk | null;
  batch_id: string | null;
  pr_number: number | null;
  commit_sha: string | null;
  fix_sha: string | null;
  choice: string | null;
  decided_by: string | null;
  decided_at: string | null;
}

export interface Step { at: string; kind: string; text: string; ok: boolean }
export interface Commit { package?: string; update_id?: string; sha?: string; fix?: string | null }
export interface FileChange { path: string; additions?: number; deletions?: number; kind?: "manifest" | "lockfile" | "fix" | "workflow" | string; patch?: string | null }
export interface CheckRun { name: string; state: "running" | "passed" | "failed" | "skipped" | string }

export interface Batch {
  id: string;
  created_at: string;
  repo: string;
  kind: "batch" | "security" | "own";
  title: string | null;
  week_of: string | null;
  branch: string;
  base_branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  state: "preparing" | "open" | "merged" | "closed" | "failed";
  head_sha: string | null;
  checks: "running" | "passed" | "failed" | "none";
  check_runs: CheckRun[];
  review: "approved" | "changes" | "commented" | "none";
  review_notes: number;
  review_by: string | null;
  review_text: string | null;
  steps: Step[];
  commits: Commit[];
  files: FileChange[];
  conversation_id: string | null;
  opened_at: string | null;
  merged_at: string | null;
  merged_by: string | null;
}

export interface Ignore { id: string; created_at: string; repo: string | null; package: string; version_range: string; reason: string | null; by_kind: "person" | "rule"; by_name: string | null }
export interface Rule { id: string; created_at: string; text: string; by_name: string | null; active: boolean }
