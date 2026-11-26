// Each door's state in words, from the set-up and what the poll and the app
// last saw: for the bar under the header and for Doors. Never a number a
// source didn't give: "read 6 min ago, every 15 min", "Not connected",
// "Waiting for your GitHub owner to accept a new permission". A door whose
// last read failed for want of its connection says "Not connected", and
// Doors puts that connector's Connect under it.

import { connectionProblem, type ConnectionSpec } from "@lemma-plugins/kit";
import type { Data } from "./data";
import { minsAgo } from "./marks";
import type { Settings } from "./types";
import { noteProblem } from "./wire";

/** The doors that read through one of Triage's connectors (all SHARED, all optional), and what each is for. */
export const CONNECTED_DOORS = ["github", "slack", "sentry", "posthog"] as const;
export type ConnectedDoor = (typeof CONNECTED_DOORS)[number];

const PURPOSE: Record<ConnectedDoor, string> = {
  github: "Issues and +1 comments on the repositories you watch, and their security alerts, become reports; CODEOWNERS and the last change to a file suggest an owner, and Triage comments when one is filed and fixed. Without it, nothing comes in from GitHub.",
  slack: "Reads the channels you watch for reports, leaving questions and chatter alone, and answers the reporter in their thread. Without it, no Slack channel is watched.",
  sentry: "Unresolved issues in the projects you pick, read every 15 minutes and counted in people, and resolved in Sentry when their task is done. Without it, errors are named as not checked.",
  posthog: "Error tracking issues, read every 15 minutes and counted in people and sessions. Without it, PostHog is named as not checked.",
};

/** The Connect piece's spec for a door: the slug is the one the set-up reads through (the bundle's, unless changed). */
export function connectSpec(key: ConnectedDoor, s: Settings | null | undefined): ConnectionSpec {
  const slug = key === "github" ? "github" : (s?.[key]?.account || key);
  return { connector: key, slug, mode: "shared", purpose: PURPOSE[key] };
}

export function isConnectedDoor(key: string): key is ConnectedDoor {
  return (CONNECTED_DOORS as readonly string[]).includes(key);
}

/** A failed read that was about the connection, in words. */
function notConnected(key: string, name: string, note: string | null | undefined): DoorState | null {
  const e = noteProblem(note);
  const problem = e ? connectionProblem(e, key) : null;
  return problem ? { key, name, short: `${name} · not connected`, state: "Not connected", tone: "bad", note: problem.text } : null;
}

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
    ? (st.github?.state === "failed" && notConnected("github", "GitHub issues", st.github.note)) || {
      key: "github", name: "GitHub issues", short: "GitHub issues · live", state: st.github?.state === "failed" ? "Failing" : "Live",
      tone: st.github?.state === "failed" ? "bad" : "ok", note: st.github?.note }
    : { key: "github", name: "GitHub issues", short: "GitHub · not set up", state: "Not set up", tone: "off" });
  const slackOff = channels.length && st.slack?.state === "failed" ? notConnected("slack", "Watched Slack channels", st.slack.note) : null;
  if (slackOff) {
    out.push(slackOff);
  } else if (channels.length) {
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
      out.push({ key, name, short: `${name} · not set up`, state: "Not set up", tone: "off" });
    } else if (x?.state === "failed") {
      out.push(notConnected(key, name, x.note) || { key, name, short: `${name} · failing`, state: "Failing", tone: "bad", note: x.note });
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
