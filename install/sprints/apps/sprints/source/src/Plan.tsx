// B: the sprint being planned. Capacity across the top (each person's usual
// less their days off), the Lemma's draft, the queue to plan from (what is
// still open in the running sprint, what came in since it started, the
// backlog) with estimates, and the sprint by person.
//
// No drag: J/K move, A adds or takes out, 1-5 estimates on the scale, M says
// who does it, / searches.

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button, Empty, Kbd, Pill, SearchField, Segmented, Sheet, cx, useToast } from "@lemma-plugins/kit";
import { DaysOff, people } from "./Away";
import { addTasks, assign, call, estimate, removeTasks, useSprints, useWho } from "./data";
import { AiMark, WhoMark, openTask } from "./marks";
import {
  PRIORITY, SOURCE_NAMES, awayText, capacity, draft, firstName, longDay, monthDay, num, ordinal, present, range, sourceText, whoOf, workingDays,
  type Capacity, type World,
} from "./model";
import { Top } from "./Top";
import { unitWord } from "./SprintView";
import type { Measure, Sprint, Task } from "./types";

interface Row { task: Task; group: string; inSprint: boolean; locked?: string; nth: number }

export function Plan() {
  const { w, settings } = useSprints();
  const { me, members } = useWho();
  const toast = useToast();
  const [measure, setMeasure] = useState<Measure>(w.measure);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState(0);
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState("");
  const [picking, setPicking] = useState<Task | null>(null);
  const sprint = w.planned;
  const running = w.running;
  const cap = useMemo(() => (sprint ? capacity(w, sprint, measure) : null), [w, sprint, measure]);
  const rows = useMemo(() => (sprint ? queue(w, sprint, running) : []), [w, sprint, running]);
  const shown = rows.filter((r) => !search.trim() || `#${r.task.number} ${r.task.title}`.toLowerCase().includes(search.trim().toLowerCase()));
  const lead = !!me && settings?.lead_user_id === me.id;
  const scale = (settings?.scale || [1, 2, 3, 5, 8]).slice(0, 5);
  const plan = useMemo(() => (sprint && cap ? draft(w, sprint, rows.filter((r) => !r.locked).map((r) => r.task), capacity(w, sprint, w.measure)) : null), [w, sprint, rows, cap]);

  const run = async (key: string, work: () => Promise<{ message?: string } | void>) => {
    setBusy(key);
    try {
      const out = await work();
      if (out && out.message) toast(out.message);
    } catch (e) {
      toast(`Couldn't do that: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  const toggle = (r: Row) => {
    if (!sprint || r.locked) return;
    void run(r.task.id, () => (r.inSprint ? removeTasks([r.task.id], sprint.number) : addTasks([r.task.id], sprint.number)));
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || !shown.length) return;
      const r = shown[Math.min(cursor, shown.length - 1)];
      const k = e.key.toLowerCase();
      if (k === "j") { setCursor((c) => Math.min(shown.length - 1, c + 1)); e.preventDefault(); }
      else if (k === "k") { setCursor((c) => Math.max(0, c - 1)); e.preventDefault(); }
      else if (k === "a") { toggle(r); e.preventDefault(); }
      else if (k === "m") { setPicking(r.task); e.preventDefault(); }
      else if (k === "enter") openTask(r.task);
      else if (/^[1-5]$/.test(k) && measure === "points" && scale[Number(k) - 1] != null) {
        void run(`e${r.task.id}`, () => estimate(r.task.id, scale[Number(k) - 1]));
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  if (!sprint || !cap) {
    return (
      <>
        <Top title="Plan" here="plan" />
        <main className="c-body"><Empty icon={CalendarPlus} title="No sprint to plan">The next sprint opens for planning when this one starts.</Empty></main>
      </>
    );
  }
  const days = workingDays(sprint.starts_on, sprint.ends_on);
  const ahead = Math.round((Date.parse(sprint.starts_on) - Date.parse(w.today)) / 86_400_000);
  const when = ahead < 0 ? "Should have started" : ahead === 0 ? "Starts today" : ahead === 1 ? "Starts tomorrow" : ahead < 7 ? `Starts ${longDay(sprint.starts_on)}` : `Starts ${monthDay(sprint.starts_on)}`;
  const u = unitWord(measure);
  const blocked = running ? `Close Sprint ${running.number} first` : !lead ? `${settings?.lead_name || "The lead"} starts sprints` : "";
  const start = () => void run("start", () => call("sprints_start", { sprint: sprint.number, via: "app" }));
  const useDraft = () => {
    if (!plan?.adds.length) return;
    const assignTo: Record<string, unknown> = {};
    for (const a of plan.adds) assignTo[a.taskId] = { user_id: a.who.user_id || null, name: a.who.name };
    void run("draft", () => addTasks(plan.adds.map((a) => a.taskId), sprint.number, assignTo));
  };
  let flat = 0;
  return (
    <>
      <Top title={`Plan Sprint ${sprint.number}`} here="plan" pill={<Pill tone={ahead < 0 ? "warning" : "plain"}>{when}</Pill>}
        dates={`${range(sprint.starts_on, sprint.ends_on)} · ${days.length} days`}>
        <Button variant="primary" busy={busy === "start"} disabled={!!blocked} title={blocked || undefined} onClick={start}>Start Sprint {sprint.number}</Button>
      </Top>
      <Meter w={w} sprint={sprint} cap={cap} measure={measure} onMeasure={w.measure === "points" ? setMeasure : undefined} />
      {plan?.text ? (
        <div className="sp-draft">
          <AiMark />
          <p className="c-muted">{plan.text}</p>
          <div className="sp-risk__acts">
            <Button size="sm" busy={busy === "draft"} onClick={useDraft}>Use the draft</Button>
            <Button size="sm" variant="ghost" aria-expanded={why} onClick={() => setWhy(!why)}>Why each one</Button>
          </div>
          {why ? <ul className="sp-why">{plan.adds.map((a) => <li key={a.taskId}>{a.reason}</li>)}</ul> : null}
        </div>
      ) : null}
      <div className="sp-body sp-body--even">
        <div className="sp-main">
          <div className="sp-sechead">
            <h2 className="sp-sec">To plan</h2>
            <span className="c-grow" />
            <span className="c-faint sp-hint sp-keys"><Kbd>J</Kbd><Kbd>K</Kbd> move · <Kbd>A</Kbd> add · <Kbd>1</Kbd>–<Kbd>5</Kbd> estimate · <Kbd>M</Kbd> assign · <Kbd>/</Kbd> search</span>
          </div>
          <SearchField value={search} onChange={setSearch} placeholder="Search tasks to plan" />
          <div className="sp-box">
            {groups(shown, running, w).map((g) => (
              <div key={g.name} role="group" aria-label={g.name}>
                <div className="sp-grp">{g.name}<span className="c-faint">{g.note}</span></div>
                {g.rows.length ? g.rows.map((r) => {
                  const k = flat++;
                  return (
                    <QueueRow key={`${g.name}${r.task.id}`} r={r} w={w} measure={measure} scale={scale} here={k === cursor} busy={busy}
                      onPick={() => setCursor(k)} onToggle={() => toggle(r)} onEstimate={(p) => void run(`e${r.task.id}`, () => estimate(r.task.id, p))} />
                  );
                }) : <div className="sp-empty-row c-faint">{g.empty}</div>}
              </div>
            ))}
          </div>
        </div>
        <aside className="sp-side sp-side--plain">
          <Lanes w={w} sprint={sprint} cap={cap} measure={measure} />
          <DaysOff w={w} sprint={sprint} cap={cap} />
        </aside>
      </div>
      <AssignSheet task={picking} onClose={() => setPicking(null)} options={people(w, cap, members)} />
    </>
  );
}

/** What there is to plan from, in order. */
function queue(w: World, sprint: Sprint, running: Sprint | null): Row[] {
  const inPlan = new Set(present(w.itemsBy.get(sprint.id) || []).map((i) => i.task_id));
  const nthOf = (id: string) => Number((w.itemsBy.get(sprint.id) || []).find((i) => i.task_id === id)?.nth || 1);
  const out: Row[] = [];
  const seen = new Set<string>();
  const openIn = running ? present(w.itemsBy.get(running.id) || []).filter((i) => i.outcome === "open" && w.tasks.get(i.task_id)?.status !== "done") : [];
  for (const i of openIn) {
    const t = w.tasks.get(i.task_id);
    if (!t) continue;
    seen.add(t.id);
    out.push({ task: t, group: "open", inSprint: false, locked: "at close", nth: Number(i.nth || 1) + 1 });
  }
  const carried = present(w.itemsBy.get(sprint.id) || []).filter((i) => i.carried_from);
  for (const i of carried) {
    const t = w.tasks.get(i.task_id);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ task: t, group: "carried", inSprint: true, nth: Number(i.nth || 1) });
  }
  const since = running?.started_at || w.closed[w.closed.length - 1]?.closed_at || null;
  const busyElsewhere = new Set(w.items.filter((i) => !i.removed_at && i.outcome === "open" && w.sprintById.get(i.sprint_id)?.state !== "closed" && i.sprint_id !== sprint.id).map((i) => i.task_id));
  const open = [...w.tasks.values()].filter((t) => !seen.has(t.id) && !busyElsewhere.has(t.id) && !t.parent_id && ["todo", "in_progress", "waiting"].includes(t.status));
  const watched = new Set(["incidents", "triage", "pr_review"]);
  for (const t of open.filter((x) => watched.has(x.source) && since && x.created_at > since).sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] || b.number - a.number)) {
    seen.add(t.id);
    out.push({ task: t, group: "came", inSprint: inPlan.has(t.id), nth: nthOf(t.id) });
  }
  for (const t of open.filter((x) => !seen.has(x.id)).sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] || b.number - a.number)) {
    out.push({ task: t, group: "backlog", inSprint: inPlan.has(t.id), nth: nthOf(t.id) });
  }
  return out;
}

const tasks = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

function groups(rows: Row[], running: Sprint | null, w: World) {
  const prev = running ? running.number : w.closed[w.closed.length - 1]?.number;
  const of = (g: string) => rows.filter((r) => r.group === g);
  const list = [
    running ? { name: `Still open in Sprint ${running.number}`, note: `${tasks(of("open").length)} · decided at its close`, rows: of("open"), empty: "Nothing open." } : null,
    of("carried").length || !running ? { name: `Carrying over${prev ? ` from Sprint ${prev}` : ""}`, note: `${tasks(of("carried").length)} · decided at close`, rows: of("carried"), empty: "Nothing carried over." } : null,
    { name: running ? `Came in since Sprint ${running.number} started` : "Came in from Incidents, Triage and PR review", note: tasks(of("came").length), rows: of("came"), empty: "Nothing urgent came in." },
    { name: "Backlog", note: `${tasks(of("backlog").length)} · by priority`, rows: of("backlog"), empty: "The backlog is empty." },
  ];
  return list.filter((g): g is NonNullable<typeof g> => !!g);
}

function QueueRow({ r, w, measure, scale, here, busy, onPick, onToggle, onEstimate }: {
  r: Row; w: World; measure: Measure; scale: number[]; here: boolean; busy: string; onPick: () => void; onToggle: () => void; onEstimate: (p: number | null) => void;
}) {
  const t = r.task;
  const who = whoOf(t);
  const src = sourceText(w, t);
  const est = w.est.get(t.id);
  const from = [src, who.kind === "none" ? "" : firstName(who.name), measure === "points" && est == null ? "not estimated" : ""].filter(Boolean).join(" · ") || "planned";
  const flag = r.nth >= 2 ? { text: `${ordinal(r.nth)} sprint`, tone: r.nth >= 3 ? "warning" : "plain" } as const
    : r.group === "came" || r.group === "backlog" ? { text: t.priority === "none" ? "no priority" : t.priority, tone: t.priority === "urgent" ? "danger" : t.priority === "high" ? "warning" : "plain" } as const
      : null;
  return (
    <div className={cx("sp-q", here && "is-cursor", r.inSprint && "is-in")} onMouseDown={onPick}>
      <span className="sp-mono c-faint">#{t.number}</span>
      <button type="button" className="sp-row__main" onClick={() => openTask(t)} title="Open in Tasks">
        <span className="c-ellipsis">{t.title}</span>
        <span className="c-ellipsis c-faint sp-row__sub">{from}</span>
      </button>
      <span>{flag ? <Pill tone={flag.tone} dot={false}>{flag.text}</Pill> : null}</span>
      {measure === "points" ? (
        <span className="sp-est" role="group" aria-label={`Estimate for #${t.number}`}>
          {scale.map((p) => (
            <button key={p} type="button" aria-pressed={est === p} className={cx(est === p && "is-on")} disabled={busy === `e${t.id}`}
              onClick={() => onEstimate(est === p ? null : p)}>{num(p)}</button>
          ))}
        </span>
      ) : <span />}
      <span>
        {r.locked ? <span className="c-faint sp-small">{r.locked}</span> : (
          <Button size="sm" busy={busy === t.id} aria-pressed={r.inSprint} onClick={onToggle}>{r.inSprint ? "Added" : "Add"}</Button>
        )}
      </span>
    </div>
  );
}

