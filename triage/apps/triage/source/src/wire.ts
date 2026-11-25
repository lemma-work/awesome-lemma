// What only a person can do, done by the app as them.
//
// Functions run with their grants, and no grant holds `schedule.create`, a
// table's public rows, a web widget, a table's visibility, opening a function
// to contacts, contact outreach, or another plugin's functions and tables
// (a bundle's grants may name only its own parts). So, as the person:
//
// - set-up's schedules: one WEBHOOK schedule per GitHub event (filtered to
//   the watched repositories by triage_on_github), the Slack channel trigger
//   (lemma-platform#1245; refused until it merges, and the 15-minute poll
//   reads the channels meanwhile), and the person's own Today refresh;
// - the report form: triage_form opened to visitors, the Lemma's web
//   widget, the form's own trigger with include_outside_rows (a bundle can't
//   carry that field), triage_known marked Public, and triage_join_known
//   opened to contacts for the chat beside the form;
// - writing to a form reporter (contact outreach) when their item is fixed
//   or declined;
// - which plugins this Lemma has, and Sprints' days away, kept in the set-up
//   so functions can use them;
// - Declare (Incidents), Give to Coding agent, and Dependency updates.

import { DEMO, client, items, q, runFunction, sql } from "@lemma-plugins/kit";
import { call } from "./data";
import type { Ask, Item, Report, Settings, SourceStatus } from "./types";

const pod = () => client.podId as string;

export function why(e: unknown): string {
  const err = e as { status?: number; statusCode?: number; message?: string; body?: { message?: string; detail?: string } };
  const status = err?.status || err?.statusCode;
  const text = err?.body?.message || err?.body?.detail || err?.message || String(e);
  if (status === 403) return `Lemma refused it (${text}). This needs edit access in this Lemma; ask whoever runs it.`;
  return text;
}

async function exists(path: string): Promise<boolean> {
  try {
    await client.request("GET", path);
    return true;
  } catch {
    return false;
  }
}

/** Which of Triage's neighbours this Lemma has. */
export async function detectPlugins(): Promise<Record<string, boolean>> {
  if (DEMO) return { incidents: true, coding: true, release_notes: false, dependency_updates: true, sprints: false };
  const [incidents, coding, release_notes, dependency_updates, sprints] = await Promise.all([
    exists(`/pods/${pod()}/functions/incidents_declare`),
    exists(`/pods/${pod()}/functions/coding_start`),
    exists(`/pods/${pod()}/datastore/tables/release_note`),
    exists(`/pods/${pod()}/functions/deps_decide`),
    exists(`/pods/${pod()}/datastore/tables/sprints_away`),
  ]);
  return { incidents, coding, release_notes, dependency_updates, sprints };
}

/** Sprints' days away for the next 30 days, while Sprints keeps its own table. */
async function sprintsAway(): Promise<Settings["sprints_away"] | null> {
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  try {
    const days = await q<{ member_id: string | null; name: string; day: string; part: string }>(
      `SELECT member_id, name, day, part FROM sprints_away WHERE day >= ${sql(today)} AND day <= ${sql(until)} ORDER BY day LIMIT 1000`);
    return { read_at: new Date().toISOString(), days: days.map((d) => ({ ...d, day: String(d.day).slice(0, 10) })) };
  } catch {
    return null;
  }
}

/** On open: keep what a function can't look up (plugins, Sprints' days) current in the set-up. */
export async function keepSeen(s: Settings): Promise<void> {
  if (DEMO) return;
  const plugins = await detectPlugins();
  const patch: Record<string, unknown> = {};
  if (JSON.stringify(plugins) !== JSON.stringify(s.plugins || {})) patch.plugins = plugins;
  const stale = !s.sprints_away?.read_at || Date.now() - Date.parse(s.sprints_away.read_at) > 3_600_000;
  if (plugins.sprints && stale) {
    const got = await sprintsAway();
    if (got) patch.sprints_away = got;
  }
  if (Object.keys(patch).length) await runFunction("triage_setup_save", patch).catch(() => undefined);
}

