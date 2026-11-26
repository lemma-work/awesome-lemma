// Where the person is, as a readable path the Lemma's frame keeps in its
// address. An app's path can't carry a query string (the SDK refuses `?`), so
// a study's segment and the invites drawer are parts of the path.
//   /                          studies              /new           a new study
//   /s/<id>                    a study (its people) /s/<id>/<segment>  invite, invited, booked, done, resting
//   /s/<id>/invites            the invites to send  /s/<id>/edit   its question and who fits
//   /s/<id>/findings[/<feature>]  what its calls found
//   /s/<id>/p/<person>         one call             /setup         set-up

import { go, usePath } from "@lemma-plugins/kit";

export type Segment = "all" | "invite" | "invited" | "booked" | "done" | "resting";
export const SEGMENTS: Segment[] = ["all", "invite", "invited", "booked", "done", "resting"];

export type Route =
  | { page: "studies" }
  | { page: "new" }
  | { page: "edit"; id: string }
  | { page: "study"; id: string; show: Segment; invites: boolean }
  | { page: "findings"; id: string; feature: string | null }
  | { page: "call"; id: string; person: string }
  | { page: "setup" };

export function parse(full: string): Route {
  const path = full.split("?")[0];
  const [a, b, c, d] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (a === "new") return { page: "new" };
  if (a === "setup") return { page: "setup" };
  if (a === "s" && b) {
    if (c === "edit") return { page: "edit", id: b };
    if (c === "findings") return { page: "findings", id: b, feature: d || null };
    if (c === "p" && d) return { page: "call", id: b, person: d };
    if (c === "invites") return { page: "study", id: b, show: "invite", invites: true };
    const show: Segment = (SEGMENTS as string[]).includes(c || "") ? (c as Segment) : "all";
    return { page: "study", id: b, show, invites: false };
  }
  return { page: "studies" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export const to = {
  studies: () => go("/"),
  new: () => go("/new"),
  edit: (id: string) => go(`/s/${id}/edit`),
  study: (id: string, show: Segment = "all") => go(`/s/${id}${show === "all" ? "" : `/${show}`}`),
  invites: (id: string) => go(`/s/${id}/invites`),
  findings: (id: string, feature?: string | null) => go(`/s/${id}/findings${feature ? `/${feature}` : ""}`),
  call: (id: string, person: string) => go(`/s/${id}/p/${person}`),
  setup: () => go("/setup"),
};
