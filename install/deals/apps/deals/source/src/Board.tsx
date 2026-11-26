// The pipeline: a board by stage you can drag, or a table, and beside it the
// changes waiting for the person, each with its sentence. Dragging writes the
// deal through deals_save, so the move is in the deal's history.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, CalendarDays, Check, KanbanSquare, Plus, Sparkles, Table2,
} from "lucide-react";
import {
  Avatar, Button, Empty, Logo, Pill, SearchField, Segmented, Sheet, Skeleton, agoText, day, due, moneyShort, nameOf, plural, useToast, errorText,
} from "@lemma-plugins/kit";
import { save, useDeals } from "./data";
import { StagePill, dealMoney } from "./marks";
import { ProposalCard } from "./Proposal";
import { to } from "./route";
import type { Deal, Stage } from "./types";

type Whose = "all" | "mine";
type SortKey = "name" | "stage" | "amount" | "close" | "activity";

const CLOSED_SHOWN = 8;

function matches(d: Deal, text: string): boolean {
  if (!text) return true;
  const t = text.toLowerCase();
  return [d.name, d.company_name, d.company_domain, d.next_step, d.owner_name, ...(d.people || []).map((p) => `${p.name || ""} ${p.handle || ""}`)]
    .some((x) => (x || "").toLowerCase().includes(t));
}

export function Pipeline({ view }: { view: "board" | "table" }) {
  const { loaded, deals, stages, changes, me, currency } = useDeals();
  const [whose, setWhose] = useState<Whose>("all");
  const [text, setText] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const shown = deals.filter((d) => (whose === "all" || d.owner_user_id === me?.id) && matches(d, text));
  const open = shown.filter((d) => d.status === "open");
  const total = open.filter((d) => (d.currency || currency) === currency).reduce((s, d) => s + Number(d.amount || 0), 0);
  const firstOpen = stages.find((s) => s.kind === "open")?.name || null;

  return (
    <>
      <div className="c-toolbar dt-toolbar">
        <Segmented<"board" | "table"> label="View" value={view} onChange={(v) => (v === "board" ? to.board() : to.table())}
          items={[{ id: "board", label: "Board" }, { id: "table", label: "Table" }]} />
        <Segmented<Whose> label="Whose" value={whose} onChange={setWhose}
          items={[{ id: "all", label: "Everyone's", count: deals.length }, { id: "mine", label: "Mine", count: deals.filter((d) => d.owner_user_id === me?.id).length }]} />
        <SearchField value={text} onChange={setText} placeholder="Search deals, companies, people" />
        <span className="c-grow" />
        <span className="dt-total num">
          <span className="c-faint">Open</span> {moneyShort(total, currency)} <span className="c-faint">· {plural(open.length, "deal")}</span>
        </span>
        {changes.length ? (
          <Button size="sm" icon={Sparkles} className="dt-waiting-btn" onClick={() => to.waiting()}>
            {plural(changes.length, "change")} waiting
          </Button>
        ) : null}
        <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(firstOpen || "")}>New deal</Button>
      </div>

      {!loaded ? (
        <div className="c-body c-body--wide"><Skeleton rows={8} kind={view === "table" ? "table" : "list"} /></div>
      ) : deals.length === 0 ? (
        <div className={`dt-with-rail${changes.length ? "" : " is-solo"}`}>
          <main className="c-body">
            <div className="c-card">
              <Empty icon={KanbanSquare} title="No deals yet"
                action={<Button variant="primary" icon={Plus} onClick={() => setAdding(firstOpen || "")}>New deal</Button>}>
                {changes.length
                  ? "Keep a proposed deal beside this, and it lands here in its stage."
                  : "When a conversation or a meeting starts a deal, it's proposed here with the sentence it came from. Or add one yourself."}
              </Empty>
            </div>
          </main>
          <Rail />
        </div>
      ) : view === "table" ? (
        <main className="c-body c-body--wide"><DealTable deals={shown} /></main>
      ) : (
        <div className={`dt-with-rail${changes.length ? "" : " is-solo"}`}>
          <Board deals={shown} stages={stages} onAdd={setAdding} />
          <Rail />
        </div>
      )}
      {adding !== null ? <NewDeal stage={adding} onClose={() => setAdding(null)} /> : null}
    </>
  );
}

