// A lead's page: who they are at work and their company, every fact with the
// page it came from and when it was found; how well the company fits you and
// why; recent news; and beside them where things stand and why it was looked
// up. The person and the company open in People map's apps.

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Building2, CalendarDays, CircleHelp, Clock, ExternalLink, Gauge, Mail, MoreHorizontal, Newspaper, RefreshCw, ScanSearch,
  Sparkles, ThumbsDown, ThumbsUp, Undo2, UserRound, Users,
} from "lucide-react";
import {
  Avatar, Button, Card, Empty, Header, Logo, Markdown, Menu, MenuItem, MenuLabel, Notice, Pill, Rel, Skeleton, Spinner,
  agoText, day, firstName, nameOf, openApp, q, runFunction, sql, useToast, when,
} from "@lemma-plugins/kit";
import { useLeads } from "./data";
import { FactRow, FitMark, KIND_LABEL, KindPill, Source, StatePill, host, notFoundText } from "./marks";
import { to } from "./route";
import type { Fact } from "./types";

interface Company {
  name: string | null;
  domain: string | null;
  description: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  website: string | null;
}
interface PeopleCompany {
  research: string | null;
  research_sources: { title?: string; url: string }[] | null;
  research_state: string | null;
  researched_at: string | null;
}
interface FitRow {
  fit: number | null;
  fit_sure: boolean | null;
  fit_confidence: number | null;
  fit_why: string | null;
  fit_by: string | null;
  fit_by_name: string | null;
  fit_at: string | null;
}
interface Extra {
  company: Company | null;
  pc: PeopleCompany | null;
  fit: FitRow | null;
}

function useExtra(companyId: string | null) {
  const [extra, setExtra] = useState<Extra | null>(null);
  const load = useCallback(async () => {
    if (!companyId) return setExtra({ company: null, pc: null, fit: null });
    const id = sql(companyId);
    const [company, pc, fit] = await Promise.all([
      q<Company>(`select name, domain, description, industry, size, location, website from company where id = ${id}`).catch(() => []),
      q<PeopleCompany>(`select research, research_sources, research_state, researched_at from people_company where id = ${id}`).catch(() => []),
      q<FitRow>(`select fit, fit_sure, fit_confidence, fit_why, fit_by, fit_by_name, fit_at from leads_company where id = ${id}`).catch(() => []),
    ]);
    setExtra({ company: company[0] || null, pc: pc[0] || null, fit: fit[0] || null });
  }, [companyId]);
  return { extra, load };
}

const back = { label: "Leads", icon: ScanSearch, onClick: () => to.list() };

