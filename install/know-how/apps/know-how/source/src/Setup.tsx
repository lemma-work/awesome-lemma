// The team's set-up, once. The `knowhow-setup` workflow does the work and
// waits on four forms; this is the screen for them, as Mail's is for its own.
// After the run, the steps only a person can do (Public, contact functions, a
// restricted folder, schedules) run here, each read back.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, FlaskConical, Globe, Lock, Plus, Upload, Users } from "lucide-react";
import { Button, Connect, DEMO, Field, Pill, Spinner, Switch, client, errorText, runFunction, usePath, useToast } from "@lemma-plugins/kit";
import { useKnowhow, useWho, type Audience, type ProposedTopic } from "./data";
import { Ai, Gap } from "./marks";
import { to } from "./route";
import { finishSetup, teamsOn, uploadToInbox, type Step } from "./wire";

interface Run { id: string; status: string; active_wait?: { node_id?: string } | null; step_history?: { node_id: string }[] }
const STEPS = ["Sources", "Read", "Owners", "Where", "Who sees", "Done"];
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } };

function stepOf(run: Run | null): number {
  if (!run) return 0;
  const node = run.active_wait?.node_id || run.step_history?.[run.step_history.length - 1]?.node_id || "";
  if (node === "sources") return 0;
  if (["route", "read", "anything", "reader", "keep"].includes(node)) return 1;
  if (["owners", "apply"].includes(node)) return 2;
  if (node === "places") return 3;
  if (node === "audiences") return 4;
  return 5;
}

