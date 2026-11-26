// Where the person is, as a readable path the Lemma's frame keeps in its
// address:
//   /                 Answers, the home tab      /q/<id>   one question open
//   /library          Library                    /library/<topic slug>
//   /library/mine     your pages past their check date (Today links here)
//   /p/<id>           a page (a procedure opens as its Playbook)
//   /p/<id>/walk      walk a procedure here, one step at a time
//   /setup            the team's set-up          /me       your own set-up
//   (no query strings: the Lemma's frame keeps only a plain path)

import { go, usePath } from "@lemma-plugins/kit";

export type Route =
  | { page: "answers"; id: string | null }
  | { page: "library"; topic: string | null; mine: boolean }
  | { page: "page"; id: string; walk: boolean }
  | { page: "setup"; step: string | null }
  | { page: "me" };

export function parse(path: string): Route {
  const [bare] = path.split("?");
  const [first, second, third] = bare.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "setup") return { page: "setup", step: second || null };
  if (first === "me") return { page: "me" };
  if (first === "library") return { page: "library", topic: second && second !== "mine" ? second : null, mine: second === "mine" };
  if (first === "p" && second) return { page: "page", id: second, walk: third === "walk" };
  if (first === "q" && second) return { page: "answers", id: second };
  return { page: "answers", id: null };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  answers: (id?: string | null) => go(id ? `/q/${id}` : "/"),
  library: (topic?: string | null) => go(`/library${topic ? `/${topic}` : ""}`),
  page: (id: string) => go(`/p/${id}`),
  walk: (id: string) => go(`/p/${id}/walk`),
  setup: (step?: string) => go(step ? `/setup/${step}` : "/setup"),
  me: () => go("/me"),
};

/** True while the person is typing, so single-letter keys stay letters. */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof Element && !!t.closest("input, textarea, select, [contenteditable='true']");
}
