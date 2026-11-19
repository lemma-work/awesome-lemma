// The app once set up, in the same frame as the other plugins' apps: places on
// the left (every deck, yours, outlines to approve, settings), the page on the
// right. A deck opens full width, the way an editor does, with Back to the
// list. Below 860px one pane, the places a drawer.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCheck, Layers, Menu as MenuIcon, Plus, Presentation, Settings as Cog, UserRound, X } from "lucide-react";
import { Banner, Button, client, cx } from "@lemma-plugins/kit";
import { DeckPage } from "./DeckPage";
import { ListPage, focusComposer } from "./List";
import { PresentPage } from "./Present";
import { PrintPage } from "./Print";
import { needsYou, useDecks, useWorld } from "./data";
import { takeOpenAfterSetup } from "./Setup";
import { SettingsPage } from "./Settings";
import { rememberList, to, useRoute, type Route } from "./route";

function Nav({ route, onPick }: { route: Route; onPick: () => void }) {
  const { decks } = useDecks();
  const { me } = useWorld();
  const counts = useMemo(() => ({
    all: decks.length,
    mine: decks.filter((d) => d.made_by === me?.id).length,
    approve: decks.filter((d) => d.status === "outline_ready").length,
  }), [decks, me]);
  const items = [
    { id: "all", label: "All decks", icon: Layers, n: counts.all, go: () => to.list("all") },
    { id: "mine", label: "Made by you", icon: UserRound, n: counts.mine, go: () => to.list("mine") },
    { id: "approve", label: "Outlines to approve", icon: CheckCheck, n: counts.approve, hot: true, go: () => to.list("approve") },
  ];
  return (
    <nav className="dk-nav" aria-label="Decks">
      <div className="dk-nav__brand">
        <span className="c-header__icon" aria-hidden="true"><Presentation size={15} /></span>
        <span className="c-grow">Decks</span>
        <Button size="sm" variant="ghost" icon={Plus} label="New deck" onClick={() => { to.list("all"); focusComposer(); onPick(); }} />
      </div>
      <div className="c-nav">
        {items.map((n) => (
          <button key={n.id} type="button" className="c-nav__item" aria-current={route.page === n.id ? "page" : undefined}
            onClick={() => { n.go(); onPick(); }}>
            <n.icon aria-hidden="true" />
            {n.label}
            <span className={cx("c-nav__n", n.hot && n.n ? "c-nav__n--hot" : false)}>{n.n || ""}</span>
          </button>
        ))}
        <p className="c-nav__label">Yours</p>
        <button type="button" className="c-nav__item" aria-current={route.page === "settings" ? "page" : undefined}
          onClick={() => { to.settings(); onPick(); }}>
          <Cog aria-hidden="true" />
          Settings
        </button>
      </div>
    </nav>
  );
}

export function Shell() {
  const route = useRoute();
  const { sample, settings } = useDecks();
  const [navOpen, setNavOpen] = useState(false);

  // Straight after set-up, open the deck it made (or the sample). The gate
  // switches here as soon as set-up is kept, which can be before its run has
  // finished, so the deck may have to be read off the run.
  useEffect(() => {
    needsYou();
    const first = takeOpenAfterSetup();
    if (first) {
      to.deck(first);
      return;
    }
    if (!settings?.setup_run_id || route.page !== "all") return;
    let tries = 0;
    const look = async () => {
      const run = (await client.workflows.runs.get(settings.setup_run_id!).catch(() => null)) as
        { status?: string; updated_at?: string; step_history?: { node_id: string; output_data?: Record<string, unknown> | null; completed_at?: string | null }[] } | null;
      const step = run?.step_history?.find((s) => s.node_id === "make" || s.node_id === "sample");
      const deckId = step?.output_data?.deck_id as string | undefined;
      const fresh = step?.completed_at ? Date.now() - Date.parse(step.completed_at) < 120_000 : false;
      if (deckId && fresh) to.deck(deckId);
      else if (!step && run?.status !== "COMPLETED" && ++tries < 6) window.setTimeout(() => void look(), 1500);
    };
    void look();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (route.page === "all" || route.page === "mine" || route.page === "approve") rememberList(route.page === "all" ? "/" : `/${route.page}`);
  }, [route.page]);

  if (route.page === "present") return <PresentPage id={route.id} at={route.at} />;
  if (route.page === "print") return <PrintPage id={route.id} />;
  if (route.page === "deck") return <DeckPage id={route.id} ask={route.ask} />;

  let page: ReactNode;
  if (route.page === "settings") page = <SettingsPage />;
  else page = <ListPage page={route.page} />;

  return (
    <div className={cx("dk-shell", navOpen && "is-nav-open")}>
      <aside className="dk-side"><Nav route={route} onPick={() => setNavOpen(false)} /></aside>
      {navOpen ? <button type="button" className="dk-scrim" aria-label="Close the menu" onClick={() => setNavOpen(false)} /> : null}
      <div className="dk-main">
        <div className="dk-mobilebar">
          <Button variant="ghost" icon={navOpen ? X : MenuIcon} label="Places" onClick={() => setNavOpen((v) => !v)} />
          <span className="dk-mobilebar__title">Decks</span>
          <span className="c-grow" />
          <Button size="sm" variant="primary" icon={Plus} onClick={() => { to.list("all"); focusComposer(); }}>New</Button>
        </div>
        {sample && settings?.setup_step === "done" && route.page !== "settings" ? (
          <div className="dk-strip">
            <Banner>You're looking at <b>a sample</b>: a made-up coffee roaster's decks. Clear it in Settings when you're done.</Banner>
          </div>
        ) : null}
        <div className="dk-page">{page}</div>
      </div>
    </div>
  );
}
