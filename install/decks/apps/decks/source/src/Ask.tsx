// Edit by asking. A request is a decks_job (kind edit); its run asks the
// Decisions API which cards the request touches, and only those are
// rewritten. Under 0.5 it asks the person to pick. Every finished edit can be
// undone, and "Wrong cards?" puts it back and does it again on the cards the
// person picks, which is kept as a correction: the examples the next call
// learns from.

import { useEffect, useRef, useState } from "react";
import { ArrowUp, CircleHelp, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import { Button, Pill, Spinner, cx, update, useToast } from "@lemma-plugins/kit";
import { again, ask, undo, useDecks } from "./data";
import { useStalled } from "./DeckPage";
import type { Action, Card, Deck, Job } from "./types";

const SUGGESTIONS = ["Make the titles punchier", "Make it more formal", "Add a card on next steps before the last one", "Use a dark look"];

const ACTION_WORD: Record<string, string> = { rewrite: "Rewrite", add: "Add a card after", remove: "Remove", look: "Change the look", none: "Nothing" };

function cardList(ids: string[] | null | undefined, cards: Card[]): Card[] {
  const set = new Set(ids || []);
  return cards.filter((c) => set.has(c.id));
}

function Chips({ list, onShow }: { list: Card[]; onShow: (id: string) => void }) {
  if (!list.length) return null;
  return (
    <span className="dk-chips">
      {list.map((c) => (
        <button key={c.id} type="button" className="dk-chip" onClick={() => onShow(c.id)} title={c.title || ""}>
          {c.position}
        </button>
      ))}
    </span>
  );
}

/** Pick cards (and what to do with them), for an unsure answer or a correction. */
function Picker({ cards, initial, action: initialAction, label, onGo, onCancel }: {
  cards: Card[]; initial: string[]; action: Action | null; label: string;
  onGo: (ids: string[], action: Action) => Promise<void>; onCancel?: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const [action, setAction] = useState<Action>(initialAction && initialAction !== "none" && initialAction !== "look" ? initialAction : "rewrite");
  const [busy, setBusy] = useState(false);
  return (
    <div className="dk-picker">
      <div className="dk-picker__cards" role="group" aria-label="Cards">
        {cards.map((c) => (
          <label key={c.id} className={cx("dk-pick", picked.has(c.id) && "is-on")}>
            <input type="checkbox" className="c-check" checked={picked.has(c.id)}
              onChange={(e) => { const next = new Set(picked); if (e.target.checked) next.add(c.id); else next.delete(c.id); setPicked(next); }} />
            <span className="num c-faint">{c.position}</span>
            <span className="c-ellipsis">{c.title}</span>
          </label>
        ))}
      </div>
      <div className="dk-picker__bar">
        <select className="c-select dk-picker__action" aria-label="What to do" value={action} onChange={(e) => setAction(e.target.value as Action)}>
          <option value="rewrite">Rewrite them</option>
          <option value="add">Add a card after</option>
          <option value="remove">Remove them</option>
        </select>
        <span className="c-grow" />
        {onCancel ? <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button> : null}
        <Button size="sm" variant="primary" busy={busy} disabled={!picked.size}
          onClick={() => { setBusy(true); void onGo(cards.filter((c) => picked.has(c.id)).map((c) => c.id), action).catch(() => setBusy(false)); }}>
          {label}
        </Button>
      </div>
    </div>
  );
}

function Entry({ job, deck, cards, highlight, onShow }: { job: Job; deck: Deck; cards: Card[]; highlight: boolean; onShow: (id: string) => void }) {
  const toast = useToast();
  const [fixing, setFixing] = useState(false);
  const stalled = useStalled(job, undefined);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  const decided = cardList(job.cards, cards);
  const touched = cardList(job.chosen?.length ? job.chosen : job.cards, cards);
  const changed = cards.filter((c) => c.edit_id === job.id);
  const sure = job.confidence != null ? `${Math.round(job.confidence * 100)}% sure` : null;
  const picked = cardList(job.chosen, cards);
  const overruled = picked.length > 0 && decided.length > 0 && picked.map((c) => c.id).sort().join() !== decided.map((c) => c.id).sort().join();
  const decidedLine = (job.reason || picked.length) && job.state !== "ask" ? (
    <p className="dk-why">
      <Pill tone="ai" icon={Sparkles}>Decisions</Pill>
      <span>{ACTION_WORD[job.action || ""] || "Asked"}{decided.length ? ":" : ""}</span>
      <Chips list={decided} onShow={onShow} />
      {sure ? <span className="c-faint">{sure}</span> : null}
      {overruled ? <><span className="c-faint">· you picked</span><Chips list={picked} onShow={onShow} /></> : picked.length && !decided.length ? <span className="c-faint">your pick</span> : null}
    </p>
  ) : null;

  let body;
  if (job.state === "wanted" || (job.state === "working" && !job.cards)) {
    body = stalled
      ? <p className="dk-status dk-status--bad">This is taking longer than it should. <button type="button" className="dk-linklike" onClick={() => void again(job)}>Try again</button></p>
      : <p className="dk-status"><Spinner /> Finding the cards it's about…</p>;
  } else if (job.state === "working") {
    body = (
      <>
        {decidedLine}
        <p className="dk-status"><Spinner /> {job.action === "add" ? "Writing the new card…" : `Rewriting ${touched.length === 1 ? `card ${touched[0].position}` : `${touched.length} cards`}…`}</p>
      </>
    );
  } else if (job.state === "ask") {
    body = (
      <>
        <p className="dk-status">
          <CircleHelp size={14} aria-hidden="true" />
          {job.cards?.length
            ? <>Which cards did you mean? {sure ? <span className="c-faint">It's only {sure}; your pick is ticked.</span> : null}</>
            : <>It didn't name a card. Which did you mean?</>}
        </p>
        <Picker cards={cards} initial={job.cards || []} action={job.action} label="Go ahead"
          onGo={async (ids, action) => { await update("decks_job", job.id, { chosen: ids, action, state: "wanted" }); }} />
      </>
    );
  } else if (job.state === "done") {
    body = (
      <>
        {decidedLine}
        <p className="dk-summary">{job.summary}</p>
        {fixing ? (
          <Picker cards={cards} initial={job.cards || []} action={job.action} label="Redo on these" onCancel={() => setFixing(false)}
            onGo={async (ids) => {
              await undo(job, ids);
              toast("Put back, and asking again on the cards you picked. Decks learns from this.");
              setFixing(false);
            }} />
        ) : job.action !== "none" ? (
          <div className="dk-entry__acts">
            {changed.length ? <Chips list={changed} onShow={onShow} /> : null}
            <span className="c-grow" />
            <Button size="sm" variant="ghost" icon={Undo2} onClick={() => void undo(job).then(() => toast("Put back as it was."))}>Undo</Button>
            {job.action !== "look" ? <Button size="sm" variant="ghost" onClick={() => setFixing(true)}>Wrong cards?</Button> : null}
          </div>
        ) : null}
      </>
    );
  } else if (job.state === "undone") {
    body = <p className="dk-status c-faint"><Undo2 size={13} aria-hidden="true" /> Put back.</p>;
  } else {
    body = (
      <p className="dk-status dk-status--bad">
        {job.error || "That didn't work."} <button type="button" className="dk-linklike" onClick={() => void again(job)}>Try again</button>
      </p>
    );
  }
  return (
    <li ref={ref} className={cx("dk-entry", highlight && "is-hl")}>
      <p className="dk-request">{job.request}</p>
      {body}
    </li>
  );
}

export function AskPanel({ deck, cards, jobs, askId, prefill, disabled, onShow }: {
  deck: Deck; cards: Card[]; jobs: Job[]; askId?: string; prefill: { text: string; n: number } | null; disabled?: boolean; onShow: (id: string) => void;
}) {
  const toast = useToast();
  const { brand } = useDecks();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const ordered = [...jobs].reverse();

  useEffect(() => {
    if (prefill) {
      setText(prefill.text);
      window.setTimeout(() => { box.current?.focus(); box.current?.setSelectionRange(prefill.text.length, prefill.text.length); }, 30);
    }
  }, [prefill]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [jobs.length]);

  const send = async (request: string) => {
    const t = request.trim();
    if (!t || busy || disabled) return;
    setBusy(true);
    try {
      await ask(deck.id, "edit", { request: t });
      setText("");
    } catch (e) {
      toast(`Couldn't ask: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="dk-ask" aria-label="Ask for a change">
      <div className="dk-ask__head">
        <Sparkles size={14} aria-hidden="true" />
        <h2>Ask for a change</h2>
        <span className="c-grow" />
        <span className="c-faint dk-ask__note c-hide-sm">Only the cards it's about change</span>
      </div>
      <ol className="dk-ask__list" ref={list}>
        {!ordered.length ? (
          <li className="dk-ask__empty">
            <p>Say what to change, the way you'd tell a colleague. Decks finds the cards it's about and rewrites only those{deck.look?.source === "brand" && brand ? `, in ${brand.name}'s voice` : ""}.</p>
          </li>
        ) : null}
        {ordered.map((j) => <Entry key={j.id} job={j} deck={deck} cards={cards} highlight={j.id === askId} onShow={onShow} />)}
      </ol>
      <div className="dk-ask__box">
        {!ordered.length && !text ? (
          <div className="dk-examples dk-examples--ask">
            {SUGGESTIONS.map((s) => <button key={s} type="button" className="dk-example" disabled={disabled} onClick={() => setText(s)}>{s}</button>)}
          </div>
        ) : null}
        <div className="dk-ask__input">
          <label className="c-sr" htmlFor="dk-ask">Ask for a change</label>
          <textarea id="dk-ask" ref={box} rows={2} value={text} disabled={disabled}
            placeholder={disabled ? "You can ask once the cards are written." : "e.g. Make the pricing card punchier"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
          <Button variant="primary" icon={busy ? undefined : ArrowUp} busy={busy} label="Ask" disabled={!text.trim() || disabled} onClick={() => void send(text)} />
        </div>
        {jobs.some((j) => j.state === "undone") ? null : <p className="dk-ask__foot c-faint"><RotateCcw size={11} aria-hidden="true" /> Every change can be undone.</p>}
      </div>
    </aside>
  );
}
