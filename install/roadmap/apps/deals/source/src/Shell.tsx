// The app once set up: one header with the places (the pipeline, what is
// waiting for the person, the weekly review, settings) and a page per deal.

import { type ReactNode } from "react";
import { CalendarClock, KanbanSquare, Settings as Cog, Sparkles } from "lucide-react";
import { AskButton, Banner, Button, Header } from "@lemma-plugins/kit";
import { OPTIONAL, useDeals } from "./data";
import { Pipeline, Waiting } from "./Board";
import { DealPage } from "./DealPage";
import { ReviewPage } from "./Review";
import { to, useRoute } from "./route";
import { SettingsPage } from "./Settings";

export function Shell() {
  const route = useRoute();
  const { sample, errors, reload, deals, changes } = useDeals();
  const errs = Object.entries(errors).filter(([name, v]) => v && !OPTIONAL.has(name));

  let page: ReactNode;
  if (route.page === "deal") page = <DealPage id={route.id} />;
  else {
    const open = deals.filter((d) => d.status === "open").length;
    page = (
      <>
        <Header icon={KanbanSquare} title="Deals" count={open}>
          <nav className="dt-tabs" aria-label="Deals">
            <button type="button" aria-current={route.page === "board" || route.page === "table" ? "page" : undefined} onClick={() => to.board()}>Pipeline</button>
            <button type="button" aria-current={route.page === "waiting" ? "page" : undefined} onClick={() => to.waiting()}>
              <Sparkles size={13} aria-hidden="true" />Waiting{changes.length ? <span className="dt-tabs__n num">{changes.length}</span> : null}
            </button>
            <button type="button" aria-current={route.page === "review" ? "page" : undefined} onClick={() => to.review()}>
              <CalendarClock size={13} aria-hidden="true" />Review
            </button>
          </nav>
          <span className="c-grow" />
          <AskButton text="Which deals need attention this week, and what's the next step on each?" />
          <Button variant="ghost" icon={Cog} label="Settings" onClick={() => to.settings()} />
        </Header>
        {route.page === "waiting" ? <Waiting /> : route.page === "review" ? <ReviewPage /> : route.page === "settings" ? <SettingsPage />
          : <Pipeline view={route.page === "table" ? "table" : "board"} />}
      </>
    );
  }

  return (
    <div className="c-app">
      {sample.mail || sample.meetings || sample.deals ? (
        <div className="dt-strip">
          <Banner action={route.page !== "settings" ? <Button size="sm" onClick={() => to.settings()}>Sample settings</Button> : undefined}>
            <b>Sample deals.</b> Made up, at .example companies: {[
              sample.mail ? "Mail's sample conversations" : "", sample.meetings ? "Meetings' sample notes" : "",
              sample.deals ? "four deals with weeks of history" : "",
            ].filter(Boolean).join(", ")}.
          </Banner>
        </div>
      ) : null}
      {errs.length ? (
        <div className="dt-strip">
          {errs.map(([name, text]) => (
            <Banner key={name} tone="danger" action={<Button size="sm" onClick={() => void reload(name)}>Try again</Button>}>
              Couldn't load {name}: {text}
            </Banner>
          ))}
        </div>
      ) : null}
      {page}
    </div>
  );
}
