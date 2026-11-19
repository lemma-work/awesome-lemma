// Set-up, one person at a time. The `deals-setup` workflow does the work and
// waits on its forms; this is the screen for them.
//
//   base       People map's own set-up (Deal tracker reads what it, Mail and Meetings read)
//   stages     the team's stages (only the first person)
//   currency   the team's currency (only the first person)
//   existing   paste a spreadsheet, find them in the last 30 days, or both
//   reading    the two questions on each conversation and meeting with a company
//   review     what it found, each with its sentence: keep or dismiss
//   day        the weekly review's day (only the first person)
//
// The run's id is on the person's deals_member row, so a reload lands where they were.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ClipboardPaste, KanbanSquare, Search, Sparkles, Users } from "lucide-react";
import {
  Button, Card, Pill, Switch, client, cx, money, openApp, plural, runFunction, update, useToast,
} from "@lemma-plugins/kit";
import { useDeals } from "./data";
import { ProposalCard } from "./Proposal";
import { StagesEditor, stageProblem, type StageDraft } from "./Settings";

type Step = { node_id: string; status?: string; output_data?: Record<string, unknown> | null };
type Run = { id: string; status?: string; active_wait?: { node_id?: string } | null; step_history?: Step[] };

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "SGD", "AED", "CHF", "JPY"];

function outputs(run: Run | null, node: string): Record<string, unknown>[] {
  return (run?.step_history || []).filter((s) => s.node_id === node && s.output_data).map((s) => s.output_data as Record<string, unknown>);
}

