// Present mode: one card at a time, filling the frame. → or Space next, ←
// back, N the speaker notes, F full screen, Esc out. A tap on the right half
// goes on, the left half back. Inside a Lemma's frame full screen may be
// refused (the frame has to allow it); then it opens in its own tab, where it
// is allowed.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, StickyNote, X } from "lucide-react";
import { isFramed } from "@lemma-plugins/kit";
import { useDecks } from "./data";
import { lookOf, useLookFonts } from "./look";
import { Slide } from "./Slide";
import { to } from "./route";

export function PresentPage({ id, at }: { id: string; at?: number }) {
  const { decks, byDeck, loaded } = useDecks();
  const deck = decks.find((d) => d.id === id);
  const cards = useMemo(() => (byDeck.get(id) || []).filter((c) => c.status === "ready" && c.blocks.length), [byDeck, id]);
  const [index, setIndex] = useState(Math.max(0, (at || 1) - 1));
  const [notes, setNotes] = useState(false);
  useLookFonts(deck?.look);
  const look = lookOf(deck?.look);

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    to.deck(id);
  }, [id]);
  const next = useCallback(() => setIndex((i) => Math.min(i + 1, cards.length - 1)), [cards.length]);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);
  const full = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // The Lemma's frame doesn't allow full screen: present in a tab of its own.
      if (isFramed()) window.open(`${window.location.origin}/d/${encodeURIComponent(id)}/present/${index + 1}`, "_blank", "noopener");
    }
  }, [id, index]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); next(); }
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); prev(); }
      else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(cards.length - 1);
      else if (e.key.toLowerCase() === "n") setNotes((v) => !v);
      else if (e.key.toLowerCase() === "f") void full();
      else if (e.key === "Escape" && !document.fullscreenElement) exit();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [next, prev, exit, full, cards.length]);

  if (!loaded) return <div className="dk-present" />;
  if (!deck || !cards.length) {
    return (
      <div className="dk-present dk-present--empty">
        <p>Nothing to present yet: the cards aren't written.</p>
        <button type="button" className="dk-present__btn" onClick={exit}>Back to the deck</button>
      </div>
    );
  }
  const card = cards[Math.min(index, cards.length - 1)];

  return (
    <div className={`dk-present${look.dark ? " is-dark" : ""}`} style={{ ["--dk-present-bg" as string]: look.dark ? "#050505" : "#111111" }}>
      <div className="dk-present__stage"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          if (e.clientX - rect.left < rect.width / 3) prev(); else next();
        }}>
        <div className="dk-present__slide" key={card.id}>
          <Slide card={card} look={deck.look} />
        </div>
      </div>
      {notes ? <div className="dk-present__notes" role="note"><b>Notes</b> {card.notes || "No notes on this card."}</div> : null}
      <div className="dk-present__hud" role="toolbar" aria-label="Presenting">
        <button type="button" className="dk-present__btn" onClick={exit} aria-label="Stop presenting (Esc)"><X size={15} /></button>
        <span className="num dk-present__count" aria-live="polite">{index + 1} / {cards.length}</span>
        <button type="button" className="dk-present__btn" onClick={prev} disabled={index === 0} aria-label="Back (←)"><ChevronLeft size={16} /></button>
        <button type="button" className="dk-present__btn" onClick={next} disabled={index === cards.length - 1} aria-label="Next (→)"><ChevronRight size={16} /></button>
        <button type="button" className="dk-present__btn" aria-pressed={notes} onClick={() => setNotes((v) => !v)} aria-label="Speaker notes (N)"><StickyNote size={15} /></button>
        <button type="button" className="dk-present__btn" onClick={() => void full()} aria-label="Full screen (F)"><Maximize2 size={15} /></button>
      </div>
    </div>
  );
}
