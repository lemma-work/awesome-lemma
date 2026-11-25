// The parts of a sprint's page, shared by the running sprint (/) and a past
// one (/s/<n>): the numbers row, the scope graph with its numbered steps, the
// tasks grouped by in at start / added / taken out or by person, and capacity
// by person.

import { useEffect, useMemo, useState } from "react";
import { Segmented, cx } from "@lemma-plugins/kit";
import { ScopeChart } from "./charts";
import { itemSize, numbers, num, ordinal, series, shortDay, sourceText, awayText, whoOf, localKey, firstName, isDone, type World, type Capacity } from "./model";
import { StatusPill, WhoMark, openTask } from "./marks";
import type { Item, Measure, Sprint } from "./types";
import { Pill, type Tone } from "@lemma-plugins/kit";

export function unitWord(m: Measure): string {
  return m === "points" ? "pts" : "tasks";
}

export function Stats({ w, sprint, measure, capacityTotal, closing }: { w: World; sprint: Sprint; measure: Measure; capacityTotal: number | null; closing?: boolean }) {
  const n = numbers(w, sprint, measure);
  const u = unitWord(measure);
  const cells: { label: string; value: string; sub: string }[] = [
    { label: "In at start", value: `${num(n.inAtStart.size)}${measure === "points" ? " pts" : ""}`, sub: `${n.inAtStart.tasks} ${n.inAtStart.tasks === 1 ? "task" : "tasks"}` },
    { label: "Added after start", value: `${n.added.size ? "+" : ""}${num(n.added.size)}${measure === "points" ? " pts" : ""}`,
      sub: `${n.added.tasks} ${n.added.tasks === 1 ? "task" : "tasks"}${n.added.tasks ? ` · ${n.added.sources} ${n.added.sources === 1 ? "source" : "sources"}` : ""}` },
    { label: "Taken out", value: `${n.removed.size ? "−" : ""}${num(n.removed.size)}${measure === "points" ? " pts" : ""}`, sub: `${n.removed.tasks} ${n.removed.tasks === 1 ? "task" : "tasks"}` },
    { label: "Done", value: `${num(n.done.size)} of ${num(n.scope)}`,
      sub: closing || sprint.state === "closed" ? `${n.done.tasks} tasks · ${num(n.done.ofPlan)} of the plan` : `target by today ${num(n.target)}` },
  ];
  if (closing || sprint.state === "closed") {
    cells.push({ label: "Not done", value: num(n.notDone.size), sub: `${n.notDone.tasks} ${n.notDone.tasks === 1 ? "task" : "tasks"}${closing ? " · decide below" : ""}` });
  } else {
    cells.push({ label: "Capacity", value: capacityTotal == null ? "None yet" : `${num(capacityTotal)} ${u}`,
      sub: capacityTotal == null ? "no closed sprint to go on" : "last 3 sprints, less days off" });
  }
  return (
    <div className="sp-stats">
      {cells.map((c) => (
        <div key={c.label} className="sp-stat">
          <span className="sp-stat__l">{c.label}</span>
          <span className="sp-stat__n">{c.value}</span>
          <span className="sp-stat__s">{c.sub}</span>
        </div>
      ))}
      {n.unestimated ? <p className="sp-stats__note">{n.unestimated} {n.unestimated === 1 ? "task has" : "tasks have"} no estimate and {n.unestimated === 1 ? "counts" : "count"} as 0 points.</p> : null}
    </div>
  );
}

