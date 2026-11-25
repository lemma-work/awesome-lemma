// The Write-up tab of an incident's record: the document drafted on resolve,
// every claim followed by the events behind it (press one to see it), the
// review's flags inline and beside, the follow-ups as team tasks, and what it
// was built from. Mark reviewed is the one accent here.

import { useState } from "react";
import { Check, ExternalLink, FileText, GitMerge, Hash, Inbox, MessageSquare, MinusCircle, Plus, Sparkles, X } from "lucide-react";
import { Button, Empty, Pill, Spinner, openApp, update, useToast } from "@lemma-plugins/kit";
import { call, setIncident, useIncidents, useWho } from "./data";
import { Ai, Gap, SevPill, Who, hhmm, num, span, startOf } from "./marks";
import type { Flag, IncEvent, Incident, Writeup } from "./types";

function citeLabel(e: IncEvent): string {
  const d = (e.detail || {}) as { ref?: string; label?: string };
  if (e.kind === "deploy") return `${hhmm(e.at)} deploy`;
  if (e.kind === "change") return d.ref || "GitHub";
  if (e.kind === "triage" || (e.kind === "declared" && d.label)) return e.kind === "triage" ? d.label || "Triage" : "declared";
  if (e.kind === "message" || e.kind === "pin") return `${hhmm(e.at)} ${(e.actor || "").split(" ")[0]}`;
  if (e.kind === "update") return `${hhmm(e.at)} update`;
  if (e.actor === "Lemma") return "Lemma";
  return hhmm(e.at);
}

