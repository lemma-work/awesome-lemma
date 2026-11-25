// Where the person is, as a readable path the Lemma's frame keeps in its
// address:
//   /            your own list            /board            the same, as a board
//   /assigned    team tasks on you        /agents           everything with an agent
//   /promises    promises you made        /p/<id>[/board]   a team project
//   /settings                             /t/<task id>      a task

import { go, usePath } from "@lemma-plugins/kit";

export type ListPage = "mine" | "assigned" | "agents" | "project";
export type Route =
  | { page: ListPage; board: boolean; projectId?: string }
  | { page: "promises" }
  | { page: "settings" }
  | { page: "task"; id: string };

export function parse(path: string): Route {
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = parts;
  if (!first) return { page: "mine", board: false };
  if (first === "board") return { page: "mine", board: true };
  if (first === "assigned") return { page: "assigned", board: second === "board" };
  if (first === "agents") return { page: "agents", board: second === "board" };
  if (first === "promises") return { page: "promises" };
  if (first === "settings") return { page: "settings" };
  if (first === "p" && second) return { page: "project", projectId: second, board: third === "board" };
  if (first === "t" && second) return { page: "task", id: second };
  return { page: "mine", board: false };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export function listPath(page: ListPage, board: boolean, projectId?: string): string {
  const base = page === "mine" ? "" : page === "project" ? `/p/${encodeURIComponent(projectId || "")}` : `/${page}`;
  return (board ? `${base}/board` : base) || "/";
}

export const to = {
  list: (page: ListPage, board = false, projectId?: string) => go(listPath(page, board, projectId)),
  promises: () => go("/promises"),
  settings: () => go("/settings"),
  task: (id: string) => go(`/t/${encodeURIComponent(id)}`),
};

/** Where Back goes from a task: the list the person came from. */
let lastList = "/";
export function rememberList(path: string) {
  lastList = path;
}
export function backToList() {
  go(lastList);
}
