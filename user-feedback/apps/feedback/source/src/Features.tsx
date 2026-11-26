// B · A feature and everything said about it. Left: the feature list by area
// with people, companies, blockers and this week. Main: the feature's facts,
// its quotes grouped by company with each company's deal, then what rivals'
// users say about the same thing. Side: owner, linked work, other names, what
// it is, improvements (child features), who is told when it ships.

import { useMemo, useState } from "react";
import { ArrowLeft, GitMerge, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Empty, Field, Pill, SearchField, Segmented, Sheet, Skeleton, ago, errorText, money, moneyShort, useToast } from "@lemma-plugins/kit";
import {
  KIND_WORD, call, companies, featureOf, parentOf, people, since, useNarrow, useUF, useWho, weekly, whereSaid, whoSaid,
  type Feature, type Kind, type Quote, type UF, word,
} from "./data";
import { FeaturePicker, ImpPill, KindPill, NewFeatureSheet } from "./Inbox";
import { to } from "./route";
import { Top } from "./Top";

type Period = "7" | "30" | "90";
type Group = "company" | "newest" | "rivals";
type KindFilter = "all" | "problem" | "request" | "praise";

const STAGE: Record<string, { word: string; tone: "plain" | "info" | "success" | "warning" | "danger" }> = {
  idea: { word: "Idea", tone: "plain" }, planned: { word: "Planned", tone: "info" }, building: { word: "Building", tone: "info" },
  beta: { word: "Beta", tone: "warning" }, live: { word: "Live", tone: "success" }, declined: { word: "Declined", tone: "danger" },
};

export function StagePill({ stage }: { stage: string }) {
  const s = STAGE[stage] || STAGE.idea;
  return <Pill tone={s.tone}>{s.word}</Pill>;
}

/** Quotes under a feature (and, for an area, under its children). */
export function quotesUnder(f: Feature, uf: UF, withKids = true): Quote[] {
  const ids = new Set([f.id, ...(withKids ? uf.features.filter((k) => k.parent_id === f.id).map((k) => k.id) : [])]);
  return uf.quotes.filter((q) => q.state !== "set_aside" && (() => { const g = featureOf(q, uf); return !!g && ids.has(g.id); })());
}

export function stats(list: Quote[], uf: UF, now = Date.now()) {
  const ours = list.filter((q) => uf.productById.get(q.product_id || "")?.role !== "rival");
  const w = weekly(ours, 8, now);
  const usual = (w[3] + w[4] + w[5] + w[6]) / 4;
  const cos = new Set(ours.map((q) => q.company_id).filter(Boolean) as string[]);
  let open = 0;
  let won = 0;
  let currency: string | null = null;
  for (const c of cos) {
    const d = uf.dealOf.get(c);
    if (!d) continue;
    currency = currency || d.currency;
    if (d.status === "open") open += d.amount || 0;
    else if (d.status === "won") won += d.amount || 0;
  }
  return {
    quotes: ours.length, people: people(ours), companies: companies(ours), blockers: ours.filter((q) => q.importance === "blocker").length,
    week: w[7], usual: Math.round(usual * 10) / 10, weeks: w, open, won, currency, rivals: list.length - ours.length,
  };
}

