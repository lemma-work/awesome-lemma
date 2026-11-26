// Small shared pieces of the app's screens.

import { useEffect, useState } from "react";

/** User feedback's app, which settles links to check and suggested features.
 *  Its slug isn't settled until User feedback is built: change it here. */
export const FEEDBACK_APP = "feedback";

/** Phone width: the table becomes cards, the drawer a page. */
export function useNarrow(px = 760): boolean {
  const query = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

/** Keys pressed outside a field: J/K, 1-3 and the like. */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) || e.metaKey || e.ctrlKey || e.altKey;
}
