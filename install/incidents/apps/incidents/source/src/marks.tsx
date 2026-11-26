// Incidents' small marks: severity and status pills (always with a word),
// the Lemma's sparkles tag, the honest "not here yet" note, an event's source
// icon, and times said the same way everywhere. And the accounts Incidents
// works through: each one's Connect, in set-up and wherever one is missing.

import { useMemo, type ReactNode } from "react";
import {
  Bot, CircleArrowUp, Code, GitBranch, GitMerge, Hash, Inbox, MessageSquare, Pin, Rocket, Sparkles, TriangleAlert, Users,
} from "lucide-react";
import { Avatar, Connect, Pill, cx, useConnection, type ConnectionSpec, type Tone } from "@lemma-plugins/kit";
import { DEFAULT_SEVERITIES } from "./data";
import type { IncEvent, Incident, Settings } from "./types";

/** The connectors Incidents declares (all SHARED, all optional), and what each is for and what is lost without it. */
export const CONNECTORS = ["slack", "github", "sentry", "posthog", "resend"] as const;
export type ConnectorKey = (typeof CONNECTORS)[number];

const PURPOSE: Record<ConnectorKey, string> = {
  slack: "Opens each incident's channel, invites the people, pins a header the Lemma keeps current, reads the channel into the timeline, and posts the updates the lead sends. Without it, an incident has no channel and its timeline is kept here only.",
  github: "Merges, pushes, deploy runs and releases in the repositories you watch, for what changed before an incident; the Lemma reads the suspect pull requests. It never writes to GitHub. Without it, nothing shows what changed.",
  sentry: "Read for errors around an incident. Without it, errors are named as not checked.",
  posthog: "Read for who an incident reached. Without it, that is named as not checked.",
  resend: "Emails each update the lead sends to the list below, from the Lemma's own mailbox. Without it, updates go to Slack only.",
};

export function isConnector(key: string | null | undefined): key is ConnectorKey {
  return !!key && (CONNECTORS as readonly string[]).includes(key);
}

/** The Connect piece's spec for one of Incidents' connectors; Slack's slug is the one set-up reads through. */
export function connectSpec(key: ConnectorKey, settings: Settings | null | undefined): ConnectionSpec {
  return { connector: key, slug: key === "slack" ? settings?.slack_account || "slack" : key, mode: "shared", purpose: PURPOSE[key] };
}

/**
 * A connector's Connect only while it needs something done: nothing while it
 * is checked or when it is connected, unless a failed call says otherwise.
 */
export function NeedsConnect({ connector, settings, error, lead }: { connector: ConnectorKey; settings: Settings | null | undefined; error?: unknown; lead?: ReactNode }) {
  const spec = useMemo(() => connectSpec(connector, settings), [connector, settings]);
  const c = useConnection(spec);
  if (c.state.kind === "loading" || (c.ready && !error)) return null;
  return <Connect {...spec} connection={c} error={error} lead={lead} quiet primary={false} />;
}

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
