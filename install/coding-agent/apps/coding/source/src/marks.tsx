// Coding agent's own marks: a session's status in words, where work came
// from, a change's size, an event's icon. Colour only through the kit's
// tones, and every pill has a word.

import {
  Check, CircleCheck, CircleStop, Cloud, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed,
  MessageCircleQuestion, MessageSquare, MessageSquareText, PenLine, Play, Reply, ShieldQuestion, Terminal, TriangleAlert, UserPlus, Wrench, X,
  type LucideIcon,
} from "lucide-react";
import { Pill, cx, type Tone } from "@lemma-plugins/kit";
import type { CodingEvent, EventKind, Session, Task } from "./types";

const SOURCE: Record<string, string> = {
  triage: "Triage", "pr-review": "PR review", github: "GitHub issue", tasks: "Tasks", "coding-agent": "Started here", chat: "Chat",
};

export function sourceWord(source: string | null | undefined): string {
  return SOURCE[String(source || "")] || (source ? source.charAt(0).toUpperCase() + source.slice(1) : "Started here");
}

/** Where a task came from, as a header says it: "From Triage", or "Started here". */
export function fromWords(source: string | null | undefined): string {
  return source === "coding-agent" || !source ? "Started here" : `From ${sourceWord(source)}`;
}

/** Paragraphs and bullets, with `code` and path:line links: what an agent wrote. */
export function Prose({ text, repo, sha, className }: { text: string; repo?: string | null; sha?: string | null; className?: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}><Inline text={l.replace(/^\s*[-*•]\s+/, "")} repo={repo} sha={sha} /></li>)}</ul>;
        }
        return <p key={i}><Inline text={lines.join(" ")} repo={repo} sha={sha} /></p>;
      })}
    </div>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx("cd-mono", className)}>{children}</span>;
}

export function Diff({ add, del }: { add?: number | null; del?: number | null }) {
  if (add == null && del == null) return null;
  return (
    <span className="cd-diff" aria-label={`${add || 0} lines added, ${del || 0} taken out`}>
      <span className="cd-add">+{add || 0}</span>
      <span className="cd-del">−{del || 0}</span>
    </span>
  );
}

let clock: number | null = null;
/** Now, as the screens count from it. In the "Try it" demo the sample is a
 *  moment in time (its newest event, a minute on), so "Working · 6m" stays 6
 *  minutes whenever the demo is opened. */
export function nowMs(): number {
  return clock ?? Date.now();
}
export function setDemoClock(ms: number | null): void {
  clock = ms;
}

export function minutesSince(at: string | null | undefined, now = nowMs()): string {
  const t = Date.parse(at || "");
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`;
}

export function statusOf(s: Session, meId?: string | null): { word: string; tone: Tone } {
  const pr = s.pr_number ? `#${s.pr_number} ` : "";
  switch (s.status) {
    case "starting": return { word: "Starting", tone: "info" };
    case "working": return { word: `Working · ${minutesSince(s.started_at || s.created_at)}`, tone: "info" };
    case "failed": return { word: "Failed", tone: "danger" };
    case "stopped": return { word: "Stopped", tone: "plain" };
    case "merged": return { word: `${pr}merged`.trim(), tone: "success" };
    case "done": return { word: "Done", tone: "success" };
    case "needs_you":
      switch (s.needs) {
        case "question": return { word: "Question", tone: "warning" };
        case "approval": return { word: "Needs approval", tone: "warning" };
        case "checks_failing": return { word: "Checks failing", tone: "danger" };
        case "review": return { word: "Review comments", tone: "warning" };
        case "conflict": return { word: "Conflict", tone: "danger" };
        case "waiting_mac": return { word: s.started_by && s.started_by === meId ? "Waiting for your Mac" : "Waiting for a Mac", tone: "plain" };
        case "failed": return { word: "Failed", tone: "danger" };
        default: return { word: "Needs you", tone: "warning" };
      }
    case "pr_open":
      if (s.mergeable === "conflict") return { word: `${pr}conflict`, tone: "danger" };
      if (s.checks === "failed") return { word: `${pr}checks failing`, tone: "danger" };
      if (s.checks === "running") return { word: `${pr}checks ${shortChecks(s.checks_text) || "running"}`, tone: "info" };
      if (s.checks === "passed") return { word: `${pr}ready`, tone: "success" };
      return { word: `${pr}open`, tone: "info" };
  }
  return { word: s.status, tone: "plain" };
}

