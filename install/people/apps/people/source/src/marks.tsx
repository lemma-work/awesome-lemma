// People map's own marks, kept small: what someone is to you (an icon and a
// word), warmth (a pill with its word and their usual gap), the last contact
// with its direction. Everything else is the kit's.

import {
  ArrowDownLeft, ArrowUpRight, Briefcase, CalendarDays, CircleHelp, Coffee, Handshake, Landmark, Truck, UserSearch, Users,
  type LucideIcon,
} from "lucide-react";
import { Pill, Rel, agoText, type Tone } from "@lemma-plugins/kit";
import type { Kind, Person, Warmth } from "./types";

export const KIND_LABEL: Record<Kind, string> = {
  customer: "Customer", investor: "Investor", partner: "Partner", candidate: "Candidate", vendor: "Vendor",
  colleague: "Colleague", other: "Other",
};
export const KIND_HINT: Record<Kind, string> = {
  customer: "Buys from you, might buy, or is being onboarded",
  investor: "Investor, fund, angel or board member",
  partner: "Works with you: partner, agency, advisor, introducer",
  candidate: "Someone you might hire",
  vendor: "Sells to you or provides a service you pay for",
  colleague: "On your own team",
  other: "Anyone else: friends, press, events",
};
export const KIND_ICON: Record<Kind, LucideIcon> = {
  customer: Handshake, investor: Landmark, partner: Briefcase, candidate: UserSearch, vendor: Truck, colleague: Users, other: Coffee,
};

export function KindPill({ kind, unsure }: { kind: Kind | null; unsure?: boolean | null }) {
  if (!kind) return unsure ? <Pill tone="warning" icon={CircleHelp}>Not sure</Pill> : <span className="c-faint">—</span>;
  const Icon = KIND_ICON[kind];
  return <Pill icon={Icon}>{KIND_LABEL[kind]}</Pill>;
}

export const WARMTH: Record<Warmth, { label: string; tone: Tone }> = {
  warm: { label: "Warm", tone: "success" },
  cooling: { label: "Cooling", tone: "warning" },
  cold: { label: "Cold", tone: "danger" },
  new: { label: "New", tone: "info" },
};

export function gapText(days: number | null | undefined): string {
  if (!days) return "";
  const d = Math.max(1, Math.round(days));
  if (d < 14) return `every ${d} day${d === 1 ? "" : "s"}`;
  if (d < 60) return `every ${Math.round(d / 7)} wk`;
  return `every ${Math.round(d / 30)} mo`;
}

export function WarmthPill({ warmth, gap, long }: { warmth: Warmth | null; gap?: number | null; long?: boolean }) {
  if (!warmth) return <span className="c-faint">—</span>;
  const w = WARMTH[warmth];
  const g = gapText(gap);
  return (
    <Pill tone={w.tone} title={g ? `You're usually in touch ${g}` : "Not enough history for a usual gap yet; counted as two weeks"}>
      {w.label}
      {long && g ? ` · usually ${g}` : ""}
    </Pill>
  );
}

const DIR: Record<string, { icon: LucideIcon; words: string }> = {
  inbound: { icon: ArrowDownLeft, words: "They wrote last" },
  outbound: { icon: ArrowUpRight, words: "You wrote last" },
  meeting: { icon: CalendarDays, words: "You met" },
};

export function LastContact({ at, dir }: { at: string | null; dir: string | null }) {
  if (!at) return <span className="c-faint">—</span>;
  const d = DIR[dir || ""] || DIR.inbound;
  return (
    <span className="c-row pm-last" title={`${d.words} ${agoText(at)}`}>
      <d.icon size={13} aria-label={d.words} />
      <Rel at={at} />
    </span>
  );
}

export function lastWords(p: Pick<Person, "last_contact_dir" | "last_contact_at">, first: string): string {
  if (!p.last_contact_at) return "No contact yet";
  const who = p.last_contact_dir === "outbound" ? "You wrote" : p.last_contact_dir === "meeting" ? "You met" : `${first} wrote`;
  return `${who} ${agoText(p.last_contact_at)}`;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
