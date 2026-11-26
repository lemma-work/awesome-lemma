// Where the person is, as a readable path the Lemma's frame keeps in its
// address. An app's path can't carry a query string (the SDK refuses `?`),
// so a person's drawer is /p/<tester> rather than /?p=<tester>.
//   /                   the roster of the newest open beta
//   /b/<beta>           the roster of one beta
//   /b/<beta>/next      the next batch (the sheet)
//   /b/<beta>/settings  the beta's settings, and Turn on
//   /p/<tester>         the roster with one person's drawer open
//   /setup              a new beta

import { go, usePath } from "@lemma-plugins/kit";

export type Route =
  | { page: "roster"; beta?: string; person?: string }
  | { page: "next"; beta: string }
  | { page: "settings"; beta: string }
  | { page: "setup" };

export function parse(path: string): Route {
  const [first, second, third] = path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "setup") return { page: "setup" };
  if (first === "p" && second) return { page: "roster", person: second };
  if (first === "b" && second && third === "next") return { page: "next", beta: second };
  if (first === "b" && second && third === "settings") return { page: "settings", beta: second };
  if (first === "b" && second) return { page: "roster", beta: second };
  return { page: "roster" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  roster: (beta?: string) => go(beta ? `/b/${encodeURIComponent(beta)}` : "/"),
  person: (id: string) => go(`/p/${encodeURIComponent(id)}`),
  next: (beta: string) => go(`/b/${encodeURIComponent(beta)}/next`),
  settings: (beta: string) => go(`/b/${encodeURIComponent(beta)}/settings`),
  setup: () => go("/setup"),
};