function Rail({ at }: { at: number }) {
  return (
    <ol className="kh-rail" aria-label="Set-up steps">
      {STEPS.map((label, i) => (
        <li key={label} className={i < at ? "is-done" : i === at ? "is-here" : ""} aria-current={i === at ? "step" : undefined}>
          <span className="kh-rail__dot">{i < at ? <Check size={11} aria-hidden="true" /> : i + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

export function Setup() {
  const d = useKnowhow();
  const s = d.settings;
  const [run, setRun] = useState<Run | null>(null);
  const [lost, setLost] = useState(false);
  const runId = s?.setup_run_id || null;
  const poll = useCallback(async () => {
    if (!runId || DEMO) return;
    try {
      const fresh = (await client.workflows.runs.get(runId)) as unknown as Run;
      setRun(fresh);
      setLost(false);
      if (fresh.status === "COMPLETED") void d.reload();
    } catch {
      setLost(true);
    }
  }, [runId, d]);
  useEffect(() => {
    if (!runId) { setRun(null); return; }
    void poll();
    const t = window.setInterval(() => void poll(), 2500);
    return () => window.clearInterval(t);
  }, [runId, poll]);

  const [path] = usePath();
  const demoStep = DEMO ? path.split("/").filter(Boolean)[1] || null : null;
  if (demoStep) {
    // The demo's own walk through set-up: each form drawn on the sample's proposals.
    const fake: Run = { id: "demo", status: "WAITING", active_wait: { node_id: demoStep } };
    const at = stepOf(fake);
    return (
      <div className="c-app kh-setup-page">
        <div className="c-setup kh-setup">
          <Rail at={at} />
          {demoStep === "owners" ? <Owners run={fake} /> : demoStep === "places" ? <Places run={fake} /> : demoStep === "audiences" ? <Audiences run={fake} /> : <Sources failed={null} />}
        </div>
      </div>
    );
  }
  const failed = run && ["FAILED", "CANCELLED"].includes(String(run.status));
  const waiting = run?.status === "WAITING" ? run.active_wait?.node_id : null;
  let body;
  if (s?.setup_done_at && runId && (!run || run.status === "COMPLETED")) body = <Finish />;
  else if (!runId || lost || failed || !run || waiting === "sources") body = <Sources failed={failed ? "The last set-up stopped partway. Start again; your files are still there." : null} />;
  else if (waiting === "owners") body = <Owners run={run} />;
  else if (waiting === "places") body = <Places run={run} />;
  else if (waiting === "audiences") body = <Audiences run={run} />;
  else body = <Working run={run} />;
  return (
    <div className="c-app kh-setup-page">
      <div className="c-setup kh-setup">
        <Rail at={s?.setup_done_at ? 5 : runId && run && !failed ? stepOf(run) : 0} />
        {body}
      </div>
    </div>
  );
}

async function submit(run: Run, node: string, inputs: Record<string, unknown>) {
  if (DEMO) {
    const next: Record<string, string> = { sources: "owners", owners: "places", places: "audiences" };
    to.setup(next[node]);
    if (!next[node]) to.answers();
    return;
  }
  await client.workflows.runs.submitForm(run.id, { node_id: node, inputs } as never);
}

function Sources({ failed }: { failed: string | null }) {
  const d = useKnowhow();
  const toast = useToast();
  const [website, setWebsite] = useState("");
  const [folders, setFolders] = useState("");
  const [note, setNote] = useState("");
  const [uploaded, setUploaded] = useState<{ name: string; ok: boolean; said: string }[]>([]);
  const [busy, setBusy] = useState("");
  const begin = async (choice: "sources" | "sample") => {
    if (DEMO) {
      if (choice === "sample") return toast("This demo is the sample.");
      return void submit({ id: "demo", status: "WAITING" }, "sources", {});
    }
    setBusy(choice);
    try {
      const run = (await client.workflows.runs.create("knowhow-setup")) as unknown as Run;
      await runFunction("knowhow_setup_save", { setup_run_id: run.id, timezone: zone() });
      const drive = folders.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const id = (/folders\/([\w-]+)/.exec(l) || [])[1] || l.split(/\s+/)[0];
        return { id, name: l.replace(id, "").replace(/https?:\/\/\S+/, "").trim() || "Drive folder" };
      });
      await submit(run, "sources", choice === "sample" ? { choice } : { choice, website: website.trim() || undefined, drive_folders: drive, note: note.trim() || undefined });
      await d.reload("settings");
    } catch (e) {
      toast(`Couldn't start: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="kh-setup__body">
      <h1>Where does your know-how live now?</h1>
      <p className="c-setup__lead">The Lemma reads it and proposes topics and first pages. You check them before anyone is answered from them.</p>
      {failed ? <p className="kh-warn">{failed}</p> : null}
      <div className="kh-setup__grid">
        <Field label="Upload files or a folder" hint="Handbooks, price lists, how-to documents. Saved to /know-how/_inbox.">
          <label className="c-btn kh-upload"><Upload aria-hidden="true" />Choose files
            <input type="file" multiple onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              void uploadToInbox(files, (name, ok, said) => setUploaded((u) => [...u, { name, ok, said }]));
            }} />
          </label>
          {uploaded.length ? <ul className="kh-uploaded">{uploaded.map((u) => <li key={u.name}>{u.ok ? <Check aria-hidden="true" /> : null}{u.name}<span className="c-faint"> · {u.said}</span></li>)}</ul> : null}
        </Field>
        <Field label="Your website" hint="The Lemma reads the home page and the pages that answer customers' questions.">
          <input className="c-input" placeholder="fernlow.example" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </Field>
        <Field label="Google Drive folders" hint="One folder link per line. Optional.">
          <Connect connector="googledrive" slug="googledrive" mode="shared" quiet purpose="One Google Drive connection for this Lemma: Know-how reads the folders you list, every week. It never writes to Drive." />
          <textarea className="c-textarea" rows={2} placeholder="https://drive.google.com/drive/folders/…" value={folders} onChange={(e) => setFolders(e.target.value)} />
        </Field>
        <Field label="Or share files with the Lemma in Teams" hint="A file shared in a Teams chat with the Lemma is filed here, one at a time.">
          <textarea className="c-textarea" rows={2} placeholder="Anything else about where it lives (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="kh-gaps">
        <Gap>Spreadsheets, slides, images and IES files can't be searched. CSV and Excel sheets get a table page the Lemma can read.</Gap>
        <Gap>There's no SharePoint or OneDrive folder source yet.</Gap>
      </div>
      <div className="kh-actions">
        <Button variant="primary" busy={busy === "sources"} onClick={() => void begin("sources")}>Read these</Button>
        <Button icon={FlaskConical} busy={busy === "sample"} onClick={() => void begin("sample")}>Look around with a sample</Button>
      </div>
    </section>
  );
}

function Working({ run }: { run: Run }) {
  const node = run.active_wait?.node_id || run.step_history?.[run.step_history.length - 1]?.node_id || "";
  const said = node === "reader" ? "Reading your files and website, and drafting first pages. A few minutes." : node === "keep" ? "Keeping the drafts…"
    : node === "sample" ? "Loading the sample…" : node === "apply" ? "Making the topics…" : node === "memory" || node === "save" ? "Finishing…" : "Looking at what's there…";
  return (
    <section className="kh-setup__body">
      <h1><Spinner /> {said}</h1>
      <p className="c-setup__lead">You can leave this page; set-up carries on and waits for you at the next question.</p>
      <p className="c-faint"><Ai>The Lemma's read</Ai> Every draft quotes the passage it came from. Nothing is answered from a draft.</p>
    </section>
  );
}

interface TopicRow extends ProposedTopic { keep: boolean; owner_member_id: string; backup_member_id: string; check_days: number; audience_default: Audience; restricted_role: string; sensitive: boolean; proposed_name: string }

function Owners({ run }: { run: Run }) {
  const d = useKnowhow();
  const { members, roles } = useWho();
  const toast = useToast();
  const proposed = d.settings?.proposals.topics || [];
  const drafts = d.settings?.proposals.drafts || [];
  const initial = useMemo<TopicRow[]>(() => proposed.map((t) => ({
    ...t, proposed_name: t.name, keep: true, owner_member_id: members.find((m) => t.owner_hint && m.name.toLowerCase().includes(String(t.owner_hint).toLowerCase().split(" ")[0]))?.user_id || "",
    backup_member_id: "", check_days: d.settings?.default_check_days || 90, audience_default: (t.sensitive ? "restricted" : "team") as Audience,
    restricted_role: t.sensitive ? (roles.find((r) => /hr|people/i.test(r.name))?.name || "") : "", sensitive: !!t.sensitive,
  })), [proposed, members, roles, d.settings]);
  const [rows, setRows] = useState<TopicRow[]>(initial);
  useEffect(() => setRows(initial), [initial]);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<TopicRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const name = (id: string) => members.find((m) => m.user_id === id)?.name || "";
  const go = async () => {
    setBusy(true);
    try {
      await submit(run, "owners", { topics: rows.map((r) => ({
        name: r.name, proposed_name: r.proposed_name, keep: r.keep, owner_member_id: r.owner_member_id || undefined, owner_name: name(r.owner_member_id) || undefined,
        backup_member_id: r.backup_member_id || undefined, backup_name: name(r.backup_member_id) || undefined, check_days: r.check_days,
        audience_default: r.audience_default, restricted_role: r.restricted_role || undefined, sensitive: r.sensitive })) });
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="kh-setup__body">
      <h1>Who knows what?</h1>
      <p className="c-setup__lead">Each topic's owner is asked when nobody's page answers a question, and checks its pages. {drafts.length ? `${drafts.length} draft pages are waiting under these topics.` : ""}</p>
      <div className="c-table-wrap">
        <table className="c-table kh-owners">
          <thead><tr><th>Topic</th><th>Owner</th><th>Backup</th><th>Check every</th><th>Who sees it</th><th>Sensitive</th><th>Keep</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.keep ? "" : "is-off"}>
                <td><input className="c-input c-input--bare" value={r.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Topic name" />
                  {r.why ? <span className="kh-table__sub">{r.why} · {drafts.filter((x) => x.topic === r.proposed_name).length} drafts</span> : null}</td>
                <td><select className="c-select" value={r.owner_member_id} onChange={(e) => set(i, { owner_member_id: e.target.value })} aria-label="Owner">
                  <option value="">Nobody yet</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></td>
                <td><select className="c-select" value={r.backup_member_id} onChange={(e) => set(i, { backup_member_id: e.target.value })} aria-label="Backup">
                  <option value="">None</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></td>
                <td><select className="c-select" value={r.check_days} onChange={(e) => set(i, { check_days: Number(e.target.value) })} aria-label="Check every">
                  {[30, 60, 90, 180, 365].map((n) => <option key={n} value={n}>{n} days</option>)}</select></td>
                <td><select className="c-select" value={r.audience_default} onChange={(e) => set(i, { audience_default: e.target.value as Audience })} aria-label="Who sees it">
                  <option value="team">The team</option><option value="restricted">A restricted group</option><option value="customers">Customers</option><option value="public">Public</option></select>
                  {r.audience_default === "restricted" ? <select className="c-select kh-role" value={r.restricted_role} onChange={(e) => set(i, { restricted_role: e.target.value })} aria-label="Role">
                    <option value="">Pick a role</option>{roles.map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}</select> : null}</td>
                <td><Switch checked={r.sensitive} onChange={(v) => set(i, { sensitive: v })} label="Sensitive" /></td>
                <td><Switch checked={r.keep} onChange={(v) => set(i, { keep: v })} label="Keep" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button size="sm" icon={Plus} onClick={() => setRows((r) => [...r, { name: "New topic", proposed_name: "", keep: true, owner_member_id: "", backup_member_id: "", check_days: 90, audience_default: "team", restricted_role: "", sensitive: false }])}>Add a topic</Button>
      <p className="c-faint kh-hint"><Lock aria-hidden="true" /> Sensitive topics (leave, pay, health) never keep who asked. A restricted topic's folder is read only by its role.</p>
      <div className="kh-actions">
        <Button variant="primary" busy={busy} onClick={() => void go()}>Make these topics</Button>
        <Button variant="ghost" onClick={() => void submit(run, "owners", { topics: [] })}>Skip for now</Button>
      </div>
    </section>
  );
}

function Places({ run }: { run: Run }) {
  const toast = useToast();
  const [teams, setTeams] = useState<boolean | null>(null);
  const [channels, setChannels] = useState("");
  const [mailbox, setMailbox] = useState(true);
  const [web, setWeb] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void teamsOn().then(setTeams); }, []);
  const go = async () => {
    setBusy(true);
    try {
      const list = channels.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [id, nm] = l.split(/\s+/); return { id, name: (nm || id).replace(/^#/, "") }; });
      await submit(run, "places", { teams: !!teams, slack_channels: list, mailbox, web_chat: web });
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="kh-setup__body">
      <h1>Where do people ask?</h1>
      <p className="c-setup__lead">The Lemma answers from your pages wherever it's asked. Every answer says which page, and who checked it when.</p>
      <div className="kh-place">
        <Users aria-hidden="true" /><div className="c-grow"><b>Teams</b>
          <p className="c-muted">{teams == null ? "Checking…" : teams ? "Connected: the Lemma answers in Teams chats and channels where it's added." : "Not connected. An admin connects the Lemma to Teams in its settings."}</p>
          <Gap>In Teams, the Lemma answers members of this Lemma. Someone in your Teams who isn't a member gets no answer yet.</Gap></div>
        <Pill tone={teams ? "success" : "plain"}>{teams ? "On" : "Off"}</Pill>
      </div>
      <div className="kh-place">
        <Globe aria-hidden="true" /><div className="c-grow"><b>Slack channels to watch</b>
          <p className="c-muted">Questions there are logged, and a teammate's answer in the thread becomes a draft. One per line: the channel's id, then its name.</p>
          <Connect connector="slack" slug="slack" mode="shared" quiet purpose="The Lemma's own Slack app: Know-how listens in the channels you list for questions and for teammates' answers." />
          <textarea className="c-textarea" rows={2} placeholder="C0123ABCD installers" value={channels} onChange={(e) => setChannels(e.target.value)} /></div>
      </div>
      <div className="kh-place"><div className="c-grow"><b>The Lemma's mailbox</b><p className="c-muted">Customers who email get only checked answers meant for customers; anything else goes to a person.</p></div><Switch checked={mailbox} onChange={setMailbox} label="Mailbox" /></div>
      <div className="kh-place"><div className="c-grow"><b>Web chat</b><p className="c-muted">The same, for the chat on your website.</p></div><Switch checked={web} onChange={setWeb} label="Web chat" /></div>
      <div className="kh-actions"><Button variant="primary" busy={busy} onClick={() => void go()}>Next</Button><Button variant="ghost" onClick={() => void submit(run, "places", {})}>Skip for now</Button></div>
    </section>
  );
}

function Audiences({ run }: { run: Run }) {
  const toast = useToast();
  const [customers, setCustomers] = useState(true);
  const [pub, setPub] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await submit(run, "audiences", { customers, public: pub, approver_rule: "owner", timezone: zone() });
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="kh-setup__body">
      <h1>Who may see what?</h1>
      <p className="c-setup__lead">The team gets every answer, with a warning when one is past its check date. Customers only ever get checked, in-date answers a topic's owner approved for them.</p>
      <div className="kh-place"><div className="c-grow"><b>Customers</b><p className="c-muted">A customer on email, Slack Connect or web chat is answered from pages approved for customers. Each page's owner approves it.</p></div><Switch checked={customers} onChange={setCustomers} label="Customers" /></div>
      <div className="kh-place"><div className="c-grow"><b>The public</b><p className="c-muted">Public answers are copied to a shared table a help center will draw from. It matters once Help center is added, and needs public pages turned on for your Lemma's server.</p></div><Switch checked={pub} onChange={setPub} label="Public" /></div>
      <Gap>Answers for customers are a second copy kept in step by Know-how: who may read is set per table, not per page.</Gap>
      <div className="kh-actions"><Button variant="primary" busy={busy} onClick={() => void go()}>Finish set-up</Button></div>
    </section>
  );
}

function Finish() {
  const d = useKnowhow();
  const { me, roles } = useWho();
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const made = d.settings?.made || {};
  const needs = !d.settings?.sample && !made.finished;
  const started = useRef(false);
  const runIt = useCallback(async () => {
    if (!d.settings || started.current) return;
    started.current = true;
    setRunning(true);
    setSteps([]);
    await finishSetup(d.settings, d.topics, roles, me?.id || null, (r) => setSteps((s) => [...s, r]));
    await runFunction("knowhow_setup_save", { made: { finished: true } }).catch(() => undefined);
    setRunning(false);
    started.current = false;
    void d.reload();
  }, [d, roles, me]);
  useEffect(() => { if (needs && !running && me && !steps.length && !started.current) void runIt(); }, [needs, running, me, steps.length, runIt]);
  const restart = async () => {
    await runFunction("knowhow_setup_save", { setup_run_id: "" }).catch(() => undefined);
    await d.reload("settings");
  };
  return (
    <section className="kh-setup__body">
      <h1>{d.settings?.sample ? "The sample is loaded" : "Know-how is set up"}</h1>
      <p className="c-setup__lead">{d.settings?.sample ? "A sample Wednesday at a made-up lighting company: questions, pages, a playbook. Clear it from the banner when you're done." : "The Lemma answers from your pages now. Drafts wait in the Library for their owners."}</p>
      {steps.length || running ? (
        <ul className="kh-steps-said">
          {steps.map((s) => <li key={s.step} className={s.ok ? "" : "is-bad"}>{s.ok ? <Check aria-hidden="true" /> : <span aria-hidden="true">!</span>}{s.said}</li>)}
          {running ? <li><Spinner /> Making what only you can make…</li> : null}
        </ul>
      ) : null}
      <dl className="c-props kh-summary-props">
        <dt>Topics</dt><dd>{d.topics.length}</dd>
        <dt>Where</dt><dd>{[d.settings?.places.teams ? "Teams" : null, d.settings?.places.slack_channels?.length ? `Slack (${d.settings.places.slack_channels.length})` : null, d.settings?.places.mailbox ? "Mailbox" : null, d.settings?.places.web_chat ? "Web chat" : null].filter(Boolean).join(", ") || "Not set"}</dd>
        <dt>Who sees</dt><dd>The team{d.settings?.audiences.customers ? ", customers" : ""}{d.settings?.audiences.public ? ", the public" : ""}</dd>
        <dt>Made as you</dt><dd>{Object.keys(d.settings?.schedules || {}).join(", ") || "Nothing yet"}</dd>
      </dl>
      <div className="kh-actions">
        <Button variant="primary" onClick={() => to.answers()}>Open Know-how</Button>
        {!d.settings?.sample ? <Button busy={running} onClick={() => void runIt()}>Make them again</Button> : null}
        <Button variant="ghost" onClick={() => void restart()}>Start set-up again</Button>
      </div>
    </section>
  );
}
