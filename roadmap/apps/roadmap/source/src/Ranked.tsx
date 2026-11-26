// A: every feature ranked by who asked. A table sorted by any column (people
// by default; there is no score), segmented by horizon with counts, search on
// `/`, the window it counts in and one company; the Lemma's banners for User
// feedback's work waiting on a person; and beside it, who asked for the
// selected feature, by company. At phone width it is a list of cards that open
// the feature.

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Building2, ChevronDown, FileText, Plus, Sparkles, X } from "lucide-react";
import { Button, Empty, Logo, Menu, MenuItem, MenuLabel, Pill, SearchField, Segmented, Skeleton, Spinner, agoText, openApp, plural, useToast } from "@lemma-plugins/kit";
import { WINDOWS, draftSpec, quotesOf, useRoadmap, type Data, type WindowId } from "./data";
import { ImportancePill, MoneyCell, SourceIcon, StagePill, monthDay, sourceWord } from "./marks";
import { HORIZON_WORD, listed, moneySaid, notPlanned, sortRows, type Row, type SortKey } from "./rank";
import { NewFeature } from "./NewFeature";
import { to } from "./route";
import { Top } from "./Top";
import { askersOf, asksFor, type AskerGroup } from "./who";
import { FEEDBACK_APP, useNarrow } from "./ui";
import type { Quote } from "./types";

type Seg = "all" | "not_planned" | "now" | "next" | "later" | "shipped";

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "stage", label: "Stage" }, { key: "people", label: "People", num: true }, { key: "companies", label: "Companies", num: true },
  { key: "blockers", label: "Blockers", num: true }, { key: "open", label: "Open deals", num: true }, { key: "won", label: "Won", num: true },
  { key: "last_asked", label: "Last asked" }, { key: "horizon", label: "Horizon" },
];
const SORT_WORD: Record<SortKey, string> = {
  people: "people", companies: "companies", blockers: "blockers", open: "open deals", won: "won", last_asked: "last asked",
  quotes: "quotes", stage: "stage", horizon: "horizon",
};

let remembered: { seg: Seg; sort: SortKey; desc: boolean; window: WindowId; company: string | null } = {
  seg: "all", sort: "people", desc: true, window: "90", company: null,
};

