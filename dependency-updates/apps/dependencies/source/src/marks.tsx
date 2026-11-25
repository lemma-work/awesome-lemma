// Small marks the screens share: states in words, versions, the Lemma's reads.

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Pill, type Tone } from "@lemma-plugins/kit";
import type { Batch, Repo, Update } from "./types";
import { SEVERITY_TONE, cap, change } from "./model";

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return <span className="dp-mono" title={title}>{children}</span>;
}

export function Change({ u }: { u: Pick<Update, "from_version" | "to_version"> }) {
  return <Mono>{change(u)}</Mono>;
}

export function Bump({ u }: { u: Pick<Update, "bump"> }) {
  return <Pill tone="plain">{u.bump}</Pill>;
}

const STATE: Record<string, [string, Tone]> = {
  waiting: ["Waiting out the wait", "plain"],
  ready: ["Ready for the batch", "success"],
  needs_you: ["Waiting for you", "warning"],
  risky: ["Held, looks risky", "danger"],
  in_batch: ["In a batch", "info"],
  opened: ["In a pull request", "info"],
  merged: ["Merged", "success"],
  dropped: ["Dropped from its batch", "plain"],
  by_hand: ["Do by hand", "warning"],
  ignored: ["Ignored", "plain"],
  superseded: ["A newer one came", "plain"],
};

export function StatePill({ u }: { u: Update }) {
  if (u.security && ["opened", "in_batch"].includes(u.state)) return <Pill tone="danger">Security{u.pr_number ? ` · #${u.pr_number}` : ""}</Pill>;
  const [word, tone] = STATE[u.state] || [u.state, "plain"];
  return <Pill tone={tone}>{word}{u.state === "opened" && u.pr_number ? ` · #${u.pr_number}` : ""}</Pill>;
}

export function Tried({ u }: { u: Update }) {
  if (u.tried === "fixed") return <Pill tone="success">Fixed, passing</Pill>;
  if (u.tried === "passed") return <Pill tone="success">Passing</Pill>;
  if (u.tried === "failed") return <Pill tone="danger">Failed</Pill>;
  if (u.ecosystem === "actions") return <Pill tone="plain">Runs in CI</Pill>;
  return <Pill tone="plain">Not tried yet</Pill>;
}

export function Severity({ value }: { value?: string | null }) {
  if (!value) return null;
  return <Pill tone={SEVERITY_TONE[value] || "plain"}>{cap(value)}</Pill>;
}

/** The Lemma's own reading, marked as its own. */
export function Read({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <span className="dp-read">
      <Sparkles size={13} aria-label={label || "The Lemma's read"} />
      <span>{children}</span>
    </span>
  );
}

export function Reach({ u }: { u: Update }) {
  const s = u.security;
  if (!s) return null;
  const word = s.reach === "yes" ? "Yes." : s.reach === "not_found" ? "Not found." : "Not known.";
  return (
    <Read label="The Lemma's reading of your code, not a call graph">
      <b>{word}</b> {s.reach_note || ""}
    </Read>
  );
}

export function RepoPill({ r }: { r: Repo }) {
  if (r.status === "ok") {
    if (r.managers.length === 1 && r.managers[0] === "actions") return <Pill tone="plain">CI only</Pill>;
    return <Pill tone="success">Installs</Pill>;
  }
  if (r.status === "needs_confirm") return <Pill tone="warning">Confirm commands</Pill>;
  if (r.status === "private_registry") return <Pill tone="warning">Private registry</Pill>;
  if (r.status === "cant_install") return <Pill tone="danger">Can't install</Pill>;
  if (r.status === "unsupported") return <Pill tone="plain">Not supported</Pill>;
  return <Pill tone="plain">Not looked at yet</Pill>;
}

export function BatchState({ b }: { b: Batch }) {
  if (b.state === "merged") return <Pill tone="success">Merged</Pill>;
  if (b.state === "closed") return <Pill tone="plain">Closed</Pill>;
  if (b.state === "failed") return <Pill tone="danger">Failed</Pill>;
  if (b.state === "preparing") return <Pill tone="info">Preparing</Pill>;
  return <Pill tone="info">Open</Pill>;
}

export function Checks({ b }: { b: Batch }) {
  const runs = b.check_runs || [];
  const passed = runs.filter((c) => c.state === "passed").length;
  if (b.checks === "passed") return <Pill tone="success">{runs.length ? `${passed} of ${runs.length} checks passing` : "Checks passing"}</Pill>;
  if (b.checks === "failed") return <Pill tone="danger">Checks failing</Pill>;
  if (b.checks === "running") return <Pill tone="info">Checks running</Pill>;
  return <Pill tone="plain">No checks yet</Pill>;
}

export function Review({ b }: { b: Batch }) {
  const notes = b.review_notes ? `, ${b.review_notes} note${b.review_notes === 1 ? "" : "s"}` : "";
  if (b.review === "approved") return <Pill tone="success">Approved{notes}</Pill>;
  if (b.review === "changes") return <Pill tone="danger">Changes asked{notes}</Pill>;
  if (b.review === "commented") return <Pill tone="info">Commented{notes}</Pill>;
  return <Pill tone="plain">Not reviewed</Pill>;
}

export function Ai() {
  return <Pill tone="ai" icon={Sparkles}>ai</Pill>;
}
