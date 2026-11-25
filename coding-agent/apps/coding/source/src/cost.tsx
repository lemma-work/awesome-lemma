// What a session cost, from the conversation's usage (lemma-platform#1243),
// for the viewer's own cloud sessions only: a conversation is its starter's,
// and a coding agent on a Mac runs on the person's own plan and reports no
// cost. When the server can't say, nothing is shown.

import { useEffect, useState } from "react";
import { usage, usageMissing } from "./platform";
import type { Session } from "./types";

export function dollars(n: number): string {
  return n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

/** One session's cost, or null. */
export function useCost(s: Session | null, meId: string | null | undefined, live = false): number | null {
  const [cost, setCost] = useState<number | null>(null);
  const id = s && s.conversation_id && s.place === "cloud" && s.started_by && s.started_by === meId ? s.conversation_id : null;
  useEffect(() => {
    setCost(null);
    if (!id || usageMissing()) return;
    let alive = true;
    void usage(id, live).then((u) => alive && setCost(u?.cost_usd ?? null));
    return () => {
      alive = false;
    };
  }, [id, live]);
  return cost;
}

/** The viewer's cloud sessions started in the last seven days, added up. */
export function useWeekCost(sessions: Session[], meId: string | null | undefined): { total: number; count: number } | null {
  const [out, setOut] = useState<{ total: number; count: number } | null>(null);
  const since = Date.now() - 7 * 86_400_000;
  const ids = sessions
    .filter((s) => s.started_by === meId && s.place === "cloud" && s.conversation_id && Date.parse(s.started_at || s.created_at) >= since)
    .map((s) => s.conversation_id as string);
  const key = ids.join(",");
  useEffect(() => {
    if (!ids.length || usageMissing()) {
      setOut(null);
      return;
    }
    let alive = true;
    void Promise.all(ids.map((id) => usage(id))).then((list) => {
      if (!alive) return;
      const known = list.filter((u) => u && u.cost_usd != null) as { cost_usd: number }[];
      setOut(known.length ? { total: known.reduce((n, u) => n + u.cost_usd, 0), count: known.length } : null);
    });
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return out;
}
