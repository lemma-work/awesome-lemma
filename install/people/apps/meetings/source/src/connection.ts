// Connecting a calendar (and Google Meet) happens in this app, through the
// kit's Connect piece: it signs in in a new tab, reconnects an expired
// sign-in, and asks an admin when the organization hasn't added the service.
// What stays here is reading which of my accounts there are (set-up needs the
// account's id and address), and saying a calendar's last failure in words.

import { useEffect, useState } from "react";
import { DEMO, client, connectionProblem, errorText, items, orgId } from "@lemma-plugins/kit";

export type CalendarConnector = "google_calendar" | "outlook";

export interface Account {
  id: string;
  connector_id: string;
  status?: string;
  email?: string | null;
  display_name?: string | null;
  is_default?: boolean;
}

/** Said beside Connect: what each connection is for (from the connector's own purpose). */
export const PURPOSE: Record<CalendarConnector | "googlemeet", string> = {
  google_calendar: "Reads your Google Calendar: the next two weeks for briefs, the last month for what was said. It never adds, changes or answers an event.",
  outlook: "Reads your Outlook calendar: the next two weeks for briefs, the last month for what was said. It never adds, changes or answers an event.",
  googlemeet: "Reads the transcript Google Meet kept of a meeting you were on, so its decisions and promises are written up after.",
};

/** A calendar row's provider, as its connector. */
export const CONNECTOR: Record<string, CalendarConnector> = { google: "google_calendar", outlook: "outlook" };

export const addressOf = (a: Account) => (a.email || (a.display_name?.includes("@") ? a.display_name : "") || "").toLowerCase();

const usable = (a: Account) => !a.status || a.status === "CONNECTED" || a.status === "ACTIVE";

/**
 * My signed-in accounts of each connector, default first; null while reading.
 * Read again whenever `again` changes (pass the connection's state, so a
 * sign-in finished in another tab shows up here).
 */
export function useAccounts(connectors: string[], again?: unknown): Account[] | null {
  const key = connectors.join(",");
  const [found, setFound] = useState<{ key: string; list: Account[] } | null>(null);
  useEffect(() => {
    if (DEMO) return;
    let live = true;
    void (async () => {
      const org = await orgId();
      const lists = org
        ? await Promise.all(
            key.split(",").map((c) =>
              client.connectors.accounts.list(org, { connectorId: c, limit: 50 } as never).then(
                (r) => items<Account>(r).filter((a) => a.connector_id === c),
                () => [] as Account[],
              ),
            ),
          )
        : [];
      const mine = lists.flat().filter(usable).sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default));
      if (live) setFound({ key, list: mine });
    })();
    return () => {
      live = false;
    };
  }, [key, again]);
  return found?.key === key ? found.list : null;
}

/**
 * A calendar's last failure, said to the person. The read words the usual
 * ones itself; anything else is the exception's own text, which can carry
 * platform codes: a connection one is said in words, the rest without the
 * platform's nouns.
 */
export function stoppedText(raw: string, provider?: string): string {
  const connector = provider ? CONNECTOR[provider] || provider : undefined;
  for (const [code] of raw.matchAll(/\b[A-Z][A-Z_]{5,}\b/g)) {
    if (connectionProblem({ code }, connector)) return errorText({ code, message: raw }, connector);
  }
  const text = errorText({ message: raw }, connector);
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}
