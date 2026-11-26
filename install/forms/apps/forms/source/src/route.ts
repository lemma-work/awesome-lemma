// Where the person is, as a readable path the Lemma's frame keeps in its
// address:
//   /             Answers (waiting)    /unsure /done /aside /all   its segments
//   /a/<id>       one answer           /doors          every door
//   /doors/<id>   a door's panel       /routing        who gets what
//   /setup        set-up

import { go, usePath } from "@lemma-plugins/kit";
import type { Segment } from "./data";

export type Route =
  | { page: "answers"; seg: Segment }
  | { page: "answer"; id: string }
  | { page: "doors"; door: string | null }
  | { page: "routing" }
  | { page: "setup" };

const SEGS: Segment[] = ["waiting", "unsure", "done", "aside", "all"];

export function parse(path: string): Route {
  const [first, second] = path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "setup") return { page: "setup" };
  if (first === "routing") return { page: "routing" };
  if (first === "doors") return { page: "doors", door: second || null };
  if (first === "a" && second) return { page: "answer", id: second };
  if (first && (SEGS as string[]).includes(first)) return { page: "answers", seg: first as Segment };
  return { page: "answers", seg: "waiting" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  answers: (seg: Segment = "waiting") => go(seg === "waiting" ? "/" : `/${seg}`),
  answer: (id: string) => go(`/a/${id}`),
  doors: (door?: string | null) => go(door ? `/doors/${door}` : "/doors"),
  routing: () => go("/routing"),
  setup: () => go("/setup"),
};
