// The members' side working set: one read per name, kept fresh by the
// Lemma's change stream (the kit's DataProvider). RLS scopes every per-person
// table to the signed-in person; booking_request is shared (it is open to
// visitors), so requests are read through the person's own settings' page.

import type { ReactNode } from "react";
import { DataProvider, useData, useRows, type Loaders } from "@lemma-plugins/kit";

export type Kind = "customer" | "investor" | "candidate" | "partner" | "internal" | "other";
export const KINDS: Kind[] = ["customer", "investor", "candidate", "partner", "internal", "other"];
export const KIND_LABEL: Record<Kind, string> = {
  customer: "Customer", investor: "Investor", candidate: "Candidate", partner: "Partner", internal: "Internal", other: "Other",
};

export interface Answer {
  value: unknown;
  confidence: number | null;
}

export interface Settings {
  id: string;
  page_id: string | null;
  display_name: string | null;
  timezone: string | null;
  calendars: string[] | null;
  event_calendar: string | null;
  days: number[] | null;
  day_starts: string | null;
  day_ends: string | null;
  minutes: number | null;
  buffer_minutes: number | null;
  notice_hours: number | null;
  days_ahead: number | null;
  max_per_day: number | null;
  video: "google_meet" | "teams" | "none" | null;
  mail_connector: "gmail" | "outlook" | "none" | null;
  mail_account_id: string | null;
  mail_address: string | null;
  page_url: string | null;
  proposal: { reasons?: Record<string, string>; counted?: Record<string, number> } | null;
  setup_step: "start" | "calendars" | "hours" | "page" | "video" | "done";
  setup_run_id: string | null;
  schedules: Record<string, string> | null;
  trigger: { id?: string; include_outside_rows?: boolean; when?: unknown; checked_at?: string; name?: string } | null;
}

export interface Page {
  id: string;
  handle: string;
  name: string;
  about: string | null;
  more: string | null;
  minutes: number;
  video: "google_meet" | "teams" | "none";
  timezone: string | null;
  notice_hours: number;
  state: "on" | "off";
  slots: string[] | null;
  slots_at: string | null;
  chat: boolean;
}

export interface Request {
  id: string;
  page_id: string;
  starts_at: string;
  ends_at: string | null;
  name: string;
  email: string;
  about: string;
  zone: string | null;
  state: "requested" | "confirmed" | "declined";
  reason: string | null;
  meeting_id: string | null;
  join_url: string | null;
  genuine: boolean | null;
  kind: Kind | null;
  unsure: boolean | null;
  answers: Record<string, Answer | string> | null;
  told: { to?: string; subject?: string; body?: string; sent?: boolean; why?: string; from?: string } | null;
  handled_at: string | null;
  created_at: string;
  sample: boolean | null;
  contact_id: string | null;
  headline: string | null;
  brief: string | null;
  meeting_kind: Kind | null;
  brief_state: string | null;
}

export interface Calendar {
  id: string;
  provider: "google" | "outlook" | "sample";
  account_id: string | null;
  email: string;
  state: string;
}

const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM booking_settings LIMIT 1", tables: ["booking_settings"] },
  page: {
    sql: "SELECT p.* FROM booking_page p JOIN booking_settings s ON s.page_id = p.id LIMIT 1",
    tables: ["booking_page", "booking_settings"],
  },
  requests: {
    sql:
      "SELECT r.*, m.headline, m.brief, m.kind AS meeting_kind, w.brief_state FROM booking_request r " +
      "JOIN booking_settings s ON s.page_id::text = r.page_id LEFT JOIN meeting m ON m.id = r.meeting_id " +
      "LEFT JOIN meetings_work w ON w.id = r.meeting_id ORDER BY r.starts_at LIMIT 500",
    tables: ["booking_request", "booking_settings", "meeting", "meetings_work"],
  },
  calendars: {
    sql: "SELECT id, provider, account_id, email, state FROM meetings_calendar WHERE state <> 'stopped' ORDER BY connected_at",
    tables: ["meetings_calendar"],
  },
  meetings: { sql: "SELECT setup_step, timezone, display_name FROM meetings_settings LIMIT 1", tables: ["meetings_settings"] },
};

export function BookingProvider({ children }: { children: ReactNode }) {
  return <DataProvider loaders={LOADERS}>{children}</DataProvider>;
}

export function useBooking() {
  const { loaded, errors, reload } = useData();
  const settings = useRows<Settings>("settings")[0] || null;
  const page = useRows<Page>("page")[0] || null;
  const requests = useRows<Request>("requests");
  const calendars = useRows<Calendar>("calendars");
  const meetings = useRows<{ setup_step: string; timezone: string | null; display_name: string | null }>("meetings")[0] || null;
  return { loaded, errors, reload, settings, page, requests, calendars, meetings };
}

export function answerOf(r: Request, key: string): Answer | null {
  const a = r.answers?.[key];
  return a && typeof a === "object" ? (a as Answer) : null;
}

export const PROVIDER_LABEL: Record<Calendar["provider"], string> = {
  google: "Google Calendar",
  outlook: "Outlook",
  sample: "Sample calendar",
};
