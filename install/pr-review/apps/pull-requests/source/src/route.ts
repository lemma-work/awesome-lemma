// Where the person is, as a readable path the Lemma's frame keeps in its address:
//   /                            the inbox            /all, /merged   the other views
//   /pr/<owner>/<repo>/<n>       a pull request       .../files[/<path>], /rules, /rounds, /activity
//   /settings                    settings             /settings/merging
//   /setup                       first run
// A needs_you item links straight to a pull request with the first form.

import { go, usePath } from "@lemma-plugins/kit";

export type View = "inbox" | "all" | "merged";
export type PrTab = "overview" | "files" | "rules" | "rounds" | "activity";
export const TABS: PrTab[] = ["overview", "files", "rules", "rounds", "activity"];

export type Route =
  | { page: "inbox"; view: View }
  | { page: "pr"; repo: string; number: number; tab: PrTab; path?: string | null }
  | { page: "settings"; sub: "general" | "merging" }
  | { page: "setup" };

export function parse(path: string): Route {
  const parts = path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  const [first] = parts;
  if (first === "pr" && parts.length >= 4) {
    const tab = (TABS as string[]).includes(parts[4]) ? (parts[4] as PrTab) : "overview";
    const file = tab === "files" && parts.length > 5 ? parts.slice(5).join("/") : null;
    return { page: "pr", repo: `${parts[1]}/${parts[2]}`, number: Number(parts[3]) || 0, tab, path: file };
  }
  if (first === "settings") return { page: "settings", sub: parts[1] === "merging" ? "merging" : "general" };
  if (first === "setup") return { page: "setup" };
  if (first === "all") return { page: "inbox", view: "all" };
  if (first === "merged") return { page: "inbox", view: "merged" };
  return { page: "inbox", view: "inbox" };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

export function prPath(repo: string, number: number, tab: PrTab = "overview", file?: string | null): string {
  const at = tab === "files" && file ? `/${file.split("/").map(encodeURIComponent).join("/")}` : "";
  return `/pr/${repo}/${number}${tab === "overview" ? "" : `/${tab}`}${at}`;
}

export const to = {
  inbox: (view: View = "inbox") => go(view === "inbox" ? "/" : `/${view}`),
  pr: (repo: string, number: number, tab: PrTab = "overview", file?: string | null) => go(prPath(repo, number, tab, file)),
  settings: (sub: "general" | "merging" = "general") => go(sub === "merging" ? "/settings/merging" : "/settings"),
  setup: () => go("/setup"),
};
