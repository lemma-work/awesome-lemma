// A page at /p/<id>. An answer or a policy opens as the page itself, with its
// source line, facts and the questions it answered. A procedure opens as its
// Playbook (C): the steps with where people stop, a proposed change under
// its step, who it's assigned to and where it came from.

import { useEffect, useState } from "react";
import { BadgeCheck, BookOpen, Check, ChevronRight, Clock, FileText, FolderOpen, Globe, ListChecks, Pencil, Play, Sparkles, Undo2, UserPlus, Users } from "lucide-react";
import { Button, Empty, Pill, Sheet, Skeleton, ago, plural, useToast } from "@lemma-plugins/kit";
import { usePageText } from "./Answers";
import { AUDIENCE, KIND, call, decide, firstOf, fmtDay, isLate, nowMs, refreshMine, useKnowhow, useWho, type Article, type Change, type Data } from "./data";
import { Ai, AudienceMark, Gap, Page, SourceLine, StatePill, WhereChip, inline, stepsOf } from "./marks";
import { to } from "./route";
import { tellAskers } from "./wire";

export function PageView({ id }: { id: string }) {
  const d = useKnowhow();
  const a = d.articleBy.get(id);
  if (!a) return <main className="c-body"><Empty icon={FileText} title="No such page" action={<Button onClick={() => to.library()}>Open the Library</Button>}>It may have been retired or cleared with the sample.</Empty></main>;
  return <Record a={a} key={a.id} />;
}

function useRun() {
  const d = useKnowhow();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const run = async (key: string, fn: () => Promise<string | undefined | void>) => {
    setBusy(key);
    try {
      const said = await fn();
      if (said) toast(said);
      refreshMine();
      await d.reload();
    } catch (e) {
      toast(`Couldn't do that: ${e instanceof Error ? e.message : "try again"}`);
    } finally {
      setBusy("");
    }
  };
  return { busy, run };
}

