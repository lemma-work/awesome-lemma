// The rows this app reads, as pr-review/tables and _contract/tables define
// them. `repository` and `pull_request` are the shared contract tables (facts
// about GitHub, written only by PR review); the rest are PR review's own, all
// team-wide.

export type ReviewMode = "off" | "once" | "every_push";
export type MergeMode = "off" | "watch" | "merge";

export interface Repository {
  id: string;
  full_name: string;
  default_branch: string | null;
  html_url?: string | null;
  review_mode: ReviewMode | null;
  merge_mode: MergeMode | null;
  allow_auto_merge: boolean | null;
  merge_queue?: boolean | null;
  /** The check branch protection requires by name (the Lemma check, or null). */
  required_check: string | null;
  required_approvals?: number | null;
  checked_at?: string | null;
  source?: string | null;
  source_id?: string | null;
}

export type Verdict = "clean" | "changes" | "needs_person";
export type MergeState = "would_merge" | "merging" | "held" | "merged_by_itself";

export interface PullRequest {
  id: string;
  key: string; // owner/repo#n
  repository_id: string | null;
  repo: string;
  number: number;
  title: string;
  url: string | null;
  author: string | null; // GitHub login
  author_user_id?: string | null;
  author_kind: "member" | "agent" | "bot" | "outside" | null;
  state: "open" | "closed" | "merged" | null;
  draft: boolean | null;
  head_sha: string | null;
  head_ref?: string | null;
  base_ref: string | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  labels?: unknown;
  risk: "low" | "medium" | "high" | null;
  /** A member's user id, `nobody`, or `author` (an author who is not a member). */
  waits_on: string | null;
  waits_on_name?: string | null;
  waits_for?: "review" | "merge" | "fix" | "round" | "nothing" | null;
  waits_since: string | null;
  review_state: "unreviewed" | "queued" | "reviewing" | "reviewed" | "failed" | "off" | null;
  reviewed_sha?: string | null;
  verdict: Verdict | null;
  summary: string | null;
  linked_issues: unknown;
  /** GitHub's checks on the head commit and whether it can merge, as last heard by PR review. */
  checks?: "passing" | "failing" | "running" | "none" | null;
  mergeable?: "yes" | "no" | "unknown" | null;
  merge_state: MergeState | null;
  merge_due_at?: string | null;
  opened_at?: string | null;
  merged_at: string | null;
  closed_at?: string | null;
  source: string | null;
  source_id: string | null;
  created_at?: string;
  updated_at?: string;
}

export type LedgerState = "passed" | "broken" | "not_checked";

export interface LedgerEntry {
  rule_id: string | null;
  text: string;
  state: LedgerState;
  note?: string | null;
  finding_ids?: string[];
}

export interface Hunk {
  path: string;
  start?: number | null;
  end?: number | null;
}

export interface KeyChange {
  title: string;
  why?: string | null;
  hunks?: Hunk[];
}

/** Lines nobody needs to read, by kind: counts and up to three examples, never the paths. */
export interface Mechanical {
  kind: string;
  files: number;
  lines?: number | null;
  examples?: string[];
}

export interface RiskReason {
  source: "path" | "size" | string;
  glob?: string | null;
  tier: "low" | "medium" | "high";
  reason: string;
  reviewer_user_id?: string | null;
}

export interface CrossPr {
  pr: string; // owner/repo#n
  kind: "same_number" | "same_files" | string;
  detail?: string | null;
  paths?: string[];
}

/** ok, off, needs_platform, no_permission or failed:<why>. */
export type PostState = string | null | undefined;

export interface RoundGithub {
  check?: PostState;
  check_run_id?: string | number | null;
  approval?: PostState;
  comment?: PostState;
  review?: PostState;
}

