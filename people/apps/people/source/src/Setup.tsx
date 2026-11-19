// Set-up, one person at a time. The `people-setup` workflow does the work and
// waits on three forms; this is the screen for them.
//
//   bases        Mail's and Meetings' own set-ups (People map reads what they read)
//   categories   which of Mail's categories are people you deal with
//   domains      your own domains, so colleagues aren't contacts
//   reading      everyone found, each new person read once (Decisions)
//   review       the people it found: add anyone missing, remove anyone who
//                shouldn't be there, settle the ones it wasn't sure of
//
// The run's id is kept on the person's settings, so a reload lands where they were.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, CircleHelp, Inbox, Plus, Trash2, Undo2, UserPlus, Users, X } from "lucide-react";
import {
  Avatar, Button, Card, Face, Pill, Spinner, client, cx, nameOf, openApp, plural, runFunction, update, useToast,
} from "@lemma-plugins/kit";
import { usePeople } from "./data";
import { KIND_HINT, KIND_LABEL, KindPill } from "./marks";
import { KINDS, type Kind, type Person } from "./types";

type Step = { node_id: string; status?: string; output_data?: Record<string, unknown> | null };
type Run = {
  id: string;
  status?: string;
  active_wait?: { node_id?: string } | null;
  step_history?: Step[];
};

const STEPS = ["Mail and Meetings", "Conversations", "Your domains", "Reading", "Review"];

function stepOf(run: Run | null): number {
  if (!run) return 1;
  const node = run.active_wait?.node_id || run.step_history?.[run.step_history.length - 1]?.node_id || "";
  if (["prepare", "categories"].includes(node)) return 1;
  if (node === "domains") return 2;
  if (["apply", "find", "sort", "sort_pass", "share"].includes(node)) return 3;
  return 4;
}

function outputs(run: Run | null, node: string): Record<string, unknown>[] {
  return (run?.step_history || []).filter((s) => s.node_id === node && s.output_data).map((s) => s.output_data as Record<string, unknown>);
}