/** The changes waiting beside the board: the person's own proposals. */
function Rail() {
  const { changes } = useDeals();
  if (!changes.length) return null;
  return (
    <aside className="dt-rail" aria-label="Changes waiting for you">
      <div className="dt-rail__head">
        <Sparkles size={14} aria-hidden="true" />
        <h2>Waiting for you</h2>
        <span className="c-count">{changes.length}</span>
        <span className="c-grow" />
        {changes.length > 6 ? <Button size="sm" variant="ghost" onClick={() => to.waiting()}>All</Button> : null}
      </div>
      <p className="dt-rail__lead">From your conversations and meeting notes. Nothing changes until you keep it.</p>
      <div className="dt-rail__list">
        {changes.slice(0, 6).map((c) => <ProposalCard key={c.id} change={c} />)}
      </div>
    </aside>
  );
}

function Board({ deals, stages, onAdd }: { deals: Deal[]; stages: Stage[]; onAdd: (stage: string) => void }) {
  const { me, currency, changes, reload } = useDeals();
  const toast = useToast();
  // Pointer dragging (mouse, pen, or touch on a wide screen): press a card and
  // move past a few pixels to pick it up; the column under the pointer lights;
  // let go to move it there. A press without moving opens the deal.
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number; dx: number; dy: number; w: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, string>>({});
  const press = useRef<{ id: string; x: number; y: number; dx: number; dy: number; w: number } | null>(null);
  const dragged = useRef(false);
  const waiting = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of changes) if (c.deal_id) m.set(c.deal_id, (m.get(c.deal_id) || 0) + 1);
    return m;
  }, [changes]);
  const placed = deals.map((d) => (moved[d.id] ? { ...d, stage: moved[d.id] } : d));

  const move = async (id: string, stage: Stage) => {
    const deal = deals.find((d) => d.id === id);
    if (!deal || deal.stage === stage.name) return;
    setMoved((m) => ({ ...m, [id]: stage.name }));
    try {
      await save("edit", { deal_id: id, fields: { stage: stage.name } }, me);
      await reload("deals");
      toast(`${deal.name}: ${stage.name}`, { action: { label: "Undo", run: () => void save("edit", { deal_id: id, fields: { stage: deal.stage } }, me).then(() => reload("deals")) } });
    } catch (e) {
      toast(`Couldn't move it: ${errorText(e)}`);
    } finally {
      setMoved((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
    }
  };

  const stageAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest("[data-stage]");
    return el ? el.getAttribute("data-stage") : null;
  };
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!dragged.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
      dragged.current = true;
      setDragging({ ...p, x: e.clientX, y: e.clientY });
      setOver(stageAt(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      const p = press.current;
      press.current = null;
      if (!p || !dragged.current) return;
      const name = stageAt(e.clientX, e.clientY);
      const stage = stages.find((s) => s.name === name);
      setDragging(null);
      setOver(null);
      if (stage) void move(p.id, stage);
      window.setTimeout(() => { dragged.current = false; }, 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const ghost = dragging ? placed.find((d) => d.id === dragging.id) : null;

  return (
    <div className={`dt-board${dragging ? " is-dragging" : ""}`} role="list" aria-label="Deals by stage"
      style={{ gridTemplateColumns: stages.map((s) => (s.kind === "open" ? "minmax(172px, 1fr)" : "minmax(150px, 0.74fr)")).join(" ") }}>
      {stages.map((stage) => {
        const all = placed.filter((d) => d.stage === stage.name)
          .sort((a, b) => stage.kind === "open"
            ? (a.close_date || "9999").localeCompare(b.close_date || "9999") || Number(b.amount || 0) - Number(a.amount || 0)
            : (b.closed_at || "").localeCompare(a.closed_at || ""));
        const here = stage.kind === "open" ? all : all.slice(0, CLOSED_SHOWN);
        const sum = all.filter((d) => (d.currency || currency) === currency).reduce((s, d) => s + Number(d.amount || 0), 0);
        return (
          <section
            key={stage.id}
            role="listitem"
            aria-label={`${stage.name}, ${plural(all.length, "deal")}`}
            data-stage={stage.name}
            className={`dt-col${stage.kind !== "open" ? " dt-col--closed" : ""}${over === stage.name ? " is-over" : ""}`}
          >
            <header className="dt-col__head" title={stage.meaning || undefined}>
              <StagePill stages={stages} stage={stage.name} />
              <span className="c-faint num">{all.length}</span>
              <span className="c-grow" />
              {sum ? <span className="dt-col__sum num">{moneyShort(sum, currency)}</span> : null}
            </header>
            <div className="dt-col__body">
              {here.map((d) => (
                <DealCard key={d.id} deal={d} waiting={waiting.get(d.id) || 0} dragging={dragging?.id === d.id}
                  onPress={(e) => {
                    if (e.button !== 0 || window.matchMedia("(max-width: 720px)").matches) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    press.current = { id: d.id, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width };
                    dragged.current = false;
                  }}
                  onOpen={() => { if (!dragged.current) to.deal(d.id); }} />
              ))}
              {all.length > here.length ? (
                <button type="button" className="dt-col__more" onClick={() => to.table()}>{all.length - here.length} more in the table</button>
              ) : null}
              {!all.length ? (
                <div className="dt-col__empty">
                  {stage.kind === "open" ? <><span className="dt-desk">Drop a deal here</span><span className="dt-phone">No deals here</span></>
                    : stage.kind === "won" ? "Nothing won yet" : "Nothing lost"}
                </div>
              ) : null}
            </div>
            {stage.kind === "open" ? (
              <Button variant="ghost" size="sm" icon={Plus} className="dt-col__add" onClick={() => onAdd(stage.name)}>Add deal</Button>
            ) : null}
          </section>
        );
      })}
      {dragging && ghost ? (
        <div className="dt-ghost" aria-hidden="true" style={{ left: dragging.x - dragging.dx, top: dragging.y - dragging.dy, width: dragging.w }}>
          <span className="dt-card__name">{ghost.name}</span>
          <span className="dt-card__co">{ghost.company_name || ghost.company_domain}</span>
        </div>
      ) : null}
    </div>
  );
}

function DealCard({ deal: d, waiting, dragging, onPress, onOpen }: {
  deal: Deal; waiting: number; dragging: boolean; onPress: (e: React.PointerEvent<HTMLButtonElement>) => void; onOpen: () => void;
}) {
  const { currency, warmthOf } = useDeals();
  const open = d.status === "open";
  const warm = open ? warmthOf(d) : null;
  const quiet = warm && (warm.warmth === "cooling" || warm.warmth === "cold");
  const closes = d.close_date && open ? due(d.close_date) : null;
  const who = (d.people || [])[0];
  return (
    <button
      type="button"
      className={`dt-card${dragging ? " is-dragging" : ""}`}
      onPointerDown={onPress}
      onClick={onOpen}
      aria-label={`${d.name}, ${d.company_name || ""}, ${d.stage}`}
    >
      <span className="dt-card__top">
        <span className="dt-card__name">{d.name}</span>
        {d.amount != null ? <span className="dt-card__amount num">{moneyShort(Number(d.amount), d.currency || currency)}</span> : null}
      </span>
      <span className="dt-card__co">
        <Logo name={d.company_name || who?.name} domain={d.company_domain} size={18} />
        <span className="c-ellipsis">{d.company_name || d.company_domain || nameOf(who?.name, who?.handle)}</span>
      </span>
      {d.next_step && open ? <span className="dt-card__step">{d.next_step}</span> : null}
      {!open && d.status === "lost" && d.lost_reason ? <span className="dt-card__step">{d.lost_reason}</span> : null}
      <span className="dt-card__foot">
        {closes ? (
          <span className={`dt-card__due num${closes.late ? " is-late" : ""}`}>
            <CalendarDays size={12} aria-hidden="true" />{closes.late ? closes.text : day(d.close_date)}
          </span>
        ) : !open && d.closed_at ? <span className="dt-card__due num">{day(d.closed_at)}</span> : null}
        {quiet ? <Pill tone="warning" title={warm?.last ? `Last contact ${agoText(warm.last)}` : undefined}>Quiet</Pill> : null}
        {waiting ? <Pill tone="ai" icon={Sparkles}>{plural(waiting, "change")}</Pill> : null}
        <span className="c-grow" />
        {d.owner_name ? <Avatar name={d.owner_name} size={20} /> : null}
      </span>
    </button>
  );
}

function DealTable({ deals }: { deals: Deal[] }) {
  const { stages, currency, warmthOf } = useDeals();
  const [sort, setSort] = useState<{ key: SortKey; up: boolean }>({ key: "stage", up: true });
  const order = (name: string) => stages.findIndex((s) => s.name === name);
  const rows = [...deals].sort((a, b) => {
    let r = 0;
    if (sort.key === "name") r = a.name.localeCompare(b.name);
    if (sort.key === "stage") r = order(a.stage) - order(b.stage) || (a.close_date || "9999").localeCompare(b.close_date || "9999");
    if (sort.key === "amount") r = Number(a.amount || 0) - Number(b.amount || 0);
    if (sort.key === "close") r = (a.close_date || "9999").localeCompare(b.close_date || "9999");
    if (sort.key === "activity") r = (a.last_activity_at || "").localeCompare(b.last_activity_at || "");
    return sort.up ? r : -r;
  });
  const head = (key: SortKey, label: string, className?: string) => (
    <th className={className} aria-sort={sort.key === key ? (sort.up ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setSort((s) => ({ key, up: s.key === key ? !s.up : true }))}>
        {label}{sort.key === key ? (sort.up ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />) : null}
      </button>
    </th>
  );
  return (
    <div className="c-table-wrap">
      <table className="c-table dt-table">
        <thead>
          <tr>
            {head("name", "Deal")}
            {head("stage", "Stage")}
            {head("amount", "Amount", "right")}
            {head("close", "Closes")}
            <th className="c-hide-sm">Next step</th>
            <th className="c-hide-sm">Owner</th>
            {head("activity", "Last activity", "c-hide-sm")}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const closes = d.close_date && d.status === "open" ? due(d.close_date) : null;
            const warm = d.status === "open" ? warmthOf(d) : null;
            return (
              <tr key={d.id} onClick={() => to.deal(d.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && to.deal(d.id)}>
                <td>
                  <div className="c-cell">
                    <Logo name={d.company_name} domain={d.company_domain} size={26} />
                    <div>
                      <div className="c-ellipsis dt-strong">{d.name}</div>
                      <div className="c-cell__sub">{d.company_name || d.company_domain || "—"}</div>
                    </div>
                  </div>
                </td>
                <td><StagePill stages={stages} stage={d.stage} /></td>
                <td className="right num">{dealMoney(d, currency) || <span className="c-faint">—</span>}</td>
                <td className={`num${closes?.late ? " dt-late" : ""}`}>{d.close_date ? (closes?.late ? closes.text : day(d.close_date)) : <span className="c-faint">—</span>}</td>
                <td className="c-hide-sm dt-step-cell"><span className="c-ellipsis">{d.next_step || <span className="c-faint">—</span>}</span></td>
                <td className="c-hide-sm">{d.owner_name ? <div className="c-cell"><Avatar name={d.owner_name} size={20} /><span className="c-ellipsis">{d.owner_name}</span></div> : <span className="c-faint">—</span>}</td>
                <td className="c-hide-sm">
                  <div className="c-row">
                    {warm && (warm.warmth === "cooling" || warm.warmth === "cold") ? <Pill tone="warning">Quiet</Pill> : null}
                    <span className="c-muted">{agoText(d.last_activity_at) || "—"}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function NewDeal({ stage, onClose }: { stage: string; onClose: () => void }) {
  const { stages, currency, me, reload } = useDeals();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", company_name: "", contact: "", amount: "", currency, stage: stage || stages[0]?.name || "", close_date: "", next_step: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const add = async () => {
    if (!form.name.trim()) return toast("Give it a name: what they're buying.");
    setBusy(true);
    try {
      const handle = form.contact.trim().toLowerCase();
      const out = await save<{ deal_id?: string }>("create", {
        fields: {
          name: form.name, company_name: form.company_name || null, stage: form.stage,
          people: handle.includes("@") ? [{ handle, name: null }] : [],
          amount: form.amount ? Number(form.amount.replace(/[^0-9.]/g, "")) : null, currency: form.currency,
          close_date: form.close_date || null, next_step: form.next_step || null,
        },
      }, me);
      await reload("deals");
      onClose();
      if (out.deal_id) to.deal(out.deal_id);
    } catch (e) {
      toast(`Couldn't add it: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open title="New deal" onClose={onClose}
      footer={<><span className="c-grow" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Check} busy={busy} onClick={() => void add()}>Add deal</Button></>}>
      <label className="c-field"><span>What they're buying</span><input className="c-input" value={form.name} onChange={set("name")} placeholder="Annual plan, 20 seats" autoFocus /></label>
      <label className="c-field"><span>Company</span><input className="c-input" value={form.company_name} onChange={set("company_name")} /></label>
      <label className="c-field"><span>Main contact's email</span><input className="c-input" type="email" value={form.contact} onChange={set("contact")} /></label>
      <div className="dt-amount">
        <label className="c-field"><span>Amount</span><input className="c-input" inputMode="decimal" value={form.amount} onChange={set("amount")} /></label>
        <label className="c-field"><span>Currency</span><input className="c-input" value={form.currency} onChange={set("currency")} maxLength={3} /></label>
      </div>
      <div className="dt-two">
        <label className="c-field"><span>Stage</span><select className="c-select" value={form.stage} onChange={set("stage")}>{stages.map((s) => <option key={s.id}>{s.name}</option>)}</select></label>
        <label className="c-field"><span>Expected to close</span><input className="c-input" type="date" value={form.close_date} onChange={set("close_date")} /></label>
      </div>
      <label className="c-field"><span>Next step</span><input className="c-input" value={form.next_step} onChange={set("next_step")} /></label>
    </Sheet>
  );
}

export function Waiting() {
  const { changes, loaded } = useDeals();
  return (
    <main className="c-body dt-narrow">
      <div className="c-section__head">
        <h2><Sparkles aria-hidden="true" />Waiting for you <span className="c-count">{changes.length}</span></h2>
      </div>
      <p className="c-muted dt-lead">
        Read from your own conversations and meeting notes, each with the sentence it came from. Nothing changes a deal until you keep it;
        what you dismiss teaches the next read.
      </p>
      {!loaded ? <Skeleton rows={4} kind="list" /> : changes.length === 0 ? (
        <div className="c-card"><Empty icon={Check} title="Nothing waiting">New conversations and meeting notes are read as they come in. A change to a deal shows up here first.</Empty></div>
      ) : (
        <div className="dt-props-list">{changes.map((c) => <ProposalCard key={c.id} change={c} />)}</div>
      )}
    </main>
  );
}
