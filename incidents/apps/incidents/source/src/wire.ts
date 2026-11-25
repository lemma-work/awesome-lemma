// What only a person can do, done by the app as them.
//
// Functions run with their grants, and no grant holds `schedule.create`, or
// `agent.update` on the Lemma itself (PATCH /pods/{id}/surfaces/{name} asks
// for it). So:
//
// - connecting a new incident channel to the Lemma's Slack bot (its surface's
//   `config.channels`), so the bot hears it and the channel can start a
//   schedule, is done here as the person who declared, or the next member who
//   opens the incident. incidents_declare tries first and says when it was
//   refused (`channel_connected`);
// - the incident's message schedule (`incidents-channel-<n>`, the Slack
//   channel trigger: lemma-platform#1245, not merged yet) is made here and
//   removed at resolve by whoever made it. Refused, the 15-minute tick reads
//   the channel instead, and the screen says so;
// - set-up's schedules: the tick, and one WEBHOOK schedule per GitHub event.

import { DEMO, client, items, update } from "@lemma-plugins/kit";
import type { Incident, Settings } from "./types";

type Surface = { name: string; platform?: string; surface_type?: string; pod_connector?: string | null; config?: { channels?: { channel_id?: string | null; channel_name?: string | null }[] } };

async function slackSurface(): Promise<Surface | null> {
  const listed = items<Surface>(await client.podSurfaces.list(client.podId || "", { limit: 50 } as never));
  return listed.find((s) => String(s.platform || s.surface_type || "").toUpperCase() === "SLACK") || null;
}

/** The one place a channel is connected from the app: read the surface, append the route, PATCH it. */
export async function connectChannel(channelId: string, channelName: string): Promise<string | null> {
  try {
    const surface = await slackSurface();
    if (!surface) return "This Lemma has no Slack bot yet, so it can't hear the channel.";
    const routes = [...(surface.config?.channels || [])];
    if (routes.some((r) => r.channel_id === channelId)) return null;
    routes.push({ channel_id: channelId, channel_name: channelName });
    await client.podSurfaces.update(client.podId || "", surface.name, { config: { channels: routes } } as never);
    return null;
  } catch (e) {
    return `Couldn't connect #${channelName} to the Lemma: ${e instanceof Error ? e.message : e}`;
  }
}

async function findSchedule(name: string): Promise<string | undefined> {
  return items<{ id: string; name: string }>(await client.schedules.list({ name, limit: 5 } as never)).find((x) => x.name === name)?.id;
}

/** After declare, or when someone opens an incident that isn't wired: connect the channel and watch it. */
export async function wireIncident(inc: Incident, settings: Settings | null): Promise<string[]> {
  if (DEMO || !inc.channel_id || !inc.channel_name || inc.status === "resolved") return [];
  const problems: string[] = [];
  const patch: Record<string, unknown> = {};
  if (!inc.channel_connected) {
    const problem = await connectChannel(inc.channel_id, inc.channel_name);
    if (problem) problems.push(problem);
    else patch.channel_connected = true;
  }
  // The platform refuses a Slack schedule on a channel the Lemma's bot doesn't hear,
  // so the schedule comes only after the channel is connected.
  const connected = inc.channel_connected || patch.channel_connected === true;
  if (connected && !inc.channel_schedule_id && settings?.slack_team_id) {
    const name = `incidents-channel-${inc.number}`;
    try {
      const surface = await slackSurface().catch(() => null);
      const id = (await findSchedule(name)) || ((await client.schedules.create({
        name, schedule_type: "WEBHOOK", workflow_name: "incidents-on-message",
        // The trigger comes from the workflow's EVENT start; a workflow schedule may not name one.
        pod_connector: surface?.pod_connector || settings.slack_account || "slack",
        config: { team_id: settings.slack_team_id, channel_id: inc.channel_id },
      } as never)) as unknown as { id: string }).id;
      if (id) patch.channel_schedule_id = id;
    } catch {
      // Quietly: until Slack's channel trigger is live, the tick reads the channel every 15 minutes.
    }
  }
  if (Object.keys(patch).length) await update("incidents_incident", inc.id, patch).catch(() => undefined);
  return problems;
}

/** At resolve: the channel's schedule goes, by the person who can (its maker). */
export async function unwireIncident(inc: Incident): Promise<void> {
  if (DEMO || !inc.channel_schedule_id) return;
  try {
    await client.schedules.delete(inc.channel_schedule_id);
    await update("incidents_incident", inc.id, { channel_schedule_id: null });
  } catch {
    // Someone else made it; a resolved incident's messages are ignored anyway.
  }
}

const GITHUB_EVENTS: [string, string][] = [
  ["push", "incidents-on-push"], ["pull_request", "incidents-on-pull-request"],
  ["workflow_run", "incidents-on-workflow-run"], ["release", "incidents-on-release"],
  // ["deployment_status", "incidents-on-deployment-status"]: once the platform subscribes to it.
];

/** Set-up's schedules, made as the person: the 15-minute tick, and GitHub's events when repositories are watched. */
export async function ensureSchedules(settings: Settings, repos: number): Promise<{ made: Record<string, string>; problems: string[] }> {
  const made: Record<string, string> = {};
  const problems: string[] = [];
  if (DEMO) return { made, problems };
  try {
    const name = "incidents-tick";
    made[name] = (await findSchedule(name)) || ((await client.schedules.create({
      name, schedule_type: "TIME", workflow_name: "incidents-tick", config: { cron: "*/15 * * * *" },
    } as never)) as unknown as { id: string }).id;
  } catch (e) {
    problems.push(`the 15-minute check (${e instanceof Error ? e.message : e})`);
  }
  if (repos) {
    for (const [event, workflow] of GITHUB_EVENTS) {
      const name = `${workflow}-github`;
      try {
        made[name] = (await findSchedule(name)) || ((await client.schedules.create({
          // The trigger comes from the workflow's EVENT start; the platform adds the installation.
          name, schedule_type: "WEBHOOK", workflow_name: workflow, pod_connector: "github",
          config: { source: "github", event },
        } as never)) as unknown as { id: string }).id;
      } catch (e) {
        problems.push(`GitHub ${event.replace("_", " ")}s (${e instanceof Error ? e.message : e})`);
      }
    }
  }
  return { made, problems };
}
