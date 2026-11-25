// C. One pull request the Lemma opened, as a record (/b/<id>): how it was
// checked, one commit per update with Drop or Put back, the files with the
// lockfile folded and the fix as text, and beside it the checks, the review,
// what was held out and opened apart, and "Ask the Lemma".

import { useState } from "react";
import {
  ArrowLeft, Ban, CircleCheck, CircleX, Download, ExternalLink, Eye, FileCode, FileLock2, FlaskConical, GitBranch, GitMerge,
  GitPullRequest, Hammer, ListChecks, MessageSquare, Package, Search, ShieldAlert, Split, Upload, Wrench,
} from "lucide-react";
import { Button, Card, Empty, Header, Pill, Sheet, useToast } from "@lemma-plugins/kit";
import { decide, merge, useDeps } from "./data";
import { BatchState, Change, Checks, Mono, Read, Review, StatePill } from "./marks";
import { clock, dayOf, plural, short } from "./model";
import { to } from "./route";
import type { Batch as BatchRow, FileChange, Step, Update } from "./types";

const STEP_ICON: Record<string, typeof Package> = {
  start: GitBranch, read: Search, hold: Ban, install: Download, test: FlaskConical, halve: Split, fix: Wrench, build: Hammer,
  push: Upload, open: GitPullRequest, checks: ListChecks, review: Eye, comment: MessageSquare, drop: Ban, merge: GitMerge,
  note: Package, security: ShieldAlert,
};

