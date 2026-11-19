// Tasks: everything you have to do, done by you or handed to an agent.
//
// Until the person has answered set-up (just you or your team, promises,
// which agents), it shows set-up: the `tasks-setup` workflow's forms. Then the
// list, the board, projects and each task's page.

import { useEffect, useRef } from "react";
import { ListChecks } from "lucide-react";
import { DataProvider, Header, Notice, Skeleton, client, create, useToast } from "@lemma-plugins/kit";
import { LOADERS, WorldProvider, browserZone, useTasks, useWorld } from "./data";
import { Setup } from "./Setup";
import { Shell } from "./Shell";

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
  const { loaded, errors, settings, reload } = useTasks();
  const { me } = useWorld();
  const toast = useToast();
  const starting = useRef(false);

  // First open: a settings row and the person's own set-up run.
  useEffect(() => {
    if (!loaded || settings || starting.current || errors.settings) return;
    starting.current = true;
    void (async () => {
      try {
        const run = (await client.workflows.runs.create("tasks-setup")) as unknown as { id?: string };
        await create("tasks_settings", { display_name: me?.name || null, timezone: browserZone(), setup_run_id: run?.id || null, setup_step: "start" });
        await reload("settings");
      } catch (e) {
        toast(`Couldn't start Tasks' set-up: ${e instanceof Error ? e.message : e}`);
        starting.current = false;
      }
    })();
  }, [loaded, settings, errors.settings, me, reload, toast]);

  if (!loaded || (!settings && !errors.settings)) {
    return (
      <div className="c-app">
        <Header icon={ListChecks} title="Tasks" />
        <main className="c-body"><Skeleton kind="list" rows={8} /></main>
      </div>
    );
  }
  if (errors.settings) return <Notice>Couldn't read Tasks: {errors.settings}</Notice>;
  if (!settings || settings.setup_step !== "done") return <Setup />;
  return <Shell />;
}
