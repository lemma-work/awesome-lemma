// Print, or save as PDF: every written card on its own 16:9 page, no margins.
// From the Decks desk app's print sheet.

import { ArrowLeft, Printer } from "lucide-react";
import { Button, Header } from "@lemma-plugins/kit";
import { useDecks } from "./data";
import { useLookFonts } from "./look";
import { Slide } from "./Slide";
import { to } from "./route";

export function PrintPage({ id }: { id: string }) {
  const { decks, byDeck } = useDecks();
  const deck = decks.find((d) => d.id === id);
  const cards = (byDeck.get(id) || []).filter((c) => c.status === "ready" && c.blocks.length);
  useLookFonts(deck?.look);
  return (
    <div className="dk-print">
      <div className="dk-print__bar">
        <Header back={{ label: "Back to the deck", icon: ArrowLeft, onClick: () => to.deck(id) }} title={deck?.title || ""}>
          <span className="c-faint c-hide-sm">{cards.length} pages, one card each</span>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>Print or save as PDF</Button>
        </Header>
      </div>
      <div className="dk-print__pages">
        {cards.map((c) => (
          <div key={c.id} className="dk-print__page"><Slide card={c} look={deck?.look || null} /></div>
        ))}
      </div>
    </div>
  );
}
