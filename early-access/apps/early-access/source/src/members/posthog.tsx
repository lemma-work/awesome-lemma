// PostHog, connected from inside the app with the kit's <Connect>.
//
// PostHog is reached through its own MCP server, so the Lemma's connector is
// the generic MCP one (catalog `mcp`) under the slug `posthog`. The kit names
// a connection after its catalog id and lists every MCP account the person
// has, so this hands <Connect> the same connection with PostHog's name, and
// offers only the person's accounts on an MCP install whose name says
// PostHog. Everything else (sharing as the Lemma's, asking someone who can,
// reconnecting) is the kit's.
//
// Two repairs the kit can't know about, both as the person:
//   - an install binds a bundled MCP connector to the organization's first
//     MCP install, which may be another server's; the platform then refuses
//     to share a PostHog account under it ("on a different installation")
//     and won't move it. An empty, unshared `posthog` on a non-PostHog
//     install is removed just before sharing, so sharing declares it anew.
//   - removing a connector drops the functions' grants on it, and declaring
//     it again doesn't bring them back: once PostHog reads as connected, the
//     four functions that call it get `connector.use` on it again.

import { useEffect, useMemo, useState } from "react";
import { Connect, DEMO, client, orgId, useConnection, type Connection } from "@lemma-plugins/kit";

const USES_POSTHOG = ["early_access_setup_options", "early_access_let_in", "early_access_take_out", "early_access_sweep"];
const pod = () => client.podId as string;

interface PodConnector { installation_name?: string | null; shared_account?: unknown; status?: string }
interface Grant { resource_type: string; resource_name: string; permission_ids: string[] }

/** Remove an empty `posthog` connector bound to another MCP server, so sharing can declare it on PostHog's. */
async function freeTheSlug(): Promise<void> {
  const found = await client.request<PodConnector>("GET", `/pods/${pod()}/connectors/posthog`).catch(() => null);
  if (found && !found.shared_account && !/posthog/i.test(found.installation_name || "")) {
    await client.request("DELETE", `/pods/${pod()}/connectors/posthog`);
  }
}

/** Give back the functions' grant on PostHog when it is missing. Quietly does nothing for someone who can't. */
export async function ensurePostHogGrants(): Promise<number> {
  if (DEMO) return 0;
  let fixed = 0;
  for (const name of USES_POSTHOG) {
    const got = await client.request<{ grants: Grant[] }>("GET", `/pods/${pod()}/functions/${name}/permissions`).catch(() => null);
    if (!got || got.grants.some((g) => g.resource_type === "connector" && g.resource_name === "posthog")) continue;
    const grants = [...got.grants, { resource_type: "connector", resource_name: "posthog", permission_ids: ["connector.use"] }]
      .map(({ resource_type, resource_name, permission_ids }) => ({ resource_type, resource_name, permission_ids }));
    const ok = await client.request("PUT", `/pods/${pod()}/functions/${name}/permissions`, { body: { grants } }).then(() => true, () => false);
    if (ok) fixed += 1;
  }
  return fixed;
}

export const POSTHOG_PURPOSE =
  "Who used the beta, and turning the flag on for the people you let in, through PostHog's MCP server. Needs a key that can write cohorts.";

function usePostHogInstalls(): Set<string> | null {
  const [ids, setIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (DEMO) return;
    let live = true;
    void (async () => {
      const org = await orgId();
      if (!org) return;
      const got = (await client.connectors.authConfigs.list(org, { limit: 100 }).catch(() => null)) as
        | { items?: { id: string; name?: string; connector_id: string }[] } | null;
      const mine = (got?.items || []).filter((a) => a.connector_id === "mcp" && /posthog/i.test(a.name || ""));
      if (live) setIds(new Set(mine.map((a) => a.id)));
    })();
    return () => {
      live = false;
    };
  }, []);
  return ids;
}

/** The PostHog connection, named and narrowed to PostHog's MCP accounts. */
export function usePostHog(): Connection {
  const raw = useConnection({ connector: "mcp", slug: "posthog", mode: "shared", purpose: POSTHOG_PURPOSE });
  const installs = usePostHogInstalls();
  return useMemo(() => {
    let state = raw.state;
    if (state.kind === "use_mine" && installs) {
      const accounts = state.accounts.filter((a) => a.auth_config_id && installs.has(a.auth_config_id));
      state = accounts.length ? { ...state, accounts } : { kind: "ask", why: "install_org", who: [] };
    }
    if (state.kind === "connect" && installs && installs.size === 0) state = { kind: "ask", why: "install_org", who: [] };
    const useMine = async (accountId: string) => {
      await freeTheSlug().catch(() => undefined);
      return raw.useMine(accountId);
    };
    return { ...raw, state, useMine, ready: state.kind === "ready", name: "PostHog", spec: { ...raw.spec, connector: "posthog" } };
  }, [raw, installs]);
}

export function PostHogConnect({ onReady, primary = true }: { onReady?: () => void; primary?: boolean }) {
  const c = usePostHog();
  const ready = () => {
    void ensurePostHogGrants().finally(() => onReady?.());
  };
  return <Connect connection={c} connector="posthog" slug="posthog" mode="shared" purpose={POSTHOG_PURPOSE} onReady={ready} primary={primary} />;
}
