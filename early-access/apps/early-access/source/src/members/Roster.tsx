// The roster (the app's home): one beta's everyone, what they tried and what
// they said, sorted by what needs the person. A drawer per person (/p/<id>).

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FlaskConical, Link2, Settings2, Sparkles } from "lucide-react";
import {
  Avatar, Button, DEMO, Menu, MenuItem, MenuLabel, Pill, SearchField, Segmented, ago, day, plural, useToast,
} from "@lemma-plugins/kit";
import { openDraft, useEA, type Beta, type Draft, type Status, type Tester } from "./data";
import { FitPill, ProofPill, StatusPill, sourceOf } from "./marks";
import { to } from "./route";
import { checkEmails } from "./wire";
import { Person } from "./Person";

type Filter = "all" | "waiting" | "invited" | "active" | "quiet" | "left";
const IN_FILTER: Record<Filter, Status[]> = {
  all: ["waiting", "picked", "invited", "active", "quiet", "left", "not_now"],
  waiting: ["waiting"],
  invited: ["picked", "invited"],
  active: ["active"],
  quiet: ["quiet"],
  left: ["left", "not_now"],
};
const FIT_ORDER = { strong: 0, maybe: 1, not_now: 3 } as const;

export interface Next { text: string; tone: "ai" | "plain" | "info" | "faint"; rank: number }

/** What comes next for a person, in a few words, and how urgent it is for the sort. */
export function nextFor(t: Tester, drafts: Draft[], inNext: Set<string>): Next {
  const d = openDraft(t, drafts);
  if (d?.built_from?.kind === "chase") return { text: "Note drafted", tone: "ai", rank: 0 };
  if (d?.built_from?.kind === "checkin") return { text: "Check-in drafted", tone: "ai", rank: 1 };
  if (t.status === "picked") return { text: d ? "Invite to send" : "Invite being written", tone: d ? "ai" : "plain", rank: 2 };
  if (d?.built_from?.kind === "not_now") return { text: "Note drafted", tone: "ai", rank: 3 };
  if (t.flag_state === "by_hand" && ["invited", "active", "quiet"].includes(t.status)) return { text: "Tick the flag on", tone: "info", rank: 4 };
  if (t.status === "waiting" && inNext.has(t.id)) return { text: "In next batch", tone: "ai", rank: 5 };
  if (t.status === "invited") return { text: `Invite sent ${ago(t.invited_at)}`, tone: "plain", rank: 6 };
  if (t.status === "waiting" && t.fit === "not_now") return { text: "Not now", tone: "plain", rank: 9 };
  return { text: "—", tone: "faint", rank: 8 };
}

export function topNext(testers: Tester[], size: number): Tester[] {
  return testers
    .filter((t) => t.status === "waiting" && t.fit && t.fit !== "not_now")
    .sort((a, b) => FIT_ORDER[a.fit!] - FIT_ORDER[b.fit!] || (b.fit_sure || 0) - (a.fit_sure || 0)
      || String(a.signed_up_at).localeCompare(String(b.signed_up_at)))
    .slice(0, size);
}

export function pickBeta(betas: Beta[], wanted?: string): Beta | null {
  if (wanted) return betas.find((b) => b.id === wanted || b.slug === wanted) || null;
  const real = betas.filter((b) => !b.sample);
  return real.find((b) => b.state === "open") || real[0] || betas.find((b) => b.state === "open") || betas[0] || null;
}

