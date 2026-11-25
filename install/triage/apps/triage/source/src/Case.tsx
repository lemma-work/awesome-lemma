// The case file (C): one item, proven. Header facts; every report and how
// it was merged; the Lemma's read; what was checked, and what wasn't; reach
// by source with when each was read; Activity; the properties beside (owner
// with alternatives, task, related, who asked); and the decision bar.

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ExternalLink, Megaphone, Scissors, Send, Sparkles } from "lucide-react";
import { Button, Empty, Field, Kbd, Pill, Sheet, openApp, runFunction, useToast } from "@lemma-plugins/kit";
import { DecisionButtons, useDecide } from "./Decide";
import { nowMs, useTriage, type Data } from "./data";
import { facts, ReadIt } from "./Inbox";
import { typing } from "./keys";
import { Ai, Chip, EvidencePill, Gap, NoOne, STATE_WORDS, Who, doorWord, hhmm, itemPills, num, whenShort } from "./marks";
import { to } from "./route";
import type { Item, Report } from "./types";
import { tellFormAsks, why } from "./wire";

const PRIORITY_WORDS: Record<string, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
const ASK_WHERE: Record<string, string> = { web: "form", slack: "Slack", github: "GitHub", mail: "email", teams: "Teams", lemma: "the Lemma" };

function priorityWhy(it: Item, d: Data): string {
  const s = d.settings;
  if (it.state === "marked_down") return "marked down";
  if (it.reach_people != null && it.reach_people > (s?.urgent_people || 100)) return `from reach: over ${num(s?.urgent_people || 100)} people${it.escalating ? " and rising" : ""}`;
  if (it.escalating) return "from reach: rising";
  if (it.security?.severity) return `from the alert: ${it.security.severity}${it.security.reachable ? ", reachable" : ""}`;
  if (it.reach_people != null && it.reach_people > 25) return "from reach: over 25 people";
  return "from reach";
}

function howMerged(r: Report): string {
  const bits: string[] = [];
  if (r.door === "form") bits.push(r.detail && (r.detail as { signed_in?: boolean }).signed_in ? "In-product form, signed in" : "Report form");
  for (const k of ["page", "app_version", "browser"] as const) if (r[k]) bits.push(String(r[k]));
  if (r.files.length) bits.push("screenshot attached");
  if (r.steps) bits.push("steps given");
  if (r.match_note) bits.push(r.match_note);
  return bits.join(" · ");
}

