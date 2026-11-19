// Where the person is, as a readable path the Lemma's frame keeps in its
// address: / (new and worth a look), /all (everyone looked up), /line (in line
// for a look-up), /skipped, /settings, /<person id> (a lead).

import { go, usePath } from "@lemma-plugins/kit";

export const FILTERS = ["new", "all", "line", "skipped"] as const;
export type Filter = (typeof FILTERS)[number];

export type Route = { page: "list"; filter: Filter } | { page: "settings" } | { page: "lead"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parse(path: string): Route {
  const [first] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (!first) return { page: "list", filter: "new" };
  if ((FILTERS as readonly string[]).includes(first)) return { page: "list", filter: first as Filter };
  if (first === "settings") return { page: "settings" };
  if (UUID.test(first)) return { page: "lead", id: first };
  return { page: "list", filter: "new" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  list: (filter: Filter = "new") => go(filter === "new" ? "/" : `/${filter}`),
  settings: () => go("/settings"),
  lead: (id: string) => go(`/${encodeURIComponent(id)}`),
};
