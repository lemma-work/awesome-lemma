// Set-up, once, by whoever opens Triage first (and its settings after).
// Each step is optional except the first: the repositories to watch, who's
// on triage, Slack channels, Sentry projects, the PostHog project, and the
// report form. Or look around with a sample morning.

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FlaskConical, Inbox as InboxIcon, Trash2 } from "lucide-react";
import { Button, DEMO, Field, Pill, Switch, runFunction, useToast } from "@lemma-plugins/kit";
import { useTriage, useWho } from "./data";
import { Gap, Who } from "./marks";
import { to } from "./route";
import { FORM_COLUMNS, ensureSchedules, turnOnForm, why, type Step } from "./wire";

export function Setup() {
  const d = useTriage();
  const { me, members } = useWho();
  const toast = useToast();
  const s = d.settings;
  const first = !s?.setup_done_at;
  const [repos, setRepos] = useState("");
  const [rotation, setRotation] = useState<string[]>([]);
  const [channels, setChannels] = useState("");
  const [teamId, setTeamId] = useState("");
  const [sentryOrg, setSentryOrg] = useState("");
  const [sentryProjects, setSentryProjects] = useState("");
  const [posthogProject, setPosthogProject] = useState("");
  const [posthogAccount, setPosthogAccount] = useState("");
  const [form, setForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  useEffect(() => {
    if (!s) return;
    setRepos(s.repos.map((r) => r.full_name).join("\n"));
    setRotation(s.rotation);
    setChannels((s.slack.channels || []).map((c) => `${c.id} ${c.name}`).join("\n"));
    setTeamId(s.slack.team_id || "");
    setSentryOrg(s.sentry.org || "");
    setSentryProjects((s.sentry.projects || []).join("\n"));
    setPosthogProject(s.posthog.project_id || "");
    setPosthogAccount(s.posthog.account_id || "");
    setForm(s.form_on);
  }, [s]);
  useEffect(() => { if (!s?.rotation?.length && me && !rotation.length) setRotation([me.id]); }, [me, s, rotation.length]);
  const people = useMemo(() => members.length ? members : (s?.people || []).map((p) => ({ user_id: p.user_id, name: p.name, email: p.email || "" })), [members, s]);
  const name = (id: string) => people.find((p) => p.user_id === id)?.name || "a member";
  const repoList = repos.split(/\n|,/).map((x) => x.trim().replace(/^https:\/\/github\.com\//, "")).filter((x) => /^[\w.-]+\/[\w.-]+$/.test(x));

  const sample = async () => {
    setBusy("sample");
    try {
      const out = await runFunction<{ message?: string }>("triage_sample_data", { mode: "load" });
      toast(out?.message || "Loaded the sample morning.");
      await d.reload();
      to.list();
    } catch (e) {
      toast(`Couldn't load the sample: ${why(e)}`);
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (DEMO) { toast("In the demo the set-up isn't saved."); to.list(); return; }
    setBusy("save");
    setSteps([]);
    try {
      const slack = {
        account: s?.slack.account || "slack", team_id: teamId.trim() || null,
        channels: channels.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [id, nm] = l.split(/\s+/); return { id, name: (nm || id).replace(/^#/, "") }; }),
      };
      const patch = {
        repos: repoList.map((full_name) => ({ full_name })), rotation, slack,
        sentry: { account: s?.sentry.account || "sentry", org: sentryOrg.trim() || null, projects: sentryProjects.split(/\n|,/).map((x) => x.trim()).filter(Boolean) },
        posthog: { account: s?.posthog.account || "posthog", account_id: posthogAccount.trim() || null, project_id: posthogProject.trim() || null },
        people: people.map((p) => ({ ...(s?.people.find((x) => x.user_id === p.user_id) || {}), user_id: p.user_id, name: p.name, email: p.email || null })),
        done: true,
      };
      await runFunction("triage_setup_save", patch);
      await d.reload();
      const fresh = { ...(s || {}), ...patch, slack } as never;
      const out = await ensureSchedules(fresh, me?.id || null, Boolean(me && rotation.includes(me.id)));
      if (form && !s?.form_on) await turnOnForm(fresh, "anyone", FORM_COLUMNS, [], (r) => setSteps((x) => [...x, r]));
      await d.reload();
      toast(out.problems.length ? `Set up. Couldn't make: ${out.problems.join("; ")}` : "Triage is set up.");
      if (!form || s?.form_on) to.list();
    } catch (e) {
      toast(`Couldn't save the set-up: ${why(e)}`);
    } finally {
      setBusy("");
    }
  };

  const move = (i: number, step: number) => setRotation((list) => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + step)), 0, x);
    return next;
  });

  return (
    <div className="c-app">
      <header className="tr-top">
        <button type="button" className="tr-top__name" onClick={() => (first ? undefined : to.list())}><InboxIcon aria-hidden="true" />Triage</button>
        <span className="tr-top__fill" />
        {!first ? <Button variant="ghost" onClick={() => to.list()}>Back to the inbox</Button> : null}
      </header>
      <main className="c-body tr-setup">
        <div className="tr-setup__lead">
          <h1 className="tr-title">{first ? "Set up triage" : "Triage set-up"}</h1>
          <p className="tr-muted">Bugs, alerts and security warnings, from wherever they're reported, sorted by how far they reach, each with an owner and the reason. Only the first step is needed.</p>
          {first ? (
            <div className="tr-row-inline">
              <Button icon={FlaskConical} busy={busy === "sample"} onClick={() => void sample()}>Look around with a sample morning</Button>
              <span className="tr-small tr-faint">Made-up reports and people; nothing is posted outside the Lemma.</span>
            </div>
          ) : null}
        </div>

        <ol className="tr-setup__steps">
          <li>
            <h2 className="tr-h2"><span className="tr-step__n">1</span>The repositories to watch</h2>
            <Field label="Repositories" hint="owner/name, one a line. Their issues, +1 comments and security alerts become reports; CODEOWNERS suggests owners.">
              <textarea className="c-textarea" rows={3} value={repos} onChange={(e) => setRepos(e.target.value)} placeholder={"acme/web\nacme/api"} />
            </Field>
            <p className="tr-small tr-faint">Through the Lemma's GitHub connection. {repoList.length ? `${repoList.length} to watch.` : ""}</p>
          </li>
          <li>
            <h2 className="tr-h2"><span className="tr-step__n">2</span>Who's on triage<span className="tr-sub">a week each, in this order</span></h2>
            <div className="tr-rules">
              {rotation.map((id, i) => (
                <div key={id} className="tr-rule">
                  <span className="tr-faint tr-num">{i + 1}</span>
                  <span className="tr-who"><Who name={name(id)} />{name(id)}</span>
                  {i === 0 ? <Pill tone="info">This week</Pill> : null}
                  <span className="tr-fill" />
                  <span className="tr-row-inline">
                    <Button size="sm" variant="ghost" icon={ArrowUp} label="Earlier" disabled={i === 0} onClick={() => move(i, -1)} />
                    <Button size="sm" variant="ghost" icon={ArrowDown} label="Later" disabled={i === rotation.length - 1} onClick={() => move(i, 1)} />
                    <Button size="sm" variant="ghost" icon={Trash2} label="Take off" onClick={() => setRotation((x) => x.filter((y) => y !== id))} />
                  </span>
                </div>
              ))}
            </div>
            <select className="c-select" aria-label="Add someone" value="" onChange={(e) => e.target.value && setRotation((x) => [...x, e.target.value])}>
              <option value="">Add someone…</option>
              {people.filter((p) => !rotation.includes(p.user_id)).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
            </select>
          </li>
          <li>
            <h2 className="tr-h2"><span className="tr-step__n">3</span>Slack channels to watch<span className="tr-sub">optional</span></h2>
            <Field label="Channels" hint="The channel id and its name, one a line (C0123ABC support). The Lemma's bot must be in each. Questions and chatter are left alone.">
              <textarea className="c-textarea" rows={2} value={channels} onChange={(e) => setChannels(e.target.value)} placeholder="C0123ABC support" />
            </Field>
            <Field label="Workspace id"><input className="c-input" value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="T0123ABC" /></Field>
            <Gap>Read every 15 minutes until Slack's channel trigger is live (lemma-platform#1245)</Gap>
          </li>
          <li>
            <h2 className="tr-h2"><span className="tr-step__n">4</span>Sentry projects<span className="tr-sub">optional</span></h2>
            <Field label="Organization slug"><input className="c-input" value={sentryOrg} onChange={(e) => setSentryOrg(e.target.value)} placeholder="acme" /></Field>
            <Field label="Projects" hint="Slugs, one a line; empty for every project."><textarea className="c-textarea" rows={2} value={sentryProjects} onChange={(e) => setSentryProjects(e.target.value)} /></Field>
            <Gap>No Sentry trigger: read every 15 minutes</Gap>
          </li>
          <li>
            <h2 className="tr-h2"><span className="tr-step__n">5</span>PostHog project<span className="tr-sub">optional</span></h2>
            <Field label="Project id" hint="Read over PostHog's MCP server, through the Lemma's PostHog connection."><input className="c-input" value={posthogProject} onChange={(e) => setPosthogProject(e.target.value)} /></Field>
            <Field label="Connected account id" hint="Only when the Lemma has more than one MCP account."><input className="c-input" value={posthogAccount} onChange={(e) => setPosthogAccount(e.target.value)} /></Field>
          </li>
          <li>
            <h2 className="tr-h2"><span className="tr-step__n">6</span>The report form<span className="tr-sub">optional</span></h2>
            <Switch checked={form} onChange={setForm} label="Turn on a form people outside can send reports with, and copy its link from Doors" />
            <p className="tr-small tr-faint">A link Lemma hosts, your help page, or inside your product. It needs edit access in this Lemma.</p>
            {steps.length ? <ul className="tr-steplist">{steps.map((r) => <li key={r.step}><Pill tone={r.ok ? "success" : "danger"}>{r.ok ? "Done" : "Didn't work"}</Pill> {r.said}</li>)}</ul> : null}
          </li>
        </ol>
        <div className="tr-row-inline">
          <Button variant="primary" busy={busy === "save"} disabled={!repoList.length && first} onClick={() => void save()}>{first ? "Start triage" : "Save"}</Button>
          {first && !repoList.length ? <span className="tr-small tr-faint">Add a repository to start, or look around with the sample.</span> : null}
          {steps.length && form ? <Button onClick={() => to.list()}>Go to the inbox</Button> : null}
        </div>
      </main>
    </div>
  );
}
