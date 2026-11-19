// A deck: its outline while it is being written or waits for approval; then
// its cards with the Ask panel beside them. The header carries the deck's
// status and, once there are cards, Present and Export.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, FileDown, MoreHorizontal, Palette, Play, Printer, RotateCcw, Trash2 } from "lucide-react";
import { Banner, Button, Empty, Menu, MenuItem, MenuLabel, Skeleton, Spinner, update, useToast } from "@lemma-plugins/kit";
import { Editor } from "./Editor";
import { exportPptx } from "./exportPptx";
import { again, deleteDeck, markOpened, rewriteOutline, useDecks } from "./data";
import { statusPill } from "./List";
import { brandLook, lookOf, themeLook, useLookFonts } from "./look";
import { OutlineReview } from "./Outline";
import { backToList, to } from "./route";
import type { Deck, Job } from "./types";

const STALL_MS = 4 * 60_000;

export function useStalled(job: Job | undefined, since: string | undefined): boolean {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  if (!job || !["wanted", "working"].includes(job.state)) return false;
  const last = Math.max(Date.parse(job.updated_at || job.created_at), since ? Date.parse(since) : 0);
  return now - last > STALL_MS;
}

export function DeckPage({ id, ask }: { id: string; ask?: string }) {
  const { decks, byDeck, jobs, loaded, themes, brand } = useDecks();
  const toast = useToast();
  const deck = decks.find((d) => d.id === id);
  const cards = useMemo(() => byDeck.get(id) || [], [byDeck, id]);
  useLookFonts(deck?.look);

  // Opening a deck that's ready takes its "ready" item out of Today.
  useEffect(() => {
    if (deck?.status === "ready") void markOpened(deck, jobs).catch(() => undefined);
  }, [deck?.status, deck?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) {
    return <div className="dk-deck"><DeckHead /><div className="dk-pad"><Skeleton kind="record" /></div></div>;
  }
  if (!deck) {
    return (
      <div className="dk-deck">
        <DeckHead />
        <Empty title="This deck isn't here" action={<Button onClick={backToList}>Back to the decks</Button>}>
          It may have been deleted, or it belongs to a Lemma you're not in.
        </Empty>
      </div>
    );
  }

  const latest = (kind: Job["kind"]) => jobs.find((j) => j.deck_id === deck.id && j.kind === kind);
  const outlineJob = latest("outline");
  const cardsJob = latest("cards");

  const lookMenu = (
    <Menu icon={MoreHorizontal} title="More" align="right">
      {(close) => (
        <>
          <MenuLabel>Look</MenuLabel>
          {brand && deck.look?.source !== "brand" ? (
            <MenuItem icon={Palette} onSelect={() => { close(); void update("decks_deck", deck.id, { look: brandLook(brand) }).then(() => toast(`Now in ${brand.name}'s brand. The next change writes in its voice.`)); }}>
              {brand.name} (the brand)
            </MenuItem>
          ) : null}
          {themes.map((t) => (
            <MenuItem key={t.id} icon={Palette} hint={deck.look?.theme_id === t.id ? "now" : undefined}
              onSelect={() => { close(); void update("decks_deck", deck.id, { look: themeLook(t) }).then(() => toast(`Now in ${t.name}. No card's words changed.`)); }}>
              {t.name}
            </MenuItem>
          ))}
          <MenuLabel>Deck</MenuLabel>
          <MenuItem icon={Trash2} onSelect={() => {
            close();
            if (window.confirm(`Delete “${deck.title || deck.prompt}” and its ${cards.length} cards? This can't be undone.`)) {
              void deleteDeck(deck, cards, jobs).then(() => { toast("Deleted the deck."); backToList(); });
            }
          }}>Delete the deck</MenuItem>
        </>
      )}
    </Menu>
  );

  const written = cards.filter((c) => c.status === "ready" && c.blocks.length);
  const actions = written.length ? (
    <>
      <ExportMenu deck={deck} />
      <Button variant="primary" icon={Play} onClick={() => to.present(deck.id)}>Present</Button>
      {lookMenu}
    </>
  ) : lookMenu;

  let body;
  if (deck.status === "outlining" || (deck.status === "failed" && !cards.length)) {
    body = <Outlining deck={deck} job={outlineJob} />;
  } else if (deck.status === "outline_ready") {
    body = <OutlineReview deck={deck} cards={cards} />;
  } else {
    body = <Editor deck={deck} cards={cards} cardsJob={cardsJob} askId={ask} />;
  }

  return (
    <div className="dk-deck" style={{ ["--dk-accent" as string]: lookOf(deck.look).accent }}>
      <DeckHead deck={deck} pill={statusPill(deck, cards)} actions={actions} />
      {body}
    </div>
  );
}

function DeckHead({ deck, pill, actions }: { deck?: Deck; pill?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="dk-head dk-head--deck">
      <button type="button" className="dk-back" onClick={backToList}>
        <ArrowLeft size={15} aria-hidden="true" />
        <span className="c-hide-sm">Decks</span>
      </button>
      {deck ? <span className="c-faint c-hide-sm" aria-hidden="true">/</span> : null}
      {deck ? <h1 className="c-ellipsis">{deck.title || deck.prompt}</h1> : null}
      {pill ? <span className="dk-head__pill">{pill}</span> : null}
      <span className="c-grow" />
      <div className="dk-head__actions">{actions}</div>
    </header>
  );
}

function ExportMenu({ deck }: { deck: Deck }) {
  const { byDeck } = useDecks();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Menu icon={busy ? undefined : Download} label={busy ? <><Spinner /> Exporting…</> : <span className="c-hide-sm">Export</span>} title="Export" align="right" size="md">
      {(close) => (
        <>
          <MenuItem icon={FileDown} hint=".pptx" onSelect={() => {
            close();
            setBusy(true);
            void exportPptx(deck, byDeck.get(deck.id) || [])
              .then((name) => toast(`Saved ${name}. It opens in PowerPoint, Keynote and Google Slides.`))
              .catch((e) => toast(`Couldn't export: ${e instanceof Error ? e.message : e}`))
              .finally(() => setBusy(false));
          }}>PowerPoint</MenuItem>
          <MenuItem icon={Printer} hint="PDF" onSelect={() => { close(); to.print(deck.id); }}>Print or save as PDF</MenuItem>
        </>
      )}
    </Menu>
  );
}

