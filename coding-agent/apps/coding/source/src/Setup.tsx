// Set-up, once for the team by whoever opens the Coding agent first, and the
// same screen to change it later: GitHub (one connection for the whole Lemma,
// connected here with the kit's <Connect>), the repositories the agent may work in with what it
// runs first in each, and the defaults (who runs, on which model, keep the
// pull request green and for how many tries, the issue label that hands an
// issue over). Or a sample board to look around with. Saving also makes the
// person's own schedules (wire.ts) and says which couldn't be made.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FlaskConical, Github, SquareTerminal } from "lucide-react";
import { Button, Connect, DEMO, Field, Header, Spinner, Switch, client, cx, demoNote, errorText, isConnectionProblem, useToast } from "@lemma-plugins/kit";
import { call, runtimeOf, useCoding, useWorld } from "./data";
import { AgentMenu, ModelMenu } from "./pickers";
import { Mono } from "./marks";
import { to } from "./route";
import { ensureSchedules, schedulesFor } from "./wire";

type Listed = { full_name: string; default_branch: string | null; private?: boolean };
type RepoForm = { full_name: string; default_branch: string | null; setup: string; notes: string; enabled: boolean };

export function Setup() {
  const data = useCoding();
  const { me, runtimes } = useWorld();
  const toast = useToast();
  const settings = data.settings;
  const done = !!settings?.setup_done_at;
  const [listed, setListed] = useState<Listed[] | null>(null);
  const [complete, setComplete] = useState(true);
  const [ghError, setGhError] = useState<unknown>(null);
  const [form, setForm] = useState<Record<string, RepoForm>>({});
  const [profile, setProfile] = useState(settings?.default_profile_id || "system:lemma");
  const [model, setModel] = useState<string | null>(settings?.default_model || null);
  const [keepGreen, setKeepGreen] = useState(settings?.keep_green ?? true);
  const [maxTries, setMaxTries] = useState(settings?.max_tries || 3);
  const [label, setLabel] = useState(settings?.issue_label || "lemma");
  const [busy, setBusy] = useState("");
  const [problems, setProblems] = useState<string[] | null>(null);
  const [typed, setTyped] = useState("");

  // The repositories the Lemma's GitHub connection lets a task open in. A
  // refusal keeps its error: <Connect> turns a connection one into its next step.
  const readRepos = useCallback(() => {
    client.conversations.repositories().then(
      (r) => {
        const x = r as unknown as { items?: Listed[]; complete?: boolean };
        setListed(x.items || []);
        setComplete(x.complete !== false);
        setGhError(null);
      },
      (e) => { setListed([]); setGhError(e); },
    );
  }, []);
  useEffect(readRepos, [readRepos]);
  // Connected after the first read came back empty: read again.
  const githubReady = () => { if (listed && (!listed.length || ghError)) { setListed(null); readRepos(); } };
  useEffect(() => {
    // What's saved, then everything GitHub lists, off until ticked.
    setForm((f) => {
      const next = { ...f };
      for (const r of data.repos) if (!next[r.full_name]) next[r.full_name] = { full_name: r.full_name, default_branch: r.default_branch, setup: r.setup || "", notes: r.notes || "", enabled: r.enabled };
      for (const r of listed || []) if (!next[r.full_name]) next[r.full_name] = { full_name: r.full_name, default_branch: r.default_branch, setup: "", notes: "", enabled: false };
      return next;
    });
  }, [data.repos, listed]);

  const rows = useMemo(() => Object.values(form).sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.full_name.localeCompare(b.full_name)), [form]);
  const set = (name: string, patch: Partial<RepoForm>) => setForm((f) => ({ ...f, [name]: { ...f[name], ...patch } }));
  const picked = rows.filter((r) => r.enabled);
  const runtime = runtimeOf(profile, runtimes);

  const save = async (sample: boolean) => {
    setBusy(sample ? "sample" : "save");
    setProblems(null);
    try {
      if (DEMO) {
        demoNote("In the demo the set-up isn't saved: in a Lemma this keeps it and makes your GitHub and 15-minute schedules as you.");
        to.board();
        return;
      }
      const out = await call("coding_setup_save", {
        repos: sample ? [] : rows.filter((r) => r.enabled || data.repos.some((d) => d.full_name === r.full_name))
          .map((r) => ({ full_name: r.full_name, default_branch: r.default_branch, setup: r.setup.trim() || null, notes: r.notes.trim() || null, enabled: r.enabled })),
        default_profile_id: profile, default_model: model, keep_green: keepGreen, max_tries: maxTries, issue_label: label.trim() || "lemma",
      });
      const made = await ensureSchedules(me?.id || "");
      setProblems(made.problems);
      if (made.problems.length) toast(`Saved, but couldn't make ${made.problems.join(", ")}.`, { ms: 9000 });
      if (sample) {
        try {
          const loaded = await call("coding_sample_data", { mode: "load" });
          toast(String(loaded.message || "Loaded the sample board."));
        } catch {
          toast("The sample is still loading; the board fills in a moment.");
        }
      } else if (!made.problems.length) toast(String(out.message || "Saved."));
      await data.reload();
      if (!made.problems.length) to.board();
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };

  const github = (
    <section className="cd-setsec">
      <h2 className="cd-setsec__h"><Github size={15} aria-hidden="true" />GitHub</h2>
      <Connect connector="github" slug="github" mode="shared" onReady={githubReady} error={ghError}
        purpose="One GitHub connection for this Lemma: the agent checks out the repositories you tick, pushes its own branch and opens the pull request, and reads checks and review comments to keep it green. Merging stays with a person." />
      {!listed ? <p className="c-muted c-row"><Spinner /> Reading the repositories GitHub lets this Lemma see…</p> : null}
      {listed && !listed.length && !(ghError && isConnectionProblem(ghError)) ? (
        <p className="cd-note">{ghError ? `Couldn't read the repositories: ${errorText(ghError, "github")}` : "No repositories yet: the Lemma's GitHub app isn't on any. Once it is, they show here."}</p>
      ) : null}
      {listed && listed.length > 0 && !complete ? <p className="cd-note">The Lemma's GitHub app is on more repositories than are listed here; type one below to add it.</p> : null}
    </section>
  );

  const repoList = (
    <section className="cd-setsec">
      <h2 className="cd-setsec__h">Repositories the agent may work in</h2>
      <p className="cd-note">Tick one to let the agent take tasks in it. Set-up commands run first in each task, one per line, and the agent reports how they went.</p>
      <div className="cd-repolist">
        {rows.map((r) => (
          <div key={r.full_name} className={cx("cd-reporow", r.enabled && "is-on")}>
            <label className="cd-check">
              <input type="checkbox" className="c-check" checked={r.enabled} onChange={(e) => set(r.full_name, { enabled: e.target.checked })} />
              <Mono>{r.full_name}</Mono>
              {r.default_branch ? <span className="cd-note cd-note--inline">{r.default_branch}</span> : null}
            </label>
            {r.enabled ? (
              <div className="cd-reporow__more">
                <Field label="Set-up commands">
                  <textarea className="c-input cd-mono cd-setup-in" rows={2} value={r.setup} onChange={(e) => set(r.full_name, { setup: e.target.value })} placeholder={"uv sync\npnpm install --frozen-lockfile"} />
                </Field>
                <Field label="Notes for the agent">
                  <textarea className="c-input cd-setup-in" rows={2} value={r.notes} onChange={(e) => set(r.full_name, { notes: e.target.value })} placeholder="How to run the tests, what not to touch" />
                </Field>
              </div>
            ) : null}
          </div>
        ))}
        {listed && !rows.length ? <p className="cd-note cd-pad">No repositories yet.</p> : null}
      </div>
      {!complete || ghError ? (
        <div className="cd-addrepo">
          <input className="c-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="owner/repository" aria-label="Add a repository" />
          <Button disabled={!/^[\w.-]+\/[\w.-]+$/.test(typed.trim())} onClick={() => { const n = typed.trim(); setForm((f) => ({ ...f, [n]: { full_name: n, default_branch: null, setup: "", notes: "", enabled: true } })); setTyped(""); }}>Add</Button>
        </div>
      ) : null}
    </section>
  );

  const defaults = (
    <section className="cd-setsec">
      <h2 className="cd-setsec__h">Defaults</h2>
      <div className="cd-setgrid">
        <span className="cd-setgrid__l">Who runs a task</span>
        <div className="c-row cd-wrap"><AgentMenu value={profile} onChange={(id) => { setProfile(id); setModel(null); }} /><ModelMenu runtime={runtime} value={model} onChange={setModel} /></div>
        <span className="cd-setgrid__l">Keep the pull request green</span>
        <div className="c-row"><Switch checked={keepGreen} onChange={setKeepGreen} label="Keep the pull request green" /><span className="cd-note cd-note--inline">Fix failing checks and answer review comments until it merges</span></div>
        <span className="cd-setgrid__l">Tries before it asks</span>
        <div><select className="c-select cd-narrow-select" value={maxTries} onChange={(e) => setMaxTries(Number(e.target.value))} aria-label="Tries before it asks">
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {n === 1 ? "try" : "tries"}</option>)}
        </select></div>
        <span className="cd-setgrid__l">Issue label</span>
        <div className="c-row cd-wrap"><input className="c-input cd-narrow-select" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Issue label" /><span className="cd-note cd-note--inline">An issue labelled this on GitHub becomes a task for the agent</span></div>
      </div>
    </section>
  );

  const scheduleNote = (
    <p className="cd-note">
      Saving also makes your own {schedulesFor(me?.id || "00000000").length} schedules, so pull requests you start are watched as you: GitHub's pull requests, checks, reviews and labelled issues, and a check every 15 minutes.
      {problems && problems.length ? <><br /><b>Couldn't make:</b> {problems.join("; ")}. The rest works; those updates wait for the next time someone opens a task.</> : null}
    </p>
  );

  if (done) {
    return (
      <div className="c-app">
        <Header back={{ label: "Coding agent", icon: ArrowLeft, onClick: () => to.board() }} title="Set-up" />
        <main className="c-body cd-setup">
          {github}
          {repoList}
          {defaults}
          {scheduleNote}
          <div className="c-setup__row">
            <Button variant="primary" busy={busy === "save"} disabled={!!busy} onClick={() => void save(false)}>Save</Button>
            <Button variant="ghost" onClick={() => to.board()}>Cancel</Button>
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="c-app">
      <div className="c-setup cd-setup cd-setup--first">
        <span className="cd-setup__icon"><SquareTerminal size={18} aria-hidden="true" /></span>
        <h1>Set up the coding agent</h1>
        <p className="c-setup__lead">Hand a task to an agent: Lemma in the cloud, or Claude Code or Codex on your Mac. It works in a branch of its own, opens the pull request, and keeps it green until a person merges it.</p>
        {github}
        {repoList}
        {defaults}
        {scheduleNote}
        <div className="c-setup__row">
          <Button variant="primary" busy={busy === "save"} disabled={!!busy || !picked.length} onClick={() => void save(false)}>Save and start</Button>
          <Button icon={FlaskConical} busy={busy === "sample"} disabled={!!busy} onClick={() => void save(true)}>Look around with a sample</Button>
        </div>
        {!picked.length && listed?.length ? <p className="cd-note">Tick at least one repository to start, or look around with the sample first.</p> : null}
        <p className="c-setup__note">The sample is made up: a few tasks, one pull request's whole life and two answered questions. No agent runs and nothing reaches GitHub; clearing it leaves your own work alone.</p>
      </div>
    </div>
  );
}
