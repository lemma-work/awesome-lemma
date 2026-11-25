// Triage's small marks: doors as chips with a word, reach as a figure with
// its unit, pills that always say what they mean, the Lemma's sparkles tag,
// and the honest note for what isn't possible yet.

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Avatar, Pill, ago, cx, type Tone } from "@lemma-plugins/kit";
import type { Door, Evidence, Item, Report } from "./types";

export const DOOR_WORDS: Record<string, string> = {
  app: "New report", assistant: "The Lemma", slack: "Slack", github: "GitHub", form: "Form", sentry: "Sentry",
  posthog: "PostHog", dependabot: "Dependabot", code_scanning: "Code scanning", secret_scanning: "Secret scanning",
};
const VIA_WORDS: Record<string, string> = { email: "Email", teams: "Teams", slack: "Slack", chat: "Chat", web: "Web" };

/** The chip a report shows: where it came in (the assistant's by where it heard it). */
export function doorWord(r: Pick<Report, "door" | "via">): string {
  if (r.door === "assistant" && r.via && VIA_WORDS[r.via]) return VIA_WORDS[r.via];
  return DOOR_WORDS[r.door] || r.door;
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="tr-chip">{children}</span>;
}

/** An item's doors, counted: "Sentry", "Form", "Slack ×3". */
export function doorChips(item: Item, reports: Report[]): string[] {
  const counts = new Map<string, number>();
  for (const r of reports) counts.set(doorWord(r), (counts.get(doorWord(r)) || 0) + 1);
  if (!counts.size) for (const d of item.doors) counts.set(DOOR_WORDS[d as Door] || d, 1);
  return [...counts.entries()].map(([w, c]) => (c > 1 ? `${w} ×${c}` : w));
}

export function num(n: number | null | undefined): string {
  return n == null ? "" : n.toLocaleString("en-US");
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The figure an item is ranked by, and its unit in words. */
export function reach(item: Item, reports: Report[] = []): { figure: string; unit: string; tone: "" | "bad" | "warn" } {
  const tone = item.state === "marked_down" ? "" : item.priority === "urgent" ? "bad" : item.priority === "high" ? "warn" : "";
  if (item.reach_unit === "people" && item.reach_people != null) {
    const unit = item.reach_people === 1 ? "person" : "people";
    const extra = item.reach_note || (item.reach_people === 1 && item.reach_events ? `${num(item.reach_events)} events` : "");
    return { figure: num(item.reach_people), unit: extra ? `${unit} · ${extra}` : unit, tone };
  }
  if (item.reach_unit === "repo" || item.kind === "security") {
    const sev = cap(String(item.security?.severity || "security"));
    const where = item.security?.scope === "development" ? "development only"
      : item.security?.reachable ? `reachable · ${item.repo || ""}`.replace(/ · $/, "")
        : [item.repo, item.security?.tool ? "main" : null].filter(Boolean).join(" · ") || "repository";
    return { figure: sev, unit: where, tone };
  }
  if (item.reach_asks) return { figure: num(item.reach_asks), unit: item.reach_asks === 1 ? "person" : "people asked", tone };
  return { figure: num(reports.length || 1), unit: reports.length === 1 ? "report" : "reports", tone };
}

export function Reach({ item, reports }: { item: Item; reports: Report[] }) {
  const r = reach(item, reports);
  return (
    <span className="tr-reach">
      <span className={cx("tr-reach__fig", r.tone && `tr-${r.tone}`)}>{r.figure}</span>
      <span className="tr-reach__unit">{r.unit}</span>
    </span>
  );
}

/** One line under a title: where in the code, and what it came after. */
export function metaLine(item: Item): string {
  if (item.security?.package) {
    return [item.security.package, item.security.patch ? `fix in ${item.security.patch}` : null].filter(Boolean).join(" · ");
  }
  if (item.security?.rule) return [item.paths[0], item.security.tool].filter(Boolean).join(" · ");
  const since = item.related.find((r) => r.ref?.startsWith("#"));
  return [item.paths[0], since ? `since ${since.ref}` : null].filter(Boolean).join(" · ");
}

const KIND_WORDS: Record<string, string> = { bug: "Bug", alert: "Alert", security: "Security", request: "Request" };
export const STATE_WORDS: Record<string, string> = {
  inbox: "Needs a decision", accepted: "Accepted", declined: "Declined", duplicate: "Duplicate", snoozed: "Snoozed",
  marked_down: "Marked down", done: "Done",
};

export function statePill(item: Item) {
  const tone: Tone = item.state === "inbox" ? "info" : item.state === "done" ? "success" : item.state === "accepted" ? "info" : "plain";
  return <Pill tone={tone}>{STATE_WORDS[item.state] || item.state}</Pill>;
}

/** The pills above an item's title, each with its word. */
export function itemPills(item: Item, looksLike: string | null, now: number): { text: string; tone: Tone }[] {
  const out: { text: string; tone: Tone }[] = [];
  const first = Date.parse(item.first_seen || item.created_at);
  if (item.state === "inbox" && first && now - first < 6 * 3_600_000 && item.kind !== "security") {
    out.push({ text: `New since ${new Date(first).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`, tone: "info" });
  }
  if (item.state === "marked_down") out.push({ text: "Marked down", tone: "plain" });
  if (item.state === "snoozed") out.push({ text: "Snoozed", tone: "plain" });
  if (item.escalating && item.state !== "marked_down") out.push({ text: "Escalating", tone: "danger" });
  if (item.regressed) out.push({ text: "Regressed", tone: "danger" });
  out.push({ text: KIND_WORDS[item.kind] || item.kind, tone: item.kind === "security" ? "danger" : "plain" });
  if (item.security) {
    if (item.security.scope === "development") out.push({ text: "Development dependency", tone: "plain" });
    else if (item.security.relationship || item.security.package) out.push({ text: "Runtime dependency", tone: "plain" });
    if (item.security.rule && item.security.tool) out.push({ text: "Default branch", tone: "plain" });
    if (item.security.patch && item.security.scope !== "development") out.push({ text: "Patch available", tone: "success" });
  }
  if (looksLike) out.push({ text: `Looks like ${looksLike}`, tone: "info" });
  return out;
}

export function EvidencePill({ state }: { state: Evidence["state"] }) {
  if (state === "checked") return <Pill tone="success">Checked</Pill>;
  if (state === "nothing_found") return <Pill>Nothing found</Pill>;
  return <Pill tone="warning">Not checked</Pill>;
}

/** The Lemma's own work: sparkles and the word. */
export function Ai({ children = "ai" }: { children?: ReactNode }) {
  return <span className="tr-ai"><Sparkles aria-hidden="true" />{children}</span>;
}

/** Something the platform doesn't do yet, said plainly. */
export function Gap({ children }: { children: ReactNode }) {
  return <span className="tr-gap">{children}</span>;
}

export function Who({ name, size = 20 }: { name: string | null | undefined; size?: number }) {
  return <Avatar name={name || "?"} size={size} />;
}

export function NoOne({ size = 20 }: { size?: number }) {
  return <span className="tr-noone" style={{ width: size, height: size }} aria-hidden="true">–</span>;
}

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** A time for a list: "09:41" today, "yesterday", "2 days". */
export function whenShort(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return hhmm(iso);
  return ago(iso, now);
}

export function age(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function minsAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return ago(iso, now) + " ago";
}
