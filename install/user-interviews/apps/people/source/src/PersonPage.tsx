// A person's page: the header with the facts, where things stand (each
// sentence citing the conversation or meeting it came from), what is owed
// both ways, every conversation and meeting newest first, and beside them the
// details, what's remembered about them, and who else on the team knows them.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, Building2, CalendarDays, CircleHelp, Clock, Hash, Hourglass, Mail, MessageSquare, MoreHorizontal,
  Plus, Reply, Sparkles, StickyNote, Trash2, Users, UserX,
} from "lucide-react";
import {
  AskButton, Avatar, Button, Card, Empty, Evidence, Header, Menu, MenuItem, MenuLabel, Notice, Pill, Rel, Skeleton, Spinner, agoText, create, day, due, firstName, nameOf, openApp, plural, q, runFunction, sql, update, useToast, when, errorText,
} from "@lemma-plugins/kit";
import { memberName, usePeople } from "./data";
import { KIND_HINT, KIND_ICON, KIND_LABEL, KindPill, WARMTH, WarmthPill, gapText, lastWords } from "./marks";
import { to } from "./route";
import { SettleRow } from "./Setup";
import { KINDS, type Fact, type Person } from "./types";

interface Conv {
  id: string;
  subject: string | null;
  state: string;
  ask: string | null;
  snippet: string | null;
  last_message_at: string | null;
  last_direction: string | null;
  message_count: number | null;
}
interface Meet {
  id: string;
  title: string | null;
  start_at: string;
  kind: string | null;
  headline: string | null;
  summary: string | null;
}
interface Earlier {
  id: string;
  at: string;
  direction: "inbound" | "outbound" | "meeting";
  label: string | null;
}
interface Loaded {
  person: Person | null;
  handles: string[];
  convs: Conv[];
  meets: Meet[];
  facts: Fact[];
  earlier: Earlier[];
}

function usePerson(id: string) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [person] = await q<Person>(
        "select pp.*, p.name, p.org, p.title, p.is_vip, c.name as company_name, c.domain as company_domain " +
        `from people_person pp join person p on p.id = pp.id left join company c on c.id = pp.company_id where pp.id = ${sql(id)}`);
      if (!person) return setData({ person: null, handles: [], convs: [], meets: [], facts: [], earlier: [] });
      const handles = [...new Set([
        ...(await q<{ handle: string }>(`select handle from person_handle where person_id = ${sql(id)}`)).map((h) => h.handle.toLowerCase()),
        ...(person.handle ? [person.handle] : []),
      ])];
      const list = handles.map(sql).join(", ") || "NULL";
      const contains = handles.map((h) => `attendees::jsonb @> ${sql(JSON.stringify([{ handle: h }]))}`).join(" or ") || "false";
      const [convs, meets, facts, earlier] = await Promise.all([
        q<Conv>("select distinct c.id, c.subject, c.state, c.ask, c.snippet, c.last_message_at, c.last_direction, c.message_count " +
          "from conversation c, jsonb_array_elements_text(coalesce(c.participants, '[]')::jsonb) as h(v) " +
          `where c.kind = 'people' and lower(h.v) in (${list}) order by c.last_message_at desc nulls last limit 60`),
        q<Meet>(`select id, title, start_at, kind, headline, summary from meeting where status <> 'cancelled' and (${contains}) order by start_at desc limit 40`),
        q<Fact>(`select * from people_fact where person_id = ${sql(id)} and state = 'active' order by created_at desc limit 30`),
        q<Earlier>(`select id, at, direction, label from people_sample_contact where person_id = ${sql(id)} order by at desc limit 40`),
      ]);
      setData({ person, handles, convs, meets, facts, earlier });
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);
  return { data, load, error };
}

const back = { label: "People", icon: Users, onClick: () => to.list() };