export function LeadPage({ id }: { id: string }) {
  const { byId, loaded, companies, profile: team, reload } = useLeads();
  const toast = useToast();
  const lead = byId.get(id) || null;
  const { extra, load } = useExtra(lead?.company_id || null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    void load();
  }, [load, lead?.fit, lead?.state, lead?.looked_up_at]);

  // While it is being looked up, look again every few seconds.
  const running = !!lead && ["wanted", "looking"].includes(lead.state);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void reload("leads"), 4000);
    return () => window.clearInterval(t);
  }, [running, reload]);

  if (!loaded) return <><Header back={back} /><Skeleton kind="record" /></>;
  if (!lead) {
    return (
      <>
        <Header back={back} />
        <main className="c-body"><Card><Empty icon={UserRound} title="No lead here.">It may have been removed, or it belongs to someone else's Leads.</Empty></Card></main>
      </>
    );
  }

  const act = async (fn: string, input: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const out = await runFunction<{ message: string }>(fn, input);
      toast(out.message);
      await reload("leads");
      await load();
    } catch (e) {
      toast(`Couldn't do that: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  const name = nameOf(lead.name, lead.handle);
  const mine = companies.get(lead.company_id || "");
  const cfacts = (mine?.facts || []).filter((f) => f.key !== "news");
  const news = mine?.news || [];
  const facts = lead.facts || [];
  const role = facts.find((f) => f.key === "role");
  const profile = facts.find((f) => f.key === "profile");
  const other = facts.filter((f) => !["role", "profile"].includes(f.key));
  const meeting = lead.next_meeting_at && new Date(lead.next_meeting_at).getTime() > Date.now() ? lead.next_meeting_at : null;
  const company = extra?.company;
  const companyName = lead.company_name || company?.name || null;
  const sources = new Set([...facts, ...cfacts, ...news].map((f) => f.url)).size;

  return (
    <>
      <Header back={back} title={name}>
        <Menu icon={MoreHorizontal} title="More" align="right" variant="ghost">
          {(close) => (
            <>
              <MenuLabel>Open in People map</MenuLabel>
              <MenuItem icon={Users} onSelect={() => { close(); void openApp("people", `/${lead.id}`); }}>{firstName(lead.name, lead.handle)} in People</MenuItem>
              {lead.company_id ? <MenuItem icon={Building2} onSelect={() => { close(); void openApp("companies", `/${lead.company_id}`); }}>{companyName || "The company"} in Companies</MenuItem> : null}
              <MenuLabel>Lead research</MenuLabel>
              {lead.state === "ready" || lead.state === "failed" ? (
                <MenuItem icon={RefreshCw} onSelect={() => { close(); void act("leads_request", { person_id: lead.id, force: true }, "again"); }}>Look up again</MenuItem>
              ) : null}
              {lead.worth !== false ? (
                <MenuItem icon={ThumbsDown} onSelect={() => { close(); void act("leads_correct", { person_id: lead.id, worth: false }, "worth"); }}>Wasn't worth looking up</MenuItem>
              ) : (
                <MenuItem icon={ThumbsUp} onSelect={() => { close(); void act("leads_correct", { person_id: lead.id, worth: true }, "worth"); }}>Worth looking up</MenuItem>
              )}
              {lead.review !== "new" ? <MenuItem icon={Undo2} onSelect={() => { close(); void act("leads_correct", { person_id: lead.id, review: "new" }, "review"); }}>Back to new</MenuItem> : null}
            </>
          )}
        </Menu>
      </Header>
      <main className="c-body">
        <div className="c-record-head">
          <Avatar name={lead.name} email={lead.handle} size={56} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1>{name}</h1>
            <div className="c-record-head__sub">
              {lead.role ? <span>{lead.role}</span> : <span className="c-faint">{lead.state === "ready" ? "Role not found" : lead.mail_title || ""}</span>}
              {companyName ? (
                <>
                  <span aria-hidden="true">·</span>
                  <button type="button" onClick={() => void openApp("companies", `/${lead.company_id}`)}>{companyName}</button>
                </>
              ) : null}
              {lead.location ? <><span aria-hidden="true">·</span><span>{lead.location}</span></> : null}
            </div>
            <div className="c-record-head__facts">
              {lead.state === "ready" ? <FitPillLarge fit={lead.fit} sure={lead.fit_sure} /> : <StatePill lead={lead} />}
              <KindPill kind={lead.kind} />
              {meeting ? <Pill tone="info" icon={CalendarDays}>Meeting {when(meeting)}</Pill> : null}
              {lead.last_inbound_at ? <Pill icon={Mail}>Wrote {agoText(lead.last_inbound_at)}</Pill> : null}
              {lead.review === "kept" ? <Pill tone="success">Kept</Pill> : lead.review === "passed" ? <Pill>Passed</Pill> : null}
              {lead.sample ? <Pill>Sample</Pill> : null}
            </div>
          </div>
          {lead.state === "ready" ? (
            <div className="c-record-head__actions">
              {lead.review === "new" ? (
                <>
                  <Button variant="primary" icon={ThumbsUp} busy={busy === "kept"} onClick={() => void act("leads_correct", { person_id: lead.id, review: "kept" }, "kept")}>Worth my time</Button>
                  <Button icon={ThumbsDown} busy={busy === "passed"} onClick={() => void act("leads_correct", { person_id: lead.id, review: "passed" }, "passed")}>Not for me</Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {running ? (
          <Notice><Spinner /> Looking {firstName(lead.name, lead.handle)} up: the web first, then how well {companyName || "the company"} fits. About a minute.</Notice>
        ) : null}
        {lead.state === "failed" ? (
          <Notice>The look-up stopped: {lead.lookup_error || "something broke"}. <Button size="sm" busy={busy === "again"} onClick={() => void act("leads_request", { person_id: lead.id, force: true }, "again")}>Try again</Button></Notice>
        ) : null}
        {["skipped", "unsure", "proposed", "queued"].includes(lead.state) ? (
          <Notice>
            {lead.state === "queued" || lead.state === "proposed" ? "In line for a look-up. " : lead.state === "unsure" ? "Not sure it's worth a look-up. " : "Not looked up. "}
            {lead.worth_reason}{" "}
            {lead.state !== "queued" && lead.worth_by !== "rule" ? (
              <Button size="sm" busy={busy === "ask"} onClick={() => void act("leads_request", { person_id: lead.id }, "ask")}>Look up</Button>
            ) : null}
          </Notice>
        ) : null}

        <div className="c-split c-split--record">
          <div className="c-stack">
            {lead.state === "ready" ? (
              <Card title="How well they fit your team" icon={Gauge}
                action={<FitChange current={lead.fit} busy={busy} onPick={(n) => void act("leads_correct", { person_id: lead.id, fit: n }, `fit-${n}`)} />}>
                {lead.fit == null ? (
                  <p className="c-muted">{lead.fit_why || "Not scored: nothing was found about the company to score it on."}</p>
                ) : (
                  <div className="ld-fitcard">
                    <FitMark fit={lead.fit} sure={lead.fit_sure} />
                    <p>{lead.fit_why}</p>
                    {team?.fit_sentence ? <p className="c-faint ld-against">Against your team's “{team.fit_sentence}”{team.fit_examples?.length ? `, like ${team.fit_examples.slice(0, 3).join(", ")}` : ""}.</p> : null}
                    <p className="c-faint ld-by">
                      {extra?.fit?.fit_by === "person" ? `${extra.fit.fit_by_name || "Someone on the team"} set this score for the team${extra.fit.fit_at ? ` on ${day(extra.fit.fit_at)}` : ""}. Other companies like it are scored like it.` : <>
                        <Sparkles size={12} aria-hidden="true" /> Scored from the public facts below
                        {extra?.fit?.fit_confidence != null ? `, ${Math.round(extra.fit.fit_confidence * 100)}% sure` : ""}. Change it for the team and companies like it are scored like it.
                      </>}
                    </p>
                  </div>
                )}
              </Card>
            ) : null}

            <Card title={`${firstName(lead.name, lead.handle)} at work`} icon={UserRound}
              action={profile ? <a className="c-btn c-btn--sm c-btn--ghost" href={profile.value} target="_blank" rel="noreferrer">Profile <ExternalLink size={12} aria-hidden="true" /></a> : undefined}>
              {lead.state !== "ready" ? (
                <p className="c-muted">{running ? "Looking now…" : "Not looked up yet."}</p>
              ) : facts.length === 0 ? (
                <div className="ld-notfound">
                  <CircleHelp size={15} aria-hidden="true" />
                  <p>{lead.summary || `No page confirmed ${name} at ${companyName || "this company"}. Not found is an answer: nothing was guessed.`}</p>
                </div>
              ) : (
                <>
                  {lead.summary ? <p className="ld-summary">{lead.summary}</p> : null}
                  <dl className="ld-facts">
                    {role ? <FactRow fact={role} /> : null}
                    {other.map((f, i) => <FactRow key={`${f.key}-${i}`} fact={f} />)}
                    {profile ? <FactRow fact={profile} value={<a href={profile.value} target="_blank" rel="noreferrer">{host(profile.value)}</a>} /> : null}
                  </dl>
                  {notFoundText((lead.not_found || []).filter((k) => ["role", "location", "profile", "background"].includes(k))) ? (
                    <p className="c-faint ld-nf">{notFoundText((lead.not_found || []).filter((k) => ["role", "location", "profile", "background"].includes(k)))}</p>
                  ) : null}
                </>
              )}
            </Card>

            <Card title={companyName || "Their company"} icon={Building2}
              action={company?.website ? <a className="c-btn c-btn--sm c-btn--ghost" href={company.website} target="_blank" rel="noreferrer">{host(company.website)} <ExternalLink size={12} aria-hidden="true" /></a> : undefined}>
              {cfacts.length ? (
                <dl className="ld-facts">{cfacts.map((f, i) => <FactRow key={`${f.key}-${i}`} fact={f} />)}</dl>
              ) : null}
              <PeopleMapLookUp company={company || null} pc={extra?.pc || null} hasOwn={cfacts.length > 0} />
              {!cfacts.length && !(extra?.pc?.research_state === "ready" && company?.description) && lead.state === "ready" ? (
                <div className="ld-notfound">
                  <CircleHelp size={15} aria-hidden="true" />
                  <p>Nothing on the web confirmed {companyName || "the company"} at {lead.company_domain || "its domain"}.</p>
                </div>
              ) : null}
            </Card>

            {news.length ? (
              <Card title="Recent news" icon={Newspaper} count={news.length} flush>
                <ul className="ld-news">
                  {news.map((n: Fact) => (
                    <li key={n.url}>
                      <span className="ld-news__date num">{n.date || day(n.found_at)}</span>
                      <div className="ld-news__main">
                        <div>{n.value}</div>
                        <Source fact={n} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>

          <aside className="c-stack">
            <Card title="Where you stand" icon={Users}>
              <dl className="c-props">
                <dt><Users /> Relationship</dt><dd>{lead.kind ? KIND_LABEL[lead.kind] || lead.kind : "—"}</dd>
                <dt><Mail /> Address</dt><dd className="c-ellipsis">{lead.handle || "—"}</dd>
                <dt><Clock /> Last contact</dt><dd>{lead.last_contact_at ? <Rel at={lead.last_contact_at} /> : "—"}</dd>
                <dt><CalendarDays /> Next meeting</dt><dd>{meeting ? when(meeting) : "—"}</dd>
              </dl>
              <Button size="sm" variant="ghost" icon={Users} onClick={() => void openApp("people", `/${lead.id}`)}>Open in People</Button>
            </Card>
            <Card title="The look-up" icon={ScanSearch}>
              <dl className="c-props">
                <dt>Why</dt><dd className="ld-wrap">{lead.worth_reason || "—"}{lead.worth_by === "decision" && lead.worth_confidence != null ? <span className="c-faint"> ({Math.round(lead.worth_confidence * 100)}% sure)</span> : null}</dd>
                <dt>When</dt><dd>{lead.looked_up_at ? day(lead.looked_up_at) : "—"}</dd>
                <dt>Took</dt><dd className="num">{lead.lookup_seconds ? `${Math.round(lead.lookup_seconds)} s` : "—"}</dd>
                <dt>Sources</dt><dd className="num">{sources || "None"}</dd>
              </dl>
            </Card>
          </aside>
        </div>
      </main>
    </>
  );
}

function FitPillLarge({ fit, sure }: { fit: number | null; sure: boolean | null }) {
  if (fit == null) return <Pill>Fit not scored</Pill>;
  return <Pill tone={fit >= 4 && sure ? "success" : fit <= 2 ? "plain" : "info"}>Fits {fit} of 5{sure ? "" : ", not sure"}</Pill>;
}

function FitChange({ current, busy, onPick }: { current: number | null; busy: string; onPick: (n: number) => void }) {
  return (
    <Menu label="Change" size="sm" variant="ghost" align="right">
      {(close) => (
        <>
          <MenuLabel>How well do they fit?</MenuLabel>
          {[5, 4, 3, 2, 1].map((n) => (
            <MenuItem key={n} hint={n === current ? "now" : undefined} onSelect={() => { close(); onPick(n); }}>
              {busy === `fit-${n}` ? <Spinner /> : null}{n} · {["", "Not a fit", "Weak", "Partly", "Good", "Strong"][n]}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

/** What People map's company look-up found, with its sources together. */
function PeopleMapLookUp({ company, pc, hasOwn }: { company: Company | null; pc: PeopleCompany | null; hasOwn: boolean }) {
  if (!pc || !company) return null;
  if (pc.research_state === "wanted" || pc.research_state === "writing") {
    return <p className="c-muted ld-pm"><Spinner /> People map is looking the company up…</p>;
  }
  if (pc.research_state !== "ready" || !pc.research) return null;
  const sources = (pc.research_sources || []).filter((s) => s && s.url);
  const facts = [
    company.description ? ["What they do", company.description] : null,
    company.industry ? ["Industry", company.industry] : null,
    company.size ? ["Size", company.size] : null,
    company.location ? ["Head office", company.location] : null,
  ].filter(Boolean) as [string, string][];
  return (
    <div className={hasOwn ? "ld-pm ld-pm--below" : "ld-pm"}>
      <p className="ld-pm__head c-muted">People map's company look-up, {day(pc.researched_at)}</p>
      {facts.length && !hasOwn ? (
        <dl className="c-props ld-pm__props">{facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="ld-wrap">{v}</dd></Fragment>)}</dl>
      ) : null}
      <Markdown text={pc.research} />
      {sources.length ? (
        <p className="ld-pm__sources">
          <span className="c-faint">Its sources: </span>
          {sources.map((s, i) => (
            <span key={s.url}>{i ? ", " : ""}<a href={s.url} target="_blank" rel="noreferrer">{s.title || host(s.url)}</a></span>
          ))}
        </p>
      ) : <p className="c-faint">It listed no sources.</p>}
    </div>
  );
}
