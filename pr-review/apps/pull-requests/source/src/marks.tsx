// PR review's own small marks: the rules bar, the findings count, live checks,
// a verdict, a commit, and its two GitHub connections. Everything else is the kit's.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, CircleDashed, CircleMinus, X } from "lucide-react";
import { Connect, Pill, errorText, plural, useConnection, type Connection, type ConnectionSpec, type Tone } from "@lemma-plugins/kit";
import { GITHUB, GITHUB_PERSONAL, checksOf, needsGithub, summarize, type GhCheck } from "./github";
import type { Finding, LedgerEntry, PullRequest, Round, Severity } from "./types";

export const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "");

export function Sha({ sha }: { sha: string | null | undefined }) {
  return <span className="prr-mono">{short(sha)}</span>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="prr-mono">{children}</span>;
}

/* ---------- rules: passed, broken, not checked ---------- */

export function tally(ledger: LedgerEntry[] | null | undefined) {
  const list = ledger || [];
  return {
    passed: list.filter((x) => x.state === "passed").length,
    broken: list.filter((x) => x.state === "broken").length,
    notChecked: list.filter((x) => x.state === "not_checked").length,
    total: list.length,
  };
}

export function tallyText(t: ReturnType<typeof tally>): string {
  const parts = [`${t.passed} passed`];
  if (t.broken) parts.push(`${t.broken} broken`);
  if (t.notChecked) parts.push(`${t.notChecked} not checked`);
  return parts.join(" · ");
}

export function RulesBar({ round }: { round: Round | null }) {
  if (!round || round.status === "queued" || round.status === "running") {
    return <span className="prr-ledg"><span className="prr-bar" aria-hidden="true" /><span className="c-faint">Reading…</span></span>;
  }
  if (round.status === "failed") return <span className="prr-ledg"><span className="prr-bar" aria-hidden="true" /><span className="c-faint">Didn't finish</span></span>;
  const t = tally(round.ledger);
  if (!t.total) return <span className="prr-ledg"><span className="prr-bar" aria-hidden="true" /><span className="c-faint">No rules in scope</span></span>;
  const pct = (n: number) => `${Math.round((n / t.total) * 100)}%`;
  return (
    <span className="prr-ledg" title={tallyText(t)}>
      <span className="prr-bar" aria-hidden="true">
        <i style={{ width: pct(t.passed), background: "var(--c-success)" }} />
        <i style={{ width: pct(t.broken), background: "var(--c-danger)" }} />
        <i style={{ width: pct(t.notChecked), background: "var(--c-faint)" }} />
      </span>
      <span className="c-muted prr-ledg__t">{tallyText(t)}</span>
    </span>
  );
}

/* ---------- findings ---------- */

export const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  must_fix: { label: "Must fix", tone: "danger" },
  should_fix: { label: "Should fix", tone: "warning" },
  nit: { label: "Nit", tone: "plain" },
};

export function SeverityPill({ s }: { s: Severity }) {
  const v = SEVERITY[s] || SEVERITY.nit;
  return <Pill tone={v.tone}>{v.label}</Pill>;
}

export function FindingsPill({ pr, round, findings }: { pr: PullRequest; round: Round | null; findings: Finding[] }) {
  if (!round || round.status === "queued" || round.status === "running" || pr.review_state === "reviewing") return <Pill tone="info">Reading</Pill>;
  const open = findings.filter((f) => f.state === "open");
  const must = open.filter((f) => f.severity === "must_fix").length;
  const should = open.filter((f) => f.severity === "should_fix").length;
  const nits = open.filter((f) => f.severity === "nit").length;
  if (must) return <Pill tone="danger">{must + should} to fix</Pill>;
  if (should) return <Pill tone="warning">{should} to consider</Pill>;
  if (nits) return <Pill>{plural(nits, "nit")}</Pill>;
  return <Pill dot={false}>None</Pill>;
}

