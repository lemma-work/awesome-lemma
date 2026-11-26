// Connecting an account, from inside the app.
//
// Every plugin sets up its own connections: nobody is sent to the Lemma's
// connector pages and told to come back. `useConnection` works out where one
// connector stands for the person looking, and `<Connect>` shows the one thing
// to do about it, in plain words:
//
//   ready            nothing, or "Connected as X · Change"
//   connect          per member, or shared with no account of mine: sign in in
//                    a new tab; back here, a shared one is shared at once
//   use_mine         shared, and I have an account: share it in one step
//   install          GitHub signed in, but the Lemma's GitHub App is on no
//                    repository: choose them on GitHub
//   choose_install   the App is on several GitHub accounts: pick one
//   pending          a GitHub organization owner has to approve the App
//   reconnect        my sign-in expired
//   ask              I can't fix it (not an editor, the organization lacks the
//                    connector, someone else's shared account expired): ask the
//                    people who can, with a line in their own channel
//   waiting          a sign-in tab is open; this carries on by itself
//   error            the check itself failed; what the server said only in a
//                    details toggle
//
// What the SDK gives (lemma-typescript, connectors.ts): the pod connector and
// its state (`pod.get`), my accounts (`accounts.list`), connect and install
// requests, `pod.accounts.add` + `shareAs` to share mine as the SHARED
// connector, `podPermissions.me` for whether I may, `channels.notify` to ask
// someone who may. A connect request's `return_to` is a path in the Lemma's
// own web app: `/oauth/complete` hands the outcome to the tab that opened it
// and closes, and this page hears the return by looking again.
//
// Platform error text is never shown as it is: `connectionProblem` maps the
// codes to words, and the raw message stays behind a toggle.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bug, CalendarDays, Check, ChevronDown, ExternalLink, Github, LineChart, Mail, MessageCircle, Plug, RefreshCw, Slack, type LucideIcon,
} from "lucide-react";
import { client, orgId, whoAmI } from "./client";
import { DEMO, demoData, demoNote } from "./demo";
import { Button, Pill, Spinner, cx, useToast } from "./ui";

/* ---------- names ---------- */

const NAMES: Record<string, string> = {
  github: "GitHub",
  slack: "Slack",
  sentry: "Sentry",
  posthog: "PostHog",
  resend: "Resend",
  gmail: "Gmail",
  outlook: "Outlook",
  google_calendar: "Google Calendar",
  googlemeet: "Google Meet",
  linear: "Linear",
  notion: "Notion",
};

const ICONS: Record<string, LucideIcon> = {
  github: Github,
  slack: Slack,
  gmail: Mail,
  outlook: Mail,
  resend: Mail,
  sentry: Bug,
  posthog: LineChart,
  google_calendar: CalendarDays,
  googlemeet: CalendarDays,
};

