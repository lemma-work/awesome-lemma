// The weekly review: counted from the team's deals with no model (what moved,
// what went quiet, the pipeline by stage, what closes soon), and on the
// team's day one summary written from those counts.

import { useEffect, useState } from "react";
import { ArrowRight, CalendarClock, CalendarDays, MoonStar, RefreshCw, Sparkles, TrendingUp } from "lucide-react";
import {
  Button, Card, Empty, Logo, Pill, Skeleton, agoText, client, day, money, moneyShort, plural, runFunction, useToast,
} from "@lemma-plugins/kit";
import { scheduleReview, useDeals } from "./data";
import { fieldWord, valueText } from "./marks";
import { to } from "./route";
import type { Review, ReviewCounts } from "./types";

const DAY_WORD: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

export function ReviewPage() {
  const { reviews, settings, me, reload, currency } = useDeals();
  const toast = useToast();
  const [live, setLive] = useState<ReviewCounts | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const count = async () => {
    setFailed(null);
    try {
      const out = await runFunction<{ counts: ReviewCounts }>("deals_review", { mode: "count" });
      setLive(out.counts);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void count();
  }, []);

  const written = reviews.filter((r) => r.summary_state === "ready" || r.summary_state === "writing");
  const shown: Review | undefined = picked ? reviews.find((r) => r.id === picked) : written[0];
  const counts = picked && shown?.counts ? shown.counts : live;

  const writeNow = async () => {
    if (!settings) return;
    setWriting(true);
    try {
      const id = await scheduleReview(settings, me);
      await (client.schedules as unknown as { runNow: (id: string) => Promise<unknown> }).runNow(id);
      toast("Counting the week and writing the summary. It lands here in under a minute.");
      window.setTimeout(() => void reload("reviews"), 20000);
      window.setTimeout(() => void reload("reviews"), 45000);
    } catch (e) {
      toast(`Couldn't start it: ${e instanceof Error ? e.message : e}`);
    } finally {
      setWriting(false);
    }
  };

  return (
    <main className="c-body dt-review">
      <div className="dt-review__head">
        <div>
          <h1>Weekly review</h1>
          <p className="c-muted">
            {counts ? `${day(counts.window.from)} to ${day(counts.window.to)}. ` : ""}
            Counted from the team's deals. {settings ? `A summary is written every ${DAY_WORD[settings.review_day] || settings.review_day} at ${settings.review_time}.` : ""}
          </p>
        </div>
        <span className="c-grow" />
        <Button icon={RefreshCw} variant="ghost" onClick={() => { setPicked(null); void count(); }}>Count again</Button>
        <Button icon={Sparkles} busy={writing} onClick={() => void writeNow()}>Write it now</Button>
      </div>

      {shown && shown.summary ? (
        <section className="dt-summary" aria-label="The week's summary">
          <div className="dt-summary__head">
            <Pill tone="ai" icon={Sparkles}>Written by the Lemma</Pill>
            <span className="c-faint">from the counts below · {day(shown.week_start)} to {day(shown.week_end)}{shown.summary_at ? ` · ${agoText(shown.summary_at)}` : ""}</span>
          </div>
          <p>{shown.summary}</p>
        </section>
      ) : shown?.summary_state === "writing" ? (
        <section className="dt-summary"><p className="c-muted">Writing this week's summary…</p></section>
      ) : null}

      {failed ? (
        <div className="c-card"><Empty icon={CalendarClock} title="Couldn't count the week" action={<Button onClick={() => void count()}>Try again</Button>}>{failed}</Empty></div>
      ) : !counts ? (
        <Skeleton rows={6} kind="list" />
      ) : (
        <>
          <div className="dt-counters">
            <Counter n={counts.totals.open_amount_text} l={`open in ${plural(counts.totals.open, "deal")}`} />
            <Counter n={String(counts.totals.new)} l="new" />
            <Counter n={String(counts.totals.stage_moves)} l="moved a stage" />
            <Counter n={String(counts.totals.won)} l={counts.totals.won && counts.totals.won_amount ? `won, ${counts.totals.won_amount_text}` : "won"} />
            <Counter n={String(counts.totals.lost)} l="lost" />
            <Counter n={String(counts.totals.quiet)} l="gone quiet" />
          </div>

          <div className="c-split">
            <div className="c-stack">
              <Card title="What moved" icon={TrendingUp} count={counts.moved.length} flush>
                {counts.moved.length === 0 ? <div className="c-card__body c-muted">Nothing moved in these seven days.</div> : (
                  <div className="c-list">
                    {counts.moved.map((m) => (
                      <button key={m.id} type="button" className="c-li c-li--link dt-li-btn dt-moved" onClick={() => to.deal(m.id)}>
                        <Logo name={m.company} size={26} />
                        <span className="c-li__main">
                          <span className="dt-block"><span className="dt-strong">{m.name}</span> <span className="c-faint">· {m.company}</span></span>
                          {m.changes.slice(-3).map((c, i) => (
                            <span key={i} className="c-li__sub dt-block">
                              {fieldWord(c.field)}: {c.field === "created" ? valueText("created", c.to, m.currency || currency)
                                : `${c.from != null && c.from !== "" ? `${valueText(c.field, c.from, m.currency || currency)} → ` : ""}${valueText(c.field, c.to, m.currency || currency)}`}
                              <span className="c-faint"> · {c.by || "someone"}{c.how === "proposal" ? ", from what was said" : ""}, {day(c.at)}</span>
                            </span>
                          ))}
                        </span>
                        <ArrowRight size={14} className="c-faint" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}
              </Card>

              <Card title="Gone quiet" icon={MoonStar} count={counts.quiet.length} flush>
                {counts.quiet.length === 0 ? <div className="c-card__body c-muted">Everyone on the open deals has been in touch with someone on the team lately.</div> : (
                  <div className="c-list">
                    {counts.quiet.map((qd) => (
                      <button key={qd.id} type="button" className="c-li c-li--link dt-li-btn" onClick={() => to.deal(qd.id)}>
                        <Logo name={qd.company} size={26} />
                        <span className="c-li__main">
                          <span className="dt-block"><span className="dt-strong">{qd.name}</span> <span className="c-faint">· {qd.company}</span></span>
                          <span className="c-li__sub dt-block">{qd.people.join(", ")}: last contact {qd.days != null ? `${qd.days} days ago` : "unknown"}{qd.last_contact_by ? `, by ${qd.last_contact_by}` : ""}</span>
                        </span>
                        <Pill tone="warning">{qd.warmth === "cold" ? "Cold" : "Cooling"}</Pill>
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <div className="c-stack">
              <Card title="Pipeline by stage" icon={TrendingUp}>
                <StageBars counts={counts} />
              </Card>
              <Card title="Closing in two weeks" icon={CalendarDays} count={counts.closing_soon.length} flush>
                {counts.closing_soon.length === 0 ? <div className="c-card__body c-muted">No open deal has a close date in the next fourteen days.</div> : (
                  <div className="c-list">
                    {counts.closing_soon.map((c) => (
                      <button key={c.id} type="button" className="c-li c-li--link dt-li-btn" onClick={() => to.deal(c.id)}>
                        <span className="c-li__main">
                          <span className="c-ellipsis dt-block dt-strong">{c.name}</span>
                          <span className="c-li__sub dt-block">{c.company} · {c.stage}{c.amount != null ? ` · ${money(Number(c.amount), c.currency)}` : ""}</span>
                        </span>
                        <span className="num c-muted">{day(c.close_date)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Card>
              {written.length > 1 ? (
                <Card title="Earlier reviews" icon={CalendarClock} flush>
                  <div className="c-list">
                    {written.map((r) => (
                      <button key={r.id} type="button" className={`c-li c-li--link dt-li-btn${shown?.id === r.id ? " is-picked" : ""}`} onClick={() => setPicked(r.id === written[0].id ? null : r.id)}>
                        <span className="c-li__main">{day(r.week_start)} to {day(r.week_end)}</span>
                        <span className="c-faint">{r.counts ? moneyShort(r.counts.totals.open_amount, r.counts.currency) : ""}</span>
                      </button>
                    ))}
                  </div>
                </Card>
              ) : null}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function Counter({ n, l }: { n: string; l: string }) {
  return (
    <div className="c-counter">
      <div className="c-counter__n">{n}</div>
      <div className="c-counter__l">{l}</div>
    </div>
  );
}

function StageBars({ counts }: { counts: ReviewCounts }) {
  const max = Math.max(1, ...counts.stages.map((s) => s.amount));
  if (!counts.stages.length) return <p className="c-muted">No open stages.</p>;
  return (
    <div className="dt-bars" role="table" aria-label="Open pipeline by stage">
      {counts.stages.map((s) => (
        <div key={s.stage} className="dt-bars__row" role="row">
          <span role="cell" className="dt-bars__name">{s.stage}</span>
          <span role="cell" className="dt-bars__track" aria-hidden="true"><span style={{ width: `${Math.max(s.amount ? 3 : 0, (100 * s.amount) / max)}%` }} /></span>
          <span role="cell" className="dt-bars__n num">{s.deals}</span>
          <span role="cell" className="dt-bars__amt num">{s.amount ? s.amount_text : "—"}</span>
        </div>
      ))}
    </div>
  );
}