export function Features({ id }: { id: string | null }) {
  const uf = useUF();
  const narrow = useNarrow();
  const [period, setPeriod] = useState<Period>("30");
  const [find, setFind] = useState("");
  const [creating, setCreating] = useState(false);
  const cut = since(Number(period));
  const recent = useMemo(() => ({ ...uf, quotes: uf.quotes.filter((q) => new Date(q.said_at).getTime() >= cut) }), [uf, cut]);
  const live = uf.features.filter((f) => f.state === "active" || f.state === "suggested");
  const selected = id ? uf.featureById.get(id) || null : null;
  const fallback = !narrow && !selected ? live.filter((f) => f.parent_id && f.state === "active")
    .sort((a, b) => quotesUnder(b, recent).length - quotesUnder(a, recent).length)[0] || null : null;
  const shown = selected || fallback;

  if (!uf.loaded) return <div className="c-app"><Top here="features" /><Skeleton rows={8} /></div>;
  const list = (
    <nav className="uf-flist" aria-label="Features">
      <div className="uf-flist__find"><SearchField value={find} onChange={setFind} placeholder="Find a feature" /></div>
      <FeatureTable uf={uf} recent={recent} find={find} current={shown?.id || null} />
    </nav>
  );
  return (
    <div className="c-app uf-app">
      <Top here="features" extra={!narrow ? (
        <>
          <Segmented<Period> label="Period" value={period} onChange={setPeriod}
            items={[{ id: "7", label: "Last 7 days" }, { id: "30", label: "Last 30 days" }, { id: "90", label: "Last 90 days" }]} />
          <Button icon={Plus} onClick={() => setCreating(true)}>New feature</Button>
        </>
      ) : null} />
      {narrow && !selected ? (
        <div className="uf-bar">
          <Segmented<Period> label="Period" value={period} onChange={setPeriod}
            items={[{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }]} />
          <span className="c-grow" />
          <Button icon={Plus} size="sm" onClick={() => setCreating(true)}>New</Button>
        </div>
      ) : null}
      <div className="uf-fwrap">
        {!narrow || !selected ? list : null}
        {shown && (!narrow || selected) ? <FeaturePage f={shown} uf={uf} recent={recent} period={period} /> : null}
        {!shown && !narrow ? <main className="uf-fmain"><Empty title="No features yet" action={<Button onClick={() => setCreating(true)}>Add one</Button>}>Add the team's features in set-up, or let the Lemma propose them from what people say.</Empty></main> : null}
      </div>
      <NewFeatureSheet open={creating} uf={uf} onClose={() => setCreating(false)} onMade={(fid) => { setCreating(false); to.feature(fid); }} />
    </div>
  );
}

function FeatureTable({ uf, recent, find, current }: { uf: UF; recent: UF; find: string; current: string | null }) {
  const needle = find.trim().toLowerCase();
  const active = uf.features.filter((f) => f.state === "active");
  const tops = active.filter((f) => !f.parent_id);
  const hit = (f: Feature) => !needle || `${f.name} ${f.aliases.join(" ")}`.toLowerCase().includes(needle);
  const areas = tops.filter((t) => active.some((k) => k.parent_id === t.id));
  const lone = tops.filter((t) => !areas.includes(t));
  const groups = [
    ...areas.map((t) => ({ top: t, label: t.name, items: active.filter((k) => k.parent_id === t.id).filter((k) => hit(k) || active.some((g) => g.parent_id === k.id && hit(g))) })),
    ...(lone.length ? [{ top: lone[0], label: areas.length ? "Other features" : "Features", items: lone.filter(hit) }] : []),
  ].filter((g) => g.items.length);
  const suggested = uf.features.filter((f) => f.state === "suggested" && hit(f));
  const row = (f: Feature, sug = false) => {
    const s = stats(quotesUnder(f, recent), uf);
    const all = stats(quotesUnder(f, uf), uf);
    const up = all.week >= all.usual + 3;
    return (
      <button key={f.id} type="button" className={`uf-frow${f.id === current ? " is-on" : ""}`} onClick={() => to.feature(f.id)} aria-current={f.id === current}>
        <span className="uf-frow__name"><span className="c-ellipsis">{f.name}</span>{sug ? <Pill tone="ai">Suggested</Pill> : null}</span>
        <span className="num">{s.people || "·"}</span>
        <span className="num">{s.companies || "·"}</span>
        <span className="num">{s.blockers || "·"}</span>
        <span className={`num${up ? " uf-up" : " c-faint"}`}>{all.week ? `+${all.week}` : "·"}</span>
      </button>
    );
  };
  return (
    <div>
      <div className="uf-frow uf-frow--head" aria-hidden="true"><span>Feature</span><span className="num">People</span><span className="num">Cos.</span><span className="num">Blockers</span><span className="num">This wk</span></div>
      {groups.map((g) => (
        <div key={g.label}>
          <div className="uf-grp">{g.label}</div>
          {g.items.map((f) => row(f))}
        </div>
      ))}
      {suggested.length ? (
        <div>
          <div className="uf-grp">Not on the list yet</div>
          {suggested.map((f) => row(f, true))}
        </div>
      ) : null}
      {!groups.length && !suggested.length ? <p className="uf-pad c-faint">No feature by that name.</p> : null}
    </div>
  );
}

function FeaturePage({ f, uf, recent, period }: { f: Feature; uf: UF; recent: UF; period: Period }) {
  const narrow = useNarrow();
  const { me } = useWho();
  const toast = useToast();
  const [group, setGroup] = useState<Group>("company");
  const [kind, setKind] = useState<KindFilter>("all");
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [improving, setImproving] = useState(false);
  const [busy, setBusy] = useState("");
  const parent = parentOf(f, uf);
  const isArea = uf.features.some((k) => k.parent_id === f.id);
  const all = quotesUnder(f, recent, isArea);
  const s = stats(quotesUnder(f, uf, isArea), uf);
  const sp = stats(all, uf);
  const ours = all.filter((q) => uf.productById.get(q.product_id || "")?.role !== "rival");
  const rivals = all.filter((q) => uf.productById.get(q.product_id || "")?.role === "rival");
  const counts: Record<KindFilter, number> = {
    all: ours.length, problem: ours.filter((q) => q.kind === "problem").length,
    request: ours.filter((q) => q.kind === "request").length, praise: ours.filter((q) => q.kind === "praise").length,
  };
  const shown = ours.filter((q) => kind === "all" || q.kind === kind);
  const kids = uf.features.filter((k) => k.parent_id === f.id && (k.state === "active" || k.state === "suggested"));
  const asks = uf.asks.filter((a) => ((a.work_source === "feature" && a.work_id === f.id) || (f.work_id && a.work_id === f.work_id))
    && ["open", "shipped", "suggested"].includes(a.state));
  const askers = new Set(asks.map((a) => `${a.handle_kind}:${a.handle}`)).size;
  const owner = f.owner_user_id ? (f.owner_user_id === me?.id ? "You" : "A member of the team") : null;

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const out = await call("user_feedback_feature", { action, id: f.id, ...extra });
      toast(String(out.message || "Done."));
      await uf.reload();
      if (action === "merge" && out.id) to.feature(String(out.id));
      if (action === "drop") to.features();
    } catch (e) {
      toast(`Couldn't do that: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };

  const byCompany = useMemo(() => {
    const m = new Map<string, Quote[]>();
    for (const q of shown) {
      const key = q.company_id || q.company_name || (q.is_public ? "Said in public" : "No company");
      m.set(key, [...(m.get(key) || []), q]);
    }
    return [...m.entries()].map(([key, qs]) => ({ key, name: qs[0].company_name || key, deal: qs[0].company_id ? uf.dealOf.get(qs[0].company_id) : null, qs }))
      .sort((a, b) => (b.deal?.status === "open" ? b.deal.amount || 0 : 0) - (a.deal?.status === "open" ? a.deal.amount || 0 : 0) || b.qs.length - a.qs.length);
  }, [shown, uf]);

  const quote = (q: Quote, withCo = false, rival = false) => (
    <div key={q.id} className="uf-qt">
      <div>
        <blockquote>“{q.quote}”</blockquote>
        <div className="uf-meta"><span className="uf-meta__who">{withCo ? whoSaid(q, uf) : (q.name || whoSaid(q, uf))}</span><span aria-hidden="true">·</span><span>{whereSaid(q, me?.id || null)}</span><span aria-hidden="true">·</span><span>{ago(q.said_at)}</span></div>
      </div>
      <div className="uf-pills">
        {rival ? <Pill tone="plain">{uf.productById.get(q.product_id || "")?.name}</Pill> : null}
        <KindPill kind={q.kind} /><ImpPill imp={q.importance} />
      </div>
    </div>
  );

  return (
    <>
      <main className="uf-fmain">
        {narrow ? <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => to.features()}>All features</Button> : null}
        <div className="uf-small c-faint">{parent ? <button type="button" className="uf-link" onClick={() => to.feature(parent.id)}>{parent.name}</button> : (isArea ? "Area" : "")}</div>
        <div className="uf-ftitle">
          <h2>{f.name}</h2>
          {f.state === "suggested" ? <Pill tone="ai">Suggested</Pill> : <StagePill stage={f.stage} />}
          {f.state === "active" ? <span className="uf-small c-faint">Stage is set by Roadmap, Early access and Release notes</span> : null}
          <span className="c-grow" />
          {f.state === "suggested" ? (
            <>
              <Button size="sm" variant="primary" busy={busy === "accept"} onClick={() => void act("accept")}>Add to the list</Button>
              <Button size="sm" icon={GitMerge} onClick={() => setMerging(true)}>Merge into…</Button>
              <Button size="sm" variant="ghost" icon={Trash2} busy={busy === "drop"} onClick={() => void act("drop")}>Drop</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>
              <Button size="sm" variant="ghost" icon={GitMerge} onClick={() => setMerging(true)}>Merge into…</Button>
            </>
          )}
        </div>
        <div className="uf-facts">
          <div className="uf-fact"><b>{sp.quotes}</b><span>{word(sp.quotes, "quote")}</span></div>
          <div className="uf-fact"><b>{sp.people}</b><span>{word(sp.people, "person", "people")}</span></div>
          <div className="uf-fact"><b>{sp.companies}</b><span>{word(sp.companies, "company", "companies")}</span></div>
          <div className="uf-fact"><b className={sp.blockers ? "uf-danger" : ""}>{sp.blockers}</b><span>say it's a blocker</span></div>
          {uf.hasDeals ? <div className="uf-fact"><b>{sp.open ? money(sp.open, sp.currency) : "None"}</b><span>open deals behind them</span></div> : null}
          <div className="uf-fact"><b>{s.week ? `+${s.week}` : "0"}</b><span>this week, usually {s.usual}</span></div>
        </div>
        <div className="uf-bar uf-bar--flush">
          <Segmented<Group> label="Group" value={group} onChange={setGroup}
            items={[{ id: "company", label: "By company", count: byCompany.length }, { id: "newest", label: "Newest" }, { id: "rivals", label: "About rivals", count: rivals.length }]} />
          <span className="c-grow" />
          {group !== "rivals" ? (
            <Segmented<KindFilter> label="Kind" value={kind} onChange={setKind}
              items={[{ id: "all", label: "All" }, { id: "problem", label: "Problems", count: counts.problem }, { id: "request", label: "Requests", count: counts.request }, { id: "praise", label: "Praise", count: counts.praise }]} />
          ) : null}
        </div>
        {group === "company" ? byCompany.map((c) => (
          <section key={c.key}>
            <div className="uf-co">
              <span className="uf-b">{c.name}</span>
              {c.deal ? <Pill tone="plain">{c.deal.status === "won" ? "Won" : "Open deal"} · {money(c.deal.amount, c.deal.currency)}</Pill> : null}
              <span className="uf-small c-faint">{c.qs.length} {word(c.qs.length, "quote")} · {people(c.qs)} {word(people(c.qs), "person", "people")}</span>
            </div>
            {c.qs.map((q) => quote(q))}
          </section>
        )) : group === "newest" ? shown.map((q) => quote(q, true)) : null}
        {group !== "rivals" && !shown.length ? <p className="uf-pad c-faint">Nothing {kind === "all" ? "" : `filed as ${KIND_WORD[kind as Kind].toLowerCase()} `}in the last {period} days.</p> : null}
        {(group === "rivals" || (group === "company" && rivals.length)) ? (
          <section>
            <div className="uf-co"><span className="uf-b">What rivals' users say about {f.name.toLowerCase()}</span><span className="uf-small c-faint">Public posts, filed under this feature</span></div>
            {rivals.map((q) => quote(q, true, true))}
            {!rivals.length ? <p className="uf-pad c-faint">Nothing about rivals on this feature in the last {period} days.</p> : null}
          </section>
        ) : null}
      </main>
      <aside className="uf-side" aria-label="About this feature">
        <dl className="uf-props">
          <div><dt>Product</dt><dd>{uf.productById.get(f.product_id)?.name || "Ours"}</dd></div>
          <div><dt>Owner</dt><dd>{owner || <span className="c-faint">Nobody yet</span>}</dd></div>
          <div><dt>Work</dt><dd>{f.work_id ? (f.work_url ? <a href={f.work_url} target="_blank" rel="noreferrer">{workLabel(f)}</a> : workLabel(f)) : <span className="c-faint">Not linked</span>}</dd></div>
          <div><dt>Also called</dt><dd>{f.aliases.length ? f.aliases.join(", ") : <span className="c-faint">Nothing else</span>}</dd></div>
          <div><dt>What it is</dt><dd className="c-muted">{f.description || <span className="c-faint">Not written yet</span>}</dd></div>
        </dl>
        <p className="uf-sec">Improvements</p>
        {kids.map((k) => (
          <button key={k.id} type="button" className="uf-child" onClick={() => to.feature(k.id)}>
            <span className="c-grow">{k.name}</span>
            {k.state === "suggested" ? <Pill tone="ai">Suggested</Pill> : <StagePill stage={k.stage} />}
            <span className="uf-small c-faint num">{quotesUnder(k, uf).length}</span>
          </button>
        ))}
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => setImproving(true)}>Add an improvement</Button>
        <p className="uf-sec">When it ships</p>
        <div className="uf-small c-muted">{askers ? `${askers} ${word(askers, "person", "people")} asked. Each is told in the thread they asked in, once.` : "Nobody has asked for it yet."}</div>
        {askers && !f.work_id ? <div className="uf-small c-faint uf-gapline">Told once it has linked work: Release notes tells people when linked work ships.</div> : null}
        <p className="uf-sec">Deal value</p>
        <div className="uf-small c-muted">{uf.hasDeals ? (s.open || s.won ? `${s.open ? `${moneyShort(s.open, s.currency)} open` : ""}${s.open && s.won ? ", " : ""}${s.won ? `${moneyShort(s.won, s.currency)} won` : ""}, at the companies that said it.` : "No deals at the companies that said it.") : "Shows with Deal tracker: open deals at the companies that said it."}</div>
      </aside>
      <EditSheet open={editing} f={f} uf={uf} onClose={() => setEditing(false)} />
      <FeaturePicker open={merging} uf={uf} current={null} exclude={f.id} title={`Merge ${f.name} into`} onClose={() => setMerging(false)}
        onPick={(into) => { setMerging(false); void act("merge", { into }); }} />
      <NewFeatureSheet open={improving} uf={uf} parent={f.id} onClose={() => setImproving(false)} onMade={(fid) => { setImproving(false); to.feature(fid); }} />
    </>
  );
}

function workLabel(f: Feature): string {
  if (f.work_source === "github" && f.work_id) return `GitHub issue ${f.work_id.includes("#") ? `#${f.work_id.split("#")[1]}` : f.work_id}`;
  if (f.work_source === "linear") return `Linear ${f.work_id}`;
  return f.work_id || "";
}

function EditSheet({ open, f, uf, onClose }: { open: boolean; f: Feature; uf: UF; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(f.name);
  const [desc, setDesc] = useState(f.description || "");
  const [aliases, setAliases] = useState(f.aliases.join(", "));
  const [parentId, setParentId] = useState(f.parent_id || "");
  const [work, setWork] = useState(f.work_url || f.work_id || "");
  const [busy, setBusy] = useState(false);
  const tops = uf.features.filter((x) => x.state === "active" && !x.parent_id && x.id !== f.id);
  const save = async () => {
    setBusy(true);
    try {
      const gh = /github\.[a-z.]+\/([^/]+\/[^/]+)\/issues\/(\d+)/.exec(work) || /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(work.trim());
      const linkChanged = work.trim() !== (f.work_url || f.work_id || "");
      const out = await call("user_feedback_feature", {
        action: "update", id: f.id, name, description: desc, parent_id: parentId || "",
        aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
        ...(linkChanged && work.trim() ? (gh ? { work_source: "github", work_id: `${gh[1]}#${gh[2]}`, work_url: work.startsWith("http") ? work.trim() : null }
          : { work_source: "link", work_id: work.trim(), work_url: work.startsWith("http") ? work.trim() : null }) : {}),
      });
      toast(String(out.message || "Saved.") + (Number(out.moved) ? ` ${out.moved} asks now point at the linked work.` : ""));
      await uf.reload();
      onClose();
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title={`Edit ${f.name}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => void save()}>Save</Button></>}>
      <Field label="Name"><input className="c-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="What it is" hint="What's in it and what isn't. Filing reads it."><textarea className="c-textarea" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <Field label="Also called" hint="Other words people use, separated by commas. Filing reads them."><input className="c-input" value={aliases} onChange={(e) => setAliases(e.target.value)} /></Field>
      <Field label="Part of">
        <select className="c-input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">Nothing: a top-level area</option>
          {tops.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <Field label="Linked work" hint="A GitHub issue's link or owner/repo#number. People who asked are told when it ships.">
        <input className="c-input" value={work} onChange={(e) => setWork(e.target.value)} placeholder="https://github.com/…/issues/412" />
      </Field>
    </Sheet>
  );
}
