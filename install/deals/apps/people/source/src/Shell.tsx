// The app once set up: a header, the list with its filters, and a page per
// person. People and Companies open each other (the SDK's apps.open), so a
// company named on a person's page opens in Companies and back.

import { useEffect, useRef, type ReactNode } from "react";
import { RefreshCw, Settings as Cog, Users } from "lucide-react";
import { AskButton, Banner, Button, Header, runFunction, startWorkflow, useToast } from "@lemma-plugins/kit";
import { usePeople } from "./data";
import { PeopleList, TeamList, UnsureList } from "./List";
import { PersonPage, TeamPersonPage } from "./PersonPage";
import { to, useRoute } from "./route";
import { SettingsPage } from "./Settings";

/** Count again on open when the last count is older than ten minutes: cheap,
 *  no model, and it keeps warmth and the next meeting current. */
function useFreshOnOpen() {
  const { settings, reload } = usePeople();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !settings) return;
    const last = settings.refreshed_at ? new Date(settings.refreshed_at).getTime() : 0;
    if (Date.now() - last < 10 * 60_000) return;
    done.current = true;
    void runFunction("people_refresh", {}).then(() => reload()).catch(() => undefined);
  }, [settings, reload]);
}

export function Shell() {
  const route = useRoute();
  const { sample, errors, reload } = usePeople();
  useFreshOnOpen();
  const errs = Object.entries(errors).filter(([, v]) => v);

  let page: ReactNode;
  if (route.page === "person") page = <PersonPage id={route.id} />;
  else if (route.page === "teamPerson") page = <TeamPersonPage handle={route.handle} />;
  else if (route.page === "settings") page = <SettingsPage />;
  else {
    page = (
      <ListFrame>
        {route.page === "unsure" ? <UnsureList /> : route.page === "team" ? <TeamList /> : <PeopleList filter={route.filter} />}
      </ListFrame>
    );
  }

  return (
    <div className="c-app">
      {sample.mail || sample.meetings || sample.people || sample.team ? (
        <div className="pm-strip">
          <Banner action={sample.people || sample.team ? <Button size="sm" onClick={() => to.settings()}>Sample settings</Button> : undefined}>
            <b>Sample people.</b> Made up at .example addresses, so you can see how it works: {[
              sample.mail ? "Mail's sample mailbox" : "", sample.meetings ? "Meetings' sample calendar" : "",
              sample.people ? "a few people with months of history" : "", sample.team ? "a sample colleague in the team view" : "",
            ].filter(Boolean).join(", ")}.
          </Banner>
        </div>
      ) : null}
      {errs.length ? (
        <div className="pm-strip">
          {errs.map(([name, text]) => (
            <Banner key={name} tone="danger" action={<Button size="sm" onClick={() => void reload(name)}>Try again</Button>}>
              Couldn't load {name}: {text}
            </Banner>
          ))}
        </div>
      ) : null}
      {page}
    </div>
  );
}

function ListFrame({ children }: { children: ReactNode }) {
  const { people } = usePeople();
  const toast = useToast();
  const refresh = async () => {
    try {
      await startWorkflow("people-refresh");
      toast("Counting again, and reading anyone new.");
    } catch (e) {
      toast(`Couldn't start it: ${e instanceof Error ? e.message : e}`);
    }
  };
  return (
    <>
      <Header icon={Users} title="People" count={people.length}>
        <AskButton text="Who should I get back in touch with this week, and why?" />
        <Button variant="ghost" icon={RefreshCw} label="Count again" onClick={() => void refresh()} />
        <Button variant="ghost" icon={Cog} label="Settings" onClick={() => to.settings()} />
      </Header>
      {children}
    </>
  );
}
