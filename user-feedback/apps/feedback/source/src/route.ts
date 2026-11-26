// Where the person is, as a readable path the Lemma's frame keeps in its address:
//   /            the inbox, To file          /mine        From your mail and meetings
//   /unfiled     kept, no feature            /aside       set aside
//   /features    the feature list            /f/<id>      one feature
//   /week        this week                   /week/<n>    n weeks back
//   /settings    the team's set-up and your own
//   /setup       first run
// App paths carry no query strings (the SDK refuses them), so a quote's id
// rides as the last segment: /q/<id>, /mine/<id>.

import { go, usePath } from "@lemma-plugins/kit";

export type Tab = "file" | "mine" | "unfiled" | "aside";
export type Route =
  | { page: "inbox"; tab: Tab; id: string | null }
  | { page: "features"; id: string | null }
  | { page: "week"; back: number }
  | { page: "settings" }
  | { page: "setup" };

const TABS: Record<string, Tab> = { q: "file", mine: "mine", unfiled: "unfiled", aside: "aside" };

export function parse(path: string): Route {
  const [first, second] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "features") return { page: "features", id: null };
  if (first === "f" && second) return { page: "features", id: second };
  if (first === "week") return { page: "week", back: Math.max(0, Number(second) || 0) };
  if (first === "settings") return { page: "settings" };
  if (first === "setup") return { page: "setup" };
  if (first && TABS[first]) return { page: "inbox", tab: TABS[first], id: second || null };
  return { page: "inbox", tab: "file", id: null };
}

export function useRoute(): Route {
  const [path] = usePath();
  return parse(path);
}

const SEG: Record<Tab, string> = { file: "q", mine: "mine", unfiled: "unfiled", aside: "aside" };

export const to = {
  inbox: (tab: Tab = "file", id?: string | null) => go(tab === "file" && !id ? "/" : `/${SEG[tab]}${id ? `/${id}` : ""}`),
  features: () => go("/features"),
  feature: (id: string) => go(`/f/${id}`),
  week: (back = 0) => go(back ? `/week/${back}` : "/week"),
  settings: () => go("/settings"),
  setup: () => go("/setup"),
};