async function findSchedule(name: string): Promise<{ id: string; include_outside_rows?: boolean } | undefined> {
  return items<{ id: string; name: string; include_outside_rows?: boolean }>(await client.schedules.list({ name, limit: 5 } as never))
    .find((x) => x.name === name);
}

export const GITHUB_EVENTS: { event: string; workflow: string; door: string; needs?: string }[] = [
  { event: "issues", workflow: "triage-github-issues", door: "github" },
  { event: "issue_comment", workflow: "triage-github-issue-comment", door: "github" },
  { event: "dependabot_alert", workflow: "triage-github-dependabot-alert", door: "dependabot", needs: "lemma-platform#1246" },
  { event: "code_scanning_alert", workflow: "triage-github-code-scanning-alert", door: "code_scanning", needs: "Triage's GitHub fix" },
  { event: "secret_scanning_alert", workflow: "triage-github-secret-scanning-alert", door: "secret_scanning", needs: "Triage's GitHub fix" },
];

/** Set-up's schedules, made as the person. Returns what was made and each door's state in words. */
export async function ensureSchedules(s: Settings, meId: string | null, inRotation: boolean): Promise<{ problems: string[]; status: Record<string, SourceStatus> }> {
  const made: Record<string, string> = {};
  const problems: string[] = [];
  const status: Record<string, SourceStatus> = {};
  if (DEMO) return { problems, status };
  if (s.repos.length) {
    for (const g of GITHUB_EVENTS) {
      const name = `${g.workflow}`;
      try {
        made[name] = (await findSchedule(name))?.id || ((await client.schedules.create({
          name, schedule_type: "WEBHOOK", workflow_name: g.workflow, pod_connector: "github",
          connector_trigger_id: `github:http:${g.event}`, config: { source: "github", event: g.event },
        } as never)) as unknown as { id: string }).id;
        if (g.door !== "github") status[g.door] = { state: "live", note: null };
      } catch (e) {
        if (g.needs) {
          status[g.door] = { state: "waiting", note: `Not live yet: needs ${g.needs}. Read every 15 minutes once GitHub allows it.` };
        } else {
          problems.push(`GitHub ${g.event.replace("_", " ")} (${why(e)})`);
        }
      }
    }
    if (!problems.length) status.github = { state: "live", note: null };
  }
  if (s.slack.channels?.length) {
    const name = "triage-slack";
    try {
      made[name] = (await findSchedule(name))?.id || ((await client.schedules.create({
        name, schedule_type: "WEBHOOK", workflow_name: "triage-slack", pod_connector: s.slack.account || "slack",
        connector_trigger_id: "slack:http:slack_channel_message", config: { team_id: s.slack.team_id || null },
      } as never)) as unknown as { id: string }).id;
      status.slack = { state: "live", note: null };
    } catch {
      status.slack = { state: "every_15", note: "Read every 15 minutes until Slack's channel trigger is live (lemma-platform#1245)" };
    }
  }
  if (inRotation && meId) {
    const name = `triage-needs-you-${meId.replace(/-/g, "").slice(0, 8)}`;
    try {
      made[name] = (await findSchedule(name))?.id || ((await client.schedules.create({
        name, schedule_type: "TIME", workflow_name: "triage-needs-you", config: { cron: "*/15 * * * *", timezone: "UTC" },
      } as never)) as unknown as { id: string }).id;
    } catch (e) {
      problems.push(`your Today refresh (${why(e)})`);
    }
  }
  if (Object.keys(made).length || Object.keys(status).length) {
    await runFunction("triage_setup_save", { schedules: made, status, schedule_user_id: meId }).catch(() => undefined);
  }
  return { problems, status };
}

export const FORM_COLUMNS = ["what_happened", "expected", "steps", "how_bad", "where_url", "screenshot", "email", "app_version", "browser", "page"];
export const WIDGET_NAME = "Triage report form";

