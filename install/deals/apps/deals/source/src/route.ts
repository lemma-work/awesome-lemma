// Where the person is, as a readable path the Lemma's frame keeps in its
// address: / (the board), /table, /waiting (changes waiting for them),
// /review (the weekly review), /settings, /<deal id>.

import { go, usePath } from "@lemma-plugins/kit";

export type Route =
  | { page: "board" }
  | { page: "table" }
  | { page: "waiting" }
  | { page: "review" }
  | { page: "settings" }
  | { page: "deal"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parse(path: string): Route {
  const [first] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (!first) return { page: "board" };
  if (first === "table" || first === "waiting" || first === "review" || first === "settings") return { page: first };
  if (UUID.test(first)) return { page: "deal", id: first };
  return { page: "board" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  board: () => go("/"),
  table: () => go("/table"),
  waiting: () => go("/waiting"),
  review: () => go("/review"),
  settings: () => go("/settings"),
  deal: (id: string) => go(`/${encodeURIComponent(id)}`),
};
