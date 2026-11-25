// Coding agent: the team's coding agents in one place.
//
// Until the Lemma has a coding set-up, the first-run screen (/setup). Then
// one bar on top (Work / Ask about the code, New task, set-up) over the board
// (/, with a task's record beside it at /t/<task>), New task (/new) and Ask
// (/ask). Once per open, the person's own schedules are checked and the
// missing ones made, and their items in Today are written again.

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Plus, Settings2, SquareTerminal } from "lucide-react";
import { Banner, Button, DEMO, DataProvider, Notice, Segmented, runFunction, useToast } from "@lemma-plugins/kit";
import { LOADERS, WorldProvider, refreshNeedsYou, useCoding, useWorld } from "./data";
import { Board } from "./Board";
import { NewTask } from "./NewTask";
import { Ask } from "./Ask";
import { Setup } from "./Setup";
import { to, useRoute } from "./route";
import { ensureSchedules } from "./wire";

export default function App() {
  return (
    <DataProvider loaders={LOADERS}>
      <WorldProvider>
        <Gate />
      </WorldProvider>
    </DataProvider>
  );
}

function Gate() {
  const { loaded, errors, settings } = useCoding();
  const route = useRoute();
  if (!loaded) {
    return (
      <div className="c-app">
        <div className="cd-top"><span className="cd-top__name"><SquareTerminal aria-hidden="true" />Coding agent</span></div>
        <main className="cd-skel-board" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="cd-col">
              <div className="c-skel" style={{ height: 12, width: 110, margin: "6px 4px 12px" }} />
              {[0, 1, 2].slice(0, 3 - (i % 2)).map((k) => <div key={k} className="c-skel" style={{ height: 92, borderRadius: 9, marginBottom: 8 }} />)}
            </div>
          ))}
        </main>
      </div>
    );
  }
  if (errors.settings || errors.sessions) return <Notice>Couldn't read the Coding agent's tables: {errors.settings || errors.sessions}</Notice>;
  if (!settings?.setup_done_at || route.page === "setup") return <Setup />;
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const data = useCoding();
  const { me } = useWorld();
  const toast = useToast();
  const [clearing, setClearing] = useState(false);
  const once = useRef(false);

  useEffect(() => {
    if (once.current || !me) return;
    once.current = true;
    refreshNeedsYou();
    void ensureSchedules(me.id).then(({ problems }) => {
      if (problems.length) toast(`Couldn't make ${problems.join(", ")}. Pull requests update every 15 minutes or when you open them.`, { ms: 8000 });
    });
  }, [me, toast]);

  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("coding_sample_data", { mode: "clear" });
      toast(out?.message || "Cleared the sample.");
      await data.reload();
      to.board();
    } catch (e) {
      toast(`Couldn't clear the sample: ${e instanceof Error ? e.message : e}`);
    } finally {
      setClearing(false);
    }
  };

  const tab = route.page === "ask" ? "ask" : "work";
  return (
    <div className="c-app cd-app">
      <header className="cd-top">
        <button type="button" className="cd-top__name" onClick={() => to.board()}><SquareTerminal aria-hidden="true" />Coding agent</button>
        <div className="cd-top__seg">
          <Segmented label="Coding agent" value={route.page === "board" || route.page === "ask" ? tab : ("none" as "work")}
            onChange={(v) => (v === "ask" ? to.ask() : to.board())}
            items={[{ id: "work", label: "Work" }, { id: "ask", label: "Ask about the code" }]} />
        </div>
        <span className="cd-top__fill" />
        <div className="cd-top__acts">
          {route.page !== "new" ? <Button variant="primary" icon={Plus} onClick={() => to.newTask()}><span className="cd-hide-xs">New task</span><span className="cd-show-xs">New</span></Button> : null}
          <Button variant="ghost" icon={Settings2} label="Set-up" onClick={() => to.setup()} />
        </div>
      </header>
      {data.sample && !DEMO ? (
        <div className="cd-strip">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at <b>a sample board</b>: made-up tasks, pull requests and questions. No agent ran and nothing reached GitHub.
          </Banner>
        </div>
      ) : null}
      {route.page === "new" ? <NewTask from={route} />
        : route.page === "ask" ? <Ask id={route.question} />
          : <Board taskId={route.page === "board" ? route.task : null} tab={route.page === "board" ? route.tab : "activity"} />}
    </div>
  );
}
