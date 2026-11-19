// One Lemma client for the page.
//
// No arguments: the pod, the API and the sign-in address come from the
// `window.__LEMMA_CONFIG__` the app's host writes into the page it serves, so
// the same build runs in any Lemma. `VITE_LEMMA_*` is only the `vite dev`
// fallback. A demo build (demo.ts) answers the client in the page instead.

import { LemmaClient } from "lemma-sdk";
import { DEMO, startDemo, wireDemo } from "./demo";

export const client = DEMO ? new LemmaClient(startDemo()) : new LemmaClient();
if (DEMO) wireDemo(client);

/** True when the page knows which Lemma it belongs to. */
export function hasLemmaConfig(): boolean {
  if (DEMO) return true;
  if (typeof window === "undefined") return false;
  const injected = (window as unknown as { __LEMMA_CONFIG__?: { podId?: unknown } }).__LEMMA_CONFIG__;
  if (injected && typeof injected.podId === "string" && injected.podId) return true;
  return Boolean(import.meta.env?.VITE_LEMMA_POD_ID);
}

export interface Me {
  id: string;
  email: string | null;
  name: string | null;
}

let me: Promise<Me | null> | null = null;

/** Who is signed in, read once per page. */
export function whoAmI(): Promise<Me | null> {
  if (!me) {
    me = client.users
      .current()
      .then((user) => {
        const u = user as unknown as { id?: string; email?: string | null; name?: string | null; full_name?: string | null; display_name?: string | null };
        return u?.id ? { id: u.id, email: u.email ?? null, name: u.name ?? u.full_name ?? u.display_name ?? null } : null;
      })
      .catch(() => null);
  }
  return me;
}

/** The organisation this Lemma belongs to, for connecting accounts. */
let org: Promise<string | null> | null = null;
export function orgId(): Promise<string | null> {
  if (!org) {
    const podId = client.podId;
    org = podId
      ? client.pods
          .get(podId)
          .then((pod) => (pod as unknown as { organization_id?: string }).organization_id ?? null)
          .catch(() => null)
      : Promise.resolve(null);
  }
  return org;
}
