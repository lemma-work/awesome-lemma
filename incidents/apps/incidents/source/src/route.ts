// Where the person is, as a readable path the Lemma's frame keeps in its
// address:
//   /             active incidents      /followups    follow-ups     /resolved     past incidents
//   /i/<n>        an incident
//   /i/<n>/writeup  its write-up        /setup        set-up (and settings)

import { go, usePath } from "@lemma-plugins/kit";

export type View = "active" | "followups" | "resolved";
export type Route =
  | { page: "list"; view: View }
  | { page: "incident"; number: number; tab: "overview" | "writeup" }
  | { page: "setup" };

export function parse(path: string): Route {
  const [first, second, third] = path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "setup") return { page: "setup" };
  if (first === "followups" || first === "resolved") return { page: "list", view: first };
  if (first === "i" && second && /^\d+$/.test(second)) return { page: "incident", number: Number(second), tab: third === "writeup" ? "writeup" : "overview" };
  return { page: "list", view: "active" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  list: (view: View = "active") => go(view === "active" ? "/" : `/${view}`),
  incident: (n: number) => go(`/i/${n}`),
  writeup: (n: number) => go(`/i/${n}/writeup`),
  setup: () => go("/setup"),
};
