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
export function isThemeMessage(value) {
    if (!value || typeof value !== "object")
        return false;
    const message = value;
    return (message.type === THEME_MESSAGE &&
        (message.theme === "light" || message.theme === "dark") &&
        !!message.tokens &&
        typeof message.tokens === "object");
}
export function applyTheme(message, root = document.documentElement) {
    for (const [name, value] of Object.entries(message.tokens)) {
        if (!name.startsWith("--lemma-app-") || typeof value !== "string" || value.length > 512)
            continue;
        root.style.setProperty(name, value);
    }
    root.dataset.lemmaTheme = message.theme;
    root.dataset.lemmaDensity = message.density || "compact";
    root.classList.toggle("dark", message.theme === "dark");
    root.style.colorScheme = message.theme;
}
/** Listen for the host's theme. Only a framed page has a host to hear. */
export function startTheme() {
    if (typeof window === "undefined" || window.parent === window)
        return () => undefined;
    const hear = (event) => {
        if (event.source !== window.parent)
            return;
        if (isThemeMessage(event.data))
            applyTheme(event.data);
        else if (DEMO && isThemeMessage({ ...event.data, tokens: {} }))
            applyTheme({ ...event.data, tokens: {} });
    };
    window.addEventListener("message", hear);
    // An app that loads in parts can start listening after its frame's load
    // event, when a page sent its theme. A demo says when it is listening, so the
    // page around it can send it again.
    if (DEMO)
        window.parent.postMessage({ type: "lemma-demo-ready" }, "*");
    return () => window.removeEventListener("message", hear);
}
