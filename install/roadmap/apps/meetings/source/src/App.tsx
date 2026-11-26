// Set-up until this person has finished theirs, then their week.
//
// A person with no Meetings settings gets their own set-up run the first
// time they open the app (so does anyone who joins the Lemma later): the
// `meetings-setup` workflow does the work, and this app is the screen for
// its forms.

import { useEffect, useRef } from "react";
import { Notice, Skeleton, create, startWorkflow, whoAmI } from "@lemma-plugins/kit";
import { MeetingsProvider, useMeetings } from "./data";
import { Setup } from "./Setup";
import { Shell } from "./Shell";
import { browserZone, setZone } from "./time";

function Gate() {
  const { loaded, settings, reload, errors } = useMeetings();
  const started = useRef(false);

  useEffect(() => {
    if (!loaded || settings || started.current || errors.settings) return;
    started.current = true;
    void (async () => {
      const me = await whoAmI();
      const runId = await startWorkflow("meetings-setup");
      await create("meetings_settings", {
        display_name: me?.name || null, timezone: browserZone(), setup_step: "connect", setup_run_id: runId || null,
      });
      await reload("settings");
    })().catch(() => {
      started.current = false;
    });
  }, [loaded, settings, reload, errors.settings]);

  useEffect(() => setZone(settings?.timezone || browserZone()), [settings?.timezone]);

  if (!loaded || (!settings && !errors.settings)) {
    return (
      <div className="c-app">
        <div className="c-body">
          <Skeleton rows={8} kind="list" />
        </div>
      </div>
    );
  }
  if (errors.settings && !settings) return <Notice>Couldn't open Meetings: {errors.settings}</Notice>;
  if (!settings || settings.setup_step !== "done") return <Setup />;
  return <Shell />;
}

export default function App() {
  return (
    <MeetingsProvider>
      <Gate />
    </MeetingsProvider>
  );
}
