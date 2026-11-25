// Sprints: the team's sprints over its tasks.
//
// Until the Lemma has a sprint set-up, the first-run screen (/setup). Then the
// running sprint (/), planning the next (/plan), closing (/close) and past
// sprints (/s, /s/<n>).

import { useEffect, useRef, useState } from "react";
import { FlaskConical, IterationCw } from "lucide-react";
import { Banner, Button, DEMO, DataProvider, Header, Notice, Skeleton, runFunction, useToast } from "@lemma-plugins/kit";
import { LOADERS, WhoProvider, ensureLeadSchedules, refreshNeedsYou, useSprints, useWho } from "./data";
import { Close } from "./Close";
import { PastList, PastSprint } from "./Past";
import { Plan } from "./Plan";
import { useRoute } from "./route";
import { Run } from "./Run";
import { Setup } from "./Setup";

export default function App() {
  return (
    <DataProvider loaders={LOADERS}>
      <WhoProvider>
        <Gate />
      </WhoProvider>
    </DataProvider>
  );
}

function Gate() {
  const { loaded, errors, settings } = useSprints();
  const route = useRoute();
  if (!loaded) {
    return (
      <div className="c-app">
        <Header icon={IterationCw} title="Sprints" />
        <main className="c-body c-body--wide"><Skeleton kind="table" rows={8} /></main>
      </div>
    );
  }
  if (errors.settings || errors.sprints) return <Notice>Couldn't read Sprints: {errors.settings || errors.sprints}</Notice>;
  if (!settings?.setup_done_at || route.page === "setup") return <Setup />;
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const { settings, sample, reload } = useSprints();
  const { me } = useWho();
  const toast = useToast();
  const once = useRef(false);
  const [clearing, setClearing] = useState(false);

  // Once per open, for the lead: their own schedules, and their items in Today.
  useEffect(() => {
    if (!settings || !me || once.current) return;
    once.current = true;
    if (settings.lead_user_id === me.id && !DEMO) {
      refreshNeedsYou();
      void ensureLeadSchedules(settings, me).then((problem) => { if (problem) toast(problem); });
    }
  }, [settings, me, toast]);

  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("sprints_sample_data", { mode: "clear" });
      toast(out?.message || "Cleared the sample.");
      await reload();
    } catch (e) {
      toast(`Couldn't clear the sample: ${e instanceof Error ? e.message : e}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="c-app sp-app">
      {sample ? (
        <div className="sp-strip">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at <b>a sample sprint</b>: a made-up team and its work. Clear it when you're done; your own tasks stay.
          </Banner>
        </div>
      ) : null}
      {route.page === "plan" ? <Plan /> : route.page === "close" ? <Close /> : route.page === "past" ? <PastList />
        : route.page === "sprint" ? <PastSprint number={route.number} /> : <Run />}
    </div>
  );
}
