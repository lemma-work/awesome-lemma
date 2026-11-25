// Where the person is, as a readable path the Lemma's frame keeps in its
// address:
//   /                      the board
//   /t/<task>              the board with a task's record open (Activity)
//   /t/<task>/transcript   … its transcript        /t/<task>/changes   … its change
//   /new                   New task                 /new/q/<question>   New task from an answer
//   /new/t/<task>          New task for a task on the board (Hand over, Fix it)
//   /ask, /ask/<question>  Ask about the code
//   /setup                 set-up
//
// The tab is a path segment, not `?tab=`: an app's path carries no query.

import { go, usePath } from "@lemma-plugins/kit";

export type Tab = "activity" | "transcript" | "changes";
export type Route =
  | { page: "board"; task: string | null; tab: Tab }
  | { page: "new"; question?: string; task?: string }
  | { page: "ask"; question: string | null }
  | { page: "setup" };

export function parse(path: string): Route {
  const [first, second, third] = path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "setup") return { page: "setup" };
  if (first === "new") return { page: "new", question: second === "q" ? third : undefined, task: second === "t" ? third : undefined };
  if (first === "ask") return { page: "ask", question: second || null };
  if (first === "t" && second) return { page: "board", task: second, tab: third === "transcript" || third === "changes" ? third : "activity" };
  return { page: "board", task: null, tab: "activity" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

const enc = encodeURIComponent;
export const to = {
  board: () => go("/"),
  task: (id: string, tab: Tab = "activity") => go(`/t/${enc(id)}${tab === "activity" ? "" : `/${tab}`}`),
  newTask: (from?: { question?: string; task?: string }) =>
    go(from?.question ? `/new/q/${enc(from.question)}` : from?.task ? `/new/t/${enc(from.task)}` : "/new"),
  ask: (id?: string | null) => go(id ? `/ask/${enc(id)}` : "/ask"),
  setup: () => go("/setup"),
};