function Record({ a }: { a: Article }) {
  const d = useKnowhow();
  const { me } = useWho();
  const now = nowMs(d.questions);
  const topic = d.topicBy.get(a.topic_id || "") || null;
  const page = usePageText(a.path);
  const { busy, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const changes = d.changes.filter((c) => c.article_id === a.id && c.state === "proposed");
  const disagree = changes.filter((c) => c.kind === "may_disagree");
  const asked = d.questions.filter((q) => q.article_id === a.id && !q.walk_step).sort((x, y) => String(y.asked_at).localeCompare(String(x.asked_at)));
  const events = (d.eventsBy.get(a.id) || []).slice().reverse();
  const late = a.state !== "draft" && isLate(a, now);
  const proc = a.kind === "procedure";
  const customersOn = !!(d.settings?.audiences.customers || d.settings?.audiences.public);
  const steps = proc ? (page.text ? stepsOf(page.text).map((s, i) => ({ ...s, reached: a.steps[i]?.reached || 0, asked: a.steps[i]?.asked || 0 })) : a.steps) : [];
  const walks = d.walks.filter((w) => w.article_id === a.id);
  const done = walks.filter((w) => w.state === "done" && w.done_at);
  const typical = done.length ? Math.round(done.reduce((m, w) => m + (Date.parse(w.done_at || "") - Date.parse(w.started_at)), 0) / done.length / 60_000) : null;
  const assigns = d.assignments.filter((g) => g.article_id === a.id);

  const keep = () => run("keep", async () => (await decide("keep", { article_id: a.id })).message);
  const save = (body?: string) => run("save", async () => {
    const out = await decide(a.state === "draft" ? "save" : "edit", { article_id: a.id, ...(body ? { body_md: body } : {}) });
    if (out.tell_members?.length) await tellAskers(a.title, out.tell_members, [], me?.name || "Someone");
    return out.message;
  });

  return (
    <main className="c-body kh-record">
      <nav className="kh-crumb" aria-label="Where">
        <button type="button" onClick={() => to.library()}>Library</button><ChevronRight aria-hidden="true" />
        {topic ? <button type="button" onClick={() => to.library(topic.slug)}>{topic.name}</button> : <span>No topic</span>}
      </nav>
      <header className="c-record-head">
        <div className="c-grow">
          <h1>{a.title}</h1>
          <div className="c-record-head__sub">
            <span>{KIND[a.kind]}{proc ? ` · ${plural(steps.length, "step")}` : ""}</span>
            <span>· owned by {a.owner_name || "nobody yet"}</span>
            <span>· seen by {AUDIENCE[a.audience].toLowerCase()}</span>
          </div>
          <div className="c-record-head__facts">
            <StatePill a={a} now={now} />
            {a.state !== "draft" && a.checked_at ? <span className="kh-fact"><BadgeCheck aria-hidden="true" />Checked by {a.checked_by_name || a.owner_name} on {fmtDay(a.checked_at)}</span> : null}
            {a.due_on && a.state !== "draft" ? <span className={`kh-fact${late ? " kh-late" : ""}`}><Clock aria-hidden="true" />{late ? "Was due" : "Next check"} {fmtDay(a.due_on)}</span> : null}
            {proc ? <span className="kh-fact"><ListChecks aria-hidden="true" />{plural(a.walks_30d, "walk")} this month · {a.finished_30d} finished</span>
              : <span className="kh-fact">{plural(a.uses_30d, "use")} this month</span>}
            {a.audience === "public" && a.published_at ? <span className="kh-fact"><Globe aria-hidden="true" />In the customer answers</span> : null}
          </div>
        </div>
        <div className="c-record-head__actions">
          {a.state === "draft" ? <Button variant="primary" icon={Check} busy={busy === "save"} onClick={() => void save()}>Save as answer</Button>
            : <Button variant={late || a.state === "may_disagree" ? "primary" : "default"} icon={BadgeCheck} busy={busy === "keep"} onClick={() => void keep()}>Keep</Button>}
          <Button icon={Pencil} onClick={() => setEditing(true)}>Edit page</Button>
          {proc ? <Button icon={UserPlus} onClick={() => setAssigning(true)}>Assign</Button> : null}
          {proc && a.state !== "draft" ? <Button icon={Play} onClick={() => to.walk(a.id)}>Walk through</Button> : null}
          {!proc && a.state !== "draft" && customersOn ? (a.audience === "customers" || a.audience === "public"
            ? <Button icon={Undo2} busy={busy === "back"} onClick={() => void run("back", async () => (await decide("take_back", { article_id: a.id })).message)}>Take back</Button>
            : <Button icon={Globe} busy={busy === "approve"} onClick={() => void run("approve", async () => (await decide("approve_for_customers", { article_id: a.id })).message)}>Approve for customers</Button>) : null}
          {a.state !== "draft" ? <Button variant="ghost" busy={busy === "retire"} onClick={() => void run("retire", async () => (await decide("retire", { article_id: a.id })).message)}>Retire</Button> : null}
        </div>
      </header>

      <div className="c-split c-split--record">
        <div className="kh-record__main">
          {disagree.map((c) => <Disagree key={c.id} c={c} a={a} onKeep={keep} />)}
          {proc ? (
            <section aria-label="Steps" className="kh-steps">
              <h3 className="kh-h3">Steps <span className="c-faint">· where people stop</span></h3>
              {page.text == null && !steps.length ? <Skeleton kind="list" rows={5} /> : steps.length ? (
                <ol className="kh-steplist">
                  {steps.map((s, i) => {
                    const top = steps[0]?.reached || 0;
                    const prop = changes.filter((c) => c.kind !== "may_disagree" && c.step === s.n);
                    return (
                      <li key={s.n} className="kh-step">
                        <span className="kh-step__n num">{s.n}</span>
                        <div className="kh-step__main">
                          <div className="kh-step__head"><b>{s.title}</b>{s.who ? <Pill>{s.who}</Pill> : null}</div>
                          {s.body ? <Page text={s.body} /> : null}
                          <div className="kh-step__meta">
                            <span className="num">{s.reached} reached</span>
                            {top ? <span className="kh-meter" aria-hidden="true"><span style={{ width: `${Math.round((s.reached / top) * 100)}%` }} /></span> : null}
                            {s.asked ? <span className="kh-asked num">{s.asked} asked here</span> : null}
                            {i > 0 && steps[i - 1].reached - s.reached > 0 ? <span className="c-faint num">{steps[i - 1].reached - s.reached} stopped before this</span> : null}
                          </div>
                          {prop.map((c) => <Proposal key={c.id} c={c} a={a} step={s.n} />)}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="c-muted">No numbered steps yet. Edit the page and write each step as <code>### 1. Title</code>.</p>}
              {d.sources.some((s) => s.unreadable.some((u) => u.sheet_page)) ? <Gap>Spreadsheets can't be searched: the Lemma reads the table page made from each one instead.</Gap> : null}
            </section>
          ) : (
            <section aria-label="The page" className="kh-pagebody">
              {page.text == null ? <Skeleton kind="list" rows={6} /> : page.failed ? <p className="c-muted">Couldn't read the file at {a.path}.</p> : <Page text={page.text} />}
              {a.state !== "draft" ? <SourceLine a={a} now={now} /> : null}
              {late ? <p className="kh-warn">The team still gets this answer, with a warning. Customers don't, until it's checked.</p> : null}
              {changes.filter((c) => c.kind !== "may_disagree").map((c) => <Proposal key={c.id} c={c} a={a} step={c.step || 0} />)}
            </section>
          )}
          {!proc ? (
            <section className="kh-asked-list" aria-label="Questions it answered">
              <h3 className="kh-h3">Questions it answered <span className="c-faint num">{asked.length}</span></h3>
              {asked.length ? (
                <ul className="kh-mini">
                  {asked.slice(0, 12).map((q) => (
                    <li key={q.id}><button type="button" onClick={() => to.answers(q.id)}>
                      <span className="c-grow c-ellipsis">“{q.text}”</span>
                      <WhereChip where={q.where_source} /><span className="c-faint">{ago(q.asked_at, now)}</span>
                    </button></li>
                  ))}
                </ul>
              ) : <p className="c-faint">None yet.</p>}
            </section>
          ) : null}
          <section className="kh-activity" aria-label="Activity">
            <h3 className="kh-h3">Activity</h3>
            {events.length ? <ol className="kh-log">{events.map((e) => <li key={e.id}><span className="kh-log__dot" aria-hidden="true" /><span className="kh-log__text">{inline(e.text)}</span><span className="c-faint">{ago(e.at, now)}</span></li>)}</ol>
              : <p className="c-faint">Nothing yet.</p>}
          </section>
        </div>
        <aside className="kh-record__side">
          <dl className="c-props">
            <dt><Users aria-hidden="true" />Owner</dt><dd>{a.owner_name || "Nobody yet"}</dd>
            <dt>Backup</dt><dd>{topic?.backup_name || <span className="c-faint">None</span>}</dd>
            <dt><FolderOpen aria-hidden="true" />Topic</dt><dd>{topic?.name || "None"}{topic?.sensitive ? " · sensitive" : ""}</dd>
            <dt>Seen by</dt><dd><AudienceMark audience={a.audience} /></dd>
            <dt>Check every</dt><dd>{topic?.check_days || d.settings?.default_check_days || 90} days</dd>
            <dt>Path</dt><dd className="kh-path" title={a.path}>{a.path}</dd>
            {proc ? <><dt>Typical walk</dt><dd>{typical != null ? `${typical} min` : <span className="c-faint">No walks yet</span>}</dd></>
              : <><dt>Uses</dt><dd className="num">{a.uses_30d} this month</dd><dt>Missed</dt><dd className="num">{a.misses_30d}</dd></>}
          </dl>
          {proc ? (
            <section className="kh-side-block">
              <h3 className="kh-h3">Assigned <span className="c-faint num">{assigns.length}</span></h3>
              {assigns.length ? (
                <ul className="kh-assigned">
                  {assigns.map((g) => {
                    const w = walks.find((x) => x.id === g.walk_id);
                    const said = g.state === "done" ? `Finished ${fmtDay(w?.done_at || g.assigned_at)}`
                      : w && w.state !== "done" ? `Step ${w.step} of ${w.steps_total} · ${w.where_source === "teams" ? "in Teams" : "here"}${w.state === "stuck" ? " · stuck" : " now"}`
                        : `Not started · assigned ${fmtDay(g.assigned_at)}`;
                    return <li key={g.id}><span className="c-grow"><span>{g.member_name || "A member"}</span>{g.role ? <span className="c-faint"> · {g.role}</span> : null}</span><span className={g.state === "done" ? "kh-ok" : "c-muted"}>{said}</span></li>;
                  })}
                </ul>
              ) : <p className="c-faint">Nobody yet. Assign it to new joiners by name or role.</p>}
            </section>
          ) : null}
          {a.quote ? (
            <section className="kh-side-block">
              <h3 className="kh-h3">Where it came from</h3>
              <blockquote className="kh-quote">{a.quote}<span className="kh-quote__by">{[a.quote_who, a.quote_where].filter(Boolean).join(" · ")}</span></blockquote>
            </section>
          ) : null}
          <Gap>The Lemma's Docs page doesn't show “checked by”: Know-how keeps it.</Gap>
        </aside>
      </div>
      <EditPage open={editing} onClose={() => setEditing(false)} a={a} text={page.text || ""} onSave={(body) => { setEditing(false); void save(body); }} />
      {proc ? <Assign open={assigning} onClose={() => setAssigning(false)} a={a} d={d} /> : null}
    </main>
  );
}

function Disagree({ c, a, onKeep }: { c: Change; a: Article; onKeep: () => void }) {
  const { busy, run } = useRun();
  return (
    <section className="kh-block kh-block--late">
      <h3><Sparkles aria-hidden="true" />May disagree<Ai /></h3>
      <p className="c-muted">{c.evidence.why || "Its file changed since it was checked."}</p>
      <div className="kh-side-by-side">
        <div><span className="kh-label">The page, as checked</span><blockquote className="kh-quote">{c.evidence.page_text}</blockquote></div>
        <div><span className="kh-label">What changed{c.source_path ? ` in ${c.source_path.split("/").pop()}` : ""}</span><blockquote className="kh-quote">{c.evidence.source_text}</blockquote></div>
      </div>
      <div className="kh-actions">
        <Button variant="primary" icon={Pencil} busy={busy === "add"} onClick={() => void run("add", async () => (await decide("add_change", { article_id: a.id, change_id: c.id, text: c.text })).message)}>Use the new text{c.step ? ` in step ${c.step}` : ""}</Button>
        <Button onClick={onKeep}>It still agrees: keep</Button>
      </div>
    </section>
  );
}

function Proposal({ c, a, step }: { c: Change; a: Article; step: number }) {
  const { busy, run } = useRun();
  const [text, setText] = useState(c.text);
  const [editing, setEditing] = useState(false);
  const n = c.question_ids.length;
  return (
    <div className="kh-proposal">
      <div className="kh-proposal__head"><Sparkles aria-hidden="true" /><b>Proposed {step ? `for step ${step}` : "change"}</b><Ai /></div>
      {editing ? <textarea className="c-textarea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Proposed text" /> : <p>{text}</p>}
      {c.evidence.quote ? <p className="kh-proposal__why">{n ? `Asked ${n === 2 ? "twice" : `${n} times`} mid-walk, not covered. ` : ""}Drafted from {firstOf(c.evidence.who)}'s reply{c.evidence.where ? ` (${c.evidence.where})` : ""}: “{c.evidence.quote}”</p> : null}
      <div className="kh-actions">
        <Button size="sm" variant="primary" icon={Check} busy={busy === "add"} onClick={() => void run("add", async () => (await decide("add_change", { article_id: a.id, change_id: c.id, text })).message)}>Add to step {step || ""}</Button>
        <Button size="sm" onClick={() => setEditing((x) => !x)}>{editing ? "Done editing" : "Edit"}</Button>
        <Button size="sm" variant="ghost" busy={busy === "no"} onClick={() => void run("no", async () => (await decide("decline_change", { article_id: a.id, change_id: c.id })).message)}>Not now</Button>
      </div>
    </div>
  );
}

function EditPage({ open, onClose, a, text, onSave }: { open: boolean; onClose: () => void; a: Article; text: string; onSave: (body: string) => void }) {
  const [body, setBody] = useState(text);
  useEffect(() => { if (open) setBody(text); }, [open, text]);
  return (
    <Sheet open={open} title={`Edit ${a.title}`} onClose={onClose}
      footer={<><Button variant="primary" onClick={() => onSave(body)}>{a.state === "draft" ? "Save as answer" : "Save"}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <p className="c-muted kh-hint">Saving writes {a.path} as you{a.state !== "draft" ? ", and counts as a check" : ""}. Steps are <code>### 1. Title</code>, with an optional first line <code>Who: Warehouse</code>.</p>
      <textarea className="c-textarea kh-editor" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Page text" />
      <Gap>Opening the page in the Lemma's Docs editor from an app isn't possible yet; this edits the same file.</Gap>
    </Sheet>
  );
}

function Assign({ open, onClose, a, d }: { open: boolean; onClose: () => void; a: Article; d: Data }) {
  const { members, roles } = useWho();
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>([]);
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const byRole = role ? members.filter((m) => m.roles.some((r) => r.toLowerCase() === role.toLowerCase())) : [];
  const chosen = [...new Set([...picked, ...byRole.map((m) => m.user_id)])];
  const go = async () => {
    setBusy(true);
    try {
      const res = await call("knowhow_assign", { article_id: a.id, role: role || null,
        members: chosen.map((id) => ({ member_id: id, name: members.find((m) => m.user_id === id)?.name })) });
      toast(res.message || "Assigned.");
      refreshMine();
      await d.reload();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title={`Assign ${a.title}`} onClose={onClose}
      footer={<><Button variant="primary" busy={busy} onClick={() => void go()} disabled={!chosen.length}>Assign to {plural(chosen.length, "person", "people")}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <p className="c-muted kh-hint">Each person gets “Walk {a.title}” in Today, and can walk it in Teams or here.</p>
      {roles.length ? (
        <label className="c-field"><span className="c-field__label">By role</span>
          <select className="c-select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">No role</option>{roles.map((r) => <option key={r.id} value={r.name}>{r.name} ({members.filter((m) => m.roles.includes(r.name)).length})</option>)}
          </select>
        </label>
      ) : null}
      <ul className="kh-picklist">
        {members.map((m) => (
          <li key={m.user_id}><label><input type="checkbox" checked={chosen.includes(m.user_id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, m.user_id] : p.filter((x) => x !== m.user_id))} /><span className="c-grow">{m.name}</span><span className="c-faint">{m.roles.join(", ")}</span></label></li>
        ))}
      </ul>
      {!members.length ? <p className="c-faint">Only members of this Lemma can be assigned.</p> : null}
      <p className="c-faint kh-hint"><BookOpen aria-hidden="true" /> A role is turned into its members now; someone given the role later isn't assigned.</p>
    </Sheet>
  );
}