export function Batch({ id }: { id: string }) {
  const { batches, updates } = useDeps();
  const b = batches.find((x) => x.id === id);
  if (!b) {
    return (
      <>
        <Header icon={Package} back={{ label: "Dependencies", icon: ArrowLeft, onClick: () => to.week() }} title="Pull request" />
        <main className="c-body"><Empty icon={GitPullRequest} title="This pull request isn't here">It may belong to a sample that was cleared.</Empty></main>
      </>
    );
  }
  const mine = updates.filter((u) => u.batch_id === b.id);
  return (
    <>
      <Header icon={Package} back={{ label: "Dependencies", icon: ArrowLeft, onClick: () => to.week() }}
        title={<span className="c-muted">{b.repo} / #{b.pr_number ?? "…"}</span>} />
      <main className="c-body dp-body">
        <Head b={b} updates={mine} />
        <div className="c-split c-split--record">
          <div className="c-stack dp-main">
            <Timeline steps={b.steps} />
            <Updates b={b} updates={mine} />
            <Files files={b.files} />
          </div>
          <Side b={b} updates={mine} />
        </div>
      </main>
    </>
  );
}

function Head({ b, updates }: { b: BatchRow; updates: Update[] }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const inIt = updates.filter((u) => ["opened", "in_batch", "merged"].includes(u.state)).length;
  const fixes = b.commits.filter((c) => c.fix).length;
  const kind = b.kind === "security" ? "Security fix" : b.kind === "own" ? "On its own" : "Weekly batch";
  const doMerge = async () => {
    setBusy(true);
    try {
      const msg = await merge(b);
      if (msg) toast(msg);
      setConfirm(false);
    } catch (e) {
      toast(`Couldn't merge: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="c-record-head">
      <div className="c-grow">
        <h1>{b.title || `Dependencies, ${b.branch}`}</h1>
        <div className="c-record-head__facts">
          <BatchState b={b} />
          <Checks b={b} />
          <Review b={b} />
          <Pill tone="plain">{kind}</Pill>
        </div>
        <div className="c-record-head__sub">
          <span>{plural(inIt, "update")}{fixes ? ` · ${plural(fixes, "fix", "fixes")} by the Lemma` : ""}</span>
          <span>·</span><Mono>{b.branch}</Mono><span>→</span><Mono>{b.base_branch || "main"}</Mono>
          {b.opened_at ? <><span>·</span><span>opened by the Lemma's GitHub App, {dayOf(b.opened_at)} {clock(b.opened_at)}</span></> : null}
          {b.merged_at ? <><span>·</span><span>merged by {b.merged_by || "someone"}, {dayOf(b.merged_at)}</span></> : null}
        </div>
      </div>
      <div className="c-record-head__actions">
        {b.pr_url ? <a className="c-btn" href={b.pr_url} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />Open on GitHub</a> : null}
        {b.state === "open" ? <Button variant="primary" icon={GitMerge} onClick={() => setConfirm(true)}>Merge</Button> : null}
      </div>
      <Sheet open={confirm} title={`Merge #${b.pr_number}`} onClose={() => setConfirm(false)}
        footer={<>
          <Button variant="primary" icon={GitMerge} busy={busy} onClick={() => void doMerge()}>Merge into {b.base_branch || "main"}</Button>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
        </>}>
        <p>Squash-merge <b>{b.title}</b> into <Mono>{b.base_branch || "main"}</Mono> on GitHub, as you.</p>
        <dl className="c-props">
          <dt>Checks</dt><dd><Checks b={b} /></dd>
          <dt>Review</dt><dd><Review b={b} /></dd>
          <dt>Updates</dt><dd>{plural(inIt, "update")}{fixes ? `, ${plural(fixes, "fix", "fixes")}` : ""}</dd>
        </dl>
        {b.checks !== "passed" ? <p className="dp-warn">Checks haven't all passed.</p> : null}
        <p className="c-muted">The Lemma never merges on its own. This is you merging.</p>
      </Sheet>
    </div>
  );
}

function Timeline({ steps }: { steps: Step[] }) {
  let lastDay = "";
  return (
    <Card title="How it was checked" icon={ListChecks} flush>
      {steps.length ? (
        <ol className="c-timeline dp-timeline">
          {steps.map((s, i) => {
            const Icon = STEP_ICON[s.kind] || Package;
            const d = dayOf(s.at);
            const showDay = d !== lastDay;
            lastDay = d;
            return (
              <li key={`${s.at}-${i}`} className={s.ok ? "" : "is-bad"}>
                <span className="c-tl-icon" aria-hidden="true">{s.ok ? <Icon /> : <CircleX />}</span>
                <div className="c-tl-main">{s.kind === "halve" || s.kind === "fix" ? <Read>{s.text}</Read> : s.text}</div>
                <span className="c-tl-when">{showDay ? <span className="dp-day">{d}</span> : null}{clock(s.at)}</span>
              </li>
            );
          })}
        </ol>
      ) : <p className="c-card__body c-muted">Nothing yet: the Lemma writes each step here as it goes.</p>}
    </Card>
  );
}

function Updates({ b, updates }: { b: BatchRow; updates: Update[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const order = (u: Update) => {
    const i = b.commits.findIndex((c) => c.package === u.package || c.update_id === u.id);
    return i < 0 ? 999 : i;
  };
  const list = [...updates].sort((x, y) => (x.state === "dropped" ? 1 : 0) - (y.state === "dropped" ? 1 : 0) || order(x) - order(y));
  const act = async (u: Update, action: string) => {
    setBusy(u.id);
    try {
      toast(await decide(u.id, action));
    } catch (e) {
      toast(`Couldn't do that: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };
  const open = b.state === "open";
  return (
    <Card title="Updates in this pull request" icon={Package} count={updates.filter((u) => u.state !== "dropped").length} flush>
      <div className="dp-scroll">
        <table className="c-table dp-table dp-table--flat">
          <thead><tr><th>Package</th><th>Change</th><th>Commit</th><th>The Lemma's read</th><th><span className="c-sr">Act</span></th></tr></thead>
          <tbody>
            {list.map((u) => {
              const dropped = u.state === "dropped";
              return (
                <tr key={u.id} className={dropped ? "is-dropped" : ""} onClick={() => to.update(u.id)}>
                  <td><b className={dropped ? "dp-strike" : ""}>{u.package}</b></td>
                  <td><span className={dropped ? "dp-strike" : ""}><Change u={u} /></span></td>
                  <td>{dropped ? <span className="c-faint">dropped</span> : <span className="c-row">
                    <Mono>{u.commit_sha || "—"}</Mono>
                    {u.fix_sha ? <><span className="c-faint">+</span><Mono>{u.fix_sha}</Mono><Pill tone="ai">fix</Pill></> : null}
                  </span>}</td>
                  <td className="dp-wrap">{dropped ? <span className="c-muted">{u.why}</span> : <Read>{u.lemma_read || u.why}</Read>}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {open && !u.security ? (dropped
                      ? <Button size="sm" busy={busy === u.id} onClick={() => void act(u, "put_back")}>Put back</Button>
                      : u.state !== "merged" ? <Button size="sm" busy={busy === u.id} onClick={() => void act(u, "drop")}>Drop</Button> : null)
                      : <StatePill u={u} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Files({ files }: { files: FileChange[] }) {
  const [unfold, setUnfold] = useState(false);
  if (!files.length) return null;
  return (
    <Card title="Files" icon={FileCode} count={files.length} flush>
      <ul className="c-list">
        {files.map((f) => (
          <li key={f.path} className="dp-file">
            <div className="c-row dp-wrap-row">
              {f.kind === "lockfile" ? <FileLock2 size={14} className="c-faint" aria-hidden="true" /> : <FileCode size={14} className="c-faint" aria-hidden="true" />}
              <Mono>{f.path}</Mono>
              <span className="dp-delta"><span className="dp-add">+{f.additions ?? 0}</span> <span className="dp-del">−{f.deletions ?? 0}</span></span>
              {f.kind === "lockfile" ? <Pill tone="plain">folded: lockfile</Pill> : null}
              {f.kind === "fix" ? <Pill tone="ai">by the Lemma</Pill> : null}
              {f.kind === "workflow" ? <Pill tone="plain">workflow</Pill> : null}
            </div>
            {f.patch && (f.kind !== "lockfile" || unfold) ? <Diff text={f.patch} label={f.path} /> : null}
            {f.kind === "lockfile" && f.patch && !unfold ? <Button size="sm" variant="ghost" onClick={() => setUnfold(true)}>Show the lockfile</Button> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The fix as plain lines: the kit has no diff view yet. */
function Diff({ text, label }: { text: string; label: string }) {
  return (
    <pre className="dp-diff" aria-label={`Changes in ${label}`}>
      {text.split("\n").map((line, i) => (
        <span key={i} className={line.startsWith("+") ? "dp-diff__add" : line.startsWith("-") ? "dp-diff__del" : "dp-diff__ctx"}>
          {line.startsWith("-") ? "−" + line.slice(1) : line}{"\n"}
        </span>
      ))}
    </pre>
  );
}

function Side({ b, updates }: { b: BatchRow; updates: Update[] }) {
  const { settings, updates: all, batches } = useDeps();
  const toast = useToast();
  const [ask, setAsk] = useState("");
  const [sending, setSending] = useState(false);
  const held = all.filter((u) => u.repo === b.repo && ["needs_you", "risky"].includes(u.state));
  const apart = batches.filter((x) => x.repo === b.repo && x.id !== b.id && x.state === "open" && x.kind !== "batch");
  const inIt = updates.filter((u) => ["opened", "in_batch", "merged"].includes(u.state)).length;
  const checksNote = settings?.platform?.checks?.state === "yes";
  const send = async () => {
    if (!ask.trim()) return;
    setSending(true);
    try {
      toast(await decide(b.id, "ask", { text: ask.trim() }));
      setAsk("");
    } catch (e) {
      toast(`Couldn't ask: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSending(false);
    }
  };
  return (
    <aside className="c-stack dp-side">
      <Card title="Checks">
        <ul className="dp-checks">
          <li><span>Dependency updates</span><Pill tone="success">{inIt} in, {held.length} held</Pill></li>
          {!checksNote ? <li className="dp-small c-faint">Said in the description: the App can't post a check run yet.</li> : null}
          {b.check_runs.map((c) => (
            <li key={c.name}><span>{c.name}</span>
              {c.state === "passed" ? <Pill tone="success" icon={CircleCheck}>Passed</Pill> : c.state === "failed" ? <Pill tone="danger">Failed</Pill>
                : c.state === "running" ? <Pill tone="info">Running</Pill> : <Pill tone="plain">{c.state}</Pill>}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Review">
        <div className="c-row"><Review b={b} />{b.review_by ? <span className="c-muted">by {b.review_by}</span> : null}</div>
        {b.review_text ? <p className="dp-quote">“{b.review_text}”</p> : null}
        {b.review === "none" ? <p className="c-muted dp-small">A review on GitHub shows here.</p> : null}
      </Card>
      {b.kind === "batch" ? (
        <Card title="Held out of this batch" count={held.length}>
          {held.length ? (
            <ul className="dp-checks">
              {held.map((u) => (
                <li key={u.id}><button className="dp-link" onClick={() => to.update(u.id)}>{u.package} {u.to_version}</button>
                  {u.state === "risky" ? <Pill tone="danger">Looks risky</Pill> : <Pill tone="warning">Waiting for you</Pill>}</li>
              ))}
            </ul>
          ) : <p className="c-muted">Nothing held.</p>}
        </Card>
      ) : null}
      {apart.length ? (
        <Card title="Opened apart">
          <ul className="dp-checks">
            {apart.map((x) => (
              <li key={x.id}><button className="dp-link" onClick={() => to.batch(x.id)}>#{x.pr_number} {(x.title || x.branch).replace(/^Security: /, "").replace(/ \(.*\)$/, "")}</button>
                {x.kind === "security" ? <Pill tone="danger">Security</Pill> : <Pill tone="plain">On its own</Pill>}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      {b.state === "open" ? (
        <Card title="Ask the Lemma">
          <label className="c-field">
            <span>Here, or as a comment starting with @lemma on GitHub</span>
            <textarea className="c-textarea dp-ask" rows={2} value={ask} placeholder="Drop vite and run the tests again"
              onChange={(e) => setAsk(e.target.value)} />
          </label>
          <div className="c-row dp-wrap-row dp-ask-row">
            <Button size="sm" busy={sending} disabled={!ask.trim()} onClick={() => void send()}>Send</Button>
            <span className="c-faint dp-small">The Lemma never merges on its own.</span>
          </div>
        </Card>
      ) : null}
      <p className="dp-foot">Changes in <b>{short(b.repo)}</b> are pushed to <Mono>{b.branch}</Mono> only.</p>
    </aside>
  );
}
