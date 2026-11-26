// C: one feature. Its facts on top; the spec, drafted from what people said,
// every line with the marks of the quotes it came from (a line with none says
// "No quote"; pointing at a line or pressing a mark lights its quote on the
// right); the properties (horizon, owner, project, the public page, who to
// tell when it ships); and the quotes, all, blockers, or not in the spec.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, FileText, MoreHorizontal, Pencil, Plus, RotateCw, Sparkles, Trash2, X } from "lucide-react";
import { Button, Empty, Header, Menu, MenuItem, MenuLabel, Notice, Pill, Segmented, Skeleton, Spinner, Switch, agoText, openApp, plural, useToast } from "@lemma-plugins/kit";
import { draftSpec, makeProject, refreshToday, saveSpec, setItem, ship, specOf, quotesOf, useRoadmap, useWho, type Data } from "./data";
import { ImportancePill, SourceIcon, StagePill, monthDay, sourceWord } from "./marks";
import { HORIZON_WORD, IMPORTANCE, moneySaid, whoKey, type Row } from "./rank";
import { to } from "./route";
import { asksFor, dealText } from "./who";
import type { Horizon, Quote, Spec, SpecLine } from "./types";

const SECTIONS: { key: SpecLine["section"]; title: string }[] = [
  { key: "problem", title: "The problem, in their words" }, { key: "who", title: "Who asked" }, { key: "need", title: "What they need" },
  { key: "not", title: "Not doing" }, { key: "open", title: "Open questions" },
];
const PAGE = 20;

export function FeaturePage({ id }: { id: string }) {
  const data = useRoadmap();
  const row = data.rows.find((r) => r.id === id) || null;
  const feature = data.byId.get(id);
  if (!data.loaded) return <Skeleton kind="record" />;
  if (!row) {
    return (
      <div className="c-app">
        <Header back={{ label: "Roadmap", icon: ArrowLeft, onClick: () => to.ranked() }} title="Feature" />
        <main className="c-body">
          <Empty title={feature ? `${feature.name} isn't on the list` : "No such feature"}>
            {feature ? `It was ${feature.state === "suggested" ? "suggested and nobody has added it yet" : feature.state}. User feedback keeps the list.` : "It may have been merged into another feature."}
          </Empty>
        </main>
      </div>
    );
  }
  return <Page row={row} data={data} />;
}

function nextStep(h: Horizon): { label: string; horizon: Horizon } | null {
  if (h === "later") return { label: "Move to Next", horizon: "next" };
  if (h === "next") return { label: "Move to Now", horizon: "now" };
  return null;
}

