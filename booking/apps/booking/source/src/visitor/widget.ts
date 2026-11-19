// The Lemma's web widget: how a page nobody signed in to reads what the Lemma
// made Public (booking_page, booking_outcome), confirms a visitor's email with
// a code, adds their booking request, and opens the chat beside the page.
//
// The widget's key is public, never a secret. A Public app is not told it,
// though (nothing in __LEMMA_CONFIG__ names the Lemma's widget), so the link a
// member copies carries it as ?k=, and the page keeps it for next time and
// takes it out of the address.

export interface LemmaWidget {
  readRows: (table: string, options?: { orderBy?: string; desc?: boolean }) => Promise<{ rows: Record<string, unknown>[]; truncated?: boolean }>;
  addRow: (table: string, values: Record<string, unknown>) => Promise<unknown>;
  sendCode: (email: string) => Promise<unknown>;
  verifyCode: (email: string, code: string) => Promise<unknown>;
  isContact: () => boolean;
  openChat?: () => void;
}

declare global {
  interface Window {
    Lemma?: LemmaWidget;
  }
}

const STORE = "booking:widget-key";
const KEY = /^pk_[A-Za-z0-9_-]{8,80}$/;

/** The key from the link (then kept, and taken out of the address), or the one kept. */
export function widgetKey(): string | null {
  const url = new URL(window.location.href);
  const given = url.searchParams.get("k");
  if (given && KEY.test(given)) {
    try {
      window.localStorage.setItem(STORE, given);
    } catch {
      /* storage blocked: the key lasts as long as the page */
    }
    url.searchParams.delete("k");
    window.history.replaceState(window.history.state, "", url.pathname + (url.search || "") + url.hash);
    return given;
  }
  try {
    const kept = window.localStorage.getItem(STORE);
    return kept && KEY.test(kept) ? kept : null;
  } catch {
    return null;
  }
}

export function rememberKey(key: string): void {
  try {
    window.localStorage.setItem(STORE, key);
  } catch {
    /* blocked */
  }
}

/** Where the API is: the host's config, or the Lemma's own api. host. */
export function apiBase(): string {
  // Development only: the dev server proxies the members' API, but the
  // widget must talk to the real one.
  const dev = import.meta.env.VITE_BOOKING_WIDGET_API as string | undefined;
  if (dev) return dev.replace(/\/$/, "");
  const cfg = ((window as unknown as { __LEMMA_CONFIG__?: { apiUrl?: string; authUrl?: string } }).__LEMMA_CONFIG__) || {};
  const given = cfg.apiUrl || (import.meta.env.VITE_LEMMA_API_URL as string | undefined) || "";
  if (/^https?:\/\//.test(given)) return given.replace(/\/$/, "");
  const auth = cfg.authUrl || (import.meta.env.VITE_LEMMA_AUTH_URL as string | undefined) || "";
  if (/^https?:\/\//.test(auth)) return `https://api.${new URL(auth).hostname.replace(/^www\./, "")}`;
  return `https://api.${window.location.hostname.split(".").slice(-2).join(".")}`;
}

let loading: Promise<LemmaWidget> | null = null;

/** Load widget.js once, with the chat on or off. */
export function loadWidget(key: string, options: { chat: boolean; greeting?: string }): Promise<LemmaWidget> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (window.Lemma) return resolve(window.Lemma);
    const script = document.createElement("script");
    script.src = `${apiBase()}/public/web/widget.js`;
    script.async = true;
    script.setAttribute("data-lemma-key", key);
    if (!options.chat) script.setAttribute("data-lemma-chat", "off");
    if (options.greeting) script.setAttribute("data-lemma-greeting", options.greeting);
    // The kit's one accent, not the widget's own colour.
    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    script.setAttribute("data-lemma-color", dark ? "#5d5d5d" : "#0d0d0d");
    script.onload = () => (window.Lemma ? resolve(window.Lemma) : reject(new Error("The booking service didn't start.")));
    script.onerror = () => reject(new Error("Couldn't reach the booking service."));
    document.body.appendChild(script);
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** What a refused call means, in words for the visitor. */
export function explain(error: unknown): string {
  const e = error as { code?: string; message?: string; status?: number };
  switch (e?.code) {
    case "rate_limited":
      return "Too many tries from your network. Wait a few minutes and try again.";
    case "needs_contact":
      return "Confirm your email first.";
    case "table_closed":
      return "This page isn't taking bookings right now.";
    case "bad_code":
      return e.message || "That code isn't right.";
    case "bad_email":
      return "That doesn't look like an email address.";
    case "email_unavailable":
      return "Codes can't be sent from here right now. Try again later.";
    case "already_a_contact":
      return "You've already confirmed an address in this browser. Use that one, or open the page in a new private window.";
    default:
      return e?.message || "Something went wrong. Try again.";
  }
}
