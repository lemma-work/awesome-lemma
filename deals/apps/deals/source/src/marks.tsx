// Deal tracker's own small marks, on the kit: the stage meter (rising bars,
// one per open stage, filled to where the deal is; won fills them all, lost
// empties them), a stage pill with its word, and how a change reads.

import { CircleCheck, CircleX } from "lucide-react";
import { day, money } from "@lemma-plugins/kit";
import type { Change, Deal, Stage } from "./types";

export function StageMeter({ stages, stage, size = "sm" }: { stages: Stage[]; stage: string; size?: "sm" | "md" }) {
  const open = stages.filter((s) => s.kind === "open");
  const here = stages.find((s) => s.name === stage);
  const at = here?.kind === "won" ? open.length : here?.kind === "lost" ? 0 : open.findIndex((s) => s.name === stage) + 1;
  return (
    <span className={`dt-meter dt-meter--${size}${here?.kind === "won" ? " is-won" : here?.kind === "lost" ? " is-lost" : ""}`} aria-hidden="true">
      {open.map((s, i) => (
        <span key={s.id} className={i < at ? "is-on" : ""} style={{ height: `${40 + (60 * (i + 1)) / Math.max(1, open.length)}%` }} />
      ))}
    </span>
  );
}

export function StagePill({ stages, stage }: { stages: Stage[]; stage: string }) {
  const here = stages.find((s) => s.name === stage);
  return (
    <span className={`dt-stage${here?.kind === "won" ? " is-won" : here?.kind === "lost" ? " is-lost" : ""}`} title={here?.meaning || undefined}>
      {here?.kind === "won" ? <CircleCheck size={12} aria-hidden="true" /> : here?.kind === "lost" ? <CircleX size={12} aria-hidden="true" /> : <StageMeter stages={stages} stage={stage} />}
      {stage}
    </span>
  );
}

export function dealMoney(d: Pick<Deal, "amount" | "currency">, fallback: string): string {
  return d.amount != null ? money(Number(d.amount), d.currency || fallback) : "";
}

const KIND_WORD: Record<string, string> = {
  new_deal: "New deal", stage: "Stage", amount: "Amount", close_date: "Close date", next_step: "Next step", lost: "Lost",
};

export function kindWord(kind: string): string {
  return KIND_WORD[kind] || kind;
}

/** What a proposal would change, in a line: "Talking → Proposal", "€14,400", "30 Nov". */
export function changeLine(c: Change, currency: string): string {
  const v = c.value || {};
  const p = c.previous || {};
  const str = (x: unknown) => (x == null || x === "" ? "" : String(x));
  switch (c.kind) {
    case "new_deal": {
      const bits = [str(v.stage)];
      if (v.amount != null) bits.push(money(Number(v.amount), str(v.currency) || currency));
      if (v.close_date) bits.push(`closes ${day(str(v.close_date))}`);
      return bits.filter(Boolean).join(" · ");
    }
    case "stage":
      return `${str(p.stage) || "?"} → ${str(v.stage)}`;
    case "amount":
      return `${p.amount != null ? money(Number(p.amount), str(p.currency) || currency) + " → " : ""}${money(Number(v.amount), str(v.currency) || currency)}`;
    case "close_date":
      return `${p.close_date ? day(str(p.close_date)) + " → " : ""}${day(str(v.close_date))}`;
    case "next_step":
      return str(v.next_step);
    case "lost":
      return v.lost_reason ? `Lost: ${str(v.lost_reason)}` : `${str(p.stage) || "?"} → ${str(v.stage)}`;
    default:
      return "";
  }
}

const FIELD_WORD: Record<string, string> = {
  created: "Added", stage: "Moved", won: "Won", lost: "Lost", amount: "Amount", currency: "Currency", close_date: "Close date",
  next_step: "Next step", owner: "Owner", name: "Renamed", people: "People", company_name: "Company", company_domain: "Company",
  lost_reason: "Why lost",
};

export function fieldWord(field: string): string {
  return FIELD_WORD[field] || field;
}

/** A history value, said plainly. */
export function valueText(field: string, raw: unknown, currency: string): string {
  // History keeps a plain value as {v: value} (a JSON column takes no bare scalar).
  const value = raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 1 && "v" in (raw as object)
    ? (raw as { v: unknown }).v : raw;
  if (value == null || value === "") return "none";
  if (field === "amount") return money(Number(value), currency);
  if (field === "close_date") return day(String(value));
  if (field === "created" && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return [v.stage, v.amount != null ? money(Number(v.amount), currency) : null].filter(Boolean).join(", ");
  }
  if (field === "people" && Array.isArray(value)) return value.map((p) => (p as { name?: string; handle?: string }).name || (p as { handle?: string }).handle).join(", ");
  return String(value);
}

export function sourceWord(source: string | null | undefined): string {
  return source === "meeting" ? "a meeting" : source === "mail" ? "a conversation" : source ? `a ${source} conversation` : "a conversation";
}
