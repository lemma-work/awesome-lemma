// One pull request (A2): its header, five tabs, and beside them what it
// changes, the rules it was checked against, what changed since the first
// round, and the merge box. The diff, the live checks and GitHub's own merge
// state are read from GitHub as the signed-in person; everything else is PR
// review's rows.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft, CircleAlert, ExternalLink, FileText, GitMerge, Hand, Sparkles, UserRound,
} from "lucide-react";
import {
  Avatar, Button, Card, Empty, Header, Menu, agoText, go, MenuItem, MenuLabel, Pill, Skeleton, ago, canOpenApps, cx, day, openApp, plural, update, useToast,
} from "@lemma-plugins/kit";
import { approveAsMe, mergeAsMe, sendBackAsMe } from "./actions";
import { FileDiff, FindingCard } from "./Code";
import { act, errText, postWord, useWho, whoIs, usePrr, type Prr } from "./data";
import { filesOf, mergeBlock, needsGithub, pullOf, summarize, type GhFile, type GhPull } from "./github";
import { itselfText } from "./Inbox";
import { ConnectGithub, LedgerLine, StatePill, VerdictPill, short, tally, tallyText, useChecks } from "./marks";
import { prPath, to, type PrTab } from "./route";
import type { Finding, PullRequest, Round } from "./types";

