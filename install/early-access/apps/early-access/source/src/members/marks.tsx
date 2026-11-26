// Early access's own small marks on the kit: a status, a fit, a flag and an
// email's proof, each a pill with a word; where a quote came from.

import { Pill, type Tone } from "@lemma-plugins/kit";
import type { Fit, Status, Tester } from "./data";

export const STATUS: Record<Status, { label: string; tone: Tone }> = {
  waiting: { label: "Waiting", tone: "plain" },
  picked: { label: "Picked", tone: "info" },
  invited: { label: "Invited", tone: "info" },
  active: { label: "Active", tone: "success" },
  quiet: { label: "Quiet", tone: "warning" },
  left: { label: "Left", tone: "plain" },
  not_now: { label: "Not now", tone: "plain" },
};

export const FIT: Record<Fit, { label: string; tone: Tone }> = {
  strong: { label: "Strong", tone: "success" },
  maybe: { label: "Maybe", tone: "warning" },
  not_now: { label: "Not now", tone: "plain" },
};

export function StatusPill({ status }: { status: Status }) {
  const s = STATUS[status] || STATUS.waiting;
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function FitPill({ fit }: { fit: Fit | null }) {
  if (!fit) return <Pill tone="plain" dot={false}>Reading fit</Pill>;
  const f = FIT[fit];
  return <Pill tone={f.tone}>{f.label}</Pill>;
}

export const FLAG_WORDS: Record<string, string> = {
  on: "Flag on",
  waiting_for_person: "Flag waits for their first sign-in",
  failed: "Flag not turned on",
  by_hand: "Flag to turn on by hand",
  none: "No flag: the invite is the access",
};

export function ProofPill({ t }: { t: Tester }) {
  if (t.email_proof === "not_confirmed") return <Pill tone="warning" title="The address on the sign-up isn't the one they confirmed with a code">Email not confirmed</Pill>;
  if (t.email_proof === "unchecked" && !t.sample) return <Pill tone="plain" dot={false} title="Checked by someone who can see this Lemma's contacts">Email not checked</Pill>;
  return null;
}

export const SOURCE: Record<string, string> = {
  "sign-up": "sign-up form",
  form: "check-in form",
  survey: "PostHog survey",
  mail: "mail",
  slack: "Slack",
  call: "call",
  posthog: "PostHog",
};

export function sourceOf(s: string | null | undefined): string {
  return (s && SOURCE[s]) || s || "";
}
