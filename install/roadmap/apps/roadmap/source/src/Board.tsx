// B: the same rows as now / next / later. A person sets the horizon (a menu
// on each card, or 1, 2, 3 on the card in focus; J and K move between cards;
// there is no dragging). Progress comes from the item's Tasks project, and a
// "now" item whose tasks haven't moved in the set-up's days is flagged.
// Beside the columns: the most asked features not on the roadmap, and what
// waits on the lead (the same items Today shows them). Below: what shipped.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Globe, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { Avatar, Button, Menu, MenuItem, MenuLabel, Pill, SearchField, Sheet, Skeleton, plural, useToast } from "@lemma-plugins/kit";
import { makeProject, refreshToday, setItem, ship, useRoadmap, type Data } from "./data";
import { StagePill, monthDay } from "./marks";
import { HORIZON_WORD, listed, moneySaid, notPlanned, sortRows, type Row } from "./rank";
import { to } from "./route";
import { Top } from "./Top";
import { typing } from "./ui";
import type { Horizon } from "./types";

const LANES: { id: "now" | "next" | "later"; title: string; hint: string }[] = [
  { id: "now", title: "Now", hint: "being built" },
  { id: "next", title: "Next", hint: "decided, not started" },
  { id: "later", title: "Later", hint: "likely, not decided" },
];

export function useMove() {
  const toast = useToast();
  const data = useRoadmap();
  return async (r: Row, horizon: Horizon | "decline") => {
    try {
      const out = horizon === "decline" ? await setItem(r.id, { decline: true }) : await setItem(r.id, { horizon });
      toast(String(out.message || "Moved."));
      await data.reload();
      refreshToday();
    } catch (e) {
      toast(`Couldn't move it: ${e instanceof Error ? e.message : e}`);
    }
  };
}

