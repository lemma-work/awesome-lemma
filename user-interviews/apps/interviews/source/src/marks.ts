// How a person in a study is said: their segment, where they stand in words,
// and the dates the contact rules give. One place, so the table, the call page
// and the side panel say it the same way.

import { day, plural, when, type Tone } from "@lemma-plugins/kit";
import type { Segment } from "./route";
import type { Feature, Importance, Kind, Person, Settings, Study } from "./types";

const DAY = 86_400_000;

export function isResting(p: Person, now = Date.now()): boolean {
  if (p.stage === "no_show" || p.stage === "opted_out") return true;
  if (p.stage !== "fits" && p.stage !== "drafted") return false;
  const until = p.rests_until ? Date.parse(p.rests_until) : 0;
  return until > now;
}

export function segmentOf(p: Person, now = Date.now()): Segment | "other" {
  if (isResting(p, now)) return "resting";
  if (p.stage === "fits" || p.stage === "drafted") return "invite";
  if (p.stage === "invited") return "invited";
  if (p.stage === "booked") return "booked";
  if (p.stage === "done") return "done";
  return "other";
}

export function forever(value: string | null | undefined): boolean {
  // The functions write 2100-01-01 for "never"; anything that far out reads as never.
  return !!value && Date.parse(value) > Date.parse("2090-01-01T00:00:00Z");
}

export function noShowUntil(p: Person, s: Settings | null): string | null {
  if (!p.no_show_at) return null;
  return new Date(Date.parse(p.no_show_at) + (s?.no_show_days || 90) * DAY).toISOString();
}

export function toReview(p: Person): number {
  return Math.max(0, p.found - p.kept - p.set_aside);
}

export function callTime(p: Person): string {
  if (!p.call_at) return "";
  const start = when(p.call_at);
  if (!p.call_end_at) return start;
  const end = new Date(p.call_end_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${start}–${end}`;
}

export function upcoming(p: Person, now = Date.now()): boolean {
  return !!p.call_at && Date.parse(p.call_end_at || p.call_at) > now;
}

/** The pill and the line under it, for the table and the call page. */
export function standing(p: Person, s: Settings | null, me: string | undefined, now = Date.now()): { pill: string; tone: Tone; detail: string; note?: string } {
  if (p.stage === "no_show") {
    return { pill: "No-show", tone: "danger", detail: `Missed ${day(p.call_at || p.no_show_at)} · rests until ${day(noShowUntil(p, s))}` };
  }
  if (p.stage === "opted_out") return { pill: "Opted out", tone: "plain", detail: "Asked not to be invited again" };
  if (p.stage === "declined") return { pill: "Declined", tone: "plain", detail: "Said no to this study" };
  if (p.stage === "skipped") return { pill: "Left out", tone: "plain", detail: "Left out of this study" };
  if (isResting(p, now)) {
    const until = forever(p.rests_until) ? "never again" : `rests until ${day(p.rests_until)}`;
    return { pill: "Resting", tone: "plain", detail: `${p.rest_rule || "Contact rules"} · ${until}` };
  }
  if (p.stage === "fits" || p.stage === "drafted") {
    if (p.invite_state === "writing") return { pill: "To invite", tone: "plain", detail: "Writing the invite…" };
    if (p.invite_state === "failed") return { pill: "To invite", tone: "plain", detail: p.invite_error || "The invite wasn't written." };
    if (p.stage === "drafted") {
      return { pill: "To invite", tone: "plain", detail: p.inviter_user_id && p.inviter_user_id !== me ? "Invite drafted by a colleague" : "Invite drafted" };
    }
    return { pill: "To invite", tone: "plain", detail: p.override_at ? "Invited anyway: rule overridden" : "Not invited yet" };
  }
  if (p.stage === "invited") {
    const nudge = p.nudged_at ? " · nudge drafted in Mail" : " · no booking yet";
    return { pill: "Invited", tone: "warning", detail: `Sent ${day(p.invited_at)}${nudge}` };
  }
  if (p.stage === "booked") {
    const soon = upcoming(p, now);
    return {
      pill: "Booked", tone: "info", detail: soon ? callTime(p) : `Call ${day(p.call_at)} · nothing to read yet`,
      note: soon ? "Press Transcribe in Meet when the call starts" : undefined,
    };
  }
  // done
  const n = toReview(p);
  const read = p.read_state === "reading" || p.read_state === "waiting" ? " · reading the call…"
    : p.read_state === "failed" ? " · couldn't read it"
    : p.read_state === "none" ? " · no transcript or notes yet"
    : n ? ` · ${plural(n, "finding")} to review` : ` · ${plural(p.kept, "finding")} kept`;
  return { pill: "Done", tone: "success", detail: `Call ${day(p.call_at)}${read}` };
}

export function studyTone(s: Study): { text: string; tone: Tone } {
  if (s.state === "running") return { text: "Running", tone: "info" };
  if (s.state === "done") return { text: "Done", tone: "success" };
  if (s.state === "archived") return { text: "Archived", tone: "plain" };
  return { text: "Not started", tone: "plain" };
}

export const STAGE_LABEL: Record<Feature["stage"], string> = {
  idea: "Idea", planned: "Planned", building: "Building", beta: "Beta", live: "Live", declined: "Declined",
};

export function stageTone(stage: Feature["stage"] | null | undefined): Tone {
  return stage === "planned" || stage === "building" ? "info" : stage === "beta" ? "warning" : stage === "live" ? "success" : "plain";
}

export const KIND_LABEL: Record<Kind, string> = {
  request: "Request", problem: "Problem", praise: "Praise", question: "Question", comparison: "Comparison", other: "Other",
};
export const IMPORTANCE_LABEL: Record<Importance, string> = { unknown: "Unknown", nice: "Nice", important: "Important", blocker: "Blocker" };

export function mmss(secs: number | null | undefined): string {
  if (secs == null) return "";
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function docLabel(kind: Person["doc_kind"]): string {
  return kind === "notes" ? "Your notes" : kind === "pasted" ? "Pasted transcript" : "Meet transcript";
}
