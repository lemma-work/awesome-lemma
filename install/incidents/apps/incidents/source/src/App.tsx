// Incidents: the team's incidents, their timelines and write-ups.
//
// Until the Lemma has an incident set-up, the first-run screen (/setup). Then
// the list (/, /followups, /resolved), an incident (/i/<n>) and its write-up
// (/i/<n>/writeup). One bar on top everywhere: the views, search on `/`, and
// Declare.

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Settings2, TriangleAlert } from "lucide-react";
import { Banner, Button, DEMO, DataProvider, Notice, SearchField, Segmented, Skeleton, runFunction, useToast } from "@lemma-plugins/kit";
import { LOADERS, WhoProvider, refreshNeedsYou, useIncidents } from "./data";
import { Declare } from "./Declare";
import { IncidentPage } from "./Incident";
import { List, counts } from "./List";
import { to, useRoute, type View } from "./route";
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
  const { loaded, errors, settings } = useIncidents();
  const route = useRoute();
  if (!loaded) {
    return (
      <div className="c-app">
        <div className="in-top"><span className="in-top__name"><TriangleAlert aria-hidden="true" />Incidents</span></div>
        <main className="c-body c-body--wide"><Skeleton kind="record" rows={8} /></main>
      </div>
    );
  }
  if (errors.settings || errors.incidents) return <Notice>Couldn't read Incidents: {errors.settings || errors.incidents}</Notice>;
  if (!settings?.setup_done_at || route.page === "setup") return <Setup />;
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const data = useIncidents();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [declaring, setDeclaring] = useState(false);
  const [clearing, setClearing] = useState(false);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    refreshNeedsYou();
  }, []);

  const view: View = route.page === "list" ? route.view : "active";
  const n = counts(data);
  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("incidents_sample_data", { mode: "clear" });
      toast(out?.message || "Cleared the sample.");
      await data.reload();
      to.list();
    } catch (e) {
      toast(`Couldn't clear the sample: ${e instanceof Error ? e.message : e}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="c-app in-app">
      <header className="in-top">
        <button type="button" className="in-top__name" onClick={() => to.list()}><TriangleAlert aria-hidden="true" />Incidents</button>
        <Segmented label="Incidents" value={route.page === "list" ? view : ("none" as View)} onChange={(v) => to.list(v)}
          items={[{ id: "active", label: "Active", count: n.active }, { id: "followups", label: "Follow-ups", count: n.followups },
            { id: "resolved", label: "Resolved", count: n.resolved }]} />
        <span className="in-top__fill" />
        <div className="in-top__search">
          <SearchField value={query} onChange={(v) => { setQuery(v); if (route.page !== "list") to.list(); }} placeholder="Search" />
        </div>
        <Button size="md" onClick={() => setDeclaring(true)}>Declare incident</Button>
        <Button variant="ghost" icon={Settings2} label="Set-up" onClick={() => to.setup()} />
      </header>
      {data.sample && !DEMO ? (
        <div className="in-strip">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at <b>sample incidents</b>: made-up people and services. Nothing was posted to Slack. Clear them when you're done.
          </Banner>
        </div>
      ) : null}
      {route.page === "incident" ? <IncidentPage number={route.number} tab={route.tab} />
        : <List view={view} query={query} onDeclare={() => setDeclaring(true)} />}
      <Declare open={declaring} onClose={() => setDeclaring(false)} />
    </div>
  );
}
