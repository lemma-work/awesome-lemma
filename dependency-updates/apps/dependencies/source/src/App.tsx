// Dependencies: the team's dependency updates.
//
// Until the Lemma has a set-up, the first-run screen (/setup). Then the week
// (/, with an update as a sheet at /u/<id>), a pull request the Lemma opened
// (/b/<id>) and the rules (/rules).

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Package } from "lucide-react";
import { Banner, Button, DEMO, DataProvider, Header, Notice, Skeleton, runFunction, useToast, errorText } from "@lemma-plugins/kit";
import { Batch } from "./Batch";
import { LOADERS, MeProvider, ensureSchedules, refreshNeedsYou, useDeps, useMe } from "./data";
import { useRoute } from "./route";
import { Rules } from "./Rules";
import { Setup } from "./Setup";
import { Week } from "./Week";

export default function App() {
  return (
    <DataProvider loaders={LOADERS}>
      <MeProvider>
        <Gate />
      </MeProvider>
    </DataProvider>
  );
}

function Gate() {
  const { loaded, errors, settings, active, sample } = useDeps();
  const route = useRoute();
  if (!loaded) {
    return (
      <div className="c-app">
        <Header icon={Package} title="Dependencies" />
        <main className="c-body c-body--wide"><Skeleton kind="table" rows={8} /></main>
      </div>
    );
  }
  if (errors.settings || errors.updates) return <Notice>Couldn't read Dependency updates: {errors.settings || errors.updates}</Notice>;
  if (!settings?.setup_done_at || (!active.length && !sample) || route.page === "setup") return <div className="c-app dp-app"><Setup /></div>;
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const { settings, active, repos, sample, reload } = useDeps();
  const me = useMe();
  const toast = useToast();
  const once = useRef(false);
  const [clearing, setClearing] = useState(false);

  // Once per open, for the owner: their items in Today, and any schedule missing.
  useEffect(() => {
    if (!settings || !me || once.current || DEMO) return;
    once.current = true;
    if (settings.owner_user_id === me.id) {
      refreshNeedsYou();
      const repoIds = active.every((r) => Object.keys(r.schedule_ids || {}).length >= 2);
      const ours = settings.schedule_user_id === me.id && Object.keys(settings.schedule_ids || {}).length >= 4;
      if (!sample && (!repoIds || !ours)) {
        void ensureSchedules(settings, repos, me).then((out) => {
          if (out.problems.length) toast(`Couldn't make ${out.problems.join(", ")}.`);
        });
      }
    }
  }, [settings, me, active, repos, sample, toast]);

  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("deps_sample_data", { mode: "clear" });
      toast(out?.message || "Cleared the sample.");
      await reload();
    } catch (e) {
      toast(`Couldn't clear the sample: ${errorText(e)}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="c-app dp-app">
      {sample ? (
        <div className="dp-strip">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at <b>a sample week</b>: a made-up team's repositories. Clear it, then pick your own.
          </Banner>
        </div>
      ) : null}
      {route.page === "batch" ? <Batch id={route.id} /> : route.page === "rules" ? <Rules /> : <Week open={route.page === "week" ? route.update : undefined} />}
    </div>
  );
}
