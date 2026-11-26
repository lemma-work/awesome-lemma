// Set-up, done once for the whole Lemma by whoever opens it first, and the
// same form again in Settings:
//
//   connections    GitHub (needed) and Slack (optional), shared for the whole
//                  Lemma, connected here with the kit's <Connect>
//   repositories   from the Lemma's shared GitHub connection
//   live           how you know a release reached people: the deploy
//                  workflow's run (default), or a tag. A deployment
//                  environment is shown and can't be picked yet.
//   Slack          the channel the note is posted to, optional
//   publishers     who presses Publish (they get "notes are ready" in Today)
//
// Saving makes the Lemma-wide schedules as the person saving (a schedule runs
// as whoever made it; a function can't make one), and each person's own
// triggers are made when they open the app.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, Github, Globe, Hash, Rocket, Tag } from "lucide-react";
import { Brief, Button, Card, Connect, DEMO, Field, Notice, Pill, Spinner, client, demoNote, items, q, useToast, errorText } from "@lemma-plugins/kit";
import { browserZone, call, ensureMine, ensureTeamSchedules, json, useRN, useWho } from "./data";
import { to } from "./route";
import { Top } from "./Top";
import type { RepoCfg, Settings as SettingsRow } from "./types";

interface Options {
  github: string;
  repos: { name: string; private: boolean; default_branch?: string }[];
  workflows: { name: string; path: string; state?: string }[];
  slack: string;
  channels: { id: string; name: string }[];
}

