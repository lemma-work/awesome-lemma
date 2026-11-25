// Where the person is, as a readable path the Lemma's frame keeps:
//   /          the week: what joins Monday, what waits for you, security
//   /u/<id>    one update, as a sheet over the week
//   /b/<id>    one pull request the Lemma opened, and how it was checked
//   /rules     rules in words, ignores, the wait and the schedule
//   /setup     set-up (and settings)

import { go, usePath } from "@lemma-plugins/kit";

export type Route =
  | { page: "week"; update?: string }
  | { page: "batch"; id: string }
  | { page: "rules" }
  | { page: "setup" };

export function parse(path: string): Route {
  const [first, second] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "u" && second) return { page: "week", update: second };
  if (first === "b" && second) return { page: "batch", id: second };
  if (first === "rules") return { page: "rules" };
  if (first === "setup") return { page: "setup" };
  return { page: "week" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  week: () => go("/"),
  update: (id: string) => go(`/u/${id}`),
  batch: (id: string) => go(`/b/${id}`),
  rules: () => go("/rules"),
  setup: () => go("/setup"),
};
