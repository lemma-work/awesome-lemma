// A file's diff with the findings under the lines they are about (from the
// Factory pod's components/Code.tsx, on the kit's tokens). The code scrolls
// sideways inside its own box; a finding between two stretches of code is
// always the page's width, so it reads at 375px.

import { useState, type ReactNode } from "react";
import { ExternalLink, Wrench } from "lucide-react";
import { Button, Pill, canOpenApps, cx, openApp, useToast } from "@lemma-plugins/kit";
import { act, errText, useWho, whoIs, type Prr } from "./data";
import { parsePatch, shownLines, suggestionLines, type DiffHunk, type DiffLine } from "./diff";
import type { GhFile } from "./github";
import { SeverityPill, short } from "./marks";
import type { Finding, Rule } from "./types";

/** A finding is drawn under the last line it points at. */
const anchor = (f: Finding) => f.end_line ?? f.line;

type Seg = { kind: "code"; rows: ({ hunk: DiffHunk } | { line: DiffLine })[] } | { kind: "notes"; findings: Finding[] };

/** The diff cut where findings sit, so each stretch of code scrolls on its own. */
function segments(hunks: DiffHunk[], findings: Finding[]): Seg[] {
  const at = (n?: number) => (n == null ? [] : findings.filter((f) => anchor(f) === n));
  const out: Seg[] = [];
  let code: Seg & { kind: "code" } = { kind: "code", rows: [] };
  for (const h of hunks) {
    code.rows.push({ hunk: h });
    for (const l of h.lines) {
      code.rows.push({ line: l });
      const notes = l.kind !== "del" ? at(l.new) : [];
      if (notes.length) {
        out.push(code, { kind: "notes", findings: notes });
        code = { kind: "code", rows: [] };
      }
    }
  }
  if (code.rows.length) out.push(code);
  return out;
}

