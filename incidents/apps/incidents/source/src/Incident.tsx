// One incident, as a record: the header with its facts and status steps, then
// two tabs. "Incident" (the canvas's A): Now, the most likely cause, the
// drafted update, and the timeline; properties beside. "Write-up": the
// document drafted on resolve (Writeup.tsx), in the same layout. A source
// the Lemma couldn't check for want of its connector shows that connector's
// Connect under "Not checked"; the update card shows Slack's and Resend's
// when they aren't connected, or when sending found them not connected.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, Clock, Code, ExternalLink, Hash, MinusCircle, Phone, RefreshCw, Send, XCircle,
} from "lucide-react";
import { Button, DEMO, Empty, Menu, MenuItem, MenuLabel, Pill, Segmented, Spinner, openApp, useToast, errorText } from "@lemma-plugins/kit";
import { call, nowMs, setIncident, useIncidents, useWho, type Data } from "./data";
import {
  Ai, Gap, GitMerge, Inbox, NeedsConnect, Rocket, STATUS, STATUS_WORDS, SevPill, SourceIcon, StatusPill, Who, WithCode, eventIcon, hhmm,
  isConnector, num, sevOf, span, startOf, type ConnectorKey,
} from "./marks";
import { to } from "./route";
import { problemIn, said, unwireIncident, wireIncident } from "./wire";
import { WriteupTab } from "./Writeup";
import type { Hypothesis, IncEvent, Incident, Update } from "./types";

export function IncidentPage({ number, tab }: { number: number; tab: "overview" | "writeup" }) {
  const d = useIncidents();
  const { me } = useWho();
  const toast = useToast();
  const inc = d.incidents.find((i) => i.number === number);
  const wired = useRef("");
  useEffect(() => {
    if (!inc || !me || wired.current === inc.id) return;
    if (inc.channel_id && (!inc.channel_connected || !inc.channel_schedule_id) && inc.status !== "resolved") {
      wired.current = inc.id;
      void wireIncident(inc, d.settings).then((p) => p.forEach((x) => toast(x)));
    }
  }, [inc, me, d.settings, toast]);
  // An open incident keeps changing under the page: messages, the Now line and
  // a drafted update land from workflows a minute after they are asked for.
  const open = Boolean(inc && inc.status !== "resolved") || inc?.writeup_state === "drafting";
  const { reload } = d;
  useEffect(() => {
    if (DEMO || !open) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void reload(); }, 20000);
    return () => window.clearInterval(timer);
  }, [open, reload]);
  if (!inc) {
    return (
      <main className="c-body">
        <Empty title={`There is no INC-${number}`} action={<Button onClick={() => to.list()}>All incidents</Button>}>It may have been the sample, cleared since.</Empty>
      </main>
    );
  }
  return (
    <div className="in-record">
      <RecordHead inc={inc} d={d} tab={tab} />
      {tab === "writeup" ? <WriteupTab inc={inc} /> : <Overview inc={inc} d={d} />}
    </div>
  );
}

