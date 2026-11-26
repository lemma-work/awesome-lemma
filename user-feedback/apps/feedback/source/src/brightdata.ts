// Bright Data, through the team's own key, adapted from the opinions pod.
//
// Bright Data's Web Scraper API is an OpenAPI connector made from this
// repository's spec (served from GitHub, never from an app host), with the
// team's key as its account. Saving the key pins that account on the
// functions that call Bright Data, so a listening run started by any schedule
// goes through the team's key. A bad key is checked by a function, never in
// the browser: a 401 here would read as the person's own sign-in ending.

import { client, errorText, orgId, runFunction } from "@lemma-plugins/kit";

export const BD_AUTH_CONFIG = "brightdata-api";
export const BD_SPEC_URL = "https://raw.githubusercontent.com/lemma-work/awesome-lemma/main/user-feedback/brightdata/openapi.json";
export const BD_KEYS_URL = "https://brightdata.com/cp/setting/users";
export const BD_FUNCTIONS = ["user_feedback_listen_start", "user_feedback_listen_poll", "user_feedback_brightdata_check"];
export const BD_SOURCES: { id: string; label: string; how: string }[] = [
  { id: "youtube", label: "YouTube", how: "videos and their comments, by your product's phrases" },
  { id: "reddit", label: "Reddit", how: "posts and comments, by your product's phrases" },
  { id: "tiktok", label: "TikTok", how: "videos, by your product's phrases" },
  { id: "x", label: "X", how: "follows each product's own account" },
  { id: "linkedin", label: "LinkedIn", how: "follows each product's own company page" },
];

interface Install { id: string; name: string; status: string }
interface Account { id: string; auth_config_id: string; status: string }
interface Grant { resource_type: string; resource_name: string; permission_ids?: string[] }

function list<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  return ((v as { items?: T[] } | null)?.items) ?? [];
}

/** Check the key, keep it as the organisation's Bright Data account, and pin it
 *  on the functions that listen. Throws words a person can read. */
export async function saveKey(key: string): Promise<string> {
  const org = await orgId();
  if (!org) throw new Error("This page doesn't know your organisation. Open it from your Lemma.");
  const connectors = client.connectors as unknown as {
    authConfigs: { list: (o: string, x: unknown) => Promise<unknown>; create: (o: string, x: unknown) => Promise<unknown> };
    accounts: { create: (o: string, x: unknown) => Promise<unknown>; delete: (o: string, id: string) => Promise<unknown> };
  };
  let install: Install | undefined;
  let account: Account;
  try {
    install = list<Install>(await connectors.authConfigs.list(org, { limit: 100 })).find((c) => c.name === BD_AUTH_CONFIG && c.status === "ACTIVE");
    if (!install) {
      install = (await connectors.authConfigs.create(org, {
        connector_id: "openapi", kind: "http", name: BD_AUTH_CONFIG, config_source: "SYSTEM_DEFAULT", config: { spec_url: BD_SPEC_URL },
      })) as Install;
    }
    account = (await connectors.accounts.create(org, { auth_config_id: install.id, credentials: { api_key: key.trim() } })) as Account;
  } catch (e) {
    throw new Error(errorText(e, "openapi"));
  }
  await attach(account.id);
  const check = await runFunction<{ ok?: boolean; reason?: string }>("user_feedback_brightdata_check", { account_id: account.id });
  if (check.ok === false) {
    try {
      await connectors.accounts.delete(org, account.id);
    } catch (e) {
      void errorText(e);
    }
    throw new Error(check.reason || "Bright Data didn't take that key.");
  }
  return account.id;
}

/** Pin the account on every function that calls Bright Data, keeping each one's other grants. */
async function attach(accountId: string): Promise<void> {
  const fns = client.functions as unknown as { permissions: { get: (n: string) => Promise<unknown>; replace: (n: string, b: unknown) => Promise<unknown> } };
  for (const fn of BD_FUNCTIONS) {
    let grants: Grant[];
    try {
      grants = ((await fns.permissions.get(fn)) as { grants?: Grant[] }).grants ?? [];
    } catch (e) {
      throw new Error(`Couldn't give the listening functions the key: ${errorText(e)}`);
    }
    const keep = grants.filter((g) => g.resource_type !== "connector_account");
    if (!keep.some((g) => g.resource_type === "connector" && g.resource_name === "openapi")) {
      keep.push({ resource_type: "connector", resource_name: "openapi", permission_ids: ["connector.use"] });
    }
    keep.push({ resource_type: "connector_account", resource_name: accountId, permission_ids: ["connector_account.use"] });
    try {
      await fns.permissions.replace(fn, { grants: keep });
    } catch (e) {
      throw new Error(`Couldn't give the listening functions the key: ${errorText(e)}`);
    }
  }
}

/** About how many records a day of listening is: each source, each product, the posts asked for. */
export function recordsPerRun(products: number, sources: string[], posts: number): number {
  const keyword = sources.filter((s) => s === "youtube" || s === "reddit" || s === "tiktok").length;
  const follow = sources.filter((s) => s === "x" || s === "linkedin").length;
  return products * (keyword * posts * 3 + follow * posts);
}
