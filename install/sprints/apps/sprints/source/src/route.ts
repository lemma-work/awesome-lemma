// Where the person is, as a readable path the Lemma's frame keeps in its
// address:
//   /          the running sprint          /plan     the sprint being planned
//   /close     closing the running sprint  /s        past sprints
//   /s/<n>     a past sprint, as it closed /setup    set-up (and settings)

import { go, usePath } from "@lemma-plugins/kit";

export type Route =
  | { page: "run" }
  | { page: "plan" }
  | { page: "close" }
  | { page: "past" }
  | { page: "sprint"; number: number }
  | { page: "setup" };

export function parse(path: string): Route {
  const [first, second] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "plan") return { page: "plan" };
  if (first === "close") return { page: "close" };
  if (first === "setup") return { page: "setup" };
  if (first === "s" && second && /^\d+$/.test(second)) return { page: "sprint", number: Number(second) };
  if (first === "s") return { page: "past" };
  return { page: "run" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  run: () => go("/"),
  plan: () => go("/plan"),
  close: () => go("/close"),
  past: () => go("/s"),
  sprint: (n: number) => go(`/s/${n}`),
  setup: () => go("/setup"),
};
