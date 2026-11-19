// Where the person is, as a readable path the Lemma's frame keeps in its
// address:
//   /                 every deck            /mine          decks you made
//   /approve          outlines to approve   /settings
//   /d/<id>           a deck (its outline, or its cards and the Ask panel)
//   /d/<id>/ask/<job> a deck, with an edit that needs you to pick cards
//   /d/<id>/present[/<n>]  presenting it (from card n)   /d/<id>/print  print or save as PDF
// (An app's path takes no query string: everything is a path segment.)

import { go, usePath } from "@lemma-plugins/kit";

export type ListPage = "all" | "mine" | "approve";
export type Route =
  | { page: ListPage }
  | { page: "settings" }
  | { page: "deck"; id: string; ask?: string }
  | { page: "present"; id: string; at?: number }
  | { page: "print"; id: string };

export function parse(path: string): Route {
  const [first, second, third, fourth] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "mine") return { page: "mine" };
  if (first === "approve") return { page: "approve" };
  if (first === "settings") return { page: "settings" };
  if (first === "d" && second) {
    if (third === "present") return { page: "present", id: second, at: Number(fourth || 0) || undefined };
    if (third === "print") return { page: "print", id: second };
    return { page: "deck", id: second, ask: third === "ask" ? fourth : undefined };
  }
  return { page: "all" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  list: (page: ListPage = "all") => go(page === "all" ? "/" : `/${page}`),
  settings: () => go("/settings"),
  deck: (id: string) => go(`/d/${encodeURIComponent(id)}`),
  present: (id: string, at?: number) => go(`/d/${encodeURIComponent(id)}/present${at ? `/${at}` : ""}`),
  print: (id: string) => go(`/d/${encodeURIComponent(id)}/print`),
};

let lastList = "/";
export function rememberList(path: string) {
  lastList = path;
}
export function backToList() {
  go(lastList);
}