export function Board() {
  const data = useRoadmap();
  const move = useMove();
  const [focus, setFocus] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => data.rows.filter(listed), [data.rows]);
  const lanes = useMemo(() => LANES.map((l) => ({ ...l, rows: sortRows(rows.filter((r) => r.horizon === l.id), "people") })), [rows]);
  const order = lanes.flatMap((l) => l.rows);
  const shipped = rows.filter((r) => r.horizon === "shipped" && (r.item?.shipped_on || "") >= new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10))
    .sort((a, b) => String(b.item?.shipped_on || "").localeCompare(String(a.item?.shipped_on || "")));
  const unplanned = sortRows(rows.filter(notPlanned), "people").slice(0, 6);
  const planned = order.length;
  const publicShown = rows.filter((r) => r.item?.public && (["now", "next", "later"].includes(r.horizon) || shipped.includes(r))).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const at = order.findIndex((r) => r.id === focus);
      if (e.key === "j" || e.key === "k") {
        const next = order[Math.max(0, Math.min(order.length - 1, at + (e.key === "j" ? 1 : -1)))];
        if (next) {
          setFocus(next.id);
          document.getElementById(`rm-card-${next.id}`)?.focus();
        }
      } else if (["1", "2", "3"].includes(e.key) && at >= 0) {
        const target = LANES[Number(e.key) - 1].id;
        if (order[at].horizon !== target) void move(order[at], target);
      } else if (e.key === "Enter" && at >= 0) {
        to.feature(order[at].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, focus, move]);

  if (!data.loaded) return <Skeleton kind="list" rows={6} />;
  return (
    <>
      <Top view="board" count={`${planned} planned · ${plural(shipped.length, "shipped")} in 90 days`}>
        <Button size="sm" icon={Globe} onClick={() => to.setup()}>
          {data.settings?.public_on ? `Public page: on · ${publicShown} shown` : "Public page: off"}
        </Button>
        <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add to roadmap</Button>
      </Top>
      <div className="rm-toolbar"><span className="c-muted rm-small">You set the horizon. Progress comes from each item's tasks. Keys: J and K move, 1, 2 and 3 put the card in Now, Next or Later.</span></div>
      <div className="rm-board">
        <div className="rm-lanes">
          {lanes.map((l) => (
            <section key={l.id} className="rm-lane" aria-label={l.title}>
              <div className="rm-lane__head"><b>{l.title}</b><span>{l.rows.length} · {l.hint}</span></div>
              {l.rows.map((r) => <BoardCard key={r.id} r={r} data={data} focused={focus === r.id} onFocus={() => setFocus(r.id)} />)}
              {!l.rows.length ? <p className="c-faint rm-small rm-lane__empty">Nothing in {l.title} yet.</p> : null}
            </section>
          ))}
        </div>
        <aside className="rm-board__side">
          <section className="rm-panel">
            <h2>Most asked, not on the roadmap</h2>
            {unplanned.map((r) => (
              <div className="rm-li" key={r.id}>
                <button type="button" className="rm-li__main" onClick={() => to.feature(r.id)}>
                  <span>{r.name}</span>
                  <span className="c-faint rm-small">{plural(r.people, "person", "people")} · {plural(r.companies, "company", "companies")}{moneySaid(r.open, data.currency) ? ` · ${moneySaid(r.open, data.currency)} open` : " · no open deals"}</span>
                </button>
                <Menu label="Add" icon={ChevronDown} size="sm" align="right">
                  {(close) => LANES.map((l) => <MenuItem key={l.id} onSelect={() => { close(); void move(r, l.id); }}>{l.title}</MenuItem>)}
                </Menu>
              </div>
            ))}
            {data.suggested[0] ? (
              <div className="rm-li">
                <span className="rm-li__main"><span>{data.suggested[0].name} <span className="c-faint">(suggested)</span></span>
                  <span className="c-faint rm-small">{plural(data.suggested[0].quotes, "quote")} · {plural(data.suggested[0].companies, "company", "companies")} · not yet a feature</span></span>
              </div>
            ) : null}
            {!unplanned.length && !data.suggested.length ? <p className="c-faint rm-small">Everything people asked for is on the roadmap.</p> : null}
          </section>
          <Waiting rows={rows} data={data} />
        </aside>
        {shipped.length ? (
          <div className="rm-shipped">
            <Pill tone="success" dot>Shipped</Pill>
            {shipped.map((r) => (
              <button key={r.id} type="button" className="rm-shipped__item" onClick={() => to.feature(r.id)}>
                <span>{r.name}</span>
                <span className="c-faint">{monthDay(r.item?.shipped_on)} · {plural(r.people, "person", "people")} asked · {plural(r.tell, "person", "people")} to tell when it's live</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <AddToRoadmap open={adding} onClose={() => setAdding(false)} rows={rows} />
    </>
  );
}

function BoardCard({ r, data, focused, onFocus }: { r: Row; data: Data; focused: boolean; onFocus: () => void }) {
  const move = useMove();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const p = r.progress;
  const open = moneySaid(r.open, data.currency);
  const make = async () => {
    setBusy(true);
    try {
      const out = await makeProject(r.id);
      toast(String(out.message || "Made the project."));
      await data.reload();
    } catch (e) {
      toast(`Couldn't make the project: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  const owner = r.item?.owner_label || null;
  return (
    <article id={`rm-card-${r.id}`} className={focused ? "rm-bcard rm-bcard--focus" : "rm-bcard"} tabIndex={0} onFocus={onFocus}
      aria-label={r.name}>
      <div className="rm-bcard__top">
        <button type="button" className="rm-bcard__name" onClick={() => to.feature(r.id)}>{r.name}</button>
        <StagePill stage={r.stage} />
      </div>
      <span className="rm-bcard__sub">{plural(r.people, "person", "people")} · {plural(r.companies, "company", "companies")} · {open ? `${open} open` : "no open deals"}</span>
      {p && p.total ? (
        <>
          <div className="rm-bar" role="img" aria-label={`${p.done} of ${p.total} tasks done`}><i style={{ width: `${Math.round((p.done / p.total) * 100)}%` }} /></div>
          <span className="c-faint rm-small">{p.done} of {plural(p.total, "task")}{p.name ? ` · ${p.name}` : ""}</span>
        </>
      ) : p ? (
        <span className="c-faint rm-small">{p.name || "Its project"} has no tasks yet</span>
      ) : (
        <div className="rm-line"><span className="c-faint rm-small">No project yet</span><Button size="sm" busy={busy} onClick={() => void make()}>Make one in Tasks</Button></div>
      )}
      {r.stale ? <span className="rm-flag"><TriangleAlert size={13} aria-hidden="true" />No task moved in {r.moved_days} days</span> : null}
      {p && p.total && p.done >= p.total && r.horizon !== "shipped" ? <span className="rm-flag rm-flag--done">Every task done</span> : null}
      <div className="rm-line rm-bcard__foot">
        {owner ? <><Avatar name={owner} size={20} /><span className="c-faint rm-small">{owner}</span></> : <span className="c-faint rm-small">No owner</span>}
        {r.item?.public ? <span className="c-faint rm-small rm-public"><Globe size={12} aria-hidden="true" />Public</span> : null}
        <span className="rm-bcard__menu">
          <Menu label={HORIZON_WORD[r.horizon]} icon={ChevronDown} size="sm" variant="ghost" align="right">
            {(close) => (
              <>
                <MenuLabel>Move to</MenuLabel>
                {LANES.filter((l) => l.id !== r.horizon).map((l) => <MenuItem key={l.id} hint={String(LANES.indexOf(l) + 1)} onSelect={() => { close(); void move(r, l.id); }}>{l.title}</MenuItem>)}
                {p && p.total && p.done >= p.total ? <MenuItem onSelect={() => { close(); void ship(r.id).then((o) => { toast(String(o.message)); void data.reload(); refreshToday(); }); }}>Shipped</MenuItem> : null}
                <MenuItem onSelect={() => { close(); void move(r, "none"); }}>Off the roadmap</MenuItem>
              </>
            )}
          </Menu>
        </span>
      </div>
    </article>
  );
}

/** What waits on the lead: the items roadmap_tick writes to their Today, worked out the same way. */
function Waiting({ rows, data }: { rows: Row[]; data: Data }) {
  const stale = rows.filter((r) => r.stale);
  const done = rows.filter((r) => ["now", "next", "later"].includes(r.horizon) && r.progress && r.progress.total && r.progress.done >= r.progress.total);
  const sugg = data.suggested.filter((s) => s.quotes >= 5);
  if (!stale.length && !done.length && !sugg.length) return null;
  return (
    <section className="rm-panel">
      <h2 className="rm-line"><Sparkles size={13} aria-hidden="true" className="c-faint" /><Pill tone="ai">ai</Pill>Waiting on you</h2>
      {stale.map((r) => (
        <button key={`s${r.id}`} type="button" className="rm-li rm-li--btn" onClick={() => to.feature(r.id)}>
          <span className="rm-li__main"><span>{r.name} has had no task move in {r.moved_days} days.</span><span className="c-faint rm-small">Asked its lead in Today: keep it in Now?</span></span>
        </button>
      ))}
      {done.map((r) => (
        <button key={`d${r.id}`} type="button" className="rm-li rm-li--btn" onClick={() => to.feature(r.id)}>
          <span className="rm-li__main"><span>{r.name}: {r.progress!.done} of {plural(r.progress!.total, "task")} done.</span><span className="c-faint rm-small">Mark it shipped when it's live for everyone.</span></span>
        </button>
      ))}
      {sugg.map((s) => (
        <div key={s.id} className="rm-li"><span className="rm-li__main"><span>{s.name}: {plural(s.quotes, "quote")}, not a feature yet.</span><span className="c-faint rm-small">User feedback suggested it; add it or merge it there.</span></span></div>
      ))}
    </section>
  );
}

function AddToRoadmap({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: Row[] }) {
  const move = useMove();
  const [search, setSearch] = useState("");
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const list = sortRows(rows.filter((r) => notPlanned(r) && words.every((w) => r.name.toLowerCase().includes(w))), "people");
  return (
    <Sheet open={open} title="Add to the roadmap" onClose={onClose}>
      <SearchField value={search} onChange={setSearch} placeholder="Search features not on the roadmap" />
      <div className="rm-addlist">
        {list.map((r) => (
          <div key={r.id} className="rm-li">
            <span className="rm-li__main"><span>{r.name}</span><span className="c-faint rm-small">{plural(r.people, "person", "people")} · {plural(r.companies, "company", "companies")}</span></span>
            <span className="rm-line">
              {LANES.map((l) => <Button key={l.id} size="sm" onClick={() => void move(r, l.id)}>{l.title}</Button>)}
            </span>
          </div>
        ))}
        {!list.length ? <p className="c-faint rm-small">Nothing else to add.</p> : null}
      </div>
    </Sheet>
  );
}
