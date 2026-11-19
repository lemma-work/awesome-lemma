/** A row of the shared `brand` table. */
export interface BrandRow {
    id: string;
    name: string;
    is_default: boolean;
    state: "new" | "reading" | "check" | "ready" | "archived";
    source: string;
    source_id?: string | null;
    site_url?: string | null;
    colors?: unknown | null;
    fonts?: unknown | null;
    tokens?: unknown | null;
    theme_css_path?: string | null;
    logo_path?: string | null;
    logos?: unknown | null;
    guide_path?: string | null;
    voice?: string | null;
    root_path?: string | null;
    synced_at?: string | null;
    checked_at?: string | null;
    checked_by?: string | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `company` table. */
export interface CompanyRow {
    id: string;
    name: string;
    domain?: string | null;
    name_from: "domain" | "looked_up" | "person";
    description?: string | null;
    industry?: string | null;
    size?: string | null;
    location?: string | null;
    website?: string | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `company_domain` table. */
export interface CompanyDomainRow {
    id: string;
    company_id: string;
    domain: string;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `conversation` table. */
export interface ConversationRow {
    id: string;
    source: string;
    source_account: string;
    source_id: string;
    place?: string | null;
    subject?: string | null;
    snippet?: string | null;
    participants?: string[] | null;
    counterpart_handle?: string | null;
    counterpart_name?: string | null;
    last_message_at?: string | null;
    last_inbound_at?: string | null;
    last_outbound_at?: string | null;
    last_direction?: "inbound" | "outbound" | null;
    message_count?: number | null;
    has_attachments?: boolean | null;
    kind: "people" | "broadcast";
    document_path?: string | null;
    state: "new" | "needs_reply" | "waiting" | "fyi" | "done";
    priority?: number | null;
    category?: string | null;
    ask?: string | null;
    sorted_at?: string | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `deal` table. */
export interface DealRow {
    id: string;
    name: string;
    company_id?: string | null;
    company_name?: string | null;
    company_domain?: string | null;
    people?: unknown | null;
    owner_user_id?: unknown | null;
    owner_name?: string | null;
    stage: string;
    status: "open" | "won" | "lost";
    amount?: number | null;
    currency?: string | null;
    close_date?: string | null;
    next_step?: string | null;
    closed_at?: string | null;
    lost_reason?: string | null;
    source: string;
    source_id?: string | null;
    last_activity_at?: string | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `draft` table. */
export interface DraftRow {
    id: string;
    conversation_id?: string | null;
    source: string;
    source_account: string;
    kind: "reply" | "follow_up" | "schedule" | "new";
    to_handles?: string[] | null;
    cc_handles?: string[] | null;
    subject?: string | null;
    body: string;
    original_body?: string | null;
    state: "proposed" | "approved" | "sending" | "sent" | "discarded" | "failed";
    rationale?: string | null;
    built_from?: string[] | null;
    send_at?: string | null;
    sent_at?: string | null;
    source_message_id?: string | null;
    error?: string | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `meeting` table. */
export interface MeetingRow {
    id: string;
    source: string;
    source_account: string;
    source_id: string;
    series_id?: string | null;
    title?: string | null;
    start_at: string;
    end_at?: string | null;
    attendees?: unknown | null;
    organizer_handle?: string | null;
    agenda?: string | null;
    join_url?: string | null;
    location?: string | null;
    status: "confirmed" | "tentative" | "cancelled";
    outside?: boolean | null;
    kind?: "customer" | "investor" | "candidate" | "partner" | "internal" | "other" | null;
    wants_brief?: boolean | null;
    headline?: string | null;
    brief?: string | null;
    brief_at?: string | null;
    document_path?: string | null;
    summary?: string | null;
    summarized_at?: string | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `message` table. */
export interface MessageRow {
    id: string;
    conversation_id: string;
    source: string;
    source_id: string;
    direction: "inbound" | "outbound";
    from_handle?: string | null;
    from_name?: string | null;
    to_handles?: string[] | null;
    cc_handles?: string[] | null;
    subject?: string | null;
    sent_at?: string | null;
    snippet?: string | null;
    has_attachments?: boolean | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `needs_you` table. */
export interface NeedsYouRow {
    id: string;
    verb: "answer" | "decide" | "attend" | "do" | "waiting" | "drifting";
    title: string;
    why?: string | null;
    quote?: string | null;
    person_name?: string | null;
    person_handle?: string | null;
    due_at?: string | null;
    ends_at?: string | null;
    since_at?: string | null;
    source_plugin: string;
    source_table: string;
    source_id: string;
    source_version?: string | null;
    conversation_id?: string | null;
    app?: string | null;
    path?: string | null;
    state: "open" | "done" | "snoozed" | "dismissed";
    snoozed_until?: string | null;
    closed_by?: "person" | "source" | null;
    weight?: number | null;
    prepared?: string | null;
    prepared_text?: string | null;
    request?: string | null;
    request_hint?: string | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `person` table. */
export interface PersonRow {
    id: string;
    name?: string | null;
    org?: string | null;
    title?: string | null;
    is_vip?: boolean | null;
    first_seen_at?: string | null;
    last_inbound_at?: string | null;
    last_outbound_at?: string | null;
    conversation_count?: number | null;
    inbound_count?: number | null;
    outbound_count?: number | null;
    cadence_days?: number | null;
    weight?: number | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `person_handle` table. */
export interface PersonHandleRow {
    id: string;
    person_id: string;
    kind: string;
    handle: string;
    display_name?: string | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `personal_task` table. */
export interface PersonalTaskRow {
    id: string;
    number?: unknown | null;
    title: string;
    description?: string | null;
    status: "todo" | "in_progress" | "waiting" | "done" | "canceled";
    priority: "none" | "low" | "medium" | "high" | "urgent";
    due_on?: string | null;
    project_id?: string | null;
    parent_id?: string | null;
    labels?: string[] | null;
    assignee_kind: "none" | "person" | "agent";
    assignee_user_id?: unknown | null;
    assignee_name?: string | null;
    assignee_agent?: string | null;
    owner_user_id?: unknown | null;
    owner_name?: string | null;
    source: string;
    source_id?: string | null;
    source_url?: string | null;
    quote?: string | null;
    done_at?: string | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `project` table. */
export interface ProjectRow {
    id: string;
    name: string;
    description?: string | null;
    state: "active" | "paused" | "done" | "canceled";
    lead_user_id?: unknown | null;
    lead_name?: string | null;
    target_on?: string | null;
    source: string;
    source_id?: string | null;
    source_url?: string | null;
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `promise` table. */
export interface PromiseRow {
    id: string;
    conversation_id?: string | null;
    source: string;
    source_id?: string | null;
    person_handle?: string | null;
    person_name?: string | null;
    direction: "i_owe" | "owed_to_me";
    text: string;
    quote?: string | null;
    due_at?: string | null;
    state: "open" | "done" | "dropped";
    created_at?: string;
    updated_at?: string;
}
/** A row of the shared `task` table. */
export interface TaskRow {
    id: string;
    number?: unknown | null;
    title: string;
    description?: string | null;
    status: "todo" | "in_progress" | "waiting" | "done" | "canceled";
    priority: "none" | "low" | "medium" | "high" | "urgent";
    due_on?: string | null;
    project_id?: string | null;
    parent_id?: string | null;
    labels?: string[] | null;
    assignee_kind: "none" | "person" | "agent";
    assignee_user_id?: unknown | null;
    assignee_name?: string | null;
    assignee_agent?: string | null;
    owner_user_id?: unknown | null;
    owner_name?: string | null;
    source: string;
    source_id?: string | null;
    source_url?: string | null;
    quote?: string | null;
    done_at?: string | null;
    created_at?: string;
    updated_at?: string;
}