const NOT_READ = [/(^|\/)package-lock\.json$/, /(^|\/)yarn\.lock$/, /(^|\/)pnpm-lock\.yaml$/, /(^|\/)uv\.lock$/, /(^|\/)poetry\.lock$/, /(^|\/)Cargo\.lock$/, /(^|\/)go\.sum$/, /\.min\.(js|css)$/, /\.snap$/, /(^|\/)vendor\//, /\.gen\./];

/** A glob as the rules write them: `**` any depth, `*` one segment. */
export function globMatch(glob: string, path: string): boolean {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(path);
}

function useGithub(pr: PullRequest | undefined, repo: string) {
  const [files, setFiles] = useState<{ list: GhFile[] | null; err: unknown }>({ list: null, err: null });
  const [live, setLive] = useState<GhPull | null>(null);
  const [tick, setTick] = useState(0);
  const sha = pr?.head_sha || "";
  useEffect(() => {
    if (!pr) return;
    let alive = true;
    const f = filesOf(repo, pr.number, sha);
    setFiles({ list: f.now ?? null, err: null });
    f.next.then((list) => alive && setFiles({ list, err: null })).catch((err) => alive && setFiles({ list: null, err }));
    const p = pullOf(repo, pr.number);
    setLive(p.now ?? null);
    p.next.then((v) => alive && setLive(v)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pr?.id, repo, sha, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { files: files.list, filesErr: files.err, live, refresh: () => setTick((t) => t + 1) };
}

export function PrPage({ repo, number, tab, path }: { repo: string; number: number; tab: PrTab; path?: string | null }) {
  const prr = usePrr();
  const { me, people } = useWho();
  const toast = useToast();
  const pr = prr.prs.find((p) => prr.repoOf(p) === repo && p.number === number);
  const gh = useGithub(pr, repo);
  const checks = useChecks(repo, pr?.head_sha, !!pr && pr.state === "open");

  if (!prr.loaded) {
    return (
      <div className="c-app">
        <Header back={{ label: "Pull requests", icon: ArrowLeft, onClick: () => to.inbox() }} title={`${repo}#${number}`} />
        <main className="c-body c-body--wide"><Skeleton kind="record" /></main>
      </div>
    );
  }
  if (!pr) {
    return (
      <div className="c-app">
        <Header back={{ label: "Pull requests", icon: ArrowLeft, onClick: () => to.inbox() }} title={`${repo}#${number}`} />
        <Empty icon={CircleAlert} title="Not a pull request this Lemma watches" action={<Button size="sm" onClick={() => to.inbox()}>Back to the inbox</Button>}>
          {repo}#{number} isn't among the pull requests PR review has seen. It may be in a repository that isn't picked in Settings, or opened before it was.
        </Empty>
      </div>
    );
  }

  const rounds = (prr.roundsByPr.get(pr.id) || []).filter((r) => r.status !== "superseded");
  const latest = rounds[0] || null;
  const findings = prr.findingsByPr.get(pr.id) || [];
  const open = findings.filter((f) => f.state === "open");
  const t = tally(latest?.ledger);
  const mine = prr.isMine(pr);
  const author = pr.author_kind === "agent" ? "An agent" : mine ? "You" : pr.author || "Someone";
  const base = pr.base_ref || gh.live?.base?.ref || "main";
  const head = pr.head_ref || gh.live?.head?.ref || null;
  const commits = gh.live?.commits;
  const pushed = latest?.queued_at || latest?.started_at || pr.updated_at;
  const toTab = (next: PrTab) => go(prPath(repo, number, next));

  const handTo = async (userId: string, name: string) => {
    try {
      await update("pull_request", pr.id, { waits_on: userId, waits_on_name: name, waits_for: "review", waits_since: new Date().toISOString() });
      toast(`Handed to ${name}. It shows in their inbox under Needs your review.`);
    } catch (e) {
      toast(`Couldn't hand it over: ${errText(e)}`);
    }
  };

  const tabs: { id: PrTab; label: ReactNode }[] = [
    { id: "overview", label: "Overview" },
    { id: "files", label: <>Files changed <span className="c-faint num">{pr.changed_files ?? gh.files?.length ?? ""}</span></> },
    { id: "rules", label: <>Rules {t.broken ? <Pill tone="danger">{t.broken} broken</Pill> : <span className="c-faint num">{t.total || ""}</span>}</> },
    { id: "rounds", label: <>Rounds <span className="c-faint num">{rounds.length}</span></> },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="c-app">
      <Header back={{ label: "Pull requests", icon: ArrowLeft, onClick: () => to.inbox() }} title={<span className="prr-mono">{repo}#{number}</span>}>
        <Menu label={<><UserRound size={14} aria-hidden="true" /><span className="c-hide-sm">Hand to</span></>} title="Hand it to someone" align="right">
          {(close) => (
            <>
              <MenuLabel>It waits on them, in their inbox</MenuLabel>
              {people.filter((p) => p.user_id !== pr.waits_on).map((p) => (
                <MenuItem key={p.user_id} onSelect={() => { close(); void handTo(p.user_id, p.name); }}>
                  {p.user_id === me?.id ? `${p.name} (you)` : p.name}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
        {pr.url ? <Button icon={ExternalLink} onClick={() => window.open(pr.url!, "_blank", "noopener")}><span className="c-hide-sm">Open on GitHub</span></Button> : null}
      </Header>

      <div className="prr-top">
        <div className="prr-top__title">
          <h1>{pr.title}</h1>
          <StatePill pr={pr} />
          <VerdictPill pr={pr} round={latest} />
        </div>
        <p className="prr-top__sub c-muted">
          <Avatar name={pr.author_kind === "agent" ? "Agent" : pr.author} size={20} />
          {author} {pr.state === "merged" ? "merged" : "wants to merge"}{commits ? ` ${plural(commits, "commit")}` : ""} into <span className="prr-mono">{base}</span>
          {head ? <> from <span className="prr-mono">{head}</span></> : null}
          <span className="c-faint"> · </span>
          <span className="num">+{pr.additions ?? 0} −{pr.deletions ?? 0}</span>
          <span className="c-faint"> · </span>
          {plural(pr.changed_files ?? 0, "file")}
          {pushed ? <><span className="c-faint"> · </span>pushed {agoText(pushed)}</> : null}
        </p>
        <nav className="prr-tabs" aria-label="Pull request">
          {tabs.map((x) => (
            <button key={x.id} type="button" className={cx(x.id === tab && "is-on")} aria-current={x.id === tab ? "page" : undefined} onClick={() => toTab(x.id)}>
              {x.label}
            </button>
          ))}
        </nav>
      </div>

      {latest?.status === "failed" ? (
        <div className="prr-strip prr-strip--warn" role="status">
          Round {latest.seq} didn't finish{latest.error ? `: ${latest.error}` : ""}. A review that didn't finish never counts as clean.
        </div>
      ) : null}

      {tab === "files" ? (
        <FilesTab pr={pr} prr={prr} round={latest} findings={findings} gh={gh} focus={path || null} side={<Side pr={pr} prr={prr} round={latest} rounds={rounds} findings={findings} open={open} gh={gh} checks={checks} mine={mine} onTab={toTab} />} />
      ) : (
        <div className="prr-page">
          <main className="prr-page__main">
            {tab === "overview" ? <Overview pr={pr} prr={prr} round={latest} open={open} onFile={(p) => go(prPath(repo, number, "files", p))} />
              : tab === "rules" ? <RulesTab round={latest} />
              : tab === "rounds" ? <RoundsTab rounds={rounds} findings={findings} />
              : <ActivityTab pr={pr} prr={prr} rounds={rounds} findings={findings} meId={me?.id} people={people} />}
          </main>
          {tab === "overview" ? <Side pr={pr} prr={prr} round={latest} rounds={rounds} findings={findings} open={open} gh={gh} checks={checks} mine={mine} onTab={toTab} /> : null}
        </div>
      )}
    </div>
  );
}

type Gh = ReturnType<typeof useGithub>;

/* ---------- Files changed ---------- */

function FilesTab({ pr, prr, round, findings, gh, focus, side }: { pr: PullRequest; prr: Prr; round: Round | null; findings: Finding[]; gh: Gh; focus: string | null; side: ReactNode }) {
  // Mechanical in the tree: lockfiles, generated files and pure renames, told apart by path and by GitHub's status.
  const renamed = useMemo(() => new Set((gh.files || []).filter((f) => f.status === "renamed" && f.additions + f.deletions <= 12).map((f) => f.filename)), [gh.files]);
  const isMech = (p: string) => renamed.has(p) || NOT_READ.some((r) => r.test(p));
  const kinds = round?.mechanical || [];
  const files = gh.files || [];
  const worth = files.filter((f) => !isMech(f.filename));
  const mechanical = files.filter((f) => isMech(f.filename));
  const [showMech, setShowMech] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [current, setCurrent] = useState<string | null>(focus);
  const lines = (list: GhFile[]) => list.reduce((n, f) => n + f.additions + f.deletions, 0);
  // Open ones, and those decided on this very commit (so a press doesn't make a finding vanish under the cursor).
  const shownFindings = findings.filter((f) => f.state === "open" || (f.state !== "fixed" && f.last_seen_round === round?.id));
  const forFile = (p: string) => shownFindings.filter((f) => f.path === p);
  const fileless = shownFindings.filter((f) => !f.path || (gh.files && !gh.files.some((x) => x.filename === f.path)));

  const jump = (p: string) => {
    if (isMech(p)) setShowMech(true);
    setClosed((c) => ({ ...c, [p]: false }));
    setCurrent(p);
    window.setTimeout(() => document.getElementById(`f-${p}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  };
  useEffect(() => {
    if (focus && gh.files) jump(focus);
  }, [focus, gh.files]); // eslint-disable-line react-hooks/exhaustive-deps

  const badge = (p: string) => {
    const list = forFile(p).filter((f) => f.state === "open");
    const must = list.filter((f) => f.severity === "must_fix").length;
    const should = list.filter((f) => f.severity === "should_fix").length;
    if (must) return <Pill tone="danger">{must} to fix</Pill>;
    if (should) return <Pill tone="warning">{should} to consider</Pill>;
    if (list.length) return <Pill>{plural(list.length, "nit")}</Pill>;
    return null;
  };

  const TreeItem = ({ f }: { f: GhFile }) => {
    const n = forFile(f.filename).filter((x) => x.state === "open").length;
    return (
      <button type="button" className={cx("prr-fi", current === f.filename && "is-on")} onClick={() => jump(f.filename)} title={f.filename}>
        <FileText size={13} aria-hidden="true" />
        <span className="prr-mono c-ellipsis">{f.filename}</span>
        {n ? <span className="prr-fi__n">{badge(f.filename)}</span> : null}
      </button>
    );
  };

  const missing = needsGithub(gh.filesErr);
  return (
    <div className="prr-files">
      <nav className="prr-tree" aria-label="Files">
        {!gh.files && !gh.filesErr ? (
          Array.from({ length: 7 }).map((_, i) => <div key={i} className="c-skel" style={{ height: 14, margin: "8px 8px", width: `${55 + ((i * 13) % 35)}%` }} />)
        ) : gh.filesErr ? (
          <div className="c-faint prr-meta prr-pad-s">{missing ? "Connect GitHub to see the files." : "GitHub didn't send the files."}</div>
        ) : (
          <>
            <div className="prr-tree__label">Worth reading · {plural(worth.length, "file")}, {lines(worth)} lines</div>
            {worth.map((f) => <TreeItem key={f.filename} f={f} />)}
            {mechanical.length ? (
              <>
                <div className="prr-tree__label">Mechanical · {plural(mechanical.length, "file")}, {lines(mechanical)} lines</div>
                {kinds.map((k) => (
                  <div key={k.kind} className="prr-tree__kind">
                    <span>{k.kind} · {plural(k.files || 0, "file")} · {k.lines ?? 0} lines</span>
                    {k.examples?.length ? <span className="prr-mono c-faint">{k.examples.join(", ")}</span> : null}
                  </div>
                ))}
                {showMech ? mechanical.map((f) => <TreeItem key={f.filename} f={f} />) : null}
                <button type="button" className="prr-link prr-tree__toggle" onClick={() => setShowMech((v) => !v)}>
                  {showMech ? "Hide them" : "Renames, lockfiles and generated files, hidden · Show"}
                </button>
              </>
            ) : null}
          </>
        )}
      </nav>
      <main className="prr-diffs">
        <div className="prr-meta c-faint">
          {round ? <>Round {round.seq} at <span className="prr-mono">{short(round.sha)}</span> · findings sit under the line they are about</> : "Not reviewed yet"}
        </div>
        {fileless.length ? <div className="prr-notes prr-notes--flat">{fileless.map((f) => <FindingCard key={f.id} f={f} prr={prr} />)}</div> : null}
        {gh.filesErr ? (
          <>
            {missing ? <ConnectGithub /> : <div className="prr-strip prr-strip--warn">GitHub didn't send the diff: {errText(gh.filesErr)}</div>}
            {shownFindings.filter((f) => f.path).length ? (
              <div className="prr-notes prr-notes--flat">
                {shownFindings.filter((f) => f.path).map((f) => <FindingCard key={f.id} f={f} prr={prr} onJump={() => undefined} />)}
              </div>
            ) : null}
          </>
        ) : !gh.files ? (
          <div className="prr-file"><div className="prr-file__head"><div className="c-skel" style={{ height: 14, width: 220 }} /></div><div className="c-skel" style={{ height: 220, borderRadius: 0 }} /></div>
        ) : (
          <>
            {worth.map((f) => <FileDiff key={f.filename} file={f} prr={prr} findings={forFile(f.filename)} open={!closed[f.filename]} onToggle={() => setClosed((c) => ({ ...c, [f.filename]: !c[f.filename] }))} badge={badge(f.filename)} />)}
            {showMech ? mechanical.map((f) => <FileDiff key={f.filename} file={f} prr={prr} findings={forFile(f.filename)} open={closed[f.filename] === false} onToggle={() => setClosed((c) => ({ ...c, [f.filename]: c[f.filename] === false }))} badge={badge(f.filename)} />) : null}
            {!files.length ? <Empty title="No files changed">GitHub lists no changed files for this pull request.</Empty> : null}
          </>
        )}
      </main>
      {side}
    </div>
  );
}

/* ---------- Overview ---------- */

function Overview({ pr, prr, round, open, onFile }: { pr: PullRequest; prr: Prr; round: Round | null; open: Finding[]; onFile: (p: string) => void }) {
  if (!round) {
    return <Empty title="Not reviewed yet">{pr.review_state === "off" ? "Reviews are off for this repository in Settings." : "The first round starts when the next push arrives, or when its review is queued."}</Empty>;
  }
  const changes = round.key_changes || [];
  return (
    <div className="c-stack" style={{ gap: 18 }}>
      {round.status === "queued" || round.status === "running" ? (
        <div className="prr-strip prr-strip--info" role="status">Round {round.seq} at <span className="prr-mono">{short(round.sha)}</span> is being read now. Findings and the ledger show here when it finishes.</div>
      ) : null}
      {changes.length ? (
        <section>
          <h2 className="prr-h2"><Sparkles size={14} aria-hidden="true" /> Key changes <Pill tone="ai">ai</Pill></h2>
          <ol className="prr-changes">
            {changes.map((c, i) => (
              <li key={i}>
                <span className="prr-changes__n num">{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <div>{c.title}</div>
                  {c.why ? <div className="c-muted prr-meta">{c.why}</div> : null}
                  {c.hunks?.length ? (
                    <div className="prr-chips">
                      {[...new Set(c.hunks.map((h) => h.path))].map((p) => <button key={p} type="button" className="prr-chip prr-mono" onClick={() => onFile(p)}>{p}</button>)}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <section>
        <h2 className="prr-h2">Open findings <span className="c-count">{open.length}</span></h2>
        {open.length ? (
          <div className="prr-notes prr-notes--flat">
            {[...open].sort((a, b) => sevRank(a) - sevRank(b)).map((f) => <FindingCard key={f.id} f={f} prr={prr} onJump={f.path ? () => onFile(f.path!) : undefined} />)}
          </div>
        ) : round.status === "done" ? (
          <div className="c-muted">None. Every finding raised on this pull request is fixed or decided.</div>
        ) : null}
      </section>
      {round.cross_pr?.length ? (
        <section>
          <h2 className="prr-h2">Found by code across open pull requests</h2>
          <div className="c-stack" style={{ gap: 6 }}>
            {round.cross_pr.map((c, i) => (
              <div key={i} className="c-muted">
                <span className="prr-mono">{c.pr}</span> {c.kind === "same_number" ? "adds the same migration number" : "changes the same files"}
                {c.detail ? `: ${c.detail}` : c.paths?.length ? `: ${c.paths.join(", ")}` : ""}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {round.lines_to_read_count != null ? (
        <div className="c-faint prr-meta">
          {round.lines_to_read_count} of {round.lines_total ?? "its"} lines are worth reading in this round; {round.mechanical?.length ? round.mechanical.map((m) => `${m.kind} (${plural(m.files || 0, "file")}, ${m.lines ?? 0} lines)`).join(", ") : "renames, lockfiles and generated files"} left out.
        </div>
      ) : null}
    </div>
  );
}

const sevRank = (f: Finding) => (f.severity === "must_fix" ? 0 : f.severity === "should_fix" ? 1 : 2);

/* ---------- the column beside ---------- */

function Side({ pr, prr, round, rounds, findings, open, gh, checks, mine, onTab }: {
  pr: PullRequest; prr: Prr; round: Round | null; rounds: Round[]; findings: Finding[]; open: Finding[]; gh: Gh;
  checks: ReturnType<typeof useChecks>; mine: boolean; onTab: (t: PrTab) => void;
}) {
  const t = tally(round?.ledger);
  const ledger = [...(round?.ledger || [])].sort((a, b) => rank(a.state) - rank(b.state));
  const summary = round?.summary || pr.summary;
  const files = gh.files?.map((f) => f.filename) || findings.map((f) => f.path).filter(Boolean) as string[];
  const repo = prr.repoOf(pr);
  const risky = prr.risk.filter((r) => r.state !== "proposed" && (!r.repo || r.repo === repo) && files.some((p) => globMatch(r.glob, p)));
  const reviewerOf = (r: { reviewer_user_id: string | null; reviewer_name: string | null }) =>
    r.reviewer_user_id ? (prr.memberByUser.get(r.reviewer_user_id)?.login || r.reviewer_name) : r.reviewer_name;
  const reasons = round?.risk_reasons || [];

  return (
    <aside className="prr-right" aria-label="Review">
      <Card id="prr-what" title={<><Sparkles size={15} aria-hidden="true" /> What it changes</>} action={<Pill tone="ai">ai</Pill>}>
        <div className="prr-sb">
          {summary ? <div>{summary}</div> : <div className="c-muted">{round ? "Written when the round finishes." : "Not reviewed yet."}</div>}
          {pr.risk === "high" || pr.risk === "medium" ? (
            <div className="c-muted prr-meta">
              {pr.risk === "high" ? "High risk" : "Medium risk"}
              {risky.length ? <>: it touches {risky.map((r, i) => <span key={r.id}>{i ? ", " : ""}<span className="prr-mono">{r.glob}</span></span>)}{risky.some(reviewerOf) ? <>, and your risky paths ask {[...new Set(risky.map(reviewerOf).filter(Boolean))].join(" and ")} to review {risky.length === 1 ? "it" : "them"}</> : null}.</> : "."}
            </div>
          ) : null}
          {reasons.length && !risky.length ? (
            <ul className="prr-reasons">
              {reasons.map((r, i) => (
                <li key={i} className="c-muted prr-meta">{r.glob ? <><span className="prr-mono">{r.glob}</span>: </> : null}{r.reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>

      <Card id="prr-ledger" title={<>Rules checked <span className="c-count">{t.total ? `${t.total} in scope` : ""}</span></>}>
        <div className="prr-sb">
          {!round || round.status === "queued" || round.status === "running" ? (
            <div className="c-muted">Reading the rules in scope at <span className="prr-mono">{short(pr.head_sha)}</span>…</div>
          ) : !t.total ? (
            <div className="c-muted">No rule applies to the files this changes.</div>
          ) : (
            <>
              <div className="c-row" style={{ flexWrap: "wrap", gap: 6 }}>
                <Pill tone="success">{t.passed} passed</Pill>
                {t.broken ? <Pill tone="danger">{t.broken} broken</Pill> : null}
                {t.notChecked ? <Pill>{t.notChecked} not checked</Pill> : null}
              </div>
              {ledger.slice(0, 5).map((x, i) => <LedgerLine key={i} x={x} />)}
              <button type="button" className="prr-link" onClick={() => onTab("rules")}>All {plural(t.total, "rule")}</button>
            </>
          )}
        </div>
      </Card>

      {rounds.length > 1 && round ? <SinceFirst findings={findings} round={round} /> : null}

      <MergeBox pr={pr} prr={prr} round={round} open={open} gh={gh} checks={checks} mine={mine} />
    </aside>
  );
}

const rank = (s: string) => (s === "broken" ? 0 : s === "not_checked" ? 1 : 2);

function SinceFirst({ findings, round }: { findings: Finding[]; round: Round }) {
  const fixed = findings.filter((f) => f.state === "fixed");
  const prr = usePrr();
  const dismissed = findings.filter((f) => (f.state === "dismissed" || f.state === "wrong") && f.first_round !== round.id && (prr.seqOf(f.first_round) || 1) < round.seq);
  const fresh = findings.filter((f) => f.first_round === round.id);
  const dropped = round.counts?.dropped_untouched || 0;
  return (
    <Card id="prr-since" title="Since round 1">
      <div className="prr-sb">
        {fixed.length ? fixed.slice(0, 3).map((f) => (
          <div className="prr-srow" key={f.id}><span>Fixed in <span className="prr-mono">{short(f.fixed_in)}</span></span><span className="c-muted prr-r">{f.title}</span></div>
        )) : <div className="prr-srow"><span>Fixed since</span><span className="c-muted">None yet</span></div>}
        {dismissed.length ? dismissed.slice(0, 2).map((f) => (
          <div className="prr-srow" key={f.id}><span>Dismissed, stays dismissed</span><span className="c-muted prr-r">{f.title}</span></div>
        )) : null}
        <div className="prr-srow"><span>New in round {round.seq}</span><span className="c-muted">{fresh.length ? plural(fresh.length, "finding") : "None"}</span></div>
        <div className="prr-srow"><span>New on lines this push didn't touch</span><span className="c-muted">None{dropped ? `, ${dropped} left out` : ""}</span></div>
        <div className="c-faint prr-meta">A finding is the same row on every push: fixed ones are marked in the commit that fixed them, and a dismissal is never asked again.</div>
      </div>
    </Card>
  );
}

/* ---------- merge box ---------- */

function lemmaCheck(round: Round | null, t: ReturnType<typeof tally>, prr: Prr): { tone: "success" | "danger" | "warning" | "plain"; text: string } {
  const raw = round?.github?.check || prr.platform?.checks || null;
  const state = postWord(raw) || (prr.botBlocked === "needs_platform" ? "needs_platform" : null);
  if (!prr.settings?.check_on || state === "off") return { tone: "plain", text: "Lemma check: off" };
  if (state === "needs_platform") return { tone: "warning", text: "Can't post yet: needs the platform update" };
  if (state === "no_permission") return { tone: "warning", text: "Can't post yet: the GitHub App needs Checks write" };
  if (state === "failed") return { tone: "warning", text: `Lemma check didn't post${String(raw).includes(":") ? `: ${String(raw).split(":").slice(1).join(":")}` : ""}` };
  if (!round || round.status !== "done") return { tone: "plain", text: "Lemma check: waiting for the round" };
  if (state !== "ok") return { tone: "plain", text: "Lemma check: not posted yet" };
  if (t.broken) return { tone: "danger", text: `Lemma check: ${plural(t.broken, "rule")} broken` };
  return { tone: "success", text: "Lemma check: passed" };
}

function MergeBox({ pr, prr, round, open, gh, checks, mine }: {
  pr: PullRequest; prr: Prr; round: Round | null; open: Finding[]; gh: Gh; checks: ReturnType<typeof useChecks>; mine: boolean;
}) {
  const { me } = useWho();
  const toast = useToast();
  const repo = prr.repoOf(pr);
  const settings = prr.settings;
  const [as, setAs] = useState<"bot" | "me">(settings?.posts_as === "reviewer" ? "me" : "bot");
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const t = tally(round?.ledger);
  const check = lemmaCheck(round, t, prr);
  const botBlocked = !!prr.botBlocked || postWord(round?.github?.review) === "needs_platform";
  const ci = checks.list ? summarize(checks.list) : null;
  const reviewing = !round || round.status === "queued" || round.status === "running";
  const unfinished = round?.status === "failed";
  const merged = pr.state === "merged" || !!pr.merged_at;
  const ghBlock = mergeBlock(gh.live, checks.list, round?.sha);
  const ruleBlock = reviewing ? "Waits for the review to finish." : unfinished ? "The latest review didn't finish, so it isn't clean." : t.broken ? `Waits until no rule is broken: ${plural(t.broken, "rule")} broken now.` : null;

  const run = async (what: string, fn: () => Promise<string | void>) => {
    setBusy(what);
    setRefusal(null);
    try {
      const msg = await fn();
      if (msg) toast(msg);
      gh.refresh();
    } catch (e) {
      setRefusal(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const sendBack = () =>
    run("send", async () => {
      if (as === "bot") {
        const out = await act.sendBack(pr.id, open.map((f) => f.id));
        return out?.message || `Sent back on GitHub as the Lemma's bot, with ${plural(open.length, "finding")}.`;
      }
      await sendBackAsMe(repo, pr, open, prr.ruleById, gh.files);
      return `Sent back on GitHub as you, with ${plural(open.length, "finding")}.`;
    });

  if (merged) {
    return (
      <Card title="Merge">
        <div className="prr-sb">
          <div className="prr-srow"><Pill tone="info">{pr.merge_state === "merged_by_itself" ? "Merged by itself" : "Merged"}</Pill><span className="c-faint prr-meta">{pr.merged_at ? day(pr.merged_at) : ""}</span></div>
        </div>
      </Card>
    );
  }

  return (
    <Card id="prr-merge" title="Merge">
      <div className="prr-sb">
        <div className="prr-srow">
          {checks.err ? (
            needsGithub(checks.err) ? <span className="c-muted prr-meta">Connect GitHub to see its checks.</span> : <span className="c-muted prr-meta">GitHub didn't answer for checks.</span>
          ) : !ci ? (
            <span className="c-skel" style={{ width: 120, height: 20, borderRadius: 999 }} />
          ) : ci.state === "failing" ? (
            <Pill tone="danger">{ci.failing.length} of {ci.total} checks failing</Pill>
          ) : ci.state === "running" ? (
            <Pill tone="info">{plural(ci.running, "check")} running</Pill>
          ) : ci.state === "none" ? (
            <Pill dot={false}>No checks on this commit</Pill>
          ) : (
            <Pill tone="success">{plural(ci.passed, "check")} passed</Pill>
          )}
          <span className="c-faint prr-meta">live from GitHub</span>
        </div>
        {ci?.failing.length ? <div className="c-faint prr-meta">{ci.failing.join(", ")}</div> : null}
        <div className="prr-srow"><Pill tone={check.tone} dot={check.tone !== "plain"}>{check.text}</Pill></div>

        {pr.merge_state === "merging" || pr.merge_state === "held" || pr.merge_state === "would_merge" ? (
          <div className="prr-itself">
            <div className="prr-srow">
              <span className="c-row" style={{ gap: 6 }}><GitMerge size={14} aria-hidden="true" />{pr.merge_state === "would_merge" ? "Would have merged by itself (watching)" : itselfText(prr, pr)}</span>
            </div>
            {pr.merge_state !== "would_merge" ? (
              <div className="c-row" style={{ gap: 6, flexWrap: "wrap" }}>
                <Button size="sm" icon={Hand} busy={busy === "hold"} onClick={() => void run("hold", async () => (await act.hold(pr.id, pr.merge_state !== "held"))?.message || (pr.merge_state === "held" ? "Released: it merges by itself again." : "Held: it waits for a person now."))}>
                  {pr.merge_state === "held" ? "Unhold" : "Hold"}
                </Button>
                {pr.merge_state === "merging" ? (
                  <Button size="sm" busy={busy === "now"} disabled={botBlocked} title={botBlocked ? "Merging as the bot needs the platform update" : undefined} onClick={() => void run("now", async () => (await act.mergeNow(pr.id))?.message || "Merging now, as the Lemma's bot.")}>Merge now</Button>
                ) : null}
                <span className="c-faint prr-meta">A <span className="prr-mono">lemma-hold</span> label on GitHub holds it too.</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="prr-srow">
          <label htmlFor="prr-as">Send back as</label>
          <select id="prr-as" className="c-select prr-select" value={as} onChange={(e) => setAs(e.target.value as "bot" | "me")}>
            <option value="bot">The Lemma's bot</option>
            <option value="me">You{me?.name ? ` (${me.name.split(" ")[0].toLowerCase()})` : ""}</option>
          </select>
        </div>
        <div className="c-faint prr-meta">
          {as === "bot"
            ? botBlocked ? "The bot posts from a function, which needs the platform update. Until then send it back as you." : "The bot posts the review from a function, under the Lemma's name."
            : "It posts under your own GitHub account when you press Send back."}
        </div>
        <div className="prr-acts">
          <Button busy={busy === "send"} disabled={!open.length || (as === "bot" && botBlocked)} onClick={() => void sendBack()}>
            Send back{open.length ? ` with ${plural(open.length, "finding")}` : ""}
          </Button>
          {!mine ? (
            <Button busy={busy === "approve"} disabled={!!ruleBlock} title={ruleBlock || undefined} onClick={() => void run("approve", async () => { await approveAsMe(repo, pr); return "Approved on GitHub as you."; })}>
              Approve
            </Button>
          ) : null}
          <Button variant="primary" icon={GitMerge} busy={busy === "merge"} disabled={!!ruleBlock || !!ghBlock} title={ruleBlock || ghBlock || undefined} onClick={() => void run("merge", async () => { await mergeAsMe(repo, pr, settings?.merge?.how); void prr.reload("prs"); return "Merged on GitHub as you."; })}>
            Merge
          </Button>
        </div>
        {refusal ? <div className="prr-refusal" role="alert"><CircleAlert size={14} aria-hidden="true" /> GitHub said: {refusal}</div> : null}
        <div className="c-faint prr-meta">
          {ruleBlock || ghBlock || (mine ? "Approve is hidden: GitHub never lets the author approve their own pull request." : "Approve and Merge wait until no rule is broken. Both post as you.")}
        </div>
      </div>
    </Card>
  );
}

/* ---------- Rules, Rounds, Activity ---------- */

function RulesTab({ round }: { round: Round | null }) {
  if (!round || round.status === "queued" || round.status === "running") return <Empty title="Rules are being checked">The ledger shows here when the round finishes.</Empty>;
  const ledger = round.ledger || [];
  if (!ledger.length) return <Empty title="No rule in scope">None of the active rules applies to the files this pull request changes.</Empty>;
  const groups: { label: string; state: string }[] = [
    { label: "Broken", state: "broken" },
    { label: "Not checked", state: "not_checked" },
    { label: "Passed", state: "passed" },
  ];
  return (
    <div className="c-stack" style={{ gap: 18 }}>
      <div className="c-muted">{tallyText(tally(ledger))}, at <span className="prr-mono">{short(round.sha)}</span>. Every rule in scope is listed, with why when it couldn't be checked.</div>
      {groups.map((g) => {
        const list = ledger.filter((x) => x.state === g.state);
        if (!list.length) return null;
        return (
          <section key={g.state}>
            <h2 className="prr-h2">{g.label} <span className="c-count">{list.length}</span></h2>
            <div className="c-card"><div className="prr-sb">{list.map((x, i) => <LedgerLine key={i} x={x} />)}</div></div>
          </section>
        );
      })}
      {canOpenApps() ? <div><Button size="sm" onClick={() => void openApp("rules")}>Open the rules</Button></div> : null}
    </div>
  );
}

function RoundsTab({ rounds, findings }: { rounds: Round[]; findings: Finding[] }) {
  if (!rounds.length) return <Empty title="No rounds yet">A round reads the pull request at its head commit after each push.</Empty>;
  return (
    <div className="c-table-wrap">
      <table className="c-table prr-table">
        <thead>
          <tr><th>Round</th><th>Commit</th><th>Status</th><th>Rules</th><th className="right">Raised</th><th className="right">Fixed</th><th className="c-hide-sm">When</th></tr>
        </thead>
        <tbody>
          {rounds.map((r) => (
            <tr key={r.id} style={{ cursor: "default" }}>
              <td>Round {r.seq}</td>
              <td><span className="prr-mono">{short(r.sha)}</span></td>
              <td>
                {r.status === "done" ? <Pill tone="success">Finished</Pill> : r.status === "failed" ? <Pill tone="warning" title={r.error || undefined}>Didn't finish</Pill> : r.status === "superseded" ? <Pill>Superseded</Pill> : <Pill tone="info">{r.status === "queued" ? "Queued" : "Reading"}</Pill>}
              </td>
              <td className="c-muted">{r.status === "done" ? tallyText(tally(r.ledger)) : r.error || "—"}</td>
              <td className="right num">{findings.filter((f) => f.first_round === r.id).length}</td>
              <td className="right num">{findings.filter((f) => f.state === "fixed" && f.fixed_in === r.sha).length}</td>
              <td className="c-faint c-hide-sm">{ago(r.finished_at || r.started_at || r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityTab({ pr, prr, rounds, findings, meId, people }: { pr: PullRequest; prr: Prr; rounds: Round[]; findings: Finding[]; meId?: string; people: { user_id: string; name: string; email: string }[] }) {
  type Ev = { at: string; text: ReactNode };
  const evs: Ev[] = [];
  const name = (id: string | null) => whoIs(prr, people, meId, id);
  if (pr.opened_at || pr.created_at) evs.push({ at: pr.opened_at || pr.created_at!, text: <>{pr.author || "Someone"} opened it</> });
  for (const r of rounds) {
    evs.push({ at: r.started_at || r.queued_at || r.created_at || "", text: <>Round {r.seq} started at <span className="prr-mono">{short(r.sha)}</span></> });
    if (r.finished_at) evs.push({ at: r.finished_at, text: r.status === "failed" ? <>Round {r.seq} didn't finish{r.error ? `: ${r.error}` : ""}</> : <>Round {r.seq} finished: {tallyText(tally(r.ledger))}</> });
  }
  for (const f of findings) {
    if (f.state === "fixed" && f.updated_at) evs.push({ at: f.updated_at, text: <>“{f.title}” fixed in <span className="prr-mono">{short(f.fixed_in)}</span></> });
    if ((f.state === "dismissed" || f.state === "wrong") && (f.decided_at || f.updated_at)) evs.push({ at: (f.decided_at || f.updated_at)!, text: <>{f.decided_by ? name(f.decided_by) : "Someone"} {f.state === "wrong" ? "marked “" + f.title + "” wrong" : "said “" + f.title + "” isn't worth fixing"}</> });
  }
  for (const l of prr.log.filter((x) => x.pull_request_id === pr.id)) {
    const by = l.by ? name(l.by) : "the Lemma";
    const what = l.action === "would_merge" ? "Would have merged by itself (watching)"
      : l.action === "merging" ? "Started the wait before merging by itself"
      : l.action === "merged" ? "Merged by itself, as the Lemma's bot"
      : l.action === "held" ? `${by} held it`
      : l.action === "unheld" ? `${by} released the hold`
      : l.action === "person_merged" ? `${by} merged it`
      : l.action === "failed" ? `GitHub refused the merge${l.note ? `: ${l.note}` : ""}`
      : `Not merged by itself${l.note ? `: ${l.note}` : ""}`;
    evs.push({ at: l.at || l.created_at || "", text: what });
  }
  if (pr.merged_at) evs.push({ at: pr.merged_at, text: pr.merge_state === "merged_by_itself" ? "Merged by itself" : "Merged" });
  evs.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!evs.length) return <Empty title="Nothing yet">Rounds, decisions and merges show here as they happen.</Empty>;
  return (
    <div className="c-card">
      <ol className="c-timeline">
        {evs.map((e, i) => (
          <li key={i}>
            <span className="c-tl-icon" aria-hidden="true"><GitMerge size={13} /></span>
            <div className="c-tl-main">{e.text}</div>
            <span className="c-tl-when">{ago(e.at)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