function Page({ row, data }: { row: Row; data: Data }) {
  const toast = useToast();
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [spec, setSpec] = useState<Spec | null | undefined>(undefined);
  const [lit, setLit] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const slim = row.spec;
  useEffect(() => {
    let alive = true;
    void quotesOf(row.id).then((r) => alive && setQuotes(r)).catch(() => alive && setQuotes([]));
    return () => { alive = false; };
  }, [row.id, row.quotes]);
  useEffect(() => {
    let alive = true;
    void specOf(row.id).then((s) => alive && setSpec(s)).catch(() => alive && setSpec(null));
    return () => { alive = false; };
  }, [row.id, slim?.state, slim?.version, slim?.updated_at, slim?.edited]);

  const act = async (what: string, run: () => Promise<{ message?: string } & Record<string, unknown>>) => {
    setBusy(what);
    try {
      const out = await run();
      toast(String(out.message || "Done."));
      await data.reload();
      refreshToday();
    } catch (e) {
      toast(`Couldn't do that: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  const step = nextStep(row.horizon);
  const allDone = !!row.progress && row.progress.total > 0 && row.progress.done >= row.progress.total;

  return (
    <div className="rm-record">
      <header className="rm-crumbbar">
        <nav className="rm-crumb" aria-label="Breadcrumb">
          <button type="button" onClick={() => to.ranked()}>Roadmap</button><span aria-hidden="true">/</span><span>{row.name}</span>
        </nav>
        <div className="rm-top__acts">
          <Menu icon={MoreHorizontal} title="More" size="sm" align="right">
            {(close) => (
              <>
                {row.horizon !== "none" ? <MenuItem onSelect={() => { close(); void act("off", () => setItem(row.id, { horizon: "none" })); }}>Take it off the roadmap</MenuItem> : null}
                {row.horizon === "shipped" ? <MenuItem onSelect={() => { close(); void act("undo", () => ship(row.id, true)); }}>Not shipped after all</MenuItem> : null}
                {row.stage !== "beta" && row.stage !== "live" && row.stage !== "declined" ? (
                  <MenuItem onSelect={() => { close(); void act("decline", () => setItem(row.id, { decline: true })); }}>Decline it</MenuItem>
                ) : null}
              </>
            )}
          </Menu>
          {row.horizon === "none" ? (
            <Menu label="Add to roadmap" icon={ChevronDown} size="sm" align="right">
              {(close) => (["now", "next", "later"] as Horizon[]).map((h) => (
                <MenuItem key={h} onSelect={() => { close(); void act("move", () => setItem(row.id, { horizon: h })); }}>{HORIZON_WORD[h]}</MenuItem>
              ))}
            </Menu>
          ) : null}
          {row.horizon === "now" && allDone ? (
            <Button variant="primary" size="sm" busy={busy === "ship"} onClick={() => void act("ship", () => ship(row.id))}>Mark shipped</Button>
          ) : step ? (
            <Button variant="primary" size="sm" busy={busy === "move"} onClick={() => void act("move", () => setItem(row.id, { horizon: step.horizon }))}>{step.label}</Button>
          ) : null}
        </div>
      </header>
      <div className="rm-head">
        <div className="rm-line rm-head__title"><h1>{row.name}</h1><StagePill stage={row.stage} />
          <span className="c-faint">{[row.horizon === "none" ? "Not planned" : HORIZON_WORD[row.horizon], row.area].filter(Boolean).join(" · ")}</span></div>
        {row.description ? <p className="c-muted rm-head__desc">{row.description}</p> : null}
        <div className="rm-facts rm-facts--six">
          <div className="rm-fact"><b>{row.people}</b><span>{row.people === 1 ? "person asked" : "people asked"}</span></div>
          <div className="rm-fact"><b>{row.companies}</b><span>{row.companies === 1 ? "company" : "companies"}</span></div>
          <div className="rm-fact"><b>{row.blockers}</b><span>call it a blocker</span></div>
          <div className="rm-fact"><b>{moneySaid(row.open, data.currency) || "—"}</b><span>in open deals</span></div>
          <div className="rm-fact"><b>{moneySaid(row.won, data.currency) || "—"}</b><span>won</span></div>
          <div className="rm-fact"><b>{row.quotes}</b><span>{row.quotes === 1 ? "quote" : "quotes"}</span></div>
        </div>
      </div>
      <div className="rm-recwrap">
        <main className="rm-spec">
          <SpecView row={row} spec={spec} quotes={quotes} onLight={setLit} lit={lit} onSaved={setSpec} />
        </main>
        <aside className="rm-ev" aria-label="Properties and quotes">
          <Props row={row} data={data} act={act} busy={busy} />
          <Quotes row={row} data={data} quotes={quotes} spec={spec || null} lit={lit} />
        </aside>
      </div>
    </div>
  );
}

/* ---------- the spec ---------- */

function SpecView({ row, spec, quotes, lit, onLight, onSaved }: {
  row: Row; spec: Spec | null | undefined; quotes: Quote[] | null; lit: string[]; onLight: (ids: string[]) => void; onSaved: (s: Spec) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<SpecLine[] | null>(null);
  const [busy, setBusy] = useState("");
  const [asked, setAsked] = useState(false);
  const labels = spec?.labels || {};
  const lines = spec?.lines || [];
  const drafting = spec?.state === "drafting" || asked;
  useEffect(() => { if (spec?.state !== "drafting") setAsked(false); }, [spec?.state, spec?.version]);
  const draft = async () => {
    setBusy("draft");
    try {
      await draftSpec(row.id);
      setAsked(true);
      toast("Drafting the spec from what they said. It takes about a minute.");
    } catch (e) {
      toast(`Couldn't start the draft: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    if (!editing) return;
    setBusy("save");
    try {
      const out = await saveSpec(row.id, editing.filter((l) => l.text.trim()));
      toast(String(out.message || "Saved."));
      setEditing(null);
      const fresh = await specOf(row.id);
      if (fresh) onSaved(fresh);
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  if (spec === undefined) return <Skeleton kind="list" rows={6} />;
  if (!spec || (!lines.length && spec.state !== "ready")) {
    return (
      <>
        {spec?.state === "failed" ? <Notice>The last draft didn't finish: {spec.error || "no reason given"}</Notice> : null}
        {drafting ? (
          <div className="rm-specbar"><Spinner /><span>Drafting from {plural(row.quotes, "quote")}: the problem in their words, who asked, what they need, not doing, open questions.</span></div>
        ) : (
          <Empty icon={FileText} title="No spec yet" action={<Button icon={Sparkles} busy={busy === "draft"} disabled={!row.quotes} onClick={() => void draft()}>Draft the spec</Button>}>
            {row.quotes
              ? `Drafted from the ${plural(row.quotes, "quote")} filed under it: the problem in their words, who asked, what they need, not doing and open questions. Every line cites the quotes it came from.`
              : "Nothing is filed under it yet, so there is nothing to draft from."}
          </Empty>
        )}
      </>
    );
  }
  const fresh = Math.max(0, row.quotes - Number(spec.quotes_total || 0));
  const unsourced = lines.filter((l) => l.unsourced).length;
  const edited = lines.filter((l) => l.edited).length;
  return (
    <>
      <div className="rm-specbar">
        <Sparkles size={14} aria-hidden="true" className="c-faint" /><Pill tone="ai">ai</Pill>
        {drafting ? <span className="c-row"><Spinner /> Redrafting; lines a person edited stay as they are.</span> : (
          <span>Drafted from {spec.quotes_used === spec.quotes_total ? `all ${spec.quotes_total}` : `${spec.quotes_used} of ${spec.quotes_total}`} quotes, {agoText(spec.drafted_at)}.{edited ? ` The team edited ${plural(edited, "line")}.` : ""}</span>
        )}
        {unsourced && !drafting ? <span className="c-faint">{plural(unsourced, "line")} {unsourced === 1 ? "has" : "have"} no quote behind {unsourced === 1 ? "it" : "them"}.</span> : null}
        <span className="rm-specbar__acts">
          {editing ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" busy={busy === "save"} onClick={() => void save()}>Save</Button>
            </>
          ) : (
            <>
              <Button size="sm" icon={RotateCw} busy={busy === "draft"} disabled={drafting} onClick={() => void draft()}>{fresh ? `Redraft with ${plural(fresh, "new quote")}` : "Redraft"}</Button>
              <Button size="sm" icon={Pencil} disabled={drafting} onClick={() => setEditing(lines.map((l) => ({ ...l, quotes: [...l.quotes] })))}>Edit</Button>
            </>
          )}
        </span>
      </div>
      {spec.state === "failed" && spec.error ? <Notice>The last redraft didn't finish: {spec.error} This is the version before.</Notice> : null}
      {editing ? <SpecEditor lines={editing} labels={labels} onChange={setEditing} /> : SECTIONS.map((s) => {
        const group = lines.filter((l) => l.section === s.key);
        if (!group.length) return null;
        return (
          <section key={s.key}>
            <h2 className="rm-sec">{s.title}</h2>
            {group.map((l) => {
              const on = l.quotes.length > 0 && l.quotes.every((qid) => lit.includes(qid)) && lit.length === l.quotes.length;
              return (
                <div key={l.key} className={on ? "rm-ln rm-ln--on" : "rm-ln"} onMouseEnter={() => onLight(l.quotes)} onMouseLeave={() => onLight([])}>
                  <span className="rm-ln__bul" aria-hidden="true">–</span>
                  <p>
                    <span className={/^[“"]/.test(l.text) ? "rm-say" : undefined}>{l.text}</span>
                    {[...l.quotes].sort((a, b) => Number((labels[a] || "q999").slice(1)) - Number((labels[b] || "q999").slice(1))).map((qid) => (
                      <button key={qid} type="button" className="rm-cite" onFocus={() => onLight(l.quotes)}
                        onClick={() => { onLight([qid]); document.getElementById(`rm-q-${qid}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }}
                        aria-label={`Quote ${labels[qid] || ""}`}>{labels[qid] || "q"}</button>
                    ))}
                    {l.unsourced ? <span className="rm-nq"><Pill tone="warning" dot>No quote</Pill></span> : null}
                    {l.edited ? <span className="rm-edited">edited</span> : null}
                  </p>
                </div>
              );
            })}
          </section>
        );
      })}
      <p className="c-faint rm-small rm-specnote">
        Saved as a page{spec.path ? `, ${spec.path},` : ""} which the Lemma's agents and search can read. Each mark links to its quote.
        {quotes && quotes.length > 500 ? " The page shows the newest 500 quotes." : ""}
      </p>
    </>
  );
}

function SpecEditor({ lines, labels, onChange }: { lines: SpecLine[]; labels: Record<string, string>; onChange: (l: SpecLine[]) => void }) {
  const set = (i: number, patch: Partial<SpecLine>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <div className="rm-editor">
      {SECTIONS.map((s) => (
        <section key={s.key}>
          <h2 className="rm-sec">{s.title}</h2>
          {lines.map((l, i) => (l.section !== s.key ? null : (
            <div key={l.key || `new-${i}`} className="rm-edit">
              <textarea className="c-textarea rm-edit__text" value={l.text} aria-label={`A line of ${s.title}`} onChange={(e) => set(i, { text: e.target.value })} />
              <div className="rm-line">
                {l.quotes.map((qid) => (
                  <span key={qid} className="rm-cite rm-cite--edit">{labels[qid] || "q"}
                    <button type="button" aria-label={`Take ${labels[qid] || "this quote"} off this line`} onClick={() => set(i, { quotes: l.quotes.filter((x) => x !== qid) })}><X size={11} /></button>
                  </span>
                ))}
                {!l.quotes.length && s.key !== "not" ? <span className="c-faint rm-small">No quote</span> : null}
                <Button size="sm" variant="ghost" icon={Trash2} label="Take the line out" onClick={() => onChange(lines.filter((_, k) => k !== i))} />
              </div>
            </div>
          )))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange([...lines, { section: s.key, key: "", text: "", quotes: [], edited: true, unsourced: s.key !== "not" }])}>Add a line</Button>
        </section>
      ))}
    </div>
  );
}

/* ---------- properties ---------- */

function Props({ row, data, act, busy }: { row: Row; data: Data; act: (what: string, run: () => Promise<{ message?: string }>) => Promise<void>; busy: string }) {
  const { members } = useWho();
  const [owner, setOwner] = useState(row.item?.owner_label || "");
  const [title, setTitle] = useState(row.item?.public_title || "");
  const [blurb, setBlurb] = useState(row.item?.public_blurb || "");
  useEffect(() => { setOwner(row.item?.owner_label || ""); setTitle(row.item?.public_title || ""); setBlurb(row.item?.public_blurb || ""); },
    [row.item?.owner_label, row.item?.public_title, row.item?.public_blurb]);
  const saveOwner = () => {
    if (owner.trim() === (row.item?.owner_label || "")) return;
    const member = members.find((m) => m.name.toLowerCase() === owner.trim().toLowerCase());
    void act("owner", () => setItem(row.id, owner.trim() ? { owner_label: owner.trim(), owner_user_id: member?.user_id || "" } : { no_owner: true }));
  };
  const savePublic = (patch: Record<string, unknown>) => void act("public", () => setItem(row.id, patch));
  const p = row.progress;
  const labels = [...new Set([...members.map((m) => m.name), ...data.rows.map((r) => r.item?.owner_label).filter(Boolean) as string[]])];
  return (
    <dl className="c-props rm-props">
      <dt>Horizon</dt>
      <dd>
        <Menu label={HORIZON_WORD[row.horizon]} icon={ChevronDown} size="sm" variant="ghost">
          {(close) => (
            <>
              <MenuLabel>Move to</MenuLabel>
              {(["now", "next", "later", "none"] as Horizon[]).filter((h) => h !== row.horizon).map((h) => (
                <MenuItem key={h} onSelect={() => { close(); void act("move", () => setItem(row.id, { horizon: h })); }}>{h === "none" ? "Off the roadmap" : HORIZON_WORD[h]}</MenuItem>
              ))}
            </>
          )}
        </Menu>
      </dd>
      <dt>Owner</dt>
      <dd>
        <input className="c-input c-input--bare rm-prop-input" list="rm-owners" value={owner} placeholder="A person or a team" aria-label="Owner"
          onChange={(e) => setOwner(e.target.value)} onBlur={saveOwner} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        <datalist id="rm-owners">{labels.map((l) => <option key={l} value={l} />)}</datalist>
      </dd>
      <dt>Project</dt>
      <dd>
        {p ? (
          <button type="button" className="rm-link" onClick={() => void openApp("tasks", `/p/${p.project_id}`)}>
            {p.name || "Its project"}{p.total ? ` · ${p.done} of ${plural(p.total, "task")} done` : " · no tasks yet"}
          </button>
        ) : (
          <span className="rm-line"><span className="c-faint">None yet</span>
            <Button size="sm" busy={busy === "project"} onClick={() => void act("project", () => makeProject(row.id))}>Make one in Tasks</Button></span>
        )}
        {row.stale ? <span className="rm-flag rm-flag--block">No task moved in {row.moved_days} days</span> : null}
      </dd>
      <dt>Public page</dt>
      <dd className="rm-pub">
        <span className="rm-line">
          <Switch checked={!!row.item?.public} label="Show it on the outside page" disabled={row.horizon === "none"}
            onChange={(v) => savePublic({ public: v, ...(v && !title ? { public_title: row.name } : {}) })} />
          <span>{row.item?.public ? "Shown, as:" : "Not shown"}</span>
        </span>
        {row.item?.public ? (
          <>
            <input className="c-input rm-prop-input" value={title} maxLength={120} aria-label="Public title" placeholder={row.name}
              onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== (row.item?.public_title || "") && savePublic({ public_title: title })} />
            <input className="c-input rm-prop-input" value={blurb} maxLength={300} aria-label="Public line" placeholder="One line for the page (optional)"
              onChange={(e) => setBlurb(e.target.value)} onBlur={() => blurb !== (row.item?.public_blurb || "") && savePublic({ public_blurb: blurb })} />
            <span className="c-faint rm-small">{data.settings?.public_on ? "On the outside page as this, with no names or numbers." : "The outside page is off; turn it on in Settings."}</span>
          </>
        ) : row.horizon === "none" ? <span className="c-faint rm-small">Put it on the roadmap first.</span> : null}
      </dd>
      <dt>When it ships</dt>
      <dd className="rm-wrap">{plural(row.tell, "person", "people")} to tell, where they asked. <span className="c-faint">Release notes tells them once it handles features; Roadmap tells nobody itself.</span></dd>
    </dl>
  );
}

/* ---------- what they said ---------- */

function Quotes({ row, data, quotes, spec, lit }: { row: Row; data: Data; quotes: Quote[] | null; spec: Spec | null; lit: string[] }) {
  const [kind, setKind] = useState<"all" | "blockers" | "not_in_spec">("all");
  const [shown, setShown] = useState(PAGE);
  const cited = useMemo(() => new Set((spec?.lines || []).flatMap((l) => l.quotes)), [spec]);
  const labels = spec?.labels || {};
  const rivals = useMemo(() => new Set(data.products.filter((p) => p.role === "rival").map((p) => p.id)), [data.products]);
  const mine = useMemo(() => (quotes || []).filter((q) => !(q.product_id && rivals.has(q.product_id))), [quotes, rivals]);
  const sorted = useMemo(() => [...mine].sort((a, b) => IMPORTANCE[b.importance] - IMPORTANCE[a.importance] || String(b.said_at).localeCompare(String(a.said_at))), [mine]);
  const counts = { all: mine.length, blockers: mine.filter((q) => q.importance === "blocker").length, not_in_spec: mine.filter((q) => !cited.has(q.id)).length };
  const list = sorted.filter((q) => kind === "all" || (kind === "blockers" ? q.importance === "blocker" : !cited.has(q.id)));
  const top = useRef<HTMLDivElement>(null);
  // A lit quote further down the list is brought into the page.
  useEffect(() => {
    if (!lit.length) return;
    const at = Math.max(...lit.map((id) => list.findIndex((q) => q.id === id)));
    if (at >= shown) setShown(at + 1);
  }, [lit, list, shown]);
  const dealsBy = useMemo(() => {
    const m = new Map<string, ReturnType<typeof dealText>>();
    for (const c of new Set(mine.map((q) => q.company_id).filter(Boolean) as string[])) m.set(c, dealText(data.deals.filter((d) => d.company_id === c), data.currency));
    return m;
  }, [mine, data.deals, data.currency]);
  const feature = data.byId.get(row.id);
  const said = new Set(mine.map((q) => whoKey(q.handle_kind, q.handle)));
  const askOnly = new Set(asksFor(row, data.asks, { source: feature?.work_source || null, id: feature?.work_id || null })
    .map((a) => whoKey(a.handle_kind, a.handle)).filter((k) => k && !said.has(k))).size;
  return (
    <div className="rm-quotes" ref={top}>
      <div className="rm-line rm-line--split">
        <h2 className="rm-h2">What they said</h2>
        <Segmented label="Which quotes" value={kind} onChange={(k) => { setKind(k); setShown(PAGE); }}
          items={[{ id: "all", label: "All", count: counts.all }, { id: "blockers", label: "Blockers", count: counts.blockers },
            { id: "not_in_spec", label: "Not in spec", count: counts.not_in_spec }]} />
      </div>
      {!quotes ? <Skeleton kind="list" rows={4} /> : null}
      {list.slice(0, shown).map((q) => {
        const deal = q.company_id ? dealsBy.get(q.company_id) : null;
        const company = (q.company_id && data.companyNames.get(q.company_id)) || q.company_name;
        return (
          <figure key={q.id} id={`rm-q-${q.id}`} className={lit.includes(q.id) ? "rm-qt rm-qt--on" : "rm-qt"}>
            <div className="rm-line rm-line--split">
              <span className="rm-tag">{labels[q.id] || (cited.has(q.id) ? "in spec" : "")}</span>
              <ImportancePill importance={q.importance} />
            </div>
            <blockquote>“{q.quote}”</blockquote>
            <figcaption className="rm-meta">
              <span>{[q.name, company].filter(Boolean).join(" · ") || "Someone"}</span>
              <span>·</span><SourceIcon source={q.source} />
              <button type="button" className="rm-link" onClick={() => to.quote(q.id)}>{sourceWord(q.source)} · {monthDay(q.said_at)}</button>
              {deal && deal.text !== "No deal" ? <span className="rm-deal">{deal.text.replace(/ · .*/, "")}</span> : null}
            </figcaption>
          </figure>
        );
      })}
      {quotes && list.length > shown ? <Button size="sm" variant="ghost" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</Button> : null}
      {quotes && !list.length ? <p className="c-faint rm-small">{kind === "all" ? "No quotes filed under it yet." : "None."}</p> : null}
      <p className="c-faint rm-small rm-qnote">
        Showing {Math.min(shown, list.length)} of {list.length}.{askOnly ? ` ${plural(askOnly, "person", "people")} asked with no words filed.` : ""} Quotes from a member's own mail arrive only once they share them.
      </p>
    </div>
  );
}
