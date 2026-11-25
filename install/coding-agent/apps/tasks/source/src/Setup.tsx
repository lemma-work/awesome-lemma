// Set-up, one person at a time. The `tasks-setup` workflow keeps the answers
// and waits on up to three forms; this is the screen for them.
//
//   1  you      just you, or your team too (and the first team project)
//   2  promises only with Mail or Meetings in this Lemma: promises you made
//               become tasks automatically, you're asked each time, or never
//   3  agents   which agents can take tasks: this Lemma's own first
//
// The run's id is on the person's settings, so a reload lands where they were.

import { useCallback, useEffect, useState } from "react";
import { Bot, Check, ListChecks, ShieldCheck, Sparkles, Users, UserRound } from "lucide-react";
import { Button, Face, Spinner, Switch, client, runFunction, update, useToast } from "@lemma-plugins/kit";
import { browserZone, findCapabilities, letAgentTakeTasks, useTasks, useWorld } from "./data";
import { agentName } from "./marks";
import { ASSISTANT, type Capabilities } from "./types";

type Run = { id: string; status?: string; active_wait?: { node_id?: string } | null; step_history?: { node_id: string; output_data?: Record<string, unknown> | null }[] };

export function Setup() {
  const { settings, reload, promises } = useTasks();
  const { me, lemmaName, agents, canAdmin } = useWorld();
  const toast = useToast();
  const [run, setRun] = useState<Run | null>(null);
  const [lost, setLost] = useState(false);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const runId = settings?.setup_run_id || null;

  useEffect(() => { void findCapabilities().then(setCaps).catch(() => setCaps({ plugins: [], accounts: [], agents: [], has_promises: false })); }, []);

  const poll = useCallback(async () => {
    if (!runId) return;
    try {
      const fresh = (await client.workflows.runs.get(runId)) as unknown as Run;
      setRun(fresh);
      setLost(false);
      if (fresh.status === "COMPLETED") void reload("settings");
    } catch {
      setLost(true);
    }
  }, [runId, reload]);

  useEffect(() => {
    if (!runId) return;
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => window.clearInterval(timer);
  }, [runId, poll]);

  const submit = async (node: string, inputs: Record<string, unknown>) => {
    if (!run) return;
    await client.workflows.runs.submitForm(run.id, { node_id: node, inputs } as never);
    await poll();
  };

  const restart = async () => {
    if (!settings) return;
    const fresh = (await client.workflows.runs.create("tasks-setup")) as unknown as Run;
    await update("tasks_settings", settings.id, { setup_run_id: fresh.id, setup_step: "start" });
    setRun(null);
    await reload("settings");
  };

  const failed = !!run && ["FAILED", "CANCELLED"].includes(String(run.status));
  const waiting = run?.status === "WAITING" ? run.active_wait?.node_id : null;
  const hasPromises = !!caps?.has_promises;
  const steps = hasPromises ? ["You or your team", "Promises", "Agents"] : ["You or your team", "Agents"];
  const here = waiting === "promises" ? 1 : waiting === "agents" ? steps.length - 1 : waiting === "scope" ? 0 : steps.length;

  let body;
  if (!runId || lost || failed) {
    body = (
      <>
        <h1>{failed ? "The set-up stopped partway" : "Set up Tasks"}</h1>
        <p className="c-setup__lead">{failed ? "Start it again; nothing you have is lost." : "Your set-up wasn't found. Start it again."}</p>
        <div className="c-setup__row"><Button variant="primary" onClick={() => void restart()}>Start the set-up</Button></div>
      </>
    );
  } else if (!run || !caps) {
    body = <p className="c-muted c-row"><Spinner /> One moment…</p>;
  } else if (waiting === "scope") {
    body = <Scope hasPromises={hasPromises} onSubmit={(inputs) => submit("scope", { ...inputs, display_name: me?.name || undefined, timezone: browserZone(), has_promises: hasPromises })} />;
  } else if (waiting === "promises") {
    body = <PromisesStep count={promises.filter((p) => p.state === "open").length} onSubmit={(v) => submit("promises", { promises: v })} />;
  } else if (waiting === "agents") {
    body = (
      <AgentsStep lemmaName={lemmaName} agents={agents} canAdmin={canAdmin} onSubmit={async (chosen) => {
        const named = chosen.filter((a) => a !== ASSISTANT);
        const refused: string[] = [];
        for (const a of named) if (!(await letAgentTakeTasks(a))) refused.push(a);
        if (refused.length) toast(`${refused.join(", ")} can't take tasks until an admin lets them (Settings).`);
        await submit("agents", { agents: chosen.filter((a) => !refused.includes(a)), capabilities: caps });
      }} />
    );
  } else if (!(run.step_history || []).some((st) => st.node_id === "done")) {
    body = <p className="c-muted c-row"><Spinner /> One moment…</p>;
  } else {
    body = (
      <>
        <Face size={44} />
        <h1>Getting your list ready</h1>
        <p className="c-setup__lead">Asking which of your tasks an agent could do{hasPromises ? ", and which promises you made are work to do" : ""}. A few seconds.</p>
        <p className="c-muted c-row tk-gap"><Spinner /> {run.status === "COMPLETED" ? "Opening…" : "Working…"}</p>
      </>
    );
  }

  return (
    <div className="c-app">
      <div className="c-setup tk-setup">
        <ol className="tk-rail" aria-label="Set-up steps">
          {steps.map((label, i) => (
            <li key={label} className={i < here ? "is-done" : i === here ? "is-here" : ""} aria-current={i === here ? "step" : undefined}>
              <span className="tk-rail__dot">{i < here ? <Check size={11} aria-hidden="true" /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        {body}
      </div>
    </div>
  );
}

function Scope({ hasPromises, onSubmit }: { hasPromises: boolean; onSubmit: (inputs: Record<string, unknown>) => Promise<void> }) {
  const toast = useToast();
  const [scope, setScope] = useState<"me" | "team">("me");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState("");
  const go = async (inputs: Record<string, unknown>, what: string) => {
    setBusy(what);
    try {
      await onSubmit(inputs);
    } catch (e) {
      toast(`Couldn't go on: ${e instanceof Error ? e.message : e}`);
      setBusy("");
    }
  };
  const sample = async () => {
    setBusy("sample");
    try {
      await runFunction("tasks_sample_data", { mode: "load", timezone: browserZone() });
      await onSubmit({ scope: "team" });
    } catch (e) {
      toast(`Couldn't load the sample: ${e instanceof Error ? e.message : e}`);
      setBusy("");
    }
  };
  return (
    <>
      <Face size={44} />
      <h1>Everything you have to do, done by you or handed to an agent</h1>
      <p className="c-setup__lead">
        Start with your own list: only you see it. Any task can go to an agent, which works it and reports back on the task{hasPromises ? "; and promises you make in mail and meetings can become tasks" : ""}.
      </p>
      <div className="c-card c-choices">
        <label className="c-choice tk-choice">
          <input type="radio" name="scope" checked={scope === "me"} onChange={() => setScope("me")} />
          <UserRound size={16} aria-hidden="true" />
          <span><span className="tk-choice__title">Just me</span><span className="tk-choice__sub">My own list. Only I see it.</span></span>
        </label>
        <label className="c-choice tk-choice">
          <input type="radio" name="scope" checked={scope === "team"} onChange={() => setScope("team")} />
          <Users size={16} aria-hidden="true" />
          <span><span className="tk-choice__title">My team too</span><span className="tk-choice__sub">My own list, plus team projects everyone in this Lemma sees.</span></span>
        </label>
        {scope === "team" ? (
          <div className="tk-choice__more">
            <input className="c-input" placeholder="Your first team project (optional), e.g. Q1 launch" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Your first team project" />
          </div>
        ) : null}
      </div>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy === "go"} disabled={!!busy} onClick={() => void go({ scope, project_name: scope === "team" ? project.trim() || undefined : undefined }, "go")}>Continue</Button>
      </div>
      <div className="tk-or">or</div>
      <button type="button" className="tk-sample" disabled={!!busy} onClick={() => void sample()}>
        <span className="tk-sample__icon">{busy === "sample" ? <Spinner /> : <ListChecks size={16} aria-hidden="true" />}</span>
        <span><span className="tk-choice__title">Look around with a sample list</span>
          <span className="tk-choice__sub">Made-up tasks of your own, a made-up team project, and a task an agent could do on its own. Clear it any time.</span></span>
      </button>
    </>
  );
}

function PromisesStep({ count, onSubmit }: { count: number; onSubmit: (v: string) => Promise<void> }) {
  const [value, setValue] = useState("ask");
  const [busy, setBusy] = useState(false);
  const options = [
    { id: "auto", title: "Make them tasks automatically", sub: "When a promise is work to do, it becomes a task with your words on it. Just replies stay replies." },
    { id: "ask", title: "Ask me each time", sub: "Work to do waits in From promises for you to make it a task, or not." },
    { id: "never", title: "Never", sub: "Promises stay in Mail and Meetings." },
  ];
  return (
    <>
      <Face size={44} />
      <h1>Promises you made</h1>
      <p className="c-setup__lead">
        Mail and Meetings find the promises you make{count ? ` (${count} so far)` : ""}. For each one, Tasks asks whether it's work to do or just a reply.
      </p>
      <div className="c-card c-choices">
        {options.map((o) => (
          <label key={o.id} className="c-choice tk-choice">
            <input type="radio" name="promises" checked={value === o.id} onChange={() => setValue(o.id)} />
            <span><span className="tk-choice__title">{o.title}</span><span className="tk-choice__sub">{o.sub}</span></span>
          </label>
        ))}
      </div>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => { setBusy(true); void onSubmit(value).catch(() => setBusy(false)); }}>Continue</Button>
      </div>
    </>
  );
}

function AgentsStep({ lemmaName, agents, canAdmin, onSubmit }: { lemmaName: string; agents: string[]; canAdmin: boolean; onSubmit: (chosen: string[]) => Promise<void> }) {
  const [chosen, setChosen] = useState<string[]>([ASSISTANT]);
  const [busy, setBusy] = useState(false);
  const flip = (a: string, on: boolean) => setChosen((c) => (on ? [...new Set([...c, a])] : c.filter((x) => x !== a)));
  return (
    <>
      <Face size={44} />
      <h1>Who can take tasks</h1>
      <p className="c-setup__lead">
        An agent you hand a task to works it in a conversation of its own, with the task as its brief, and reports on the task. It asks before sending or changing anything outside this Lemma.
      </p>
      <div className="c-card c-choices">
        <label className="c-choice tk-choice">
          <Face size={22} />
          <span className="c-grow"><span className="tk-choice__title">{lemmaName}</span><span className="tk-choice__sub">This Lemma's own assistant: web search, documents, files, and what this Lemma holds.</span></span>
          <Switch checked={chosen.includes(ASSISTANT)} onChange={(v) => flip(ASSISTANT, v)} label={`${lemmaName} can take tasks`} />
        </label>
        {agents.map((a) => (
          <label key={a} className="c-choice tk-choice">
            <Bot size={16} aria-hidden="true" />
            <span className="c-grow"><span className="tk-choice__title">{agentName(a, lemmaName)}</span><span className="tk-choice__sub">{canAdmin ? "A named agent in this Lemma." : "A named agent. An admin has to let it take tasks."}</span></span>
            <Switch checked={chosen.includes(a)} disabled={!canAdmin} onChange={(v) => flip(a, v)} label={`${agentName(a, lemmaName)} can take tasks`} />
          </label>
        ))}
      </div>
      <p className="c-setup__note"><ShieldCheck size={13} aria-hidden="true" /> Tasks suggests which tasks an agent could do. It never hands one over by itself.</p>
      <div className="c-setup__row">
        <Button variant="primary" icon={Sparkles} busy={busy} onClick={() => { setBusy(true); void onSubmit(chosen).catch(() => setBusy(false)); }}>Open Tasks</Button>
      </div>
    </>
  );
}
