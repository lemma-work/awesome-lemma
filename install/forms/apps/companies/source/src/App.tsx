// Companies: one per company the team deals with, found by any of its email
// domains, and a page for each: what they do (looked up on request), the
// people there (yours, and who else on the team knows whom), your
// conversations and meetings with them, and the team's notes.
//
// Companies are team-wide; your conversations and meetings stay yours. A
// person opens in People and People opens a company here (the SDK's apps.open).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight, Building2, CalendarDays, Globe, Mail, MapPin, MessageSquare, MoreHorizontal, NotebookPen, RefreshCw, Search, Sparkles,
  Users,
} from "lucide-react";
import {
  AskButton, Avatar, Banner, Button, Card, Empty, Field, Header, Logo, Markdown, Menu, MenuItem, Notice, Pill, Rel, SearchField, Segmented, Sheet, Skeleton, Spinner, Toolbar, agoText, create, day, go, nameOf, openApp, plural, q, runFunction, sql, update, useRecordId, useToast, when, errorText,
} from "@lemma-plugins/kit";
import { CompaniesProvider, memberName, useCompanies, type Facts, type Link, type Mine } from "./data";

const KIND_WORD: Record<string, [string, string]> = {
  customer: ["customer", "customers"], investor: ["investor", "investors"], partner: ["partner", "partners"],
  candidate: ["candidate", "candidates"], vendor: ["vendor", "vendors"], other: ["other", "others"],
};
const WARMTH: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" }> = {
  warm: { label: "Warm", tone: "success" }, cooling: { label: "Cooling", tone: "warning" }, cold: { label: "Cold", tone: "danger" },
  new: { label: "New", tone: "info" },
};

export default function App() {
  return (
    <CompaniesProvider>
      <Router />
    </CompaniesProvider>
  );
}

function Router() {
  const id = useRecordId();
  const { settings, loaded } = useCompanies();
  const notSetUp = loaded && (!settings || settings.setup_step !== "done");
  return (
    <div className="c-app">
      {notSetUp ? (
        <div className="co-strip">
          <Banner action={<Button size="sm" onClick={() => void openApp("people", "/")}>Open People</Button>}>
            <b>Your People map isn't set up.</b> Your own people and conversations show here once it is; the team's companies show now.
          </Banner>
        </div>
      ) : null}
      {id && id !== "team" ? <CompanyPage id={id} /> : <CompanyList team={id === "team"} />}
    </div>
  );
}

