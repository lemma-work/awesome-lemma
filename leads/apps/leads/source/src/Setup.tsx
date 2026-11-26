// Set-up, one person at a time. The `leads-setup` workflow does the work and
// waits on three forms; this is the screen for them.
//
//   people map   Lead research looks up the people People map finds
//   fit          who fits the team (one per Lemma): a sentence and example companies
//   kinds        which kinds of people to look up, how many a day
//   reading      "worth looking up?" for each of them (Decisions)
//   review       who it would look up first, and who it skipped
//
// The run's id is kept on the person's settings, so a reload lands where they were.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleHelp, Plus, ScanSearch, SkipForward, Undo2, Users, X } from "lucide-react";
import {
  Avatar, Button, Card, Face, Logo, Pill, Spinner, client, cx, nameOf, openApp, plural, runFunction, useToast, errorText,
} from "@lemma-plugins/kit";
import { startSetup } from "./App";
import { useLeads } from "./data";
import { KIND_LABEL } from "./marks";
import type { Lead } from "./types";

type Step = { node_id: string; status?: string; output_data?: Record<string, unknown> | null };
type Run = { id: string; status?: string; active_wait?: { node_id?: string } | null; step_history?: Step[] };

const STEPS = ["People map", "Who fits your team", "Who to look up", "Reading", "Review"];

function stepOf(run: Run | null): number {
  if (!run) return 1;
  const node = run.active_wait?.node_id || run.step_history?.[run.step_history.length - 1]?.node_id || "";
  if (["prepare", "fit"].includes(node)) return 1;
  if (node === "kinds") return 2;
  if (["apply", "read", "read_pass"].includes(node)) return 3;
  return 4;
}

function outputs(run: Run | null, node: string): Record<string, unknown>[] {
  return (run?.step_history || []).filter((s) => s.node_id === node && s.output_data).map((s) => s.output_data as Record<string, unknown>);
}

