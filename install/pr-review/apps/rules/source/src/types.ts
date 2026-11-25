// The rows the Rules app reads (pr-review/tables). A rule's record is never
// stored: it is counted here from prr_finding and the rounds' ledgers.

export type Severity = "must_fix" | "should_fix" | "nit";
export type RuleState = "proposed" | "active" | "paused" | "retired";

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
  state: RuleState;
  source_kind: "file" | "comments" | "typed" | null;
  source: string | null;
  quotes: Quote[] | null;
  source_sha?: string | null;
  seen_at?: string | null;
  checkable: boolean | null;
  not_checkable_why?: string | null;
  proposed_by?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  sample?: boolean | null;
  created_at?: string;
  updated_at?: string;
}

export interface FindingLite {
  id: string;
  rule_id: string | null;
  state: "open" | "fixed" | "dismissed" | "wrong";
  created_at?: string;
}

export interface LedgerEntry {
  rule_id: string | null;
  text: string;
  state: "passed" | "broken" | "not_checked";
  note?: string | null;
}

export interface RoundLite {
  id: string;
  pull_request_id: string;
  status: string;
  ledger: LedgerEntry[] | string | null;
  created_at?: string;
}

export interface Repository {
  id: string;
  full_name: string;
  default_branch: string | null;
}