function kindsLine(mine: Mine[]): string {
  const n: Record<string, number> = {};
  for (const m of mine) if (m.kind) n[m.kind] = (n[m.kind] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${c} ${KIND_WORD[k]?.[c === 1 ? 0 : 1] || k}`).join(", ");
}

function CompanyList({ team }: { team: boolean }) {
  const { loaded, facts, errors } = useCompanies();
  const [text, setText] = useState("");
  const needle = text.trim().toLowerCase();
  const all = [...facts.values()];
  const mineCount = all.filter((f) => f.mine.length).length;
  const shown = all
    .filter((f) => (team || f.mine.length) && (!needle || `${f.company.name} ${f.domains.join(" ")} ${f.company.description || ""}`.toLowerCase().includes(needle)))
    .sort((a, b) => ((team ? b.last : b.lastMine) || "").localeCompare((team ? a.last : a.lastMine) || ""));
  return (
    <>
      <Header icon={Building2} title="Companies" count={loaded ? shown.length : undefined}>
        <AskButton text="Which companies am I spending the most time with, and which have gone quiet?" />
      </Header>
      <Toolbar>
        <Segmented<"mine" | "team"> label="Whose" value={team ? "team" : "mine"} onChange={(v) => go(v === "team" ? "/team" : "/")}
          items={[{ id: "mine", label: "Yours", count: mineCount }, { id: "team", label: "Team", count: all.length }]} />
        <span className="c-muted co-hide-xs">{team ? "Every company anyone in this Lemma deals with." : "Companies of the people you deal with, newest contact first."}</span>
        <span className="c-grow" />
        <SearchField value={text} onChange={setText} placeholder="Search companies" />
      </Toolbar>
      <main className="c-body">
        {!loaded ? (
          <Skeleton rows={7} />
        ) : errors.companies ? (
          <Notice>Couldn't read companies: {errors.companies}</Notice>
        ) : shown.length === 0 ? (
          <Card>
            <Empty icon={Building2} title={all.length ? "No company matches." : "No companies yet."}>
              {all.length ? "Clear the search, or look at the team's." : "A company appears once someone you deal with writes from its domain. Free webmail never makes one."}
            </Empty>
          </Card>
        ) : (
          <div className="c-table-wrap">
            <table className="c-table co-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>People</th>
                  <th className="c-hide-sm">{team ? "Who on the team" : "Relationship"}</th>
                  <th className="co-hide-xs">Last contact</th>
                  <th className="c-hide-sm">What they do</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((f) => <Row key={f.company.id} f={f} team={team} />)}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

function Row({ f, team }: { f: Facts; team: boolean }) {
  const { me } = useCompanies();
  const c = f.company;
  const faces = team
    ? f.handles.map((h) => ({ key: h, name: f.team.find((l) => l.handle === h)?.name || f.mine.find((m) => m.handle === h)?.name, email: h }))
    : f.mine.map((m) => ({ key: m.id, name: m.name, email: m.handle }));
  const members = [...new Set(f.team.map((l) => memberName(l.member_id, me, l.member_name)))];
  const open = () => go(`/${c.id}`);
  return (
    <tr onClick={open} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open()}>
      <td>
        <div className="c-cell">
          <Logo name={c.name} domain={c.domain} />
          <div style={{ minWidth: 0 }}>
            <div className="c-ellipsis co-name">{c.name}</div>
            <div className="c-cell__sub c-ellipsis">{f.domains.join(", ")}</div>
          </div>
        </div>
      </td>
      <td>
        <div className="c-row">
          <span className="c-stack-av">{faces.slice(0, 3).map((x) => <Avatar key={x.key} name={x.name} email={x.email} size={22} />)}</span>
          <span className="c-faint num">{faces.length}</span>
        </div>
      </td>
      <td className="c-hide-sm c-muted">{team ? <span className="c-ellipsis co-who">{members.join(", ") || "—"}</span> : kindsLine(f.mine) || "—"}</td>
      <td className="co-hide-xs c-muted"><Rel at={team ? f.last : f.lastMine} /></td>
      <td className="c-hide-sm c-muted co-what"><div className="c-ellipsis">{c.description || ""}</div></td>
    </tr>
  );
}

interface Conv { id: string; subject: string | null; state: string; last_message_at: string | null; last_direction: string | null; counterpart_handle: string | null; counterpart_name: string | null }
interface Meet { id: string; title: string | null; start_at: string; kind: string | null; headline: string | null; summary: string | null; attendees: { handle?: string; name?: string; outside?: boolean }[] | null }
interface Held { research: string | null; research_sources: { title: string | null; url: string }[] | null; research_state: string; researched_at: string | null; research_error: string | null; notes: string | null; notes_by: string | null; notes_at: string | null }

function useCompany(id: string, domains: string[]) {
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [meets, setMeets] = useState<Meet[]>([]);
  const [held, setHeld] = useState<Held | null>(null);
  const key = domains.join(",");
  const load = useCallback(async () => {
    const [h] = await q<Held>(`select * from people_company where id = ${sql(id)}`);
    setHeld(h || null);
    if (!key) {
      setConvs([]);
      return;
    }
    const ds = key.split(",");
    const like = ds.map((d) => `lower(counterpart_handle) like ${sql("%@" + d)}`).join(" or ");
    const [cs, ms] = await Promise.all([
      q<Conv>(`select id, subject, state, last_message_at, last_direction, counterpart_handle, counterpart_name from conversation where kind = 'people' and (${like}) order by last_message_at desc nulls last limit 60`),
      q<Meet>("select id, title, start_at, kind, headline, summary, attendees from meeting where status <> 'cancelled' and outside is true order by start_at desc limit 400"),
    ]);
    setConvs(cs);
    setMeets(ms.filter((m) => (m.attendees || []).some((a) => ds.some((d) => (a.handle || "").toLowerCase().endsWith("@" + d)))).slice(0, 30));
  }, [id, key]);
  return { convs, meets, held, load };
}

function CompanyPage({ id }: { id: string }) {
  const { loaded, facts, companies, domains: allDomains, me, settings, reload } = useCompanies();
  const toast = useToast();
  const f = facts.get(id);
  const company = f?.company || companies.find((c) => c.id === id);
  const domains = f?.domains || allDomains.get(id) || [];
  const { convs, meets, held, load } = useCompany(id, domains);
  const [notes, setNotes] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"" | "rename" | "merge" | "split">("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    void load();
  }, [load, company?.research_state, company?.name]);
  const looking = held?.research_state === "wanted" || held?.research_state === "writing";
  useEffect(() => {
    if (!looking) return;
    const t = window.setInterval(() => void load().then(() => reload("companies")), 4000);
    return () => window.clearInterval(t);
  }, [looking, load, reload]);

  const back = { label: "Companies", icon: Building2, onClick: () => go("/") };
  if (!loaded) return <><Header back={back} /><Skeleton kind="record" /></>;
  if (!company) {
    return (
      <>
        <Header back={back} />
        <main className="c-body"><Card><Empty icon={Building2} title="This company isn't here any more.">It may have been merged into another.</Empty></Card></main>
      </>
    );
  }
  const c = company;
  const mine = f?.mine || [];
  const team = (f?.team || []).filter((l) => !me || l.member_id !== me.id);
  const teamOnly = groupTeam(team.filter((l) => !mine.some((m) => (m.handle || "").toLowerCase() === l.handle.toLowerCase())));
  const teamKnows = new Set(team.map((l) => l.handle.toLowerCase())).size;
  const lookUp = async () => {
    setBusy("look");
    try {
      if (held) await update("people_company", c.id, { research_state: "wanted", research_error: null });
      else await create("people_company", { id: c.id, research_state: "wanted" });
      toast(`Looking up ${c.name}…`);
      await load();
    } catch (e) {
      toast(`Couldn't start the look-up: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const saveNotes = async () => {
    if (notes == null) return;
    setBusy("notes");
    try {
      const by = settings?.display_name || me?.name || me?.email || null;
      const row = { notes, notes_by: by, notes_at: new Date().toISOString() };
      if (held) await update("people_company", c.id, row);
      else await create("people_company", { id: c.id, ...row });
      setNotes(null);
      toast("Notes saved for the team.");
      await load();
    } finally {
      setBusy("");
    }
  };
  const timeline = [
    ...(convs || []).map((x) => ({ kind: "conv" as const, at: x.last_message_at || "", x })),
    ...meets.map((m) => ({ kind: "meet" as const, at: m.start_at, m })),
  ].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const website = c.website || (c.domain ? `https://${c.domain}` : undefined);

  return (
    <>
      <Header back={back} title={c.name}>
        <AskButton text={`Where do things stand with ${c.name}?`} />
        <Menu icon={MoreHorizontal} title="More" align="right">
          {(close) => (
            <>
              <MenuItem onSelect={() => { close(); setSheet("rename"); }}>Rename</MenuItem>
              <MenuItem onSelect={() => { close(); setSheet("merge"); }}>Merge into another company</MenuItem>
              {domains.length > 1 ? <MenuItem onSelect={() => { close(); setSheet("split"); }}>Move a domain out</MenuItem> : null}
            </>
          )}
        </Menu>
      </Header>
      <main className="c-body">
        <div className="c-record-head">
          <Logo name={c.name} domain={c.domain} size={56} />
          <div style={{ minWidth: 0 }}>
            <h1>{c.name}</h1>
            <div className="c-record-head__sub">
              {domains.map((d, i) => (
                <span key={d}>{i ? <span aria-hidden="true">· </span> : null}<a href={i === 0 && website ? website : `https://${d}`} target="_blank" rel="noreferrer">{d}</a></span>
              ))}
              {c.description ? <><span aria-hidden="true">·</span><span>{c.description}</span></> : null}
            </div>
            <div className="c-record-head__facts">
              {c.industry ? <Pill dot={false}>{c.industry}</Pill> : null}
              {c.size ? <Pill icon={Users}>{c.size} people</Pill> : null}
              {c.location ? <Pill icon={MapPin}>{c.location}</Pill> : null}
              <Pill icon={Users}>{mine.length ? plural(mine.length, "person you know", "people you know") : "Nobody you know"}</Pill>
              {teamKnows ? <Pill>{plural(teamKnows, "person", "people")} the team knows</Pill> : null}
              {f?.last ? <Pill icon={MessageSquare}>Last contact {agoText(f.last)}</Pill> : null}
            </div>
          </div>
          <div className="c-record-head__actions">
            {!looking ? (
              <Button variant={held?.research ? "default" : "primary"} icon={held?.research ? RefreshCw : Search} busy={busy === "look"} onClick={() => void lookUp()}>
                {held?.research ? "Look again" : "Look them up"}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="c-split c-split--record">
          <div className="c-stack">
            <Card title="What they do" icon={Globe} action={looking ? <span className="c-writing"><Spinner /> Looking them up…</span> : null}>
              {held?.research ? (
                <>
                  <Markdown text={held.research} />
                  <div className="c-story-meta co-sources">
                    <Sparkles aria-hidden="true" />Looked up {agoText(held.researched_at)}
                    {(held.research_sources || []).map((s, i) => {
                      let host = s.url;
                      try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* keep the url */ }
                      return <a key={i} href={s.url} target="_blank" rel="noreferrer">{s.title || host}</a>;
                    })}
                  </div>
                </>
              ) : looking ? (
                <div className="c-stack" style={{ gap: 8 }} aria-busy="true">
                  <div className="c-skel" style={{ height: 12, width: "90%" }} />
                  <div className="c-skel" style={{ height: 12, width: "76%" }} />
                  <div className="c-skel" style={{ height: 12, width: "52%" }} />
                </div>
              ) : held?.research_state === "failed" ? (
                <p className="c-muted">Couldn't look them up{held.research_error ? `: ${held.research_error}` : ""}. Try again.</p>
              ) : (
                <p className="c-muted">Not looked up yet. One web search when you ask, kept here with its sources for the whole team.</p>
              )}
            </Card>

            <Card title="Your conversations and meetings" icon={MessageSquare} count={timeline.length} flush>
              {convs === null ? (
                <div className="c-card__body"><div className="c-skel" style={{ height: 12, width: "70%" }} /></div>
              ) : timeline.length === 0 ? (
                <div className="c-card__body c-muted">Nothing of yours with anyone at {domains.join(" or ") || c.name}.</div>
              ) : (
                <ul className="c-timeline">
                  {timeline.map((item) => item.kind === "conv" ? (
                    <li key={item.x.id}>
                      <span className="c-tl-icon">{item.x.last_direction === "outbound" ? <ArrowUpRight aria-hidden="true" /> : <Mail aria-hidden="true" />}</span>
                      <div className="c-tl-main">
                        <button type="button" onClick={() => void openApp("inbox", `/inbox/${encodeURIComponent(item.x.id)}`)} title="Open in Mail">
                          <div className="c-row co-tl-title">
                            <span className="c-ellipsis">{item.x.subject || "(no subject)"}</span>
                            {item.x.state === "needs_reply" ? <Pill tone="warning">Needs your reply</Pill> : null}
                          </div>
                          <div className="c-faint co-tl-sub">{nameOf(item.x.counterpart_name, item.x.counterpart_handle)}</div>
                        </button>
                      </div>
                      <span className="c-tl-when">{day(item.at)}</span>
                    </li>
                  ) : (
                    <li key={item.m.id}>
                      <span className="c-tl-icon"><CalendarDays aria-hidden="true" /></span>
                      <div className="c-tl-main">
                        <button type="button" onClick={() => void openApp("meetings", `/${encodeURIComponent(item.m.id)}`)} title="Open in Meetings">
                          <div className="c-row co-tl-title">
                            <span className="c-ellipsis">{item.m.title || "Meeting"}</span>
                            {new Date(item.m.start_at).getTime() > Date.now() ? <Pill tone="info">{when(item.m.start_at)}</Pill> : null}
                          </div>
                          <div className="c-faint co-tl-sub">{item.m.summary || item.m.headline || (item.m.attendees || []).filter((a) => a.outside).map((a) => nameOf(a.name, a.handle)).join(", ")}</div>
                        </button>
                      </div>
                      <span className="c-tl-when">{day(item.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="c-stack">
            <Card title="People" icon={Users} count={mine.length + teamOnly.length} flush>
              {mine.length + teamOnly.length === 0 ? (
                <div className="c-card__body c-muted">Nobody here any more.</div>
              ) : (
                <div className="c-list">
                  {mine.map((m) => (
                    <div key={m.id} className="c-li c-li--link" role="link" tabIndex={0}
                      onClick={() => void openApp("people", `/${m.id}`)} onKeyDown={(e) => e.key === "Enter" && void openApp("people", `/${m.id}`)}>
                      <Avatar name={m.name} email={m.handle} size={26} />
                      <div className="c-li__main">
                        <div className="c-ellipsis">{nameOf(m.name, m.handle)}</div>
                        <div className="c-li__sub c-ellipsis">{m.title || m.handle}</div>
                      </div>
                      {m.warmth ? <Pill tone={WARMTH[m.warmth].tone}>{WARMTH[m.warmth].label}</Pill> : null}
                    </div>
                  ))}
                  {teamOnly.map((t) => (
                    <div key={t.handle} className="c-li c-li--link" role="link" tabIndex={0}
                      onClick={() => void openApp("people", `/team/${encodeURIComponent(t.handle)}`)} onKeyDown={(e) => e.key === "Enter" && void openApp("people", `/team/${encodeURIComponent(t.handle)}`)}>
                      <Avatar name={t.name} email={t.handle} size={26} />
                      <div className="c-li__main">
                        <div className="c-ellipsis">{nameOf(t.name, t.handle)}</div>
                        <div className="c-li__sub c-ellipsis">Known to {t.members.map((l) => memberName(l.member_id, me, l.member_name)).join(", ")}{t.last ? ` · ${agoText(t.last)}` : ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Notes" icon={NotebookPen}
              action={notes != null && notes !== (held?.notes || "") ? <Button size="sm" variant="primary" busy={busy === "notes"} onClick={() => void saveNotes()}>Save</Button> : null}>
              <textarea className="c-textarea co-notes" value={notes ?? held?.notes ?? ""} placeholder={`Anything the team should know about ${c.name}.`}
                onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
              <p className="c-faint co-notes-by">{held?.notes_at ? `Last saved by ${held.notes_by || "someone on the team"} ${agoText(held.notes_at)}. The whole team sees these.` : "The whole team sees these."}</p>
            </Card>
          </div>
        </div>
      </main>
      <EditSheet kind={sheet} company={c} domains={domains} onClose={() => setSheet("")} />
    </>
  );
}

function groupTeam(rows: Link[]) {
  const by = new Map<string, { handle: string; name: string | null; last: string | null; members: Link[] }>();
  for (const l of rows) {
    const k = l.handle.toLowerCase();
    const g = by.get(k) || { handle: k, name: l.name, last: null, members: [] };
    g.members.push(l);
    if (l.last_contact_at && (!g.last || l.last_contact_at > g.last)) g.last = l.last_contact_at;
    by.set(k, g);
  }
  return [...by.values()];
}

function EditSheet({ kind, company, domains, onClose }: { kind: "" | "rename" | "merge" | "split"; company: { id: string; name: string }; domains: string[]; onClose: () => void }) {
  const { companies, reload } = useCompanies();
  const toast = useToast();
  const [name, setName] = useState(company.name);
  const [into, setInto] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const others = useMemo(() => companies.filter((c) => c.id !== company.id).sort((a, b) => a.name.localeCompare(b.name)), [companies, company.id]);
  const last = domains[domains.length - 1] || "";
  useEffect(() => {
    setName(company.name);
    setInto("");
    setDomain(last);
  }, [kind, company.name, last]);
  const run = async (input: Record<string, unknown>) => {
    setBusy(true);
    try {
      const out = await runFunction<{ ok: boolean; message: string; company_id?: string }>("people_company_edit", { company_id: company.id, ...input });
      toast(out.message);
      if (out.ok) {
        await reload();
        onClose();
        if (out.company_id && out.company_id !== company.id && input.action === "merge") go(`/${out.company_id}`);
      }
    } catch (e) {
      toast(`Couldn't do that: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const title = kind === "rename" ? "Rename" : kind === "merge" ? `Merge ${company.name} into…` : "Move a domain out";
  return (
    <Sheet open={!!kind} title={title} onClose={onClose}
      footer={<>
        <span className="c-grow" />
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {kind === "rename" ? <Button variant="primary" busy={busy} onClick={() => void run({ action: "rename", name })}>Rename</Button> : null}
        {kind === "merge" ? <Button variant="primary" busy={busy} disabled={!into} onClick={() => void run({ action: "merge", into_id: into })}>Merge</Button> : null}
        {kind === "split" ? <Button variant="primary" busy={busy} disabled={!domain} onClick={() => void run({ action: "split", domain })}>Move it out</Button> : null}
      </>}>
      {kind === "rename" ? (
        <Field label="Name" hint="For the whole team. A look-up won't replace a name you typed.">
          <input className="c-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      ) : kind === "merge" ? (
        <>
          <p className="c-muted co-sheet-lead">{domains.join(", ")} will belong to the company you pick, with its people and notes, and {company.name} goes. For everyone in this Lemma.</p>
          <Field label="Merge into">
            <select className="c-input" value={into} onChange={(e) => setInto(e.target.value)}>
              <option value="">Pick a company</option>
              {others.map((c) => <option key={c.id} value={c.id}>{c.name}{c.domain ? ` (${c.domain})` : ""}</option>)}
            </select>
          </Field>
        </>
      ) : kind === "split" ? (
        <>
          <p className="c-muted co-sheet-lead">The domain becomes a company of its own, with the people who write from it.</p>
          <Field label="Domain">
            <select className="c-input" value={domain} onChange={(e) => setDomain(e.target.value)}>
              {domains.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
        </>
      ) : null}
    </Sheet>
  );
}
