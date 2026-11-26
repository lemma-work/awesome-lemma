// Roadmap's own small marks, on the kit's pills: a stage, an importance, where
// something was said, money said per currency.

import { Mail, MessageSquare, Video, FileText, Github, Globe, StickyNote } from "lucide-react";
import { Pill } from "@lemma-plugins/kit";
import { IMPORTANCE_TONE, IMPORTANCE_WORD, STAGE_TONE, STAGE_WORD, moneySaid } from "./rank";
import type { Importance, Stage } from "./types";

export function StagePill({ stage }: { stage: Stage }) {
  return <Pill tone={STAGE_TONE[stage] || "plain"} dot>{STAGE_WORD[stage] || stage}</Pill>;
}

export function ImportancePill({ importance }: { importance: Importance }) {
  return <Pill tone={IMPORTANCE_TONE[importance] || "plain"} dot>{IMPORTANCE_WORD[importance] || importance}</Pill>;
}

const SOURCE: Record<string, { word: string; icon: typeof Mail }> = {
  mail: { word: "Mail", icon: Mail }, slack: { word: "Slack", icon: MessageSquare }, teams: { word: "Teams", icon: MessageSquare },
  meeting: { word: "Call", icon: Video }, interview: { word: "Interview", icon: Video }, form: { word: "Form", icon: FileText },
  survey: { word: "Survey", icon: FileText }, github: { word: "GitHub", icon: Github }, note: { word: "Note", icon: StickyNote },
  review: { word: "Review", icon: Globe }, web: { word: "Web", icon: Globe },
};

export function sourceWord(source: string | null | undefined): string {
  const s = String(source || "");
  return SOURCE[s]?.word || (s ? s.charAt(0).toUpperCase() + s.slice(1) : "Somewhere");
}

export function SourceIcon({ source }: { source: string | null | undefined }) {
  const Icon = SOURCE[String(source || "")]?.icon || Globe;
  return <Icon size={12} aria-hidden="true" className="rm-src" />;
}

/** "Nov 12", the way the mockups say a day. */
export function monthDay(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(String(value).length <= 10 ? `${value}T12:00:00Z` : String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function MoneyCell({ by, main }: { by: Record<string, number>; main: string }) {
  const said = moneySaid(by, main);
  return said ? <span>{said}</span> : <span className="c-faint">—</span>;
}
