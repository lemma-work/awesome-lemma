// Roadmap: features ranked by who asked, with the spec drafted from what
// they said. Until the Lemma has a roadmap set-up, the first-run screen
// (/setup). Then the ranked list (/), the board (/board), a feature (/f/<id>)
// and one quote (/q/<id>).

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Map as MapIcon } from "lucide-react";
import { Banner, Button, DEMO, DataProvider, Header, Notice, Skeleton, runFunction, useToast } from "@lemma-plugins/kit";
import { LOADERS, WhoProvider, ensureLeadSchedule, refreshToday, useRoadmap, useWho } from "./data";
import { Board } from "./Board";
import { FeaturePage } from "./Feature";
import { QuotePage } from "./QuotePage";
import { Ranked } from "./Ranked";
import { useRoute } from "./route";
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
  const { loaded, errors, settings } = useRoadmap();
  const route = useRoute();
  if (!loaded) {
    return (
      <div className="c-app">
        <Header icon={MapIcon} title="Roadmap" />
        <main className="c-body c-body--wide"><Skeleton kind="table" rows={9} /></main>
      </div>
    );
  }
  const problem = errors.settings || errors.features || errors.heard;
  if (problem) return <Notice>Couldn't read the roadmap: {problem}</Notice>;
  if (!settings?.setup_done_at || route.page === "setup") return <Setup />;
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const { settings, sample, reload } = useRoadmap();
  const { me } = useWho();
  const toast = useToast();
  const once = useRef(false);
  const [clearing, setClearing] = useState(false);

  // Once per open, for the lead: their own daily run, and their items in Today.
  useEffect(() => {
    if (!settings || !me || once.current) return;
    once.current = true;
    if (settings.lead_user_id === me.id && !DEMO) {
      refreshToday();
      void ensureLeadSchedule(settings, me).then((problem) => { if (problem) toast(problem); });
    }
  }, [settings, me, toast]);

  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("roadmap_sample_data", { mode: "clear" });
      toast(out?.message || "Cleared the sample.");
      await reload();
      refreshToday();
    } catch (e) {
      toast(`Couldn't clear the sample: ${e instanceof Error ? e.message : e}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="c-app rm-app">
      {sample && !DEMO ? (
        <div className="rm-strip">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at <b>a sample roadmap</b>: a made-up product, made-up companies and what they asked for. Clear it when you're done; your own features stay.
          </Banner>
        </div>
      ) : null}
      {route.page === "board" ? <Board /> : route.page === "feature" ? <FeaturePage id={route.id} />
        : route.page === "quote" ? <QuotePage id={route.id} /> : <Ranked />}
    </div>
  );
}
