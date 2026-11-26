// User feedback: what people say about your product and your rivals, filed
// under the feature it is about. One app, three views: the inbox (/), a
// feature and everything said about it (/features, /f/<id>), and this week
// (/week). Until the Lemma is set up, set-up (/setup); later, Settings.

import { useEffect, useRef, useState } from "react";
import { FlaskConical, MessageSquare } from "lucide-react";
import { Banner, Button, DEMO, DataProvider, Header, Notice, Skeleton, errorText, runFunction, useToast } from "@lemma-plugins/kit";
import { LOADERS, WhoProvider, useUF, useWho } from "./data";
import { Features } from "./Features";
import { Inbox } from "./Inbox";
import { useRoute } from "./route";
import { Setup, ensureMine } from "./Setup";
import { Week } from "./Week";

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
  const uf = useUF();
  const route = useRoute();
  if (!uf.loaded) {
    return (
      <div className="c-app">
        <Header icon={MessageSquare} title="Feedback" />
        <main className="c-body c-body--wide"><Skeleton kind="list" rows={8} /></main>
      </div>
    );
  }
  if (uf.errors.settings || uf.errors.feedback) return <Notice>Couldn't read User feedback's tables. Reload the page; if it stays, the plugin may need adding again.</Notice>;
  if (!uf.settings?.setup_done_at || route.page === "setup") return <Setup first={!uf.settings?.setup_done_at} />;
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const uf = useUF();
  const { me } = useWho();
  const toast = useToast();
  const once = useRef(false);
  const [clearing, setClearing] = useState(false);

  // Once per open: this person's Today items and, for a filer, their own trigger.
  useEffect(() => {
    if (!me || once.current || DEMO) return;
    once.current = true;
    const filer = (uf.settings?.filers || []).some((f) => f.user_id === me.id);
    void ensureMine(me, filer).then((p) => { if (p) toast(p); });
    void runFunction("user_feedback_needs_you", {}).catch(() => undefined);
  }, [me, uf.settings, toast]);

  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("user_feedback_sample_data", { mode: "clear" });
      toast(out?.message || "Cleared the sample.");
      await uf.reload();
    } catch (e) {
      toast(`Couldn't clear the sample: ${errorText(e)}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      {uf.sample && !DEMO ? (
        <div className="uf-strip">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at a sample: a made-up product, two made-up rivals and what people said about them.
          </Banner>
        </div>
      ) : null}
      {route.page === "features" ? <Features id={route.id} />
        : route.page === "week" ? <Week back={route.back} />
        : route.page === "settings" ? <Setup first={false} />
        : route.page === "inbox" ? <Inbox tab={route.tab} id={route.id} />
        : <Inbox tab="file" id={null} />}
    </>
  );
}
