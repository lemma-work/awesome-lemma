// Forms: every answer to every outside form, each sent to the work it
// belongs to.
//
// Until the Lemma has a Forms set-up, the first-run screen (/setup). Then
// one frame with three tabs: Answers (/, the home screen, and its
// segments), Doors (/doors, a door's panel at /doors/<id>) and Routing
// (/routing). One answer (/a/<id>) is the page a row opens to.

import { useEffect, useRef, useState } from "react";
import { FileInput, FlaskConical, Settings2 } from "lucide-react";
import { Banner, Button, DEMO, DataProvider, Notice, SearchField, Skeleton, cx, errorText, runFunction, useToast } from "@lemma-plugins/kit";
import { Answer } from "./Answer";
import { Answers } from "./Answers";
import { LOADERS, WhoProvider, refreshNeedsYou, useForms, useWho } from "./data";
import { Doors } from "./Doors";
import { Routing } from "./Routing";
import { to, useRoute } from "./route";
import { Setup } from "./Setup";
import { detectPlugins, ensureMine } from "./wire";

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
  const { loaded, errors, settings } = useForms();
  const route = useRoute();
  if (!loaded) {
    return (
      <div className="c-app">
        <div className="fm-top"><span className="fm-top__name"><FileInput aria-hidden="true" />Forms</span></div>
        <main className="c-body c-body--wide"><Skeleton kind="table" rows={8} /></main>
      </div>
    );
  }
  if (errors.settings || errors.answers) return <Notice>Couldn't read Forms: {errorText(errors.settings || errors.answers)}</Notice>;
  if (!settings?.setup_done_at || route.page === "setup") return <Setup />;
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const d = useForms();
  const { me } = useWho();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [clearing, setClearing] = useState(false);
  const once = useRef(false);

  useEffect(() => {
    if (once.current || !d.settings || !me) return;
    once.current = true;
    refreshNeedsYou();
    void detectPlugins(d.settings);
    if (!d.settings.sample || d.settings.members.length) {
      void ensureMine(d.settings, me).then((problems) => {
        if (problems.length) toast(`Answers sent to you won't reach your Today yet: ${problems[0]}`);
      });
    }
  }, [d.settings, me, toast]);

  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("forms_sample_data", { mode: "clear" });
      toast(out?.message || "Cleared the sample.");
      await d.reload();
      to.answers();
    } catch (e) {
      toast(`Couldn't clear the sample: ${errorText(e)}`);
    } finally {
      setClearing(false);
    }
  };
  const tab = route.page === "doors" ? "doors" : route.page === "routing" ? "routing" : "answers";

  return (
    <div className="c-app fm-app">
      <header className="fm-top">
        <button type="button" className="fm-top__name" onClick={() => to.answers()}><FileInput aria-hidden="true" />Forms</button>
        <nav className="fm-tabs" aria-label="Forms">
          <button type="button" className={cx("fm-tab", tab === "answers" && "fm-tab--on")} aria-current={tab === "answers" ? "page" : undefined} onClick={() => to.answers()}>Answers</button>
          <button type="button" className={cx("fm-tab", tab === "doors" && "fm-tab--on")} aria-current={tab === "doors" ? "page" : undefined} onClick={() => to.doors()}>Doors</button>
          <button type="button" className={cx("fm-tab", tab === "routing" && "fm-tab--on")} aria-current={tab === "routing" ? "page" : undefined} onClick={() => to.routing()}>Routing</button>
        </nav>
        <span className="fm-top__fill" />
        {tab === "answers" ? (
          <div className="fm-top__search">
            <SearchField value={query} onChange={(v) => { setQuery(v); if (route.page !== "answers") to.answers("all"); }} placeholder="Search answers" />
          </div>
        ) : null}
        <Button variant="ghost" icon={Settings2} label="Set-up" onClick={() => to.setup()} />
      </header>
      {d.sample && !DEMO ? (
        <div className="fm-strip-banner">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at a <b>sample week</b>: made-up people and companies. Nothing is sent anywhere. Clear it when you're done.
          </Banner>
        </div>
      ) : null}
      {route.page === "answer" ? <Answer id={route.id} />
        : route.page === "doors" ? <Doors door={route.door} />
          : route.page === "routing" ? <Routing />
            : <Answers seg={route.page === "answers" ? route.seg : "waiting"} query={query} />}
    </div>
  );
}
