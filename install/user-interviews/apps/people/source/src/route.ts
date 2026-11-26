// Where the person is, as a readable path the Lemma's frame keeps in its
// address: / (everyone), /waiting, /owed, /quiet, /meeting, /unsure, /team,
// /settings, /<person id>, /team/<address> (someone only the team knows).

import { go, usePath } from "@lemma-plugins/kit";
import { isUuid } from "./marks";

export const FILTERS = ["all", "waiting", "owed", "quiet", "meeting"] as const;
export type Filter = (typeof FILTERS)[number];

export type Route =
  | { page: "list"; filter: Filter }
  | { page: "unsure" }
  | { page: "team" }
  | { page: "settings" }
  | { page: "person"; id: string }
  | { page: "teamPerson"; handle: string };

export function parse(path: string): Route {
  const [first, second] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (!first) return { page: "list", filter: "all" };
  if ((FILTERS as readonly string[]).includes(first)) return { page: "list", filter: first as Filter };
  if (first === "unsure") return { page: "unsure" };
  if (first === "settings") return { page: "settings" };
  if (first === "team") return second ? { page: "teamPerson", handle: second.toLowerCase() } : { page: "team" };
  if (isUuid(first)) return { page: "person", id: first };
  return { page: "list", filter: "all" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  list: (filter: Filter = "all") => go(filter === "all" ? "/" : `/${filter}`),
  unsure: () => go("/unsure"),
  team: () => go("/team"),
  settings: () => go("/settings"),
  person: (id: string) => go(`/${encodeURIComponent(id)}`),
  teamPerson: (handle: string) => go(`/team/${encodeURIComponent(handle)}`),
};
