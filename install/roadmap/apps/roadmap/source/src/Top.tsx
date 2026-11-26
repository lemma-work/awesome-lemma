// The bar on top of the list and the board: what this is, how many, the
// switch between the two views of the same rows, and the screen's actions.

import type { ReactNode } from "react";
import { Columns3, List, Map as MapIcon, Settings as Cog } from "lucide-react";
import { Button, Segmented } from "@lemma-plugins/kit";
import { to } from "./route";

export function Top({ view, count, children }: { view: "ranked" | "board"; count: ReactNode; children?: ReactNode }) {
  return (
    <header className="rm-top">
      <div className="rm-top__what">
        <span className="rm-top__icon" aria-hidden="true"><MapIcon size={15} /></span>
        <h1>Roadmap</h1>
        <span className="rm-top__count">{count}</span>
      </div>
      <div className="rm-top__acts">
        <span className="rm-view">
          <Segmented label="View" value={view} onChange={(v) => (v === "board" ? to.board() : to.ranked())}
            items={[{ id: "ranked", label: "Ranked" }, { id: "board", label: "Board" }]} />
        </span>
        {children}
        <Button variant="ghost" size="sm" icon={Cog} label="Settings" onClick={() => to.setup()} />
      </div>
    </header>
  );
}

export const VIEW_ICONS = { ranked: List, board: Columns3 };
