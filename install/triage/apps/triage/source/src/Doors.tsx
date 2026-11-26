// Doors (D): the six steps every report goes through, then every door with
// its state in words, what it watches, this week's count, how it answers the
// reporter, and its set-up. The report form's row gives the hosted link and
// the snippets for a help page and inside a product; known issues are edited
// here. A door that reads through a connector shows that connector's
// Connect under its row whenever it isn't connected, and its edit sheet
// starts with it.

import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Pencil } from "lucide-react";
import { Button, Connect, DEMO, Field, Pill, Sheet, Switch, runFunction, useConnection, useToast, type Tone } from "@lemma-plugins/kit";
import { nowMs, useTriage, useWho, type Data } from "./data";
import { connectSpec, doorStates, type ConnectedDoor, type DoorState } from "./doorstate";
import { Chip, Gap } from "./marks";
import type { Door, Settings } from "./types";
import { FORM_COLUMNS, ensureSchedules, noteProblem, turnOffForm, turnOnForm, why, type Step } from "./wire";

const ACK_WORDS: Record<string, string> = { off: "Off", got_it: "“Got it”", got_it_known: "“Got it”, and what is known when it matches" };
const TONE: Record<string, Tone> = { ok: "success", warn: "warning", off: "plain", bad: "danger" };
const STEPS: [string, string][] = [
  ["Read", "Bug, alert, security, request, question, or not a report at all. Only reports go on."],
  ["Match", "Joined to an open item it's sure about; otherwise a new item marked “Looks like T-31”."],
  ["Reach", "Counted in people, people who asked, companies or repositories, each with when it was read."],
  ["Owner", "Your routing rules, then CODEOWNERS, then the last change to the line, then whoever is on triage."],
  ["Mark down", "One person in a loop, a development-only dependency, your own rules. Back if it changes."],
  ["Tell", "The reporter, where they wrote. Whoever is on triage, in Today, when it's urgent."],
];
const COLUMN_WORDS: Record<string, string> = {
  what_happened: "What happened (required)", expected: "What they expected", steps: "Steps to see it again", how_bad: "How bad is it",
  where_url: "Where (a page address)", screenshot: "Screenshot or file", email: "Their email", app_version: "App version (filled by your product)",
  browser: "Browser (filled by your product)", page: "Page (filled by your product)",
};

interface Row {
  key: string;
  name: string;
  desc: string;
  state?: DoorState;
  watch: string[];
  note?: string | null;
  count: string;
  ack: string;
  action?: { label: string; run: () => void };
  fixed?: { state: string; tone: Tone; tag?: string };
  /** The connector the door reads through: its Connect shows under the row until it is connected. */
  connect?: ConnectedDoor;
}

/** A door's connector, under its row, only while it needs something done. */
function DoorConnect({ door, s }: { door: ConnectedDoor; s: Settings }) {
  const spec = connectSpec(door, s);
  const c = useConnection(spec);
  const raw = s.status?.[door]?.state === "failed" ? s.status[door].note : null;
  const error = useMemo(() => noteProblem(raw), [raw]);
  if (c.state.kind === "loading" || (c.ready && !error)) return null;
  return <div className="tr-door__connect"><Connect {...spec} connection={c} error={error} quiet primary={false} /></div>;
}

function weekCount(d: Data, doors: Door[], now: number, extra?: (r: { via: string | null }) => boolean): number {
  const since = now - 7 * 86_400_000;
  return d.reports.filter((r) => doors.includes(r.door) && (Date.parse(r.received_at || r.created_at) || 0) >= since
    && r.state !== "question" && r.state !== "not_a_report" && (!extra || extra(r))).length;
}

