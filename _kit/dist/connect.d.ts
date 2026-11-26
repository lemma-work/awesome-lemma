import { type ReactNode } from "react";
/** A connector's name on screen: `github` -> GitHub. */
export declare function serviceName(connector: string): string;
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
export type AskWhy = "share" | "declare" | "install_org" | "unavailable" | "owner" | "access";
export type ConnectionState = {
    kind: "loading";
} | {
    kind: "ready";
    as: string | null;
    mine: boolean;
    canChange?: boolean;
    account?: ConnectAccount;
} | {
    kind: "connect";
} | {
    kind: "use_mine";
    accounts: ConnectAccount[];
} | {
    kind: "install";
    account: ConnectAccount;
} | {
    kind: "choose_install";
    account: ConnectAccount;
    choices: InstallChoice[];
} | {
    kind: "pending";
    account: ConnectAccount;
} | {
    kind: "reconnect";
    account: ConnectAccount | null;
} | {
    kind: "ask";
    why: AskWhy;
    who: Helper[];
    asked?: string[];
    raw?: string;
} | {
    kind: "waiting";
    url: string | null;
    opened?: boolean;
} | {
    kind: "in_lemma";
    url: string | null;
    accounts: ConnectAccount[];
} | {
    kind: "error";
    raw: string;
};
export declare function connectionProblem(e: unknown, connector?: string): {
    kind: ConnectionState["kind"];
    why?: AskWhy;
    text: string;
} | null;
/**
 * A failure said to a person: a connection problem in words (never the
 * platform's text, which names slugs and pods), anything else as its message.
 * Use it wherever a caught error from a connector call reaches the screen.
 */
export declare function errorText(e: unknown, connector?: string): string;
/** Whether a failure is about a connection, which `<Connect error>` can turn into the next step. */
export declare function isConnectionProblem(e: unknown): boolean;
export interface Connection {
    spec: Required<Pick<ConnectionSpec, "connector" | "slug" | "mode">> & {
        purpose?: string;
    };
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
export declare function useConnection(input: ConnectionSpec | string, mode?: ConnectMode): Connection;
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
export declare function Connect(props: ConnectProps): import("react").JSX.Element;
/** Several connectors of one plugin, one under the other, each with its own next step. */
export declare function Connections({ items: list, quiet, onReady }: {
    items: ConnectProps[];
    quiet?: boolean;
    onReady?: () => void;
}): import("react").JSX.Element;
