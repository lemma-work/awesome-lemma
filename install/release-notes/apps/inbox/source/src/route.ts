// Where the person is, as a readable path the Lemma's frame keeps in its
// address: /needs, /inbox/<conversation id>, /promises, /settings.
//
// The kit's usePath follows the host: framed, the Lemma's address; on its
// own, the page's.

import { go, usePath } from "@lemma-plugins/kit";

export const VIEWS = ["needs", "inbox", "waiting", "unsure", "snoozed", "aside", "done", "sorting"] as const;
export type View = (typeof VIEWS)[number];
export type Route =
  | { page: "list"; view: View; id?: string }
  | { page: "promises" }
  | { page: "settings"; tab?: string };

export function parse(path: string): Route {
  const [first, second] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "promises") return { page: "promises" };
  if (first === "settings") return { page: "settings", tab: second };
  const view = (VIEWS as readonly string[]).includes(first) ? (first as View) : "needs";
  return { page: "list", view, id: second };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  list: (view: View = "needs", id?: string) => go(`/${view}${id ? `/${encodeURIComponent(id)}` : ""}`),
  promises: () => go("/promises"),
  settings: (tab?: string) => go(`/settings${tab ? `/${tab}` : ""}`),
};
