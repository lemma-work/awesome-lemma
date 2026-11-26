// The doors under the header: each with its state in words and a dot that
// is never the only signal. A door that isn't connected opens Doors, where
// its Connect is. On a phone it folds to one line, "All doors" opens the rest.

import { useState } from "react";
import { cx, serviceName } from "@lemma-plugins/kit";
import { nowMs, useTriage } from "./data";
import { doorStates, isConnectedDoor } from "./doorstate";
import { to } from "./route";

const SECURITY = ["dependabot", "code_scanning", "secret_scanning"];

export function SourceBar() {
  const d = useTriage();
  const [open, setOpen] = useState(false);
  const states = doorStates(d, nowMs(d));
  const sec = states.filter((s) => SECURITY.includes(s.key));
  const same = sec.length === 3 && sec.every((s) => s.state === sec[0].state);
  const shown = states.filter((s) => !(same && SECURITY.includes(s.key)));
  if (same) {
    const at = shown.findIndex((s) => s.key === "posthog") + 1;
    shown.splice(at, 0, { ...sec[0], key: "security", short: `Dependabot, code and secret scanning · ${sec[0].state.toLowerCase()}` });
  }
  return (
    <div className={cx("tr-src", open && "tr-src--open")}>
      <button type="button" className="tr-src__head" onClick={() => to.doors()}>Doors</button>
      {shown.map((m) => (
        <span key={m.key} className={cx("tr-src__item", m.tone === "off" && "tr-src__item--off")}>
          {m.state === "Not connected" && isConnectedDoor(m.key) ? (
            <button type="button" className="tr-src__link" onClick={() => to.doors()} title={`Connect ${serviceName(m.key)} in Doors`}>
              <span className={cx("tr-dot", `tr-dot--${m.tone}`)} aria-hidden="true" />{m.short}
            </button>
          ) : <><span className={cx("tr-dot", `tr-dot--${m.tone}`)} aria-hidden="true" />{m.short}</>}
        </span>
      ))}
      <button type="button" className="tr-src__more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Fewer" : "All doors"}</button>
    </div>
  );
}