/** A connector's name on screen: `github` -> GitHub. */
export function serviceName(connector: string): string {
  return NAMES[connector] || connector.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/* ---------- types ---------- */

export type ConnectMode = "shared" | "per_member";

export interface ConnectionSpec {
  /** The catalog connector: `github`, `slack`, `gmail`. */
  connector: string;
  /** The pod connector's slug in this plugin's bundle; the connector id when left out. */
  slug?: string;
  /** SHARED: one account the whole Lemma runs as. PER_MEMBER: each person's own. */
  mode: ConnectMode;
  /** One sentence: what it is used for. Said beside Connect, and kept on the connector when it is declared here. */
  purpose?: string;
}

/** One of my accounts, as `connectors.accounts.list` answers. */
export interface ConnectAccount {
  id: string;
  connector_id: string;
  auth_config_id?: string;
  status?: string;
  email?: string | null;
  display_name?: string | null;
  is_default?: boolean;
  install_state?: string;
}

export interface InstallChoice {
  installation_id: string;
  account_login?: string | null;
  account_type?: string | null;
  repository_selection?: string | null;
  manage_url?: string;
}

export interface Helper {
  user_id: string;
  name: string;
}

export type AskWhy =
  | "share" //       a SHARED connector needs an account, and I may not share one here
  | "declare" //     a PER_MEMBER connector this Lemma never declared, and I may not
  | "install_org" // the organization has no install of the connector, and I may not add one
  | "unavailable" // the organization's install is switched off
  | "owner" //       the shared account is someone else's, and it needs them
  | "access"; //     the connector refuses me (or this plugin's parts) its use

export type ConnectionState =
  | { kind: "loading" }
  | { kind: "ready"; as: string | null; mine: boolean; canChange?: boolean; account?: ConnectAccount }
  | { kind: "connect" }
  | { kind: "use_mine"; accounts: ConnectAccount[] }
  | { kind: "install"; account: ConnectAccount }
  | { kind: "choose_install"; account: ConnectAccount; choices: InstallChoice[] }
  | { kind: "pending"; account: ConnectAccount }
  | { kind: "reconnect"; account: ConnectAccount | null }
  | { kind: "ask"; why: AskWhy; who: Helper[]; asked?: string[]; raw?: string }
  | { kind: "waiting"; url: string | null; opened?: boolean }
  | { kind: "in_lemma"; url: string | null; accounts: ConnectAccount[] }
  | { kind: "error"; raw: string };

/* ---------- reading errors ---------- */

interface ErrorLike {
  code?: string;
  statusCode?: number;
  status?: number;
  message?: string;
  details?: Record<string, unknown> | null;
  connectUrl?: string | null;
}

function asError(e: unknown): ErrorLike {
  return (e && typeof e === "object" ? e : { message: String(e) }) as ErrorLike;
}

function rawOf(e: unknown): string {
  const err = asError(e);
  return [err.code, err.message].filter(Boolean).join(": ") || String(e);
}

const notFound = (e: unknown) => {
  const err = asError(e);
  return err.statusCode === 404 || err.status === 404 || err.code === "POD_CONNECTOR_NOT_FOUND";
};

const notInstalled = (e: unknown) => {
  const err = asError(e);
  return err.code === "CONNECTOR_NOT_INSTALLED" || /not installed in this organi[sz]ation/i.test(err.message || "");
};

/** The platform keeps sharing an account a person's own act: an app's page may not do it for them. */
const personOnly = (e: unknown) => asError(e).code === "APP_PERSON_ONLY";

const refused = (e: unknown) => {
  const err = asError(e);
  if (personOnly(e)) return false;
  return err.statusCode === 403 || err.status === 403 || /ACCESS_DENIED|FORBIDDEN|PERMISSION/i.test(err.code || "");
};

/**
 * What a failed connector call means for the person, or null when it is not
 * about a connection. Take this rather than the error's own text, which names
 * slugs and pods.
 */
const CODES = /\b(CONNECTION_REQUIRED|REAUTH_REQUIRED|CONNECTOR_NEEDS_ACCOUNT|POD_CONNECTOR_NOT_FOUND|CONNECTOR_UNAVAILABLE|CONNECTION_REQUIRES_PERSON|CONNECTOR_NOT_INSTALLED|CONNECTOR_ACCESS_DENIED|CONNECTOR_USE_REFUSED)\b/;

export function connectionProblem(e: unknown, connector?: string): { kind: ConnectionState["kind"]; why?: AskWhy; text: string } | null {
  let err = asError(e);
  // A function that caught the SDK's error passes on only its text: find the code in it.
  if (!err.code) {
    const found = CODES.exec(typeof e === "string" ? e : err.message || "");
    if (found) err = { ...err, code: found[1] };
  }
  const name = serviceName(connector || String(err.details?.connector_id || "") || "the service");
  switch (err.code) {
    case "CONNECTION_REQUIRED":
      return { kind: "connect", text: `Connect your ${name} to do this.` };
    case "REAUTH_REQUIRED":
      return err.details?.connect_url || err.connectUrl
        ? { kind: "reconnect", text: `Your ${name} sign-in expired. Reconnect it to carry on.` }
        : { kind: "ask", why: "owner", text: `The shared ${name} account needs its owner to sign in again.` };
    case "CONNECTOR_NEEDS_ACCOUNT":
    case "POD_CONNECTOR_NOT_FOUND":
      return { kind: "connect", text: `${name} isn't connected for this Lemma yet.` };
    case "CONNECTOR_UNAVAILABLE":
      return { kind: "ask", why: "unavailable", text: `${name} is switched off for your organization.` };
    case "CONNECTION_REQUIRES_PERSON":
      return { kind: "connect", text: `This runs with nobody signed in, so it needs ${name} connected for the whole Lemma.` };
    case "CONNECTOR_NOT_INSTALLED":
      return { kind: "ask", why: "install_org", text: `${name} isn't added to your organization yet.` };
  }
  if (err.code && /^CONNECTOR_(ACCESS_DENIED|USE_REFUSED)$/.test(err.code)) {
    return { kind: "ask", why: "access", text: `This plugin isn't allowed to use ${name} yet.` };
  }
  if (notInstalled(e)) return { kind: "ask", why: "install_org", text: `${name} isn't added to your organization yet.` };
  return null;
}

/**
 * A failure said to a person: a connection problem in words (never the
 * platform's text, which names slugs and pods), anything else as its message.
 * Use it wherever a caught error from a connector call reaches the screen.
 */
export function errorText(e: unknown, connector?: string): string {
  const problem = connectionProblem(e, connector);
  if (problem) return problem.text;
  const err = asError(e);
  return (err.message || String(e)).replace(/\bpods?\b/gi, "Lemma");
}

/** Whether a failure is about a connection, which `<Connect error>` can turn into the next step. */
export function isConnectionProblem(e: unknown): boolean {
  return connectionProblem(e) !== null;
}

/* ---------- reading where it stands ---------- */

interface PodConnector {
  status?: string;
  mode?: string;
  can_use?: boolean;
  shared_pod_account_id?: string | null;
  shared_account?: { pod_account_id?: string; owner_user_id?: string; display_name?: string | null; email?: string | null } | null;
}

interface PodAccount {
  id: string;
  account_id: string;
  owner_user_id: string;
  connector_id?: string | null;
}

interface Facts {
  org: string | null;
  me: string | null;
  connector: PodConnector | null;
  declared: boolean;
  accounts: ConnectAccount[];
  podAccounts: PodAccount[];
  canManage: boolean | null;
  orgInstall: "active" | "off" | "none" | null;
  canInstall: boolean | null;
}

const items = <T,>(r: unknown): T[] => {
  if (Array.isArray(r)) return r as T[];
  const list = (r as { items?: T[] } | null)?.items;
  return Array.isArray(list) ? list : [];
};

const connected = (a: ConnectAccount) => !a.status || a.status === "CONNECTED" || a.status === "ACTIVE";
const labelOf = (a: { email?: string | null; display_name?: string | null } | null | undefined) =>
  (a && (a.display_name || a.email)) || null;

async function readFacts(spec: Required<Pick<ConnectionSpec, "connector" | "slug" | "mode">>): Promise<Facts> {
  const org = await orgId();
  const me = (await whoAmI())?.id ?? null;
  const [connector, accounts, podAccounts, perms, installs, orgPerms] = await Promise.all([
    client.connectors.pod.get(spec.slug).then(
      (c) => ({ c: c as unknown as PodConnector, declared: true }),
      (e) => {
        if (notFound(e)) return { c: null, declared: false };
        throw e;
      },
    ),
    org
      ? client.connectors.accounts.list(org, { connectorId: spec.connector, limit: 50 }).then((r) => items<ConnectAccount>(r))
      : Promise.resolve([] as ConnectAccount[]),
    client.connectors.pod.accounts.list().then((r) => items<PodAccount>(r), () => [] as PodAccount[]),
    client.podPermissions.me().then((r) => (r as { actions?: string[] }).actions ?? null, () => null),
    org
      ? client.connectors.authConfigs.list(org, { limit: 100 }).then(
          (r) => items<{ connector_id: string; status?: string }>(r),
          () => null,
        )
      : Promise.resolve(null),
    org ? client.organizations.permissionsMe(org).then((r) => r.actions ?? null, () => null) : Promise.resolve(null),
  ]);
  const mine = installs?.filter((i) => i.connector_id === spec.connector) ?? null;
  return {
    org,
    me,
    connector: connector.c,
    declared: connector.declared,
    accounts: accounts.filter((a) => a.connector_id === spec.connector && a.status !== "DISCONNECTED"),
    podAccounts,
    canManage: perms ? perms.includes("pod.connector.manage") : null,
    orgInstall: mine == null ? null : mine.some((i) => !i.status || i.status === "ACTIVE") ? "active" : mine.length ? "off" : "none",
    canInstall: orgPerms ? orgPerms.includes("org.installation.manage") : null,
  };
}

/** Where a GitHub account stands with the Lemma's GitHub App; null when it can reach repositories, or isn't GitHub. */
function installStep(account: ConnectAccount): ConnectionState | null {
  switch (account.install_state) {
    case "INSTALL_REQUIRED":
      return { kind: "install", account };
    case "CHOOSE_INSTALL":
      return { kind: "choose_install", account, choices: [] };
    case "PENDING_APPROVAL":
      return { kind: "pending", account };
    default:
      return null;
  }
}

function decide(spec: Required<Pick<ConnectionSpec, "connector" | "slug" | "mode">>, f: Facts): ConnectionState {
  const ask = (why: AskWhy): ConnectionState => ({ kind: "ask", why, who: [] });
  const usable = f.accounts.filter(connected);
  const expired = f.accounts.filter((a) => a.status === "REAUTH_REQUIRED");
  const own = usable.find((a) => a.is_default) || usable[0] || null;

  if (f.orgInstall === "off" || f.connector?.status === "UNAVAILABLE") return ask("unavailable");
  // A first connect adds the organization's install, for someone who may.
  const mayConnect = f.orgInstall !== "none" || f.canInstall !== false;

  // The Lemma's own connector says how it runs; what the plugin asked for is
  // only a default until one is declared. Connecting can declare it per member,
  // and an admin can switch it, so trusting the plugin's word strands people
  // on a "share it" step a working connection never needs.
  const declaredMode = f.declared ? f.connector?.mode : undefined;
  if (declaredMode === "APP") {
    // The organization's GitHub App, on the repositories it was given: nobody's account.
    if (f.connector?.status === "READY" && f.connector.can_use !== false) {
      return { kind: "ready", as: "the Lemma's GitHub App", mine: false, canChange: f.canManage === true };
    }
    if (f.connector?.can_use === false) return ask("access");
    return mayConnect ? { kind: "connect" } : ask("install_org");
  }
  const mode: ConnectMode = declaredMode === "PER_MEMBER" ? "per_member" : declaredMode === "SHARED" ? "shared" : spec.mode;

  if (mode === "shared") {
    const shared = f.connector?.status === "READY" ? f.connector.shared_account : null;
    if (shared) {
      const mineShared = !!f.me && shared.owner_user_id === f.me;
      if (mineShared) {
        const podAccount = f.podAccounts.find((p) => p.id === shared.pod_account_id);
        const account = f.accounts.find((a) => a.id === podAccount?.account_id);
        if (account?.status === "REAUTH_REQUIRED") return { kind: "reconnect", account };
        const step = account ? installStep(account) : null;
        if (step) return step;
      }
      if (f.connector?.can_use === false) return ask("access");
      const podAccount = mineShared ? f.podAccounts.find((p) => p.id === shared.pod_account_id) : null;
      const account = podAccount ? f.accounts.find((a) => a.id === podAccount.account_id) : undefined;
      return { kind: "ready", as: labelOf(shared), mine: mineShared, canChange: mineShared || f.canManage === true, account };
    }
    // Sharing is an editor's: the account owner shares, and the connector is pointed at it.
    if (f.canManage === false) return ask("share");
    if (usable.length) return personOnlyPage ? { kind: "in_lemma", url: lemmaConnectionsUrl(spec.slug), accounts: usable } : { kind: "use_mine", accounts: usable };
    // Mine, but signed out: signing in again shares it on the way back.
    if (expired.length) return { kind: "reconnect", account: expired[0] };
    if (!mayConnect) return ask("install_org");
    return { kind: "connect" };
  }

  // per member
  if (!f.declared && f.canManage === false) return ask("declare");
  if (own) {
    const step = installStep(own);
    if (step) return step;
    if (f.declared && f.connector?.can_use === false) return ask("access");
    return { kind: "ready", as: labelOf(own), mine: true, canChange: true, account: own };
  }
  if (expired.length) return { kind: "reconnect", account: expired[0] };
  if (!mayConnect) return ask("install_org");
  return { kind: "connect" };
}

/* ---------- who can help ---------- */

async function helpers(why: AskWhy, f: Facts | null): Promise<Helper[]> {
  const podId = client.podId;
  if (!podId) return [];
  const me = f?.me;
  const members = await client.podMembers.list(podId, { limit: 200 }).then(
    (r) => items<{ user_id: string; user_name?: string | null; user_email?: string; email?: string; roles?: string[] }>(r),
    () => [],
  );
  const name = (m: { user_name?: string | null; user_email?: string; email?: string }) =>
    m.user_name || m.user_email || m.email || "Someone";
  if (why === "owner") {
    const owner = f?.connector?.shared_account?.owner_user_id;
    const m = members.find((x) => x.user_id === owner);
    return m ? [{ user_id: m.user_id, name: name(m) }] : [];
  }
  if (why === "install_org" || why === "unavailable") {
    const org = f?.org;
    if (!org) return [];
    const admins = await client.organizations.members.list(org, { limit: 200 }).then(
      (r) => items<{ user_id: string; role?: string }>(r).filter((m) => m.role === "ORG_OWNER" || m.role === "ORG_EDITOR"),
      () => [],
    );
    const ids = new Set(admins.map((a) => a.user_id));
    return members.filter((m) => ids.has(m.user_id) && m.user_id !== me).map((m) => ({ user_id: m.user_id, name: name(m) }));
  }
  return members
    .filter((m) => m.user_id !== me && (m.roles || []).some((r) => r === "POD_ADMIN" || r === "POD_EDITOR"))
    .map((m) => ({ user_id: m.user_id, name: name(m) }));
}

/* ---------- sharing is the person's own act ---------- */

const PERSON_ONLY_KEY = "lemma-connect:person-only";
let personOnlyPage = (() => {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(PERSON_ONLY_KEY) === "1";
  } catch {
    return false;
  }
})();

