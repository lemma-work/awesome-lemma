// Set-up, once for the whole Lemma, by whoever opens Incidents first: the
// Slack connection and #incidents, the repositories to watch, who gets
// updates by email, and the severity words. Or sample incidents to look
// around with. The same screen changes it later.

import { useState } from "react";
import { ArrowLeft, Plus, TriangleAlert, X } from "lucide-react";
import { Button, Field, Header, Spinner, useToast } from "@lemma-plugins/kit";
import { DEFAULT_SEVERITIES, call, useIncidents } from "./data";
import { to } from "./route";
import { ensureSchedules } from "./wire";
import type { Repo, Severity, Settings } from "./types";

export function Setup() {
  const { settings, reload } = useIncidents();
  const toast = useToast();
  const done = !!settings?.setup_done_at;
  const [channel, setChannel] = useState(settings?.announce_channel_name ? `#${settings.announce_channel_name}` : "#incidents");
  const [prefix, setPrefix] = useState(settings?.channel_prefix || "inc-");
  const [repos, setRepos] = useState<Repo[]>(settings?.repos?.length ? settings.repos : [{ repo: "", service: "", deploy_workflow: "" }]);
  const [emails, setEmails] = useState((settings?.email_to || []).join(", "));
  const [sender, setSender] = useState(settings?.email_from || "");
  const [sevs, setSevs] = useState<Severity[]>(settings?.severities?.length ? settings.severities : DEFAULT_SEVERITIES);
  const [busy, setBusy] = useState("");

  const save = async (sample: boolean) => {
    setBusy(sample ? "sample" : "save");
    try {
      const watched = repos.filter((r) => r.repo.includes("/"));
      const out = await call("incidents_setup_save", {
        announce_channel: sample ? null : channel, channel_prefix: prefix, repos: sample ? null : watched,
        email_to: sample ? null : emails.split(/[\s,;]+/).filter((e) => e.includes("@")),
        email_from: sample ? null : sender, severities: sevs, sample,
      });
      const { made, problems } = await ensureSchedules({ ...(settings || {}), id: String(out.settings_id || settings?.id || "") } as Settings, sample ? 0 : watched.length);
      if (Object.keys(made).length) await call("incidents_setup_save", { schedules: made }).catch(() => undefined);
      if (problems.length) toast(`Couldn't make ${problems.join(", ")}. Incidents still works; changes and messages arrive less often.`);
      if (sample) {
        try {
          const loaded = await call("incidents_sample_data", { mode: "load" });
          toast(String(loaded.message || "Loaded the sample."));
        } catch {
          toast("The sample is still loading; it fills in here in a moment.");
        }
      } else {
        toast(String(out.message || "Saved."));
      }
      await reload();
      to.list();
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  const setRepo = (i: number, patch: Partial<Repo>) => setRepos((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const setSev = (i: number, patch: Partial<Severity>) => setSevs((ss) => ss.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  const form = (
    <div className="in-form">
      <Field label="Announce incidents in" hint="Every incident is announced here, and each update the lead sends goes here too. Made if it doesn't exist.">
        <input className="c-input" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="#incidents" />
      </Field>
      <Field label="Each incident's channel starts with" hint={`#${prefix || "inc-"}14-checkout-502`}>
        <input className="c-input" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
      </Field>
      <div className="c-field">
        <span>Repositories to watch</span>
        <small className="c-field__hint">Merges, pushes to the default branch, deploy workflow runs and releases, kept for what changed before an incident.</small>
        {repos.map((r, i) => (
          <div key={i} className="in-repo">
            <input className="c-input" value={r.repo} onChange={(e) => setRepo(i, { repo: e.target.value })} placeholder="owner/repository" aria-label="Repository" />
            <input className="c-input" value={r.service || ""} onChange={(e) => setRepo(i, { service: e.target.value })} placeholder="Service" aria-label="Service" />
            <input className="c-input" value={r.deploy_workflow || ""} onChange={(e) => setRepo(i, { deploy_workflow: e.target.value })} placeholder="Deploy workflow" aria-label="Deploy workflow name" />
            <Button variant="ghost" icon={X} label="Remove" onClick={() => setRepos((rs) => rs.filter((_, k) => k !== i))} />
          </div>
        ))}
        <div><Button size="sm" variant="ghost" icon={Plus} onClick={() => setRepos((rs) => [...rs, { repo: "", service: "", deploy_workflow: "" }])}>Add a repository</Button></div>
      </div>
      <Field label="Email each update to" hint="Sent through the Lemma's mailbox (Resend) when it has one; otherwise updates go to Slack only.">
        <input className="c-input" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="support@company.example, cx@company.example" />
      </Field>
      <Field label="Send those emails from" hint="An address on a domain your mailbox has verified. Leave it empty to keep updates in Slack.">
        <input className="c-input" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="Incidents <incidents@company.example>" />
      </Field>
      <div className="c-field">
        <span>Severity words</span>
        <small className="c-field__hint">Most severe first. The Lemma drafts an update when one is due.</small>
        {sevs.map((s, i) => (
          <div key={i} className="in-sevrow">
            <span className="in-sevrow__key">{s.key.toUpperCase()}</span>
            <input className="c-input" value={s.word} onChange={(e) => setSev(i, { word: e.target.value })} aria-label={`${s.key} word`} />
            <select className="c-select" value={s.update_every_min} onChange={(e) => setSev(i, { update_every_min: Number(e.target.value) })} aria-label={`${s.key} update cadence`}>
              {[15, 30, 60, 120].map((m) => <option key={m} value={m}>update every {m} min</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );

  if (done) {
    return (
      <div className="c-app">
        <Header back={{ label: "Incidents", icon: ArrowLeft, onClick: () => to.list() }} title="Set-up" />
        <main className="c-body in-setup--narrow">
          {form}
          <div className="c-setup__row">
            <Button variant="primary" busy={busy === "save"} onClick={() => void save(false)}>Save</Button>
            <Button variant="ghost" onClick={() => to.list()}>Cancel</Button>
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="c-app">
      <div className="c-setup">
        <span className="in-setup__icon"><TriangleAlert size={18} aria-hidden="true" /></span>
        <h1>Set up incidents</h1>
        <p className="c-setup__lead">Once for the whole Lemma. It uses the Lemma's Slack and GitHub connections; nothing is posted until someone declares.</p>
        {form}
        <div className="c-setup__row">
          <Button variant="primary" busy={busy === "save"} disabled={!!busy} onClick={() => void save(false)}>Save and start</Button>
          <Button busy={busy === "sample"} disabled={!!busy} onClick={() => void save(true)}>Look around with a sample incident</Button>
        </div>
        {busy === "sample" ? <p className="c-muted c-row in-small"><Spinner /> Making a sample outage and three past incidents…</p> : null}
        <p className="c-setup__note">The sample is made up (made-up people and services) and posts nothing to Slack; clearing it leaves your own incidents alone.</p>
      </div>
    </div>
  );
}