export function VerdictPill({ pr, round }: { pr: PullRequest; round: Round | null }) {
  if (pr.state === "merged" || pr.merged_at) return pr.merge_state === "merged_by_itself" ? <Pill dot={false}>By itself</Pill> : null;
  if (!round || round.status === "queued" || round.status === "running") return <Pill tone="info">Reviewing</Pill>;
  if (round.status === "failed") return <Pill tone="warning">Review didn't finish</Pill>;
  if (pr.verdict === "changes") return <Pill tone="danger">Changes needed</Pill>;
  if (pr.verdict === "needs_person") return <Pill tone="warning">Needs a person</Pill>;
  if (pr.verdict === "clean") return <Pill tone="success">Clean</Pill>;
  return null;
}

export function StatePill({ pr }: { pr: PullRequest }) {
  if (pr.state === "merged" || pr.merged_at) return <Pill tone="info">Merged</Pill>;
  if (pr.state === "closed") return <Pill>Closed</Pill>;
  if (pr.draft) return <Pill>Draft</Pill>;
  return <Pill tone="success">Open</Pill>;
}

/* ---------- GitHub checks, live, as the person ---------- */

// Whether the Lemma's GitHub answered, as the last call found out (the failure
// itself, or null). The inbox says so once, not on every row. `back` counts
// the times GitHub came back connected, so what failed reads again.
let missing: unknown = null;
let back = 0;
const listeners = new Set<() => void>();
const tell = () => {
  for (const l of [...listeners]) l();
};
function setMissing(v: unknown) {
  if (missing === v || (!missing && !v)) return;
  missing = v;
  tell();
}
/** GitHub is connected again: forget the failure and read once more. */
export function githubBack() {
  missing = null;
  back++;
  tell();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export function useGithubMissing(): unknown {
  return useSyncExternalStore(subscribe, () => missing, () => missing);
}
function useGithubBack(): number {
  return useSyncExternalStore(subscribe, () => back, () => back);
}

export function useChecks(repo: string | null, sha: string | null | undefined, on = true): { list: GhCheck[] | null; err: unknown } {
  const [state, setState] = useState<{ key: string; list: GhCheck[] | null; err: unknown }>({ key: "", list: null, err: null });
  const key = repo && sha ? `${repo}@${sha}` : "";
  const again = useGithubBack();
  useEffect(() => {
    if (!on || !repo || !sha) return;
    let alive = true;
    const { now, next } = checksOf(repo, sha);
    setState({ key, list: now ?? null, err: null });
    next
      .then((list) => {
        setMissing(null);
        if (alive) setState({ key, list, err: null });
      })
      .catch((err) => {
        if (needsGithub(err)) setMissing(err);
        if (alive) setState((s) => ({ key, list: s.key === key ? s.list : null, err }));
      });
    return () => {
      alive = false;
    };
  }, [repo, sha, key, on, again]);
  return state.key === key ? state : { list: null, err: null };
}

const LAST: Record<string, ReactNode> = {
  passing: <Pill tone="success">Passing</Pill>,
  failing: <Pill tone="danger">Failing</Pill>,
  running: <Pill tone="info">Running</Pill>,
  none: <Pill dot={false}>No checks</Pill>,
};

/** Live from GitHub as the person; when that can't be read, what PR review last heard. */
export function ChecksPill({ list, err, last }: { list: GhCheck[] | null; err: unknown; last?: string | null }) {
  if (err) {
    if (last && LAST[last]) return <span title="As PR review last heard from GitHub">{LAST[last]}</span>;
    return <span className="c-faint" title={needsGithub(err) ? errorText(err, "github") : "GitHub didn't answer"}>—</span>;
  }
  if (!list) return <span className="c-skel" style={{ display: "inline-block", width: 64, height: 18, borderRadius: 999 }} aria-label="Checks loading" />;
  const s = summarize(list);
  if (s.state === "none") return <Pill dot={false}>No checks</Pill>;
  if (s.state === "failing") return <Pill tone="danger">{s.failing.length} failing</Pill>;
  if (s.state === "running") return <Pill tone="info">Running</Pill>;
  return <Pill tone="success">Passing</Pill>;
}

/* ---------- GitHub, connected from here ---------- */

/** The Lemma's one shared GitHub: every read, and what its bot posts. */
export const SHARED_GITHUB: ConnectionSpec = {
  connector: "github",
  slug: GITHUB,
  mode: "shared",
  purpose: "One GitHub connection for this Lemma: it reads the pull requests and rule files in the repositories you pick, and is how the Lemma's bot posts what Settings allows.",
};

/** Each person's own GitHub: only what is done in their name. */
export const MY_GITHUB: ConnectionSpec = {
  connector: "github",
  slug: GITHUB_PERSONAL,
  mode: "per_member",
  purpose: "Your own GitHub, only for what you do in your name: a review you send back, an approval, a merge you press. Without it you still read everything and can send back as the Lemma's bot, but you can't approve or merge as yourself.",
};

/** Calls `fn` when a connection comes back ready after it wasn't (not when it
 *  simply reads ready the first time). */
function useBack(c: Connection, fn?: () => void) {
  const was = useRef(c.state.kind);
  useEffect(() => {
    const now = c.state.kind;
    if (now === "ready" && was.current !== "ready" && was.current !== "loading") fn?.();
    was.current = now;
  }, [c.state.kind]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The Lemma's GitHub for a page that reads through it: nothing while it is
 * connected (or still being checked), its next step when it isn't. A failed
 * read passed as `error` is checked again; once it is back, what failed reads
 * again.
 */
export function useSharedGithub(error: unknown, onBack?: () => void): Connection {
  const c = useConnection(SHARED_GITHUB);
  useBack(c, () => {
    githubBack();
    onBack?.();
  });
  useEffect(() => {
    if (error) c.report(error);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  return c;
}

export function SharedGithubStep({ c, className }: { c: Connection; className?: string }) {
  if (c.ready || c.state.kind === "loading") return null;
  return <Connect {...SHARED_GITHUB} connection={c} className={className} />;
}

/** The person's own GitHub as the next step, after something they pressed needed it. */
export function MyGithubStep({ error, onBack, className }: { error?: unknown; onBack?: () => void; className?: string }) {
  const c = useConnection(MY_GITHUB);
  useBack(c, onBack);
  return <Connect {...MY_GITHUB} connection={c} error={error} className={className} />;
}

/* ---------- a ledger line ---------- */

export function LedgerIcon({ state }: { state: LedgerEntry["state"] }) {
  if (state === "passed") return <Check size={14} className="prr-ok" aria-label="Passed" />;
  if (state === "broken") return <X size={14} className="prr-bad" aria-label="Broken" />;
  return <CircleMinus size={14} className="c-faint" aria-label="Not checked" />;
}

export function LedgerLine({ x, onRule }: { x: LedgerEntry; onRule?: () => void }) {
  const word = x.state === "passed" ? "Passed" : x.state === "broken" ? "Broken" : "Not checked";
  return (
    <div className="prr-lg">
      <LedgerIcon state={x.state} />
      <div style={{ minWidth: 0 }}>
        {onRule ? (
          <button type="button" className="prr-link prr-link--text" onClick={onRule}>
            {x.text}
          </button>
        ) : (
          <div>{x.text}</div>
        )}
        <div className="c-faint prr-meta">
          {word}
          {x.note ? `${x.state === "not_checked" ? ": " : " · "}${x.note}` : ""}
        </div>
      </div>
    </div>
  );
}

export function Reading() {
  return (
    <span className="c-row c-muted">
      <CircleDashed size={14} className="prr-spin-slow" aria-hidden="true" /> Reading
    </span>
  );
}
