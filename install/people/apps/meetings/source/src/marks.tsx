// Meetings' own small marks: what kind of meeting, where its brief and notes
// are, and who is on it. Everything else is the kit's.

import { Briefcase, CircleHelp, Coffee, Handshake, Landmark, UserRoundSearch, Users, type LucideIcon } from "lucide-react";
import { Avatar, Pill, Spinner, type Tone } from "@lemma-plugins/kit";
import type { Attendee, Kind, Meeting } from "./types";
import { at, relDay } from "./time";

export const KIND_LABEL: Record<Kind, string> = {
  customer: "Customer", investor: "Investor", candidate: "Candidate", partner: "Partner", internal: "Internal", other: "Other",
};
export const KIND_PLURAL: Record<Kind, string> = {
  customer: "Customers", investor: "Investors", candidate: "Candidates", partner: "Partners", internal: "Internal", other: "Anything else",
};
export const KIND_HINT: Record<Kind, string> = {
  customer: "Customers and prospects: sales, onboarding, renewals, support",
  investor: "Investors and the board: fundraising, updates, board meetings",
  candidate: "People you might hire: interviews",
  partner: "Partners, agencies, advisors and recruiters",
  internal: "Only your own team",
  other: "Personal, press and podcasts, events, pitches",
};
export const KIND_ICON: Record<Kind, LucideIcon> = {
  customer: Handshake, investor: Landmark, candidate: UserRoundSearch, partner: Briefcase, internal: Users, other: Coffee,
};

export function KindPill({ m }: { m: Pick<Meeting, "kind" | "unsure" | "outside"> }) {
  if (!m.kind) {
    return m.unsure ? <Pill tone="warning" icon={CircleHelp}>Not sure</Pill> : <Pill dot={false}>Sorting</Pill>;
  }
  return <Pill icon={KIND_ICON[m.kind]}>{KIND_LABEL[m.kind]}</Pill>;
}

export interface Status {
  label: string;
  tone: Tone;
  busy?: boolean;
  quiet?: boolean;
}

export const isOver = (m: Meeting, now = new Date()) => (at(m.end_at) || at(m.start_at) || now) <= now;

export function statusOf(m: Meeting, now = new Date()): Status {
  if (m.status === "cancelled") return { label: "Cancelled", tone: "plain", quiet: true };
  if (!isOver(m, now)) {
    if (m.unsure) return { label: "Not sure", tone: "warning" };
    if (m.wants_brief !== true) return { label: "No brief", tone: "plain", quiet: true };
    switch (m.brief_state) {
      case "ready":
        return { label: "Brief ready", tone: "success" };
      case "wanted":
      case "writing":
        return { label: "Writing brief", tone: "ai", busy: true };
      case "failed":
        return { label: "Brief failed", tone: "danger" };
      case "planned": {
        const due = at(m.brief_due_at);
        return { label: due ? `Brief ${relDay(due, now)}` : "Brief planned", tone: "plain", quiet: true };
      }
      default:
        return { label: "Brief to come", tone: "plain", quiet: true };
    }
  }
  switch (m.notes_state) {
    case "ready":
      return { label: "Written up", tone: "success" };
    case "wanted":
    case "reading":
      return { label: "Reading notes", tone: "ai", busy: true };
    case "waiting":
      return m.notes_from === "meet" || m.notes_error ? { label: "No transcript yet", tone: "plain" } : { label: "Add notes", tone: "info" };
    case "failed":
      return { label: "Couldn't read", tone: "danger" };
    default:
      return { label: m.wants_brief ? "Not written up" : "Done", tone: "plain", quiet: true };
  }
}

export function StatusPill({ s }: { s: Status }) {
  if (s.busy) {
    return (
      <span className="c-pill c-pill--ai mt-busy">
        <Spinner />
        {s.label}
      </span>
    );
  }
  return <Pill tone={s.tone} dot={!s.quiet}>{s.label}</Pill>;
}

export const others = (m: Pick<Meeting, "attendees">): Attendee[] => (m.attendees || []).filter((a) => !a.you);
export const outsiders = (m: Pick<Meeting, "attendees">): Attendee[] => (m.attendees || []).filter((a) => a.outside);

export function nameOf(a: Attendee): string {
  return a.name || a.handle.split("@")[0];
}

/** "Mira Okafor, Jonah Price" or "Sana Iqbal and 4 more": outside people first. */
export function peopleLine(m: Pick<Meeting, "attendees">, max = 2): string {
  const list = [...outsiders(m), ...others(m).filter((a) => !a.outside)];
  if (!list.length) return "Just you";
  const names = list.slice(0, max).map(nameOf);
  const more = list.length - names.length;
  return more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
}

export function Faces({ m, max = 3 }: { m: Pick<Meeting, "attendees">; max?: number }) {
  const list = [...outsiders(m), ...others(m).filter((a) => !a.outside)].slice(0, max);
  return (
    <span className="c-stack-av" aria-hidden="true">
      {list.map((a) => (
        <Avatar key={a.handle} name={a.name} email={a.handle} size={22} />
      ))}
    </span>
  );
}