function Meter({ w, sprint, cap, measure, onMeasure }: { w: World; sprint: Sprint; cap: Capacity; measure: Measure; onMeasure?: (m: Measure) => void }) {
  const u = unitWord(measure);
  const total = cap.total;
  const people = cap.people.filter((p) => p.planned > 0 || p.cap != null);
  const scale = Math.max(total || 0, cap.planned, 1);
  const away = cap.people.filter((p) => p.away.length && p.usual != null).map((p) => `${firstName(p.name)}'s ${num(p.days_off)} ${p.days_off === 1 ? "day" : "days"}`);
  const shades = ["sp-shade-1", "sp-shade-2", "sp-shade-3", "sp-shade-4", "sp-shade-5"];
  return (
    <section className="sp-meter">
      <div className="sp-meter__head">
        <span className="sp-meter__n">{total == null ? `${num(cap.planned)} ${u}` : `${num(cap.planned)} of ${num(total)} ${u}`}</span>
        <span className="c-muted">{total == null ? "planned for people · no capacity yet" : cap.planned > total ? `planned · ${num(cap.planned - total)} ${u} over` : `planned · ${num(total - cap.planned)} ${u} free`}</span>
        <span className="c-grow" />
        {onMeasure ? <Segmented label="Measure" items={[{ id: "points", label: "Points" }, { id: "tasks", label: "Tasks" }]} value={measure} onChange={(m) => onMeasure(m as Measure)} /> : null}
      </div>
      {total != null ? (
        <div className="sp-mbar" role="img" aria-label={`${people.map((p) => `${firstName(p.name)} ${num(p.planned)}`).join(", ")} of ${num(total)} ${u}`}>
          {people.map((p, k) => <i key={p.key} className={shades[k % shades.length]} style={{ width: `${(p.planned / scale) * 100}%` }} />)}
        </div>
      ) : null}
      <div className="sp-ml">
        {people.map((p, k) => <span key={p.key}><i className={cx("sp-dot", shades[k % shades.length])} />{firstName(p.name)} {num(p.planned)}</span>)}
        <span className="c-faint">
          {total == null ? "No capacity yet: nobody has a closed sprint behind them. After the first close, each person's capacity is what they finished."
            : `${num(total)} = each person's usual from their last 3 sprints${away.length ? `, less ${away.join(" and ")} off` : ""}. ${w.measure === "points" && measure === "points" ? "" : ""}`}
        </span>
      </div>
    </section>
  );
}

