// /setup: first run, and settings after. Repositories from those the GitHub
// install covers, the day and time, the wait, the commands each repository's
// first look found (to confirm or edit), or the sample week.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FlaskConical, Package, Play } from "lucide-react";
import { Banner, Button, Card, DEMO, Field, Header, Pill, Switch, q, useToast } from "@lemma-plugins/kit";
import { browserZone, call, coveredRepos, ensureSchedules, startRun, useDeps, useMe } from "./data";
import { RepoPill } from "./marks";
import { WEEKDAY_LONG, nextBatch } from "./model";
import { to } from "./route";
import type { Repo, Settings } from "./types";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function Setup() {
  const d = useDeps();
  const { settings, repos, reload } = d;
  const me = useMe();
  const toast = useToast();
  const done = !!settings?.setup_done_at;
  const [covered, setCovered] = useState<{ full_name: string; default_branch?: string | null; private?: boolean }[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [weekday, setWeekday] = useState<Settings["weekday"]>(settings?.weekday || "mon");
  const [time, setTime] = useState(settings?.run_time || "06:00");
  const [wait, setWait] = useState(settings?.wait_days ?? 3);
  const [waitMajor, setWaitMajor] = useState(settings?.wait_major_days ?? 14);
  const [hold, setHold] = useState(settings?.hold_install_scripts ?? true);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const zone = (settings?.timezone || browserZone()).replace("Asia/Calcutta", "Asia/Kolkata");

  useEffect(() => {
    setPicked(new Set(repos.filter((r) => r.active).map((r) => r.repo)));
  }, [repos]);
  useEffect(() => {
    void coveredRepos().then((out) => {
      setCovered(out.repos);
      setProblem(out.problem);
    });
  }, []);

  const options = useMemo(() => {
    const names = new Map<string, { full_name: string; private?: boolean; default_branch?: string | null }>();
    for (const r of covered || []) names.set(r.full_name, r);
    for (const r of repos) if (!names.has(r.repo)) names.set(r.repo, { full_name: r.repo, default_branch: r.default_branch });
    return [...names.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [covered, repos]);

  const toggle = (name: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });

  const save = async () => {
    setBusy("save");
    const lines: string[] = [];
    try {
      const chosen = options.filter((o) => picked.has(o.full_name)).map((o) => ({ repo: o.full_name, default_branch: o.default_branch || null }));
      const out = await call("deps_setup_save", { repos: chosen, weekday, run_time: time, timezone: zone, wait_days: wait,
        wait_major_days: waitMajor, hold_install_scripts: hold });
      lines.push(out.message || "Saved.");
      setLog([...lines]);
      await reload();
      if (DEMO) {
        setLog([...lines, "In a Lemma, this makes the schedules as you and starts a first look at each repository."]);
        return;
      }
      const fresh = await freshState();
      const owner = fresh.settings?.owner_user_id;
      if (me && owner === me.id && fresh.settings) {
        const made = await ensureSchedules(fresh.settings, fresh.repos, me);
        lines.push(made.problems.length ? `Couldn't make ${made.problems.join(", ")}.` : "Made the schedules, as you: the weekly batch and the daily security run for each repository, and GitHub's events.");
        if (made.platform.repository_schedule?.state === "no") lines.push("Schedules can't start in a checkout yet: each run clones by hand.");
      } else {
        lines.push(`The schedules run as ${fresh.settings?.owner_name || "the owner"}; they make them when they open the app.`);
      }
      setLog([...lines]);
      for (const r of fresh.repos.filter((x) => x.active && x.status === "new")) {
        try {
          await startRun(r.repo, `First look at ${r.repo}`, `First look at ${r.repo}: find its package managers and its install, test and build commands, and what is outdated. Open nothing.`, "a first look");
          lines.push(`Started a first look at ${r.repo}: its commands show below to confirm.`);
        } catch (e) {
          lines.push(`Couldn't start a first look at ${r.repo}: ${e instanceof Error ? e.message : e}`);
        }
        setLog([...lines]);
      }
      await reload();
    } catch (e) {
      lines.push(`Couldn't save: ${e instanceof Error ? e.message : e}`);
      setLog([...lines]);
    } finally {
      setBusy(null);
    }
  };

  const loadSample = async () => {
    setBusy("sample");
    try {
      await call("deps_setup_save", { sample: true, timezone: zone });
      const out = await call("deps_sample_data", { mode: "load", timezone: zone });
      toast(out.message || "Loaded the sample week.");
      await reload();
      to.week();
    } catch (e) {
      toast(`Couldn't load the sample: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };

  const draft: Settings | null = settings ? { ...settings, weekday, run_time: time } : null;

  return (
    <>
      <Header icon={Package} title={done ? "Set-up" : "Dependency updates"}
        back={done ? { label: "Dependencies", icon: ArrowLeft, onClick: () => to.week() } : undefined} />
      <main className="c-body dp-body dp-narrow">
        {!done ? (
          <div className="dp-intro">
            <h1>Every week, one tested pull request per repository</h1>
            <p className="c-muted">The Lemma installs and tests each update, one commit each. It holds majors and risky releases for you, opens security fixes the same day, and never merges.</p>
          </div>
        ) : null}
        {problem && !DEMO ? (
          <Banner icon={Package}>
            <b>GitHub isn't connected to this Lemma for you.</b> Connect GitHub in the Lemma's connectors, then come back here. ({problem})
          </Banner>
        ) : null}

        <div className="c-stack">
          <Card title="Repositories" count={picked.size} flush>
            {options.length ? (
              <ul className="c-list">
                {options.map((o) => {
                  const row = repos.find((r) => r.repo === o.full_name);
                  return (
                    <li key={o.full_name} className="c-li">
                      <label className="c-row c-grow dp-pick">
                        <input type="checkbox" className="c-check" checked={picked.has(o.full_name)} onChange={() => toggle(o.full_name)} />
                        <span className="c-ellipsis">{o.full_name}</span>
                        {o.private ? <Pill tone="plain">private</Pill> : null}
                      </label>
                      {row ? <RepoPill r={row} /> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="c-card__body c-muted">{covered === null && !DEMO ? "Reading the repositories GitHub lets this Lemma see…" : "No repositories yet: the GitHub install covers none for you."}</p>
            )}
          </Card>

          <Card title="When">
            <div className="dp-form">
              <Field label="Day">
                <select className="c-select" value={weekday} onChange={(e) => setWeekday(e.target.value as Settings["weekday"])}>
                  {WEEKDAYS.map((w) => <option key={w} value={w}>{WEEKDAY_LONG[w]}</option>)}
                </select>
              </Field>
              <Field label="Time" hint={zone}>
                <input className="c-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
            </div>
            {draft ? <p className="c-muted dp-small">Next batch: {nextBatch(draft)}. Security fixes: every day at 07:00, and the same day they're found.</p> : null}
          </Card>

          <Card title="The wait">
            <div className="dp-form">
              <Field label="Days a release waits" hint="Most bad releases are pulled within days.">
                <input className="c-input" type="number" min={0} max={60} value={wait} onChange={(e) => setWait(Number(e.target.value))} />
              </Field>
              <Field label="Days a major waits">
                <input className="c-input" type="number" min={0} max={120} value={waitMajor} onChange={(e) => setWaitMajor(Number(e.target.value))} />
              </Field>
            </div>
            <div className="c-row dp-switch">
              <Switch checked={hold} onChange={setHold} label="Hold a release that adds an install script or comes from a new publisher" />
              <span>Hold a release that adds an install script or comes from a new publisher</span>
            </div>
          </Card>

          <div className="c-row dp-wrap-row">
            <Button variant="primary" icon={Play} busy={busy === "save"} disabled={!picked.size && !DEMO} onClick={() => void save()}>
              {done ? "Save" : "Save and take a first look"}
            </Button>
            {!done ? <Button icon={FlaskConical} busy={busy === "sample"} onClick={() => void loadSample()}>Look around with a sample week</Button> : null}
          </div>
          {log.length ? <div className="c-log">{log.map((l) => <div key={l}>{l}</div>)}</div> : null}

          {repos.some((r) => r.active) ? <Commands repos={repos.filter((r) => r.active)} /> : null}
        </div>
      </main>
    </>
  );
}

async function freshState(): Promise<{ settings: Settings | null; repos: Repo[] }> {
  const [s] = await q<Record<string, unknown>>("SELECT * FROM deps_settings ORDER BY created_at LIMIT 1");
  const repos = await q<Record<string, unknown>>("SELECT * FROM deps_repo ORDER BY repo LIMIT 500");
  const parse = <T,>(v: unknown, f: T): T => (typeof v === "string" ? (() => { try { return JSON.parse(v) as T; } catch { return f; } })() : ((v as T) ?? f));
  return {
    settings: s ? ({ ...(s as unknown as Settings), platform: parse(s.platform, {}), schedule_ids: parse(s.schedule_ids, {}),
      weekday: (s.weekday as Settings["weekday"]) || "mon", run_time: (s.run_time as string) || "06:00", timezone: (s.timezone as string) || "UTC" }) : null,
    repos: repos.map((r) => ({ ...(r as unknown as Repo), managers: parse(r.managers, []), schedule_ids: parse(r.schedule_ids, {}), active: r.active !== false })),
  };
}

/** The commands each repository's first look found, to confirm or edit. */
function Commands({ repos }: { repos: Repo[] }) {
  return (
    <Card title="Commands" flush>
      <p className="c-card__body c-muted dp-small">The first look at each repository finds how it installs, tests and builds. A batch opens once a person confirms them.</p>
      <ul className="c-list">{repos.map((r) => <CommandRow key={r.id} r={r} />)}</ul>
    </Card>
  );
}

function CommandRow({ r }: { r: Repo }) {
  const toast = useToast();
  const { reload } = useDeps();
  const [install, setInstall] = useState(r.install_cmd || "");
  const [test, setTest] = useState(r.test_cmd || "");
  const [build, setBuild] = useState(r.build_cmd || "");
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await call("deps_setup_save", { repos: null, commands: [{ repo: r.repo, install_cmd: install || null, test_cmd: test || null, build_cmd: build || null }] });
      toast(`Confirmed ${r.repo}'s commands.`);
      await reload();
    } catch (e) {
      toast(`Couldn't confirm: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  const actionsOnly = r.managers.length === 1 && r.managers[0] === "actions";
  return (
    <li className="dp-cmd">
      <div className="c-row dp-wrap-row">
        <b>{r.repo}</b>
        <span className="c-muted">{r.managers.join(", ") || "not looked at yet"}</span>
        <span className="dp-cmd__pill"><RepoPill r={r} /></span>
      </div>
      {r.status_note ? <p className="c-muted dp-small">{r.status_note}</p> : null}
      {r.status === "new" ? <p className="c-faint dp-small">The first look hasn't finished yet.</p> : actionsOnly ? null : (
        <>
          <div className="dp-form dp-form--3">
            <Field label="Install"><input className="c-input dp-mono" value={install} onChange={(e) => setInstall(e.target.value)} /></Field>
            <Field label="Test"><input className="c-input dp-mono" value={test} onChange={(e) => setTest(e.target.value)} /></Field>
            <Field label="Build"><input className="c-input dp-mono" value={build} placeholder="none" onChange={(e) => setBuild(e.target.value)} /></Field>
          </div>
          <div className="c-row dp-wrap-row">
            <Button size="sm" busy={busy} onClick={() => void confirm()}>{r.status === "needs_confirm" ? "Confirm" : "Save commands"}</Button>
            {r.commands_confirmed_by ? <span className="c-faint dp-small">Confirmed by {r.commands_confirmed_by}</span> : null}
          </div>
        </>
      )}
    </li>
  );
}
