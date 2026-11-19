// The outline, waiting for the person: retitle, reword, reorder, add or drop
// cards, pick the look and how much text; nothing is written until they
// approve it.

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { Button, Card as KitCard, Segmented, update, useToast } from "@lemma-plugins/kit";
import { addOutlineCard, approveOutline, moveCard, removeCard, rewriteOutline, useDecks } from "./data";
import { brandLook, lookOf, themeLook } from "./look";
import { Slide } from "./Slide";
import { previewCard } from "./Setup";
import { LAYOUTS, type Card, type Deck, type Look } from "./types";

function Row({ card, i, cards }: { card: Card; i: number; cards: Card[] }) {
  const [title, setTitle] = useState(card.title || "");
  const [outline, setOutline] = useState(card.outline || "");
  useEffect(() => { setTitle(card.title || ""); setOutline(card.outline || ""); }, [card.title, card.outline]);
  const save = (patch: Partial<Card>) => void update("decks_card", card.id, patch as Record<string, unknown>);
  return (
    <li className="dk-orow">
      <span className="dk-orow__n num">{String(i + 1).padStart(2, "0")}</span>
      <div className="dk-orow__main">
        <input className="c-input c-input--bare dk-orow__title" value={title} aria-label={`Card ${i + 1} title`}
          onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== (card.title || "") && save({ title })} />
        <textarea className="dk-orow__outline" rows={Math.min(5, Math.max(2, Math.ceil(outline.length / 88)))} value={outline} aria-label={`What card ${i + 1} covers`}
          placeholder="What should this card say?"
          onChange={(e) => setOutline(e.target.value)} onBlur={() => outline !== (card.outline || "") && save({ outline })} />
      </div>
      <div className="dk-orow__tools">
        <select className="c-select dk-orow__layout" aria-label={`Card ${i + 1} layout`} value={card.layout}
          onChange={(e) => save({ layout: e.target.value as Card["layout"] })}>
          {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <Button size="sm" variant="ghost" icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => void moveCard(cards, card, -1)} />
        <Button size="sm" variant="ghost" icon={ArrowDown} label="Move down" disabled={i === cards.length - 1} onClick={() => void moveCard(cards, card, 1)} />
        <Button size="sm" variant="ghost" icon={Trash2} label="Remove the card" disabled={cards.length <= 2} onClick={() => void removeCard(cards, card)} />
      </div>
    </li>
  );
}

export function OutlineReview({ deck, cards }: { deck: Deck; cards: Card[] }) {
  const { themes, brand: brandRow } = useDecks();
  const toast = useToast();
  const [look, setLook] = useState<Look>(lookOf(deck.look));
  const [density, setDensity] = useState(deck.density || "balanced");
  const [busy, setBusy] = useState(false);
  const brand = brandRow ? brandLook(brandRow) : null;
  const looks: { id: string; look: Look }[] = [
    ...(brand ? [{ id: "brand", look: lookOf(brand) }] : []),
    ...themes.map((t) => ({ id: t.id, look: themeLook(t) })),
  ];
  const lookId = (l: Look) => (l.source === "brand" ? "brand" : l.theme_id || "");

  const approve = async () => {
    setBusy(true);
    try {
      // A brand look is taken afresh, with the brand's voice, when the cards are planned.
      await approveOutline(deck, { look, density });
      toast(`Writing ${cards.length} cards, one at a time.`);
    } catch (e) {
      toast(`Couldn't start: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };

  return (
    <div className="dk-outline-page">
      <main className="dk-outline-main">
        <p className="dk-sentence"><span className="c-faint">From</span> “{deck.prompt}”</p>
        <h2 className="dk-outline-title">{deck.title}</h2>
        <p className="c-muted dk-lead">The outline: one line for each card. Change anything, then approve it; the cards are written after that, one at a time.</p>
        <ol className="dk-outline">
          {cards.map((c, i) => <Row key={c.id} card={c} i={i} cards={cards} />)}
        </ol>
        <div className="dk-outline-foot">
          <Button icon={Plus} onClick={() => void addOutlineCard(deck, cards)}>Add a card</Button>
          <Button variant="ghost" icon={RotateCcw} onClick={() => {
            if (window.confirm("Write a new outline from the same sentence? This one will be replaced.")) void rewriteOutline(deck);
          }}>Write a new outline</Button>
        </div>
      </main>
      <aside className="dk-outline-side">
        <KitCard title="Look" icon={Sparkles}>
          <div className="dk-minilooks">
            {looks.map((l) => (
              <button key={l.id} type="button" className="dk-minilook" aria-pressed={lookId(look) === l.id} onClick={() => setLook(l.look)}>
                <Slide card={previewCard(deck.title || "Your deck", l.look.name || "")} look={l.look} logo={false} />
                <span>{lookId(look) === l.id ? <Check size={12} aria-hidden="true" /> : null}{l.id === "brand" ? `${l.look.name} (brand)` : l.look.name}</span>
              </button>
            ))}
          </div>
          <p className="dk-field-label">How much text</p>
          <Segmented label="How much text" value={density} onChange={(v) => setDensity(v)}
            items={[{ id: "concise", label: "Short" }, { id: "balanced", label: "Medium" }, { id: "detailed", label: "Full" }]} />
        </KitCard>
        <div className="dk-approve">
          <Button variant="primary" icon={Check} busy={busy} disabled={!cards.length} onClick={() => void approve()}>
            Approve and write {cards.length} cards
          </Button>
          <p className="c-faint dk-approve__note">About {Math.max(1, Math.round(cards.length * 12 / 60))} minute{cards.length * 12 >= 90 ? "s" : ""}. You can leave; it carries on.</p>
        </div>
      </aside>
    </div>
  );
}