function Outlining({ deck, job }: { deck: Deck; job?: Job }) {
  const stalled = useStalled(job, deck.updated_at);
  const failed = deck.status === "failed" || job?.state === "failed";
  const toast = useToast();
  return (
    <div className="dk-pad dk-narrow">
      <p className="dk-sentence"><span className="c-faint">From</span> “{deck.prompt}”</p>
      {failed || stalled ? (
        <Banner tone={failed ? "danger" : "plain"} icon={RotateCcw}
          action={<Button size="sm" onClick={() => void (job ? again(job) : rewriteOutline(deck)).then(() => update("decks_deck", deck.id, { status: "outlining", error: null })).catch((e) => toast(String(e)))}>Try again</Button>}>
          {failed ? (deck.error || job?.error || "The outline wasn't written.") : "This is taking longer than it should."}
        </Banner>
      ) : (
        <p className="dk-working"><Spinner /> Writing the outline: a title, and one line for each of {deck.card_count || 8} cards. Usually under a minute.</p>
      )}
      <ol className="dk-outline dk-outline--ghost" aria-hidden="true">
        {Array.from({ length: Math.min(deck.card_count || 8, 8) }).map((_, i) => (
          <li key={i} className="dk-orow">
            <span className="dk-orow__n num">{String(i + 1).padStart(2, "0")}</span>
            <span className="dk-orow__main">
              <span className="c-skel" style={{ height: 13, width: `${40 + ((i * 17) % 35)}%` }} />
              <span className="c-skel" style={{ height: 11, width: `${55 + ((i * 11) % 30)}%`, marginTop: 8 }} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
