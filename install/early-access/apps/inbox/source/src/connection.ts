// Connecting a mailbox happens in this app, through the kit's Connect piece:
// it signs in in a new tab, reconnects an expired sign-in, and asks an admin
// when the organization hasn't added Gmail or Outlook. What stays here is
// reading which of my accounts there are (set-up needs the account's id and
// address), and saying a mailbox's last failure in words.

import { useEffect, useState } from "react";
import { DEMO, client, connectionProblem, errorText, items, orgId } from "@lemma-plugins/kit";

export type Provider = "gmail" | "outlook";

export interface Account {
  id: string;
  connector_id: string;
  status?: string;
  email?: string | null;
  display_name?: string | null;
  is_default?: boolean;
}

/** Said beside Connect: what the connection is for (from the connector's own purpose). */
export const PURPOSE: Record<Provider, string> = {
  gmail: "Reads your Gmail to sort it and draft the replies you owe. Nothing is sent unless you press Send.",
  outlook: "Reads your Outlook mail to sort it and draft the replies you owe. Nothing is sent unless you press Send.",
};

export const addressOf = (a: Account) => (a.email || (a.display_name?.includes("@") ? a.display_name : "") || "").toLowerCase();

const usable = (a: Account) => !a.status || a.status === "CONNECTED" || a.status === "ACTIVE";

/**
 * My signed-in accounts of one provider, default first; null while reading.
 * Read again whenever `again` changes (pass the connection's state, so a
 * sign-in finished in another tab shows up here).
 */
export function useAccounts(provider: Provider, again: unknown): Account[] | null {
  const [found, setFound] = useState<{ provider: Provider; list: Account[] } | null>(null);
  useEffect(() => {
    if (DEMO) return;
    let live = true;
    void (async () => {
      const org = await orgId();
      const list = org
        ? await client.connectors.accounts.list(org, { connectorId: provider, limit: 50 } as never).then(
            (r) => items<Account>(r),
            () => [] as Account[],
          )
        : [];
      const mine = list.filter((a) => a.connector_id === provider && usable(a)).sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default));
      if (live) setFound({ provider, list: mine });
    })();
    return () => {
      live = false;
    };
  }, [provider, again]);
  return found?.provider === provider ? found.list : null;
}

/** Whether a failure's text names a connection problem (signed out, not connected, not added). */
export function aboutConnection(raw: string): boolean {
  for (const [code] of raw.matchAll(/\b[A-Z][A-Z_]{5,}\b/g)) if (connectionProblem({ code })) return true;
  return /not installed in this organi[sz]ation/i.test(raw);
}

/**
 * A mailbox's last failure, said to the person. The sync keeps the
 * exception's own text, which can carry platform codes; a connection one is
 * said in words, anything else without the platform's nouns.
 */
export function stoppedText(raw: string, provider?: string): string {
  const connector = provider === "outlook" ? "outlook" : provider === "gmail" ? "gmail" : undefined;
  for (const [code] of raw.matchAll(/\b[A-Z][A-Z_]{5,}\b/g)) {
    if (connectionProblem({ code }, connector)) return errorText({ code, message: raw }, connector);
  }
  const text = errorText({ message: raw }, connector);
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}
