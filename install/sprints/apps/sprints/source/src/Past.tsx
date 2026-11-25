// Past sprints: the list (/s), and one sprint as it closed (/s/<n>), read
// only: its numbers, its scope graph, its tasks, capacity as it was at the
// start, and its summary (also in /sprints/<n>.md).

import { useState } from "react";
import { History } from "lucide-react";
import { Empty, Pill } from "@lemma-plugins/kit";
import { useSprints } from "./data";
import { capacityAtStart, num, range } from "./model";
import { SummaryView } from "./Close";
import { to } from "./route";
import { CapacityPanel, ScopeCard, Stats, TaskList, unitWord } from "./SprintView";
import { Top } from "./Top";
import type { Measure } from "./types";

export function PastList() {
  const { w } = useSprints();
  const closed = [...w.closed].reverse();
  const u = unitWord(w.measure);
  const size = (b?: { points: number; tasks: number }) => (b ? (w.measure === "points" ? num(b.points) : String(b.tasks)) : "–");
  return (
    <>
      <Top title="Past sprints" here="past" />
      <main className="c-body">
        {closed.length ? (
          <div className="sp-box">
            <div className="sp-p sp-p--head"><span>Sprint</span><span>Dates</span><span>In at start</span><span>Added</span><span>Done</span><span>Not done</span><span>Carried</span></div>
            {closed.map((s) => (
              <button key={s.id} type="button" className="sp-p" onClick={() => to.sprint(s.number)}>
                <span>Sprint {s.number}</span>
                <span className="c-faint">{range(s.starts_on, s.ends_on)}</span>
                <span>{size(s.stats?.planned)} {u}</span>
                <span>+{size(s.stats?.added)}</span>
                <span>{size(s.stats?.done)}</span>
                <span>{size(s.stats?.not_done)}</span>
                <span>{(s.stats?.carried?.tasks || 0) + (s.stats?.split?.tasks || 0)} tasks</span>
              </button>
            ))}
          </div>
        ) : <Empty icon={History} title="No sprint has closed yet">A sprint shows here once its lead closes it, with its numbers and summary.</Empty>}
      </main>
    </>
  );
}

export function PastSprint({ number }: { number: number }) {
  const { w } = useSprints();
  const [measure, setMeasure] = useState<Measure>(w.measure);
  const sprint = w.sprintByNumber.get(number);
  if (!sprint) {
    return (
      <>
        <Top title={`Sprint ${number}`} here="past" />
        <main className="c-body"><Empty icon={History} title={`There is no Sprint ${number}`}>Pick one from past sprints.</Empty></main>
      </>
    );
  }
  if (sprint.state !== "closed") {
    return (
      <>
        <Top title={`Sprint ${number}`} here="past" />
        <main className="c-body"><Empty icon={History} title={`Sprint ${number} hasn't closed`}>{sprint.state === "planned" ? "It is being planned." : "It is running."}</Empty></main>
      </>
    );
  }
  const cap = capacityAtStart(w, sprint, measure);
  return (
    <>
      <Top title={`Sprint ${sprint.number}`} here="past" pill={<Pill>Closed</Pill>} dates={range(sprint.starts_on, sprint.ends_on)} />
      <div className="sp-body">
        <div className="sp-main">
          <Stats w={w} sprint={sprint} measure={measure} capacityTotal={sprint.capacity_total} />
          <ScopeCard w={w} sprint={sprint} measure={measure} onMeasure={w.measure === "points" ? setMeasure : undefined} />
          <TaskList w={w} sprint={sprint} measure={measure} cap={cap} />
        </div>
        <aside className="sp-side">
          <section className="sp-doc">
            <div className="sp-doc__head"><span className="sp-doc__title">Summary</span><span className="c-grow" />{sprint.summary_path ? <span className="c-faint sp-small">{sprint.summary_path}</span> : null}</div>
            <div className="sp-doc__body">{sprint.summary ? <SummaryView text={sprint.summary} /> : <p className="c-faint">No summary was written.</p>}</div>
          </section>
          <CapacityPanel w={w} sprint={sprint} cap={cap} measure={measure} title="Capacity at the start" />
        </aside>
      </div>
    </>
  );
}