function RecordHead({ inc, d, tab }: { inc: Incident; d: Data; tab: "overview" | "writeup" }) {
  const now = nowMs(d);
  const open = inc.status !== "resolved";
  const at = STATUS.indexOf(inc.status);
  const events = d.eventsBy.get(inc.id) || [];
  const declared = events.find((e) => e.kind === "declared");
  // A step is ticked only when the incident was in it: a status it skipped stays plain.
  const visited = new Set<string>(["declared", inc.status]);
  for (const e of events) {
    const det = (e.detail || {}) as { from?: string; to?: string };
    if (e.kind === "status") { if (det.from) visited.add(det.from); if (det.to) visited.add(det.to); }
  }
  return (
    <div className="in-head">
      <nav className="in-crumb" aria-label="Breadcrumb">
        <button type="button" onClick={() => to.list(open ? "active" : "resolved")}>Incidents</button>
        <span aria-hidden="true">/</span>
        <span>INC-{inc.number}</span>
      </nav>
      <h1 className="in-title">{inc.title}</h1>
      <div className="in-facts">
        <SevPill settings={d.settings} sev={inc.severity} />
        <StatusPill status={inc.status} />
        {inc.lead_name ? <span className="in-chip"><Who name={inc.lead_name} size={16} />Lead: {inc.lead_name}</span> : <span className="in-chip">No lead yet</span>}
        <span className="in-chip"><Clock aria-hidden="true" />
          {open ? `${span(startOf(inc), now)} · since ${hhmm(startOf(inc))}` : `${span(startOf(inc), Date.parse(inc.resolved_at || inc.declared_at))} · ${hhmm(startOf(inc))}–${hhmm(inc.resolved_at)}`}
        </span>
        {inc.channel_name ? <span className="in-chip"><Hash aria-hidden="true" />{inc.channel_name}</span> : null}
      </div>
      <nav className="in-steps" aria-label="Status">
        {STATUS.map((s, i) => (
          <span key={s} className={i < at && visited.has(s) ? "in-step in-step--done" : i === at ? "in-step in-step--on" : "in-step"}>
            {i > 0 ? <span className="in-step__dash" aria-hidden="true">—</span> : null}
            {(i < at && visited.has(s)) || (i === at && s === "resolved") ? <Check aria-hidden="true" /> : i === at ? <span className="in-dot" aria-hidden="true" /> : null}
            {STATUS_WORDS[s]}{s === "declared" && declared ? ` ${hhmm(inc.declared_at)}` : ""}{s === "resolved" && inc.resolved_at ? ` ${hhmm(inc.resolved_at)}` : ""}
          </span>
        ))}
      </nav>
      <div className="in-tabs" role="tablist" aria-label="Incident">
        <button type="button" role="tab" aria-selected={tab === "overview"} onClick={() => to.incident(inc.number)}>Incident</button>
        <button type="button" role="tab" aria-selected={tab === "writeup"} onClick={() => to.writeup(inc.number)}>
          Write-up
          {inc.writeup_state === "to_review" ? <span className="in-tabs__n">to review</span>
            : inc.writeup_state === "drafting" ? <span className="in-tabs__n">drafting</span>
              : inc.writeup_state === "reviewed" ? <span className="in-tabs__n">reviewed</span> : null}
        </button>
      </div>
    </div>
  );
}

function Overview({ inc, d }: { inc: Incident; d: Data }) {
  const events = d.eventsBy.get(inc.id) || [];
  const hyp = (d.hypothesesBy.get(inc.id) || []).filter((h) => h.state !== "not_it").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const updates = d.updatesBy.get(inc.id) || [];
  return (
    <div className="in-split">
      <main className="in-main">
        <NowCard inc={inc} d={d} />
        <CauseCard inc={inc} hyp={hyp} events={events} d={d} />
        {inc.status !== "resolved" ? <UpdateCard inc={inc} updates={updates} d={d} /> : null}
        <Timeline inc={inc} events={events} />
      </main>
      <Properties inc={inc} d={d} />
    </div>
  );
}

function NowCard({ inc, d }: { inc: Incident; d: Data }) {
  const open = inc.status !== "resolved";
  const next = inc.summary_at ? hhmm(new Date(Date.parse(inc.summary_at) + 15 * 60_000).toISOString()) : null;
  return (
    <section className="in-card in-card--now" aria-labelledby="now-h">
      <div className="in-card__head">
        <h2 id="now-h" className="in-sec">Now</h2><Ai />
        <span className="in-card__meta">
          {inc.summary_at ? `Updated ${hhmm(inc.summary_at)}` : "Not drafted yet"}
          {open && next ? ` · next on a mention, a change, or at ${next}` : ""}
          {open ? <Gap title="A message reaches the timeline when someone mentions the Lemma, or at the next 15-minute read. Live once Slack's channel events reach Lemma.">Not live yet</Gap> : null}
        </span>
      </div>
      <p className="in-prose">{inc.summary || "The Lemma writes a short summary here from the timeline once there is something to say."}</p>
      {d.settings && !inc.channel_id && open ? <p className="c-faint in-small">No Slack channel: this incident is kept in the app only.</p> : null}
    </section>
  );
}

