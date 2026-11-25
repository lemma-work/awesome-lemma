// Where the person is, as a readable path the Lemma's frame keeps in its
// address:
//   /            the inbox        /accepted   accepted and done
//   /down        marked down      /declined   declined and duplicates
//   /i/<n>       an item (T-<n>)  /doors      where reports come from
//   /owners      rules, rotation and who's away
//   /setup       set-up

import { go, usePath } from "@lemma-plugins/kit";

export type View = "inbox" | "accepted" | "down" | "declined";
export type Route =
  | { page: "list"; view: View }
  | { page: "item"; number: number }
  | { page: "doors" }
  | { page: "owners" }
  | { page: "setup" };

export function parse(path: string): Route {
  const [first, second] = path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "setup") return { page: "setup" };
  if (first === "doors") return { page: "doors" };
  if (first === "owners") return { page: "owners" };
  if (first === "accepted" || first === "down" || first === "declined") return { page: "list", view: first };
  if (first === "i" && second && /^\d+$/.test(second)) return { page: "item", number: Number(second) };
  return { page: "list", view: "inbox" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  list: (view: View = "inbox") => go(view === "inbox" ? "/" : `/${view}`),
  item: (n: number) => go(`/i/${n}`),
  doors: () => go("/doors"),
  owners: () => go("/owners"),
  setup: () => go("/setup"),
};