export function Case({ number }: { number: number }) {
  const d = useTriage();
  const toast = useToast();
  const it = d.byNumber.get(number) || null;
  const now = nowMs(d);
  const order = d.inbox;
  const at = it ? order.findIndex((i) => i.id === it.id) : -1;
  const x = useDecide(it, { keys: !!it });
  const [publishing, setPublishing] = useState(false);
  const [telling, setTelling] = useState(false);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".c-sheet")) return;
      if ((e.key === "j" || e.key === "J") && at >= 0 && order[at + 1]) { e.preventDefault(); to.item(order[at + 1].number); }
      else if ((e.key === "k" || e.key === "K") && at > 0) { e.preventDefault(); to.item(order[at - 1].number); }
      else if (e.key === "Escape") to.list();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [at, order]);

  const reps = it ? d.reportsBy.get(it.id) || [] : [];
  const asks = it ? d.asksBy.get(it.id) || [] : [];
  const events = it ? [...(d.eventsBy.get(it.id) || [])] : [];
  const task = it ? d.tasksBy.get(it.id) : undefined;
  const known = it ? d.known.find((k) => k.id === it.id) : undefined;
  const pendingForm = asks.filter((a) => a.source === "web" && !a.told_at && (a.state === "shipped" || a.state === "declined"));
  const looks = it?.looks_like ? d.byId.get(it.looks_like) : null;
  const places = new Set(reps.map((r) => doorWord(r))).size;
  const counted = reps.filter((r) => r.door === "sentry" || r.door === "posthog");
  const humans = reps.filter((r) => r.reporter_kind !== "machine");
  const dayAgo = (() => {
    if (!it) return "—";
    const first = Date.parse(it.first_seen || it.created_at);
    if (first && now - first < 86_400_000) return "0";
    const want = now - 86_400_000;
    const near = (it.trend || []).find(([h]) => Math.abs(Date.parse(h) - want) < 90 * 60_000);
    return near ? num(near[1]) : "—";
  })();

  const reachRows = useMemo(() => {
    if (!it) return [];
    const rows: { src: string; counts: string; now: string; before: string; at: string }[] = [];
    for (const r of counted) {
      rows.push({ src: doorWord(r), counts: r.door === "sentry" ? "people who hit the error" : "people who hit the error (PostHog)",
        now: num(r.people), before: dayAgo, at: hhmm(r.read_at) || "—" });
    }
    rows.push({ src: "Reports", counts: `people who wrote in${humans.length ? `: ${[...new Set(humans.map((r) => doorWord(r).toLowerCase()))].join(", ")}` : ""}`,
      now: String(it.reach_asks || humans.length), before: "—", at: "live" });
    if (it.reach_companies) rows.push({ src: "Customers", counts: "companies among them", now: num(it.reach_companies), before: "—", at: hhmm(it.reach_read_at) || "live" });
    return rows;
  }, [it, counted, humans, dayAgo]);

  if (!it) {
    return <main className="c-body"><Empty title={`There's no T-${number}`} action={<Button onClick={() => to.list()}>Back to the inbox</Button>}>It may have been cleared with the sample.</Empty></main>;
  }

  const split = async (r: Report) => {
    try {
      const out = await runFunction<{ message?: string }>("triage_decide", { item: it.id, action: "split", report_id: r.id });
      toast(out?.message || "Split.");
      await d.reload();
    } catch (e) {
      toast(`Couldn't split it: ${why(e)}`);
    }
  };

  return (
    <div className="tr-case">
      <div className="tr-crumb">
        <button type="button" onClick={() => to.list()}><ChevronLeft aria-hidden="true" />Triage</button>
        <span className="tr-faint">/</span>
        <span className="tr-strong">T-{it.number}</span>
        <span className="tr-fill" />
        {at >= 0 ? <span className="tr-faint tr-small">{at + 1} of {order.length} to decide <Kbd>J</Kbd> <Kbd>K</Kbd></span> : null}
      </div>
      <div className="tr-casehead">
        <div className="tr-pills">
          <Pill tone={it.state === "inbox" ? "info" : it.state === "done" ? "success" : "plain"}>{STATE_WORDS[it.state]}</Pill>
          {itemPills(it, looks ? `T-${looks.number}` : null, now).filter((p) => !p.text.startsWith("New since")).map((p) => <Pill key={p.text} tone={p.tone}>{p.text}</Pill>)}
          {it.state === "inbox" ? <Pill>{PRIORITY_WORDS[it.priority]}, by reach</Pill> : null}
        </div>
        <h1 className="tr-title">{it.title}</h1>
        <div className="tr-facts tr-facts--big">
          {facts(it, d).map((f) => <span key={f}>{f}</span>)}
          {reps.length > 1 ? <span>{reps.length} reports from {places} {places === 1 ? "place" : "places"}</span> : null}
          {it.paths[0] ? <span>{it.paths[0]}</span> : null}
        </div>
      </div>
      <div className="tr-body">
        <main className="tr-main">
          <section>
            <h2 className="tr-h2">Reports<span className="tr-sub">every place this was reported, merged into one</span></h2>
            {reps.map((r) => (
              <div key={r.id} className="tr-crep">
                <span className="tr-faint tr-small">{whenShort(r.received_at, now)}</span>
                <span><Chip>{doorWord(r)}</Chip></span>
                <div className="tr-crep__x">
                  <div className="tr-strong">{r.reporter_kind === "machine" ? r.title : r.reporter_name}</div>
                  <div className="tr-muted">{r.reporter_kind === "machine" ? r.body || r.path : `“${r.quote || r.title}”`}</div>
                  <div className="tr-small tr-faint">{howMerged(r)}</div>
                  {r.steps || r.expected ? <div className="tr-small tr-muted">{r.steps ? `Steps: ${r.steps}` : ""}{r.expected ? ` · Expected: ${r.expected}` : ""}</div> : null}
                </div>
                <span className="tr-crep__acts">
                  {r.source_url && /^https?:/.test(r.source_url) ? <a className="tr-iconlink" href={r.source_url} target="_blank" rel="noreferrer" aria-label="Open where it was said"><ExternalLink aria-hidden="true" /></a> : null}
                  {reps.length > 1 && r.state === "merged" && it.state === "inbox" ? <Button size="sm" variant="ghost" icon={Scissors} onClick={() => void split(r)}>Split out</Button> : null}
                </span>
              </div>
            ))}
          </section>

          <section className="tr-read">
            <div className="tr-read__head"><Sparkles aria-hidden="true" />The Lemma's read<span className="tr-fill" /><Ai /></div>
            {it.summary ? (
              <>
                <div>{it.summary}</div>
                {it.fix_hint ? <div className="tr-small"><span className="tr-muted">Fix hint:</span> {it.fix_hint}</div> : null}
                <div className="tr-small tr-faint">Read from the {it.evidence.length} sources below{it.read_at ? ` at ${hhmm(it.read_at)}` : ""}. It doesn't guess a confidence: each line says what it rests on.</div>
              </>
            ) : <ReadIt it={it} />}
          </section>

          {it.evidence.length ? (
            <section>
              <h2 className="tr-h2">What was checked<span className="tr-sub">and what wasn't</span></h2>
              <div className="c-table-wrap">
                <table className="c-table tr-table">
                  <thead><tr><th>Source</th><th>Asked</th><th>Answer</th><th>Result</th></tr></thead>
                  <tbody>
                    {it.evidence.map((e, i) => (
                      <tr key={i}>
                        <td className="tr-strong">{e.source}</td>
                        <td className="tr-muted">{e.asked || "—"}</td>
                        <td>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.answer}</a> : e.answer}</td>
                        <td><EvidencePill state={e.state} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="tr-h2">Reach<span className="tr-sub">counted in people where a source can count them</span></h2>
            <div className="c-table-wrap">
              <table className="c-table tr-table">
                <thead><tr><th>Source</th><th>Counts</th><th className="c-num">Now</th><th className="c-num">24h ago</th><th className="c-num">Read at</th></tr></thead>
                <tbody>
                  {reachRows.map((r) => (
                    <tr key={r.src}><td className="tr-strong">{r.src}</td><td className="tr-muted">{r.counts}</td><td className="c-num">{r.now}</td><td className="c-num">{r.before}</td><td className="c-num">{r.at}</td></tr>
                  ))}
                  {it.security ? (
                    <tr><td className="tr-strong">Repository</td><td className="tr-muted">where it is, and whether the code reaches it</td>
                      <td className="c-num">{it.repo || "—"}</td><td className="c-num">—</td><td className="c-num">{it.security.reachable ? "reachable" : it.security.scope || "—"}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="tr-gaps">
              {counted.length ? <Gap>Sentry and PostHog have no trigger; read every 15 minutes</Gap> : null}
              {it.reach_companies ? <Gap>Companies come from the reports and the error tracker's own tags; nothing upstream matches them all</Gap> : null}
            </div>
          </section>

          <section>
            <h2 className="tr-h2">Activity</h2>
            {events.length ? events.map((e) => (
              <div key={e.id} className="tr-act"><span className="tr-faint tr-small">{whenShort(e.at, now)}</span><span>{e.text}</span></div>
            )) : <p className="tr-faint tr-small">Nothing yet.</p>}
          </section>
        </main>

        <aside className="tr-side" aria-label="Properties">
          <div className="tr-prop"><span className="tr-k">Status</span><span>{it.state === "inbox" ? <Pill tone="info">Needs a decision</Pill> : <Pill>{STATE_WORDS[it.state]}</Pill>}
            {it.decline_reason ? <div className="tr-small tr-muted">{it.decline_reason}</div> : null}
            {it.marked_down_reason ? <div className="tr-small tr-muted">{it.marked_down_reason}</div> : null}</span></div>
          <div className="tr-prop"><span className="tr-k">Priority</span><span>{PRIORITY_WORDS[it.priority]}<div className="tr-small tr-muted">{priorityWhy(it, d)}</div></span></div>
          <div className="tr-hr" />
          <div className="tr-prop"><span className="tr-k">Owner</span><span>
            <span className="tr-who">{it.owner_name ? <Who name={it.owner_name} /> : <NoOne />}<span className="tr-strong">{it.owner_name || "Nobody yet"}</span></span>
            <div className="tr-small tr-muted">{it.owner_reason}</div>
            <button type="button" className="tr-link tr-small" onClick={() => x.setSheet("owner")}>Change <Kbd>A</Kbd></button>
          </span></div>
          {it.alternatives.length ? (
            <div className="tr-prop"><span className="tr-k">Also fits</span><span className="tr-stack">
              {it.alternatives.map((a) => <span key={`${a.name}${a.reason}`} className="tr-who"><Who name={a.name} />{a.name}<span className="tr-small tr-muted">{a.reason}</span></span>)}
            </span></div>
          ) : null}
          {it.owner_rule === "last_change" ? <div><Gap>Sentry's own suspect commit isn't reachable through its connector; this is the last change to the line, read from GitHub</Gap></div> : null}
          <div className="tr-hr" />
          <div className="tr-prop"><span className="tr-k">Task</span><span>{task ? (
            <button type="button" className="tr-link" onClick={() => void openApp("tasks", `/t/${task.id}`)}>#{task.number} {task.title.replace(/^T-\d+ /, "")} · {task.status.replace("_", " ")}</button>
          ) : <span className="tr-muted">None yet. Accepting makes one in Tasks, linked here.</span>}</span></div>
          {it.related.length ? (
            <div className="tr-prop"><span className="tr-k">Related</span><span className="tr-stack">{it.related.map((r) => (
              <span key={`${r.ref}${r.title}`}>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.ref} {r.title}</a> : `${r.ref} ${r.title}`}{r.note ? <div className="tr-small tr-muted">{r.note}</div> : null}</span>
            ))}</span></div>
          ) : null}
          {looks ? <div className="tr-prop"><span className="tr-k">Looks like</span><span><button type="button" className="tr-link" onClick={() => to.item(looks.number)}>T-{looks.number} {looks.title}</button></span></div> : null}
          <div className="tr-hr" />
          <div className="tr-prop"><span className="tr-k">Asked by</span><span className="tr-stack">
            {asks.length ? asks.map((a) => (
              <span key={a.id} className="tr-who"><Who name={a.name || a.handle} />{a.name || a.handle}
                <span className="tr-small tr-muted">{ASK_WHERE[a.source] || a.source}{a.company_name ? ` · ${a.company_name}` : ""}{a.state === "told" ? " · told" : a.state === "declined" && a.told_at ? " · told why" : ""}</span></span>
            )) : <span className="tr-muted">Nobody wrote in: only counted by a tracker.</span>}
            {asks.length ? <div className="tr-small tr-muted">Told in their thread when the task is done: by Release notes when it is installed, otherwise by Triage.</div> : null}
            {pendingForm.length ? <Button size="sm" icon={Send} onClick={() => setTelling(true)}>Tell {pendingForm.length} who used the form</Button> : null}
          </span></div>
          <div className="tr-prop"><span className="tr-k">Known issue</span><span>
            {known ? <span>{`“${known.title}”`}<div className="tr-small tr-muted">{known.state.replace("_", " ")}{d.settings?.known_public ? "" : " · not public until the form is on"}</div></span> : <span className="tr-muted">Not published</span>}
            <button type="button" className="tr-link tr-small" onClick={() => setPublishing(true)}><Megaphone size={12} aria-hidden="true" /> {known ? "Edit" : "Publish as known"}</button>
          </span></div>
        </aside>
      </div>
      <div className="tr-dec">
        <DecisionButtons item={it} x={x} full />
      </div>
      {x.sheets}
      <PublishSheet open={publishing} item={it} onClose={() => setPublishing(false)} />
      <TellSheet open={telling} item={it} onClose={() => setTelling(false)} />
    </div>
  );
}

function PublishSheet({ open, item, onClose }: { open: boolean; item: Item; onClose: () => void }) {
  const d = useTriage();
  const toast = useToast();
  const known = d.known.find((k) => k.id === item.id);
  const [title, setTitle] = useState("");
  const [page, setPage] = useState("");
  const [state, setState] = useState("investigating");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(known?.title || "");
    setPage(known?.page || (d.reportsBy.get(item.id) || []).find((r) => r.page)?.page || "");
    setState(known?.state || (item.state === "accepted" ? "being_fixed" : item.state === "done" ? "fixed" : "investigating"));
  }, [open, known, item, d.reportsBy]);
  const run = async (fn: () => Promise<{ message?: string }>) => {
    setBusy(true);
    try {
      toast((await fn())?.message || "Saved.");
      await d.reload();
      onClose();
    } catch (e) {
      toast(`Couldn't: ${why(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title={`T-${item.number} as a known issue`} onClose={onClose}
      footer={<>{known ? <Button variant="ghost" busy={busy} onClick={() => void run(() => runFunction("triage_unpublish_known", { item: item.id }))}>Take it off</Button> : null}
        <Button variant="primary" busy={busy} disabled={!title.trim()} onClick={() => void run(() => runFunction("triage_publish_known", { item: item.id, title: title.trim(), state, page: page.trim() || null }))}>Publish</Button></>}>
      <p className="tr-small tr-muted">People outside see only these words and the state, on the report form and in the chat beside it. Nothing else of the item is public.</p>
      <Field label="In words for people outside"><input className="c-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Checkout: the Pay button does nothing for some accounts" /></Field>
      <Field label="State">
        <select className="c-select" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="investigating">We're looking into it</option><option value="being_fixed">Being fixed</option><option value="fixed">Fixed</option>
        </select>
      </Field>
      <Field label="On which page" hint="An address prefix: the in-product form says &ldquo;we know about a problem on this page&rdquo; there."><input className="c-input" value={page} onChange={(e) => setPage(e.target.value)} placeholder="/checkout" /></Field>
    </Sheet>
  );
}

function TellSheet({ open, item, onClose }: { open: boolean; item: Item; onClose: () => void }) {
  const d = useTriage();
  const toast = useToast();
  const asks = (d.asksBy.get(item.id) || []).filter((a) => a.source === "web" && !a.told_at && (a.state === "shipped" || a.state === "declined"));
  const fixed = item.state === "done";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setText(fixed ? `Thanks for reporting this. It's fixed now: ${item.title}.` : `Thanks for reporting this. We've decided not to work on it: ${item.decline_reason || ""}`);
  }, [open, fixed, item]);
  return (
    <Sheet open={open} title={`Tell ${asks.length} who used the form`} onClose={onClose}
      footer={<Button variant="primary" busy={busy} disabled={!text.trim()} onClick={async () => {
        setBusy(true);
        try {
          const out = await tellFormAsks(item, asks, d.reportsBy.get(item.id) || [], text.trim(), fixed ? "told" : "declined");
          toast(`Wrote to ${out.told.length}.` + (out.left.length ? ` Couldn't write to ${out.left.length}: ${out.left[0]}` : ""));
          await d.reload();
          onClose();
        } catch (e) {
          toast(`Couldn't: ${why(e)}`);
        } finally {
          setBusy(false);
        }
      }}>Send from the Lemma's mailbox</Button>}>
      <p className="tr-small tr-muted">Sent by you, by email from the Lemma's own mailbox, to each person's confirmed address. A function can't write to people outside, so this is yours to send.</p>
      <ul className="tr-small">{asks.map((a) => <li key={a.id}>{a.name || a.handle}{a.company_name ? ` · ${a.company_name}` : ""}</li>)}</ul>
      <Field label="What they read"><textarea className="c-textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} /></Field>
    </Sheet>
  );
}
