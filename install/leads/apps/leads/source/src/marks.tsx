// Lead research's own marks, small and on the kit's roles: the fit (five
// steps with its number, and "not sure" in words), where a lead is in line,
// and a fact with the page it came from.

import { ExternalLink } from "lucide-react";
import { Pill, cx, day, type Tone } from "@lemma-plugins/kit";
import type { Fact, Lead, State } from "./types";

export const KIND_LABEL: Record<string, string> = {
  customer: "Customer", investor: "Investor", partner: "Partner", candidate: "Candidate", vendor: "Vendor",
  colleague: "Colleague", other: "Other",
};

export function KindPill({ kind }: { kind: string | null }) {
  if (!kind) return null;
  return <Pill>{KIND_LABEL[kind] || kind}</Pill>;
}

const FIT_WORD: Record<number, string> = { 1: "Not a fit", 2: "Weak fit", 3: "Partly fits", 4: "Good fit", 5: "Strong fit" };

/** Five steps, the number, and a word: never colour alone. */
export function FitMark({ fit, sure, compact }: { fit: number | null; sure: boolean | null; compact?: boolean }) {
  if (fit == null) return <span className="c-faint ld-fit-none">{compact ? "—" : "Not scored"}</span>;
  return (
    <span className={cx("ld-fit", !sure && "ld-fit--unsure", fit >= 4 && "ld-fit--good")} title={`${FIT_WORD[fit]}, ${fit} of 5${sure ? "" : " (not sure)"}`}>
      <span className="ld-fit__steps" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= fit ? "on" : ""} />)}
      </span>
      <span className="ld-fit__n num">{fit}</span>
      {compact ? (!sure ? <span className="ld-fit__word">not sure</span> : null) : <span className="ld-fit__word">{FIT_WORD[fit]}{sure ? "" : ", not sure"}</span>}
    </span>
  );
}

const STATE: Record<State, { label: string; tone: Tone }> = {
  skipped: { label: "Skipped", tone: "plain" },
  unsure: { label: "Not sure", tone: "warning" },
  proposed: { label: "To look up", tone: "info" },
  queued: { label: "In line", tone: "info" },
  wanted: { label: "Starting", tone: "ai" },
  looking: { label: "Looking up", tone: "ai" },
  ready: { label: "Looked up", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export function StatePill({ lead }: { lead: Pick<Lead, "state" | "found"> }) {
  if (lead.state === "ready" && lead.found === false) return <Pill>Not found</Pill>;
  const s = STATE[lead.state] || STATE.queued;
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function host(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return url;
  }
}

/** The page a fact came from, and when it was found. */
export function Source({ fact }: { fact: Pick<Fact, "url" | "source" | "found_at"> }) {
  return (
    <span className="ld-source">
      <a href={fact.url} target="_blank" rel="noreferrer" title={fact.url}>
        {fact.source || host(fact.url)}
        <ExternalLink size={11} aria-hidden="true" />
      </a>
      {fact.found_at ? <span className="c-faint"> · found {day(fact.found_at)}</span> : null}
    </span>
  );
}

/** One confirmed fact: what it is, what the page says, and the page. */
export function FactRow({ fact, value }: { fact: Fact; value?: React.ReactNode }) {
  return (
    <div className="ld-fact">
      <dt>{fact.label}</dt>
      <dd>
        <div className="ld-fact__value">{value ?? fact.value}</div>
        <Source fact={fact} />
      </dd>
    </div>
  );
}

const NOT_FOUND_LABEL: Record<string, string> = {
  role: "their role", location: "where they're based", profile: "a public profile", background: "their background",
  what_they_do: "what the company does", size: "its size", head_office: "its head office", founded: "when it was founded",
  funding: "its funding", customers: "its customers", news: "recent news", company: "the company",
};

export function notFoundText(keys: string[] | null | undefined): string | null {
  const words = [...new Set((keys || []).map((k) => NOT_FOUND_LABEL[k]).filter(Boolean))];
  if (!words.length) return null;
  return "Not found: " + (words.length === 1 ? words[0] : words.slice(0, -1).join(", ") + " and " + words[words.length - 1]) + ".";
}

export function companySize(facts: Fact[] | null | undefined): string | null {
  return (facts || []).find((f) => f.key === "size")?.value || null;
}
