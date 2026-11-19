import { jsx as _jsx } from "react/jsx-runtime";
// Starts a plugin app: theme and location from the host, sign-in, toasts, Inter.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthGuard } from "lemma-sdk/react";
import { client, hasLemmaConfig } from "./client";
import { DEMO } from "./demo";
import { startLocation } from "./location";
import { startTheme } from "./theme";
import { Notice, Toasts } from "./ui";
import "./kit.css";
const INTER = "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500&display=swap";
/** Inter, unless the host already gave the page a font of its own. */
function loadInter() {
    if (typeof document === "undefined" || document.querySelector(`link[href="${INTER}"]`))
        return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = INTER;
    document.head.appendChild(link);
}
export function boot(app) {
    // Both listen to the host from the first moment, before anything renders.
    startTheme();
    startLocation();
    loadInter();
    const container = document.getElementById("root");
    if (!container)
        throw new Error("The page has no #root to draw the app in.");
    createRoot(container).render(_jsx(StrictMode, { children: _jsx(Toasts, { children: DEMO ? (
            // A demo is signed in as its sample person, with nothing to check.
            app) : hasLemmaConfig() ? (_jsx(AuthGuard, { client: client, loadingFallback: _jsx(Notice, { children: "Checking access\u2026" }), children: app })) : (_jsx(Notice, { children: "Open this app from its Lemma." })) }) }));
}