export function Ranked() {
  const [seg, setSeg] = useState<Seg>(remembered.seg);
  const [sort, setSort] = useState<SortKey>(remembered.sort);
  const [desc, setDesc] = useState(remembered.desc);
  const [windowId, setWindowId] = useState<WindowId>(remembered.window);
  const [company, setCompany] = useState<string | null>(remembered.company);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const data = useRoadmap(windowId);
  const narrow = useNarrow();
  useEffect(() => { remembered = { seg, sort, desc, window: windowId, company }; }, [seg, sort, desc, windowId, company]);

  const visible = useMemo(() => data.rows.filter(listed), [data.rows]);
  const counts = useMemo(() => ({
    all: visible.length, not_planned: visible.filter(notPlanned).length,
    now: visible.filter((r) => r.horizon === "now").length, next: visible.filter((r) => r.horizon === "next").length,
    later: visible.filter((r) => r.horizon === "later").length, shipped: visible.filter((r) => r.horizon === "shipped").length,
  }), [visible]);
  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const list = visible.filter((r) => (seg === "all" ? true : seg === "not_planned" ? notPlanned(r) : r.horizon === seg)
      && (!company || r.company_ids.includes(company))
      && words.every((w) => `${r.name} ${r.area}`.toLowerCase().includes(w)));
    return sortRows(list, sort, desc);
  }, [visible, seg, company, search, sort, desc]);
  const selected = shown.find((r) => r.id === picked) || (narrow ? null : shown[0]) || null;

  // J / K move the selection, Enter opens it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const at = selected ? shown.findIndex((r) => r.id === selected.id) : -1;
      if (e.key === "j" || e.key === "k") {
        const next = shown[Math.max(0, Math.min(shown.length - 1, at + (e.key === "j" ? 1 : -1)))];
        if (next) {
          setPicked(next.id);
          document.getElementById(`rm-row-${next.id}`)?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "Enter" && selected) {
        to.feature(selected.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, selected]);

  const companyName = company ? data.companyNames.get(company) || "One company" : null;
  const askedCompanies = useMemo(() => {
    const ids = new Set(visible.flatMap((r) => r.company_ids));
    return data.companies.filter((c) => ids.has(c.id));
  }, [visible, data.companies]);
  const windowLabel = WINDOWS.find((w) => w.id === windowId)?.label || "Asked any time";
  const pickSort = (k: SortKey) => {
    if (k === sort) setDesc(!desc);
    else {
      setSort(k);
      setDesc(true);
    }
  };

  const segItems = [
    { id: "all" as Seg, label: "All", count: counts.all }, { id: "not_planned" as Seg, label: "Not planned", count: counts.not_planned },
    { id: "now" as Seg, label: "Now", count: counts.now }, { id: "next" as Seg, label: "Next", count: counts.next },
    { id: "later" as Seg, label: "Later", count: counts.later }, { id: "shipped" as Seg, label: "Shipped", count: counts.shipped },
  ];

  return (
    <>
      <Top view="ranked" count={plural(visible.length, "feature")}>
        <span className="rm-search"><SearchField value={search} onChange={setSearch} placeholder="Search features" /></span>
        <Menu label={`Sort: ${SORT_WORD[sort]}`} icon={ChevronDown} size="sm" align="right">
          {(close) => (
            <>
              <MenuLabel>Sort by, most first</MenuLabel>
              {(["people", "companies", "blockers", "open", "won", "last_asked", "quotes", "stage", "horizon"] as SortKey[]).map((k) => (
                <MenuItem key={k} hint={k === sort ? "✓" : undefined} onSelect={() => { setSort(k); setDesc(true); close(); }}>{SORT_WORD[k][0].toUpperCase() + SORT_WORD[k].slice(1)}</MenuItem>
              ))}
            </>
          )}
        </Menu>
        {narrow ? <Button size="sm" icon={Plus} label="New feature" onClick={() => setAdding(true)} />
          : <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>New feature</Button>}
      </Top>
      <div className="rm-toolbar">
        <Segmented label="Which features" items={segItems} value={seg} onChange={(s) => setSeg(s)} />
        <Menu label={windowLabel} icon={ChevronDown} size="sm">
          {(close) => WINDOWS.map((w) => <MenuItem key={w.id} hint={w.id === windowId ? "✓" : undefined} onSelect={() => { setWindowId(w.id); close(); }}>{w.label}</MenuItem>)}
        </Menu>
        <Menu label={companyName || "Every company"} icon={ChevronDown} size="sm">
          {(close) => (
            <>
              <MenuItem hint={!company ? "✓" : undefined} onSelect={() => { setCompany(null); close(); }}>Every company</MenuItem>
              <MenuLabel>Features someone there asked for</MenuLabel>
              {askedCompanies.map((c) => <MenuItem key={c.id} icon={Building2} hint={c.id === company ? "✓" : undefined} onSelect={() => { setCompany(c.id); close(); }}>{c.name}</MenuItem>)}
            </>
          )}
        </Menu>
      </div>
      <div className={selected && !narrow ? "rm-split" : "rm-split rm-split--one"}>
        <main className="rm-main">
          <Banners data={data} />
          {!visible.length ? (
            <Empty title="No features yet" action={<Button icon={Plus} onClick={() => setAdding(true)}>New feature</Button>}>
              User feedback files what people say under the features it names. Until it's here, name a feature yourself, or load the sample from Settings.
            </Empty>
          ) : narrow ? (
            <PhoneList rows={shown} main={data.currency} sort={sort} />
          ) : (
            <div className="c-table-wrap rm-table-wrap">
              <table className="c-table rm-table">
                <thead>
                  <tr>
                    <th className="rm-rank">#</th>
                    <th>Feature</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className={c.num ? "right" : undefined} aria-sort={c.key === sort ? (desc ? "descending" : "ascending") : undefined}>
                        <button type="button" className={c.key === sort ? "rm-sorted" : undefined} onClick={() => pickSort(c.key)}>
                          {c.label}{c.key === sort ? (desc ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />) : null}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={r.id} id={`rm-row-${r.id}`} className={selected?.id === r.id ? "rm-sel" : undefined}
                      onClick={() => setPicked(r.id)} onDoubleClick={() => to.feature(r.id)}>
                      <td className="rm-rank">{i + 1}</td>
                      <td className="rm-feat">
                        <button type="button" className="rm-feat__name" onClick={(e) => { e.stopPropagation(); setPicked(r.id); }}>{r.name}</button>
                        {r.area ? <span className="rm-feat__area">{r.area}</span> : null}
                      </td>
                      <td><StagePill stage={r.stage} /></td>
                      <td className="right num">{r.people || <span className="c-faint">—</span>}</td>
                      <td className="right num">{r.companies || <span className="c-faint">—</span>}</td>
                      <td className="right num">{r.blockers || <span className="c-faint">—</span>}</td>
                      <td className="right num"><MoneyCell by={r.open} main={data.currency} /></td>
                      <td className="right num"><MoneyCell by={r.won} main={data.currency} /></td>
                      <td className="c-faint">{r.last_asked ? agoText(r.last_asked) : "—"}</td>
                      <td>{r.horizon === "none" ? <span className="c-faint">—</span> : HORIZON_WORD[r.horizon]}</td>
                    </tr>
                  ))}
                  {!shown.length ? <tr><td colSpan={10} className="c-muted rm-none">No feature matches.</td></tr> : null}
                </tbody>
              </table>
            </div>
          )}
          <p className="rm-foot">
            Sort by any column; nothing here is a weighted score. Money is deal value from Deal tracker ({data.currency} first, other currencies added, never converted), not recurring revenue. A person with two addresses counts twice.
          </p>
        </main>
        {selected && !narrow ? <WhoAsked row={selected} data={data} onClose={() => setPicked(null)} /> : null}
      </div>
      <NewFeature open={adding} onClose={() => setAdding(false)} onMade={(id) => { setAdding(false); to.feature(id); }} />
    </>
  );
}