interface Widget { id: string; name: string; public_key: string; allowed_origins: string[]; answer: string; page_url?: string }

export interface Step { step: string; ok: boolean; said: string }

/** Turn the report form on, each step read back: public rows, the widget, the trigger, Public known issues, the chat's function. */
export async function turnOnForm(s: Settings, audience: "anyone" | "contacts", columns: string[], origins: string[], onStep: (r: Step) => void): Promise<boolean> {
  let ok = true;
  const say = (r: Step) => { ok = ok && r.ok; onStep(r); };
  if (DEMO) {
    say({ step: "open", ok: true, said: "In the demo nothing is opened." });
    return true;
  }
  const cols = columns.length ? columns : FORM_COLUMNS;
  try {
    await client.request("PUT", `/pods/${pod()}/datastore/tables/triage_form/public-rows`, { body: { audience, columns: cols } });
    const back = await client.request<{ audience: string | null; columns: string[] }>("GET", `/pods/${pod()}/datastore/tables/triage_form/public-rows`);
    say({ step: "open", ok: back.audience === audience, said: `The form takes answers from ${audience === "anyone" ? "anyone with the link" : "people who confirm their email"}, for ${back.columns.length} fields.` });
  } catch (e) {
    say({ step: "open", ok: false, said: why(e) });
  }
  let widget: Widget | null = null;
  try {
    const list = (await client.request<{ items: Widget[] }>("GET", `/pods/${pod()}/web-widgets`)).items || [];
    widget = list.find((w) => w.name === WIDGET_NAME) || null;
    const wanted = [...new Set(origins.filter(Boolean))].slice(0, 20);
    if (!widget) {
      widget = await client.request<Widget>("POST", `/pods/${pod()}/web-widgets`, {
        body: { name: WIDGET_NAME, agent_name: "pod_default", answer: "anyone", allowed_origins: wanted },
      });
    } else if (wanted.some((o) => !(widget!.allowed_origins || []).includes(o))) {
      widget = await client.request<Widget>("PATCH", `/pods/${pod()}/web-widgets/${widget.id}`, {
        body: { allowed_origins: [...new Set([...(widget.allowed_origins || []), ...wanted])].slice(0, 20) },
      });
    }
    say({ step: "widget", ok: true, said: "The Lemma's web widget draws the form, with its chat beside it." });
  } catch (e) {
    say({ step: "widget", ok: false, said: why(e) });
  }
  try {
    const name = "triage-form-added";
    let found = await findSchedule(name);
    if (!found) {
      found = (await client.schedules.create({
        name, schedule_type: "DATASTORE", workflow_name: "triage-form-added",
        config: { table_name: "triage_form", operations: ["INSERT"], bulk_writes: "each" }, include_outside_rows: true,
      } as never)) as unknown as { id: string };
    }
    const back = (await client.schedules.get(found!.id)) as unknown as { include_outside_rows?: boolean };
    say({ step: "trigger", ok: back.include_outside_rows === true,
      said: back.include_outside_rows ? "Each answer is filed as it arrives." : "The form's trigger was made, but Lemma says it doesn't take visitors' rows: answers would be dropped." });
    await runFunction("triage_setup_save", { schedules: { [name]: found!.id } }).catch(() => undefined);
  } catch (e) {
    say({ step: "trigger", ok: false, said: why(e) });
  }
  let knownPublic = false;
  try {
    await client.request("PATCH", `/pods/${pod()}/datastore/tables/triage_known`, { body: { visibility: "PUBLIC" } });
    knownPublic = true;
    say({ step: "known", ok: true, said: "Known issues are readable by the form, so it can say “we know about this”." });
  } catch (e) {
    say({ step: "known", ok: false, said: why(e) });
  }
  try {
    await client.request("PUT", `/pods/${pod()}/functions/triage_join_known/contacts`, { body: { contacts_invoke: true } });
    say({ step: "chat", ok: true, said: "The chat beside the form can add someone to a known issue." });
  } catch (e) {
    // Not needed for the form itself: the chat then only talks.
    onStep({ step: "chat", ok: true, said: `The chat beside the form only talks (${why(e)}).` });
  }
  const link = widget ? widget.page_url || `${(client as unknown as { apiUrl?: string }).apiUrl || ""}/public/web/${widget.public_key}/page?table=triage_form` : null;
  await runFunction("triage_setup_save", {
    form_on: ok, form_audience: audience, form_columns: cols, widget_key: widget?.public_key || null, widget_id: widget?.id || null,
    form_link: link, known_public: knownPublic,
  }).catch(() => undefined);
  return ok;
}