function Rail({ at: here }: { at: number }) {
  return (
    <ol className="ld-rail" aria-label="Set-up steps">
      {STEPS.map((label, i) => (
        <li key={label} className={i < here ? "is-done" : i === here ? "is-here" : ""} aria-current={i === here ? "step" : undefined}>
          <span className="ld-rail__dot">{i < here ? <Check size={11} aria-hidden="true" /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

/** Before Lead research can start: People map's own set-up. */
export function Bases() {
  const { peopleSetup } = useLeads();
  const started = peopleSetup && peopleSetup !== "start";
  return (
    <div className="c-app">
      <div className="c-setup">
        <Rail at={0} />
        <h1>Look up each new person and company the first time they matter</h1>
        <p className="c-setup__lead">
          Lead research looks up the people People map finds in your mail and meetings: their role, what their company
          does, its size, recent news and how well it fits you, every fact with its source. Set up People map and come
          back; your set-up here starts by itself.
        </p>
        <Card flush>
          <div className="c-list">
            <div className="c-li">
              <span className="ld-tile" aria-hidden="true"><Users size={15} /></span>
              <div className="c-li__main">
                <div>People map</div>
                <div className="c-li__sub">{started ? "Set-up started, not finished." : "Not set up yet."}</div>
              </div>
              <Button size="sm" onClick={() => void openApp("people", "/")}>{started ? "Finish it" : "Set it up"}</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function Setup() {
  const { settings, reload } = useLeads();
  const [run, setRun] = useState<Run | null>(null);
  const [lost, setLost] = useState(false);
  const runId = settings?.setup_run_id || null;

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

  const failed = !!run && ["FAILED", "CANCELLED"].includes(String(run.status));
  const waiting = run?.status === "WAITING" ? run.active_wait?.node_id : null;
  useEffect(() => {
    if (waiting === "review") void reload("leads");
  }, [waiting, reload]);

  const restart = async () => {
    await startSetup(settings?.id || null);
    setRun(null);
    await reload("settings");
  };

  let body;
  if (!runId || lost || failed) body = <Restart failed={failed} onRestart={restart} />;
  else if (waiting === "fit") body = <Fit run={run!} />;
  else if (waiting === "kinds") body = <Kinds run={run!} />;
  else if (waiting === "review") body = <Review run={run!} />;
  else body = <Working run={run} />;
  return (
    <div className={cx("c-app", waiting === "review" && "ld-setup--wide")}>
      <div className="c-setup">
        <Rail at={run && !failed ? stepOf(run) : 1} />
        {body}
      </div>
    </div>
  );
}

function Restart({ failed, onRestart }: { failed: boolean; onRestart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1>{failed ? "The set-up stopped partway" : "Set up Lead research"}</h1>
      <p className="c-setup__lead">
        {failed ? "Start it again; what you already answered is kept." : "Your set-up wasn't found. Start it again."}
      </p>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => { setBusy(true); void onRestart().finally(() => setBusy(false)); }}>
          Start the set-up
        </Button>
      </div>
    </>
  );
}

async function submit(runId: string, node: string, inputs: Record<string, unknown>): Promise<void> {
  await client.workflows.runs.submitForm(runId, { node_id: node, inputs } as never);
}

/* ---------- 1. who fits you ---------- */

function Fit({ run }: { run: Run }) {
  const toast = useToast();
  const prepared = outputs(run, "prepare")[0] as { fit_sentence?: string | null; fit_examples?: string[]; profile_by?: string | null; team_profile?: boolean; suggestions?: { name: string; domain: string | null }[] } | undefined;
  const [sentence, setSentence] = useState(prepared?.fit_sentence || "");
  const [examples, setExamples] = useState<string[]>(prepared?.fit_examples || []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (prepared?.fit_sentence) setSentence(prepared.fit_sentence);
    if (prepared?.fit_examples?.length) setExamples(prepared.fit_examples);
  }, [prepared?.fit_sentence, prepared?.fit_examples?.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (name: string) => {
    const n = name.trim();
    if (!n) return;
    if (!examples.some((e) => e.toLowerCase() === n.toLowerCase())) setExamples([...examples, n].slice(0, 12));
    setDraft("");
  };
  const offered = (prepared?.suggestions || []).filter((s) => !examples.some((e) => e.toLowerCase() === (s.name || "").toLowerCase()));
  const go = async () => {
    if (sentence.trim().length < 8) return toast("Say who fits you in a few words, e.g. B2B software teams of 20–200 in Europe.");
    setBusy(true);
    try {
      await submit(run.id, "fit", { fit_sentence: sentence.trim(), fit_examples: examples });
    } catch (e) {
      toast(`Couldn't keep that: ${errorText(e)}`);
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Who fits your team?</h1>
      <p className="c-setup__lead">
        {prepared?.team_profile
          ? `Your team's description${prepared.profile_by ? `, written by ${prepared.profile_by}` : ""}. It's one for everyone here: keep it, or change it for the whole team.`
          : "One sentence about the customers, investors or partners your team wants more of. It's one for everyone here; anyone can change it."}{" "}
        Each company gets a fit from 1 to 5 against it, and when someone changes a score, companies like it are scored like it.
      </p>
      <Card>
        <label className="c-field">
          <span>In one sentence</span>
          <textarea className="c-input c-textarea ld-sentence" rows={2} value={sentence} maxLength={400}
            onChange={(e) => setSentence(e.target.value)} placeholder="B2B software teams of 20–200 people in Europe" />
        </label>
        <div className="c-field" style={{ marginTop: 14 }}>
          <span>A few companies that fit well</span>
          <div className="ld-chips">
            {examples.map((e) => (
              <span key={e} className="ld-chip">
                {e}
                <button type="button" aria-label={`Remove ${e}`} onClick={() => setExamples(examples.filter((x) => x !== e))}><X size={12} /></button>
              </span>
            ))}
            <form className="ld-chip-add" onSubmit={(ev) => { ev.preventDefault(); add(draft); }}>
              <input className="c-input" value={draft} onChange={(ev) => setDraft(ev.target.value)} placeholder="A company or its website" aria-label="Add a company" />
              <Button size="sm" icon={Plus} type="submit">Add</Button>
            </form>
          </div>
          {offered.length ? (
            <div className="ld-offer">
              <span className="c-faint">Your customers in People map:</span>
              {offered.map((s) => (
                <button key={s.name} type="button" className="ld-offer__chip" onClick={() => add(s.name)}>
                  <Logo name={s.name} domain={s.domain} size={16} />{s.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </Card>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => void go()}>Continue</Button>
      </div>
    </>
  );
}

/* ---------- 2. who to look up ---------- */

function Kinds({ run }: { run: Run }) {
  const toast = useToast();
  const prepared = outputs(run, "prepare")[0] as { kinds?: { key: string; label: string; sentence: string; count: number; never: boolean }[]; kinds_on?: string[]; daily_limit?: number } | undefined;
  const kinds = prepared?.kinds || [];
  const [on, setOn] = useState<Set<string>>(() => new Set(prepared?.kinds_on || ["customer", "investor", "partner"]));
  const [limit, setLimit] = useState(String(prepared?.daily_limit || 10));
  const [busy, setBusy] = useState(false);
  const count = kinds.filter((k) => on.has(k.key) && !k.never).reduce((s, k) => s + k.count, 0);
  const go = async () => {
    const n = Math.round(Number(limit));
    if (!on.size) return toast("Pick at least one kind of person.");
    if (!Number.isFinite(n) || n < 1 || n > 100) return toast("A daily limit is between 1 and 100.");
    setBusy(true);
    try {
      await submit(run.id, "kinds", { kinds: [...on], daily_limit: n });
    } catch (e) {
      toast(`Couldn't keep that: ${errorText(e)}`);
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Who should it look up?</h1>
      <p className="c-setup__lead">
        The kinds of people People map found. Each new one is asked "worth looking up?" first; colleagues and people
        you marked other are never looked up.
      </p>
      <Card flush>
        <div className="c-choices" style={{ marginTop: 0 }}>
          {kinds.map((k) => (
            <label key={k.key} className={cx("c-choice ld-choice", k.never && "ld-dim")}>
              <input type="checkbox" className="c-check" checked={!k.never && on.has(k.key)} disabled={k.never}
                onChange={(e) => setOn((s) => { const n = new Set(s); if (e.target.checked) n.add(k.key); else n.delete(k.key); return n; })} />
              <span className="c-grow">
                <span className="ld-choice__title">{k.label} <span className="c-faint num">{k.count}</span></span>
                <span className="ld-choice__sub">{k.sentence}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
      <Card>
        <label className="c-field">
          <span>Look-ups a day, at most</span>
          <input className="c-input ld-limit num" type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(e.target.value)} />
          <small className="c-field__hint">
            Each look-up is a short web search by an agent. Past the limit, the rest wait for the next day, best first:
            someone you're meeting, then someone who wrote to you.
          </small>
        </label>
      </Card>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => void go()}>Read {plural(count, "person", "people")}</Button>
      </div>
    </>
  );
}

/* ---------- 3. reading ---------- */

function Working({ run }: { run: Run | null }) {
  const apply = outputs(run, "apply")[0] as { pending?: number } | undefined;
  const passes = outputs(run, "read_pass") as { read?: number; worth?: number; skipped?: number; unsure?: number; ruled?: number }[];
  const sum = (k: "read" | "worth" | "skipped" | "unsure" | "ruled") => passes.reduce((s, p) => s + Number(p[k] || 0), 0);
  const total = Number(apply?.pending || 0);
  const read = sum("read") + sum("ruled");
  const node = run?.active_wait?.node_id || run?.step_history?.[run.step_history.length - 1]?.node_id || "";
  const line = !apply ? "Keeping your answers…"
    : node === "done" || node === "memory" ? "Starting the first look-ups…"
      : "Asking once for each person: worth looking up, from your own mail and meetings?";
  return (
    <>
      <div className="c-row" style={{ gap: 12 }}>
        <Face size={40} />
        <h1 style={{ marginTop: 0 }}>Reading your people</h1>
      </div>
      <p className="c-setup__lead"><Spinner /> {line}</p>
      <div className="c-counters">
        <div className="c-counter"><div className="c-counter__n">{apply ? sum("worth") : "…"}</div><div className="c-counter__l">worth a look-up</div></div>
        <div className="c-counter"><div className="c-counter__n">{apply ? sum("skipped") : "…"}</div><div className="c-counter__l">skipped</div></div>
        <div className="c-counter"><div className="c-counter__n">{apply ? sum("unsure") : "…"}</div><div className="c-counter__l">not sure</div></div>
      </div>
      <div className="c-meter" aria-label="Read so far"><span style={{ width: `${total ? Math.min(100, (100 * read) / total) : apply ? 8 : 2}%` }} /></div>
      <p className="c-setup__note">{apply ? `Read ${read} of ${total}. ` : ""}Nothing is looked up until you've seen the list.</p>
    </>
  );
}

/* ---------- 4. review ---------- */

/** The order today's places go in: a meeting ahead, someone who wrote, the most recent. */
function bestFirst(a: Lead, b: Lead): number {
  const now = Date.now();
  const meet = (l: Lead) => (l.next_meeting_at && new Date(l.next_meeting_at).getTime() > now ? 1 : 0);
  return meet(b) - meet(a) || (b.last_inbound_at || "").localeCompare(a.last_inbound_at || "") || (b.last_contact_at || "").localeCompare(a.last_contact_at || "");
}

function Review({ run }: { run: Run }) {
  const { all, limit, reload } = useLeads();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [showSkipped, setShowSkipped] = useState(false);
  const proposed = useMemo(() => all.filter((l) => l.state === "proposed").sort(bestFirst), [all]);
  const unsure = useMemo(() => all.filter((l) => l.state === "unsure"), [all]);
  const skipped = useMemo(() => all.filter((l) => l.state === "skipped"), [all]);

  const correct = async (input: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const out = await runFunction<{ message: string }>("leads_correct", input);
      toast(out.message);
      await reload("leads");
    } catch (e) {
      toast(`Couldn't change that: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const finish = async () => {
    setBusy("finish");
    try {
      await submit(run.id, "review", { looked: true });
    } catch (e) {
      toast(`Couldn't start: ${errorText(e)}`);
      setBusy("");
    }
  };
  const later = Math.max(0, proposed.length - limit);

  return (
    <>
      <h1>{plural(proposed.length, "person", "people")} worth looking up</h1>
      <p className="c-setup__lead">
        {proposed.length ? `${Math.min(limit, proposed.length)} today` : "Nobody yet"}
        {later ? `, the other ${later} over the next ${Math.ceil(later / limit)} ${Math.ceil(later / limit) === 1 ? "day" : "days"}` : ""}
        {skipped.length ? `; ${skipped.length} skipped` : ""}{unsure.length ? `, ${unsure.length} it wasn't sure of` : ""}.
        Skip anyone you know well enough, add anyone it left out; each change teaches the next answer.
      </p>

      {unsure.length ? (
        <Card title="Not sure" icon={CircleHelp} count={unsure.length} flush>
          <div className="c-list">
            {unsure.map((l) => (
              <PersonLine key={l.id} lead={l} sub={l.worth_reason}>
                <Button size="sm" busy={busy === `y-${l.id}`} onClick={() => void correct({ person_id: l.id, worth: true }, `y-${l.id}`)}>Look up</Button>
                <Button size="sm" variant="ghost" busy={busy === `n-${l.id}`} onClick={() => void correct({ person_id: l.id, worth: false }, `n-${l.id}`)}>Skip</Button>
              </PersonLine>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="To look up, best first" icon={ScanSearch} count={proposed.length} flush>
        <div className="c-list ld-review">
          {proposed.map((l, i) => (
            <PersonLine key={l.id} lead={l} sub={l.worth_reason} mark={i < limit ? <Pill tone="info">Today</Pill> : <Pill>Later</Pill>}>
              <Button size="sm" variant="ghost" icon={SkipForward} label={`Skip ${nameOf(l.name, l.handle)}`} busy={busy === `n-${l.id}`}
                onClick={() => void correct({ person_id: l.id, worth: false }, `n-${l.id}`)} />
            </PersonLine>
          ))}
          {proposed.length === 0 ? <div className="c-li c-muted">Nobody to look up yet. Add someone it skipped, below.</div> : null}
        </div>
      </Card>

      {skipped.length ? (
        <Card flush>
          <div className="c-list">
            <button type="button" className="c-li ld-disclose" aria-expanded={showSkipped} onClick={() => setShowSkipped((v) => !v)}>
              <span className="c-grow c-muted">{showSkipped ? "Hide" : "Show"} the {plural(skipped.length, "person", "people")} it skipped</span>
            </button>
            {showSkipped ? skipped.map((l) => (
              <PersonLine key={l.id} lead={l} sub={l.worth_reason}>
                {l.worth_by === "rule" ? null : (
                  <Button size="sm" icon={Undo2} busy={busy === `y-${l.id}`} onClick={() => void correct({ person_id: l.id, worth: true }, `y-${l.id}`)}>Look up</Button>
                )}
              </PersonLine>
            )) : null}
          </div>
        </Card>
      ) : null}

      <div className="c-setup__row ld-sticky-row">
        <Button variant="primary" busy={busy === "finish"} onClick={() => void finish()}>Start looking up</Button>
      </div>
    </>
  );
}

function PersonLine({ lead, sub, mark, children }: { lead: Lead; sub?: string | null; mark?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="c-li ld-line">
      <Avatar name={lead.name} email={lead.handle} size={26} />
      <div className="c-li__main">
        <div className="c-ellipsis">
          {nameOf(lead.name, lead.handle)}
          <span className="c-faint"> · {lead.company_name || lead.handle}{lead.kind ? ` · ${KIND_LABEL[lead.kind] || lead.kind}` : ""}</span>
        </div>
        {sub ? <div className="c-li__sub">{sub}</div> : null}
      </div>
      {mark}
      {children}
    </div>
  );
}
