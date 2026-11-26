// Release notes: notes written from what merged, and word to everyone who asked.
//
// Until the Lemma has a set-up, the first-run screen (/setup). Then the open
// note (/), who asked (/asked), published notes (/published, /n/<id>) and
// settings (/settings).

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Tag } from "lucide-react";
import { Banner, Button, DEMO, DataProvider, Header, Notice, Skeleton, runFunction, useToast, errorText } from "@lemma-plugins/kit";
import { LOADERS, WhoProvider, ensureMine, startTell, useRN, useWho } from "./data";
import { Asked } from "./Asked";
import { Desk } from "./Desk";
import { PublishedList, PublishedNote } from "./Published";
import { useRoute } from "./route";
import { Settings, Setup } from "./Setup";

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
  const { loaded, errors, settings } = useRN();
  const route = useRoute();
  if (!loaded) {
    return (
      <div className="c-app">
        <Header icon={Tag} title="Release notes" />
        <main className="c-body c-body--wide"><Skeleton kind="record" rows={8} /></main>
      </div>
    );
  }
  if (errors.settings || errors.notes) return <Notice>Couldn't read Release notes: {errors.settings || errors.notes}</Notice>;
  if (!settings?.setup_done_at || route.page === "setup") return <Setup />;
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const rn = useRN();
  const { me } = useWho();
  const toast = useToast();
  const once = useRef(false);
  const [clearing, setClearing] = useState(false);

  // Once per open: this person's own triggers, their Today, and any reply
  // that should have been drafted while they had none.
  useEffect(() => {
    if (!me || once.current || DEMO) return;
    once.current = true;
    void ensureMine(me).then((problem) => { if (problem) toast(problem); });
    void runFunction("release_notes_on_note", { refresh: true }).catch(() => undefined);
    const have = new Set(rn.drafts.map((d) => d.built_from?.ask_id));
    for (const a of rn.asks) {
      if (a.heard_by === me.id && a.state === "shipped" && !have.has(a.id)) void startTell(a.id).catch(() => undefined);
    }
  }, [me, rn.asks, rn.drafts, toast]);

  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("release_notes_sample_data", { mode: "clear" });
      toast(out?.message || "Cleared the sample.");
      await rn.reload();
    } catch (e) {
      toast(`Couldn't clear the sample: ${errorText(e)}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="c-app rn-app">
      {rn.sample && !DEMO ? (
        <div className="rn-strip">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at <b>a sample release</b>: a made-up product and the people who asked for it. Nothing in it reaches GitHub, Slack or anyone's mail.
          </Banner>
        </div>
      ) : null}
      {route.page === "asked" ? <Asked askId={route.askId} />
        : route.page === "published" ? <PublishedList />
        : route.page === "note" ? <PublishedNote id={route.id} />
        : route.page === "settings" ? <Settings />
        : <Desk />}
    </div>
  );
}