export function ScopeCard({ w, sprint, measure, onMeasure }: { w: World; sprint: Sprint; measure: Measure; onMeasure?: (m: Measure) => void }) {
  const s = useMemo(() => series(w, sprint, measure), [w, sprint, measure]);
  const n = numbers(w, sprint, measure);
  const u = unitWord(measure);
  const label = `Scope started at ${num(n.inAtStart.size)} ${u} and is ${num(n.scope)} now; ${num(n.done.size)} done` +
    (s.projection.length ? `, and at this pace ${num(s.projection[1].y)} get done.` : ".");
  return (
    <section className="sp-card">
      <div className="sp-card__head">
        <h2>Scope and progress</h2>
        <span className="c-grow" />
        <span className="sp-lg"><i className="sp-sw sp-sw--scope" />Scope</span>
        <span className="sp-lg"><i className="sp-sw sp-sw--target" />Target</span>
        <span className="sp-lg"><i className="sp-sw sp-sw--started" />Started</span>
        <span className="sp-lg"><i className="sp-sw sp-sw--done" />Done</span>
        {onMeasure ? (
          <Segmented label="Measure" items={[{ id: "points", label: "Points" }, { id: "tasks", label: "Tasks" }]} value={measure} onChange={(m) => onMeasure(m as Measure)} />
        ) : null}
      </div>
      <div className="sp-card__chart"><ScopeChart s={s} unit={u} label={label} /></div>
      {s.steps.length ? (
        <ol className="sp-steps" aria-label="What changed the scope">
          {s.steps.map((st) => (
            <li key={st.n} className="sp-step">
              <span className="sp-num">{st.n}</span>
              <span className="c-faint sp-step__when">{clockText(w, st.at)}</span>
              <span className="sp-step__delta">{st.delta >= 0 ? "+" : "−"}{num(Math.abs(st.delta))} {u}</span>
              <span className="c-ellipsis">{st.what}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="sp-card__foot c-faint">Nothing has been added or taken out since the start.</p>
      )}
    </section>
  );
}

function clockText(w: World, at: string): string {
  const key = localKey(at, w.zone) || at.slice(0, 10);
  try {
    const t = new Intl.DateTimeFormat("en-GB", { timeZone: w.zone || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
    return `${shortDay(key)}, ${t}`;
  } catch {
    return shortDay(key);
  }
}

type Grouping = "commit" | "person";

export function TaskList({ w, sprint, measure, cap, keys = true }: { w: World; sprint: Sprint; measure: Measure; cap: Capacity | null; keys?: boolean }) {
  const [by, setBy] = useState<Grouping>("commit");
  const [cursor, setCursor] = useState(0);
  const items = w.itemsBy.get(sprint.id) || [];
  const u = unitWord(measure);
  const groups = useMemo(() => {
    const order = (a: Item, b: Item) => (w.tasks.get(a.task_id)?.number || 0) - (w.tasks.get(b.task_id)?.number || 0);
    if (by === "commit") {
      const plan = items.filter((i) => i.in_at_start && !i.removed_at).sort(order);
      const added = items.filter((i) => !i.in_at_start && !i.removed_at).sort(order);
      const out = items.filter((i) => i.removed_at).sort(order);
      const size = (g: Item[]) => g.reduce((a, i) => a + (measure === "tasks" ? 1 : i.in_at_start ? Number(i.points_at_add ?? 0) : itemSize(w, i, measure)), 0);
      return [
        { name: sprint.state === "planned" ? "Planned" : "In at start", n: `${plan.length} ${plan.length === 1 ? "task" : "tasks"} · ${num(size(plan))} ${u}${out.some((i) => i.in_at_start) ? ` still in; ${out.filter((i) => i.in_at_start).length} taken out below` : ""}`, rows: plan },
        { name: "Added after start", n: `${added.length} tasks · ${num(size(added))} ${u}`, rows: added },
        { name: "Taken out", n: `${out.length} ${out.length === 1 ? "task" : "tasks"} · ${num(size(out))} ${u}`, rows: out },
      ].filter((g) => g.rows.length || g.name !== "Taken out");
    }
    const map = new Map<string, { name: string; rows: Item[]; kind: string }>();
    for (const i of items.filter((x) => !x.removed_at)) {
      const who = whoOf(w.tasks.get(i.task_id));
      const g = map.get(who.key) || map.set(who.key, { name: who.kind === "agent" ? "The Lemma's assistant" : who.kind === "none" ? "Nobody yet" : firstName(who.name), rows: [], kind: who.kind }).get(who.key)!;
      g.rows.push(i);
    }
    return [...map.entries()].sort((a, b) => (a[1].kind === b[1].kind ? 0 : a[1].kind === "person" ? -1 : b[1].kind === "person" ? 1 : a[1].kind === "agent" ? -1 : 1))
      .map(([key, g]) => {
        const p = cap?.people.find((x) => x.key === key);
        const size = g.rows.reduce((a, i) => a + itemSize(w, i, measure), 0);
        const n = g.kind === "agent" ? `${g.rows.length} tasks` : `${num(size)} ${u}${p ? (p.usual == null ? " · no usual yet" : ` · usual ${num(p.usual)}`) : ""}${p?.away.length ? ` · out ${awayText(p.away.map((a) => a.day))}` : ""}`;
        return { name: g.name, n, rows: g.rows.sort(order) };
      });
  }, [by, items, w, measure, sprint.state, u, cap]);
  const flat = groups.flatMap((g) => g.rows);

  useEffect(() => {
    if (!keys) return;
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "J") { setCursor((c) => Math.min(flat.length - 1, c + 1)); e.preventDefault(); }
      else if (e.key === "k" || e.key === "K") { setCursor((c) => Math.max(0, c - 1)); e.preventDefault(); }
      else if (e.key === "Enter" && flat[cursor]) openTask(w.tasks.get(flat[cursor].task_id));
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [keys, flat, cursor, w]);

  return (
    <section className="sp-tasks">
      <div className="sp-sechead">
        <h2 className="sp-sec">Tasks</h2>
        <Segmented label="Group tasks by" items={[{ id: "commit", label: "In at start · added · out" }, { id: "person", label: "By person" }]} value={by} onChange={(v) => setBy(v as Grouping)} />
        <span className="c-grow" />
        <span className="c-faint sp-hint">Open a task in Tasks to change it</span>
      </div>
      <div className="sp-box">
        {groups.map((g) => (
          <div key={g.name} role="group" aria-label={g.name}>
            <div className="sp-grp">{g.name}<span className="c-faint">{g.n}</span></div>
            {g.rows.length ? g.rows.map((i) => {
              const k = flat.indexOf(i);
              return <TaskRow key={i.id} w={w} sprint={sprint} item={i} measure={measure} here={k === cursor} onPick={() => setCursor(k)} />;
            }) : <div className="sp-empty-row c-faint">None</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskRow({ w, sprint, item, measure, here, onPick }: { w: World; sprint: Sprint; item: Item; measure: Measure; here: boolean; onPick: () => void }) {
  const t = w.tasks.get(item.task_id);
  const who = whoOf(t);
  const src = sourceText(w, t);
  const from = (() => {
    const carried = item.carried_from ? w.sprintById.get(item.carried_from)?.number : null;
    if (item.removed_at) return `planned · moved to backlog ${shortDay(localKey(item.removed_at, w.zone) || "")}${item.removed_by ? ` by ${firstName(item.removed_by)}` : ""}`;
    if (!item.in_at_start && sprint.state !== "planned") return [src || "added", `added ${shortDay(localKey(item.added_at, w.zone) || "")}${item.added_by ? ` by ${firstName(item.added_by)}` : ""}`].join(" · ");
    return [src, "planned", carried ? `carried from Sprint ${carried}` : "", who.kind === "agent" ? "handed to the Lemma's assistant" : ""].filter(Boolean).join(" · ");
  })();
  const nth = Number(item.nth || 1);
  let flag: { text: string; tone: Tone } | null = null;
  if (item.removed_at) flag = { text: "taken out", tone: "danger" };
  else if (nth >= 2) flag = { text: `${ordinal(nth)} sprint`, tone: nth >= 3 ? "warning" : "plain" };
  else if (!item.in_at_start && sprint.state !== "planned") flag = { text: who.kind === "agent" ? "added · agent" : "added", tone: "info" };
  else if (isDone(w, item) && item.done_at) flag = { text: `done ${shortDay(localKey(item.done_at, w.zone) || "")}`, tone: "plain" };
  else if (t?.status === "waiting") {
    const since = w.events.filter((e) => e.task_id === item.task_id && (e.detail as { to?: string })?.to === "waiting").pop();
    flag = { text: since ? `since ${shortDay(localKey(since.at, w.zone) || "")}` : "waiting", tone: "plain" };
  } else if (who.kind === "agent") flag = { text: "agent", tone: "plain" };
  const pts = measure === "tasks" ? "" : sprint.state === "closed" && item.closed_points != null ? num(item.closed_points) : w.est.has(item.task_id) ? num(w.est.get(item.task_id)) : "–";
  return (
    <div className={cx("sp-row", here && "is-cursor")} onMouseDown={onPick}>
      <span className="sp-mono c-faint">#{t?.number ?? "?"}</span>
      <button type="button" className="sp-row__main" onClick={() => openTask(t)} title="Open in Tasks">
        <span className="c-ellipsis">{t?.title || "A task deleted in Tasks"}</span>
        <span className="c-ellipsis c-faint sp-row__sub">{from}</span>
      </button>
      <WhoMark who={who} />
      <span className="c-faint sp-row__pts">{pts}</span>
      <span className="sp-row__status">{item.removed_at ? <Pill>Backlog</Pill> : sprint.state === "closed" ? <OutcomePill item={item} next={sprint.number + 1} /> : t ? <StatusPill status={t.status} /> : null}</span>
      <span className="sp-row__flag">{flag ? <Pill tone={flag.tone} dot={false}>{flag.text}</Pill> : <span className="c-faint">—</span>}</span>
    </div>
  );
}

function OutcomePill({ item, next }: { item: Item; next: number }) {
  const [word, tone]: [string, Tone] = item.outcome === "done" ? ["Done", "success"] : item.outcome === "carried" ? [`Carried to ${next}`, "info"]
    : item.outcome === "split" ? ["Split", "info"] : item.outcome === "dropped" ? ["Dropped", "plain"] : item.outcome === "backlog" ? ["To the backlog", "plain"] : ["Not done", "warning"];
  return <Pill tone={tone}>{word}</Pill>;
}

export function CapacityPanel({ w, sprint, cap, measure, title = "Capacity by person", note }: { w: World; sprint: Sprint; cap: Capacity; measure: Measure; title?: string; note?: string }) {
  const u = unitWord(measure);
  const here = (w.itemsBy.get(sprint.id) || []).filter((i) => !i.removed_at);
  const agentDone = (agent: string) => here.filter((i) => isDone(w, i) && whoOf(w.tasks.get(i.task_id)).agent === agent).length;
  return (
    <section className="sp-capacity">
      <div className="sp-sechead"><h2 className="sp-sec">{title}</h2><span className="c-grow" /><span className="c-faint sp-hint">this sprint / capacity</span></div>
      {cap.people.map((p) => {
        const over = p.cap != null && p.planned > p.cap + 1e-9;
        const width = p.cap ? Math.min(100, (p.planned / p.cap) * 100) : 0;
        return (
          <div key={p.key} className="sp-cap">
            <WhoMark who={{ kind: "person", key: p.key, name: p.name }} />
            <span className="c-ellipsis">{firstName(p.name)}</span>
            <span className={cx("sp-bar", p.cap == null && "sp-bar--none")}><i className={cx(over && "is-over")} style={{ width: `${width}%` }} /></span>
            <span className="c-faint sp-cap__v">{p.cap == null ? `${num(p.planned)} · none yet` : `${num(p.planned)} / ${num(p.cap)}`}</span>
            {over || p.away.length || p.cap == null ? (
              <span className="sp-cap__note">
                {over ? <Pill tone="warning">{num(p.planned - (p.cap || 0))} over</Pill> : null}
                {p.away.length ? <Pill dot={false}>Out {awayText(p.away.map((a) => a.day))}</Pill> : null}
                {p.cap == null ? <Pill dot={false}>No capacity yet</Pill> : null}
              </span>
            ) : null}
          </div>
        );
      })}
      {cap.agents.filter((a) => a.tasks).map((a) => (
        <div key={a.agent} className="sp-cap">
          <WhoMark who={{ kind: "agent", key: `agent:${a.agent}`, name: "The Lemma's assistant", agent: a.agent }} />
          <span className="c-ellipsis">{a.agent === "pod_default" ? "Assistant" : a.agent}</span>
          <span className="sp-bar"><i style={{ width: `${(agentDone(a.agent) / a.tasks) * 100}%` }} /></span>
          <span className="c-faint sp-cap__v">{agentDone(a.agent)} of {a.tasks} done</span>
        </div>
      ))}
      {!cap.people.length && !cap.agents.length ? <p className="c-faint">Nobody has work in this sprint yet.</p> : null}
      <p className="c-faint sp-small">{note || `Usual = what each person finished in their last 3 sprints, in ${u}. The Lemma's assistant is counted in tasks, never in capacity.`}</p>
    </section>
  );
}