function Rail({ steps, at }: { steps: string[]; at: number }) {
  return (
    <ol className="dt-rail-steps" aria-label="Set-up steps">
      {steps.map((label, i) => (
        <li key={label} className={i < at ? "is-done" : i === at ? "is-here" : ""} aria-current={i === at ? "step" : undefined}>
          <span className="dt-rail-steps__dot">{i < at ? <Check size={11} aria-hidden="true" /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

/** Before Deal tracker can start: People map's own set-up. */
export function Base() {
  return (
    <div className="c-app">
      <div className="c-setup">
        <Rail steps={["People map", "Stages", "Your deals", "Weekly review"]} at={0} />
        <h1>Deals that move when the conversation does</h1>
        <p className="c-setup__lead">
          Deal tracker reads what People map, Mail and Meetings read: who you talk to, at which company, and what was said.
          Set up People map first and come back; your set-up here starts by itself.
        </p>
        <Card flush>
          <div className="c-list">
            <div className="c-li">
              <span className="dt-tile" aria-hidden="true"><Users size={15} /></span>
              <div className="c-li__main">
                <div>People map</div>
                <div className="c-li__sub">Everyone you deal with and their companies, from your mail and meetings.</div>
              </div>
              <Button size="sm" variant="primary" onClick={() => void openApp("people", "/")}>Set it up</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function Setup() {
  const { member, reload } = useDeals();
  const toast = useToast();
  const [run, setRun] = useState<Run | null>(null);
  const [lost, setLost] = useState(false);
  const runId = member?.setup_run_id || null;

  const poll = useCallback(async () => {
    if (!runId) return;
    try {
      const fresh = (await client.workflows.runs.get(runId)) as unknown as Run;
      setRun(fresh);
      setLost(false);
      if (fresh.status === "COMPLETED") void reload();
    } catch {
      setLost(true);
    }
  }, [runId, reload]);

  useEffect(() => {
    if (!runId) return;
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => window.clearInterval(timer);
  }, [runId, poll]);

  const prepared = outputs(run, "prepare")[0] as { team_ready?: boolean; set_up_by?: string } | undefined;
  const team = prepared?.team_ready === true;
  const steps = team ? ["People map", "Your deals", "What it found"] : ["People map", "Stages", "Currency", "Your deals", "What it found", "Weekly review"];
  const waiting = run?.status === "WAITING" ? run.active_wait?.node_id : null;
  const failed = !!run && ["FAILED", "CANCELLED"].includes(String(run.status));
  const node = waiting || run?.step_history?.[run.step_history.length - 1]?.node_id || "prepare";
  const at = team
    ? ({ existing: 1, sheet: 2, want_find: 2, find: 2, find_loop: 2, find_pass: 2, found: 2, extract: 2, propose: 2, review: 2,
        day_gate: 3, done: 3, needs: 3 } as Record<string, number>)[node] ?? 1
    : ({ prepare: 1, team: 1, stages: 1, currency: 2, apply: 2, existing: 3, sheet: 4, want_find: 4, find: 4, find_loop: 4, find_pass: 4, found: 4,
        extract: 4, propose: 4, review: 4, day_gate: 5, day: 5, done: 6, needs: 6 } as Record<string, number>)[node] ?? 1;

  useEffect(() => {
    if (waiting === "review") void reload("changes");
  }, [waiting, reload]);

  const submit = async (nodeId: string, inputs: Record<string, unknown>) => {
    if (!run) return;
    try {
      await client.workflows.runs.submitForm(run.id, { node_id: nodeId, inputs } as never);
      await poll();
    } catch (e) {
      toast(`Couldn't keep that: ${e instanceof Error ? e.message : e}`);
      throw e;
    }
  };
  const restart = async () => {
    if (!member) return;
    const fresh = (await client.workflows.runs.create("deals-setup")) as unknown as Run;
    await update("deals_member", member.id, { setup_run_id: fresh.id, setup_step: "start" });
    setRun(null);
    await reload("member");
  };

  let body;
  if (!runId || lost || failed) body = <Restart failed={failed} onRestart={restart} />;
  else if (waiting === "stages") body = <Stages run={run!} submit={submit} />;
  else if (waiting === "currency") body = <Currency run={run!} submit={submit} />;
  else if (waiting === "existing") body = <Existing team={team} by={prepared?.set_up_by || null} submit={submit} />;
  else if (waiting === "review") body = <Review run={run!} submit={submit} />;
  else if (waiting === "day") body = <Day run={run!} submit={submit} />;
  else body = <Working run={run} />;
  return (
    <div className={cx("c-app", (waiting === "review" || waiting === "existing" || waiting === "stages") && "dt-setup--wide")}>
      <div className="c-setup">
        <Rail steps={steps} at={at} />
        {body}
      </div>
    </div>
  );
}

function Restart({ failed, onRestart }: { failed: boolean; onRestart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1>{failed ? "The set-up stopped partway" : "Set up Deal tracker"}</h1>
      <p className="c-setup__lead">{failed ? "Start it again; deals and anything you kept stay." : "Your set-up wasn't found. Start it again."}</p>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => { setBusy(true); void onRestart().finally(() => setBusy(false)); }}>Start the set-up</Button>
      </div>
    </>
  );
}

type Submit = (node: string, inputs: Record<string, unknown>) => Promise<void>;

function Stages({ run, submit }: { run: Run; submit: Submit }) {
  const toast = useToast();
  const proposed = (outputs(run, "prepare")[0]?.stages as StageDraft[] | undefined) || [];
  const [draft, setDraft] = useState<StageDraft[]>(() => proposed.map((s) => ({ id: s.id, name: s.name, kind: s.kind, meaning: s.meaning || "" })));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!draft.length && proposed.length) setDraft(proposed.map((s) => ({ id: s.id, name: s.name, kind: s.kind, meaning: s.meaning || "" })));
  }, [proposed.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    const problem = stageProblem(draft);
    if (problem) return toast(problem);
    setBusy(true);
    await submit("stages", { stages: draft.map((s) => ({ ...(s.id ? { id: s.id } : {}), name: s.name.trim(), kind: s.kind, meaning: s.meaning.trim() })) }).catch(() => setBusy(false));
  };
  return (
    <>
      <h1>The stages a deal goes through</h1>
      <p className="c-setup__lead">
        These are your team's, in order. Rename, add or remove any. Each one's meaning is what the reader goes by when a
        conversation moves a deal, so say it the way you would to a new colleague.
      </p>
      <Card><StagesEditor value={draft} onChange={setDraft} /></Card>
      <div className="c-setup__row"><Button variant="primary" busy={busy} onClick={() => void go()}>These are our stages</Button></div>
    </>
  );
}

function Currency({ run, submit }: { run: Run; submit: Submit }) {
  const proposed = String(outputs(run, "prepare")[0]?.currency || "USD");
  const [value, setValue] = useState(proposed);
  const [busy, setBusy] = useState(false);
  const ok = /^[A-Z]{3}$/.test(value);
  return (
    <>
      <h1>Which currency do you sell in?</h1>
      <p className="c-setup__lead">Totals on the board and in the weekly review are in this one. A single deal can still be in another.</p>
      <Card>
        <div className="dt-chips" role="radiogroup" aria-label="Currency">
          {[...new Set([proposed, ...CURRENCIES])].map((c) => (
            <button key={c} type="button" role="radio" aria-checked={value === c} className={cx("dt-chip", value === c && "is-on")} onClick={() => setValue(c)}>{c}</button>
          ))}
        </div>
        <label className="c-field dt-currency"><span>Or another (three letters)</span>
          <input className="c-input" value={value} maxLength={3} onChange={(e) => setValue(e.target.value.toUpperCase())} />
        </label>
      </Card>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} disabled={!ok} onClick={() => { setBusy(true); void submit("currency", { currency: value }).catch(() => setBusy(false)); }}>
          Use {ok ? value : "it"}
        </Button>
      </div>
    </>
  );
}

interface SheetRow { row: number; name: string; company_name: string | null; stage: string | null; amount: number | null; currency: string; close_date: string | null; problems: string[]; ok: boolean }

function Existing({ team, by, submit }: { team: boolean; by: string | null; submit: Submit }) {
  const toast = useToast();
  const [sheet, setSheet] = useState("");
  const [find, setFind] = useState(true);
  const [preview, setPreview] = useState<{ rows: SheetRow[]; message: string; columns: Record<string, string> } | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const look = async (text: string) => {
    if (!text.trim()) return setPreview(null);
    setReading(true);
    try {
      setPreview(await runFunction("deals_sheet", { text, mode: "preview" }));
    } catch (e) {
      toast(`Couldn't read it: ${e instanceof Error ? e.message : e}`);
    } finally {
      setReading(false);
    }
  };
  const ready = preview?.rows.filter((r) => r.ok).length || 0;
  return (
    <>
      <h1>Bring in the deals you already have</h1>
      <p className="c-setup__lead">
        {team && by ? `${by} set up the team's stages. ` : ""}Paste them from a spreadsheet, have them found in your last 30 days of
        conversations and meeting notes, or both. Found ones wait for you to keep, each with the sentence it came from.
      </p>
      <Card title="Paste from a spreadsheet" icon={ClipboardPaste}>
        <textarea className="c-textarea dt-paste" value={sheet} spellCheck={false}
          placeholder={"Copy the rows from Google Sheets or Excel, with the header row:\nDeal\tCompany\tStage\tAmount\tClose date\tNext step"}
          onChange={(e) => setSheet(e.target.value)} onBlur={(e) => void look(e.currentTarget.value)}
          onPaste={(e) => { const text = e.clipboardData.getData("text"); window.setTimeout(() => void look(text), 0); }} />
        {reading ? <p className="c-muted dt-lead">Reading the rows…</p> : preview ? (
          <div className="dt-preview">
            <p className={preview.rows.length ? "c-muted" : "dt-late"}>{preview.message}</p>
            {preview.rows.length ? (
              <div className="c-table-wrap">
                <table className="c-table dt-table dt-table--static">
                  <thead><tr><th>Deal</th><th>Company</th><th>Stage</th><th className="right">Amount</th><th>Closes</th></tr></thead>
                  <tbody>
                    {preview.rows.slice(0, 8).map((r) => (
                      <tr key={r.row}>
                        <td><div className="dt-strong c-ellipsis">{r.name || "—"}</div>{r.problems.length ? <div className="dt-late dt-small">{r.problems.join("; ")}</div> : null}</td>
                        <td className="c-ellipsis">{r.company_name || "—"}</td>
                        <td>{r.stage || "—"}</td>
                        <td className="right num">{r.amount != null ? money(r.amount, r.currency) : "—"}</td>
                        <td className="num">{r.close_date || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {preview.rows.length > 8 ? <p className="c-faint dt-small">and {preview.rows.length - 8} more</p> : null}
          </div>
        ) : null}
      </Card>
      <Card title="Find them in my conversations" icon={Search}>
        <div className="c-row dt-switch-row">
          <div className="c-grow">
            <div>Read my last 30 days of mail and meeting notes for deals</div>
            <div className="c-field__hint">Only conversations and meetings with someone at a company. Two questions each: does it change a deal, and what kind. Nothing is added until you keep it.</div>
          </div>
          <Switch label="Find them in my conversations" checked={find} onChange={setFind} />
        </div>
      </Card>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => { setBusy(true); void submit("existing", { sheet: ready ? sheet : "", find }).catch(() => setBusy(false)); }}>
          {ready && find ? `Add ${plural(ready, "deal")} and look` : ready ? `Add ${plural(ready, "deal")}` : find ? "Find them" : "Skip for now"}
        </Button>
      </div>
    </>
  );
}

function Working({ run }: { run: Run | null }) {
  const found = outputs(run, "find")[0] as { conversations?: number; meetings?: number; passes?: number[] } | undefined;
  const passes = outputs(run, "find_pass") as { read?: number; yes?: number; remaining?: number }[];
  const proposed = outputs(run, "propose") as { proposed?: number }[];
  const sheet = outputs(run, "sheet")[0] as { added?: number } | undefined;
  const read = passes.reduce((s, p) => s + Number(p.read || 0), 0);
  const yes = passes.reduce((s, p) => s + Number(p.yes || 0), 0);
  const kept = proposed.reduce((s, p) => s + Number(p.proposed || 0), 0);
  const total = Math.max(1, (found?.passes?.length || 1));
  const node = run?.step_history?.[run.step_history.length - 1]?.node_id;
  if (node && ["review", "day_gate", "day", "done", "needs"].includes(node)) {
    return (
      <>
        <h1>Starting Deal tracker</h1>
        <p className="c-setup__lead">From now on your new conversations and meeting notes are read as they come in, and any change to a deal waits for you on the board.</p>
        <div className="c-meter" aria-hidden="true"><span style={{ width: "92%" }} /></div>
      </>
    );
  }
  return (
    <>
      <h1>{found ? "Reading your last 30 days" : node === "apply" || node === "prepare" ? "Getting ready" : "Keeping your answers"}</h1>
      <p className="c-setup__lead">
        {found ? `${plural(found.conversations || 0, "conversation")} and ${plural(found.meetings || 0, "meeting")} with notes. Each with someone at a company is asked whether it changes a deal; only a yes is read for the change and its sentence.`
          : "A moment."}
      </p>
      {sheet?.added ? <p className="c-setup__note">Added {plural(sheet.added, "deal")} from your spreadsheet.</p> : null}
      {found ? (
        <>
          <div className="c-counters">
            <div className="c-counter"><div className="c-counter__n">{read}</div><div className="c-counter__l">read</div></div>
            <div className="c-counter"><div className="c-counter__n">{yes}</div><div className="c-counter__l">change a deal</div></div>
            <div className="c-counter"><div className="c-counter__n">{kept}</div><div className="c-counter__l">proposed so far</div></div>
          </div>
          <div className="c-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, (100 * passes.length) / total)}%` }} /></div>
        </>
      ) : <div className="c-meter" aria-hidden="true"><span style={{ width: "12%" }} /></div>}
    </>
  );
}

function Review({ run, submit }: { run: Run; submit: Submit }) {
  const { changes } = useDeals();
  const [busy, setBusy] = useState(false);
  const sheet = outputs(run, "sheet")[0] as { added?: number } | undefined;
  const passes = outputs(run, "find_pass") as { read?: number; yes?: number }[];
  const read = passes.reduce((s, p) => s + Number(p.read || 0), 0);
  const newDeals = useMemo(() => changes.filter((c) => c.kind === "new_deal"), [changes]);
  const others = changes.filter((c) => c.kind !== "new_deal");
  return (
    <>
      <h1>{changes.length ? `It found ${plural(changes.length, "deal change")}` : "Nothing waiting"}</h1>
      <p className="c-setup__lead">
        From {plural(read, "conversation and meeting", "conversations and meetings")} with a company{sheet?.added ? `, beside the ${plural(sheet.added, "deal")} you pasted` : ""}.
        Keep what's right; dismiss what isn't, and the next read learns from it. Anything you leave waits on the board.
      </p>
      {newDeals.length ? (
        <section className="dt-found">
          <h2><KanbanSquare size={14} aria-hidden="true" />New deals <Pill dot={false}>{newDeals.length}</Pill></h2>
          <div className="dt-props-list">{newDeals.map((c) => <ProposalCard key={c.id} change={c} />)}</div>
        </section>
      ) : null}
      {others.length ? (
        <section className="dt-found">
          <h2><Sparkles size={14} aria-hidden="true" />Changes to deals <Pill dot={false}>{others.length}</Pill></h2>
          <div className="dt-props-list">{others.map((c) => <ProposalCard key={c.id} change={c} />)}</div>
        </section>
      ) : null}
      <div className="c-setup__row dt-sticky">
        <Button variant="primary" busy={busy} onClick={() => { setBusy(true); void submit("review", { looked: true }).catch(() => setBusy(false)); }}>
          {changes.length ? "Done for now" : "Continue"}
        </Button>
      </div>
    </>
  );
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function Day({ run, submit }: { run: Run; submit: Submit }) {
  const prepared = outputs(run, "prepare")[0] as { review_day?: string; review_time?: string; timezone?: string } | undefined;
  const [day, setDay] = useState(prepared?.review_day || "monday");
  const [time, setTime] = useState(prepared?.review_time || "08:00");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1>When should the team get its weekly review?</h1>
      <p className="c-setup__lead">
        What moved, what went quiet and the pipeline by stage, counted from the deals, with one summary written from those
        numbers. It's on the Review page any time; this is when the summary is written.
      </p>
      <Card>
        <div className="dt-chips" role="radiogroup" aria-label="Day">
          {DAYS.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={day === d} className={cx("dt-chip", day === d && "is-on")} onClick={() => setDay(d)}>
              {d.slice(0, 1).toUpperCase() + d.slice(1, 3)}
            </button>
          ))}
        </div>
        <label className="c-field dt-currency"><span>At ({prepared?.timezone || "your time"})</span>
          <input className="c-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </Card>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => { setBusy(true); void submit("day", { review_day: day, review_time: time }).catch(() => setBusy(false)); }}>
          Start Deal tracker
        </Button>
      </div>
    </>
  );
}