function rememberPersonOnly(): void {
  personOnlyPage = true;
  try {
    window.sessionStorage.setItem(PERSON_ONLY_KEY, "1");
  } catch {
    /* Remembered for this page only. */
  }
}

/** The Lemma's own connections page, on this connector: where a person shares their account themselves. */
function lemmaConnectionsUrl(slug: string): string | null {
  const podId = client.podId;
  if (!podId || typeof window === "undefined") return null;
  const origins = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  let origin = origins && origins.length ? origins[origins.length - 1] : "";
  if (!origin && document.referrer) {
    try {
      origin = new URL(document.referrer).origin;
    } catch {
      origin = "";
    }
  }
  if (!origin || origin === window.location.origin) {
    try {
      origin = new URL((client as unknown as { authUrl: string }).authUrl).origin;
    } catch {
      return null;
    }
  }
  return `${origin}/pods/${encodeURIComponent(podId)}/connections?connector=${encodeURIComponent(slug)}`;
}

/* ---------- the round trip ---------- */

/** Where a provider's tab ends: the Lemma's own page that reports back and closes. */
const RETURN_TO = "/oauth/complete";
const ROUND_TRIP_MS = 15 * 60_000;

interface Pending {
  at: number;
  before: string[];
  share: boolean;
  /** Started while already connected ("Connect another"): only a new account ends it. */
  another?: boolean;
}

