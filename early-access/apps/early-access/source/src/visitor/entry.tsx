// A beta's public pages: React, the kit's look, and the web widget. Nothing
// that starts the SDK's sign-in client (see marks.tsx).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@lemma-plugins/kit/kit.css";
import "./visitor.css";
import { Visitor } from "./Visitor";

export function start(slug: string, page: string): void {
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(
    <StrictMode>
      <Visitor slug={slug} page={page === "status" ? "status" : page === "check-in" ? "checkin" : "signup"} />
    </StrictMode>,
  );
}
