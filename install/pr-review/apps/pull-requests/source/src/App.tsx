// Pull requests: every pull request read against the team's own rules.
//
// Until the Lemma has a set-up, the first-run screen (/setup). Then the inbox
// (/, /all, /merged), one pull request (/pr/<owner>/<repo>/<n>[/tab]) and
// settings (/settings, /settings/merging).

import { useEffect, useRef, useState } from "react";
import { FlaskConical, GitPullRequest } from "lucide-react";
import { Banner, Button, DEMO, DataProvider, Header, Notice, Skeleton, useToast } from "@lemma-plugins/kit";
import { LOADERS, WhoProvider, act, ensureMine, errText, usePrr, useWho } from "./data";
import { Inbox } from "./Inbox";
import { PrPage } from "./PrPage";
import { useRoute } from "./route";
import { Merging, Settings } from "./Settings";
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
  const prr = usePrr();
  const route = useRoute();
  const { me } = useWho();
  const toast = useToast();
  const once = useRef(false);
  // Once per open, after set-up: this person's own trigger for Today.
  useEffect(() => {
    if (!me || once.current || DEMO || !prr.settings?.setup_done_at || prr.sample) return;
    once.current = true;
    void ensureMine(me.id).then((problem) => problem && toast(problem));
  }, [me, prr.settings?.setup_done_at, prr.sample, toast]);
  if (!prr.loaded) {
    return (
      <div className="c-app">
        <Header icon={GitPullRequest} title="Pull requests" />
        <main className="c-body c-body--wide"><Skeleton rows={9} /></main>
      </div>
    );
  }
  const err = prr.errors.settings || prr.errors.prs;
  if (err) return <Notice>Couldn't read PR review: {err}</Notice>;
  if (route.page === "setup" || (!prr.settings?.setup_done_at && !prr.prs.length)) return <Setup />;
  return (
    <>
      {prr.sample && !DEMO ? <SampleStrip /> : null}
      {route.page === "pr" ? <PrPage repo={route.repo} number={route.number} tab={route.tab} path={route.path} />
        : route.page === "settings" ? (route.sub === "merging" ? <Merging /> : <Settings />)
        : <Inbox view={route.page === "inbox" ? route.view : "inbox"} />}
    </>
  );
}

function SampleStrip() {
  const prr = usePrr();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const clear = async () => {
    setBusy(true);
    try {
      const out = await act.sample("clear");
      toast(out?.message || "Cleared the sample.");
      await prr.reload();
    } catch (e) {
      toast(`Couldn't clear the sample: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="prr-samplebar">
      <Banner icon={FlaskConical} action={<Button size="sm" busy={busy} onClick={() => void clear()}>Clear the sample</Button>}>
        You're looking at <b>a sample</b>: made-up pull requests in made-up repositories. Nothing in it reaches GitHub.
      </Banner>
    </div>
  );
}
