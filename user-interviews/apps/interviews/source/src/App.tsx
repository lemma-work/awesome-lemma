// User interviews: the right users found and booked, and each call turned
// into findings.
//
// Until the Lemma has a set-up (or the sample), the set-up page. Then the
// studies (/), a new study (/new), a study and its people (/s/<id>, the home
// of the work), what its calls found (/s/<id>/findings) and one call
// (/s/<id>/p/<person>).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FlaskConical, MessagesSquare, Settings2 } from "lucide-react";
import { Banner, Button, DEMO, DataProvider, Notice, Skeleton, errorText, runFunction, useToast } from "@lemma-plugins/kit";
import { LOADERS, WhoProvider, ensureMine, useUI, useWho } from "./data";
import { useRoute, to } from "./route";
import { Studies } from "./Studies";
import { NewStudy } from "./NewStudy";
import { StudyPage } from "./Study";
import { FindingsPage } from "./Findings";
import { CallPage } from "./Call";
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

/** The bar on top: where you are, and what you can do here. */
export function Top({ crumbs, children }: { crumbs: { label: string; go?: () => void }[]; children?: ReactNode }) {
  return (
    <header className="ui-top">
      <nav className="ui-top__crumbs" aria-label="Where you are">
        <span className="ui-top__icon" aria-hidden="true"><MessagesSquare size={15} /></span>
        {crumbs.map((c, i) => (
          <span key={i} className="ui-top__crumb">
            {i ? <span className="c-faint" aria-hidden="true">/</span> : null}
            {c.go ? <button type="button" onClick={c.go}>{c.label}</button> : <span className="ui-top__here">{c.label}</span>}
          </span>
        ))}
      </nav>
      <div className="ui-top__acts">{children}</div>
    </header>
  );
}

function Gate() {
  const ui = useUI();
  const route = useRoute();
  if (!ui.loaded) {
    return (
      <div className="c-app">
        <Top crumbs={[{ label: "User interviews" }]} />
        <main className="c-body c-body--wide"><Skeleton kind="table" rows={8} /></main>
      </div>
    );
  }
  if (ui.errors.settings || ui.errors.studies) return <Notice>Couldn't read User interviews: {errorText(new Error(ui.errors.settings || ui.errors.studies))}</Notice>;
  if ((!ui.settings?.setup_done_at && !ui.sample) || route.page === "setup") return <Setup />;
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const ui = useUI();
  const { me } = useWho();
  const toast = useToast();
  const once = useRef(false);
  const [clearing, setClearing] = useState(false);

  // Once per open: this person's own triggers and morning run, and their Today.
  useEffect(() => {
    if (!me || once.current || DEMO) return;
    once.current = true;
    if (!ui.member?.ready_at) void ensureMine(me, ui.member).then((problem) => { if (problem) toast(problem); });
    void runFunction("interviews_daily", { refresh: true }).catch(() => undefined);
  }, [me, ui.member, toast]);

  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("interviews_sample_data", { mode: "clear" });
      toast(out?.message || "Cleared the sample.");
      await ui.reload();
      to.studies();
    } catch (e) {
      toast(`Couldn't clear the sample: ${errorText(e)}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="c-app ui-app">
      {ui.sample && !DEMO ? (
        <div className="ui-strip">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at <b>a sample study</b>: a made-up product and people at made-up companies. Its invites are only marked sent; nothing reaches anyone's mail.
          </Banner>
        </div>
      ) : null}
      {route.page === "new" ? <NewStudy />
        : route.page === "edit" ? <NewStudy id={route.id} />
        : route.page === "study" ? <StudyPage id={route.id} show={route.show} invites={route.invites} />
        : route.page === "findings" ? <FindingsPage id={route.id} feature={route.feature} />
        : route.page === "call" ? <CallPage id={route.id} personId={route.person} />
        : <Studies />}
    </div>
  );
}

export function SetupLink() {
  return <Button variant="ghost" size="sm" icon={Settings2} label="Set-up" onClick={() => to.setup()} />;
}
