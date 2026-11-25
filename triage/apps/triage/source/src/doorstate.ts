// Each door's state in words, from the set-up and what the poll and the app
// last saw: for the bar under the header and for Doors. Never a number a
// source didn't give: "read 6 min ago, every 15 min", "Not connected",
// "Waiting for your GitHub owner to accept a new permission".

import type { Data } from "./data";
import { minsAgo } from "./marks";

export type Tone = "ok" | "warn" | "off" | "bad";
export interface DoorState {
  key: string;
  name: string;
  short: string; // the bar's words
  state: string; // Doors' state pill
  tone: Tone;
  note?: string | null;
  tag?: { text: string; kind: "gap" | "pr" } | null;
}

export function doorStates(d: Data, now: number): DoorState[] {
  const s = d.settings;
  const st = s?.status || {};
  const repos = s?.repos || [];
  const channels = s?.slack.channels || [];
  const out: DoorState[] = [];
  out.push(s?.form_on
    ? { key: "form", name: "Report form", short: "Report form · live", state: "Live", tone: "ok" }
    : { key: "form", name: "Report form", short: "Report form · off", state: "Off", tone: "off" });
  out.push({ key: "assistant", name: "Ask the Lemma", short: "The Lemma in chat, Slack, Teams, email · live", state: "Live", tone: "ok" });
  out.push(repos.length
    ? { key: "github", name: "GitHub issues", short: "GitHub issues · live", state: st.github?.state === "failed" ? "Failing" : "Live",
      tone: st.github?.state === "failed" ? "bad" : "ok", note: st.github?.note }
    : { key: "github", name: "GitHub issues", short: "GitHub · not set up", state: "Not set up", tone: "off" });
  if (channels.length) {
    const live = st.slack?.state === "live";
    const names = channels.map((c) => `#${c.name}`).join(", ");
    out.push({ key: "slack", name: "Watched Slack channels", short: `Slack ${names} · ${live ? "live" : `read ${st.slack?.read_at ? minsAgo(st.slack.read_at, now) : "soon"}, every 15 min`}`,
      state: live ? "Live" : "Every 15 min", tone: live ? "ok" : "warn",
      tag: live ? null : { text: "Live with lemma-platform#1245; read every 15 minutes until then", kind: "gap" } });
  } else {
    out.push({ key: "slack", name: "Watched Slack channels", short: "Slack channels · not set up", state: "Not set up", tone: "off" });
  }
  for (const [key, name, cfgOn] of [["sentry", "Sentry", Boolean(s?.sentry.org)], ["posthog", "PostHog", Boolean(s?.posthog.account || s?.posthog.account_id)]] as const) {
    const x = st[key];
    if (!cfgOn) {
      out.push({ key, name, short: `${name} · not connected`, state: "Not connected", tone: "off" });
    } else if (x?.state === "failed") {
      out.push({ key, name, short: `${name} · failing`, state: "Failing", tone: "bad", note: x.note });
    } else {
      out.push({ key, name, short: `${name} · ${x?.read_at ? `read ${minsAgo(x.read_at, now)}` : "not read yet"}, every 15 min`, state: "Every 15 min", tone: "warn",
        note: x?.read_at ? `Read ${minsAgo(x.read_at, now)}` : "Not read yet",
        tag: { text: key === "sentry" ? "No Sentry trigger; read every 15 minutes" : "No trigger; read over MCP every 15 minutes", kind: "gap" } });
    }
  }
  for (const [key, name] of [["dependabot", "Dependabot"], ["code_scanning", "Code scanning"], ["secret_scanning", "Secret scanning"]] as const) {
    const x = st[key];
    if (!repos.length) {
      out.push({ key, name, short: `${name} · not set up`, state: "Not set up", tone: "off" });
    } else if (x?.state === "live") {
      out.push({ key, name, short: `${name} · live`, state: "Live", tone: "ok" });
    } else {
      out.push({ key, name, short: `${name} · waiting on GitHub`, state: "Waiting on GitHub", tone: "warn",
        note: x?.note || "Your GitHub owner has to accept a new permission",
        tag: { text: key === "dependabot" ? "Needs lemma-platform#1246" : "Needs Triage's GitHub fix, on lemma-platform#1246", kind: "gap" } });
    }
  }
  out.push({ key: "logs", name: "Logs", short: "Logs · not connected", state: "Not connected", tone: "off" });
  return out;
}
