// The app's working set: one read per table, kept fresh by the change stream
// (the kit's DataProvider) and re-read when the tab comes back. Every table
// is per person, so all of it is the signed-in person's own calendar.

import { useMemo, type ReactNode } from "react";
import { DataProvider, useData, type Loaders } from "@lemma-plugins/kit";
import type { Calendar, Decision, Meeting, PromiseRow, Settings } from "./types";

const MEETING_FIELDS =
  "m.id, m.source_account, m.source_id, m.series_id, m.title, m.start_at, m.end_at, m.attendees, m.organizer_handle, " +
  "m.agenda, m.join_url, m.location, m.status, m.outside, m.kind, m.wants_brief, m.headline, m.brief, m.brief_at, " +
  "m.document_path, m.summary, m.summarized_at, w.sorted_by, w.unsure, w.answers, w.reason, w.brief_state, " +
  "w.brief_due_at, w.brief_error, w.searched, w.built_from, w.notes_state, w.notes_from, w.notes_error, w.dropped";

const LOADERS: Loaders = {
  settings: { sql: "select * from meetings_settings order by created_at limit 1", tables: ["meetings_settings"] },
  calendars: { sql: "select * from meetings_calendar order by created_at limit 20", tables: ["meetings_calendar"] },
  meetings: {
    sql:
      `select ${MEETING_FIELDS} from meeting m join meetings_work w on w.id = m.id ` +
      "where m.start_at > now() - interval '40 days' and m.start_at < now() + interval '22 days' " +
      "order by m.start_at limit 800",
    tables: ["meeting", "meetings_work"],
  },
  decisions: {
    sql: "select * from meetings_decision where state = 'kept' order by created_at limit 500",
    tables: ["meetings_decision"],
  },
  promises: {
    sql: "select * from promise where source = 'meeting' and state <> 'dropped' order by due_at nulls last, created_at limit 500",
    tables: ["promise"],
  },
};

export function MeetingsProvider({ children }: { children: ReactNode }) {
  return <DataProvider loaders={LOADERS}>{children}</DataProvider>;
}

export interface MeetingsData {
  loaded: boolean;
  errors: Record<string, string | undefined>;
  reload: (name?: string) => Promise<void>;
  settings: Settings | null;
  calendars: Calendar[];
  meetings: Meeting[];
  decisions: Decision[];
  promises: PromiseRow[];
  sample: boolean;
}

export function useMeetings(): MeetingsData {
  const { data, loaded, errors, reload } = useData();
  return useMemo(() => {
    const settings = ((data.settings as Settings[] | undefined) || [])[0] || null;
    const calendars = (data.calendars as Calendar[] | undefined) || [];
    return {
      loaded,
      errors,
      reload,
      settings,
      calendars,
      meetings: ((data.meetings as Meeting[] | undefined) || []).map((m) => ({
        ...m,
        attendees: Array.isArray(m.attendees) ? m.attendees : [],
      })),
      decisions: (data.decisions as Decision[] | undefined) || [],
      promises: (data.promises as PromiseRow[] | undefined) || [],
      sample: calendars.some((c) => c.provider === "sample"),
    };
  }, [data, loaded, errors, reload]);
}
