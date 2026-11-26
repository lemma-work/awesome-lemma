// Know-how's own small marks: a gap said in plain words, a page's state, where
// a question was asked, the source line, the Lemma's own work.

import type { ReactNode } from "react";
import { AlertTriangle, Globe, Lock, Mail, MessageSquare, MessagesSquare, Monitor, Sparkles, Users } from "lucide-react";
import { Pill } from "@lemma-plugins/kit";
import { WHERE, fmtDay, isLate, sourceLine, type Article, type Audience, type Outcome } from "./data";

/** A platform gap, said on screen: what the Lemma can't do yet. */
export function Gap({ children }: { children: ReactNode }) {
  return <span className="kh-gap"><AlertTriangle aria-hidden="true" />{children}</span>;
}

export function Ai({ children = "ai" }: { children?: ReactNode }) {
  return <Pill tone="ai" icon={Sparkles} dot={false}>{children}</Pill>;
}

export function StatePill({ a, now }: { a: Article; now: number }) {
  if (a.state === "draft") return <Pill tone="info">Draft</Pill>;
  if (a.state === "retired") return <Pill>Retired</Pill>;
  if (a.state === "may_disagree") return <Pill tone="warning">May disagree</Pill>;
  if (a.kind === "sheet") return <Pill>Made from a sheet</Pill>;
  if (isLate(a, now)) return <Pill tone="warning">Past check date</Pill>;
  return <Pill tone="success">Live</Pill>;
}

const OUTCOME: Record<Outcome, { label: string; tone: "plain" | "success" | "warning" | "danger" | "info" }> = {
  answered: { label: "Answered", tone: "success" }, late: { label: "Past check date", tone: "warning" },
  partly: { label: "Partly", tone: "warning" }, missed: { label: "Missed", tone: "danger" },
  passed_on: { label: "Passed on", tone: "info" }, wrong: { label: "Said wrong", tone: "danger" },
};

export function OutcomePill({ outcome }: { outcome: Outcome }) {
  const o = OUTCOME[outcome] || OUTCOME.missed;
  return <Pill tone={o.tone}>{o.label}</Pill>;
}

const WHERE_ICON = { teams: Users, slack: MessagesSquare, email: Mail, web: Globe, app: Monitor };

export function WhereChip({ where, place }: { where: string; place?: string | null }) {
  const Icon = WHERE_ICON[where as keyof typeof WHERE_ICON] || MessageSquare;
  return (
    <span className="kh-where" title={place ? `${WHERE[where] || where} · ${place}` : WHERE[where] || where}>
      <Icon aria-hidden="true" />{WHERE[where] || where}{place ? <span className="kh-where__place">{place}</span> : null}
    </span>
  );
}

export function AudienceMark({ audience }: { audience: Audience }) {
  if (audience === "restricted") return <span className="kh-aud"><Lock aria-hidden="true" />Restricted</span>;
  if (audience === "public") return <span className="kh-aud"><Globe aria-hidden="true" />Public</span>;
  if (audience === "customers") return <span className="kh-aud"><Mail aria-hidden="true" />Customers</span>;
  return <span className="kh-aud"><Users aria-hidden="true" />The team</span>;
}

/** The one line every answer carries. */
export function SourceLine({ a, now }: { a: Article; now: number }) {
  return (
    <p className="kh-source">
      {sourceLine(a)}
      {isLate(a, now) && a.kind !== "sheet" ? <span className="kh-source__late"> Past its check date (due {fmtDay(a.due_on)}).</span> : null}
    </p>
  );
}

/** A light Markdown page: the kit's Markdown, plus tables (sheet pages) and the Made-from note. */
export function Page({ text }: { text: string }) {
  const parts = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="kh-page c-md">
      {parts.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (!lines.length) return null;
        if (lines.every((l) => l.trim().startsWith("|"))) {
          const rows = lines.filter((l) => !/^\|\s*-+/.test(l.trim()) && !/^\|(-+\|)+$/.test(l.trim())).map((l) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|")));
          const [head, ...body] = rows;
          return (
            <div className="c-table-wrap kh-mdtable" key={i}>
              <table className="c-table"><thead><tr>{head.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
                <tbody>{body.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody></table>
            </div>
          );
        }
        if (lines[0].startsWith("> ")) return <p className="kh-made" key={i}>{inline(lines.map((l) => l.replace(/^>\s?/, "")).join(" "))}</p>;
        if (/^#\s/.test(lines[0]) && lines.length === 1) return null; // the title is drawn by the page head
        if (/^#{2,4}\s/.test(lines[0])) {
          return <div key={i}><h3>{lines[0].replace(/^#{1,4}\s/, "")}</h3>{lines.length > 1 ? body(lines.slice(1), i) : null}</div>;
        }
        return <div key={i}>{body(lines, i)}</div>;
      })}
    </div>
  );
}

function body(lines: string[], key: number) {
  if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) return <ul>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>)}</ul>;
  if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return <ol>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>)}</ol>;
  return <p key={key}>{inline(lines.join(" "))}</p>;
}

export function inline(s: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    if (m[1]) parts.push(<strong key={i++}>{m[1]}</strong>);
    else if (m[4]) parts.push(<code key={i++}>{m[4]}</code>);
    else parts.push(<em key={i++}>{m[2] || m[3]}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

/** Steps of a procedure from its page text (the page is the source of truth). */
export function stepsOf(text: string): { n: number; title: string; who: string | null; body: string }[] {
  const out: { n: number; title: string; who: string | null; body: string }[] = [];
  let cur: { n: number; title: string; who: string | null; body: string[] } | null = null;
  for (const line of text.replace(/^> Made from .*\n+/, "").split("\n")) {
    const m = /^###\s+(\d+)[.)]\s*(.+?)\s*$/.exec(line);
    if (m) {
      if (cur) out.push({ ...cur, body: cur.body.join("\n").trim() });
      cur = { n: out.length + 1, title: m[2], who: null, body: [] };
      continue;
    }
    if (!cur) continue;
    if (/^#{1,2}\s/.test(line)) {
      out.push({ ...cur, body: cur.body.join("\n").trim() });
      cur = null;
      continue;
    }
    const who = /^\s*Who:\s*(.+?)\s*$/.exec(line);
    if (who && cur.who == null && !cur.body.some((b) => b.trim())) {
      cur.who = who[1];
      continue;
    }
    cur.body.push(line);
  }
  if (cur) out.push({ ...cur, body: cur.body.join("\n").trim() });
  return out;
}
