// The deck's cards: a filmstrip, the cards at reading size, and the Ask panel.
// While the deck is being written each card appears the moment it is saved;
// after an ask, the cards it changed carry a "Changed" mark.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, MessageSquareText, MoreHorizontal, PencilLine, Play, RotateCcw, StickyNote, Trash2 } from "lucide-react";
import { Banner, Button, Menu, MenuItem, Sheet, Spinner, cx, update, useToast } from "@lemma-plugins/kit";
import { AskPanel } from "./Ask";
import { again, ask, moveCard, removeCard, useDecks } from "./data";
import { useStalled } from "./DeckPage";
import { Slide, SlideSkeleton } from "./Slide";
import { to } from "./route";
import { layoutLabel, type Block, type Card, type Deck, type Job } from "./types";

export function Editor({ deck, cards, cardsJob, askId }: { deck: Deck; cards: Card[]; cardsJob?: Job; askId?: string }) {
  const { jobs } = useDecks();
  const toast = useToast();
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; n: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const written = cards.filter((c) => c.status === "ready").length;
  const writing = deck.status === "writing";
  const stalled = useStalled(cardsJob, cards.reduce((a, c) => (c.updated_at > a ? c.updated_at : a), ""));
  const failed = cards.filter((c) => c.status === "failed");

  const myEdits = useMemo(() => jobs.filter((j) => j.deck_id === deck.id && j.kind === "edit"), [jobs, deck.id]);
  const lastEdit = myEdits
    .filter((j) => j.state === "done" || j.state === "working")
    .sort((a, b) => (b.finished_at || b.updated_at).localeCompare(a.finished_at || a.updated_at))[0];
  const changed = new Set(cards.filter((c) => lastEdit && c.edit_id === lastEdit.id).map((c) => c.id));
  const rewriting = new Set(myEdits.filter((j) => j.state === "working").flatMap((j) => j.cards || []));

  const show = (id: string) => {
    setActive(id);
    document.getElementById(`dk-card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Follow the writing: keep the newest written card in view while it fills in.
  const lastWritten = useRef(written);
  useEffect(() => {
    if (writing && written > lastWritten.current) {
      const next = cards.find((c) => c.status !== "ready");
      if (next && canvas.current && canvas.current.scrollTop < 40) setActive(next.id);
    }
    lastWritten.current = written;
  }, [written, writing, cards]);

  return (
    <div className="dk-editor">
      <nav className="dk-film" aria-label="Cards">
        {cards.map((c) => (
          <button key={c.id} type="button" className={cx("dk-thumb", active === c.id && "is-active")} onClick={() => show(c.id)}
            aria-label={`Card ${c.position}: ${c.title || ""}`}>
            <span className="dk-thumb__n num">{c.position}</span>
            <span className="dk-thumb__slide">
              {c.status === "ready" && c.blocks.length ? <Slide card={c} look={deck.look} /> : <SlideSkeleton card={c} look={deck.look} writing={c.status === "writing"} />}
            </span>
            {changed.has(c.id) ? <span className="dk-dot" title="Changed by your last ask" /> : null}
          </button>
        ))}
      </nav>

      <div className="dk-canvas" ref={canvas}>
        {writing ? (
          <div className="dk-progress" role="status">
            {stalled ? (
              <Banner icon={RotateCcw} action={<Button size="sm" onClick={() => cardsJob && void again(cardsJob).catch((e) => toast(String(e)))}>Carry on</Button>}>
                The writing stopped at card {written + 1}. Carry on from there.
              </Banner>
            ) : (
              <>
                <Spinner /> Writing card {Math.min(written + 1, cards.length)} of {cards.length}. Each card appears here as it's written.
                <span className="dk-meter" aria-hidden="true"><span style={{ width: `${(written / Math.max(1, cards.length)) * 100}%` }} /></span>
              </>
            )}
          </div>
        ) : null}
        {!writing && failed.length ? (
          <Banner tone="danger" icon={RotateCcw} action={<Button size="sm" onClick={() => void ask(deck.id, "cards").then(() => update("decks_deck", deck.id, { status: "writing" }))}>Write {failed.length === 1 ? "it" : "them"} again</Button>}>
            {failed.length === 1 ? `Card ${failed[0].position} wasn't written.` : `${failed.length} cards weren't written.`}
          </Banner>
        ) : null}

        {cards.map((c) => (
          <section key={c.id} id={`dk-card-${c.id}`} className={cx("dk-card", active === c.id && "is-active", changed.has(c.id) && "is-changed")}
            onFocus={() => setActive(c.id)} onClick={() => setActive(c.id)}>
            <div className="dk-card__bar">
              <span className="num c-faint">{c.position}</span>
              <span className="c-faint">{layoutLabel(c.layout)}</span>
              {changed.has(c.id) ? <span className="dk-changed">Changed by your last ask</span> : null}
              {rewriting.has(c.id) ? <span className="dk-changed"><Spinner /> Rewriting</span> : null}
              <span className="c-grow" />
              {c.status === "ready" ? (
                <>
                  <Button size="sm" variant="ghost" icon={MessageSquareText} onClick={(e) => { e.stopPropagation(); setPrefill({ text: `On card ${c.position} (“${c.title}”): `, n: Date.now() }); }}>
                    <span className="c-hide-sm">Ask about this card</span>
                  </Button>
                  <CardMenu card={c} cards={cards} onEdit={() => setEditing(c)} onPresent={() => to.present(deck.id, c.position)} />
                </>
              ) : null}
            </div>
            {c.status === "ready" && c.blocks.length ? <Slide card={c} look={deck.look} /> : <SlideSkeleton card={c} look={deck.look} writing={c.status === "writing"} />}
            {c.notes && c.status === "ready" ? (
              <details className="dk-notes">
                <summary><StickyNote size={13} aria-hidden="true" /> Speaker notes</summary>
                <p>{c.notes}</p>
              </details>
            ) : null}
          </section>
        ))}
      </div>

      <AskPanel deck={deck} cards={cards} jobs={myEdits} askId={askId} prefill={prefill} disabled={writing} onShow={show} />

      {editing ? <CardSheet card={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function CardMenu({ card, cards, onEdit, onPresent }: { card: Card; cards: Card[]; onEdit: () => void; onPresent: () => void }) {
  const toast = useToast();
  return (
    <Menu icon={MoreHorizontal} title={`Card ${card.position}`} align="right">
      {(close) => (
        <>
          <MenuItem icon={PencilLine} onSelect={() => { close(); onEdit(); }}>Edit the words</MenuItem>
          <MenuItem icon={Play} onSelect={() => { close(); onPresent(); }}>Present from here</MenuItem>
          <MenuItem icon={ArrowUp} onSelect={() => { close(); void moveCard(cards, card, -1); }}>Move up</MenuItem>
          <MenuItem icon={ArrowDown} onSelect={() => { close(); void moveCard(cards, card, 1); }}>Move down</MenuItem>
          <MenuItem icon={Trash2} onSelect={() => {
            close();
            if (window.confirm(`Remove card ${card.position}, “${card.title}”?`)) void removeCard(cards, card).then(() => toast("Removed the card."));
          }}>Remove the card</MenuItem>
        </>
      )}
    </Menu>
  );
}

function blockText(b: Block): string {
  switch (b.type) {
    case "heading":
    case "text":
      return b.text;
    case "bullets":
      return b.items.map((i) => i.text).join("\n");
    case "quote":
      return b.text + (b.attribution ? `\n— ${b.attribution}` : "");
    case "stats":
      return b.items.map((s) => `${s.value} | ${s.label}`).join("\n");
    case "columns":
      return b.columns.map((c) => `${c.heading} | ${c.body}`).join("\n");
    default:
      return "";
  }
}

function withText(b: Block, text: string): Block {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  switch (b.type) {
    case "heading":
    case "text":
      return { ...b, text: text.trim() };
    case "bullets":
      return { ...b, items: lines.map((t, i) => ({ text: t, icon: b.items[i]?.icon ?? null })) };
    case "quote": {
      const [q, ...rest] = text.split("\n— ");
      return { ...b, text: q.trim(), attribution: rest.join(" ").trim() || null };
    }
    case "stats":
      return { ...b, items: lines.map((l, i) => { const [v, ...lab] = l.split("|"); return { ...b.items[i], value: v.trim(), label: lab.join("|").trim(), icon: b.items[i]?.icon ?? null }; }) };
    case "columns":
      return { ...b, columns: lines.map((l, i) => { const [h, ...body] = l.split("|"); return { heading: h.trim(), body: body.join("|").trim(), icon: b.columns[i]?.icon ?? null }; }) };
    default:
      return b;
  }
}

const BLOCK_LABEL: Record<string, string> = {
  heading: "Statement", text: "Paragraph", bullets: "Points, one a line", quote: "Quote (— then who said it)",
  stats: "Figures, one a line: value | label", columns: "Columns, one a line: heading | text",
};

/** The words of one card, edited by hand: a drawer. */
function CardSheet({ card, onClose }: { card: Card; onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(card.title || "");
  const [texts, setTexts] = useState(card.blocks.map(blockText));
  const [notes, setNotes] = useState(card.notes || "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await update("decks_card", card.id, { title, notes, blocks: card.blocks.map((b, i) => (b.type === "visual" ? b : withText(b, texts[i]))) });
      toast(`Saved card ${card.position}.`);
      onClose();
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };
  return (
    <Sheet open title={`Card ${card.position}: the words`} onClose={onClose}
      footer={<><span className="c-grow" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => void save()}>Save the card</Button></>}>
      <label className="c-field"><span>Title</span><input className="c-input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      {card.blocks.map((b, i) => b.type === "visual" ? null : (
        <label key={i} className="c-field">
          <span>{BLOCK_LABEL[b.type] || b.type}</span>
          <textarea className="c-textarea dk-sheet-text" value={texts[i]} onChange={(e) => setTexts(texts.map((t, j) => (j === i ? e.target.value : t)))} />
        </label>
      ))}
      <label className="c-field"><span>Speaker notes</span><textarea className="c-textarea dk-sheet-text" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    </Sheet>
  );
}
