// A: the running sprint. The numbers row, the scope graph with each step it
// took and why, the tasks, capacity by person as frozen at the start, and
// what may slip (the Lemma's, worked out from the numbers). Urgent work that
// came in mid-sprint waits here for the lead: pull it in, or not now.

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button, Empty, Pill, useToast } from "@lemma-plugins/kit";
import { addTasks, dismiss, removeTasks, useSprints, useWho } from "./data";
import { AiMark, openTask } from "./marks";
import { capacityAtStart, joined, longDay, monthDay, range, workingDays, type World } from "./model";
import { to } from "./route";
import { CapacityPanel, ScopeCard, Stats, TaskList } from "./SprintView";
import { Top } from "./Top";
import type { Measure, Sprint, Suggestion } from "./types";

export function Run() {
  const { w, settings } = useSprints();
  const { me } = useWho();
  const [measure, setMeasure] = useState<Measure>(w.measure);
  const sprint = w.running;
  if (!sprint) {
    const next = w.planned;
    return (
      <>
        <Top title="Sprints" here="none" />
        <main className="c-body">
          <Empty icon={CalendarClock} title="No sprint is running"
            action={next ? <Button variant="primary" onClick={() => to.plan()}>Plan Sprint {next.number}</Button> : undefined}>
            {next ? `Sprint ${next.number} starts ${longDay(next.starts_on)} ${monthDay(next.starts_on)}. Plan it now; it starts when the lead presses Start, or on that day.`
              : "Every sprint is closed."}
          </Empty>
        </main>
      </>
    );
  }
  const days = workingDays(sprint.starts_on, sprint.ends_on);
  const dayNo = days.filter((d) => d <= w.today).length;
  const last = w.today >= sprint.ends_on;
  const lead = !!me && settings?.lead_user_id === me.id;
  const cap = capacityAtStart(w, sprint, measure);
  return (
    <>
      <Top title={`Sprint ${sprint.number}`} here="run"
        pill={<Pill tone={last ? "warning" : "info"}>{last ? (w.today > sprint.ends_on ? "Ended" : "Last day") : "Running"}</Pill>}
        dates={`${range(sprint.starts_on, sprint.ends_on)} · ${dayNo > days.length ? "ended" : `day ${Math.max(1, dayNo)} of ${days.length}`}`}>
        <Button variant={last ? "primary" : "default"} disabled={!lead} title={lead ? undefined : `${settings?.lead_name || "The lead"} closes sprints`}
          onClick={() => to.close()}>Close sprint</Button>
      </Top>
      <div className="sp-body">
        <div className="sp-main">
          <Stats w={w} sprint={sprint} measure={measure} capacityTotal={measure === w.measure ? sprint.capacity_total : cap.total} />
          <ScopeCard w={w} sprint={sprint} measure={measure} onMeasure={w.measure === "points" ? setMeasure : undefined} />
          <TaskList w={w} sprint={sprint} measure={measure} cap={cap} />
        </div>
        <aside className="sp-side">
          <CapacityPanel w={w} sprint={sprint} cap={cap} measure={measure}
            note={`Capacity as it was at the start: each person's usual (what they finished in their last 3 sprints) less days off. The Lemma's assistant is counted in tasks, never in capacity.`} />
          <Slip w={w} sprint={sprint} lead={lead} />
        </aside>
      </div>
    </>
  );
}

function Slip({ w, sprint, lead }: { w: World; sprint: Sprint; lead: boolean }) {
  const { me } = useWho();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const open = w.suggestions.filter((s) => s.sprint_id === sprint.id && s.state === "open" && s.kind !== "close");
  const pulls = open.filter((s) => s.kind === "pull_in");
  const risks = open.filter((s) => s.kind === "risk" || s.kind === "move_out")
    .sort((a, b) => (a.kind === "move_out" ? 1 : 0) - (b.kind === "move_out" ? 1 : 0));
  const next = sprint.number + 1;
  const act = async (key: string, work: () => Promise<{ message?: string } | void>) => {
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
  const tag = (id: string) => `#${w.tasks.get(id)?.number ?? "?"}`;
  return (
    <>
      {pulls.length ? (
        <section className="sp-slip">
          <h2 className="sp-sec"><AiMark>Came in mid-sprint</AiMark></h2>
          {pulls.map((s) => {
            const taskId = s.task_ids[0];
            return (
              <div key={s.id} className="sp-risk">
                <div className="c-row"><Pill tone={(s.detail as { priority?: string })?.priority === "urgent" ? "danger" : "warning"}>{(s.detail as { priority?: string })?.priority || "urgent"}</Pill><span className="sp-mono c-faint">{tag(taskId)}</span></div>
                <p className="c-muted">{s.text}</p>
                <div className="sp-risk__acts">
                  <Button size="sm" busy={busy === s.id} disabled={!lead} title={lead ? undefined : "The lead decides what comes in"}
                    onClick={() => void act(s.id, () => addTasks([taskId], sprint.number))}>Pull into Sprint {sprint.number}</Button>
                  <Button size="sm" onClick={() => openTask(w.tasks.get(taskId))}>Open {tag(taskId)}</Button>
                  <Button size="sm" variant="ghost" onClick={() => void act(`x${s.id}`, () => dismiss(s, me))}>Not now</Button>
                </div>
              </div>
            );
          })}
        </section>
      ) : null}
      <section className="sp-slip">
        <h2 className="sp-sec"><AiMark>What may slip</AiMark></h2>
        {risks.length ? risks.map((s) => <Risk key={s.id} s={s} w={w} next={next} busy={busy} act={act} tag={tag} />)
          : <p className="c-faint">Nothing looks likely to slip: nothing in a 3rd sprint, nobody over their capacity, nothing waiting since before today, and the pace covers the scope.</p>}
      </section>
    </>
  );

  function Risk({ s, next, busy, act, tag }: { s: Suggestion; w: World; next: number; busy: string; act: (k: string, f: () => Promise<{ message?: string } | void>) => Promise<void>; tag: (id: string) => string }) {
    const label = s.kind === "move_out" ? "Suggestion" : s.choice || "Risk";
    const tone = s.kind === "move_out" ? "info" : label === "Waiting" ? "plain" : "warning";
    const name = (s.detail as { name?: string })?.name;
    return (
      <div className="sp-risk">
        <div className="c-row">
          <Pill tone={tone}>{label}</Pill>
          {s.task_ids.length === 1 ? <span className="sp-mono c-faint">{tag(s.task_ids[0])}</span> : name ? <span className="c-faint">{name.split(" ")[0]}</span> : null}
        </div>
        <p className="c-muted">{s.text}</p>
        {s.kind === "move_out" ? (
          <div className="sp-risk__acts">
            <Button size="sm" busy={busy === s.id} disabled={!lead}
              onClick={() => void act(s.id, () => removeTasks(s.task_ids, sprint.number, "next"))}>
              Move {s.task_ids.length === 2 ? "both" : s.task_ids.length > 2 ? "them" : tag(s.task_ids[0])} to Sprint {next}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void act(`x${s.id}`, () => dismiss(s, me))}>Not now</Button>
          </div>
        ) : s.task_ids.length === 1 ? (
          <div className="sp-risk__acts"><Button size="sm" onClick={() => openTask(w.tasks.get(s.task_ids[0]))}>Open {tag(s.task_ids[0])}</Button></div>
        ) : null}
        {s.kind === "move_out" && s.task_ids.length > 2 ? <p className="c-faint sp-small">{joined(s.task_ids.map(tag))}</p> : null}
      </div>
    );
  }
}
