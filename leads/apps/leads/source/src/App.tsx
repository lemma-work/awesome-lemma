// Set-up until this person has finished theirs, then their leads.
//
// Lead research looks up the people People map counts as someone you deal
// with, so until People map is set up for this person it shows that, with the
// button to it. Then it makes their settings and starts their own
// `leads-setup` run (so does anyone who joins later), and is the screen for
// its forms. Once set up, it makes their daily pass, once.

import { useEffect, useRef } from "react";
import { Notice, Skeleton, client, create, update, whoAmI } from "@lemma-plugins/kit";
import { LeadsProvider, useLeads } from "./data";
import { Bases, Setup } from "./Setup";
import { Shell } from "./Shell";

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return ({ "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv" } as Record<string, string>)[zone] || zone;
}

/** The person's own daily pass at 07:07 their time, made as them, once. */
export async function turnOn(settingsId: string, schedules: Record<string, string> | null): Promise<void> {
  const me = await whoAmI();
  const name = `leads-daily-${(me?.id || "me").slice(0, 8)}`;
  if (schedules?.[name]) return;
  const row = (await client.schedules.create({
    name, schedule_type: "TIME", workflow_name: "leads-daily", config: { cron: "7 7 * * *", timezone: browserZone() },
  } as never)) as unknown as { id: string };
  await update("leads_settings", settingsId, { schedules: { ...(schedules || {}), [name]: row.id } });
}

export async function startSetup(settingsId: string | null): Promise<void> {
  const me = await whoAmI();
  const run = (await client.workflows.runs.create("leads-setup")) as unknown as { id?: string };
  if (settingsId) await update("leads_settings", settingsId, { setup_step: "fit", setup_run_id: run?.id || null });
  else await create("leads_settings", { display_name: me?.name || null, timezone: browserZone(), setup_step: "fit", setup_run_id: run?.id || null });
}

function Gate() {
  const { loaded, settings, peopleSetup, reload, errors } = useLeads();
  const started = useRef(false);
  const ready = peopleSetup === "done";

  useEffect(() => {
    if (!loaded || settings || started.current || errors.settings || !ready) return;
    started.current = true;
    void startSetup(null).then(() => reload("settings")).catch(() => {
      started.current = false;
    });
  }, [loaded, settings, reload, errors.settings, ready]);

  const turning = useRef(false);
  useEffect(() => {
    if (!settings || settings.setup_step !== "done" || turning.current) return;
    if (Object.keys(settings.schedules || {}).some((k) => k.startsWith("leads-daily-"))) return;
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
  if (errors.settings && !settings) return <Notice>Couldn't open Leads: {errors.settings}</Notice>;
  if (!settings) return ready ? <div className="c-app"><div className="c-body"><Skeleton rows={8} kind="list" /></div></div> : <Bases />;
  if (settings.setup_step !== "done") return <Setup />;
  return <Shell />;
}

export default function App() {
  return (
    <LeadsProvider>
      <Gate />
    </LeadsProvider>
  );
}
