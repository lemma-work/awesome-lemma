// Decks: a deck from one sentence, in your brand, edited by asking.
//
// Until the person has answered set-up (the look, then a first deck), it
// shows set-up: the `decks-setup` workflow's forms. Then the decks.

import { useEffect, useRef } from "react";
import { Presentation } from "lucide-react";
import { DataProvider, Header, Notice, Skeleton, client, create, useToast } from "@lemma-plugins/kit";
import { LOADERS, WorldProvider, useDecks, useWorld } from "./data";
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
  const { loaded, errors, settings, reload } = useDecks();
  const { me } = useWorld();
  const toast = useToast();
  const starting = useRef(false);

  // First open: a settings row and the person's own set-up run.
  useEffect(() => {
    if (!loaded || settings || starting.current || errors.settings) return;
    starting.current = true;
    void (async () => {
      try {
        const run = (await client.workflows.runs.create("decks-setup")) as unknown as { id?: string };
        await create("decks_settings", { display_name: me?.name || null, setup_run_id: run?.id || null, setup_step: "start", look_source: "theme" });
        await reload("settings");
      } catch (e) {
        toast(`Couldn't start Decks' set-up: ${e instanceof Error ? e.message : e}`);
        starting.current = false;
      }
    })();
  }, [loaded, settings, errors.settings, me, reload, toast]);

  if (!loaded || (!settings && !errors.settings)) {
    return (
      <div className="c-app">
        <Header icon={Presentation} title="Decks" />
        <main className="c-body"><Skeleton kind="list" rows={6} /></main>
      </div>
    );
  }
  if (errors.settings) return <Notice>Couldn't read Decks: {errors.settings}</Notice>;
  if (!settings || settings.setup_step !== "done") return <Setup />;
  return <Shell />;
}
