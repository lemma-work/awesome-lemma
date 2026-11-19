// One deal: its facts, the stages as a stepper, the changes waiting with their
// sentences, what happened to it (the team's history), the person's own
// conversations and meetings with its people, the team's notes, and its
// properties beside. People and companies open in People map's apps.
//
// Conversations and meetings are the viewer's own (RLS): a teammate sees
// theirs. The history and notes are the team's and hold no words anyone wrote.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight, CalendarDays, CircleDollarSign, Clock, Hash, History as HistoryIcon, KanbanSquare, ListTodo, Mail,
  MessageSquarePlus, MoreHorizontal, NotebookPen, Sparkles, Trash2, User, Users, Video,
} from "lucide-react";
import {
  AskButton, Avatar, Button, Card, Empty, Header, Logo, Menu, MenuItem, Pill, Sheet, Skeleton, agoText, client, day, due,
  money, nameOf, openApp, q, sql, useToast,
} from "@lemma-plugins/kit";
import { save, useDeals } from "./data";
import { StagePill, fieldWord, sourceWord, valueText } from "./marks";
import { ProposalCard } from "./Proposal";
import { to } from "./route";
import type { Change, Deal, History, Note } from "./types";

interface Conv { id: string; subject: string | null; snippet: string | null; last_message_at: string | null; counterpart_name: string | null; counterpart_handle: string | null; last_direction: string | null }
interface Meet { id: string; title: string | null; start_at: string; summary: string | null }
interface TaskRow { id: string; number: number | null; title: string; status: string; assignee_kind: string; assignee_name: string | null; assignee_agent: string | null }

