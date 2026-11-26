// The rows the screens read: the contract's `form` and `form_answer`, Forms'
// own tables, and the person's own drafts and mailboxes (Mail's, per person).

export type Kind = "lead" | "support" | "bug" | "feedback" | "beta" | "application" | "spam";
export type AnswerState = "new" | "unsure" | "routed" | "drafted" | "replied" | "filed" | "set_aside";
export type FormState = "on" | "paused" | "off" | "broken" | "soon";
export type ReplyMode = "chat_only" | "draft" | "lemma_address";

export interface FormField { key: string; label: string; type?: string; order?: number; on?: boolean }

export interface Form {
  id: string;
  name: string;
  source: string;
  source_account: string | null;
  source_id: string;
  place: string | null;
  share: { ways?: string[]; url?: string | null } | null;
  owner_plugin: string;
  purpose: Exclude<Kind, "spam"> | null;
  default_owner_user_id: string | null;
  reply_mode: ReplyMode;
  audience: "anyone" | "contacts" | null;
  state: FormState;
  state_why: string | null;
  held_by_user_id: string | null;
  fields: FormField[];
  cursor: string | null;
  last_read_at: string | null;
  last_answer_at: string | null;
  week: { day: string; n: number }[];
  sample: boolean;
  created_at?: string;
}

export interface AnswerField { label: string; key?: string; value: unknown; type?: string }
export interface RuleChecked { rule: string; result: "used" | "not_needed" | "none_set"; said?: string; deal?: string; deal_id?: string }

export interface Answer {
  id: string;
  form_id: string;
  source: string;
  source_id: string;
  received_at: string | null;
  created_at?: string;
  handle_kind: string | null;
  handle: string | null;
  name: string | null;
  company_name: string | null;
  company_id: string | null;
  contact_id: string | null;
  row_author: string | null;
  fields: AnswerField[];
  message: string | null;
  files: string[];
  document_path: string | null;
  came_from: Record<string, string>;
  kind: Kind | null;
  kind_sure: number | null;
  kind_why: string | null;
  kind_by: "lemma" | "person" | null;
  routed_to: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_why: string | null;
  owner_rule: string | null;
  rules_checked: RuleChecked[];
  state: AnswerState;
  hand_version: number;
  draft_state: "none" | "wanted" | "writing" | "ready" | "failed" | "no_mailbox" | null;
  draft_id: string | null;
  taken_at: string | null;
  set_aside_why: string | null;
  set_aside_by: string | null;
  work_source: string | null;
  work_id: string | null;
  work_label: string | null;
  first_reply_at: string | null;
  replied_by: string | null;
  reply_via: string | null;
  sample: boolean;
}

export interface FEvent { id: string; answer_id: string; at: string; kind: string; actor: string | null; actor_name: string | null; text: string | null }

export interface Rule {
  id: string;
  position: number;
  form_id: string | null;
  kind: Exclude<Kind, "spam"> | null;
  describes: string | null;
  to_kind: "member" | "turns" | "plugin";
  members: string[];
  next_turn: number;
  plugin: string | null;
  reason: string | null;
  enabled: boolean;
  sample: boolean;
}

export interface MemberEntry { user_id: string; name: string; schedules?: Record<string, string>; at?: string }

export interface Settings {
  id: string;
  steward_user_id: string | null;
  members: MemberEntry[];
  plugins: Record<string, boolean>;
  goal_minutes: number;
  unsure_after_minutes: number;
  widget_id: string | null;
  widget_key: string | null;
  schedules: Record<string, string>;
  doors_wanted: string[];
  setup_done_at: string | null;
  quiet: boolean;
  sample: boolean;
}

export interface Draft {
  id: string;
  conversation_id: string | null;
  source: string;
  source_account: string;
  kind: string;
  to_handles: string[];
  subject: string | null;
  body: string;
  state: "proposed" | "approved" | "sending" | "sent" | "discarded" | "failed";
  rationale: string | null;
  send_at: string | null;
  sent_at: string | null;
  error: string | null;
}

export interface Mailbox { id: string; provider: string; account_id: string; email: string; owner_name: string | null; state: string }
export interface Away { id: string; member_id: string | null; name: string; day: string; part: string }
export interface Member { user_id: string; name: string; email: string }