function Rows({ rows }: { rows: ({ hunk: DiffHunk } | { line: DiffLine })[] }) {
  return (
    <div className="prr-code" role="region" aria-label="Code" tabIndex={0}>
      <div className="prr-code__in">
        {rows.map((r, i) =>
          "hunk" in r ? (
            <div key={i} className="prr-ln prr-ln--hunk">
              <span className="prr-ln__no" />
              <span className="prr-ln__no" />
              <span className="prr-ln__sg" />
              <span className="prr-ln__t">{`@@ -${r.hunk.oldStart} +${r.hunk.newStart} @@ ${r.hunk.header}`}</span>
            </div>
          ) : (
            <div key={i} className={cx("prr-ln", r.line.kind === "add" && "prr-ln--add", r.line.kind === "del" && "prr-ln--del")}>
              <span className="prr-ln__no">{r.line.old ?? ""}</span>
              <span className="prr-ln__no">{r.line.new ?? ""}</span>
              <span className="prr-ln__sg">{r.line.kind === "add" ? "+" : r.line.kind === "del" ? "−" : ""}</span>
              <span className="prr-ln__t">{r.line.text}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export function FileDiff({ file, findings, prr, open, onToggle, badge }: {
  file: GhFile; findings: Finding[]; prr: Prr; open: boolean; onToggle: () => void; badge?: ReactNode;
}) {
  const hunks = file.patch ? parsePatch(file.patch) : [];
  const shown = shownLines(hunks);
  const loose = findings.filter((f) => !anchor(f) || !shown.has(anchor(f)!));
  const placed = findings.filter((f) => anchor(f) && shown.has(anchor(f)!));
  return (
    <section className="prr-file" id={`f-${file.filename}`}>
      <div className="prr-file__head">
        <button type="button" className="prr-file__name" onClick={onToggle} aria-expanded={open}>
          <span className="prr-mono c-ellipsis">{file.filename}</span>
        </button>
        <span className="c-faint prr-meta num">+{file.additions} −{file.deletions}{file.status === "added" ? " · new file" : file.status === "removed" ? " · deleted" : file.status === "renamed" ? " · renamed" : ""}</span>
        <span className="c-grow" />
        {badge}
      </div>
      {open ? (
        <>
          {loose.length ? <div className="prr-notes">{loose.map((f) => <FindingCard key={f.id} f={f} prr={prr} />)}</div> : null}
          {!file.patch ? (
            <div className="prr-file__note">GitHub sends no diff for this file (too large or binary).{file.blob_url ? <> <a className="prr-link" href={file.blob_url} target="_blank" rel="noreferrer">View on GitHub</a></> : null}</div>
          ) : (
            segments(hunks, placed).map((s, i) => (s.kind === "code" ? <Rows key={i} rows={s.rows} /> : <div key={i} className="prr-notes">{s.findings.map((f) => <FindingCard key={f.id} f={f} prr={prr} />)}</div>))
          )}
        </>
      ) : null}
    </section>
  );
}

/* ---------- one finding ---------- */

export function RuleLine({ rule }: { rule: Rule | undefined }) {
  if (!rule) return null;
  const from = rule.source_kind === "comments" ? `proposed from review comments${rule.source ? `: ${rule.source}` : ""}` : rule.source_kind === "typed" ? `added by hand${rule.source ? `, ${rule.source}` : ""}` : rule.source;
  return (
    <div className="prr-rule">
      <span className="c-faint">Breaks</span> {rule.text}
      {from ? <span className="c-faint"> · from {rule.source_kind === "file" ? <span className="prr-mono">{from}</span> : from}</span> : null}
    </div>
  );
}

export function FindingCard({ f, prr, compact, onJump }: { f: Finding; prr: Prr; compact?: boolean; onJump?: () => void }) {
  const { me, people } = useWho();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [task, setTask] = useState<{ id?: string; number?: number } | null>(f.task_id ? { id: f.task_id } : null);
  const rule = f.rule_id ? prr.ruleById.get(f.rule_id) : undefined;
  const latest = prr.roundsByPr.get(f.pull_request_id)?.find((r) => r.status !== "superseded");
  const firstSeq = prr.seqOf(f.first_round);
  const by = f.decided_by ? whoIs(prr, people, me?.id, f.decided_by) : null;

  const run = async (what: string, fn: () => Promise<{ message?: string } | undefined>, done: string) => {
    setBusy(what);
    try {
      const out = await fn();
      toast(out?.message || done);
    } catch (e) {
      toast(`Couldn't do that: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const fix = () =>
    run("fix", async () => {
      const out = await act.fixTask(f.id);
      setTask({ id: out?.task_id, number: out?.number });
      return { message: out?.message || (out?.number ? `Made task #${out.number}: ${f.title}` : `Made a task: ${f.title}`) };
    }, "Made a task.");

  const state =
    f.state === "fixed" ? <Pill tone="success">Fixed{f.fixed_in ? ` in ${short(f.fixed_in)}` : ""}</Pill>
    : f.state === "dismissed" ? <Pill dot={false}>Not worth fixing{by ? `, said ${by}` : ""}</Pill>
    : f.state === "wrong" ? <Pill dot={false}>Marked wrong{by ? ` by ${by}` : ""}</Pill>
    : firstSeq && latest && firstSeq < latest.seq ? <Pill dot={false}>Found in round {firstSeq}</Pill>
    : f.found_by === "code" ? <Pill dot={false}>Found by code</Pill>
    : null;

  return (
    <article className={cx("prr-fnd", f.state !== "open" && "is-decided", compact && "prr-fnd--compact")}>
      <div className="prr-fnd__head">
        <SeverityPill s={f.severity} />
        <span className="prr-fnd__title">{f.title}</span>
        <span className="c-grow" />
        {state}
      </div>
      <div className="prr-fnd__body">
        {onJump && f.path ? (
          <button type="button" className="prr-link prr-mono prr-meta" onClick={onJump}>{f.path}{f.line ? `:${f.line}` : ""}</button>
        ) : null}
        {f.body && !(compact && f.state !== "open") ? <div className={f.found_by === "code" ? "c-muted" : undefined}>{f.found_by === "code" ? "Found by code, not the model: " : ""}{f.body}</div> : null}
        {!(compact && f.state !== "open") ? <RuleLine rule={rule} /> : null}
        {f.suggestion && f.state === "open" && !compact ? (
          <div className="prr-sug prr-code" tabIndex={0} role="region" aria-label="Suggested change">
            <div className="prr-code__in">
              {suggestionLines(f.suggestion).map((l, i) => (
                <div key={i} className={cx("prr-ln", "prr-ln--s", l.kind === "add" && "prr-ln--add", l.kind === "del" && "prr-ln--del")}>
                  <span className="prr-ln__sg">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}</span>
                  <span className="prr-ln__t">{l.text}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {f.state === "open" ? (
          <div className="prr-fnd__acts">
            {task ? (
              <span className="c-row prr-meta">
                <Pill tone="info">Task{task.number ? ` #${task.number}` : ""} made</Pill>
                {canOpenApps() && task.id ? (
                  <button type="button" className="prr-link" onClick={() => void openApp("tasks", `/${task.id}`)}>
                    Open in Tasks <ExternalLink size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            ) : (
              <Button size="sm" icon={Wrench} busy={busy === "fix"} onClick={() => void fix()}>Fix it</Button>
            )}
            <Button size="sm" busy={busy === "not"} onClick={() => void run("not", () => act.decide(f.id, "not_worth"), "Dismissed. It won't be raised again on a later push.")}>Not worth fixing</Button>
            <Button size="sm" busy={busy === "wrong"} onClick={() => void run("wrong", () => act.decide(f.id, "wrong"), "Marked wrong. It counts against the rule's record.")}>The finding is wrong</Button>
            {!compact ? <span className="c-faint prr-meta">A dismissed finding never comes back on a later push.</span> : null}
          </div>
        ) : f.state !== "fixed" ? (
          <div className="prr-fnd__acts">
            <Button size="sm" variant="ghost" busy={busy === "reopen"} onClick={() => void run("reopen", () => act.decide(f.id, "reopen"), "Reopened.")}>Reopen</Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
