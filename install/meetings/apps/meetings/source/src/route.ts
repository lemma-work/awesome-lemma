// Where the person is, as a readable path the Lemma's frame keeps in its
// address: / (this week), /week/+1, /after, /unsure, /promised, /settings,
// /<meeting id>.

import { go, usePath } from "@lemma-plugins/kit";

export type Route =
  | { page: "week"; offset: number }
  | { page: "after" }
  | { page: "unsure" }
  | { page: "promised" }
  | { page: "settings" }
  | { page: "meeting"; id: string };

export function parse(path: string): Route {
  const [first, second] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (!first) return { page: "week", offset: 0 };
  if (first === "week") return { page: "week", offset: Math.max(-5, Math.min(3, Number(second) || 0)) };
  if (first === "after") return { page: "after" };
  if (first === "unsure") return { page: "unsure" };
  if (first === "promised") return { page: "promised" };
  if (first === "settings") return { page: "settings" };
  return { page: "meeting", id: first };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  week: (offset = 0) => go(offset ? `/week/${offset > 0 ? "+" : ""}${offset}` : "/"),
  after: () => go("/after"),
  unsure: () => go("/unsure"),
  promised: () => go("/promised"),
  settings: () => go("/settings"),
  meeting: (id: string) => go(`/${encodeURIComponent(id)}`),
};