export function PersonPage({ id }: { id: string }) {
  const all = usePeople();
  const { reload, teamOf, owed, me } = all;
  const toast = useToast();
  const { data, load, error } = usePerson(id);
  const [busy, setBusy] = useState("");
  const [factText, setFactText] = useState("");
  const [lit, setLit] = useState<string | null>(null);

  // Read again when the person's row (or anything joined) changes.
  const row = all.byId.get(id);
  useEffect(() => {
    void load();
  }, [load, row?.last_contact_at, row?.kind, row?.deal_with, row?.unsure, row?.summary_state, row?.company_id]);

  // Ask for "where things stand" when there is none, or it is older than the last contact.
  const p = data?.person || null;
  useEffect(() => {
    if (!p || p.deal_with === false) return;
    const stale = !p.summary || (p.summary_at && p.last_contact_at && p.last_contact_at > p.summary_at);
    const has = (p.conversation_count || 0) + (p.meeting_count || 0) > 0 || (data?.convs.length || 0) + (data?.meets.length || 0) > 0;
    if (!has || !stale || ["wanted", "writing", "failed"].includes(p.summary_state)) return;
    void update("people_person", p.id, { summary_state: "wanted" }).then(load, () => undefined);
  }, [p?.id, p?.summary_at, p?.last_contact_at, p?.summary_state, data?.convs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // While it is being written, look again every few seconds.
  const writing = p?.summary_state === "wanted" || p?.summary_state === "writing";
  useEffect(() => {
    if (!writing) return;
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [writing, load]);

  const correct = async (input: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const out = await runFunction<{ message: string }>("people_correct", input);
      toast(out.message);
      await reload("people");
      await load();
    } catch (e) {
      toast(`Couldn't change that: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };

  const timeline = useMemo(() => {
    if (!data) return [];
    return [
      ...data.convs.map((c) => ({ kind: "conv" as const, at: c.last_message_at || "", c })),
      ...data.meets.map((m) => ({ kind: "meet" as const, at: m.start_at, m })),
      ...data.earlier.map((e) => ({ kind: "earlier" as const, at: e.at, e })),
    ].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  }, [data]);

  if (error) return <><Header back={back} /><main className="c-body"><Notice>Couldn't open this person: {error}</Notice></main></>;
  if (!data) return <><Header back={back} /><Skeleton kind="record" /></>;
  if (!p) {
    return (
      <>
        <Header back={back} />
        <main className="c-body"><Card><Empty icon={Users} title="This person isn't in your People.">They may have been removed, or the link came from someone else's People.</Empty></Card></main>
      </>
    );
  }

  const name = nameOf(p.name, p.handle);
  const first = firstName(p.name, p.handle);
  const promises = owed.get(p.id) || [];
  const youOwe = promises.filter((x) => x.direction === "i_owe");
  const theyOwe = promises.filter((x) => x.direction === "owed_to_me");
  const replies = data.convs.filter((c) => c.state === "needs_reply");
  const openCount = replies.length + youOwe.length + theyOwe.length;
  const sources = new Map((p.summary_sources || []).map((s) => [s.n, s]));
  const parts = (p.summary || "").split(/(\[\d{1,2}\])/g);
  const team = p.handle ? teamOf.get(p.handle) : undefined;
  const others = (team?.members || []).filter((m) => !me || m.id !== me.id);
  const ahead = (m: Meet) => new Date(m.start_at).getTime() > Date.now();

  const jump = (n: number) => {
    const s = sources.get(n);
    if (!s) return;
    const el = document.getElementById(`tl-${s.id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setLit(s.id);
      window.setTimeout(() => setLit(null), 2200);
    }
  };
  const openConv = (cid: string) => void openApp("inbox", `/inbox/${encodeURIComponent(cid)}`).then((ok) => !ok && toast("Open Mail to read it."));
  const openMeet = (mid: string) => void openApp("meetings", `/${encodeURIComponent(mid)}`).then((ok) => !ok && toast("Open Meetings to see it."));
  const addFact = async () => {
    const text = factText.trim();
    if (!text) return;
    setBusy("fact");
    try {
      await create("people_fact", { person_id: p.id, fact: text.slice(0, 300), source_kind: "person", state: "active" });
      setFactText("");
      await load();
    } finally {
      setBusy("");
    }
  };
  const forget = async (f: Fact) => {
    await update("people_fact", f.id, { state: "forgotten" });
    toast("Forgotten.");
    await load();
  };

  return (
    <>
      <Header back={back} title={name}>
        <AskButton text={`What's going on with ${name}${p.company_name ? ` at ${p.company_name}` : ""}, and what should I do next?`} label={`Ask about ${first}`} />
        <Menu icon={MoreHorizontal} title="More" align="right">
          {(close) => (
            <>
              <MenuLabel>What {first} is to you</MenuLabel>
              {KINDS.map((k) => (
                <MenuItem key={k} icon={KIND_ICON[k]} hint={p.kind === k ? "now" : undefined}
                  onSelect={() => { close(); void correct({ person_id: p.id, kind: k }, `k-${k}`); }}>
                  {KIND_LABEL[k]}
                </MenuItem>
              ))}
              <MenuLabel>Not someone you deal with</MenuLabel>
              <MenuItem icon={UserX} onSelect={() => { close(); void correct({ person_id: p.id, deal_with: false }, "rm").then(() => to.list()); }}>
                Remove from People
              </MenuItem>
            </>
          )}
        </Menu>
      </Header>
      <main className="c-body">
        <div className="c-record-head">
          <Avatar name={p.name} email={p.handle} size={56} />
          <div style={{ minWidth: 0 }}>
            <h1>{name}</h1>
            <div className="c-record-head__sub">
              {p.title ? <span>{p.title}</span> : null}
              {p.title && (p.company_name || p.org) ? <span aria-hidden="true">·</span> : null}
              {p.company_id && p.company_name ? (
                <button type="button" onClick={() => void openApp("companies", `/${p.company_id}`)}>{p.company_name}</button>
              ) : p.org ? <span>{p.org}</span> : null}
              {p.handle ? <><span aria-hidden="true">·</span><a href={`mailto:${p.handle}`}>{p.handle}</a></> : null}
            </div>
            <div className="c-record-head__facts">
              <KindPill kind={p.kind} unsure={p.unsure} />
              <WarmthPill warmth={p.warmth} gap={p.usual_gap_days} long />
              {p.last_contact_at ? <Pill icon={Clock}>{lastWords(p, first)}</Pill> : null}
              {p.next_meeting_at ? <Pill tone="info" icon={CalendarDays}>Next: {when(p.next_meeting_at)}</Pill> : null}
              {p.quiet ? <Pill tone="warning">Gone quiet</Pill> : null}
              {p.is_vip ? <Pill>VIP</Pill> : null}
            </div>
          </div>
          <div className="c-record-head__actions">
            {p.handle ? <a className="c-btn" href={`mailto:${p.handle}`}><Mail aria-hidden="true" />Email</a> : null}
          </div>
        </div>

        {p.unsure && p.deal_with !== false ? (
          <Card title="Not sure" icon={CircleHelp} flush>
            <div className="c-list"><SettleRow p={p} busy={busy} onCorrect={correct} /></div>
          </Card>
        ) : null}

        <div className="c-split c-split--record">
          <div className="c-stack">
            <Card title="Where things stand" icon={Sparkles}
              action={writing ? <span className="c-writing"><Spinner /> Writing…</span>
                : p.summary_state === "failed" || p.summary ? (
                  <Button size="sm" variant="ghost" onClick={() => void update("people_person", p.id, { summary_state: "wanted" }).then(load)}>
                    {p.summary_state === "failed" ? "Try again" : "Write again"}
                  </Button>
                ) : null}>
              {p.summary ? (
                <>
                  <p className="c-story">
                    {parts.map((part, i) => {
                      const m = part.match(/^\[(\d{1,2})\]$/);
                      if (!m) return <span key={i}>{part}</span>;
                      const n = Number(m[1]);
                      return (
                        <sup key={i}>
                          <button type="button" onClick={() => jump(n)} title={sources.get(n)?.label || ""} aria-label={`Source ${n}: ${sources.get(n)?.label || ""}`}>{n}</button>
                        </sup>
                      );
                    })}
                  </p>
                  <div className="c-story-meta">
                    <Sparkles aria-hidden="true" />
                    Written from {plural([...sources.values()].filter((s) => s.kind === "conversation").length, "conversation")}
                    {[...sources.values()].some((s) => s.kind === "meeting") ? ` and ${plural([...sources.values()].filter((s) => s.kind === "meeting").length, "meeting")}` : ""} · {agoText(p.summary_at)}
                  </div>
                </>
              ) : p.summary_state === "failed" ? (
                <p className="c-muted">Couldn't write this one{p.summary_error ? `: ${p.summary_error}` : ""}.</p>
              ) : timeline.length === 0 ? (
                <p className="c-muted">Nothing to go on yet: no conversations or meetings with {first}.</p>
              ) : (
                <div className="c-stack" style={{ gap: 8 }} aria-busy="true">
                  <div className="c-skel" style={{ height: 12, width: "92%" }} />
                  <div className="c-skel" style={{ height: 12, width: "84%" }} />
                  <div className="c-skel" style={{ height: 12, width: "60%" }} />
                </div>
              )}
            </Card>

            <Card title="Owed both ways" icon={Hourglass} count={openCount} flush>
              <div className="c-owed">
                <div>
                  <h3><Reply aria-hidden="true" />You owe {first}</h3>
                  {replies.map((c) => (
                    <button key={c.id} type="button" className="c-owed__item pm-owed-link" onClick={() => openConv(c.id)}>
                      <div>{c.ask || `A reply to "${c.subject || "(no subject)"}"`}</div>
                      <div className="c-faint pm-meta">A reply · {agoText(c.last_message_at)}</div>
                    </button>
                  ))}
                  {youOwe.map((x) => (
                    <div key={x.id} className="c-owed__item">
                      <div>{x.text}</div>
                      <div className={due(x.due_at).late ? "pm-meta pm-late" : "pm-meta c-faint"}>{x.due_at ? due(x.due_at).text : "No date"}{x.source === "meeting" ? " · said in a meeting" : ""}</div>
                      {x.quote ? <Evidence quote={x.quote} /> : null}
                    </div>
                  ))}
                  {!replies.length && !youOwe.length ? <p className="c-faint">Nothing.</p> : null}
                </div>
                <div>
                  <h3><ArrowDownLeft aria-hidden="true" />{first} owes you</h3>
                  {theyOwe.map((x) => (
                    <div key={x.id} className="c-owed__item">
                      <div>{x.text}</div>
                      <div className={due(x.due_at).late ? "pm-meta pm-late" : "pm-meta c-faint"}>{x.due_at ? due(x.due_at).text : "No date"}{x.source === "meeting" ? " · said in a meeting" : ""}</div>
                      {x.quote ? <Evidence quote={x.quote} /> : null}
                    </div>
                  ))}
                  {!theyOwe.length ? <p className="c-faint">Nothing.</p> : null}
                </div>
              </div>
            </Card>

            <Card title="Conversations and meetings" icon={MessageSquare} count={timeline.length} flush>
              {timeline.length === 0 ? (
                <div className="c-card__body c-muted">Nothing yet.</div>
              ) : (
                <ul className="c-timeline">
                  {timeline.map((item) =>
                    item.kind === "conv" ? (
                      <li key={item.c.id} id={`tl-${item.c.id}`} className={lit === item.c.id ? "pm-lit" : undefined}>
                        <span className="c-tl-icon">{item.c.last_direction === "outbound" ? <ArrowUpRight aria-hidden="true" /> : <Mail aria-hidden="true" />}</span>
                        <div className="c-tl-main">
                          <button type="button" onClick={() => openConv(item.c.id)} title="Open in Mail">
                            <div className="c-row pm-tl-title">
                              <span className="c-ellipsis">{item.c.subject || "(no subject)"}</span>
                              {item.c.state === "needs_reply" ? <Pill tone="warning">Needs your reply</Pill> : item.c.state === "waiting" ? <Pill>Waiting on {first}</Pill> : null}
                            </div>
                            <div className="c-faint pm-tl-sub">{item.c.ask || (item.c.last_direction === "outbound" ? "You wrote last" : `${first} wrote last`)}{item.c.message_count ? ` · ${plural(item.c.message_count, "message")}` : ""}</div>
                          </button>
                        </div>
                        <span className="c-tl-when">{day(item.at)}</span>
                      </li>
                    ) : item.kind === "earlier" ? (
                      <li key={item.e.id}>
                        <span className="c-tl-icon">{item.e.direction === "meeting" ? <CalendarDays aria-hidden="true" /> : item.e.direction === "outbound" ? <ArrowUpRight aria-hidden="true" /> : <Mail aria-hidden="true" />}</span>
                        <div className="c-tl-main">
                          <div className="c-row pm-tl-title"><span className="c-ellipsis">{item.e.label || "Contact"}</span><Pill>Sample</Pill></div>
                          <div className="c-faint pm-tl-sub">{item.e.direction === "meeting" ? "You met" : item.e.direction === "outbound" ? "You wrote" : `${first} wrote`} · made-up earlier contact</div>
                        </div>
                        <span className="c-tl-when">{day(item.at)}</span>
                      </li>
                    ) : (
                      <li key={item.m.id} id={`tl-${item.m.id}`} className={lit === item.m.id ? "pm-lit" : undefined}>
                        <span className="c-tl-icon"><CalendarDays aria-hidden="true" /></span>
                        <div className="c-tl-main">
                          <button type="button" onClick={() => openMeet(item.m.id)} title="Open in Meetings">
                            <div className="c-row pm-tl-title">
                              <span className="c-ellipsis">{item.m.title || "Meeting"}</span>
                              {ahead(item.m) ? <Pill tone="info">Ahead</Pill> : null}
                            </div>
                            <div className="c-faint pm-tl-sub">{item.m.summary || item.m.headline || when(item.m.start_at)}</div>
                          </button>
                        </div>
                        <span className="c-tl-when">{day(item.at)}</span>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </Card>
          </div>

          <div className="c-stack">
            <Card title="Details" icon={Hash}>
              <dl className="c-props">
                <dt><Mail aria-hidden="true" />{data.handles.length > 1 ? "Addresses" : "Address"}</dt>
                <dd>{data.handles.map((h) => <div key={h} className="c-ellipsis"><a href={`mailto:${h}`}>{h}</a></div>)}</dd>
                <dt><Building2 aria-hidden="true" />Company</dt>
                <dd>{p.company_id && p.company_name ? <button type="button" className="pm-link" onClick={() => void openApp("companies", `/${p.company_id}`)}>{p.company_name}</button> : p.org || "Personal address"}</dd>
                <dt><Users aria-hidden="true" />Relationship</dt>
                <dd title={p.kind ? KIND_HINT[p.kind] : undefined}>{p.kind ? KIND_LABEL[p.kind] : "Not sure"}{p.sorted_by === "person" ? " · you said" : ""}</dd>
                <dt><Clock aria-hidden="true" />First contact</dt>
                <dd className="num">{day(p.first_contact_at) || "—"}</dd>
                <dt><Clock aria-hidden="true" />Usually</dt>
                <dd>{p.usual_gap_days ? `in touch ${gapText(p.usual_gap_days)}` : "Not enough history yet"}</dd>
                <dt><MessageSquare aria-hidden="true" />Counted</dt>
                <dd className="num">{plural(p.conversation_count || 0, "conversation")} · {plural(p.meeting_count || 0, "meeting")}</dd>
              </dl>
            </Card>

            <Card title="Remembered" icon={StickyNote} count={data.facts.length} flush>
              <div className="c-list">
                {data.facts.map((f) => (
                  <div key={f.id} className="c-li pm-fact">
                    <div className="c-li__main">
                      <div>{f.fact}</div>
                      <div className="c-li__sub c-ellipsis">{f.source_kind === "person" ? "You added this" : `From ${f.source_kind === "meeting" ? "the meeting" : ""} "${f.source_label || ""}"`}</div>
                    </div>
                    <Button size="sm" variant="ghost" icon={Trash2} label="Forget" onClick={() => void forget(f)} />
                  </div>
                ))}
                {data.facts.length === 0 ? <div className="c-li c-muted">Durable things about {first} (role, where they are, how they like to meet) collect here as it reads your conversations.</div> : null}
                <form className="c-li" onSubmit={(e) => { e.preventDefault(); void addFact(); }}>
                  <input className="c-input c-grow" value={factText} onChange={(e) => setFactText(e.target.value)} placeholder={`Something to remember about ${first}`} aria-label="Add a fact" />
                  <Button size="sm" icon={Plus} type="submit" busy={busy === "fact"} label="Add" />
                </form>
              </div>
            </Card>

            <Card title="Your team" icon={Users} count={others.length} flush>
              {others.length === 0 ? (
                <div className="c-card__body c-muted">Nobody else in this Lemma deals with {first}.</div>
              ) : (
                <div className="c-list">
                  {others.map((m) => (
                    <div key={m.id} className="c-li">
                      <Avatar name={memberName(m.id, me, m.name)} email={m.id} size={24} />
                      <div className="c-li__main">
                        <div className="c-ellipsis">{memberName(m.id, me, m.name)}</div>
                        <div className="c-li__sub">{m.last_contact_at ? <>Last in touch <Rel at={m.last_contact_at} /></> : "No contact yet"}</div>
                      </div>
                      {m.warmth ? <Pill tone={WARMTH[m.warmth].tone}>{WARMTH[m.warmth].label}</Pill> : null}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}

/** Someone only others on the team know: what they share, never what was said. */
export function TeamPersonPage({ handle }: { handle: string }) {
  const { teamOf, companies, everyone, personOf, me, reload } = usePeople();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const t = teamOf.get(handle);
  const mineId = personOf.get(handle);
  const mine = mineId ? everyone.find((p) => p.id === mineId) : undefined;
  const backTeam = { label: "Team", icon: Users, onClick: () => to.team() };
  if (!t) {
    return (
      <>
        <Header back={backTeam} />
        <main className="c-body"><Card><Empty icon={Users} title="Nobody on the team shares this person now." /></Card></main>
      </>
    );
  }
  const name = nameOf(t.name, t.handle);
  const company = companies.get(t.company_id || "");
  const add = async () => {
    setBusy(true);
    try {
      const out = await runFunction<{ message: string; person_id?: string }>("people_correct", { handle: t.handle, name: t.name, deal_with: true });
      toast(out.message);
      await reload("people");
      if (out.person_id) to.person(out.person_id);
    } catch (e) {
      toast(`Couldn't add them: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Header back={backTeam} title={name} />
      <main className="c-body">
        <div className="c-record-head">
          <Avatar name={t.name} email={t.handle} size={56} />
          <div style={{ minWidth: 0 }}>
            <h1>{name}</h1>
            <div className="c-record-head__sub">
              {t.title ? <span>{t.title}</span> : null}
              {t.title && company ? <span aria-hidden="true">·</span> : null}
              {company ? <button type="button" onClick={() => void openApp("companies", `/${company.id}`)}>{company.name}</button> : null}
              <span aria-hidden="true">·</span>
              <span>{t.handle}</span>
            </div>
            <div className="c-record-head__facts">
              <WarmthPill warmth={t.warmth} />
              {t.last_contact_at ? <Pill icon={Clock}>Team's last contact {agoText(t.last_contact_at)}</Pill> : null}
            </div>
          </div>
          <div className="c-record-head__actions">
            {!mine || mine.deal_with !== true ? <Button icon={Plus} busy={busy} onClick={() => void add()}>Add to your people</Button> : null}
          </div>
        </div>
        <div className="c-split c-split--record">
          <Card title="Who on your team knows them" icon={Users} count={t.members.length} flush>
            <div className="c-list">
              {t.members.map((m) => (
                <div key={m.id} className="c-li">
                  <Avatar name={memberName(m.id, me, m.name)} email={m.id} size={26} you={!!me && m.id === me.id} />
                  <div className="c-li__main">
                    <div>{memberName(m.id, me, m.name)}</div>
                    <div className="c-li__sub">{m.last_contact_at ? <>Last in touch <Rel at={m.last_contact_at} /></> : "No contact yet"}</div>
                  </div>
                  {m.warmth ? <Pill tone={WARMTH[m.warmth].tone}>{WARMTH[m.warmth].label}</Pill> : null}
                </div>
              ))}
            </div>
          </Card>
          <Card title="What's shared" icon={UserX}>
            <p className="c-muted">
              The team sees who someone deals with, their company, the last contact and how warm it is. What was said stays
              with whoever said it: ask {t.members.map((m) => memberName(m.id, me, m.name)).filter((n) => n !== "You").join(" or ") || "them"}.
            </p>
          </Card>
        </div>
      </main>
    </>
  );
}
