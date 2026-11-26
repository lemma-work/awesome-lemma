// The members' side: the roster (/), a beta's roster (/b/<id>), a person's
// drawer (/p/<id>), the next batch (/b/<id>/next), a beta's settings
// (/b/<id>/settings) and a new beta (/setup). With no beta yet, set-up.

import { useEffect, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";
import { Banner, Button, DEMO, Header, Notice, Skeleton, runFunction, useToast } from "@lemma-plugins/kit";
import { EAProvider, useEA } from "./data";
import { Next } from "./Next";
import { Roster, pickBeta } from "./Roster";
import { useRoute, to } from "./route";
import { Setup } from "./Setup";
import { why } from "./wire";

export default function App() {
  return (
    <EAProvider>
      <Gate />
    </EAProvider>
  );
}

function Gate() {
  const { loaded, errors, betas, testers, reload } = useEA();
  const route = useRoute();
  const toast = useToast();
  const once = useRef(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!loaded || once.current || DEMO) return;
    once.current = true;
    void runFunction("early_access_needs_you", {}).catch(() => undefined);
  }, [loaded]);

  if (!loaded) {
    return (
      <div className="c-app">
        <Header icon={FlaskConical} title="Early access" />
        <main className="c-body c-body--wide"><Skeleton kind="table" rows={10} /></main>
      </div>
    );
  }
  const problem = errors.betas || errors.testers;
  if (problem) return <Notice>Couldn't read the betas: {problem}</Notice>;
  if (route.page === "setup" || !betas.length) return <Setup beta={null} />;
  if (route.page === "settings") {
    const b = pickBeta(betas, route.beta);
    return b ? <Setup key={b.id} beta={b} /> : <Notice>That beta isn't here any more.</Notice>;
  }
  const person = route.page === "roster" && route.person ? testers.find((t) => t.id === route.person) : null;
  const beta = pickBeta(betas, route.page === "next" ? route.beta : route.page === "roster" ? route.beta || person?.beta_id : undefined);
  if (!beta) return <Notice>That beta isn't here any more.</Notice>;

  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("early_access_sample_data", { mode: "clear" });
      toast(out.message || "Cleared the sample.");
      await reload();
      to.roster();
    } catch (e) {
      toast(`Couldn't clear the sample: ${why(e)}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="c-app ea-app">
      {beta.sample && !DEMO ? (
        <div className="ea-strip">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at <b>a sample beta</b>: made-up people at made-up companies. Nothing in it is sent. Clear it when you're done; your own betas stay.
          </Banner>
        </div>
      ) : null}
      {route.page === "next" ? <Next key={beta.id} beta={beta} /> : <Roster betaId={beta.id} personId={route.page === "roster" ? route.person : undefined} />}
    </div>
  );
}