export function Roster({ betaId, personId }: { betaId?: string; personId?: string }) {
  const { betas, testers, drafts, said, batches, reload } = useEA();
  const person = personId ? testers.find((t) => t.id === personId) || null : null;
  const beta = pickBeta(betas, betaId || person?.beta_id);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const toast = useToast();
  const checked = useRef(false);

  const mine = useMemo(() => testers.filter((t) => beta && t.beta_id === beta.id), [testers, beta]);
  useEffect(() => {
    if (checked.current || !mine.length) return;
    checked.current = true;
    void checkEmails(mine).then((n) => (n ? reload("testers") : undefined));
  }, [mine, reload]);

  const inNext = useMemo(() => new Set(topNext(mine, beta?.batch_size || 10).map((t) => t.id)), [mine, beta]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, waiting: 0, invited: 0, active: 0, quiet: 0, left: 0 };
    for (const t of mine) {
      c.all += 1;
      for (const f of ["waiting", "invited", "active", "quiet", "left"] as Filter[]) if (IN_FILTER[f].includes(t.status)) c[f] += 1;
    }
    return c;
  }, [mine]);
  const rows = useMemo(() => {
    const words = search.trim().toLowerCase();
    return mine
      .filter((t) => IN_FILTER[filter].includes(t.status))
      .filter((t) => !words || [t.name, t.handle, t.company_name, t.role, t.last_said].some((x) => (x || "").toLowerCase().includes(words)))
      .map((t) => ({ t, next: nextFor(t, drafts, inNext) }))
      .sort((a, b) => a.next.rank - b.next.rank || String(b.t.last_heard_at || b.t.signed_up_at).localeCompare(String(a.t.last_heard_at || a.t.signed_up_at)));
  }, [mine, filter, search, drafts, inNext]);

  if (!beta) return null;
  const letIn = mine.filter((t) => ["picked", "invited", "active", "quiet", "left"].includes(t.status) && t.invited_at || t.status === "picked");
  const tried = letIn.filter((t) => t.first_used_at);
  const week = mine.filter((t) => (t.uses_7d || 0) > 0);
  const usesWeek = week.reduce((n, t) => n + (t.uses_7d || 0), 0);
  const signedWeek = mine.filter((t) => t.signed_up_at && Date.now() - Date.parse(t.signed_up_at) < 7 * 864e5).length;
  const quotes = said.filter((s) => beta.feature_id && s.feature_id === beta.feature_id);
  const speakers = new Set(quotes.map((s) => s.handle).filter(Boolean));
  const blockers = quotes.filter((s) => s.importance === "blocker").length;
  const nBatches = batches.filter((b) => b.beta_id === beta.id).length;
  const usage = beta.flag_tool === "posthog" || (beta.usage_events || []).length ? beta.sweep?.usage || "pending" : "none";
  const usageWord = usage === "read" ? `from PostHog, ${beta.sweep_at ? ago(beta.sweep_at) : "hourly"}`
    : usage === "not_connected" ? "PostHog not connected" : usage === "failed" ? "PostHog didn't answer last hour" : usage === "pending" ? "first read within the hour" : "no usage source";

  const copyLink = async () => {
    if (!beta.page_url) {
      toast("The page isn't on yet. Turn it on in the beta's settings.");
      return;
    }
    try {
      await navigator.clipboard.writeText(beta.page_url);
      toast("Copied the sign-up page's link.");
    } catch {
      toast(beta.page_url);
    }
  };

  return (
    <>
      <header className="ea-top">
        <span className="ea-top__icon" aria-hidden="true"><FlaskConical size={15} /></span>
        <Menu label={<span className="ea-top__beta">{beta.name}<ChevronDown size={14} aria-hidden="true" /></span>} variant="ghost" title="Switch beta">
          {(close) => (
            <>
              <MenuLabel>Betas</MenuLabel>
              {betas.map((b) => (
                <MenuItem key={b.id} hint={b.sample ? "sample" : b.state} onSelect={() => { close(); to.roster(b.id); }}>{b.name}</MenuItem>
              ))}
              <MenuItem onSelect={() => { close(); to.setup(); }}>Set up another beta</MenuItem>
            </>
          )}
        </Menu>
        <Pill tone={beta.state === "open" ? "info" : beta.state === "paused" ? "warning" : "plain"}>
          {beta.state === "open" ? "Beta" : beta.state === "paused" ? "Paused" : beta.state === "closed" ? "Closed" : "Not on yet"}
        </Pill>
        <span className="ea-top__since">
          {beta.opened_at ? `since ${day(beta.opened_at)}` : "not taking sign-ups yet"}
          {beta.flag_tool === "posthog" && beta.flag_key ? ` · flag ${beta.flag_key} in PostHog` : beta.flag_tool === "by_hand" ? " · flag turned on by hand" : " · no flag"}
        </span>
        <div className="ea-top__acts">
          <Button variant="ghost" size="sm" icon={Link2} onClick={() => void copyLink()}>Sign-up page</Button>
          <Button variant="ghost" size="sm" icon={Settings2} onClick={() => to.settings(beta.id)}>Settings</Button>
          <Button variant="primary" size="sm" onClick={() => to.next(beta.id)}>Pick next batch</Button>
        </div>
      </header>

      <main className="ea-main">
        <div className="ea-facts" role="list">
          <Fact k="Signed up" v={String(mine.length)} sub={`${signedWeek} this week`} />
          <Fact k="Let in" v={String(letIn.length)} sub={plural(nBatches, "batch", "batches")} />
          <Fact k="Tried it" v={usage === "read" || DEMO ? `${tried.length} of ${letIn.length}` : "—"} sub={usageWord} />
          <Fact k="Used this week" v={usage === "read" || DEMO ? String(week.length) : "—"} sub={week.length ? `${(usesWeek / week.length).toFixed(1)} uses each` : usage === "read" ? "nobody yet" : usage === "pending" ? "first read within the hour" : "not connected"} />
          <Fact k="Quiet" v={String(counts.quiet)} sub={`${beta.quiet_days} days, nothing used or said`} />
          <Fact k="Said something" v={plural(speakers.size, "person", "people")} sub={`${plural(quotes.length, "quote")} · ${plural(blockers, "blocker")}`} />
        </div>

        <div className="ea-bar">
          <Segmented<Filter> label="Status" value={filter} onChange={setFilter} items={[
            { id: "all", label: "All", count: counts.all }, { id: "waiting", label: "Waiting", count: counts.waiting },
            { id: "invited", label: "Invited", count: counts.invited }, { id: "active", label: "Active", count: counts.active },
            { id: "quiet", label: "Quiet", count: counts.quiet }, { id: "left", label: "Left", count: counts.left },
          ]} />
          <SearchField value={search} onChange={setSearch} placeholder="Search people or companies" />
          <span className="ea-bar__note">Sorted by what needs you</span>
        </div>

        {rows.length ? (
          <>
            <div className="c-table-wrap ea-wide">
              <table className="c-table ea-table">
                <thead>
                  <tr><th>Person</th><th>Status</th><th>Fit</th><th>Signed up</th><th>Let in</th><th className="right">Uses, 7 days</th><th>Last used</th><th>Last said</th><th>Next</th></tr>
                </thead>
                <tbody>
                  {rows.map(({ t, next }) => (
                    <tr key={t.id} className={t.id === personId ? "ea-sel" : undefined} onClick={() => to.person(t.id)}>
                      <td>
                        <div className="ea-who">
                          <Avatar name={t.name} email={t.handle} size={26} />
                          <div className="ea-who__text">
                            <button type="button" className="ea-link" onClick={(e) => { e.stopPropagation(); to.person(t.id); }}>{t.name || t.handle}</button>
                            <span className="ea-sub">{[t.company_name || "personal account", t.role].filter(Boolean).join(" · ")}</span>
                          </div>
                          <ProofPill t={t} />
                        </div>
                      </td>
                      <td><StatusPill status={t.status} /></td>
                      <td><FitPill fit={t.fit} /></td>
                      <td className="ea-muted">{day(t.signed_up_at)}</td>
                      <td className="ea-muted">{t.invited_at ? day(t.invited_at) : "—"}</td>
                      <td className="right num">{t.invited_at ? (usage === "read" || DEMO ? t.uses_7d ?? 0 : "—") : "—"}</td>
                      <td className="ea-muted">{t.last_used_at ? ago(t.last_used_at) : "—"}</td>
                      <td>
                        <div className="ea-said">{t.last_said || "—"}</div>
                        {t.last_said ? <div className="ea-sub">{sourceOf(t.last_said_source)}{t.last_heard_at ? ` · ${day(t.last_heard_at)}` : ""}</div> : null}
                      </td>
                      <td><NextMark next={next} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="ea-cards" aria-label="People">
              {rows.map(({ t, next }) => (
                <li key={t.id}>
                  <button type="button" className="ea-card" onClick={() => to.person(t.id)}>
                    <span className="ea-card__top">
                      <Avatar name={t.name} email={t.handle} size={26} />
                      <span className="ea-card__name">{t.name || t.handle}</span>
                      <StatusPill status={t.status} />
                    </span>
                    <span className="ea-sub">{[t.company_name || "personal account", t.role, t.fit ? `fit ${t.fit.replace("_", " ")}` : null].filter(Boolean).join(" · ")}</span>
                    {t.last_said ? <span className="ea-card__said">{t.last_said}</span> : null}
                    <span className="ea-card__next"><NextMark next={next} /></span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="ea-none">{mine.length ? "Nobody matches." : "Nobody has signed up yet. Share the sign-up page's link to start the list."}</div>
        )}

        <p className="ea-foot">
          Sign-ups come from the public page, each email confirmed with a code. Usage: {beta.flag_tool === "posthog" || (beta.usage_events || []).length ? "PostHog, read every hour" : "no usage source, so nobody is called inactive"}.
          Notes are drafts in your own mailbox, sent when you press Send.
        </p>
      </main>
      {person ? <Person t={person} beta={beta} onClose={() => to.roster(beta.id)} /> : null}
    </>
  );
}

function Fact({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="ea-fact" role="listitem">
      <div className="ea-fact__k">{k}</div>
      <div className="ea-fact__v">{v}</div>
      <div className="ea-fact__sub">{sub}</div>
    </div>
  );
}

export function NextMark({ next }: { next: Next }) {
  if (next.tone === "faint") return <span className="c-faint">{next.text}</span>;
  if (next.tone === "ai") return <Pill tone="ai" icon={Sparkles} dot={false}>{next.text}</Pill>;
  return <Pill tone={next.tone === "info" ? "info" : "plain"} dot={false}>{next.text}</Pill>;
}