function Lanes({ w, sprint, cap, measure }: { w: World; sprint: Sprint; cap: Capacity; measure: Measure }) {
  const u = unitWord(measure);
  const items = present(w.itemsBy.get(sprint.id) || []);
  const lastAgents = w.closed[w.closed.length - 1]?.stats?.agents || {};
  const lanes: { key: string; who: ReturnType<typeof whoOf>; sub: string; value: string; fill: number; rows: typeof items }[] = [];
  for (const p of cap.people) {
    const rows = items.filter((i) => whoOf(w.tasks.get(i.task_id)).key === p.key);
    const sub = `${p.usual == null ? "no capacity yet" : `usual ${num(p.usual)}`} · ${p.away.length ? `out ${awayText(p.away.map((a) => a.day), true)}` : `here all ${p.days} days`}`;
    lanes.push({ key: p.key, who: { kind: "person", key: p.key, name: p.name }, sub, value: p.cap == null ? `${num(p.planned)}` : `${num(p.planned)} / ${num(p.cap)}`,
      fill: p.cap ? Math.min(100, (p.planned / p.cap) * 100) : 0, rows });
  }
  for (const a of cap.agents.filter((x) => x.tasks || lastAgents[x.agent])) {
    const rows = items.filter((i) => whoOf(w.tasks.get(i.task_id)).agent === a.agent);
    const last = lastAgents[a.agent];
    lanes.push({ key: a.agent, who: { kind: "agent", key: `agent:${a.agent}`, name: "The Lemma's assistant", agent: a.agent },
      sub: `counted in tasks${last ? ` · finished ${last.done} of ${last.tasks} last sprint` : ""}`, value: `${a.tasks} ${a.tasks === 1 ? "task" : "tasks"}`,
      fill: 0, rows });
  }
  const nobody = items.filter((i) => whoOf(w.tasks.get(i.task_id)).kind === "none");
  if (nobody.length) lanes.push({ key: "none", who: { kind: "none", key: "none", name: "Nobody yet" }, sub: "press M on a task to say who", value: `${num(cap.nobody)} ${u}`, fill: 0, rows: nobody });
  return (
    <section className="sp-lanes">
      <div className="sp-sechead"><h2 className="sp-sec">Sprint {sprint.number}, by person</h2><span className="c-grow" /><span className="c-faint sp-hint">planned / this sprint</span></div>
      {lanes.map((l) => (
        <div key={l.key} className="sp-lane">
          <div className="sp-lane__head">
            <WhoMark who={l.who} />
            <div className="sp-lane__who"><span className="c-ellipsis">{l.who.kind === "agent" ? "The Lemma's assistant" : l.who.kind === "none" ? "Nobody yet" : firstName(l.who.name)}</span><span className="c-faint c-ellipsis sp-row__sub">{l.sub}</span></div>
            <span className="sp-bar"><i style={{ width: `${l.fill}%` }} /></span>
            <span className="c-faint sp-cap__v">{l.value}</span>
          </div>
          {l.rows.map((i) => {
            const t = w.tasks.get(i.task_id);
            const nth = Number(i.nth || 1);
            const src = t?.source && !["tasks", "chat"].includes(t.source) ? SOURCE_NAMES[t.source] : null;
            return (
              <button key={i.id} type="button" className="sp-li" onClick={() => openTask(t)}>
                <span className="sp-mono c-faint">#{t?.number}</span>
                <span className="c-ellipsis">{t?.title}</span>
                <span className="c-faint">{measure === "tasks" ? "" : w.est.has(i.task_id) ? num(w.est.get(i.task_id)) : "–"}</span>
                {nth >= 2 ? <Pill tone={nth >= 3 ? "warning" : "plain"} dot={false}>{ordinal(nth)} sprint</Pill> : src ? <Pill dot={false}>{src}</Pill> : l.who.kind === "agent" ? <Pill dot={false}>agent</Pill> : <span />}
              </button>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function AssignSheet({ task, onClose, options }: { task: Task | null; onClose: () => void; options: { key: string; user_id: string | null; name: string }[] }) {
  const toast = useToast();
  const go = async (to: Parameters<typeof assign>[1]) => {
    if (!task) return;
    try {
      await assign(task, to);
      onClose();
    } catch (e) {
      toast(`Couldn't assign: ${e instanceof Error ? e.message : e}`);
    }
  };
  return (
    <Sheet open={!!task} onClose={onClose} title={task ? `Who does #${task.number}?` : ""}>
      <div className="sp-pick">
        {options.map((o) => (
          <button key={o.key} type="button" className="sp-pick__row" onClick={() => void go({ kind: "person", user_id: o.user_id, name: o.name })}>
            <WhoMark who={{ kind: "person", key: o.key, name: o.name }} />{o.name}
          </button>
        ))}
        <button type="button" className="sp-pick__row" onClick={() => void go({ kind: "agent", agent: "pod_default" })}>
          <WhoMark who={{ kind: "agent", key: "agent:pod_default", name: "The Lemma's assistant", agent: "pod_default" }} />The Lemma's assistant
        </button>
        <button type="button" className="sp-pick__row" onClick={() => void go({ kind: "none" })}>
          <WhoMark who={{ kind: "none", key: "none", name: "Nobody yet" }} />Nobody yet
        </button>
      </div>
    </Sheet>
  );
}