export interface Round {
  id: string;
  pull_request_id: string;
  key: string;
  sha: string;
  since_sha: string | null;
  seq: number;
  status: "queued" | "running" | "done" | "failed" | "superseded";
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  files: { path: string; status?: string; additions?: number; deletions?: number; previous?: string | null }[] | null;
  touched: Record<string, unknown> | null;
  summary: string | null;
  key_changes: KeyChange[] | null;
  mechanical: Mechanical[] | null;
  lines_to_read: Hunk[] | null;
  lines_total: number | null;
  lines_to_read_count: number | null;
  ledger: LedgerEntry[] | null;
  cross_pr: CrossPr[] | null;
  counts: { new?: number; kept?: number; fixed?: number; kept_dismissed?: number; dropped_untouched?: number; invalid?: number } | null;
  verdict: Verdict | null;
  risk: "low" | "medium" | "high" | null;
  risk_reasons: RiskReason[] | null;
  github: RoundGithub | null;
  conversation_id: string | null;
  error: string | null;
  created_at?: string;
}

export type Severity = "must_fix" | "should_fix" | "nit";
export type FindingState = "open" | "fixed" | "dismissed" | "wrong";

export interface Finding {
  id: string;
  fingerprint: string;
  pull_request_id: string;
  key?: string;
  rule_id: string | null;
  severity: Severity;
  path: string | null;
  line: number | null;
  end_line?: number | null;
  title: string;
  body: string | null;
  suggestion: string | null;
  state: FindingState;
  fixed_in: string | null;
  found_by?: "reviewer" | "code" | null;
  /** Round ids. */
  first_round: string | null;
  first_sha?: string | null;
  last_seen_round: string | null;
  last_seen_sha?: string | null;
  decided_by: string | null;
  decided_at?: string | null;
  decided_note?: string | null;
  task_id?: string | null;
  posted_round?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Quote {
  who?: string | null;
  where?: string | null;
  text: string;
}

export interface Rule {
  id: string;
  text: string;
  scope: string[] | null;
  repo: string | null;
  severity: Severity;
  state: "proposed" | "active" | "paused" | "retired";
  source_kind: "file" | "comments" | "typed" | null;
  source: string | null;
  quotes: Quote[] | null;
  checkable: boolean | null;
  not_checkable_why?: string | null;
  proposed_by?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  created_at?: string;
}

export interface Member {
  id: string;
  login: string;
  user_id: string | null;
  name: string | null;
  owns: string[] | null;
  reviews?: boolean | null;
}

export interface RiskPath {
  id: string;
  glob: string;
  repo: string | null;
  tier: "medium" | "high";
  reason: string | null;
  reviewer_user_id: string | null;
  reviewer_name: string | null;
  state: "proposed" | "active";
}

export type CommentsMode = "off" | "summary" | "review";
export type MergeHow = "auto" | "queue" | "squash";

export interface MergePolicy {
  paths?: string[];
  max_lines?: number;
  max_files?: number;
  wait_minutes?: number;
  how?: MergeHow;
  approve_first?: boolean;
  /** A repository with no checks at all may merge by itself. Off: nothing would have checked it. */
  allow_no_checks?: boolean;
  update_bots?: string[];
  update_branch_prefix?: string;
}

export interface Settings {
  id: string;
  posts_as: "bot" | "reviewer" | null;
  check_on: boolean | null;
  comments: CommentsMode | null;
  approve_when_clean: boolean | null;
  merge: MergePolicy | null;
  daily_cap: number | null;
  daily_merge_cap: number | null;
  paused: boolean | null;
  /** What the platform let the bot do when last tried: {app, checks, at}. */
  platform: { app?: string | null; checks?: string | null; at?: string | null } | null;
  schedules?: Record<string, string> | null;
  accept_file_rules?: boolean | null;
  setup_done_at: string | null;
  setup_by?: string | null;
  sample?: boolean | null;
}

export type MergeAction = "would_merge" | "merging" | "merged" | "held" | "unheld" | "refused" | "failed" | "person_merged";

export interface MergeLog {
  id: string;
  pull_request_id: string;
  key: string | null;
  sha: string | null;
  action: MergeAction;
  how: string | null;
  conditions: { name: string; ok: boolean; detail?: string | null }[] | null;
  by: string | null;
  at: string | null;
  note: string | null;
  created_at?: string;
}