function CauseCard({ inc, hyp, events, d }: { inc: Incident; hyp: Hypothesis | undefined; events: IncEvent[]; d: Data }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const tasks = d.tasksBy.get(inc.id) || [];
  const revert = tasks.find((t) => /^Revert /i.test(t.title));
  const revertEvent = events.find((e) => /^Opened #\d+ Revert/i.test(e.text || ""));
  const run = async (key: string, fn: () => Promise<{ message?: string }>) => {
    setBusy(key);
    try {
      const out = await fn();
      toast(said(out.message || "Done."));
      await d.reload();
    } catch (e) {
      toast(`Couldn't: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  if (!hyp) {
    return (
      <section className="in-card" aria-labelledby="cause-h">
        <div className="in-card__head"><h2 id="cause-h" className="in-sec">Most likely cause</h2><Ai /></div>
        <p className="c-muted">{inc.status === "resolved" ? "No cause was posted." : "The Lemma is reading the timeline and the changes before it started."}</p>
        {inc.status !== "resolved" ? (
          <div className="in-actions"><Button icon={RefreshCw} busy={busy === "ask"} onClick={() => void run("ask", () => call("incidents_investigate", { incident: inc.id }))}>Look again</Button></div>
        ) : null}
      </section>
    );
  }
  const word = { likely: "Likely", possible: "Possible", inconclusive: "Inconclusive" }[hyp.confidence];
  const byId = new Map(events.map((e) => [e.id, e]));
  const changeRef = /#\d+/.exec(hyp.evidence.find((e) => e.source === "github")?.text || "")?.[0];
  return (
    <section className="in-card" aria-labelledby="cause-h">
      <div className="in-card__head">
        <h2 id="cause-h" className="in-sec">Most likely cause</h2><Ai />
        <Pill>{word}{hyp.signs ? ` · ${hyp.agree} of ${hyp.signs} signs agree` : ""}</Pill>
        {hyp.state === "confirmed" ? <Pill tone="success">Confirmed</Pill> : null}
        <span className="in-card__meta">{hyp.posted_at ? `Posted to the channel ${hhmm(hyp.posted_at)}` : "Not posted to Slack"}</span>
      </div>
      <p className="in-prose in-prose--lead"><WithCode text={hyp.text} /></p>
      <div className="in-cause">
        <div className="in-cause__col">
          <h3 className="in-sub">Evidence</h3>
          {hyp.evidence.map((ev, i) => {
            const e = ev.event_id ? byId.get(ev.event_id) : undefined;
            const Icon = ev.source === "deploy" ? Rocket : ev.source === "github" ? GitMerge : ev.source === "slack" ? eventIcon({ kind: "message", source: "slack", starred: false, actor: null })
              : ev.source === "sentry" || ev.source === "triage" ? Inbox : e ? eventIcon(e) : Inbox;
            return (
              <div key={i} className="in-evi">
                <SourceIcon icon={Icon} />
                <span><WithCode text={ev.text} />{ev.url ? <a className="in-ev__open" href={ev.url} target="_blank" rel="noreferrer" aria-label="Open the evidence"><ExternalLink aria-hidden="true" /></a> : null}</span>
              </div>
            );
          })}
        </div>
        <div className="in-cause__col">
          <h3 className="in-sub">Ruled out</h3>
          {hyp.ruled_out.length ? hyp.ruled_out.map((r, i) => (
            <div key={i} className="in-evi in-evi--plain"><XCircle aria-hidden="true" /><span>{r.text}</span></div>
          )) : <p className="c-faint in-small">Nothing yet.</p>}
          <h3 className="in-sub in-sub--gap">Not checked</h3>
          {hyp.not_checked.length ? hyp.not_checked.map((r, i) => (
            <div key={i} className="in-evi in-evi--plain"><MinusCircle aria-hidden="true" /><span>{r.text}</span></div>
          )) : <p className="c-faint in-small">Every source it needed was connected.</p>}
          {inc.status !== "resolved" ? [...new Set(hyp.not_checked.map((r) => r.source).filter(isConnector))].map((key) => (
            <NeedsConnect key={key} connector={key} settings={d.settings} />
          )) : null}
        </div>
      </div>
      {inc.status !== "resolved" ? (
        <div className="in-actions">
          {revert ? null : (
            <Button icon={Code} busy={busy === "revert"} disabled={!!busy} onClick={() => void run("revert", () => call("incidents_followup", { incident: inc.id, revert: true, change: changeRef || null }))}>
              Hand the revert to the Lemma
            </Button>
          )}
          {hyp.state === "open" ? (
            <>
              <Button variant="ghost" disabled={!!busy} onClick={() => void run("confirm", () => setIncident(inc.id, { hypothesis: hyp.id, hypothesis_state: "confirmed" }))}>Confirm</Button>
              <Button variant="ghost" disabled={!!busy} onClick={() => void run("notit", () => setIncident(inc.id, { hypothesis: hyp.id, hypothesis_state: "not_it" }))}>Not it</Button>
            </>
          ) : null}
          <Button variant="ghost" disabled={!!busy} onClick={() => setAsking((v) => !v)}>Ask a question</Button>
          {revert ? (
            <span className="c-faint in-small">
              {revertEvent ? <>The Lemma opened {revertEvent.url ? <a className="in-link" href={revertEvent.url} target="_blank" rel="noreferrer">{(revertEvent.text || "").replace(/^Opened /, "").replace(/, asked by.*$/, "")}</a> : (revertEvent.text || "").replace(/^Opened /, "")} at {hhmm(revertEvent.at)}</>
                : <>The revert is task <button type="button" className="in-link" onClick={() => void openApp("tasks", `/t/${revert.id}`)}>#{revert.number}</button>, on the Lemma</>}
            </span>
          ) : null}
        </div>
      ) : null}
      {asking ? (
        <form className="in-ask" onSubmit={(e) => { e.preventDefault(); if (question.trim()) void run("ask", () => call("incidents_investigate", { incident: inc.id, question })).then(() => { setAsking(false); setQuestion(""); }); }}>
          <input className="c-input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What should it look at? (Is the DB involved?)" aria-label="Question for the Lemma" autoFocus />
          <Button type="submit" busy={busy === "ask"} disabled={!question.trim()}>Ask</Button>
        </form>
      ) : null}
    </section>
  );
}

function UpdateCard({ inc, updates, d }: { inc: Incident; updates: Update[]; d: Data }) {
  const { me } = useWho();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const draft = updates.filter((u) => u.state === "draft").sort((a, b) => (b.drafted_at || "").localeCompare(a.drafted_at || ""))[0];
  const last = updates.filter((u) => u.state === "sent").sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || ""))[0];
  const isLead = !inc.lead_user_id || inc.lead_user_id === me?.id;
  const emails = d.settings?.email_to?.length || 0;
  const [failed, setFailed] = useState<Partial<Record<ConnectorKey, unknown>>>({});
  const send = async () => {
    setBusy("send");
    try {
      const out = await call("incidents_send_update", { incident: inc.id, update_id: draft?.id, body: editing ? text : null });
      // Each place it didn't reach for want of a connection: Slack (the channels) or Resend (email).
      const delivery = (out.delivery || {}) as Record<string, string>;
      const missed: Partial<Record<ConnectorKey, unknown>> = {};
      for (const [where, how] of Object.entries(delivery)) {
        const e = problemIn(how);
        if (e) missed[where === "email" ? "resend" : "slack"] = e;
      }
      setFailed(missed);
      toast(said(out.message || "Sent.", Object.keys(missed)[0]));
      setEditing(false);
      await d.reload();
    } catch (e) {
      toast(`Couldn't send: ${errorText(e, "slack")}`);
    } finally {
      setBusy("");
    }
  };
  const draftOne = async () => {
    setBusy("draft");
    try {
      const out = await call("incidents_draft_update", { incident: inc.id });
      toast(said(out.message || "Drafted."));
      await d.reload();
    } catch (e) {
      toast(`Couldn't draft: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="in-card" aria-labelledby="upd-h">
      <div className="in-card__head">
        <h2 id="upd-h" className="in-sec">{draft ? "Update drafted" : "Updates"}</h2>{draft ? <Ai /> : null}
        <span className="in-card__meta">
          {last ? `Last sent ${hhmm(last.sent_at)}` : "None sent yet"}{inc.update_due_at ? ` · due ${last ? "again " : ""}${hhmm(inc.update_due_at)}` : ""}
        </span>
      </div>
      {draft ? (
        <>
          {editing ? (
            <textarea className="c-textarea in-update-edit" value={text} onChange={(e) => setText(e.target.value)} aria-label="The update" />
          ) : (
            <div className="in-quote"><p>{draft.body}</p></div>
          )}
          <div className="in-to">
            <span className="c-muted in-small">To</span>
            {inc.channel_name ? <span className="in-chip">#{inc.channel_name}</span> : null}
            {d.settings?.announce_channel_name ? <span className="in-chip">#{d.settings.announce_channel_name}</span> : null}
            {emails ? <span className="in-chip">Email · {emails} {emails === 1 ? "person" : "people"}</span> : null}
            <Gap title="There is no public status page in Incidents yet: updates go to Slack and by email.">No public status page</Gap>
            <span className="in-to__fill" />
            {editing ? <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              : <Button variant="ghost" onClick={() => { setText(draft.body); setEditing(true); }}>Edit</Button>}
            {isLead ? <Button variant="primary" icon={Send} busy={busy === "send"} disabled={!!busy} onClick={() => void send()}>Send update</Button>
              : <span className="c-faint in-small">{inc.lead_name} sends it</span>}
          </div>
        </>
      ) : (
        <div className="in-to">
          <span className="c-muted">No update waiting. The Lemma drafts one when it is due.</span>
          <span className="in-to__fill" />
          <Button busy={busy === "draft"} onClick={() => void draftOne()}>Draft one now</Button>
        </div>
      )}
      <NeedsConnect connector="slack" settings={d.settings} error={failed.slack}
        lead={`Updates go to the incident's channel and #${d.settings?.announce_channel_name || "incidents"} through Slack. Without it, nothing is posted.`} />
      {emails ? <NeedsConnect connector="resend" settings={d.settings} error={failed.resend}
        lead={`Emails each update to the ${emails === 1 ? "person" : `${emails} people`} in set-up. Without it, updates go to Slack only.`} /> : null}
    </section>
  );
}

type Filter = "all" | "messages" | "changes" | "lemma" | "pinned";
const FILTERS: Record<Filter, (e: IncEvent) => boolean> = {
  all: () => true,
  messages: (e) => e.kind === "message" || e.kind === "pin",
  changes: (e) => e.kind === "change" || e.kind === "deploy",
  lemma: (e) => e.kind === "lemma" || e.actor === "Lemma",
  pinned: (e) => e.starred,
};

/** One event as a timeline line: who in bold, then what. */
function eventLine(e: IncEvent): { actor: string | null; sep: string; text: string; quoted: boolean } {
  const text = e.text || "";
  if (e.kind === "message" || e.kind === "pin") return { actor: e.actor || "Someone", sep: " ", text, quoted: true };
  if (e.kind === "update") return { actor: "Update sent", sep: " ", text: text.replace(/^Update sent /, ""), quoted: false };
  if (e.kind === "declared") return { actor: "Declared", sep: " ", text: text.replace(/^Declared /, ""), quoted: false };
  if (e.actor === "Lemma") return { actor: "Lemma", sep: " ", text: text.charAt(0).toLowerCase() + text.slice(1), quoted: false };
  if (e.kind === "change" || e.kind === "deploy" || e.kind === "triage") return { actor: e.actor || (e.kind === "triage" ? "Triage" : "GitHub"), sep: " · ", text, quoted: false };
  return { actor: null, sep: "", text, quoted: false };
}

function Timeline({ inc, events }: { inc: Incident; events: IncEvent[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const count = useMemo(() => Object.fromEntries((Object.keys(FILTERS) as Filter[]).map((k) => [k, events.filter(FILTERS[k]).length])), [events]);
  const shown = events.filter(FILTERS[filter]);
  return (
    <section className="in-tl" aria-labelledby="tl-h">
      <div className="in-tl__head">
        <h2 id="tl-h" className="in-sec">Timeline</h2>
        <Segmented label="Show" value={filter} onChange={setFilter}
          items={[{ id: "all", label: "All", count: count.all }, { id: "messages", label: "Messages", count: count.messages },
            { id: "changes", label: "Changes", count: count.changes }, { id: "lemma", label: "Lemma", count: count.lemma },
            { id: "pinned", label: "Pinned", count: count.pinned }]} />
      </div>
      <ol className="in-events">
        {shown.map((e) => {
          const { actor, sep, text, quoted } = eventLine(e);
          const isAi = actor === "Lemma";
          return (
            <li key={e.id} id={`ev-${e.id}`} className="in-ev">
              <span className="in-ev__t">{hhmm(e.at)}</span>
              <SourceIcon icon={eventIcon(e)} />
              <span className="in-ev__x">
                {actor ? <b>{actor}</b> : null}{isAi ? <> <Ai /></> : null}{sep}{quoted ? <>“{text}”</> : text}
                {e.starred && !isAi ? <span className="c-faint"> · pinned</span> : null}
                {e.detail && (e.detail as { via?: string }).via === "workflow_run" ? <> <Gap title="Deploys come from the deploy workflow's runs until GitHub deployments reach the Lemma.">from the workflow run</Gap></> : null}
                {e.url ? <a className="in-ev__open" href={e.url} target="_blank" rel="noreferrer" aria-label="Open where it happened"><ExternalLink aria-hidden="true" /></a> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {!shown.length ? <p className="c-faint in-small">Nothing here yet.</p> : null}
      <p className="in-tl__foot">
        Gathered from {inc.channel_name ? "the channel, " : ""}GitHub{inc.source === "triage" ? " and Triage" : ""}. Messages land every 15 min or when someone mentions the Lemma.
        {" "}<Gap title="Call notes come only after a call, from a meeting connector when the Lemma has one.">No call notes during the call</Gap>
      </p>
    </section>
  );
}

function Properties({ inc, d }: { inc: Incident; d: Data }) {
  const toast = useToast();
  const { me } = useWho();
  const [busy, setBusy] = useState("");
  const open = inc.status !== "resolved";
  const sevs = d.settings?.severities || [];
  const events = d.eventsBy.get(inc.id) || [];
  const since = Date.parse(startOf(inc)) - 60 * 60_000;
  const changed = events.filter((e) => (e.kind === "change" || e.kind === "deploy") && e.actor !== "Lemma" && Date.parse(e.at) >= since && Date.parse(e.at) <= Date.parse(startOf(inc)) + 60_000)
    .sort((a, b) => b.at.localeCompare(a.at));
  const others = inc.responders.filter((r) => r.name);
  const go = async (key: string, fn: () => Promise<{ message?: string }>) => {
    setBusy(key);
    try {
      const out = await fn();
      toast(said(out.message || "Done."));
      await d.reload();
    } catch (e) {
      toast(`Couldn't: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const resolve = async () => {
    await go("resolve", () => call("incidents_resolve", { incident: inc.id }));
    void unwireIncident(inc);
    to.writeup(inc.number);
  };
  return (
    <aside className="in-props" aria-label="Properties">
      <dl className="in-dl">
        <dt>Severity</dt>
        <dd>
          {open ? (
            <Menu variant="ghost" label={<SevPill settings={d.settings} sev={inc.severity} />} title="Change severity">
              {(close) => <>
                <MenuLabel>Severity</MenuLabel>
                {sevs.map((s) => <MenuItem key={s.key} hint={s.key === inc.severity ? "now" : `update every ${s.update_every_min} min`}
                  onSelect={() => { close(); void go("sev", () => setIncident(inc.id, { severity: s.key })); }}>{sevOf(d.settings, s.key).label}</MenuItem>)}
              </>}
            </Menu>
          ) : <SevPill settings={d.settings} sev={inc.severity} />}
        </dd>
        <dt>Status</dt>
        <dd><StatusPill status={inc.status} /></dd>
        <dt>Lead</dt>
        <dd className="in-person">{inc.lead_name ? <><Who name={inc.lead_name} />{inc.lead_name}</> : <span className="c-faint">Nobody yet</span>}
          {open && me && inc.lead_user_id !== me.id ? <button type="button" className="in-link in-small" onClick={() => void go("lead", () => setIncident(inc.id, { lead_me: true }))}>I'll lead</button> : null}
        </dd>
        <dt>Comms</dt>
        <dd className="in-person">{inc.comms_name ? <><Who name={inc.comms_name} />{inc.comms_name}</> : <span className="c-faint">Nobody yet</span>}</dd>
        <dt>Responders</dt>
        <dd className="in-person in-stack">{others.map((r) => <span key={r.name || ""} title={r.name || ""}><Who name={r.name} /></span>)}<span className="c-faint">+ Lemma</span></dd>
      </dl>
      <div className="in-group">
        <h3 className="in-sub">Impact</h3>
        <dl className="in-dl">
          <dt>Who</dt><dd>{inc.impact || <span className="c-faint">Not said yet</span>}</dd>
          <dt>People</dt><dd>{inc.people_affected != null ? <>{num(inc.people_affected)} <span className="c-faint">· {inc.people_source}</span></> : <span className="c-faint">No source gave a number</span>}</dd>
          <dt>Started</dt><dd>{inc.started_at ? <>{hhmm(inc.started_at)} <span className="c-faint">· {inc.started_source || "first sign"}</span></> : <span className="c-faint">Not known</span>}</dd>
          <dt>Noticed</dt><dd>{hhmm(inc.noticed_at || inc.declared_at)} <span className="c-faint">· {inc.noticed_source || "declared"}</span></dd>
          <dt>Service</dt><dd>{inc.service || <span className="c-faint">Not said</span>}</dd>
        </dl>
      </div>
      <div className="in-group">
        <h3 className="in-sub">Changed in the hour before</h3>
        {changed.length ? changed.map((e) => (
          <a key={e.id} className="in-plink" href={e.url || undefined} target="_blank" rel="noreferrer">
            {e.kind === "deploy" ? <Rocket aria-hidden="true" /> : <GitMerge aria-hidden="true" />}
            <span className="c-ellipsis">{e.kind === "deploy" ? `deploy · ${inc.service || "service"}` : (e.text || "").replace(/ merged by [^:]+:/, "")}</span>
            <span className="c-faint">{hhmm(e.at)}</span>
          </a>
        )) : <p className="c-faint in-small">{d.settings?.repos?.length ? "No change in the watched repositories." : "No repositories watched: add them in set-up."}</p>}
      </div>
      <div className="in-group">
        <h3 className="in-sub">Linked</h3>
        {inc.source === "triage" && (inc.source_label || inc.source_url) ? (
          // Triage hands its own app path (`/i/<number>`); a full URL is a link elsewhere.
          inc.source_url && inc.source_url.startsWith("/") ? (
            <button type="button" className="in-plink" onClick={() => openApp("triage", inc.source_url!)}><Inbox aria-hidden="true" /><span className="c-ellipsis">{inc.source_label || "Triage item"}</span></button>
          ) : (
            <a className="in-plink" href={inc.source_url || undefined} target="_blank" rel="noreferrer"><Inbox aria-hidden="true" /><span className="c-ellipsis">{inc.source_label || "Triage item"}</span></a>
          )
        ) : null}
        {inc.channel_name ? (
          <span className="in-plink"><Hash aria-hidden="true" /><span className="c-ellipsis">#{inc.channel_name}</span><span className="c-faint">Slack{!inc.channel_connected && open ? " · read every 15 min" : ""}</span></span>
        ) : null}
        <span className="in-plink in-plink--faint"><Phone aria-hidden="true" /><span>Call: notes after it ends</span><Gap title="No meeting bot: a call's notes can be pulled in afterwards from a meeting connector.">Not connected</Gap></span>
        {inc.writeup_path ? <span className="in-plink"><ExternalLink aria-hidden="true" /><span className="c-ellipsis">{inc.writeup_path}</span></span> : null}
      </div>
      {open ? (
        <div className="in-group in-group--acts">
          <Menu label="Change status" title="Change status">
            {(close) => <>
              <MenuLabel>Status</MenuLabel>
              {STATUS.filter((s) => s !== "resolved").map((s) => (
                <MenuItem key={s} hint={s === inc.status ? "now" : undefined} onSelect={() => { close(); void go("status", () => setIncident(inc.id, { status: s })); }}>{STATUS_WORDS[s]}</MenuItem>
              ))}
            </>}
          </Menu>
          <Button variant="ghost" busy={busy === "resolve"} disabled={!!busy} onClick={() => void resolve()}>Resolve and draft the write-up</Button>
          {busy && busy !== "resolve" ? <span className="c-row c-faint in-small"><Spinner /> Saving…</span> : null}
        </div>
      ) : null}
    </aside>
  );
}
