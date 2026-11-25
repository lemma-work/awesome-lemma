// The bar on top of every screen: what this is, its state in words, its
// dates, the switch between the running sprint, the next one and past ones,
// and the screen's one primary action.

import type { ReactNode } from "react";
import { IterationCw, Settings as Cog } from "lucide-react";
import { Button, Segmented } from "@lemma-plugins/kit";
import { useSprints } from "./data";
import { to } from "./route";

export type Here = "run" | "plan" | "past" | "none";

export function Top({ title, pill, dates, here, children }: { title: ReactNode; pill?: ReactNode; dates?: ReactNode; here: Here; children?: ReactNode }) {
  const { w } = useSprints();
  const items: { id: Here; label: string }[] = [];
  if (w.running) items.push({ id: "run", label: `Sprint ${w.running.number}` });
  if (w.planned) items.push({ id: "plan", label: `Plan ${w.planned.number}` });
  items.push({ id: "past", label: "Past" });
  return (
    <header className="sp-top">
      <div className="sp-top__what">
        <IterationCw size={15} aria-hidden="true" className="sp-top__icon" />
        <h1>{title}</h1>
        {pill}
        {dates ? <span className="sp-top__dates">{dates}</span> : null}
      </div>
      <div className="sp-top__acts">
        <Segmented label="Sprint" items={items} value={here} onChange={(id) => (id === "run" ? to.run() : id === "plan" ? to.plan() : to.past())} />
        {children}
        <Button variant="ghost" size="sm" icon={Cog} label="Set-up" onClick={() => to.setup()} />
      </div>
    </header>
  );
}
