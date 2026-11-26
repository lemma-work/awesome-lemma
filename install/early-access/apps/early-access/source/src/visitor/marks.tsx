// The kit's Avatar, Button and Spinner, drawn with the kit's own classes and
// markup, for the visitor's page only.
//
// The visitor's page never loads the kit's script: it starts the SDK's
// sign-in client, which adds its session headers (st-auth-mode, rid) to every
// fetch the page makes to the Lemma API, the web widget's included, and the
// widget's public endpoints refuse those in their CORS pre-flight. So the
// page takes the kit's look (kit.css) but not its JS.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

function nameOf(name: string): string {
  return name.trim() || "?";
}

function initials(name: string): string {
  const parts = nameOf(name).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** The kit's hue for a person (format.ts `hue`), so the avatar matches the members' side. */
function hue(seed: string): number {
  let hash = 0;
  for (const char of seed || "?") hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const hues = [12, 28, 42, 95, 145, 172, 196, 212, 228, 330, 350, 18];
  return hues[Math.abs(hash) % hues.length];
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="c-avatar" aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), ["--h" as string]: hue(name) }}>
      {initials(name)}
    </span>
  );
}

export function Spinner() {
  return <span className="c-spin" aria-hidden="true" />;
}

type ButtonProps = {
  children?: ReactNode;
  variant?: "default" | "primary" | "ghost";
  size?: "md" | "sm";
  icon?: LucideIcon;
  busy?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export function Button({ children, variant = "default", size = "md", icon: Icon, busy, className, ...rest }: ButtonProps) {
  const names = ["c-btn", variant !== "default" && `c-btn--${variant}`, size === "sm" && "c-btn--sm", className].filter(Boolean).join(" ");
  return (
    <button type="button" {...rest} className={names} disabled={busy || rest.disabled}>
      {busy ? <Spinner /> : Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
