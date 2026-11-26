// Set-up until this person has finished theirs, then their people.
//
// A person with no People map settings gets their own set-up run the first
// time they open the app once Mail or Meetings is set up for them (so does
// anyone who joins the Lemma later): the `people-setup` workflow does the work,
// and this app is the screen for its forms. Until then it shows where Mail's
// and Meetings' own set-ups are, with the button to each.

import { useEffect, useRef } from "react";
import { Notice, Skeleton, client, create, update, whoAmI } from "@lemma-plugins/kit";
import { PeopleProvider, usePeople } from "./data";
import { Bases, Setup } from "./Setup";
import { Shell } from "./Shell";

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return ({ "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv" } as Record<string, string>)[zone] || zone;
}

/** The person's own hourly refresh, made as them, once. */
export async function turnOn(settingsId: string, schedules: Record<string, string> | null): Promise<void> {
  const me = await whoAmI();
  const name = `people-refresh-${(me?.id || "me").slice(0, 8)}`;
  if (schedules?.[name]) return;
  const row = (await client.schedules.create({
    name, schedule_type: "TIME", workflow_name: "people-refresh", config: { cron: "17 * * * *", timezone: browserZone() },
  } as never)) as unknown as { id: string };
  await update("people_settings", settingsId, { schedules: { ...(schedules || {}), [name]: row.id } });
}

function Gate() {
  const { loaded, settings, bases, reload, errors } = usePeople();
  const started = useRef(false);
  const ready = bases.mail === "done" || bases.meetings === "done";

  useEffect(() => {
    if (!loaded || settings || started.current || errors.settings || !ready) return;
    started.current = true;
    void (async () => {
      const me = await whoAmI();
      const run = (await client.workflows.runs.create("people-setup")) as unknown as { id?: string };
      await create("people_settings", {
        display_name: me?.name || null, timezone: browserZone(), setup_step: "categories", setup_run_id: run?.id || null,
      });
      await reload("settings");
    })().catch(() => {
      started.current = false;
    });
  }, [loaded, settings, reload, errors.settings, ready]);

  // Once set up, the person's own hourly refresh.
  const turning = useRef(false);
  useEffect(() => {
    if (!settings || settings.setup_step !== "done" || turning.current) return;
    const name = Object.keys(settings.schedules || {}).find((k) => k.startsWith("people-refresh-"));
    if (name) return;
    turning.current = true;
    void turnOn(settings.id, settings.schedules).then(() => reload("settings")).catch(() => undefined);
  }, [settings, reload]);

  if (!loaded) {
    return (
      <div className="c-app">
        <div className="c-body"><Skeleton rows={8} /></div>
      </div>
    );
  }
  if (errors.settings && !settings) return <Notice>Couldn't open People: {errors.settings}</Notice>;
  if (!settings) return ready ? <div className="c-app"><div className="c-body"><Skeleton rows={8} kind="list" /></div></div> : <Bases />;
  if (settings.setup_step !== "done") return <Setup />;
  return <Shell />;
}

export default function App() {
  return (
    <PeopleProvider>
      <Gate />
    </PeopleProvider>
  );
}