const pendingKey = (slug: string) => `lemma-connect:${client.podId || "pod"}:${slug}`;

function readPending(slug: string): Pending | null {
  try {
    const raw = window.sessionStorage.getItem(pendingKey(slug));
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    return p && Date.now() - p.at < ROUND_TRIP_MS ? p : null;
  } catch {
    return null;
  }
}

function writePending(slug: string, p: Pending | null): void {
  try {
    if (p) window.sessionStorage.setItem(pendingKey(slug), JSON.stringify(p));
    else window.sessionStorage.removeItem(pendingKey(slug));
  } catch {
    /* Storage refused: the page still looks again while it is open. */
  }
}

/** A tab opened inside the click, so no pop-up blocker takes it; pointed at the provider once the link is minted. */
function holdTab(name: string): Window | null {
  const tab = window.open("", "_blank");
  if (!tab) return null;
  try {
    tab.document.title = `Connecting ${name}…`;
    tab.document.body.style.cssText = "font:14px Inter,system-ui,sans-serif;color:#555;display:grid;place-items:center;height:100vh;margin:0";
    tab.document.body.textContent = `Opening ${name}…`;
  } catch {
    /* A tab we may not write to still goes where it is sent. */
  }
  return tab;
}

/* ---------- demo ---------- */

interface DemoConnection {
  state?: ConnectionState["kind"];
  as?: string;
  why?: AskWhy;
  who?: string[];
  accounts?: string[];
}

function demoState(spec: { connector: string; slug: string }): ConnectionState {
  const all = (demoData() as unknown as { connections?: Record<string, DemoConnection> }).connections || {};
  const given = all[spec.slug] || all[spec.connector] || {};
  const name = serviceName(spec.connector);
  const fake = (label: string, i = 0): ConnectAccount => ({ id: `demo-${spec.slug}-${i}`, connector_id: spec.connector, display_name: label, status: "CONNECTED" });
  switch (given.state) {
    case "connect":
      return { kind: "connect" };
    case "use_mine":
      return { kind: "use_mine", accounts: (given.accounts || [given.as || `sample-${spec.connector}`]).map(fake) };
    case "in_lemma":
      return { kind: "in_lemma", url: "#", accounts: [fake(given.as || "sample")] };
    case "install":
      return { kind: "install", account: fake(given.as || "sample") };
    case "pending":
      return { kind: "pending", account: fake(given.as || "sample") };
    case "reconnect":
      return { kind: "reconnect", account: fake(given.as || "sample") };
    case "ask":
      return { kind: "ask", why: given.why || "share", who: (given.who || ["An editor"]).map((n, i) => ({ user_id: `demo-${i}`, name: n })) };
    case "choose_install":
      return {
        kind: "choose_install",
        account: fake(given.as || "sample"),
        choices: (given.accounts || ["sample-org", "sample-user"]).map((login, i) => ({ installation_id: `demo-${i}`, account_login: login, account_type: i ? "User" : "Organization" })),
      };
    default:
      return { kind: "ready", as: given.as || `Sample ${name}`, mine: true, canChange: true };
  }
}

/* ---------- the hook ---------- */

export interface Connection {
  spec: Required<Pick<ConnectionSpec, "connector" | "slug" | "mode">> & { purpose?: string };
  name: string;
  state: ConnectionState;
  ready: boolean;
  busy: string;
  refresh: () => Promise<void>;
  connect: () => void;
  useMine: (accountId: string) => Promise<void>;
  install: (account: ConnectAccount) => void;
  bind: (account: ConnectAccount, installationId: string) => Promise<void>;
  askHelp: () => Promise<void>;
  /** Stop waiting for a sign-in tab (closed, or gone wrong) and look again. */
  cancel: () => void;
  /** Show what a failed call means instead of its text (from an operation that refused). */
  report: (e: unknown) => boolean;
}

