// Where the person is, as a readable path the Lemma's frame keeps in its address:
//   /             the open note (the draft desk)    /asked         who asked
//   /asked/<id>   one person who asked              /published     published notes
//   /n/<id>       a published note, read only       /settings      settings
//   /setup        first run

import { go, usePath } from "@lemma-plugins/kit";

export type Route =
  | { page: "desk" }
  | { page: "asked"; askId: string | null }
  | { page: "published" }
  | { page: "note"; id: string }
  | { page: "settings" }
  | { page: "setup" };

export function parse(path: string): Route {
  const [first, second] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "asked") return { page: "asked", askId: second || null };
  if (first === "published") return { page: "published" };
  if (first === "n" && second) return { page: "note", id: second };
  if (first === "settings") return { page: "settings" };
  if (first === "setup") return { page: "setup" };
  return { page: "desk" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  desk: () => go("/"),
  asked: (id?: string | null) => go(id ? `/asked/${id}` : "/asked"),
  published: () => go("/published"),
  note: (id: string) => go(`/n/${id}`),
  settings: () => go("/settings"),
  setup: () => go("/setup"),
};
