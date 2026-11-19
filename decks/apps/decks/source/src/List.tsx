// The decks: a sentence box at the top (a deck from one sentence), then every
// deck as a tile with its title card, status and who made it.

import { useMemo, useState } from "react";
import { CheckCheck, Layers, Presentation, Sparkles, UserRound } from "lucide-react";
import { Card as KitCard, Empty, Pill, Rel, SearchField, Segmented, Skeleton, runFunction, useToast } from "@lemma-plugins/kit";
import { Composer } from "./Composer";
import { defaultLook, makeDeck, useDecks, useWorld } from "./data";
import { Slide, SlideSkeleton } from "./Slide";
import { to, type ListPage as Page } from "./route";
import type { Card, Deck } from "./types";
import { useLookFonts } from "./look";

/** "New deck" anywhere: the sentence box at the top of the list. */
export function focusComposer(): void {
  window.setTimeout(() => {
    const box = document.getElementById("dk-prompt") as HTMLTextAreaElement | null;
    box?.focus();
    box?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 60);
}

export function statusPill(deck: Deck, cards: Card[]) {
  const written = cards.filter((c) => c.status === "ready").length;
  switch (deck.status) {
    case "outlining":
      return <Pill tone="info">Writing the outline</Pill>;
    case "outline_ready":
      return <Pill tone="warning">Outline to approve</Pill>;
    case "writing":
      return <Pill tone="info">Writing {written} of {cards.length}</Pill>;
    case "failed":
      return <Pill tone="danger">Stopped</Pill>;
    default:
      return <Pill tone="success">Ready</Pill>;
  }
}

function Tile({ deck, cards, me }: { deck: Deck; cards: Card[]; me?: string }) {
  const who = deck.made_by && deck.made_by === me ? "you" : deck.made_by_name;
  useLookFonts(deck.look);
  const first = cards[0];
  return (
    <button type="button" className="dk-tile" onClick={() => to.deck(deck.id)}>
      <span className="dk-tile__thumb">
        {first && first.status === "ready" ? (
          <Slide card={first} look={deck.look} />
        ) : first ? (
          <SlideSkeleton card={first} look={deck.look} writing={deck.status === "writing"} />
        ) : (
          <SlideSkeleton card={{ id: "x", deck_id: deck.id, position: 1, title: deck.title || deck.prompt, outline: "", layout: "hero", blocks: [], notes: null, status: "outline", version: 0, edit_id: null, created_at: "", updated_at: "" }}
            look={deck.look} writing={deck.status === "outlining"} />
        )}
      </span>
      <span className="dk-tile__title">{deck.title || deck.prompt}</span>
      <span className="dk-tile__meta">
        {statusPill(deck, cards)}
        <span className="c-ellipsis c-faint">
          {cards.length ? `${cards.length} cards · ` : ""}{deck.look?.name || "Theme"}{who ? ` · ${who}` : ""}{deck.source === "chat" ? " in chat" : ""}
        </span>
        <span className="c-grow" />
        <span className="c-faint"><Rel at={deck.updated_at} /></span>
      </span>
    </button>
  );
}

export function ListPage({ page }: { page: Page }) {
  const { decks, byDeck, loaded, settings, themes, sample, brand } = useDecks();
  const { me } = useWorld();
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const look = defaultLook(settings, themes, brand);

  const shown = useMemo(() => {
    let list = decks;
    if (page === "mine") list = list.filter((d) => d.made_by === me?.id);
    if (page === "approve") list = list.filter((d) => d.status === "outline_ready");
    const f = filter.trim().toLowerCase();
    if (f) list = list.filter((d) => `${d.title || ""} ${d.prompt}`.toLowerCase().includes(f));
    return list;
  }, [decks, page, me, filter]);

  const title = page === "mine" ? "Made by you" : page === "approve" ? "Outlines to approve" : "All decks";
  const Icon = page === "mine" ? UserRound : page === "approve" ? CheckCheck : Layers;

  return (
    <>
      <header className="dk-head">
        <Icon size={15} className="c-faint" aria-hidden="true" />
        <h1>{title}</h1>
        <span className="c-faint num">{shown.length}</span>
        <span className="c-grow" />
        <SearchField value={filter} onChange={setFilter} placeholder="Find a deck" />
      </header>
      <div className="dk-pad">
        {page !== "approve" ? (
          <KitCard>
            <div className="dk-new">
              <p className="dk-new__title"><Sparkles size={14} aria-hidden="true" /> A deck from one sentence
                <span className="c-faint dk-new__look">{look ? ` · in ${look.source === "brand" ? `${look.name}'s brand` : `the ${look.name} look`}` : ""}</span>
              </p>
              <Composer
                full
                themes={themes}
                brandName={look?.source === "brand" ? look.name : null}
                onSubmit={async (v) => {
                  const made = await makeDeck({
                    prompt: v.prompt, notes: v.notes, files: v.files, card_count: v.card_count, density: v.density,
                    theme: v.theme || undefined,
                  });
                  toast("Writing the outline. You'll approve it before any card is written.");
                  to.deck(made.deck_id);
                }}
              />
            </div>
          </KitCard>
        ) : null}

        <div className="dk-section">
          <Segmented<Page>
            label="Which decks"
            value={page}
            onChange={(p) => to.list(p)}
            items={[
              { id: "all", label: "All", count: decks.length },
              { id: "mine", label: "Yours", count: decks.filter((d) => d.made_by === me?.id).length },
              { id: "approve", label: "To approve", count: decks.filter((d) => d.status === "outline_ready").length },
            ]}
          />
        </div>

        {!loaded ? (
          <Skeleton kind="list" rows={4} />
        ) : shown.length ? (
          <div className="dk-grid">
            {shown.map((d) => <Tile key={d.id} deck={d} cards={byDeck.get(d.id) || []} me={me?.id} />)}
          </div>
        ) : (
          <Empty
            icon={Presentation}
            title={filter ? "No deck matches" : page === "approve" ? "No outline is waiting for you" : page === "mine" ? "You haven't made a deck yet" : "No decks yet"}
            action={!filter && page !== "approve" && !sample ? (
              <button type="button" className="dk-linklike" disabled={loading} onClick={() => {
                setLoading(true);
                void runFunction("decks_sample_data", { mode: "load" }).catch((e) => toast(String(e))).finally(() => setLoading(false));
              }}>
                {loading ? "Loading the sample…" : "Or look around with a sample deck"}
              </button>
            ) : undefined}
          >
            {filter ? "Try other words." : page === "approve" ? "When an outline is written, it waits here until you approve it." : "Write one sentence above, or ask the Lemma in chat: “make a deck about …”."}
          </Empty>
        )}
      </div>
    </>
  );
}