export function Setup() {
  const rn = useRN();
  const toast = useToast();
  const [mode, setMode] = useState<"choose" | "real">(rn.settings?.setup_done_at ? "real" : "choose");
  const [loading, setLoading] = useState(false);
  const sample = async () => {
    setLoading(true);
    try {
      const out = await call("release_notes_sample_data", { mode: "load" });
      toast(String(out.message || "Loaded the sample."));
      await rn.reload();
      to.desk();
    } catch (e) {
      toast(`Couldn't load the sample: ${errorText(e)}`);
    } finally {
      setLoading(false);
    }
  };
  if (mode === "choose") {
    return (
      <div className="c-app">
        <main className="c-setup">
          <Brief>I draft your release notes from what merges, keep the routine work out, and when the release is live I help you tell everyone who asked for it, in the thread they asked in.</Brief>
          <h1 className="rn-setup__h">Release notes</h1>
          <p className="c-muted">Once for the whole Lemma: the repositories, how you know a release is live, an optional Slack channel, and who publishes.</p>
          <div className="c-choices">
            <button type="button" className="c-choice" onClick={() => setMode("real")}>
              <Github size={16} aria-hidden="true" />
              <span className="c-grow"><b className="rn-b">Set it up for your repositories</b><span className="rn-meta rn-block">Connect GitHub once, for everyone in this Lemma, on the next page.</span></span>
            </button>
            <button type="button" className="c-choice" onClick={() => void sample()} disabled={loading}>
              {loading ? <Spinner /> : <FlaskConical size={16} aria-hidden="true" />}
              <span className="c-grow"><b className="rn-b">Look around with a sample release</b><span className="rn-meta rn-block">A made-up product's v2.14, with the people who asked for it. Nothing reaches GitHub, Slack or anyone's mail.</span></span>
            </button>
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="c-app">
      <main className="c-setup rn-setup">
        <h1 className="rn-setup__h">Set up Release notes</h1>
        <SetupForm first />
      </main>
    </div>
  );
}

export function Settings() {
  const rn = useRN();
  return (
    <>
      <Top here="settings" />
      <main className="c-body rn-settings">
        <div className="c-split">
          <div className="c-stack"><SetupForm /></div>
          <div className="c-stack">
            <PageCard />
            <Mine />
            {rn.sample ? <SampleCard /> : null}
          </div>
        </div>
      </main>
    </>
  );
}

function SetupForm({ first }: { first?: boolean }) {
  const rn = useRN();
  const { me, members } = useWho();
  const toast = useToast();
  const s = rn.settings && !rn.settings.sample ? rn.settings : null;
  const [opts, setOpts] = useState<Options | null>(null);
  const [product, setProduct] = useState(s?.product || "");
  const [repos, setRepos] = useState<RepoCfg[]>(s?.repos || []);
  const [slack, setSlack] = useState<string>(s?.slack_channel || "");
  const [publishers, setPublishers] = useState<string[]>(s?.publishers.map((p) => p.user_id) || (me ? [me.id] : []));
  const [workflows, setWorkflows] = useState<Record<string, Options["workflows"]>>({});
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  // What the connections can see. `github` and `slack` are "ok" or the function's
  // own words for what failed: those only decide what shows, never shown as they are.
  const readOpts = useCallback(() => {
    if (DEMO) {
      setOpts({ github: "ok", repos: [{ name: "fernway/web", private: true }, { name: "fernway/api", private: true }], workflows: [], slack: "ok",
        channels: [{ id: "C07QSFERN", name: "product-updates" }, { id: "C07ENG", name: "eng" }] });
      return;
    }
    void call("release_notes_setup_options", {}).then((o) => setOpts(o as unknown as Options))
      .catch(() => setOpts({ github: "failed", repos: [], workflows: [], slack: "failed", channels: [] }));
  }, []);
  useEffect(readOpts, [readOpts]);
  useEffect(() => { if (!publishers.length && me) setPublishers([me.id]); }, [me, publishers.length]);
  const loadWorkflows = (name: string) => {
    if (workflows[name] || DEMO) return;
    void call("release_notes_setup_options", { repo: name, slack: false })
      .then((o) => setWorkflows((w) => ({ ...w, [name]: (o as unknown as Options).workflows || [] }))).catch(() => undefined);
  };
  useEffect(() => { repos.forEach((r) => loadWorkflows(r.name)); }, [repos.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleRepo = (name: string, on: boolean) => {
    setRepos((list) => on ? [...list, { name, live_via: "workflow", workflow: "Deploy", environment: "production", paths: [] }] : list.filter((r) => r.name !== name));
    if (on) loadWorkflows(name);
  };
  const setRepo = (name: string, patch: Partial<RepoCfg>) => setRepos((list) => list.map((r) => (r.name === name ? { ...r, ...patch } : r)));
  const channel = opts?.channels.find((c) => c.id === slack);
  const people = useMemo(() => (members.length ? members : me ? [{ user_id: me.id, name: me.name, email: me.email || "" }] : []), [members, me]);

  const save = async () => {
    if (!me) return;
    setBusy(true);
    setLog([]);
    try {
      if (DEMO) {
        demoNote("In the demo the set-up isn't saved: in a Lemma this keeps it and turns on the GitHub triggers as you.");
        return;
      }
      const out = await call("release_notes_setup_save", {
        product: product.trim() || null, repos, slack_channel: slack || null, slack_channel_name: channel?.name || null,
        publishers: publishers.map((id) => ({ user_id: id, name: people.find((p) => p.user_id === id)?.name || null })),
      });
      if (out.saved === false) throw new Error(String(out.message));
      const lines = [String(out.message)];
      if (out.memory) lines.push(String(out.memory));
      await rn.reload();
      const fresh = (await q<{ id: string; schedules: unknown }>("SELECT id, schedules FROM release_note_settings ORDER BY created_at LIMIT 1"))[0];
      const settings = { id: fresh?.id || "", repos, schedules: json<Record<string, string>>(fresh?.schedules, {}) } as SettingsRow;
      if (settings.id) {
        const sched = await ensureTeamSchedules(settings, me);
        lines.push(...sched.said);
      }
      const mine = await ensureMine(me);
      if (mine) lines.push(mine);
      setLog(lines);
      toast("Saved.");
      if (first) to.desk();
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const noGithub = opts && opts.github !== "ok" && !opts.repos.length;
  // Connected after this page read the options: read them again.
  const githubReady = () => { if (opts && opts.github !== "ok") { setOpts(null); readOpts(); } };
  const slackReady = () => { if (opts && opts.slack !== "ok") readOpts(); };
  return (
    <>
      <Connect connector="github" slug="github" mode="shared" onReady={githubReady}
        purpose="One GitHub connection for the whole Lemma: it reads the pull requests that merge and the deploys that finish in the repositories you pick, and puts the published note on the release. A comment is posted only when a person presses Send." />
      <Card title="Product">
        <Field label="What people call it" hint="The changelog page and the notes say this name.">
          <input className="c-input" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Fernway" />
        </Field>
      </Card>
      <Card title="Repositories" icon={Github} flush>
        {!opts ? <p className="rn-pad rn-meta"><Spinner /> Reading what the GitHub connection can see…</p> : null}
        {noGithub ? (
          <p className="rn-pad rn-meta">No repositories yet: once GitHub is connected above, the ones the Lemma's GitHub app is on show here. <Button size="sm" variant="ghost" onClick={() => { setOpts(null); readOpts(); }}>Look again</Button></p>
        ) : null}
        {opts?.repos.map((r) => {
          const on = repos.find((x) => x.name === r.name);
          return (
            <div key={r.name} className="rn-repo">
              <label className="rn-dest">
                <input type="checkbox" checked={!!on} onChange={(e) => toggleRepo(r.name, e.target.checked)} />
                <span className="c-grow"><span className="rn-dest__t">{r.name}</span>{r.private ? <span className="rn-meta">Private</span> : null}</span>
              </label>
              {on ? (
                <div className="rn-repo__how">
                  <span className="rn-meta">How do you know it's live?</span>
                  <div className="rn-seg-sm">
                    <button type="button" aria-pressed={on.live_via === "workflow"} onClick={() => setRepo(r.name, { live_via: "workflow" })}><Rocket size={12} aria-hidden="true" /> Deploy workflow</button>
                    <button type="button" aria-pressed={on.live_via === "tag"} onClick={() => setRepo(r.name, { live_via: "tag" })}><Tag size={12} aria-hidden="true" /> A tag is pushed</button>
                    <button type="button" disabled aria-pressed={false} title="GitHub deployments aren't on the platform yet"><Globe size={12} aria-hidden="true" /> Deployment</button>
                  </div>
                  {on.live_via === "workflow" ? (
                    <Field label="Deploy workflow" hint="Its successful run on the default branch is what makes a release live.">
                      {(workflows[r.name] || []).length ? (
                        <select className="c-input" value={on.workflow || ""} onChange={(e) => setRepo(r.name, { workflow: e.target.value })}>
                          <option value="">Pick one</option>
                          {(workflows[r.name] || []).map((w) => <option key={w.path} value={w.name}>{w.name}</option>)}
                        </select>
                      ) : <input className="c-input" value={on.workflow || ""} onChange={(e) => setRepo(r.name, { workflow: e.target.value })} placeholder="Deploy" />}
                    </Field>
                  ) : null}
                  <p className="rn-meta">A deployment environment (production) can be chosen once GitHub deployment events are on the platform; until then, the deploy workflow's run says it's live.</p>
                  <Field label="Only these paths (optional)" hint="For one product in a shared repository: web/**, apps/billing/**">
                    <input className="c-input" value={(on.paths || []).join(", ")} onChange={(e) => setRepo(r.name, { paths: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
                  </Field>
                </div>
              ) : null}
            </div>
          );
        })}
      </Card>
      <Card title="Slack" icon={Hash}>
        <Connect connector="slack" slug="slack" mode="shared" onReady={slackReady} className="rn-connect-in"
          purpose="Optional: posts the published note to the channel you pick, and replies in the Slack thread of someone who asked, when a person presses Send. Without it, the note still goes to GitHub and the changelog page, and nobody is told in Slack." />
        <Field label="Post the published note to" hint="Optional. Posted by the Lemma's Slack app.">
          <select className="c-input" value={slack} onChange={(e) => setSlack(e.target.value)} disabled={!opts?.channels.length}>
            <option value="">Nowhere</option>
            {opts?.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </Field>
      </Card>
      <Card title="Who publishes" flush foot={<span className="rn-meta">They get "notes are ready" in Today when a release goes live. Publishing posts to GitHub as the person who presses it.</span>}>
        {people.map((p) => (
          <label key={p.user_id} className="rn-dest">
            <input type="checkbox" checked={publishers.includes(p.user_id)}
              onChange={(e) => setPublishers((list) => e.target.checked ? [...list, p.user_id] : list.filter((x) => x !== p.user_id))} />
            <span className="c-grow"><span className="rn-dest__t">{p.name}{p.user_id === me?.id ? " (you)" : ""}</span><span className="rn-meta">{p.email}</span></span>
          </label>
        ))}
      </Card>
      <div className="c-row">
        <Button variant="primary" busy={busy} onClick={() => void save()} disabled={!repos.length || !publishers.length}>{first ? "Turn on Release notes" : "Save"}</Button>
        {first ? <Button variant="ghost" onClick={() => window.history.back()}>Back</Button> : null}
      </div>
      {log.length ? <div className="c-log">{log.map((l, i) => <span key={i}>{l}</span>)}</div> : null}
    </>
  );
}

/* ---------- the public page ---------- */

const WIDGET = "Changelog";

function PageCard() {
  const rn = useRN();
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(rn.settings?.page_url || null);
  const [state, setState] = useState<"unknown" | "on" | "off">("unknown");
  const [busy, setBusy] = useState(false);
  const pages = rn.published.length;
  useEffect(() => {
    if (DEMO) { setUrl("https://fernway-changelog.apps.lemma.work"); setState("on"); return; }
    void client.request<{ url?: string | null }>("GET", `/pods/${client.podId}/apps/changelog`).then((a) => setUrl(a?.url || null)).catch(() => undefined);
    void client.request<{ items: { name: string; allowed_origins: string[]; answer: string }[] }>("GET", `/pods/${client.podId}/web-widgets`)
      .then((r) => {
        const w = (r.items || []).find((x) => x.name === WIDGET);
        setState(w && w.answer !== "off" ? "on" : "off");
      }).catch(() => setState("off"));
  }, []);
  const turnOn = async () => {
    if (!url) return;
    setBusy(true);
    try {
      const origin = new URL(url).origin;
      const list = items<{ id: string; name: string; allowed_origins: string[] }>(await client.request("GET", `/pods/${client.podId}/web-widgets`));
      const w = list.find((x) => x.name === WIDGET);
      // "known": anonymous readers can read what's Public; only the Lemma's contacts could chat.
      if (w) await client.request("PATCH", `/pods/${client.podId}/web-widgets/${w.id}`, { body: { allowed_origins: [...new Set([...(w.allowed_origins || []), origin])].slice(0, 20), answer: "known" } });
      else await client.request("POST", `/pods/${client.podId}/web-widgets`, { body: { name: WIDGET, allowed_origins: [origin], answer: "known" } });
      if (rn.settings) await client.records.update("release_note_settings", rn.settings.id, { page_url: url } as never);
      setState("on");
      toast("The changelog page can read your published notes.");
    } catch (e) {
      toast(`Couldn't turn it on: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Changelog page" action={state === "on" ? <Pill tone="success">Live</Pill> : state === "off" ? <Pill>Off</Pill> : null}>
      <div className="rn-kv rn-kv--flat">
        <span className="rn-kv__l">Address</span><span>{url ? <a href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, "")}</a> : "Not known yet"}</span>
        <span className="rn-kv__l">Look</span><span>{rn.brand ? `${rn.brand.name}'s brand, from Brand kit` : "Plain; Brand kit's colours and type once it has them"}</span>
        <span className="rn-kv__l">Shows</span><span>{pages} published note{pages === 1 ? "" : "s"}, newest first<span className="rn-meta rn-block">The page reads at most 500.</span></span>
        <span className="rn-kv__l">Card</span><span className="c-muted">A card for your own product isn't built yet.</span>
      </div>
      {state === "off" ? <Button size="sm" busy={busy} onClick={() => void turnOn()} disabled={!url}>Turn the page on</Button> : null}
    </Card>
  );
}

function Mine() {
  const { me } = useWho();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Your own part">
      <p className="c-muted">When someone you heard asking has their work ship, a reply is drafted in your own thread and put in your Today. That runs as you, made the first time you opened Release notes.</p>
      <Button size="sm" busy={busy} onClick={() => {
        if (!me || DEMO) return;
        setBusy(true);
        void ensureMine(me).then((p) => toast(p || "Your triggers are on.")).finally(() => setBusy(false));
      }}>Check my triggers</Button>
      <p className="rn-meta">Times are your own ({browserZone()}).</p>
    </Card>
  );
}

function SampleCard() {
  const rn = useRN();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Card title="The sample">
      <p className="c-muted">Fernway is made up. Clearing it removes only what the sample made, and set-up starts again.</p>
      <Button size="sm" busy={busy} onClick={() => {
        setBusy(true);
        void call("release_notes_sample_data", { mode: "clear" }).then((o) => { toast(String(o.message || "Cleared.")); void rn.reload(); })
          .catch((e) => toast(`Couldn't clear it: ${errorText(e)}`)).finally(() => setBusy(false));
      }}>Clear the sample</Button>
      {DEMO ? null : <Notice>Set it up for real from the form here once it's cleared.</Notice>}
    </Card>
  );
}
