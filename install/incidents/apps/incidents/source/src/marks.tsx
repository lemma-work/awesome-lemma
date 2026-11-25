// Incidents' small marks: severity and status pills (always with a word),
// the Lemma's sparkles tag, the honest "not here yet" note, an event's source
// icon, and times said the same way everywhere.

import type { ReactNode } from "react";
import {
  Bot, CircleArrowUp, Code, GitBranch, GitMerge, Hash, Inbox, MessageSquare, Pin, Rocket, Sparkles, TriangleAlert, Users,
} from "lucide-react";
import { Avatar, Pill, cx, type Tone } from "@lemma-plugins/kit";
import { DEFAULT_SEVERITIES } from "./data";
import type { IncEvent, Incident, Settings } from "./types";

export const STATUS = ["declared", "investigating", "fixing", "monitoring", "resolved"] as const;
export const STATUS_WORDS: Record<string, string> = {
  declared: "Declared", investigating: "Investigating", fixing: "Fixing", monitoring: "Monitoring", resolved: "Resolved",
};

export function sevOf(settings: Settings | null, key: string | null | undefined) {
  const list = settings?.severities?.length ? settings.severities : DEFAULT_SEVERITIES;
  const i = list.findIndex((s) => s.key === key);
  const sev = list[i] || { key: key || "sev2", word: "", update_every_min: 30 };
  return { ...sev, rank: i < 0 ? 1 : i, label: `${sev.key.toUpperCase()}${sev.word ? ` · ${sev.word}` : ""}`, short: sev.key.toUpperCase() };
}

export function SevPill({ settings, sev, short }: { settings: Settings | null; sev: string; short?: boolean }) {
  const s = sevOf(settings, sev);
  const tone: Tone = s.rank <= 1 ? "danger" : "warning";
  return <Pill tone={tone}>{short ? s.short : s.label}</Pill>;
}

export function StatusPill({ status }: { status: string }) {
  const tone: Tone = status === "resolved" ? "success" : status === "monitoring" ? "plain" : "info";
  return <Pill tone={tone}>{STATUS_WORDS[status] || status}</Pill>;
}

/** The Lemma's own work: sparkles and the word. */
export function Ai({ children = "ai" }: { children?: ReactNode }) {
  return <span className="in-ai"><Sparkles aria-hidden="true" />{children}</span>;
}

/** Something the platform doesn't do yet, said plainly. */
export function Gap({ children, title }: { children: ReactNode; title?: string }) {
  return <span className="in-gap" title={title}>{children}</span>;
}

export function initials(name: string | null | undefined): string {
  const parts = String(name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A person's round initials, with the kit's avatar. */
export function Who({ name, size = 22 }: { name: string | null | undefined; size?: number }) {
  return <Avatar name={name} size={size} />;
}

export function eventIcon(e: Pick<IncEvent, "kind" | "source" | "starred" | "actor"> & { text?: string | null }) {
  if (e.starred) return Pin;
  if (e.kind === "deploy") return CircleArrowUp;
  if (e.kind === "change") return e.actor === "Lemma" ? Code : GitMerge;
  if (e.kind === "triage") return Inbox;
  if (e.kind === "declared") return TriangleAlert;
  if (e.kind === "lemma" || e.kind === "update") return /^Opened #[a-z]/.test(e.text || "") ? Hash : /^Opened #\d/.test(e.text || "") ? GitMerge : Sparkles;
  if (e.kind === "role") return Users;
  if (e.kind === "status" || e.kind === "severity") return TriangleAlert;
  if (e.source === "github") return GitBranch;
  if (e.actor === "Lemma") return Bot;
  return MessageSquare;
}

export function SourceIcon({ icon: Icon, className }: { icon: typeof Hash; className?: string }) {
  return <span className={cx("in-src", className)} aria-hidden="true"><Icon /></span>;
}

export { Code, GitMerge, Hash, Inbox, MessageSquare, Pin, Rocket };

/* ---------- times ---------- */

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function dayLabel(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return "today";
  const y = new Date(now - 86_400_000);
  if (d.toDateString() === y.toDateString()) return "yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function span(fromIso: string | null | undefined, toMs: number): string {
  if (!fromIso) return "";
  const mins = Math.max(0, Math.round((toMs - Date.parse(fromIso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

/** When an incident started, as its facts say: the first error, else when it was declared. */
export function startOf(inc: Incident): string {
  return inc.started_at || inc.declared_at;
}

export function num(n: number | null | undefined): string {
  return n == null ? "" : n.toLocaleString("en-US");
}

/** Text with file paths shown as code. */
export function WithCode({ text }: { text: string }) {
  const parts = text.split(/(\b[\w-]+(?:\/[\w.-]+)+\.\w+\b)/g);
  return <>{parts.map((p, i) => (i % 2 ? <code key={i} className="in-code">{p}</code> : p))}</>;
}