function Rail({ at: here }: { at: number }) {
  return (
    <ol className="pm-rail" aria-label="Set-up steps">
      {STEPS.map((label, i) => (
        <li key={label} className={i < here ? "is-done" : i === here ? "is-here" : ""} aria-current={i === here ? "step" : undefined}>
          <span className="pm-rail__dot">{i < here ? <Check size={11} aria-hidden="true" /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function BaseRow({ icon: Icon, name, step, app }: { icon: typeof Inbox; name: string; step: string | null; app: string }) {
  const done = step === "done";
  return (
    <div className="c-li">
      <span className="pm-tile" aria-hidden="true"><Icon size={15} /></span>
      <div className="c-li__main">
        <div>{name}</div>
        <div className="c-li__sub">{done ? "Set up. People map reads what it read." : step && step !== "start" ? "Set-up started, not finished." : "Not set up yet."}</div>
      </div>
      {done ? <Pill tone="success">Set up</Pill> : <Button size="sm" onClick={() => void openApp(app, "/")}>{step && step !== "start" ? "Finish it" : "Set it up"}</Button>}
    </div>
  );
}

/** Before People map can start: Mail's and Meetings' own set-ups. */
export function Bases() {
  const { bases } = usePeople();
  return (
    <div className="c-app">
      <div className="c-setup">
        <Rail at={0} />
        <h1>Everyone you deal with, from your mail and meetings</h1>
        <p className="c-setup__lead">
          People map is built from what Mail and Meetings read: who you write to, who writes to you, who you meet. Set up
          either one and come back; your set-up here starts by itself.
        </p>
        <Card flush>
          <div className="c-list">
            <BaseRow icon={Inbox} name="Mail" step={bases.mail} app="inbox" />
            <BaseRow icon={CalendarClock} name="Meetings" step={bases.meetings} app="meetings" />
          </div>
        </Card>
        <p className="c-setup__note">Both is best: someone you write to and meet is one person here, with both.</p>
      </div>
    </div>
  );
}

export function Setup() {
  const { settings, reload } = usePeople();
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
  // The people it found, read again when the review opens: the change stream
  // may have missed the burst of writes (and a dev server has none).
  useEffect(() => {
    if (waiting === "review") void reload();
  }, [waiting, reload]);

  const restart = async () => {
    if (!settings) return;
    const fresh = (await client.workflows.runs.create("people-setup")) as unknown as Run;
    await update("people_settings", settings.id, { setup_run_id: fresh.id, setup_step: "categories" });
    setRun(null);
    await reload("settings");
  };

  let body;
  if (!runId || lost || failed) body = <Restart failed={failed} onRestart={restart} />;
  else if (waiting === "categories") body = <Categories run={run!} />;
  else if (waiting === "domains") body = <Domains run={run!} />;
  else if (waiting === "review") body = <Review run={run!} />;
  else body = <Working run={run} />;
  return (
    <div className={cx("c-app", waiting === "review" && "pm-setup--wide")}>
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
      <h1>{failed ? "The set-up stopped partway" : "Set up People map"}</h1>
      <p className="c-setup__lead">
        {failed ? "Start it again; anything you already changed about someone is kept." : "Your set-up wasn't found. Start it again."}
      </p>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => { setBusy(true); void onRestart().finally(() => setBusy(false)); }}>
          Start the set-up
        </Button>
      </div>
    </>
  );
}

/* ---------- 1. categories ---------- */

function Categories({ run }: { run: Run }) {
  const toast = useToast();
  const prepared = outputs(run, "prepare")[0] as { categories?: { key: string; name: string; sentence?: string; never?: boolean }[]; categories_on?: string[] } | undefined;
  const cats = prepared?.categories || [];
  const [on, setOn] = useState<Set<string>>(() => new Set(prepared?.categories_on || []));
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(new Set(prepared?.categories_on || [])), [prepared?.categories_on?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setBusy(true);
    try {
      await client.workflows.runs.submitForm(run.id, { node_id: "categories", inputs: { categories: [...on] } } as never);
    } catch (e) {
      toast(`Couldn't keep that: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Which of your mail is with people you deal with?</h1>
      <p className="c-setup__lead">
        Mail sorted your conversations into these. Anyone in the ones you tick is someone People map keeps track of, along
        with everyone you meet from outside.
      </p>
      <Card flush>
        {cats.length === 0 ? (
          <div className="c-card__body c-muted">Mail isn't set up for you, so only your meetings count. You can add Mail later.</div>
        ) : (
          <div className="c-choices" style={{ marginTop: 0 }}>
            {cats.map((c) => (
              <label key={c.key} className={cx("c-choice pm-choice", c.never && "pm-dim")}>
                <input
                  type="checkbox"
                  className="c-check"
                  checked={!c.never && on.has(c.key)}
                  disabled={c.never}
                  onChange={(e) => setOn((s) => { const n = new Set(s); if (e.target.checked) n.add(c.key); else n.delete(c.key); return n; })}
                />
                <span className="c-grow">
                  <span className="pm-choice__title">{c.name}</span>
                  <span className="pm-choice__sub">{c.never ? "Never people: services, lists and pitches." : c.sentence}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </Card>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => void submit()}>Count these</Button>
      </div>
    </>
  );
}

/* ---------- 2. domains ---------- */

function Domains({ run }: { run: Run }) {
  const toast = useToast();
  const prepared = outputs(run, "prepare")[0] as { own_domains?: string[]; addresses?: string[] } | undefined;
  const [domains, setDomains] = useState<string[]>(prepared?.own_domains || []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const add = () => {
    const d = draft.trim().toLowerCase().replace(/^@/, "").replace(/^www\./, "");
    if (!d || !d.includes(".") || d.includes(" ")) return toast("A domain looks like yourcompany.com.");
    if (!domains.includes(d)) setDomains([...domains, d]);
    setDraft("");
  };
  const submit = async () => {
    setBusy(true);
    try {
      await client.workflows.runs.submitForm(run.id, { node_id: "domains", inputs: { own_domains: domains } } as never);
    } catch (e) {
      toast(`Couldn't keep that: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Which email domains are your own company's?</h1>
      <p className="c-setup__lead">
        People at these are your colleagues, so they aren't contacts. Proposed from your own
        {prepared?.addresses?.length === 1 ? " address" : " addresses"} and the domains Mail and Meetings already know; free
        webmail never counts.
      </p>
      <Card flush>
        <div className="c-list">
          {domains.map((d) => (
            <div key={d} className="c-li">
              <span className="pm-tile" aria-hidden="true"><Users size={14} /></span>
              <div className="c-li__main"><div className="num">{d}</div></div>
              <Button size="sm" variant="ghost" icon={X} label={`Remove ${d}`} onClick={() => setDomains(domains.filter((x) => x !== d))} />
            </div>
          ))}
          {domains.length === 0 ? <div className="c-li c-muted">None: everyone you deal with counts.</div> : null}
          <form className="c-li" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input className="c-input c-grow" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a domain, e.g. yourcompany.com" aria-label="Add a domain" />
            <Button size="sm" icon={Plus} type="submit">Add</Button>
          </form>
        </div>
      </Card>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => void submit()}>Find my people</Button>
      </div>
    </>
  );
}

/* ---------- 3. reading ---------- */

function Working({ run }: { run: Run | null }) {
  const find = outputs(run, "find")[0] as { people?: number; unsorted?: number } | undefined;
  const passes = outputs(run, "sort_pass") as { read?: number; someone?: number; noise?: number; unsure?: number }[];
  const read = passes.reduce((s, p) => s + Number(p.read || 0), 0);
  const someone = passes.reduce((s, p) => s + Number(p.someone || 0), 0);
  const unsure = passes.reduce((s, p) => s + Number(p.unsure || 0), 0);
  const total = Number(find?.unsorted || 0);
  const node = run?.active_wait?.node_id || run?.step_history?.[run.step_history.length - 1]?.node_id || "";
  const line = ["prepare", "categories", ""].includes(node) && !find ? "Looking at what Mail and Meetings read…"
    : !find ? "Finding everyone in those conversations and your meetings…"
    : node === "share" || node === "review" ? "Putting together their companies…"
      : `Reading each new person once: someone you deal with, or noise, and what they are to you.`;
  return (
    <>
      <div className="c-row" style={{ gap: 12 }}>
        <Face size={40} />
        <h1 style={{ marginTop: 0 }}>Finding your people</h1>
      </div>
      <p className="c-setup__lead"><Spinner /> {line}</p>
      <div className="c-counters">
        <div className="c-counter"><div className="c-counter__n">{find?.people ?? "…"}</div><div className="c-counter__l">people in them</div></div>
        <div className="c-counter"><div className="c-counter__n">{find ? someone : "…"}</div><div className="c-counter__l">you deal with</div></div>
        <div className="c-counter"><div className="c-counter__n">{find ? unsure : "…"}</div><div className="c-counter__l">not sure</div></div>
      </div>
      <div className="c-meter" aria-label="Read so far"><span style={{ width: `${total ? Math.min(100, (100 * read) / total) : find ? 8 : 2}%` }} /></div>
      <p className="c-setup__note">{find ? `Read ${read} of ${total}.` : ""} One question per person, answered from your own mail and meetings; nothing leaves your Lemma.</p>
    </>
  );
}

/* ---------- 4. review ---------- */

function Review({ run }: { run: Run }) {
  const { everyone, people, unsure, reload } = usePeople();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [address, setAddress] = useState("");
  const [showNoise, setShowNoise] = useState(false);
  const noise = useMemo(() => everyone.filter((p) => p.deal_with === false), [everyone]);
  const colleagues = useMemo(() => everyone.filter((p) => p.deal_with === true && p.kind === "colleague"), [everyone]);

  const correct = async (input: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const out = await runFunction<{ message: string }>("people_correct", input);
      toast(out.message);
      await reload("people");
    } catch (e) {
      toast(`Couldn't change that: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  const finish = async () => {
    setBusy("finish");
    try {
      await client.workflows.runs.submitForm(run.id, { node_id: "review", inputs: { looked: true } } as never);
    } catch (e) {
      toast(`Couldn't finish: ${e instanceof Error ? e.message : e}`);
      setBusy("");
    }
  };
  const byKind = KINDS.filter((k) => k !== "colleague").map((k) => ({ k, n: people.filter((p) => p.kind === k).length })).filter((x) => x.n);

  return (
    <>
      <h1>{plural(people.length, "person", "people")} you deal with</h1>
      <p className="c-setup__lead">
        {byKind.map((x) => `${x.n} ${KIND_LABEL[x.k].toLowerCase()}${x.n === 1 ? "" : "s"}`).join(", ") || "Nobody yet"}
        {unsure.length ? `, and ${unsure.length} it wasn't sure of` : ""}. Remove anyone who shouldn't be here and add anyone
        missing; each change teaches the next read.
      </p>

      {unsure.length ? (
        <Card title="Not sure" icon={CircleHelp} count={unsure.length} flush>
          <div className="c-list">
            {unsure.map((p) => <SettleRow key={p.id} p={p} busy={busy} onCorrect={correct} />)}
          </div>
        </Card>
      ) : null}

      <Card title="People you deal with" icon={Users} count={people.length} flush>
        <div className="c-list pm-review">
          {people.map((p) => (
            <div key={p.id} className="c-li">
              <Avatar name={p.name} email={p.handle} size={26} />
              <div className="c-li__main">
                <div className="c-ellipsis">{nameOf(p.name, p.handle)}</div>
                <div className="c-li__sub c-ellipsis">{p.company_name || p.handle}</div>
              </div>
              <KindPill kind={p.kind} unsure={p.unsure} />
              <Button size="sm" variant="ghost" icon={Trash2} label={`Remove ${nameOf(p.name, p.handle)}`} busy={busy === `rm-${p.id}`}
                onClick={() => void correct({ person_id: p.id, deal_with: false }, `rm-${p.id}`)} />
            </div>
          ))}
          {people.length === 0 ? <div className="c-li c-muted">Nobody yet. Add someone below.</div> : null}
        </div>
      </Card>

      <Card title="Add someone missing" icon={UserPlus} flush>
        <div className="c-list">
          <form className="c-li" onSubmit={(e) => { e.preventDefault(); if (address.trim()) void correct({ handle: address.trim(), deal_with: true }, "add").then(() => setAddress("")); }}>
            <input className="c-input c-grow" type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Their email address" aria-label="Their email address" />
            <Button size="sm" icon={Plus} type="submit" busy={busy === "add"}>Add</Button>
          </form>
          {noise.length ? (
            <button type="button" className="c-li pm-disclose" aria-expanded={showNoise} onClick={() => setShowNoise((v) => !v)}>
              <span className="c-grow c-muted">{showNoise ? "Hide" : "Show"} the {plural(noise.length, "address", "addresses")} it left out as noise</span>
            </button>
          ) : null}
          {showNoise ? noise.map((p) => (
            <div key={p.id} className="c-li">
              <Avatar name={p.name} email={p.handle} size={24} />
              <div className="c-li__main">
                <div className="c-ellipsis">{nameOf(p.name, p.handle)}</div>
                <div className="c-li__sub c-ellipsis">{p.handle}{p.sorted_by === "person" ? " · you removed them" : ""}</div>
              </div>
              <Button size="sm" icon={Undo2} busy={busy === `add-${p.id}`} onClick={() => void correct({ person_id: p.id, deal_with: true }, `add-${p.id}`)}>Add</Button>
            </div>
          )) : null}
          {colleagues.length ? <div className="c-li c-faint">{plural(colleagues.length, "colleague")} from outside addresses kept out of the list.</div> : null}
        </div>
      </Card>

      <div className="c-setup__row pm-sticky-row">
        <Button variant="primary" busy={busy === "finish"} onClick={() => void finish()}>These look right</Button>
      </div>
    </>
  );
}

export function SettleRow({ p, busy, onCorrect }: { p: Person; busy: string; onCorrect: (input: Record<string, unknown>, key: string) => Promise<void> }) {
  const someone = p.deal_with === true;
  const closest = p.answers?.kind?.value as Kind | undefined;
  return (
    <div className="c-li pm-settle">
      <Avatar name={p.name} email={p.handle} size={26} />
      <div className="c-li__main">
        <div className="c-ellipsis">{nameOf(p.name, p.handle)} <span className="c-faint">{p.handle}</span></div>
        <div className="c-li__sub">{p.reason}</div>
        <div className="pm-chips">
          {!someone ? (
            <>
              <Button size="sm" busy={busy === `s-${p.id}`} onClick={() => void onCorrect({ person_id: p.id, deal_with: true }, `s-${p.id}`)}>Someone I deal with</Button>
              <Button size="sm" variant="ghost" busy={busy === `n-${p.id}`} onClick={() => void onCorrect({ person_id: p.id, deal_with: false }, `n-${p.id}`)}>Noise</Button>
            </>
          ) : (
            KINDS.map((k) => (
              <Button key={k} size="sm" variant={k === closest ? "default" : "ghost"} title={KIND_HINT[k]} busy={busy === `k-${p.id}-${k}`}
                onClick={() => void onCorrect({ person_id: p.id, kind: k }, `k-${p.id}-${k}`)}>
                {KIND_LABEL[k]}
              </Button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
