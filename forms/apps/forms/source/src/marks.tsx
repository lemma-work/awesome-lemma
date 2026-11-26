// Forms' small marks: the clock (the only colour, and only past the goal),
// kinds and states as pills that always say what they mean, doors as chips,
// the Lemma's sparkles tag, and the honest notes for what the platform
// can't do yet (orange) or what waits for the webhook address (blue).

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Avatar, Pill, ago, cx, type Tone } from "@lemma-plugins/kit";
import type { Answer, Form, Kind } from "./types";

export const KIND_WORDS: Record<Kind, string> = {
  lead: "Lead", support: "Support", bug: "Bug", feedback: "Feedback", beta: "Beta", application: "Application", spam: "Spam",
};
export const KINDS: Kind[] = ["lead", "support", "bug", "feedback", "beta", "application", "spam"];
export const SOURCE_WORDS: Record<string, string> = {
  web: "Website", google_forms: "Google Forms", meta_ads: "Meta", typeform: "Typeform", tally: "Tally", webflow: "Webflow",
  fillout: "Fillout", google_ads: "Google Ads", zapier: "Zapier", plugin: "Plugin",
};
export const ROUTED_WORDS: Record<string, string> = {
  deals: "Deal tracker", triage: "Triage", forms: "Forms", support_inbox: "Support inbox", early_access: "Early access",
  hiring: "Hiring", user_feedback: "User feedback",
};
/** What a kind would go to once its plugin exists. */
export const NOT_BUILT: Partial<Record<Kind, string>> = {
  support: "Support inbox isn't built yet", application: "Hiring isn't built yet", beta: "Early access isn't built yet",
  feedback: "User feedback isn't built yet",
};
export const STATE_WORDS: Record<Answer["state"], string> = {
  new: "Being read", unsure: "Not sure", routed: "Waiting for a reply", drafted: "Reply drafted", replied: "Replied",
  filed: "Filed", set_aside: "Set aside",
};
export const MODE_WORDS = { chat_only: "Only the chat beside the form", draft: "A reply drafted for the owner", lemma_address: "From the Lemma's address" };

export function statePill(a: Answer) {
  const tone: Tone = a.state === "unsure" ? "warning" : a.state === "drafted" ? "info" : a.state === "replied" || a.state === "filed" ? "success" : "plain";
  return <Pill tone={tone}>{STATE_WORDS[a.state] || a.state}</Pill>;
}

export function kindPill(a: Pick<Answer, "kind">, why?: boolean, whyText?: string | null) {
  if (!a.kind) return <Pill tone="warning">Not sure</Pill>;
  return <Pill tone={a.kind === "spam" ? "plain" : "plain"}>{KIND_WORDS[a.kind]}{why && whyText ? ` · ${whyText}` : ""}</Pill>;
}

export function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return <span className="fm-chip" title={title}>{children}</span>;
}

/** The Lemma's own work: sparkles and the word. */
export function Ai({ children = "ai" }: { children?: ReactNode }) {
  return <span className="fm-ai"><Sparkles aria-hidden="true" />{children}</span>;
}

/** Something the platform doesn't do yet, said plainly. */
export function Gap({ children }: { children: ReactNode }) {
  return <span className="fm-gap">{children}</span>;
}

/** Something that waits for the webhook address. */
export function Hook({ children = "Needs the webhook address" }: { children?: ReactNode }) {
  return <span className="fm-hook">{children}</span>;
}

export function Who({ name, size = 20, you }: { name: string | null | undefined; size?: number; you?: boolean }) {
  return <Avatar name={name || "?"} size={size} you={you} />;
}

export function NoOne({ size = 20 }: { size?: number }) {
  return <span className="fm-noone" style={{ width: size, height: size }} aria-hidden="true">–</span>;
}

export function mins(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
}

export function age(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
  return `${Math.floor(h / 24)}d`;
}

/** The clock on an answer: how long it has waited, coloured only past the goal. */
export function Clock({ a, now, goal }: { a: Answer; now: number; goal: number }) {
  const open = ["new", "unsure", "routed", "drafted"].includes(a.state);
  if (!open) {
    if (a.first_reply_at && a.received_at) {
      const m = Math.max(0, Math.round((Date.parse(a.first_reply_at) - Date.parse(a.received_at)) / 60_000));
      return <span className="fm-clock fm-clock--done" title="First reply">{age(m)}</span>;
    }
    return <span className="fm-clock fm-clock--done">–</span>;
  }
  const m = mins(a.received_at, now);
  const late = m > goal;
  return (
    <span className={cx("fm-clock", late && (m > goal * 4 ? "fm-clock--bad" : "fm-clock--late"))} title={late ? "Waited longer than the goal" : "Waiting"}>
      {age(m)}{late ? <span className="c-sr"> past the goal</span> : null}
    </span>
  );
}

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "10:36" today, "Monday", "3 days" otherwise. */
export function whenShort(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `Today ${hhmm(iso)}`;
  if (now - d.getTime() < 6 * 86_400_000) return `${d.toLocaleDateString([], { weekday: "long" })} ${hhmm(iso)}`;
  return ago(iso, now);
}

export function doorWord(f: Form | undefined): string {
  if (!f) return "A form";
  return f.name;
}

export function firstOf(name: string | null | undefined): string {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

/** A file path as a short name: "norrby-plan.pdf". */
export function fileName(path: string): string {
  return String(path).split("/").pop() || String(path);
}
