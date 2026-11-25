import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@lemma-plugins/kit/kit.css";
import "./changelog.css";
import { Changelog } from "./Changelog";

export function start(): void {
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(
    <StrictMode>
      <Changelog />
    </StrictMode>,
  );
}