/** "5 of 7 passed" -> "5/7". */
function shortChecks(text: string | null): string {
  const m = /(\d+)\s*(?:of|\/)\s*(\d+)/.exec(text || "");
  return m ? `${m[1]}/${m[2]}` : "";
}

export function SessionPill({ s, meId }: { s: Session; meId?: string | null }) {
  const { word, tone } = statusOf(s, meId);
  return <Pill tone={tone}>{word}</Pill>;
}

export function PriorityPill({ task }: { task: Task | null }) {
  if (!task) return null;
  if (task.source === "pr-review") return <Pill tone="info">Finding</Pill>;
  const p = task.priority;
  if (p === "urgent") return <Pill tone="danger">Urgent</Pill>;
  if (p === "high") return <Pill tone="warning">High</Pill>;
  if (p === "medium") return <Pill>Medium</Pill>;
  if (p === "low") return <Pill>Low</Pill>;
  return null;
}

const ICON: Record<EventKind, LucideIcon> = {
  assigned: UserPlus, started: Play, checked_out: GitBranch, setup: Terminal, progress: PenLine, question: MessageCircleQuestion,
  answered: Reply, approval: ShieldQuestion, pr_opened: GitPullRequest, pushed: GitCommitHorizontal, check_failed: X,
  checks_passed: Check, review_comment: MessageSquare, review: MessageSquareText, fixing: Wrench, conflict: GitMerge,
  merged: GitMerge, closed: GitPullRequestClosed, result: CircleCheck, stopped: CircleStop, failed: TriangleAlert, moved: Cloud,
};

const TONE: Partial<Record<EventKind, "ok" | "bad" | "info" | "warn">> = {
  check_failed: "bad", conflict: "bad", failed: "bad", checks_passed: "ok", merged: "ok", result: "ok",
  pr_opened: "info", progress: "info", fixing: "info", question: "warn", approval: "warn",
};

export function EventIcon({ e }: { e: Pick<CodingEvent, "kind"> }) {
  const Icon = ICON[e.kind] || PenLine;
  return (
    <span className={cx("cd-evi", TONE[e.kind] && `cd-evi--${TONE[e.kind]}`)} aria-hidden="true">
      <Icon size={13} />
    </span>
  );
}

const CITE = /((?:[\w.-]+\/)*[\w.-]+\.[a-z]{1,6}):(\d+)(?:[-–](\d+))?/i;

/** A line on GitHub, at the commit it was read at. */
export function blobUrl(repo: string, sha: string | null, path: string, line?: number | null, end?: number | null): string {
  return `https://github.com/${repo}/blob/${sha || "HEAD"}/${path}${line ? `#L${line}${end && end > line ? `-L${end}` : ""}` : ""}`;
}

/** `path:line` and `code` in a line of text, as the app shows them. */
export function Inline({ text, repo, sha }: { text: string; repo?: string | null; sha?: string | null }) {
  const parts: React.ReactNode[] = [];
  const re = /`([^`]+)`|((?:[\w.-]+\/)*[\w.-]+\.[a-z]{1,6}):(\d+)(?:[-–](\d+))?/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    // `path:line` in backticks is a citation too.
    const inner = m[1] != null ? CITE.exec(m[1]) : null;
    const c = m[1] == null ? [m[0], m[2], m[3], m[4]] : inner && inner[0] === m[1] ? [inner[0], inner[1], inner[2], inner[3]] : null;
    if (!c) parts.push(<code key={i++} className="cd-code">{m[1]}</code>);
    else {
      const href = repo ? blobUrl(repo, sha ?? null, c[1], Number(c[2]), c[3] ? Number(c[3]) : null) : null;
      parts.push(href ? <a key={i++} className="cd-cite" href={href} target="_blank" rel="noreferrer">{c[0]}</a> : <Mono key={i++}>{c[0]}</Mono>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