export function Doors() {
  const d = useTriage();
  const now = nowMs(d);
  const s = d.settings;
  const states = useMemo(() => new Map(doorStates(d, now).map((x) => [x.key, x])), [d, now]);
  const [edit, setEdit] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [knownOpen, setKnownOpen] = useState(false);
  const since = now - 7 * 86_400_000;
  const weekReports = d.reports.filter((r) => (Date.parse(r.received_at || r.created_at) || 0) >= since && r.item_id);
  const weekItems = new Set(weekReports.map((r) => r.item_id)).size;
  const slackAll = d.reports.filter((r) => r.door === "slack" && (Date.parse(r.received_at || r.created_at) || 0) >= since);
  const slackLeft = slackAll.filter((r) => r.state === "question" || r.state === "not_a_report").length;
  if (!s) return null;

  const groups: { name: string; sub: string; rows: Row[] }[] = [
    { name: "People on the team", sub: "members file reports, or ask the Lemma to", rows: [
      { key: "app", name: "New report", desc: "A sheet over the inbox (C). A member can set the owner and priority straight away.", watch: ["Members"],
        count: String(weekCount(d, ["app"], now)), ack: "Not needed", fixed: { state: "Live", tone: "success" } },
      { key: "assistant", name: "Ask the Lemma", desc: "In the Lemma's chat, @Lemma in Slack, a Teams chat, or mail to its address. It files what it hears, quotes it, and links back.",
        watch: ["Chat", "Slack @Lemma", "Teams", "Email"], note: "Every place the Lemma already answers", count: String(weekCount(d, ["assistant"], now)),
        ack: "Always: replies with the number and what is known", state: states.get("assistant") },
      { key: "slack", name: "Watched Slack channels", desc: "Every new message is read; only real reports are filed. Questions and chatter are left alone.",
        watch: (s.slack.channels || []).map((c) => `#${c.name}`), note: slackAll.length ? `${slackLeft} of ${slackAll.length} messages this week were questions or chatter, left alone` : null,
        count: String(weekCount(d, ["slack"], now)), ack: ACK_WORDS[s.ack.slack] || "Off", state: states.get("slack"), action: { label: "Edit", run: () => setEdit("slack") }, connect: "slack" },
      { key: "github", name: "GitHub issues", desc: "Issues opened or reopened. A repo's issue form is read field by field; a “+1” comment adds the person as someone who asked.",
        watch: s.repos.map((r) => r.full_name), count: String(weekCount(d, ["github"], now)), ack: `${ACK_WORDS[s.ack.github] || "Off"}${s.ack.github !== "off" ? ", as a comment" : ""}`,
        state: states.get("github"), action: { label: "Edit", run: () => setEdit("github") }, connect: "github" },
    ] },
    { name: "People outside", sub: "customers and users, with no account in your Lemma", rows: [
      { key: "form", name: "Report form", desc: "One form, three places: a link Lemma hosts, your help page, or inside your product, where a signed-in user is known by name and account.",
        watch: ["Link", "Help page", "In the product"], note: `${s.form_audience === "contacts" ? "People who confirm their email" : "Anyone"} · files up to 10 MB`,
        count: String(weekCount(d, ["form"], now)), ack: "Thanks on the form, and “we know about this” when it matches", state: states.get("form"),
        action: { label: s.form_on ? "Link and snippets" : "Turn on", run: () => setFormOpen(true) } },
      { key: "known", name: "Known issues", desc: "A short public list the form reads, so a person sees “we know, it's being fixed” before they write. Only what you publish.",
        watch: [`${d.known.length} published`], count: "—", ack: "It is the answer", fixed: { state: s.known_public ? "Public" : "Not public yet", tone: s.known_public ? "success" : "plain" },
        action: { label: "Edit list", run: () => setKnownOpen(true) } },
      { key: "support", name: "Support tools", desc: "Tickets marked as bugs in Intercom, Zendesk or Freshdesk.", watch: [], count: "—", ack: "—",
        fixed: { state: "Not set up", tone: "plain", tag: "Later: their triggers are unchecked; or through Support inbox" } },
    ] },
    { name: "Machines", sub: "errors and alerts, counted in people where they can be", rows: [
      { key: "sentry", name: "Sentry", desc: "Unresolved issues: people, events, escalating, regressed.", watch: s.sentry.projects || (s.sentry.org ? [s.sentry.org] : []),
        note: states.get("sentry")?.note, count: String(weekCount(d, ["sentry"], now)), ack: "Resolves in Sentry when fixed", state: states.get("sentry"), action: { label: "Edit", run: () => setEdit("sentry") }, connect: "sentry" },
      { key: "posthog", name: "PostHog", desc: "Error tracking issues: people and sessions.", watch: s.posthog.project_id ? [`project ${s.posthog.project_id}`] : [],
        note: states.get("posthog")?.note, count: String(weekCount(d, ["posthog"], now)), ack: "—", state: states.get("posthog"), action: { label: "Edit", run: () => setEdit("posthog") }, connect: "posthog" },
      { key: "dependabot", name: "Dependabot", desc: "New, reopened and reintroduced alerts, with scope and reachability.", watch: s.repos.map((r) => r.full_name),
        note: states.get("dependabot")?.tone === "warn" ? states.get("dependabot")?.note : null, count: String(weekCount(d, ["dependabot"], now)), ack: "—", state: states.get("dependabot") },
      { key: "code_scanning", name: "Code and secret scanning", desc: "New and reopened alerts from code scanning and secret scanning.", watch: s.repos.map((r) => r.full_name),
        note: states.get("code_scanning")?.tone === "warn" ? states.get("code_scanning")?.note : null, count: String(weekCount(d, ["code_scanning", "secret_scanning"], now)), ack: "—",
        state: states.get("code_scanning"), action: { label: "Open GitHub", run: () => window.open("https://github.com/settings/installations", "_blank", "noreferrer") } },
      { key: "monitoring", name: "Monitoring alerts", desc: "Datadog, Grafana, PagerDuty, Alertmanager.", watch: [], count: "—", ack: "—",
        fixed: { state: "Not possible yet", tone: "danger", tag: "No signed webhook a tool can post to; one shared change with Incidents" } },
    ] },
  ];

  return (
    <main className="c-body tr-doors">
      <div className="tr-doors__top"><span className="tr-faint tr-small">This week: {weekReports.length} reports became {weekItems} items</span></div>
      <section>
        <h2 className="tr-h2">What happens to every report<span className="tr-sub">the same six steps, whichever door it came through</span></h2>
        <div className="tr-steps">
          {STEPS.map(([name, text], i) => <div key={name} className="tr-step"><span className="tr-step__h"><span className="tr-step__n">{i + 1}</span>{name}</span>{text}</div>)}
        </div>
      </section>
      {groups.map((g) => (
        <section key={g.name}>
          <h2 className="tr-h2">{g.name}<span className="tr-sub">{g.sub}</span></h2>
          <div className="tr-doortable" role="table" aria-label={g.name}>
            <div className="tr-door tr-door--th" role="row"><span>Door</span><span>State</span><span>Watches</span><span className="tr-r">This week</span><span>Answers the reporter</span><span /></div>
            {g.rows.map((r) => {
              const st = r.fixed || (r.state ? { state: r.state.state, tone: TONE[r.state.tone], tag: r.state.tag?.text } : { state: "—", tone: "plain" as Tone });
              return (
                <div key={r.key} className="tr-door" role="row">
                  <div><div className="tr-strong">{r.name}</div><div className="tr-small tr-muted">{r.desc}</div></div>
                  <div className="tr-stack"><span><Pill tone={st.tone}>{st.state}</Pill></span>{st.tag ? <Gap>{st.tag}</Gap> : null}</div>
                  <div><span className="tr-chips">{r.watch.length ? r.watch.map((w) => <Chip key={w}>{w}</Chip>) : <span className="tr-faint">—</span>}</span>{r.note ? <div className="tr-small tr-muted">{r.note}</div> : null}</div>
                  <div className="tr-r tr-num"><span className="tr-phone-label">This week </span>{r.count}</div>
                  <div className="tr-small tr-muted"><span className="tr-phone-label">Answers: </span>{r.ack}</div>
                  <div>{r.action ? <Button size="sm" onClick={r.action.run}>{r.action.label}</Button> : null}</div>
                  {r.connect ? <DoorConnect door={r.connect} s={s} /> : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <DoorSheet which={edit} s={s} onClose={() => setEdit(null)} />
      <FormSheet open={formOpen} s={s} onClose={() => setFormOpen(false)} />
      <KnownSheet open={knownOpen} onClose={() => setKnownOpen(false)} />
    </main>
  );
}

function DoorSheet({ which, s, onClose }: { which: string | null; s: Settings; onClose: () => void }) {
  const d = useTriage();
  const { me } = useWho();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState("off");
  const [text, setText] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  const [close, setClose] = useState(false);
  useEffect(() => {
    if (!which) return;
    setAck(s.ack[which] || "off");
    setClose(s.close_github_on_done);
    if (which === "github") setText(s.repos.map((r) => r.full_name).join("\n"));
    if (which === "slack") { setText((s.slack.channels || []).map((ch) => `${ch.id} ${ch.name}`).join("\n")); setA(s.slack.account || "slack"); setB(s.slack.team_id || ""); }
    if (which === "sentry") { setA(s.sentry.account || "sentry"); setB(s.sentry.org || ""); setText((s.sentry.projects || []).join("\n")); }
    if (which === "posthog") { setA(s.posthog.account || "posthog"); setB(s.posthog.account_id || ""); setC(s.posthog.project_id || ""); }
  }, [which, s]);
  if (!which) return null;
  const lines = text.split(/\n|,/).map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      if (which === "github") { patch.repos = lines.filter((l) => l.includes("/")).map((full_name) => ({ full_name })); patch.ack = { ...s.ack, github: ack }; patch.close_github_on_done = close; }
      if (which === "slack") {
        patch.slack = { account: a || "slack", team_id: b || null, channels: lines.map((l) => { const [id, name] = l.split(/\s+/); return { id, name: (name || id).replace(/^#/, "") }; }) };
        patch.ack = { ...s.ack, slack: ack };
      }
      if (which === "sentry") patch.sentry = { account: a || "sentry", org: b || null, projects: lines };
      if (which === "posthog") patch.posthog = { account: a || "posthog", account_id: b || null, project_id: c || null };
      if (!DEMO) await runFunction("triage_setup_save", patch);
      if (!DEMO && (which === "github" || which === "slack")) {
        const fresh = { ...s, ...patch } as Settings;
        const out = await ensureSchedules(fresh, me?.id || null, Boolean(me && s.rotation.includes(me.id)));
        if (out.problems.length) toast(`Saved. Couldn't make: ${out.problems.join("; ")}`);
      }
      toast(DEMO ? "In the demo the set-up isn't saved." : "Saved.");
      await d.reload();
      onClose();
    } catch (e) {
      toast(`Couldn't save: ${why(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const ackField = (which === "github" || which === "slack") ? (
    <Field label="Answer the reporter when it's filed">
      <select className="c-select" value={ack} onChange={(e) => setAck(e.target.value)}>
        <option value="off">Off</option><option value="got_it">&ldquo;Got it&rdquo;</option><option value="got_it_known">&ldquo;Got it&rdquo;, and what is known when it matches</option>
      </select>
    </Field>
  ) : null;
  return (
    <Sheet open title={{ github: "GitHub", slack: "Watched Slack channels", sentry: "Sentry", posthog: "PostHog" }[which] || "Door"} onClose={onClose}
      footer={<Button variant="primary" busy={busy} onClick={() => void save()}>Save</Button>}>
      {which === "github" || which === "slack" || which === "sentry" || which === "posthog" ? <Connect {...connectSpec(which, s)} primary={false} /> : null}
      {which === "github" ? (
        <>
          <Field label="Repositories" hint="owner/name, one a line. Issues, comments and security alerts on these become reports."><textarea className="c-textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="acme/web" /></Field>
          {ackField}
          <Switch checked={close} onChange={setClose} label="Close the GitHub issue when its task is done (a comment always)" />
        </>
      ) : null}
      {which === "slack" ? (
        <>
          <Field label="Channels" hint="The channel id and its name, one a line: C0123ABC support. The Lemma's bot must be in each."><textarea className="c-textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="C0123ABC support" /></Field>
          <Field label="Workspace id (team id)"><input className="c-input" value={b} onChange={(e) => setB(e.target.value)} placeholder="T0123ABC" /></Field>
          {ackField}
          <Gap>Read every 15 minutes until Slack's channel trigger is live (lemma-platform#1245)</Gap>
        </>
      ) : null}
      {which === "sentry" ? (
        <>
          <Field label="Organization slug"><input className="c-input" value={b} onChange={(e) => setB(e.target.value)} placeholder="acme" /></Field>
          <Field label="Projects" hint="Slugs, one a line; empty for every project."><textarea className="c-textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <Gap>No Sentry trigger: read every 15 minutes</Gap>
        </>
      ) : null}
      {which === "posthog" ? (
        <>
          <Field label="Connected account id" hint="When the Lemma has more than one MCP account."><input className="c-input" value={b} onChange={(e) => setB(e.target.value)} /></Field>
          <Field label="Project id"><input className="c-input" value={c} onChange={(e) => setC(e.target.value)} /></Field>
          <Gap>No trigger: read over MCP every 15 minutes</Gap>
        </>
      ) : null}
    </Sheet>
  );
}

function FormSheet({ open, s, onClose }: { open: boolean; s: Settings; onClose: () => void }) {
  const d = useTriage();
  const toast = useToast();
  const [audience, setAudience] = useState<"anyone" | "contacts">(s.form_audience);
  const [cols, setCols] = useState<string[]>(s.form_columns.length ? s.form_columns : FORM_COLUMNS);
  const [origin, setOrigin] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState(false);
  useEffect(() => { if (open) { setAudience(s.form_audience); setCols(s.form_columns.length ? s.form_columns : FORM_COLUMNS); setSteps([]); } }, [open, s]);
  const key = s.widget_key || "<your widget key>";
  const link = s.form_link || (DEMO ? "https://api.lemma.example/public/web/pk_sample/page?table=triage_form" : "");
  const api = (() => { try { return link ? new URL(link).origin : "https://<your Lemma's API>"; } catch { return "https://<your Lemma's API>"; } })();
  const helpSnippet = `<script src="${api}/public/web/widget.js" data-lemma-key="${key}"\n  data-lemma-table="triage_form" data-lemma-title="Report a problem"\n  data-lemma-thanks="Thanks: a person on the team reads every report." async></script>`;
  const productSnippet = `<script src="${api}/public/web/widget.js" data-lemma-key="${key}"\n  data-lemma-token="<a host token, signed on your server>" data-lemma-chat="off" async></script>\n<script>\n  // "Report a problem" in your menu:\n  Lemma.addRow("triage_form", { what_happened, screenshot: file,\n    page: location.pathname, app_version: APP_VERSION, browser: navigator.userAgent });\n  // "We know about a problem on this page":\n  Lemma.readRows("triage_known").then((rows) => rows.filter((k) => location.pathname.startsWith(k.page || "\\u0000")));\n</script>`;
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast("Copied."); } catch { toast("Couldn't copy: select it instead."); } };
  return (
    <Sheet open={open} title="Report form" onClose={onClose}
      footer={<>{s.form_on ? <Button variant="ghost" busy={busy} onClick={async () => { setBusy(true); await turnOffForm(); await d.reload(); setBusy(false); toast("The form is off."); }}>Turn off</Button> : null}
        <Button variant="primary" busy={busy} onClick={async () => {
          setBusy(true);
          setSteps([]);
          const origins = origin.split(/[\s,]+/).filter((o) => /^https?:\/\//.test(o));
          const ok = await turnOnForm(s, audience, cols, origins, (r) => setSteps((x) => [...x, r]));
          await d.reload();
          setBusy(false);
          toast(ok ? "The form is on." : "Some steps didn't work; see each one.");
        }}>{s.form_on ? "Save" : "Turn on"}</Button></>}>
      {link ? (
        <Field label="Hosted link" hint="A page Lemma hosts, with the Lemma's chat beside the form. Share it in a help doc, an auto-reply or an email footer.">
          <div className="tr-copy"><input className="c-input" readOnly value={link} /><Button icon={Copy} label="Copy link" onClick={() => void copy(link)} />
            <a className="c-btn c-btn--icon" href={link} target="_blank" rel="noreferrer" aria-label="Open the form" title="Open the form"><ExternalLink aria-hidden="true" /></a></div>
        </Field>
      ) : <p className="tr-small tr-muted">Turning it on opens the form's fields to people outside, makes the Lemma's web widget that draws it, starts filing each answer, and makes known issues readable by the form.</p>}
      <Field label="Who can send it">
        <select className="c-select" value={audience} onChange={(e) => setAudience(e.target.value as "anyone" | "contacts")}>
          <option value="anyone">Anyone with the link</option><option value="contacts">People who confirm their email with a code</option>
        </select>
      </Field>
      <Field label="Your sites" hint="Addresses the form may be shown on, besides Lemma's own page: https://help.acme.example"><input className="c-input" value={origin} onChange={(e) => setOrigin(e.target.value)} /></Field>
      <button type="button" className="tr-link" onClick={() => setFields((v) => !v)} aria-expanded={fields}><Pencil size={12} aria-hidden="true" /> Edit fields</button>
      {fields ? (
        <div className="tr-stack">
          {FORM_COLUMNS.map((c) => (
            <Switch key={c} checked={cols.includes(c)} disabled={c === "what_happened"} label={COLUMN_WORDS[c]}
              onChange={(v) => setCols((x) => (v ? [...x, c] : x.filter((y) => y !== c)))} />
          ))}
        </div>
      ) : null}
      <Field label="On your help page" hint="Your own design, or the widget drawing the form."><pre className="tr-code">{helpSnippet}</pre></Field>
      <Button size="sm" icon={Copy} onClick={() => void copy(helpSnippet)}>Copy</Button>
      <Field label="Inside your product" hint="Sign the person in with a host token made on your server with the widget's signing secret (never in the page), so the report knows the user and their account, and they can be told when it's fixed without typing an email.">
        <pre className="tr-code">{productSnippet}</pre>
      </Field>
      <Button size="sm" icon={Copy} onClick={() => void copy(productSnippet)}>Copy</Button>
      <Gap>The hosted page's look is the widget's own: it takes only the form, not a title or intro of yours</Gap>
      {steps.length ? <ul className="tr-steplist">{steps.map((r) => <li key={r.step}><Pill tone={r.ok ? "success" : "danger"}>{r.ok ? "Done" : "Didn't work"}</Pill> {r.said}</li>)}</ul> : null}
    </Sheet>
  );
}

function KnownSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = useTriage();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const words: Record<string, string> = { investigating: "We're looking into it", being_fixed: "Being fixed", fixed: "Fixed" };
  return (
    <Sheet open={open} title="Known issues" onClose={onClose}>
      <p className="tr-small tr-muted">What the form and the chat beside it show people outside. Publish from an item's case file; take one off here.</p>
      {d.known.length ? d.known.map((k) => {
        const it = k.item_id ? d.byId.get(k.item_id) : undefined;
        return (
          <div key={k.id} className="tr-knownrow">
            <div><div>{k.title}</div><div className="tr-small tr-muted">{words[k.state]}{it ? ` · T-${it.number}` : ""}{k.page ? ` · on ${k.page}` : ""}</div></div>
            <Button size="sm" variant="ghost" busy={busy === k.id} onClick={async () => {
              setBusy(k.id);
              try { toast((await runFunction<{ message?: string }>("triage_unpublish_known", { item: k.item_id || k.id }))?.message || "Taken off."); await d.reload(); }
              catch (e) { toast(`Couldn't: ${why(e)}`); } finally { setBusy(""); }
            }}>Take off</Button>
          </div>
        );
      }) : <p className="tr-faint">Nothing published yet.</p>}
    </Sheet>
  );
}