export function WriteupTab({ inc }: { inc: Incident }) {
  const d = useIncidents();
  const { me } = useWho();
  const toast = useToast();
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const events = d.eventsBy.get(inc.id) || [];
  const byId = new Map(events.map((e) => [e.id, e]));
  const flags = (d.flagsBy.get(inc.id) || []).filter((f) => f.state === "open");
  const w = inc.writeup;

  if (!w || inc.writeup_state === "none" || inc.writeup_state === "drafting") {
    return (
      <main className="c-body in-wu-empty">
        {inc.writeup_state === "drafting" ? (
          <Empty icon={Sparkles} title="The Lemma is drafting the write-up">
            <span className="c-row"><Spinner /> From {events.length} events. Every claim will link to the events behind it.</span>
          </Empty>
        ) : (
          <Empty icon={FileText} title="No write-up yet">
            {inc.status === "resolved" ? "This incident was resolved without one." : "Resolve the incident and the Lemma drafts it from the timeline: every claim linked to its event, and anything nothing backs flagged for you."}
          </Empty>
        )}
      </main>
    );
  }

  const run = async (key: string, fn: () => Promise<unknown>, said?: string) => {
    setBusy(key);
    try {
      const out = (await fn()) as { message?: string } | undefined;
      toast(String(out?.message || said || "Done."));
      await d.reload();
    } catch (e) {
      toast(`Couldn't: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  const flagFor = (text: string): Flag | undefined => flags.find((f) => f.claim.trim() === text.trim());
  const removeClaim = (f: Flag) => run(`rm-${f.id}`, async () => {
    const next: Writeup = { ...w, sections: w.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.text.trim() !== f.claim.trim()) })) };
    await update("incidents_incident", inc.id, { writeup: next });
    await update("incidents_flag", f.id, { state: "fixed" });
  }, "Took the sentence out.");
  const keepClaim = (f: Flag) => run(`keep-${f.id}`, () => update("incidents_flag", f.id, { state: "kept" }), "Kept it.");
  const isLead = !inc.lead_user_id || inc.lead_user_id === me?.id;
  const focused = focus ? byId.get(focus) : undefined;
  const ended = inc.resolved_at ? Date.parse(inc.resolved_at) : Date.now();

  const cites = (ids: string[]) => ids.map((id) => byId.get(id)).filter(Boolean).map((e) => (
    <button key={e!.id} type="button" className={focus === e!.id ? "in-cite in-cite--on" : "in-cite"} onClick={() => setFocus(focus === e!.id ? null : e!.id)}
      aria-label={`Source: ${e!.text || ""}`}>{citeLabel(e!)}</button>
  ));

  return (
    <div className="in-split">
      <main className="in-main in-doc-wrap">
        <div className="in-doc-bar">
          <span className="c-faint in-small c-row">Write-up <Ai>drafted {hhmm(w.drafted_at || inc.writeup_at)} on resolve</Ai></span>
          <span className="in-to__fill" />
          {inc.writeup_path ? <span className="c-faint in-small">Saved as {inc.writeup_path}</span> : null}
          {inc.writeup_state === "reviewed" ? <Pill tone="success">Reviewed{inc.reviewed_by ? ` by ${inc.reviewed_by}` : ""}</Pill>
            : isLead ? <Button variant="primary" icon={Check} busy={busy === "review"} disabled={!!busy}
              onClick={() => void run("review", () => setIncident(inc.id, { writeup_state: "reviewed" }))}>Mark reviewed</Button>
              : <span className="c-faint in-small">{inc.lead_name} reviews it</span>}
        </div>
        <article className="in-doc">
          <h1>{w.title}</h1>
          <div className="in-facts">
            <SevPill settings={d.settings} sev={inc.severity} short />
            <span className="in-chip">{hhmm(startOf(inc))}–{hhmm(inc.resolved_at)} · {span(startOf(inc), ended)}</span>
            {inc.people_affected != null ? <span className="in-chip">{num(inc.people_affected)} people</span> : null}
            {inc.lead_name ? <span className="in-chip">Lead {inc.lead_name}</span> : null}
          </div>
          {w.sections.map((s) => {
            const paras = s.items.filter((i) => i.kind === "p");
            const lis = s.items.filter((i) => i.kind === "li");
            return (
              <section key={s.key}>
                <h2>{s.heading}</h2>
                {paras.length ? (
                  <p>{paras.map((i) => {
                    const f = flagFor(i.text);
                    return <span key={i.key}><span className={f ? "in-flagged" : undefined} title={f ? f.reason || "Flagged" : undefined}>{i.text}</span>{i.cites.length ? " " : null}{cites(i.cites)} </span>;
                  })}</p>
                ) : null}
                {lis.length ? (
                  <ul>{lis.map((i) => {
                    const f = flagFor(i.text);
                    return <li key={i.key}><span className={f ? "in-flagged" : undefined}>{i.text}</span> {cites(i.cites)}
                      {!i.cites.length && !f && /recorded|transcript|call/i.test(i.text) ? <> <Gap>no transcript connected</Gap></> : null}</li>;
                  })}</ul>
                ) : null}
              </section>
            );
          })}
          {w.timeline.length ? (
            <section>
              <h2>Timeline</h2>
              <div className="in-wtl">
                {w.timeline.map((t, k) => (
                  <div key={k} className="in-wtl__row"><span className="c-faint">{hhmm(t.at)}</span><span>{t.text} {cites(t.cites)}</span></div>
                ))}
              </div>
            </section>
          ) : null}
        </article>
      </main>
      <aside className="in-props in-props--doc" aria-label="Review and follow-ups">
        {focused ? (
          <section className="in-source">
            <div className="in-source__head"><span className="in-sub">Source</span><Button size="sm" variant="ghost" icon={X} label="Close" onClick={() => setFocus(null)} /></div>
            <p className="c-faint in-small">{hhmm(focused.at)} · {focused.actor}{focused.starred ? " · pinned" : ""}</p>
            <p>{focused.kind === "message" || focused.kind === "pin" ? `“${focused.text}”` : focused.text}</p>
            {focused.url ? <a className="in-link in-small c-row" href={focused.url} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden="true" />Open in {focused.source === "github" ? "GitHub" : focused.source === "slack" ? "Slack" : focused.source === "triage" ? "Triage" : "its source"}</a> : null}
          </section>
        ) : null}
        <section className="in-group in-group--first">
          <div className="c-row"><h3 className="in-h3">Review</h3><Ai /><span className="c-faint in-small">{flags.length ? `${flags.length} claim${flags.length === 1 ? "" : "s"} with nothing behind ${flags.length === 1 ? "it" : "them"}` : "nothing flagged"}</span></div>
          {flags.map((f) => {
            const sec = w.sections.find((s) => s.key === f.section);
            return (
              <div key={f.id} className="in-flag">
                <p className="in-flag__what">{sec?.heading || f.section} · “{f.claim.length > 70 ? `${f.claim.slice(0, 68)}…` : f.claim}”</p>
                <p>{f.reason}</p>
                {f.offer ? <p className="c-faint in-small">{f.offer}</p> : null}
                <div className="c-row">
                  <Button size="sm" busy={busy === `rm-${f.id}`} disabled={!!busy} onClick={() => void removeClaim(f)}>Remove the sentence</Button>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void keepClaim(f)}>Keep it</Button>
                </div>
              </div>
            );
          })}
        </section>
        <Followups inc={inc} />
        <section className="in-group">
          <h3 className="in-h3">Built from</h3>
          <BuiltFrom inc={inc} w={w} />
        </section>
      </aside>
    </div>
  );
}

function Followups({ inc }: { inc: Incident }) {
  const d = useIncidents();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const tasks = d.tasksBy.get(inc.id) || [];
  const proposed = inc.followups.filter((f) => f.state === "proposed");
  const go = async (key: string, input: Record<string, unknown>) => {
    setBusy(key);
    try {
      const out = await call("incidents_followup", { incident: inc.id, ...input });
      toast(String(out.message || "Done."));
      await d.reload();
    } catch (e) {
      toast(`Couldn't: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  const word = (s: string) => ({ todo: "To do", in_progress: "In progress", waiting: "Waiting", done: "Done", canceled: "Canceled" }[s] || s);
  return (
    <section className="in-group">
      <div className="c-row"><h3 className="in-h3">Follow-ups</h3><span className="in-to__fill" /><Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdding((v) => !v)}>Add</Button></div>
      <p className="c-faint in-small">Team tasks, from Incidents. Sprints and Tasks see them.</p>
      {adding ? (
        <form className="in-ask" onSubmit={(e) => { e.preventDefault(); if (title.trim()) void go("add", { title }).then(() => { setTitle(""); setAdding(false); }); }}>
          <input className="c-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What should happen next" aria-label="Follow-up" autoFocus />
          <Button type="submit" busy={busy === "add"} disabled={!title.trim()}>Add</Button>
        </form>
      ) : null}
      {tasks.map((t) => (
        <div key={t.id} className="in-fu in-fu--tight">
          <button type="button" className="in-fu__title" onClick={() => void openApp("tasks", `/t/${t.id}`)}>{t.title}</button>
          <Pill tone={t.status === "done" ? "success" : t.status === "in_progress" ? "info" : "plain"}>{word(t.status)}</Pill>
          <span className="in-fu__meta">
            {t.assignee_kind === "agent" ? <span className="c-row"><Sparkles size={12} aria-hidden="true" />{t.assignee_agent === "pod_default" ? "The Lemma" : t.assignee_agent}</span>
              : t.assignee_name ? <span className="c-row"><Who name={t.assignee_name} size={18} />{t.assignee_name.split(" ")[0]}</span> : <span>Nobody yet</span>}
            {t.number != null ? <span>#{t.number}</span> : null}
          </span>
        </div>
      ))}
      {proposed.map((f) => (
        <div key={f.key} className="in-fu in-fu--tight">
          <span className="in-fu__title in-fu__title--plain">{f.title}</span>
          <Pill>Proposed</Pill>
          <span className="in-fu__meta"><span className="c-row"><Sparkles size={12} aria-hidden="true" />Suggested by the Lemma{f.owner_name ? ` · ${f.owner_name.split(" ")[0]}?` : ""}</span>
            <span className="c-row">
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void go(`x-${f.key}`, { proposal: f.key, dismiss: true })}>Not now</Button>
              <Button size="sm" variant="ghost" busy={busy === f.key} disabled={!!busy} onClick={() => void go(f.key, { proposal: f.key })}>Accept</Button>
            </span>
          </span>
        </div>
      ))}
      {!tasks.length && !proposed.length ? <p className="c-faint in-small">None yet.</p> : null}
    </section>
  );
}

function BuiltFrom({ inc, w }: { inc: Incident; w: Writeup }) {
  const b = w.built_from || {};
  const plural = (n: number | undefined, one: string, many = `${one}s`) => `${n || 0} ${n === 1 ? one : many}`;
  return (
    <div className="in-built">
      <span className="c-row"><MessageSquare aria-hidden="true" />{plural(b.messages, "message")} in #{b.channel || inc.channel_name || "the channel"}{b.pinned ? `, ${b.pinned} pinned` : ""}</span>
      <span className="c-row"><GitMerge aria-hidden="true" />{plural(b.changes, "change")}, {plural(b.deploys, "deploy run")}</span>
      {b.triage ? <span className="c-row"><Inbox aria-hidden="true" />{b.triage_label || "The Triage item"} and its evidence</span> : null}
      {inc.channel_name ? null : <span className="c-row"><Hash aria-hidden="true" />No channel</span>}
      {(w.not_used || []).length ? (
        <span className="c-row c-faint"><MinusCircle aria-hidden="true" />Not used: {(w.not_used || []).map((x) => x.split(":")[0]).join(", ")} <Gap>not connected</Gap></span>
      ) : null}
    </div>
  );
}
