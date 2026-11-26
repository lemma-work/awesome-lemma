// Where the person is, as a readable path the Lemma's frame keeps in its
// address. An app's path can't carry a query string (the SDK refuses `?`),
// so the board is /board rather than /?view=board.
//   /            the features ranked by who asked (A)
//   /board       the same rows as now / next / later (B)
//   /f/<id>      a feature, its spec and its quotes (C)
//   /q/<id>      one quote and where it was said (a spec's footnotes land here)
//   /setup       set-up, and later Settings

import { go, usePath } from "@lemma-plugins/kit";

export type Route =
  | { page: "ranked" }
  | { page: "board" }
  | { page: "feature"; id: string }
  | { page: "quote"; id: string }
  | { page: "setup" };

export function parse(path: string): Route {
  const [first, second] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "board") return { page: "board" };
  if (first === "setup" || first === "settings") return { page: "setup" };
  if (first === "f" && second) return { page: "feature", id: second };
  if (first === "q" && second) return { page: "quote", id: second };
  return { page: "ranked" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  ranked: () => go("/"),
  board: () => go("/board"),
  feature: (id: string) => go(`/f/${encodeURIComponent(id)}`),
  quote: (id: string) => go(`/q/${encodeURIComponent(id)}`),
  setup: () => go("/setup"),
};
