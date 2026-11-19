// Light or dark, as the host says.
//
// A Lemma tells a framed app its theme with a `lemma-app-theme` message: which
// of the two it is, and its palette as `--lemma-app-*` custom properties. This
// applies one the way the SDK's browser bundle does (`applyLemmaHostTheme`),
// so `kit.css` can read the tokens. Until a message arrives, and on its own in
// a tab, the app follows the system's light or dark setting. A demo, framed by
// a web page, also takes the message with no tokens: the page's light or dark.

import { DEMO } from "./demo";

export const THEME_MESSAGE = "lemma-app-theme";

export interface ThemeMessage {
  type: typeof THEME_MESSAGE;
  theme: "light" | "dark";
  density?: string;
  tokens: Record<string, string>;
}

export function isThemeMessage(value: unknown): value is ThemeMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ThemeMessage>;
  return (
    message.type === THEME_MESSAGE &&
    (message.theme === "light" || message.theme === "dark") &&
    !!message.tokens &&
    typeof message.tokens === "object"
  );
}

export function applyTheme(message: ThemeMessage, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(message.tokens)) {
    if (!name.startsWith("--lemma-app-") || typeof value !== "string" || value.length > 512) continue;
    root.style.setProperty(name, value);
  }
  root.dataset.lemmaTheme = message.theme;
  root.dataset.lemmaDensity = message.density || "compact";
  root.classList.toggle("dark", message.theme === "dark");
  root.style.colorScheme = message.theme;
}

/** Listen for the host's theme. Only a framed page has a host to hear. */
export function startTheme(): () => void {
  if (typeof window === "undefined" || window.parent === window) return () => undefined;
  const hear = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    if (isThemeMessage(event.data)) applyTheme(event.data);
    else if (DEMO && isThemeMessage({ ...(event.data as object), tokens: {} })) applyTheme({ ...(event.data as ThemeMessage), tokens: {} });
  };
  window.addEventListener("message", hear);
  // An app that loads in parts can start listening after its frame's load
  // event, when a page sent its theme. A demo says when it is listening, so the
  // page around it can send it again.
  if (DEMO) window.parent.postMessage({ type: "lemma-demo-ready" }, "*");
  return () => window.removeEventListener("message", hear);
}
