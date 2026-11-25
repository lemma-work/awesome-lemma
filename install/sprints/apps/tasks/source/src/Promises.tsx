// Promises you made (Mail and Meetings find them), and what Tasks made of each:
// work to do (a task, or a suggestion waiting for you) or just a reply. Moving
// one from one side to the other is a correction, and the next promises are
// asked with it as an example.

import { useMemo, useState } from "react";
import { ArrowRight, Check, Handshake, ListPlus, MessageSquareReply, Sparkles, X } from "lucide-react";
import { Button, Empty, Evidence, Pill, Segmented, ago, plural, useToast } from "@lemma-plugins/kit";
import { dismissPromise, promiseToTask, useTasks, useWorld } from "./data";
import { to } from "./route";
import type { PromiseRow } from "./types";

type Tab = "suggested" | "made" | "replies";

export function PromisesPage() {
  const { promises, settings, byId } = useTasks();
  const { me } = useWorld();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("suggested");
  const open = promises.filter((p) => p.state === "open" || p.d_task_id);
  const groups = useMemo(() => ({
    suggested: open.filter((p) => p.d_state === "open"),
    made: promises.filter((p) => (p.d_state === "made" || p.d_state === "accepted") && p.d_task_id),
    replies: open.filter((p) => p.d_state === "quiet" || p.d_state === "dismissed"),
  }), [open, promises]);
  const list = groups[tab];
  const mode = settings?.promises || "never";

  const make = (p: PromiseRow) =>
    void promiseToTask(p, me, settings?.timezone).then((t) => toast("It's a task now, with your words on it.", { action: { label: "Open", run: () => to.task(t.id) } }))
      .catch((e) => toast(`Couldn't make it a task: ${e.message}`));
  const dismiss = (p: PromiseRow) =>
    void dismissPromise(p).then(() => toast("Noted: just a reply. Tasks learns from it.")).catch((e) => toast(`Couldn't: ${e.message}`));

  return (
    <>
      <header className="tk-head">
        <span className="c-header__icon" aria-hidden="true"><Handshake size={15} /></span>
        <h1>From promises</h1>
        <span className="c-header__count">{groups.suggested.length}</span>
        <span className="c-grow" />
        <Segmented label="Show" value={tab} onChange={setTab} items={[
          { id: "suggested", label: "To decide", count: groups.suggested.length },
          { id: "made", label: "Tasks", count: groups.made.length },
          { id: "replies", label: "Just replies", count: groups.replies.length },
        ]} />
      </header>
      <div className="c-body tk-promises">
        <p className="tk-lead">
          Promises you made in mail and meetings. For each one Tasks asks: <b>work to do, or just a reply?</b>{" "}
          {mode === "auto" ? "Work becomes a task by itself." : mode === "ask" ? "Work waits here for you." : "Turned off in Settings."}
        </p>
        {!list.length ? (
          <Empty icon={Handshake} title={tab === "suggested" ? "Nothing to decide" : tab === "made" ? "No promise has become a task yet" : "No promise was just a reply"}>
            {promises.length ? "New promises show up here as Mail and Meetings find them." : "When Mail or Meetings finds a promise you made, it shows up here."}
          </Empty>
        ) : (
          <div className="c-card c-queue">
            {list.map((p) => {
              const task = p.d_task_id ? byId.get(p.d_task_id) : undefined;
              const sure = p.d_confidence != null ? `${Math.round(p.d_confidence * 100)}% sure` : null;
              return (
                <article key={p.id} className="c-item tk-promise">
                  <span className="tk-promise__icon" aria-hidden="true"><Handshake size={15} /></span>
                  <div className="c-grow">
                    <div className="c-item__who">
                      <b>To {p.person_name || p.person_handle || "someone"}</b>
                      <span className="c-faint">{p.source === "meeting" ? "in a meeting" : p.subject ? `“${p.subject}”` : p.source} · {ago(p.created_at)}</span>
                      <span className="c-item__meta">
                        {p.d_answer === "work" ? <Pill tone="ai" icon={Sparkles}>Work to do{sure ? `, ${sure}` : ""}</Pill> : null}
                        {p.d_answer === "reply" ? <Pill dot={false} icon={MessageSquareReply}>Just a reply{sure ? `, ${sure}` : ""}</Pill> : null}
                        {p.d_answer === "unsure" ? <Pill tone="warning">Not sure{sure ? `, ${sure}` : ""}</Pill> : null}
                      </span>
                    </div>
                    <p className="c-item__what">{p.text}</p>
                    {p.quote ? <Evidence quote={p.quote} /> : null}
                    <div className="c-item__acts">
                      {tab === "suggested" ? (
                        <>
                          <Button size="sm" variant="primary" icon={ListPlus} onClick={() => make(p)}>Make it a task</Button>
                          <Button size="sm" icon={X} onClick={() => dismiss(p)}>Just a reply</Button>
                        </>
                      ) : tab === "made" ? (
                        task ? <Button size="sm" icon={ArrowRight} onClick={() => to.task(task.id)}>Open the task</Button> : <span className="c-faint">The task was deleted.</span>
                      ) : (
                        <Button size="sm" icon={Check} onClick={() => make(p)}>It's work: make it a task</Button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {tab === "suggested" && groups.suggested.length > 1 ? <p className="c-faint tk-foot">{plural(groups.suggested.length, "promise")} to decide.</p> : null}
      </div>
    </>
  );
}
