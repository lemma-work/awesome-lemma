// Today: your day in one place, across everything in this Lemma.
//
// One list: the shared needs_you rows every plugin writes, and the
// platform's own Needs you. Today's one question, "when do you want your
// day?", is asked on the page itself until it is answered.

import { Sun } from "lucide-react";
import { DataProvider, Header, Notice, Skeleton, useData } from "@lemma-plugins/kit";
import { LOADERS } from "./data";
import { Day } from "./Day";

export default function App() {
  return (
    <DataProvider loaders={LOADERS}>
      <Shell />
    </DataProvider>
  );
}

function Shell() {
  const { loaded, errors } = useData();
  if (!loaded) {
    return (
      <div className="c-app">
        <Header icon={Sun} title="Today" />
        <main className="c-body t-body">
          <div className="t-grid">
            <div className="c-stack"><Skeleton kind="list" rows={4} /><Skeleton kind="list" rows={3} /></div>
            <div className="c-stack"><Skeleton kind="list" rows={3} /></div>
          </div>
        </main>
      </div>
    );
  }
  if (errors.settings) return <Notice>Couldn't read Today: {errors.settings}</Notice>;
  return <Day />;
}