export async function turnOffForm(): Promise<void> {
  if (DEMO) return;
  await client.request("DELETE", `/pods/${pod()}/datastore/tables/triage_form/public-rows`).catch(() => undefined);
  await runFunction("triage_setup_save", { form_on: false }).catch(() => undefined);
}

/** Tell people who used the form, by contact outreach as the person. Returns how many were told and why the rest weren't. */
export async function tellFormAsks(item: Item, asks: Ask[], reports: Report[], text: string, state: "told" | "declined"): Promise<{ told: string[]; left: string[] }> {
  const told: string[] = [];
  const left: string[] = [];
  for (const a of asks) {
    const rep = reports.find((r) => r.door === "form" && r.source_id === a.source_id);
    const contact = (rep as unknown as { contact_id?: string | null })?.contact_id;
    if (DEMO) {
      told.push(a.id);
      continue;
    }
    if (!contact || a.handle_kind !== "email") {
      left.push(`${a.name || a.handle}: no confirmed email to write to`);
      continue;
    }
    try {
      await client.request("POST", `/pods/${pod()}/contacts/${contact}/outreach`, { body: { handle: a.handle, text } });
      told.push(a.id);
    } catch (e) {
      left.push(`${a.name || a.handle}: ${why(e)}`);
    }
  }
  if (told.length) {
    await call("triage_decide", { item: item.id, action: "record", event_kind: "told",
      text: `Wrote to ${told.length} ${told.length === 1 ? "person" : "people"} who used the form, by email from the Lemma's mailbox.`,
      detail: { ask_ids: told, state } }).catch(() => undefined);
  }
  return { told, left };
}

/** Declare an incident from an item (Incidents' agreed arguments). */
export async function declareIncident(item: Item): Promise<{ number?: number; message: string }> {
  const out = await runFunction<{ number?: number; message?: string; incident_id?: string }>("incidents_declare", {
    source: "triage", source_id: item.id, source_url: `/i/${item.number}`, source_label: `T-${item.number} ${item.title}`,
    title: item.title, ...(item.reach_people != null ? { people_affected: item.reach_people, people_source: item.doors.includes("sentry") ? "sentry" : "posthog" } : {}),
    ...(item.repo ? { service: item.repo } : {}), ...(item.first_seen ? { started_at: item.first_seen } : {}),
  });
  await call("triage_decide", { item: item.id, action: "record", event_kind: "declared",
    text: `Declared as an incident${out?.number ? `: INC-${out.number}` : ""}.`, detail: { incident: out?.number || null } }).catch(() => undefined);
  return { number: out?.number, message: out?.message || "Declared." };
}

/** Give an accepted item's task to Coding agent. */
export async function giveToCoding(item: Item, taskId: string): Promise<string> {
  const out = await runFunction<{ ok?: boolean; message?: string }>("coding_start", {
    title: `T-${item.number} ${item.title}`, task_id: taskId, repo: item.repo || "", source: "triage", source_url: `/i/${item.number}`,
    brief: [item.summary, item.fix_hint ? `Fix hint: ${item.fix_hint}` : "", item.paths.length ? `Where: ${item.paths.join(", ")}` : ""]
      .filter(Boolean).join("\n\n") || item.title,
  });
  await call("triage_decide", { item: item.id, action: "record", event_kind: "agent", text: "Given to Coding agent." }).catch(() => undefined);
  return out?.message || "Given to Coding agent.";
}
