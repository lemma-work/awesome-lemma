// C · This week: what is rising and what is quieter against the four weeks
// before, what is said about rivals, the nightly pass's cards (a suggested
// feature to add, merge or drop; a likely duplicate to merge or keep apart),
// and where listening stands, with Bright Data's records.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Sparkles } from "lucide-react";
import { Button, Pill, Skeleton, agoText, errorText, useToast } from "@lemma-plugins/kit";
import { SOURCE_WORD, call, companies, featureOf, people, useNarrow, useUF, whereSaid, whoSaid, type Feature, type Quote, type UF, word } from "./data";
import { FeaturePicker } from "./Inbox";
import { quotesUnder } from "./Features";
import { to } from "./route";
import { Top } from "./Top";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

function fmt(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

export function Week({ back }: { back: number }) {
  const uf = useUF();
  const narrow = useNarrow();
  const end = Date.now() - back * WEEK;
  const start = end - WEEK;
  const inWeek = (q: Quote, b = 0) => { const t = new Date(q.said_at).getTime(); return t >= start - b * WEEK && t < end - b * WEEK; };
  const kept = uf.quotes.filter((q) => q.state !== "set_aside");
  const week = kept.filter((q) => inWeek(q));
  const ours = (q: Quote) => uf.productById.get(q.product_id || "")?.role !== "rival";

  const rows = useMemo(() => {
    // Every feature but the top-level areas; an improvement's quotes count for the feature it improves too.
    const hasKids = (f: Feature) => uf.features.some((k) => k.parent_id === f.id && (k.state === "active" || k.state === "suggested"));
    const candidates = uf.features.filter((f) => (f.state === "active" || f.state === "suggested") && !(!f.parent_id && hasKids(f)));
    return candidates.map((f) => {
      const qs = quotesUnder(f, uf, !!f.parent_id).filter(ours);
      const bars = Array.from({ length: 8 }, (_, i) => qs.filter((q) => inWeek(q, 7 - i)).length);
      const now = bars[7];
      const usual = Math.round(((bars[3] + bars[4] + bars[5] + bars[6]) / 4) * 10) / 10;
      const thisWeek = qs.filter((q) => inWeek(q));
      const before = new Set(qs.filter((q) => [1, 2, 3, 4].some((b) => inWeek(q, b))).map((q) => q.handle || q.id)).size / 4;
      const probs = Array.from({ length: 8 }, (_, i) => qs.filter((q) => q.kind === "problem" && inWeek(q, 7 - i)).length);
      return { f, qs, bars, now, usual, thisWeek, morePeople: people(thisWeek) - before, probs };
    });
  }, [uf, start]); // eslint-disable-line react-hooks/exhaustive-deps

  const rising = rows.filter((r) => r.now >= r.usual + 2 && r.morePeople >= 3).sort((a, b) => (b.now - b.usual) - (a.now - a.usual)).slice(0, 6);
  const quieter = rows.filter((r) => {
    const usualP = (r.probs[3] + r.probs[4] + r.probs[5] + r.probs[6]) / 4;
    return usualP >= 2 && r.probs[7] <= usualP / 2;
  }).slice(0, 3);
  const rivals = uf.products.filter((p) => p.role === "rival");
  const rivalRows = rivals.map((p) => {
    const qs = kept.filter((q) => (q.product_id === p.id || q.compared_with.includes(p.id)) && [0, 1, 2, 3].some((b) => inWeek(q, b)));
    const byF = new Map<string, number>();
    for (const q of qs) { const f = featureOf(q, uf); if (f) byF.set(f.name, (byF.get(f.name) || 0) + 1); }
    const top = [...byF.entries()].sort((a, b) => b[1] - a[1])[0];
    const example = qs.find((q) => q.kind === "problem" || q.kind === "comparison") || qs[0];
    return { p, qs, problems: qs.filter((q) => q.kind === "problem" && q.product_id === p.id).length, top: top?.[0] || "", example };
  }).filter((r) => r.qs.length);

  if (!uf.loaded) return <div className="c-app"><Top here="week" /><Skeleton rows={8} /></div>;
  const range = `${fmt(new Date(start + DAY / 2))} – ${fmt(new Date(end - DAY / 2))}`;
  return (
    <div className="c-app uf-app">
      <Top here="week" extra={!narrow ? <WeekNav back={back} range={range} /> : null} />
      {narrow ? <div className="uf-bar"><WeekNav back={back} range={range} /></div> : null}
      <div className="uf-counters">
        <Counter n={week.length} label="new quotes" />
        <Counter n={people(week)} label="people" />
        <Counter n={companies(week)} label="companies" />
        <Counter n={week.filter((q) => q.is_public).length} label="said in public" />
        <Counter n={week.filter((q) => q.importance === "blocker").length} label="blockers" danger />
        <Counter n={uf.quotes.filter((q) => q.state === "new").length} label="still to file" />
      </div>
      <div className="uf-wwrap">
        <section className="uf-wmain">
          <div>
            <div className="uf-h"><h2>Rising</h2><span className="uf-small c-faint">This week against the average of the four weeks before, and at least three more people</span></div>
            <div className="uf-tr uf-tr--head" aria-hidden="true"><span>Feature</span><span className="num">This week</span><span className="num">Usually</span><span className="uf-hide">Last 8 weeks</span><span className="uf-hide">What they say</span></div>
            {rising.map((r) => <TrendRow key={r.f.id} uf={uf} f={r.f} now={r.now} usual={r.usual} bars={r.bars} sub={`${people(r.thisWeek)} ${word(people(r.thisWeek), "person", "people")} · ${companies(r.thisWeek)} ${word(companies(r.thisWeek), "company", "companies")}${r.thisWeek.filter((q) => q.importance === "blocker").length ? ` · ${r.thisWeek.filter((q) => q.importance === "blocker").length} ${word(r.thisWeek.filter((q) => q.importance === "blocker").length, "blocker")}` : ""}`}
              example={r.thisWeek.find((q) => q.importance === "blocker") || r.thisWeek[0]} />)}
            {!rising.length ? <p className="uf-pad c-faint">Nothing is rising this week: no feature has at least three more people than usual.</p> : null}
          </div>
          <div>
            <div className="uf-h"><h2>Quieter</h2><span className="uf-small c-faint">Fewer problems than usual</span></div>
            {quieter.map((r) => {
              const usualP = (r.probs[3] + r.probs[4] + r.probs[5] + r.probs[6]) / 4;
              const praise = r.thisWeek.filter((q) => q.kind === "praise");
              return <TrendRow key={r.f.id} uf={uf} f={r.f} now={r.probs[7]} usual={Math.round(usualP * 10) / 10} bars={r.probs}
                sub={r.f.stage === "live" && r.f.stage_at && Date.now() - new Date(r.f.stage_at).getTime() < 60 * DAY ? `Live since ${new Date(r.f.stage_at).toLocaleDateString(undefined, { day: "numeric", month: "long" })}` : "Problems per week"}
                example={praise[0] || r.thisWeek[0]} exampleNote={praise.length ? `praise this week: ${praise.length}` : undefined} label="Problems per week" />;
            })}
            {!quieter.length ? <p className="uf-pad c-faint">No feature has fewer problems than usual this week.</p> : null}
          </div>
          <div>
            <div className="uf-h"><h2>About your rivals</h2><span className="uf-small c-faint">The last four weeks: public posts and comparisons, filed under your own features</span></div>
            {rivalRows.length ? <div className="uf-tr uf-tr--head" aria-hidden="true"><span>Rival</span><span className="num">Quotes</span><span className="num">Problems</span><span className="uf-hide">Most said about</span><span className="uf-hide">Example</span></div> : null}
            {rivalRows.map((r) => (
              <div key={r.p.id} className="uf-tr">
                <span className="uf-b">{r.p.name}</span>
                <span className="num">{r.qs.length}</span>
                <span className="num">{r.problems}</span>
                <span className="uf-hide uf-small">{r.top}</span>
                <span className="uf-hide uf-ev">“{r.example?.quote}”<small>{r.example ? `${whereSaid(r.example, null)}${r.example.compared_with.length && r.example.product_id !== r.p.id ? " · compared with yours" : ""}` : ""}</small></span>
              </div>
            ))}
            {!rivalRows.length ? <p className="uf-pad c-faint">{rivals.length ? "Nothing said about your rivals in the last four weeks." : "No rivals yet. Add them in Settings, or with Competitor watch."}</p> : null}
          </div>
        </section>
        <aside className="uf-wside">
          <Suggestions uf={uf} />
          <Listening uf={uf} />
        </aside>
      </div>
    </div>
  );
}

function WeekNav({ back, range }: { back: number; range: string }) {
  return (
    <span className="uf-weeknav">
      <Button size="sm" variant="ghost" icon={ChevronLeft} label="Previous week" onClick={() => to.week(back + 1)} />
      <span className="uf-b">{range}</span>
      <Button size="sm" variant="ghost" icon={ChevronRight} label="Next week" disabled={back === 0} onClick={() => to.week(back - 1)} />
    </span>
  );
}

function Counter({ n, label, danger }: { n: number; label: string; danger?: boolean }) {
  return <div className="uf-counter"><div className={`uf-counter__n${danger && n ? " uf-danger" : ""}`}>{n}</div><div className="uf-small c-faint">{label}</div></div>;
}

function TrendRow({ uf, f, now, usual, bars, sub, example, exampleNote, label = "Quotes per week" }: {
  uf: UF; f: Feature; now: number; usual: number; bars: number[]; sub: string; example?: Quote; exampleNote?: string; label?: string;
}) {
  const max = Math.max(1, ...bars);
  return (
    <div className="uf-tr">
      <span className="uf-tr__name">
        <button type="button" className="uf-link uf-b" onClick={() => to.feature(f.id)}>{f.name}</button>
        {f.state === "suggested" ? <Pill tone="ai">Suggested</Pill> : null}
        <span className="uf-small c-faint uf-block">{sub}</span>
      </span>
      <span className="num uf-b">{now}</span>
      <span className="num c-faint">{usual}</span>
      <span className="uf-bars uf-hide" role="img" aria-label={`${label} for 8 weeks: ${bars.join(", ")}`}>
        {bars.map((b, i) => <i key={i} className={i === 7 ? "is-now" : ""} style={{ height: `${Math.max(3, Math.round((b / max) * 26))}px` }} />)}
      </span>
      <span className="uf-hide uf-ev">{example ? <>“{example.quote}”<small>{whoSaid(example, uf)} · {whereSaid(example, null)}{exampleNote ? ` · ${exampleNote}` : ""}</small></> : null}</span>
    </div>
  );
}

function Suggestions({ uf }: { uf: UF }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [merging, setMerging] = useState<string | null>(null);
  const suggested = uf.features.filter((f) => f.state === "suggested");
  const dupes = (uf.settings?.duplicates || []).filter((d) => uf.featureById.get(d.a) && uf.featureById.get(d.b)
    && ["active", "suggested"].includes(uf.featureById.get(d.a)!.state));
  const act = async (key: string, input: Record<string, unknown>) => {
    setBusy(key);
    try {
      const out = await call("user_feedback_feature", input);
      toast(String(out.message || "Done."));
      await uf.reload();
    } catch (e) {
      toast(`Couldn't do that: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const dupIds = new Set(dupes.map((d) => d.a));
  return (
    <>
      {suggested.filter((f) => !dupIds.has(f.id)).slice(0, 2).map((f) => {
        const qs = quotesUnder(f, uf, false);
        return (
          <div key={f.id} className="uf-card">
            <div className="uf-card__head"><Sparkles size={14} aria-hidden="true" className="c-faint" /><span className="uf-b c-grow">A feature you don't have yet</span><Pill tone="ai">Suggested</Pill></div>
            <div><button type="button" className="uf-link uf-card__title" onClick={() => to.feature(f.id)}>{f.name}</button>
              <div className="uf-small c-faint">{qs.length} {word(qs.length, "quote")} from {companies(qs) || people(qs)} {companies(qs) ? word(companies(qs), "company", "companies") : word(people(qs), "person", "people")} fit nothing on your list</div></div>
            {qs.slice(0, 2).map((q) => <div key={q.id} className="uf-ev">“{q.quote}”<small>{whoSaid(q, uf)} · {whereSaid(q, null)}</small></div>)}
            <div className="uf-row-btns">
              <Button size="sm" variant="primary" busy={busy === `a${f.id}`} onClick={() => void act(`a${f.id}`, { action: "accept", id: f.id })}>Add to the list</Button>
              <Button size="sm" onClick={() => setMerging(f.id)}>Merge into…</Button>
              <Button size="sm" variant="ghost" busy={busy === `d${f.id}`} onClick={() => void act(`d${f.id}`, { action: "drop", id: f.id })}>Drop</Button>
            </div>
          </div>
        );
      })}
      {dupes.slice(0, 2).map((d) => {
        const a = uf.featureById.get(d.a)!;
        const b = uf.featureById.get(d.b)!;
        return (
          <div key={`${d.a}${d.b}`} className="uf-card">
            <div className="uf-card__head"><Copy size={14} aria-hidden="true" className="c-faint" /><span className="uf-b c-grow">Looks like the same feature</span></div>
            <div className="uf-small"><span className="uf-b">{a.name}</span> ({a.state === "suggested" ? "suggested, " : ""}{quotesUnder(a, uf, false).length} {word(quotesUnder(a, uf, false).length, "quote")}) and <span className="uf-b">{b.name}</span> ({quotesUnder(b, uf, false).length} {word(quotesUnder(b, uf, false).length, "quote")})</div>
            <div className="uf-small c-faint">The Lemma read {a.name}'s quotes against your list and says {b.name} is the same thing{d.confidence != null ? `, ${d.confidence >= 0.8 ? "sure" : "fairly sure"}` : ""}.</div>
            <div className="uf-row-btns">
              <Button size="sm" variant="primary" busy={busy === `m${d.a}`} onClick={() => void act(`m${d.a}`, { action: "merge", id: a.id, into: b.id })}>Merge into {b.name}</Button>
              <Button size="sm" busy={busy === `k${d.a}`} onClick={() => void act(`k${d.a}`, { action: "keep_apart", id: a.id, into: b.id })}>Keep apart</Button>
            </div>
          </div>
        );
      })}
      {!suggested.length && !dupes.length ? (
        <div className="uf-card"><div className="uf-card__head"><Sparkles size={14} aria-hidden="true" className="c-faint" /><span className="uf-b">Nothing to add or merge</span></div>
          <div className="uf-small c-faint">Each night the Lemma groups quotes that fit no feature. Three or more about one thing become a suggestion here.</div></div>
      ) : null}
      <FeaturePicker open={!!merging} uf={uf} current={null} exclude={merging || undefined} title="Merge into" onClose={() => setMerging(null)}
        onPick={(into) => { const id = merging; setMerging(null); if (id) void act(`m${id}`, { action: "merge", id, into }); }} />
    </>
  );
}

function Listening({ uf }: { uf: UF }) {
  const s = uf.settings;
  const hn = uf.listens.find((l) => l.source === "hn");
  const weekAgo = Date.now() - WEEK;
  const bd = uf.listens.filter((l) => l.source !== "hn");
  const records = bd.filter((l) => l.started_at && new Date(l.started_at).getTime() > weekAgo).reduce((n, l) => n + l.records, 0);
  const sharers = new Set(uf.quotes.filter((q) => q.heard_by && (q.source === "mail" || q.source === "meeting") && new Date(q.said_at).getTime() > Date.now() - 28 * DAY).map((q) => q.heard_by)).size;
  const sources = (s?.brightdata_sources || []).map((x) => SOURCE_WORD[x] || x);
  const failed = bd.find((l) => l.state === "failed" && l.started_at && new Date(l.started_at).getTime() > weekAgo);
  return (
    <div className="uf-card">
      <span className="uf-b">Listening</span>
      <div className="uf-lrow"><span>Mail and meetings<span className="uf-small c-faint uf-block">{sharers ? `${sharers} ${word(sharers, "person", "people")} shared quotes in the last four weeks` : "Each member's own, shared when they say so"}{uf.member?.auto_share ? " · you share on your own" : ""}</span></span>
        {uf.member && uf.member.read_mail === false && uf.member.read_meetings === false ? <Pill tone="plain">Off for you</Pill> : <Pill tone="success">On</Pill>}</div>
      <div className="uf-lrow"><span>Hacker News<span className="uf-small c-faint uf-block">{s?.hn === false ? "Turned off" : hn?.finished_at ? `Read ${agoText(hn.finished_at)} · free` : "Free · reads every hour"}</span></span>
        {s?.hn === false ? <Pill tone="plain">Off</Pill> : <Pill tone="success">On</Pill>}</div>
      <div className="uf-lrow"><span>{sources.length ? sources.join(", ") : "YouTube, X, Reddit, TikTok, LinkedIn"}<span className="uf-small c-faint uf-block">{s?.brightdata_account_id && sources.length ? `Your Bright Data key · ${records.toLocaleString()} ${word(records, "record")} billed this week` : "Through your own Bright Data key, off until you add it"}{failed ? " · a run didn't start, see Settings" : ""}</span></span>
        {s?.brightdata_account_id && sources.length ? <Pill tone={failed ? "warning" : "success"}>{failed ? "Needs a look" : "On"}</Pill> : <Button size="sm" onClick={() => to.settings()}>Set up</Button>}</div>
      {(s?.brightdata_sources || []).includes("reddit") ? <div className="uf-lrow"><span>Reddit<span className="uf-small c-faint uf-block">Through Bright Data</span></span><Pill tone="warning">Its public API closes March 2027</Pill></div> : null}
      <div className="uf-lrow uf-lrow--last"><span>A Slack channel<span className="uf-small c-faint uf-block">Reading a channel the team names</span></span><Pill tone="plain">Not available yet</Pill></div>
    </div>
  );
}

