// One Lemma client for the page.
//
// No arguments: the pod, the API and the sign-in address come from the
// `window.__LEMMA_CONFIG__` the app's host writes into the page it serves, so
// the same build runs in any Lemma. `VITE_LEMMA_*` is only the `vite dev`
// fallback. A demo build (demo.ts) answers the client in the page instead.
import { LemmaClient } from "lemma-sdk";
import { DEMO, startDemo, wireDemo } from "./demo";
export const client = DEMO ? new LemmaClient(startDemo()) : new LemmaClient();
if (DEMO)
    wireDemo(client);
/** True when the page knows which Lemma it belongs to. */
export function hasLemmaConfig() {
    if (DEMO)
        return true;
    if (typeof window === "undefined")
        return false;
    const injected = window.__LEMMA_CONFIG__;
    if (injected && typeof injected.podId === "string" && injected.podId)
        return true;
    return Boolean(import.meta.env?.VITE_LEMMA_POD_ID);
}
let me = null;
/** Who is signed in, read once per page. */
export function whoAmI() {
    if (!me) {
        me = client.users
            .current()
            .then((user) => {
            const u = user;
            return u?.id ? { id: u.id, email: u.email ?? null, name: u.name ?? u.full_name ?? u.display_name ?? null } : null;
        })
            .catch(() => null);
    }
    return me;
}
/** The organisation this Lemma belongs to, for connecting accounts. */
let org = null;
export function orgId() {
    if (!org) {
        const podId = client.podId;
        org = podId
            ? client.pods
                .get(podId)
                .then((pod) => pod.organization_id ?? null)
                .catch(() => null)
            : Promise.resolve(null);
    }
    return org;
}
