// Walk a procedure here, one step at a time: the same steps the Lemma walks in
// a Teams chat. Done moves on, I'm stuck shows the step again and asks what's
// wrong, a question goes to the owner and the walk carries on.

import { useState } from "react";
import { ArrowLeft, Check, CircleHelp, Flag, Send, Square } from "lucide-react";
import { Button, DEMO, Empty, Kbd, Pill, Skeleton, useToast } from "@lemma-plugins/kit";
import { call, nowMs, refreshMine, useKnowhow } from "./data";
import { Page, SourceLine } from "./marks";
import { to } from "./route";

interface WalkOut { [key: string]: unknown; ok?: boolean; walk_id?: string; step?: number; steps_total?: number; step_title?: string; who?: string | null; body?: string | null; state?: string; message?: string }

export function Walk({ id }: { id: string }) {
  const d = useKnowhow();
  const toast = useToast();
  const a = d.articleBy.get(id);
  const now = nowMs(d.questions);
  const [w, setW] = useState<WalkOut | null>(null);
  const [busy, setBusy] = useState("");
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  if (!a) return <main className="c-body"><Empty title="No such procedure" action={<Button onClick={() => to.library()}>Open the Library</Button>} /></main>;
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const out = DEMO ? demoStep(a.steps.length, w, action) : await call<WalkOut>("knowhow_walk", { action, walk_id: w?.walk_id, article_id: a.id, source: "app", ...extra });
      if (out.ok === false) toast(out.message || "Couldn't do that.");
      else setW(out);
      if (action === "question") {
        toast(`Asked ${a.owner_name?.split(" ")[0] || "the owner"}. Their answer becomes a proposed change to this step.`);
        setAsking(false);
        setQuestion("");
      }
      refreshMine();
      void d.reload();
    } finally {
      setBusy("");
    }
  };
  const total = a.steps.length;
  return (
    <main className="c-body kh-walk">
      <button type="button" className="kh-back" onClick={() => to.page(a.id)}><ArrowLeft aria-hidden="true" />{a.title}</button>
      {!w ? (
        <section className="kh-walk__start">
          <h1>{a.title}</h1>
          <p className="c-muted">{total} steps, one at a time. Ask anything on the way: it goes to {a.owner_name || "the owner"}, and the walk carries on.</p>
          <SourceLine a={a} now={now} />
          <Button variant="primary" icon={Flag} busy={busy === "start"} onClick={() => void act("start")}>Start the walk</Button>
          <p className="c-faint kh-hint">In Teams, ask the Lemma “how do I {a.title.toLowerCase()}?” to walk it there.</p>
        </section>
      ) : w.state === "done" ? (
        <Empty icon={Check} title="Done" action={<Button onClick={() => to.page(a.id)}>Back to the procedure</Button>}>
          That's every step of {a.title}.
        </Empty>
      ) : w.state === "stopped" ? (
        <Empty title="Stopped" action={<Button onClick={() => setW(null)}>Start again</Button>}>Pick it up any time.</Empty>
      ) : (
        <section className="kh-walk__step" aria-live="polite">
          <div className="kh-walk__progress"><span className="num">Step {w.step} of {w.steps_total}</span>
            <span className="kh-meter" aria-hidden="true"><span style={{ width: `${Math.round(((w.step || 1) / (w.steps_total || 1)) * 100)}%` }} /></span>
            {w.state === "stuck" ? <Pill tone="warning">Stuck</Pill> : null}
          </div>
          <h2>{w.step_title}</h2>
          {w.who ? <Pill>{w.who}</Pill> : null}
          {w.body ? <Page text={w.body} /> : <Skeleton kind="list" rows={2} />}
          {w.state === "stuck" ? <p className="kh-warn">What's wrong? Ask it below: it goes to {a.owner_name || "the owner"}, and you carry on with this step.</p> : null}
          {asking || w.state === "stuck" ? (
            <div className="kh-walk__ask">
              <textarea className="c-textarea" placeholder="What if the box is gone?" value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Your question" />
              <Button icon={Send} busy={busy === "question"} disabled={!question.trim()} onClick={() => void act("question", { text: question })}>Ask</Button>
            </div>
          ) : null}
          <div className="kh-actions kh-walk__acts">
            <Button variant="primary" icon={Check} busy={busy === "done"} onClick={() => void act("done")}>Done</Button>
            <Button icon={CircleHelp} busy={busy === "stuck"} onClick={() => void act("stuck")}>I'm stuck</Button>
            <Button variant="ghost" icon={Square} busy={busy === "stop"} onClick={() => void act("stop")}>Stop</Button>
            {!asking && w.state !== "stuck" ? <Button variant="ghost" onClick={() => setAsking(true)}>Ask a question</Button> : null}
          </div>
          <p className="c-faint kh-hint">Teams shows these as a choice and a Submit button; typing “done” or a question works too.</p>
        </section>
      )}
    </main>
  );

  function demoStep(n: number, cur: WalkOut | null, action: string): WalkOut {
    const steps = a!.steps;
    const at = action === "start" ? 1 : action === "done" ? (cur?.step || 1) + 1 : cur?.step || 1;
    if (action === "stop") return { ...cur, state: "stopped" };
    if (at > n) return { ...cur, state: "done" };
    const s = steps[at - 1];
    return { walk_id: "demo", step: at, steps_total: n, step_title: s.title, who: s.who, body: s.body, state: action === "stuck" ? "stuck" : "walking" };
  }
}