export function useConnection(input: ConnectionSpec | string, mode?: ConnectMode): Connection {
  const given: ConnectionSpec = typeof input === "string" ? { connector: input, mode: mode || "shared" } : input;
  const key = [given.connector, given.slug || given.connector, given.mode, given.purpose || ""].join("|");
  const spec = useMemo(
    () => ({ connector: given.connector, slug: given.slug || given.connector, mode: given.mode, purpose: given.purpose }),
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const name = serviceName(spec.connector);
  const toast = useToast();
  const [state, setState] = useState<ConnectionState>(() => (DEMO ? demoState(spec) : { kind: "loading" }));
  const [busy, setBusy] = useState("");
  const facts = useRef<Facts | null>(null);
  const live = useRef(true);
  const sharing = useRef(false);

  const share = useCallback(
    async (accountId: string) => {
      const pods = facts.current?.podAccounts ?? items<PodAccount>(await client.connectors.pod.accounts.list());
      let podAccount = pods.find((p) => p.account_id === accountId);
      if (!podAccount) {
        podAccount = (await client.connectors.pod.accounts.add({ account_id: accountId } as never)) as unknown as PodAccount;
      }
      await client.connectors.pod.accounts.shareAs(podAccount.id, spec.slug, spec.purpose ? { purpose: spec.purpose } : {});
    },
    [spec.slug, spec.purpose],
  );

  const declare = useCallback(
    async (account: ConnectAccount) => {
      if (!account.auth_config_id) return;
      await client.connectors.pod.create({
        slug: spec.slug,
        auth_config_id: account.auth_config_id,
        mode: "PER_MEMBER",
        required: false,
        ...(spec.purpose ? { purpose: spec.purpose } : {}),
      } as never);
    },
    [spec.slug, spec.purpose],
  );

  const refresh = useCallback(async () => {
    if (DEMO) return;
    try {
      const f = await readFacts(spec);
      if (!live.current) return;
      facts.current = f;
      const pending = readPending(spec.slug);
      if (pending) {
        const fresh = f.accounts.filter(connected).find((a) => !pending.before.includes(a.id));
        if (fresh && !sharing.current) {
          // Back from signing in: finish what Connect started.
          writePending(spec.slug, null);
          sharing.current = true;
          try {
            if (pending.share) await share(fresh.id);
            else if (!f.declared && f.canManage) await declare(fresh);
          } catch (e) {
            sharing.current = false;
            if (personOnly(e)) {
              rememberPersonOnly();
              return setState({ kind: "in_lemma", url: lemmaConnectionsUrl(spec.slug), accounts: f.accounts.filter(connected) });
            }
            const problem = connectionProblem(e, spec.connector);
            setState(refused(e) ? { kind: "ask", why: "share", who: await helpers("share", f) } : problem?.why ? { kind: "ask", why: problem.why, who: await helpers(problem.why, f), raw: rawOf(e) } : { kind: "error", raw: rawOf(e) });
            return;
          }
          sharing.current = false;
          return refresh();
        }
        if (!fresh) {
          // A sign-in that changed an account already here (a reconnect, an install) is over once it reads well.
          const next = decide(spec, f);
          if (next.kind === "ready" && !pending.another && Date.now() - pending.at > 4000) writePending(spec.slug, null);
          else return setState((now) => (now.kind === "waiting" ? now : { kind: "waiting", url: null }));
        }
      }
      let next = decide(spec, f);
      if (next.kind === "choose_install" && f.org) {
        const r = (await client.connectors.accountInstallations(f.org, next.account.id, true).catch(() => null)) as { choices?: InstallChoice[]; install_state?: string } | null;
        if (r?.install_state === "READY") next = { kind: "ready", as: labelOf(next.account), mine: true, canChange: true, account: next.account };
        else next = { ...next, choices: r?.choices || [] };
      }
      if (next.kind === "ask") next = { ...next, who: await helpers(next.why, f) };
      if (!live.current) return;
      const settled = next;
      // Having asked, it still reads "Asked …" until the answer comes.
      setState((now) => (settled.kind === "ask" && now.kind === "ask" && now.why === settled.why && now.asked ? { ...settled, asked: now.asked } : settled));
    } catch (e) {
      if (live.current) setState({ kind: "error", raw: rawOf(e) });
    }
  }, [spec, share, declare]);

  useEffect(() => {
    live.current = true;
    if (DEMO) {
      setState(demoState(spec));
      return;
    }
    setState({ kind: "loading" });
    void refresh();
    return () => {
      live.current = false;
    };
  }, [spec, refresh]);

  // While a sign-in tab is out, look again on the way back, and every few seconds.
  const waiting = state.kind === "waiting";
  const watching = waiting || state.kind === "pending" || state.kind === "in_lemma" || (state.kind === "ask" && !!state.asked?.length);
  useEffect(() => {
    if (DEMO || !watching) return;
    const again = () => void refresh();
    const onVisible = () => document.visibilityState === "visible" && again();
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string } | null;
      if (data && data.source === "lemma-connect") again();
    };
    window.addEventListener("focus", again);
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(again, waiting ? 4000 : 30000);
    return () => {
      window.removeEventListener("focus", again);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [watching, waiting, refresh]);

  const demo = (text: string, next: ConnectionState) => {
    demoNote(text);
    setState(next);
  };

  const connect = useCallback(() => {
    if (DEMO) return demo(`In the demo nothing connects. In your Lemma this opens ${name}'s sign-in.`, { kind: "ready", as: `Sample ${name}`, mine: true, canChange: true });
    const tab = holdTab(name);
    setBusy("connect");
    void (async () => {
      try {
        const f = facts.current ?? (await readFacts(spec));
        if (!f.org) throw new Error("No organization");
        writePending(spec.slug, { at: Date.now(), before: f.accounts.filter(connected).map((a) => a.id), share: spec.mode === "shared", another: decide(spec, f).kind === "ready" });
        const req = (await client.connectors.createConnectRequest(f.org, { connector_id: spec.connector, return_to: RETURN_TO } as never)) as { authorization_url?: string | null };
        if (!req.authorization_url) {
          tab?.close();
          writePending(spec.slug, null);
          await refresh();
          return;
        }
        if (tab) tab.location.replace(req.authorization_url);
        setState({ kind: "waiting", url: req.authorization_url, opened: !!tab });
      } catch (e) {
        tab?.close();
        writePending(spec.slug, null);
        const problem = connectionProblem(e, spec.connector);
        if (problem?.kind === "ask" && problem.why) setState({ kind: "ask", why: problem.why, who: await helpers(problem.why, facts.current) });
        else setState({ kind: "error", raw: rawOf(e) });
      } finally {
        setBusy("");
      }
    })();
  }, [spec, name, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const useMine = useCallback(
    async (accountId: string) => {
      if (DEMO) return demo(`In the demo nothing is shared. In your Lemma this makes the account the one everyone's ${name} runs as.`, { kind: "ready", as: `Sample ${name}`, mine: true, canChange: true });
      setBusy("share");
      try {
        await share(accountId);
        toast(`${name} is connected for this Lemma.`);
        await refresh();
      } catch (e) {
        if (personOnly(e)) {
          rememberPersonOnly();
          setState({ kind: "in_lemma", url: lemmaConnectionsUrl(spec.slug), accounts: facts.current?.accounts.filter(connected) || [] });
          return;
        }
        const problem = connectionProblem(e, spec.connector);
        if (refused(e)) setState({ kind: "ask", why: "share", who: await helpers("share", facts.current), raw: rawOf(e) });
        else if (problem?.why) setState({ kind: "ask", why: problem.why, who: await helpers(problem.why, facts.current), raw: rawOf(e) });
        else setState({ kind: "error", raw: rawOf(e) });
      } finally {
        setBusy("");
      }
    },
    [share, refresh, name, spec.connector, toast], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const install = useCallback(
    (account: ConnectAccount) => {
      if (DEMO) return demo("In the demo nothing opens. In your Lemma this opens GitHub, to pick the repositories.", { kind: "ready", as: `Sample ${name}`, mine: true, canChange: true });
      const tab = holdTab(name);
      setBusy("install");
      void (async () => {
        try {
          const org = facts.current?.org ?? (await orgId());
          if (!org) throw new Error("No organization");
          const req = await client.connectors.createInstallRequest(org, account.id, RETURN_TO);
          writePending(spec.slug, { at: Date.now(), before: (facts.current?.accounts || []).filter(connected).map((a) => a.id), share: false });
          if (tab) tab.location.replace(req.authorization_url);
          setState({ kind: "waiting", url: req.authorization_url, opened: !!tab });
        } catch (e) {
          tab?.close();
          setState({ kind: "error", raw: rawOf(e) });
        } finally {
          setBusy("");
        }
      })();
    },
    [spec.slug, name], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const bind = useCallback(
    async (account: ConnectAccount, installationId: string) => {
      if (DEMO) return demo("In the demo nothing changes.", { kind: "ready", as: `Sample ${name}`, mine: true, canChange: true });
      setBusy("bind");
      try {
        const org = facts.current?.org ?? (await orgId());
        if (org) await client.connectors.bindAccountInstallation(org, account.id, installationId);
        await refresh();
      } catch (e) {
        setState({ kind: "error", raw: rawOf(e) });
      } finally {
        setBusy("");
      }
    },
    [refresh, name], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const askHelp = useCallback(async () => {
    if (state.kind !== "ask") return;
    if (DEMO) return demo("In the demo nobody is asked. In your Lemma they get a line in their own channel.", { ...state, asked: state.who.map((w) => w.name) });
    const podId = client.podId;
    if (!podId || !state.who.length) return;
    setBusy("ask");
    try {
      const me = await whoAmI();
      const who = me?.name || me?.email || "Someone";
      const where = typeof document !== "undefined" && document.title ? `${document.title} in this Lemma` : "the app in this Lemma";
      const text = askText(state.why, name, who, where);
      const day = new Date().toISOString().slice(0, 10);
      const asked: string[] = [];
      for (const helper of state.who.slice(0, 3)) {
        try {
          await client.channels.notify(podId, { to: helper.user_id, text }, { idempotencyKey: `connect:${spec.slug}:${state.why}:${helper.user_id}:${day}` });
          asked.push(helper.name);
        } catch {
          /* One who can't be reached doesn't stop the others. */
        }
      }
      if (asked.length) setState({ ...state, asked });
      else toast("Couldn't send the message just now. Try again in a minute.");
    } finally {
      setBusy("");
    }
  }, [state, name, spec.slug, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const report = useCallback(
    (e: unknown) => {
      const problem = connectionProblem(e, spec.connector);
      if (!problem) return false;
      if (DEMO) return true;
      void (async () => {
        // A per-member account is always the person's own to sign in again.
        if (problem.kind === "reconnect" || (problem.why === "owner" && spec.mode === "per_member")) return setState({ kind: "reconnect", account: null });
        if (problem.kind === "ask" && problem.why) {
          const who = await helpers(problem.why, facts.current);
          if (live.current) setState({ kind: "ask", why: problem.why, who, raw: rawOf(e) });
          return;
        }
        await refresh();
      })();
      return true;
    },
    [spec.connector, spec.mode, refresh],
  );

  const cancel = useCallback(() => {
    writePending(spec.slug, null);
    void refresh();
  }, [spec.slug, refresh]);

  return { spec, name, state, ready: state.kind === "ready", busy, refresh, connect, useMine, install, bind, askHelp, cancel, report };
}

function askText(why: AskWhy, name: string, who: string, where: string): string {
  switch (why) {
    case "share":
      return `${who} would like ${name} connected for this Lemma, and it takes an editor. Open ${where} and press "Connect ${name}" (or "Use my ${name}"): it takes a minute.`;
    case "declare":
      return `${who} would like to connect their ${name} here, and this Lemma needs an editor to turn ${name} on first. Open ${where} and press "Connect ${name}".`;
    case "install_org":
      return `${who} would like to connect ${name}, and it isn't added to your organization yet. Open ${where} and press "Connect ${name}": as an admin, that adds it.`;
    case "unavailable":
      return `${who} would like to use ${name} in ${where}, and it's switched off for your organization. Could you turn it back on in the organization's settings?`;
    case "owner":
      return `The ${name} account this Lemma runs as is yours, and its sign-in expired. Open ${where} and press "Reconnect".`;
    case "access":
      return `${who} can't use ${name} in ${where}: this Lemma hasn't given them, or this plugin, access to it. Could you take a look?`;
  }
}

/* ---------- the piece ---------- */

const ASK_COPY: Record<AskWhy, (name: string) => string> = {
  share: (n) => `${n} is connected once, for everyone in this Lemma, and that takes an editor. You aren't one here.`,
  declare: (n) => `This Lemma doesn't use ${n} yet, and turning it on takes an editor. You aren't one here.`,
  install_org: (n) => `${n} isn't added to your organization yet, and adding it takes an organization admin.`,
  unavailable: (n) => `${n} is switched off for your organization. An organization admin can turn it back on.`,
  owner: (n) => `The ${n} account this Lemma runs as belongs to someone else, and it needs them to sign in again.`,
  access: (n) => `${n} is connected, but this Lemma hasn't given you, or this plugin, access to it.`,
};

export interface ConnectProps extends ConnectionSpec {
  /** Called whenever it reads as connected and working, the first read included. */
  onReady?: () => void;
  /** Called only when it comes back to connected after reading as not: the moment to retry what failed. */
  onBack?: () => void;
  /** Draw nothing at all when connected (or still checking), rather than "Connected as X · Change". */
  quiet?: boolean;
  /** False when the page has its own primary action in view: the next step then isn't the accent button. */
  primary?: boolean;
  /** A failed call from elsewhere in the app, to show as its next step. */
  error?: unknown;
  /** A connection made outside, to share instead of reading one here (rare). */
  connection?: Connection;
  /** Words beside Connect, when `purpose` reads too long here. */
  lead?: ReactNode;
  className?: string;
}

/** One connector: where it stands for the person looking, and the one thing to do about it. */
export function Connect(props: ConnectProps) {
  return props.connection ? <ConnectView c={props.connection} {...props} /> : <ConnectOwn {...props} />;
}

function ConnectOwn(props: ConnectProps) {
  const c = useConnection(props);
  return <ConnectView c={c} {...props} />;
}

function ConnectView({ c, onReady, onBack, quiet, primary = true, error, lead, purpose, className }: ConnectProps & { c: Connection }) {
  const { state, name, busy } = c;
  const main = primary ? "primary" : "default";
  const Icon = ICONS[c.spec.connector] || Plug;
  const [changing, setChanging] = useState(false);
  const [picked, setPicked] = useState("");
  const was = useRef(false);
  const seen = useRef(false);

  useEffect(() => {
    if (state.kind === "ready" && !was.current) {
      onReady?.();
      if (seen.current) onBack?.();
    }
    was.current = state.kind === "ready";
    if (state.kind !== "loading" && state.kind !== "ready") seen.current = true;
  }, [state.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (error) c.report(error);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.kind === "use_mine" && !state.accounts.some((a) => a.id === picked)) setPicked(state.accounts[0]?.id || "");
    if (state.kind === "choose_install" && !state.choices.some((ch) => ch.installation_id === picked)) setPicked(state.choices[0]?.installation_id || "");
  }, [state, picked]);

  if (quiet && state.kind === "loading") return null;
  if (state.kind === "ready" && !changing) {
    if (quiet) return null;
    return (
      <div className={cx("c-connect c-connect--ready", className)}>
        <Icon size={15} aria-hidden="true" className="c-faint" />
        <span className="c-grow c-ellipsis">
          <span className="c-connect__label">{c.spec.mode === "shared" ? `${name} for this Lemma` : `Your ${name}`}</span>{" "}
          <Pill tone="success">Connected</Pill> {state.as ? <span className="c-muted">as <b>{state.as}</b></span> : null}
        </span>
        {c.spec.connector === "github" && state.account ? (
          <Button size="sm" variant="ghost" icon={ExternalLink} busy={busy === "install"} title="Choose the repositories the Lemma's GitHub app is on" onClick={() => c.install(state.account!)}>Repositories</Button>
        ) : null}
        {state.canChange ? (
          <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>Change</Button>
        ) : null}
      </div>
    );
  }

  const say = purpose ? <p className="c-connect__why">{lead || purpose}</p> : lead ? <p className="c-connect__why">{lead}</p> : null;
  const head = (pill: ReactNode, title: ReactNode) => (
    <div className="c-connect__head">
      <Icon size={16} aria-hidden="true" className="c-faint" />
      <span className="c-grow c-connect__title">{title}</span>
      {pill}
    </div>
  );

  let body: ReactNode;
  switch (state.kind) {
    case "loading":
      body = (
        <div className="c-connect__head">
          <Spinner />
          <span className="c-grow c-muted">Checking {name}…</span>
        </div>
      );
      break;
    case "ready": // changing
      body = (
        <>
          {head(<Pill tone="success">Connected</Pill>, <>{name}{state.as ? <span className="c-muted"> as {state.as}</span> : null}</>)}
          <p className="c-connect__why">
            {c.spec.mode === "shared" ? `Connect another ${name} account to run this Lemma as it instead.` : `Connect another ${name} account of yours.`}
          </p>
          <div className="c-connect__row">
            <Button variant={main} icon={ExternalLink} busy={busy === "connect"} onClick={() => { setChanging(false); c.connect(); }}>Connect another account</Button>
            <Button variant="ghost" onClick={() => setChanging(false)}>Keep this one</Button>
          </div>
        </>
      );
      break;
    case "connect":
      body = (
        <>
          {head(<Pill tone="warning">Not connected</Pill>, c.spec.mode === "shared" ? <>{name} for this Lemma</> : <>Your {name}</>)}
          {say}
          <div className="c-connect__row">
            <Button variant={main} icon={ExternalLink} busy={busy === "connect"} onClick={c.connect}>Connect {name}</Button>
          </div>
          <p className="c-connect__note">
            {c.spec.mode === "shared"
              ? `Signs in to ${name} in a new tab. Once you're back, your account is the one everyone here runs as; nobody sees your password.`
              : `Signs in to ${name} in a new tab, and comes back here.`}
          </p>
        </>
      );
      break;
    case "use_mine": {
      const one = state.accounts.length === 1 ? state.accounts[0] : null;
      body = (
        <>
          {head(<Pill tone="warning">Not connected</Pill>, <>{name} for this Lemma</>)}
          {say}
          {one ? null : (
            <div className="c-connect__choices" role="radiogroup" aria-label={`Your ${name} accounts`}>
              {state.accounts.map((a) => (
                <label key={a.id} className="c-choice">
                  <input type="radio" name={`connect-${c.spec.slug}`} checked={picked === a.id} onChange={() => setPicked(a.id)} />
                  <span className="c-grow c-ellipsis">{labelOf(a) || name}</span>
                </label>
              ))}
            </div>
          )}
          <div className="c-connect__row">
            <Button variant={main} icon={Check} busy={busy === "share"} disabled={!!busy || !picked} onClick={() => void c.useMine(picked)}>
              Use my {name}{one && labelOf(one) ? ` (${labelOf(one)})` : ""}
            </Button>
            <Button variant="ghost" icon={ExternalLink} busy={busy === "connect"} disabled={!!busy} onClick={c.connect}>Connect another account</Button>
          </div>
          <p className="c-connect__note">Everyone in this Lemma then works through this account. You can change it here any time.</p>
        </>
      );
      break;
    }
    case "in_lemma": {
      const who = state.accounts.length === 1 ? labelOf(state.accounts[0]) : null;
      body = (
        <>
          {head(<Pill tone="warning">One step in Lemma</Pill>, <>{name} for this Lemma</>)}
          {say}
          <p className="c-connect__why">
            Your {name}{who ? <> (<b>{who}</b>)</> : null} is signed in. Sharing it with everyone here is something Lemma has you do yourself, so no app can do it for you: press <b>Share</b> on {name} in this Lemma's connections, and come back.
          </p>
          <div className="c-connect__row">
            {state.url ? (
              <a className={cx("c-btn", primary && "c-btn--primary")} href={state.url} target="_blank" rel="noopener">
                <ExternalLink aria-hidden="true" /> Share it in Lemma
              </a>
            ) : null}
            <Button variant={state.url ? "ghost" : "default"} icon={RefreshCw} onClick={() => void c.refresh()}>I've shared it</Button>
          </div>
          <p className="c-connect__note">This page carries on by itself once it's shared.</p>
        </>
      );
      break;
    }
    case "install":
      body = (
        <>
          {head(<Pill tone="warning">No repositories</Pill>, <>{name} is signed in</>)}
          <p className="c-connect__why">{labelOf(state.account) ? <>Signed in as <b>{labelOf(state.account)}</b>, but the</> : "The"} Lemma's GitHub app isn't on any of your repositories yet, so it can't read anything. Pick the ones it may use.</p>
          <div className="c-connect__row">
            <Button variant={main} icon={ExternalLink} busy={busy === "install"} onClick={() => c.install(state.account)}>Choose repositories on GitHub</Button>
          </div>
        </>
      );
      break;
    case "choose_install":
      body = (
        <>
          {head(<Pill tone="warning">Pick one</Pill>, <>Which GitHub account?</>)}
          <p className="c-connect__why">The Lemma's GitHub app is on more than one GitHub account you belong to. Pick the one this Lemma works in.</p>
          <div className="c-connect__choices" role="radiogroup" aria-label="GitHub accounts">
            {state.choices.length ? (
              state.choices.map((ch) => (
                <label key={ch.installation_id} className="c-choice">
                  <input type="radio" name={`install-${c.spec.slug}`} checked={picked === ch.installation_id} onChange={() => setPicked(ch.installation_id)} />
                  <span className="c-grow c-ellipsis">{ch.account_login || ch.installation_id}</span>
                  <span className="c-faint">{ch.account_type === "Organization" ? "organization" : "personal"}{ch.repository_selection === "all" ? " · every repository" : ""}</span>
                </label>
              ))
            ) : (
              <div className="c-choice c-muted"><Spinner /> Asking GitHub…</div>
            )}
          </div>
          <div className="c-connect__row">
            <Button variant={main} icon={Check} busy={busy === "bind"} disabled={!picked || !!busy} onClick={() => void c.bind(state.account, picked)}>Use this one</Button>
            <Button variant="ghost" icon={ExternalLink} onClick={() => c.install(state.account)}>Add another on GitHub</Button>
          </div>
        </>
      );
      break;
    case "pending":
      body = (
        <>
          {head(<Pill tone="warning">Waiting on GitHub</Pill>, <>{name} is waiting for approval</>)}
          <p className="c-connect__why">An owner of your GitHub organization has to approve the Lemma's GitHub app. GitHub has asked them; this carries on once they do.</p>
          <div className="c-connect__row">
            <Button icon={RefreshCw} onClick={() => void c.refresh()}>Check again</Button>
          </div>
        </>
      );
      break;
    case "reconnect":
      body = (
        <>
          {head(<Pill tone="danger">Signed out</Pill>, <>{name} needs you to sign in again</>)}
          <p className="c-connect__why">{state.account && labelOf(state.account) ? <>The sign-in for <b>{labelOf(state.account)}</b> expired. </> : "The sign-in expired. "}Nothing is lost: sign in again and it carries on.</p>
          <div className="c-connect__row">
            <Button variant={main} icon={ExternalLink} busy={busy === "connect"} onClick={c.connect}>Reconnect</Button>
          </div>
        </>
      );
      break;
    case "ask": {
      const names = state.who.slice(0, 3).map((w) => w.name);
      const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
      body = (
        <>
          {head(<Pill tone="warning">Needs someone else</Pill>, <>{name} isn't ready</>)}
          {say}
          <p className="c-connect__why">{ASK_COPY[state.why](name)}</p>
          {state.asked?.length ? (
            <p className="c-connect__done" role="status"><Check size={14} aria-hidden="true" /> Asked {state.asked.join(" and ")}. This page carries on by itself once it's done.</p>
          ) : null}
          <div className="c-connect__row">
            {state.who.length && !state.asked?.length ? (
              <Button variant={main} icon={MessageCircle} busy={busy === "ask"} onClick={() => void c.askHelp()}>
                Ask {state.who.length === 1 ? state.who[0].name : "someone who can"}
              </Button>
            ) : null}
            <Button variant={state.who.length && !state.asked?.length ? "ghost" : "default"} icon={RefreshCw} onClick={() => void c.refresh()}>Check again</Button>
          </div>
          {state.who.length && !state.asked?.length ? (
            <p className="c-connect__note">{state.who.length > 1 ? `Sends ${list} a line in their own channel, saying what to press.` : "Sends them a line in their own channel, saying what to press."}</p>
          ) : !state.who.length ? (
            <p className="c-connect__note">
              {state.why === "install_org" || state.why === "unavailable"
                ? "Nobody in this Lemma can; ask an admin of your organization."
                : state.why === "owner"
                  ? "Its owner isn't in this Lemma any more: an editor can connect another account here."
                  : "Nobody else here can yet: ask whoever added this Lemma to make you an editor."}
            </p>
          ) : null}
          <Raw raw={state.raw} />
        </>
      );
      break;
    }
    case "waiting":
      body = (
        <>
          {head(<Pill tone="info">Signing in</Pill>, <>Finish in the {name} tab</>)}
          <p className="c-connect__why">
            {state.url && !state.opened ? <>Your browser kept the tab from opening. <a href={state.url} target="_blank" rel="opener">Open {name}'s sign-in</a>, then come back here.</> : <>Sign in to {name} in the tab that opened. This page carries on by itself when you're back.</>}
          </p>
          <div className="c-connect__row">
            <Button icon={RefreshCw} onClick={() => void c.refresh()}>I'm back</Button>
            <Button variant="ghost" onClick={c.cancel}>Cancel</Button>
          </div>
          {state.url && state.opened ? <p className="c-connect__note">Tab didn't open? <a href={state.url} target="_blank" rel="opener">Open {name}'s sign-in here</a>.</p> : null}
        </>
      );
      break;
    case "error":
      body = (
        <>
          {head(<Pill tone="danger">Couldn't check</Pill>, <>Couldn't check {name}</>)}
          <p className="c-connect__why">Something went wrong reading where {name} stands. Try again; if it keeps happening, the details below help whoever looks at it.</p>
          <div className="c-connect__row">
            <Button icon={RefreshCw} onClick={() => void c.refresh()}>Try again</Button>
          </div>
          <Raw raw={state.raw} />
        </>
      );
      break;
  }

  return (
    <section className={cx("c-connect", className)} aria-label={`${name} connection`} aria-busy={state.kind === "loading" || undefined}>
      {body}
    </section>
  );
}

function Raw({ raw }: { raw?: string }) {
  if (!raw) return null;
  return (
    <details className="c-connect__raw">
      <summary><ChevronDown size={12} aria-hidden="true" /> Details</summary>
      <code>{raw}</code>
    </details>
  );
}

/** Several connectors of one plugin, one under the other, each with its own next step. */
export function Connections({ items: list, quiet, onReady }: { items: ConnectProps[]; quiet?: boolean; onReady?: () => void }) {
  return (
    <div className="c-connections">
      {list.map((p) => (
        <Connect key={p.slug || p.connector} quiet={quiet} onReady={onReady} {...p} />
      ))}
    </div>
  );
}
