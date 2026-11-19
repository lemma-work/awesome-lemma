// Starts a plugin app: theme and location from the host, sign-in, toasts, Inter.

import { StrictMode, type ReactNode } from "react";
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
function loadInter(): void {
  if (typeof document === "undefined" || document.querySelector(`link[href="${INTER}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = INTER;
  document.head.appendChild(link);
}

export function boot(app: ReactNode): void {
  // Both listen to the host from the first moment, before anything renders.
  startTheme();
  startLocation();
  loadInter();
  const container = document.getElementById("root");
  if (!container) throw new Error("The page has no #root to draw the app in.");
  createRoot(container).render(
    <StrictMode>
      <Toasts>
        {DEMO ? (
          // A demo is signed in as its sample person, with nothing to check.
          app
        ) : hasLemmaConfig() ? (
          <AuthGuard client={client} loadingFallback={<Notice>Checking access…</Notice>}>
            {app}
          </AuthGuard>
        ) : (
          <Notice>Open this app from its Lemma.</Notice>
        )}
      </Toasts>
    </StrictMode>,
  );
}