/* ---------- the Lemma's banners ---------- */

export function Banners({ data, compact }: { data: Data; compact?: boolean }) {
  const toast = useToast();
  const top = data.suggested[0];
  const open = async (what: string) => {
    const ok = await openApp(FEEDBACK_APP, "/");
    if (!ok) toast(`${what} is User feedback's to settle, and User feedback isn't in this Lemma yet.`);
  };
  if (!data.unchecked && !top) return null;
  return (
    <div className="rm-bans">
      {data.unchecked ? (
        <div className="rm-ban">
          <Sparkles size={14} aria-hidden="true" className="rm-ban__icon" /><Pill tone="ai">ai</Pill>
          <span className="rm-ban__text">{plural(data.unchecked, "quote")} the Lemma filed {data.unchecked === 1 ? "is" : "are"} waiting for a person. <span className="c-muted">Until someone checks them they still count here.</span></span>
          <Button size="sm" onClick={() => void open("Checking quotes")}>Check {data.unchecked}</Button>
        </div>
      ) : null}
      {top && !compact ? (
        <div className="rm-ban">
          <Sparkles size={14} aria-hidden="true" className="rm-ban__icon" /><Pill tone="ai">ai</Pill>
          <span className="rm-ban__text">Suggested feature: <b>{top.name}</b>. <span className="c-muted">{plural(top.quotes, "quote")} from {plural(top.companies, "company", "companies")} fit no feature yet.</span></span>
          <Button size="sm" onClick={() => void open("A suggested feature")}>Add it or merge it</Button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- who asked, beside the table ---------- */

function WhoAsked({ row, data, onClose }: { row: Row; data: Data; onClose: () => void }) {
  const toast = useToast();
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setQuotes(null);
    void quotesOf(row.id).then((r) => alive && setQuotes(r)).catch(() => alive && setQuotes([]));
    return () => { alive = false; };
  }, [row.id, row.quotes]);
  const feature = data.byId.get(row.id);
  const groups: AskerGroup[] | null = useMemo(() => {
    if (!quotes) return null;
    const asks = asksFor(row, data.asks, { source: feature?.work_source || null, id: feature?.work_id || null });
    return askersOf(quotes, asks, data.deals, data.companyNames, data.currency);
  }, [quotes, row, data.asks, data.deals, data.companyNames, data.currency, feature]);
  const draft = async () => {
    setBusy(true);
    try {
      await draftSpec(row.id);
      toast("Drafting the spec from what they said. It shows on the feature's page in a minute.");
      to.feature(row.id);
    } catch (e) {
      toast(`Couldn't start the draft: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="rm-side" aria-label={`Who asked for ${row.name}`}>
      <div className="rm-side__head">
        <h2>{row.name}</h2>
        <Button variant="ghost" size="sm" icon={X} label="Close" onClick={onClose} />
      </div>
      <div className="rm-line"><StagePill stage={row.stage} /><span className="c-faint">{[row.horizon === "none" ? "Not planned" : HORIZON_WORD[row.horizon], row.area].filter(Boolean).join(" · ")}</span></div>
      <div className="rm-facts">
        <div className="rm-fact"><b>{row.people}</b><span>{row.people === 1 ? "person" : "people"}</span></div>
        <div className="rm-fact"><b>{row.companies}</b><span>{row.companies === 1 ? "company" : "companies"}</span></div>
        <div className="rm-fact"><b>{moneySaid(row.open, data.currency) || "—"}</b><span>open deals</span></div>
        <div className="rm-fact"><b>{moneySaid(row.won, data.currency) || "—"}</b><span>won</span></div>
      </div>
      <div className="rm-line rm-line--split"><span className="rm-strong">Who asked</span><span className="c-faint rm-small">By company, blockers first</span></div>
      {!groups ? <Skeleton kind="list" rows={5} /> : !groups.length ? <p className="c-muted rm-small">Nobody yet{row.quotes ? "" : ": nothing is filed under it"}.</p> : (
        <div className="rm-who">
          {groups.map((g) => <WhoLine key={g.companyId || "none"} g={g} />)}
        </div>
      )}
      <div className="rm-line rm-side__acts">
        <Button variant="primary" onClick={() => to.feature(row.id)}>Open feature</Button>
        <Button icon={FileText} busy={busy} onClick={() => void draft()}>{row.spec ? "Redraft the spec" : "Draft the spec"}</Button>
      </div>
    </aside>
  );
}

export function WhoLine({ g }: { g: AskerGroup }) {
  return (
    <div className="rm-who__row">
      {g.companyId ? <Logo name={g.company} size={26} /> : <span className="rm-nologo" aria-hidden="true">—</span>}
      <div className="rm-who__main">
        <div className="rm-line">
          {g.companyId ? <button type="button" className="rm-link" onClick={() => void openApp("companies", `/${g.companyId}`)}>{g.company}</button> : <span>{g.company}</span>}
          <span className="c-faint">· {plural(g.people, "person", "people")}</span>
          {g.quote ? <ImportancePill importance={g.importance} /> : null}
        </div>
        {g.quote ? <button type="button" className="rm-quote" onClick={() => to.quote(g.quote!.id)}>“{g.quote.quote}”</button> : <span className="c-faint rm-small">Asked, no words filed</span>}
        <div className="rm-meta">
          {g.where ? <><SourceIcon source={g.where.source} /><span>{sourceWord(g.where.source)} · {monthDay(g.where.at)}</span></> : null}
          {g.deal ? (g.dealId ? <button type="button" className="rm-deal rm-link" onClick={() => void openApp("deals", `/${g.dealId}`)}>{g.deal}</button> : <span className="rm-deal">{g.deal}</span>) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------- at phone width ---------- */

function PhoneList({ rows, main, sort }: { rows: Row[]; main: string; sort: SortKey }) {
  if (!rows.length) return <p className="c-muted">No feature matches.</p>;
  return (
    <>
      <p className="c-faint rm-small rm-sortnote">Sorted by {SORT_WORD[sort]}{sort === "people" ? " who asked" : ""}</p>
      <ul className="rm-cards">
        {rows.map((r) => {
          const asked = [plural(r.people, "person", "people"), plural(r.companies, "company", "companies"), r.blockers ? plural(r.blockers, "blocker") : null].filter(Boolean).join(" · ");
          const open = moneySaid(r.open, main);
          const won = moneySaid(r.won, main);
          const money = [open ? `${open} open` : null, won ? `${won} won` : null].filter(Boolean).join(" · ") || "No deals";
          return (
            <li key={r.id}>
              <button type="button" className="rm-card" onClick={() => to.feature(r.id)}>
                <span className="rm-card__top"><span className="rm-card__name">{r.name}</span><StagePill stage={r.stage} /></span>
                <span className="rm-card__sub">{asked}</span>
                <span className="c-faint">{money} · {r.horizon === "none" ? "not planned" : HORIZON_WORD[r.horizon]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function Loading() {
  return <span className="c-muted c-row"><Spinner /> Loading…</span>;
}