export function DealPage({ id }: { id: string }) {
  const { byId, loaded, stages, changesFor, me, reload, currency, warmthOf } = useDeals();
  const toast = useToast();
  const deal = byId.get(id);
  const [history, setHistory] = useState<History[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [decided, setDecided] = useState<Change[]>([]);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [meets, setMeets] = useState<Meet[]>([]);
  const [personOf, setPersonOf] = useState<Map<string, string>>(new Map());
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [tasking, setTasking] = useState(false);

  const load = useCallback(async () => {
    if (!deal) return;
    const handles = (deal.people || []).map((p) => (p.handle || "").toLowerCase()).filter(Boolean);
    const domain = (deal.company_domain || "").toLowerCase();
    const convWhere = [handles.length ? `lower(counterpart_handle) in (${handles.map(sql).join(", ")})` : "",
      domain ? `lower(counterpart_handle) like ${sql("%@" + domain)}` : ""].filter(Boolean).join(" or ");
    const meetWhere = [...handles.map((h) => `attendees::text ilike ${sql("%" + h + "%")}`), domain ? `attendees::text ilike ${sql("%@" + domain + "%")}` : ""]
      .filter(Boolean).join(" or ");
    const [h, n, c, cv, mt, ph, co] = await Promise.all([
      q<History>(`select * from deals_history where deal_id = ${sql(id)} order by at desc limit 200`),
      q<Note>(`select * from deals_note where deal_id = ${sql(id)} order by created_at desc limit 100`),
      q<Change>(`select * from deals_change where deal_id = ${sql(id)} and state <> 'proposed' order by decided_at desc nulls last limit 50`),
      convWhere ? q<Conv>(`select id, subject, snippet, last_message_at, counterpart_name, counterpart_handle, last_direction from conversation where kind = 'people' and (${convWhere}) order by last_message_at desc nulls last limit 20`).catch(() => [] as Conv[]) : Promise.resolve([] as Conv[]),
      meetWhere ? q<Meet>(`select id, title, start_at, summary from meeting where status <> 'cancelled' and (${meetWhere}) order by start_at desc limit 20`).catch(() => [] as Meet[]) : Promise.resolve([] as Meet[]),
      handles.length ? q<{ person_id: string; handle: string }>(`select person_id, handle from person_handle where kind = 'email' and handle in (${handles.map(sql).join(", ")})`).catch(() => []) : Promise.resolve([]),
      deal.company_id ? Promise.resolve([{ id: deal.company_id }]) : domain
        ? q<{ id: string }>(`select company_id as id from company_domain where domain = ${sql(domain)} limit 1`).catch(() => []) : Promise.resolve([]),
    ]);
    setHistory(h);
    setNotes(n);
    setDecided(c);
    setConvs(cv);
    setMeets(mt);
    setPersonOf(new Map(ph.map((r) => [r.handle.toLowerCase(), r.person_id])));
    setCompanyId(co[0]?.id || null);
    // With Tasks in this Lemma: the tasks made from this deal. Without it the read fails and the hook hides.
    q<TaskRow>(`select id, number, title, status, assignee_kind, assignee_name, assignee_agent from task where source = 'deals' and source_id = ${sql(id)} order by created_at desc limit 20`)
      .then(setTasks, () => setTasks(null));
  }, [deal, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = { label: "Deals", icon: KanbanSquare, onClick: () => to.board() };
  if (!loaded || (deal && history === null)) {
    return <><Header back={back} /><Skeleton kind="record" /></>;
  }
  if (!deal) {
    return (
      <><Header back={back} />
        <main className="c-body"><div className="c-card"><Empty icon={KanbanSquare} title="This deal is gone" action={<Button onClick={() => to.board()}>Back to the board</Button>}>Someone on the team deleted it, or the link is wrong.</Empty></div></main>
      </>
    );
  }
  const d = deal;
  const here = stages.find((s) => s.name === d.stage);
  const waiting = changesFor(d.id);
  const warm = d.status === "open" ? warmthOf(d) : null;
  const closes = d.close_date && d.status === "open" ? due(d.close_date) : null;

  const edit = async (fields: Record<string, unknown>, said?: string) => {
    try {
      const out = await save<{ changed?: string[] }>("edit", { deal_id: d.id, fields }, me);
      await reload("deals");
      void load();
      if (said && out.changed?.length) toast(said);
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await save("note", { deal_id: d.id, note }, me);
      setNote("");
      await load();
    } catch (e) {
      toast(`Couldn't add the note: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${d.name} for the whole team? Its history and notes go with it.`)) return;
    try {
      await save("delete", { deal_id: d.id }, me);
      await reload("deals");
      to.board();
    } catch (e) {
      toast(`Couldn't delete it: ${e instanceof Error ? e.message : e}`);
    }
  };
  const openPerson = (handle: string | null) => {
    if (!handle) return;
    const pid = personOf.get(handle.toLowerCase());
    void openApp("people", pid ? `/${pid}` : `/team/${encodeURIComponent(handle.toLowerCase())}`);
  };
  const open = stages.filter((s) => s.kind === "open");
  const at = here?.kind === "won" ? open.length : open.findIndex((s) => s.name === d.stage);

  return (
    <>
      <Header back={back} title={d.name}>
        <AskButton text={`Where does the ${d.name} deal${d.company_name ? ` with ${d.company_name}` : ""} stand, and what should happen next?`} />
        <Menu icon={MoreHorizontal} label="More" variant="ghost" align="right">
          {(close) => <MenuItem icon={Trash2} onSelect={() => { close(); void remove(); }}>Delete deal</MenuItem>}
        </Menu>
      </Header>
      <main className="c-body">
        <div className="c-record-head">
          <Logo name={d.company_name} domain={d.company_domain} size={52} />
          <div style={{ minWidth: 0 }}>
            <h1>{d.name}</h1>
            <div className="c-record-head__sub">
              {d.company_name || d.company_domain ? (
                companyId ? <button type="button" onClick={() => void openApp("companies", `/${companyId}`)}>{d.company_name || d.company_domain}</button>
                  : <span>{d.company_name || d.company_domain}</span>
              ) : null}
              {(d.people || []).filter((p) => p.handle || p.name).slice(0, 3).map((p) => (
                <span key={p.handle || p.name || ""} className="c-row" style={{ gap: 6 }}>
                  <span aria-hidden="true">·</span>
                  {p.handle ? <button type="button" onClick={() => openPerson(p.handle)}>{nameOf(p.name, p.handle)}</button> : <span>{p.name}</span>}
                </span>
              ))}
            </div>
            <div className="c-record-head__facts">
              <StagePill stages={stages} stage={d.stage} />
              {d.amount != null ? <Pill dot={false} icon={CircleDollarSign}>{money(Number(d.amount), d.currency || currency)}</Pill> : null}
              {d.close_date ? <Pill dot={false} icon={CalendarDays} tone={closes?.late ? "danger" : "plain"}>{closes?.late ? `Close date passed: ${closes.text}` : `Closes ${day(d.close_date)}`}</Pill> : null}
              {warm && (warm.warmth === "cooling" || warm.warmth === "cold") ? <Pill tone="warning">Quiet since {day(warm.last)}</Pill> : null}
              {waiting.length ? <Pill tone="ai" icon={Sparkles}>{waiting.length} waiting for you</Pill> : null}
            </div>
          </div>
        </div>

        <nav className="dt-steps" aria-label="Stage">
          {stages.map((s, i) => {
            const past = here?.kind !== "lost" && s.kind === "open" && i < at;
            return (
              <button key={s.id} type="button" className={`${s.name === d.stage ? "is-here" : past ? "is-past" : ""}${s.kind !== "open" ? ` is-${s.kind}` : ""}`}
                aria-current={s.name === d.stage ? "step" : undefined} title={s.meaning || `Move to ${s.name}`}
                onClick={() => s.name !== d.stage && void edit({ stage: s.name }, `Moved to ${s.name}`)}>
                {s.name}
              </button>
            );
          })}
        </nav>

        <div className="c-split c-split--record">
          <div className="c-stack">
            {waiting.length ? (
              <Card title="Waiting for you" icon={Sparkles} count={waiting.length}>
                <p className="dt-card-lead">From your conversations and meeting notes. Nothing changes until you keep it.</p>
                <div className="dt-props-list">{waiting.map((c) => <ProposalCard key={c.id} change={c} showDeal={false} />)}</div>
              </Card>
            ) : null}

            <Card title="History" icon={HistoryIcon} count={(history || []).length} flush>
              {(history || []).length === 0 ? <div className="c-card__body c-muted">Nothing has changed yet.</div> : (
                <ul className="c-timeline">
                  {(history || []).map((h) => {
                    // Your own sentence behind a change you kept (yours only: proposals are per person).
                    const plain = (x: unknown) => (x && typeof x === "object" && "v" in (x as object) ? (x as { v: unknown }).v : x);
                    const kept = h.how !== "proposal" ? undefined : decided.find((c) => c.state === "kept" && (
                      (h.field === "created" && c.kind === "new_deal")
                      || (h.field === "lost" && c.kind === "lost")
                      || (c.kind === h.field && String((c.kept_value || c.value || {})[h.field] ?? "") === String(plain(h.to_value) ?? ""))
                      || (h.field === "stage" && c.kind === "stage" && String((c.kept_value || c.value || {}).stage ?? "") === String(plain(h.to_value) ?? ""))));
                    return (
                      <li key={h.id}>
                        <span className="c-tl-icon">{h.how === "proposal" ? <Sparkles aria-hidden="true" /> : h.field === "created" ? <MessageSquarePlus aria-hidden="true" /> : <Clock aria-hidden="true" />}</span>
                        <div className="c-tl-main">
                          <div className="dt-hist">
                            <span className="dt-strong">{fieldWord(h.field)}</span>
                            {h.field === "created" ? <span className="c-muted">{valueText("created", h.to_value, d.currency || currency)}</span>
                              : <span className="c-muted">{h.from_value != null && valueText(h.field, h.from_value, "") !== "none" ? `${valueText(h.field, h.from_value, d.currency || currency)} → ` : ""}{valueText(h.field, h.to_value, d.currency || currency)}</span>}
                          </div>
                          <div className="dt-hist__by">
                            {h.by_name || "Someone"}
                            {h.how === "proposal" ? `, kept from ${sourceWord(h.source)}${h.with_name ? ` with ${h.with_name}` : ""}`
                              : h.how === "spreadsheet" ? ", pasted from a spreadsheet" : h.how === "sample" ? ", sample" : ""}
                          </div>
                          {kept?.quote ? <div className="dt-hist__quote">“{kept.quote}”</div> : null}
                        </div>
                        <span className="c-tl-when">{day(h.at)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card title="Your conversations" icon={Mail} count={convs.length} flush>
              {convs.length === 0 ? <div className="c-card__body c-muted">None in your mail with {d.company_name || "them"}. Teammates see the ones in theirs.</div> : (
                <div className="c-list">
                  {convs.map((c) => (
                    <button key={c.id} type="button" className="c-li c-li--link dt-li-btn" onClick={() => void openApp("inbox", `/inbox/${encodeURIComponent(c.id)}`)}>
                      <Avatar name={c.counterpart_name} email={c.counterpart_handle} size={26} />
                      <span className="c-li__main">
                        <span className="c-ellipsis dt-block">{c.subject || "(no subject)"}</span>
                        <span className="c-li__sub c-ellipsis dt-block">{c.last_direction === "outbound" ? "You" : nameOf(c.counterpart_name, c.counterpart_handle)}: {c.snippet}</span>
                      </span>
                      <span className="c-faint num dt-when">{day(c.last_message_at)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Your meetings" icon={Video} count={meets.length} flush>
              {meets.length === 0 ? <div className="c-card__body c-muted">No meetings on your calendar with them.</div> : (
                <div className="c-list">
                  {meets.map((m) => (
                    <button key={m.id} type="button" className="c-li c-li--link dt-li-btn" onClick={() => void openApp("meetings", `/${encodeURIComponent(m.id)}`)}>
                      <span className="dt-tile" aria-hidden="true"><Video size={14} /></span>
                      <span className="c-li__main">
                        <span className="c-ellipsis dt-block">{m.title || "Meeting"}</span>
                        {m.summary ? <span className="c-li__sub dt-clamp">{m.summary}</span> : null}
                      </span>
                      <span className="c-faint num dt-when">{new Date(m.start_at) > new Date() ? `${day(m.start_at)} ahead` : day(m.start_at)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Notes" icon={NotebookPen} count={notes.length}>
              <div className="dt-note-new">
                <textarea className="c-textarea" rows={3} value={note} placeholder="Something the team should know about this deal" onChange={(e) => setNote(e.target.value)} />
                <div className="c-row"><span className="c-grow" /><Button size="sm" variant={note.trim() ? "primary" : "default"} busy={busy} disabled={!note.trim()} onClick={() => void addNote()}>Add note</Button></div>
              </div>
              {notes.map((n) => (
                <div key={n.id} className="dt-note">
                  <div className="dt-note__by"><Avatar name={n.by_name} size={18} />{n.by_name || "Someone"}<span className="c-faint">· {agoText(n.created_at)}</span></div>
                  <div className="dt-note__body">{n.body}</div>
                </div>
              ))}
            </Card>
          </div>

          <div className="c-stack">
            <Card title="Deal" icon={Hash}>
              <dl className="c-props dt-props">
                <dt>Stage</dt>
                <dd>
                  <select className="c-select" value={d.stage} aria-label="Stage" onChange={(e) => void edit({ stage: e.target.value }, `Moved to ${e.target.value}`)}>
                    {stages.map((s) => <option key={s.id}>{s.name}</option>)}
                  </select>
                </dd>
                <dt>Amount</dt>
                <dd>
                  <div className="dt-amount dt-amount--tight">
                    <input className="c-input num" inputMode="decimal" aria-label="Amount" defaultValue={d.amount ?? ""} key={`a${d.amount}`}
                      onBlur={(e) => { const v = e.target.value.trim() ? Number(e.target.value.replace(/[^0-9.]/g, "")) : null; if (v !== (d.amount == null ? null : Number(d.amount))) void edit({ amount: v }, "Amount saved"); }} />
                    <input className="c-input" aria-label="Currency" maxLength={3} defaultValue={d.currency || currency} key={`c${d.currency}`}
                      onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (v && v !== d.currency) void edit({ currency: v }, "Currency saved"); }} />
                  </div>
                </dd>
                <dt>Closes</dt>
                <dd><input className="c-input" type="date" aria-label="Close date" defaultValue={d.close_date || ""} key={`d${d.close_date}`}
                  onBlur={(e) => (e.target.value || null) !== (d.close_date || null) && void edit({ close_date: e.target.value || null }, "Close date saved")} /></dd>
                <dt>Next step</dt>
                <dd><input className="c-input" aria-label="Next step" placeholder="What happens next" defaultValue={d.next_step || ""} key={`n${d.next_step}`}
                  onBlur={(e) => e.target.value.trim() !== (d.next_step || "") && void edit({ next_step: e.target.value.trim() || null }, "Next step saved")} /></dd>
                {here?.kind === "lost" ? (
                  <>
                    <dt>Why lost</dt>
                    <dd><input className="c-input" aria-label="Why lost" defaultValue={d.lost_reason || ""} key={`l${d.lost_reason}`}
                      onBlur={(e) => e.target.value.trim() !== (d.lost_reason || "") && void edit({ lost_reason: e.target.value.trim() || null })} /></dd>
                  </>
                ) : null}
                <dt>Owner</dt>
                <dd>
                  <div className="c-row">
                    {d.owner_name ? <><Avatar name={d.owner_name} size={20} /><span className="c-ellipsis">{d.owner_name}{d.owner_user_id === me?.id ? " (you)" : ""}</span></> : <span className="c-faint">Nobody</span>}
                    {d.owner_user_id !== me?.id && me ? <Button size="sm" variant="ghost" onClick={() => void edit({ owner_user_id: me.id, owner_name: me.display }, "It's yours now")}>Take it</Button> : null}
                  </div>
                </dd>
                <dt>Came from</dt>
                <dd className="c-muted">{d.source === "spreadsheet" ? "A spreadsheet" : d.source === "person" ? "Added by hand" : d.source === "sample" ? "The sample" : `Kept from ${sourceWord(d.source)}`}</dd>
                <dt>Last activity</dt>
                <dd className="c-muted">{agoText(d.last_activity_at) || "—"}</dd>
              </dl>
            </Card>

            {tasks !== null ? (
              <Card title="Tasks" icon={ListTodo} count={tasks.length}
                action={d.next_step ? <Button size="sm" onClick={() => setTasking(true)}>Make next step a task</Button> : null}>
                {tasks.length === 0 ? (
                  <p className="c-muted">{d.next_step ? "Give the next step to someone on the team, or to the Lemma." : "Write a next step, then hand it to someone or to the Lemma."}</p>
                ) : (
                  <div className="dt-tasks">
                    {tasks.map((t) => (
                      <button key={t.id} type="button" className="dt-task" onClick={() => void openApp("tasks", `/${t.id}`)}>
                        <span className="c-ellipsis">{t.number ? <span className="c-faint num">#{t.number} </span> : null}{t.title}</span>
                        <span className="c-faint dt-task__who">{t.assignee_kind === "agent" ? "The Lemma" : t.assignee_name || "Nobody yet"} · {t.status.replace("_", " ")}</span>
                        <ArrowUpRight size={12} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            ) : null}

            <TeamKnows deal={d} />
          </div>
        </div>
      </main>
      {tasking ? <TaskSheet deal={d} onClose={() => setTasking(false)} onMade={() => void load()} /> : null}
    </>
  );
}

/** Who on the team has talked to the deal's people lately: People map's team view, never what was said. */
function TeamKnows({ deal }: { deal: Deal }) {
  const { warmthOf, me } = useDeals();
  const warm = warmthOf(deal);
  if (!warm) return null;
  return (
    <Card title="The team's last contact" icon={Users}>
      <div className="dt-know">
        <Pill tone={warm.warmth === "warm" || warm.warmth === "new" ? "success" : "warning"}>{warm.warmth === "warm" ? "Warm" : warm.warmth === "new" ? "New" : warm.warmth === "cooling" ? "Cooling" : "Cold"}</Pill>
        <span className="c-muted">{warm.byId && warm.byId === me?.id ? "You" : warm.by || "Someone on the team"}, {agoText(warm.last) || "a while ago"}</span>
      </div>
    </Card>
  );
}

/** The Tasks hook: a deal's next step becomes a team task, for a person or for the Lemma, through the shared `task` table. */
function TaskSheet({ deal, onClose, onMade }: { deal: Deal; onClose: () => void; onMade: () => void }) {
  const { me } = useDeals();
  const toast = useToast();
  const [title, setTitle] = useState(deal.next_step || "");
  const [who, setWho] = useState<"me" | "lemma" | "none">("me");
  const [dueOn, setDueOn] = useState(deal.close_date || "");
  const [busy, setBusy] = useState(false);
  const make = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const records = client.records as unknown as { create: (table: string, data: Record<string, unknown>) => Promise<unknown> };
      await records.create("task", {
        title: title.trim(), status: "todo", priority: "none",
        description: `For the deal **${deal.name}**${deal.company_name ? ` with ${deal.company_name}` : ""}.`,
        due_on: dueOn || null,
        assignee_kind: who === "me" ? "person" : who === "lemma" ? "agent" : "none",
        assignee_user_id: who === "me" ? me?.id || null : null, assignee_name: who === "me" ? me?.display || null : null,
        assignee_agent: who === "lemma" ? "pod_default" : null,
        owner_user_id: me?.id || null, owner_name: me?.display || null,
        source: "deals", source_id: deal.id,
      });
      toast(who === "lemma" ? "Handed to the Lemma. It works on it in Tasks." : "Task made. It's in Tasks.");
      onMade();
      onClose();
    } catch (e) {
      toast(`Couldn't make the task: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open title="Make the next step a task" onClose={onClose}
      footer={<><span className="c-grow" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={ListTodo} busy={busy} onClick={() => void make()}>Make task</Button></>}>
      <label className="c-field"><span>Task</span><input className="c-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></label>
      <fieldset className="dt-who">
        <legend>Who does it</legend>
        {([["me", User, "Me"], ["lemma", Sparkles, "The Lemma: it works on it and reports back"], ["none", Users, "Nobody yet: the team picks it up in Tasks"]] as const).map(([k, Icon, label]) => (
          <label key={k} className="c-choice"><input type="radio" name="who" checked={who === k} onChange={() => setWho(k)} /><Icon size={14} aria-hidden="true" />{label}</label>
        ))}
      </fieldset>
      <label className="c-field"><span>Due</span><input className="c-input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
    </Sheet>
  );
}
