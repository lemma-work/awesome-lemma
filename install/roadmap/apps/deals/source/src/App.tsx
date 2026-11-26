// Set-up until this person has finished theirs, then the pipeline.
//
// Deal tracker reads what People map, Mail and Meetings read, so its set-up
// waits for People map's own. Then a person with no deals_member row gets their
// own `deals-setup` run the first time they open the app (so does anyone who
// joins later): the workflow does the work, and this app is the screen for
// its forms. Once set up, the app makes the person's daily `deals-refresh`
// schedule (what needs them, for Today) and, for whoever picked the review
// day, the team's weekly review schedule.

import { useEffect, useRef } from "react";
import { Notice, Skeleton, client, create, runFunction, update } from "@lemma-plugins/kit";
import { DealsProvider, browserZone, scheduleReview, useDeals } from "./data";
import { Base, Setup } from "./Setup";
import { Shell } from "./Shell";

function Gate() {
  const { loaded, member, settings, me, reload, errors, peopleReady } = useDeals();
  const started = useRef(false);

  useEffect(() => {
    if (!loaded || member || started.current || errors.member || peopleReady === false || !me) return;
    started.current = true;
    void (async () => {
      const run = (await client.workflows.runs.create("deals-setup")) as unknown as { id?: string };
      await create("deals_member", { display_name: me.display, timezone: browserZone(), setup_step: "start", setup_run_id: run?.id || null });
      await reload("member");
    })().catch(() => {
      started.current = false;
    });
  }, [loaded, member, reload, errors.member, peopleReady, me]);

  // Once set up: the person's own daily refresh, and the team's weekly review when they picked its day.
  const turning = useRef(false);
  useEffect(() => {
    if (!member || member.setup_step !== "done" || turning.current || !me) return;
    const needsRefresh = !member.refresh_schedule_id;
    const needsReview = !!settings && !settings.review_schedule_id && settings.set_up_by === me.id;
    if (!needsRefresh && !needsReview) return;
    turning.current = true;
    void (async () => {
      if (needsRefresh) {
        const row = (await (client.schedules as unknown as { create: (p: unknown) => Promise<{ id: string }> }).create({
          name: `deals-refresh-${me.id.slice(0, 8)}`, schedule_type: "TIME", workflow_name: "deals-refresh",
          config: { cron: "40 6 * * *", timezone: member.timezone || browserZone() },
        }));
        await update("deals_member", member.id, { refresh_schedule_id: row.id });
      }
      if (needsReview && settings) await scheduleReview(settings, me);
      await Promise.all([reload("member"), reload("settings")]);
    })().catch(() => undefined);
  }, [member, settings, me, reload]);

  // What needs the person, written again when the app opens after ten minutes.
  const counted = useRef(false);
  useEffect(() => {
    if (!member || member.setup_step !== "done" || counted.current) return;
    const last = member.needs_at ? new Date(member.needs_at).getTime() : 0;
    if (Date.now() - last < 10 * 60_000) return;
    counted.current = true;
    void runFunction("deals_needs_you", {}).catch(() => undefined);
  }, [member]);

  if (!loaded) return <div className="c-app"><div className="c-body"><Skeleton rows={8} /></div></div>;
  if (errors.member && !member) return <Notice>Couldn't open Deals: {errors.member}</Notice>;
  if (!member && peopleReady === false) return <Base />;
  if (!member) return <div className="c-app"><div className="c-body"><Skeleton rows={8} kind="list" /></div></div>;
  if (member.setup_step !== "done") return <Setup />;
  return <Shell />;
}

export default function App() {
  return (
    <DealsProvider>
      <Gate />
    </DealsProvider>
  );
}
