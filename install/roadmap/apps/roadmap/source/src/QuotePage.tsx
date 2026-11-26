// One quote and where it was said: where a spec's footnote lands.

import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button, Empty, Header, Skeleton, openApp } from "@lemma-plugins/kit";
import { quoteById, useRoadmap } from "./data";
import { ImportancePill, SourceIcon, sourceWord } from "./marks";
import { to } from "./route";
import { dealText } from "./who";
import type { Quote } from "./types";

const KIND: Record<string, string> = { request: "A request", problem: "A problem", praise: "Praise", question: "A question", comparison: "A comparison", other: "Said" };

export function QuotePage({ id }: { id: string }) {
  const data = useRoadmap();
  const [q, setQ] = useState<Quote | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void quoteById(id).then((r) => alive && setQ(r)).catch(() => alive && setQ(null));
    return () => { alive = false; };
  }, [id]);
  const feature = q?.feature_id ? data.byId.get(q.feature_id) : undefined;
  const back = feature ? { label: feature.name, icon: ArrowLeft, onClick: () => to.feature(feature.id) } : { label: "Roadmap", icon: ArrowLeft, onClick: () => to.ranked() };
  if (q === undefined) return <Skeleton kind="record" />;
  if (!q) {
    return (
      <div className="c-app">
        <Header back={back} title="Quote" />
        <main className="c-body"><Empty title="This quote is gone">It was set aside or taken out of User feedback.</Empty></main>
      </div>
    );
  }
  const company = (q.company_id && data.companyNames.get(q.company_id)) || q.company_name;
  const deal = q.company_id ? dealText(data.deals.filter((d) => d.company_id === q.company_id), data.currency) : null;
  const when = new Date(q.said_at);
  return (
    <div className="c-app">
      <Header back={back} title="Quote" />
      <main className="c-body rm-quotepage">
        <div className="rm-line"><ImportancePill importance={q.importance} /><span className="c-faint">{KIND[q.kind] || "Said"}</span></div>
        <blockquote className="rm-bigquote">“{q.quote}”</blockquote>
        {q.point ? <p className="c-muted">{q.point}</p> : null}
        <dl className="c-props rm-props">
          <dt>Who</dt><dd>{q.name || q.handle || "Someone, unnamed"}</dd>
          <dt>Company</dt><dd>{q.company_id ? <button type="button" className="rm-link" onClick={() => void openApp("companies", `/${q.company_id}`)}>{company}</button> : company || "No company"}</dd>
          <dt>Where</dt><dd className="rm-line"><SourceIcon source={q.source} />{sourceWord(q.source)} · {Number.isNaN(when.getTime()) ? "" : when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd>
          <dt>Filed under</dt><dd>{feature ? <button type="button" className="rm-link" onClick={() => to.feature(feature.id)}>{feature.name}</button> : "Nothing yet"}</dd>
          {deal ? <><dt>Their deal</dt><dd>{deal.id ? <button type="button" className="rm-link" onClick={() => void openApp("deals", `/${deal.id}`)}>{deal.text}</button> : deal.text}</dd></> : null}
        </dl>
        {q.source_url ? <Button size="sm" icon={ExternalLink} onClick={() => window.open(q.source_url!, "_blank", "noopener")}>Open where it was said</Button> : null}
      </main>
    </div>
  );
}
