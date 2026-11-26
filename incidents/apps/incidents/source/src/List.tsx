// The list: active incidents (and write-ups waiting for review), the
// follow-ups they left as team tasks, and past incidents. Search on `/`
// looks across all of them.

import { useState } from "react";
import { Check, ChevronRight, CircleDashed, Sparkles, TriangleAlert } from "lucide-react";
import { Button, Empty, Pill, openApp, useToast, errorText } from "@lemma-plugins/kit";
import { call, nowMs, useIncidents, type Data } from "./data";
import { Ai, SevPill, StatusPill, Who, dayLabel, span, startOf } from "./marks";
import { to, type View } from "./route";
import type { Incident, Task } from "./types";
import { said } from "./wire";

export function counts(d: Data) {
  const open = d.incidents.filter((i) => i.status !== "resolved");
  const proposed = d.incidents.reduce((n, i) => n + i.followups.filter((f) => f.state === "proposed").length, 0);
  return {
    active: open.length,
    followups: d.tasks.filter((t) => t.status !== "done" && t.status !== "canceled").length + proposed,
    resolved: d.incidents.length - open.length,
  };
}

function matches(inc: Incident, q: string): boolean {
  const hay = `INC-${inc.number} ${inc.title} ${inc.service || ""} ${inc.channel_name || ""} ${inc.lead_name || ""}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export function List({ view, query, onDeclare }: { view: View; query: string; onDeclare: () => void }) {
  const d = useIncidents();
  const now = nowMs(d);
  if (query.trim()) {
    const found = d.incidents.filter((i) => matches(i, query));
    return (
      <main className="c-body in-list-page">
        <h2 className="in-h2">Search <span className="c-faint">{found.length}</span></h2>
        {found.length ? <div className="in-rows">{found.map((i) => <IncidentRow key={i.id} inc={i} d={d} now={now} />)}</div>
          : <Empty title="Nothing matches">Search looks at the number, title, service, channel and lead.</Empty>}
      </main>
    );
  }
  if (view === "followups") return <Followups />;
  const list = d.incidents.filter((i) => (view === "active" ? i.status !== "resolved" : i.status === "resolved"));
  const toReview = view === "active" ? d.incidents.filter((i) => i.status === "resolved" && i.writeup_state === "to_review") : [];
  return (
    <main className="c-body in-list-page">
      {view === "active" ? (
        list.length ? <div className="in-rows">{list.map((i) => <IncidentRow key={i.id} inc={i} d={d} now={now} />)}</div>
          : <Empty icon={TriangleAlert} title="No active incidents" action={<Button onClick={onDeclare}>Declare incident</Button>}>
            Declare one here, or say "@Lemma declare checkout 502s" in Slack.
          </Empty>
      ) : (
        list.length ? <div className="in-rows">{list.map((i) => <IncidentRow key={i.id} inc={i} d={d} now={now} />)}</div>
          : <Empty title="No past incidents">Resolved incidents and their write-ups land here.</Empty>
      )}
      {toReview.length ? (
        <section className="in-listsec">
          <h2 className="in-h2">Write-ups to review <span className="c-faint">{toReview.length}</span></h2>
          <div className="in-rows">{toReview.map((i) => <IncidentRow key={i.id} inc={i} d={d} now={now} />)}</div>
        </section>
      ) : null}
    </main>
  );
}

function IncidentRow({ inc, d, now }: { inc: Incident; d: Data; now: number }) {
  const open = inc.status !== "resolved";
  const tasks = d.tasksBy.get(inc.id) || [];
  const done = tasks.filter((t) => t.status === "done").length;
  return (
    <button type="button" className="in-row" onClick={() => (inc.writeup_state === "to_review" && !open ? to.writeup(inc.number) : to.incident(inc.number))}>
      <span className="in-row__main">
        <span className="in-row__title"><span className="in-row__tag">INC-{inc.number}</span> {inc.title}</span>
        <span className="in-row__sub">
          <SevPill settings={d.settings} sev={inc.severity} short />
          <span>{open ? `${span(startOf(inc), now)} · since ${new Date(startOf(inc)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`
            : `${span(startOf(inc), Date.parse(inc.resolved_at || inc.declared_at))} · ${dayLabel(inc.resolved_at, now)}`}</span>
          {inc.service ? <span>{inc.service}</span> : null}
          {!open && tasks.length ? <span>{done} of {tasks.length} follow-ups done</span> : null}
        </span>
      </span>
      <span className="in-row__side">
        {open ? <StatusPill status={inc.status} /> : inc.writeup_state === "to_review" ? <Pill tone="warning">Write-up to review</Pill>
          : inc.writeup_state === "reviewed" ? <Pill tone="success">Reviewed</Pill>
            : inc.writeup_state === "drafting" ? <Pill tone="ai" icon={Sparkles}>Drafting write-up</Pill> : <Pill>No write-up</Pill>}
        {inc.lead_name ? <span className="in-row__lead"><Who name={inc.lead_name} size={20} /><span>{inc.lead_name}</span></span> : null}
        <ChevronRight className="in-row__go" aria-hidden="true" />
      </span>
    </button>
  );
}

function taskWord(t: Task) {
  return { todo: "To do", in_progress: "In progress", waiting: "Waiting", done: "Done", canceled: "Canceled" }[t.status] || t.status;
}

function Followups() {
  const d = useIncidents();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const byId = new Map(d.incidents.map((i) => [i.id, i]));
  const open = d.tasks.filter((t) => t.status !== "done" && t.status !== "canceled");
  const closed = d.tasks.filter((t) => t.status === "done" || t.status === "canceled");
  const proposed = d.incidents.flatMap((i) => i.followups.filter((f) => f.state === "proposed").map((f) => ({ inc: i, f })));
  const accept = async (inc: Incident, key: string, dismiss = false) => {
    setBusy(key);
    try {
      const out = await call("incidents_followup", { incident: inc.id, proposal: key, dismiss });
      toast(said(out.message || "Done."));
      await d.reload();
    } catch (e) {
      toast(`Couldn't: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const row = (t: Task) => {
    const inc = t.source_id ? byId.get(t.source_id) : undefined;
    return (
      <div key={t.id} className="in-fu">
        <button type="button" className="in-fu__title" onClick={() => void openApp("tasks", `/t/${t.id}`)}>
          {t.number != null ? <span className="in-row__tag">#{t.number}</span> : null} {t.title}
        </button>
        <span className="in-fu__meta">
          {inc ? <button type="button" className="in-link" onClick={() => to.incident(inc.number)}>INC-{inc.number}</button> : null}
          {t.assignee_kind === "agent" ? <span className="c-row"><Sparkles size={12} aria-hidden="true" />{t.assignee_agent === "pod_default" ? "The Lemma" : t.assignee_agent}</span>
            : t.assignee_name ? <span className="c-row"><Who name={t.assignee_name} size={18} />{t.assignee_name}</span> : <span>Nobody yet</span>}
          {t.due_on ? <span>due {new Date(t.due_on).toLocaleDateString([], { month: "short", day: "numeric" })}</span> : null}
        </span>
        <Pill tone={t.status === "done" ? "success" : t.status === "in_progress" ? "info" : "plain"}>{taskWord(t)}</Pill>
      </div>
    );
  };
  return (
    <main className="c-body in-list-page">
      <p className="c-faint in-small in-note">Team tasks made from incidents, in Tasks. Open one to work it there.</p>
      {proposed.length ? (
        <section className="in-listsec in-listsec--first">
          <h2 className="in-h2">Proposed in write-ups <Ai /> <span className="c-faint">{proposed.length}</span></h2>
          <div className="in-rows">
            {proposed.map(({ inc, f }) => (
              <div key={f.key} className="in-fu">
                <span className="in-fu__title in-fu__title--plain">{f.title}</span>
                <span className="in-fu__meta">
                  <button type="button" className="in-link" onClick={() => to.writeup(inc.number)}>INC-{inc.number}</button>
                  <span className="c-row"><CircleDashed size={12} aria-hidden="true" />Suggested by the Lemma</span>
                </span>
                <span className="c-row">
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void accept(inc, f.key, true)}>Not now</Button>
                  <Button size="sm" icon={Check} busy={busy === f.key} disabled={!!busy} onClick={() => void accept(inc, f.key)}>Accept</Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="in-listsec">
        <h2 className="in-h2">Open <span className="c-faint">{open.length}</span></h2>
        {open.length ? <div className="in-rows">{open.map(row)}</div> : <p className="c-faint in-small">No open follow-ups.</p>}
      </section>
      {closed.length ? (
        <section className="in-listsec">
          <h2 className="in-h2">Done <span className="c-faint">{closed.length}</span></h2>
          <div className="in-rows">{closed.map(row)}</div>
        </section>
      ) : null}
    </main>
  );
}
