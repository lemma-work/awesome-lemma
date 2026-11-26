// What only a person can do, done by the app as them.
//
// Functions run with their grants, and no grant holds `schedule.create`, a
// table's public rows, a web widget, a hook, contact outreach or another
// plugin's functions and tables. So, as the person, each step read back:
//
// - turning a website form on: its table opened to outsiders (public rows),
//   the Lemma's web widget, and the form's trigger with include_outside_rows
//   (a bundle can't carry that field, and without it every visitor's row is
//   dropped);
// - each member's own three schedules on their first visit (take, let go,
//   write): only a run as them can write their conversation, draft and
//   Today item;
// - the 15-minute read of a member's Google Forms;
// - sending the owner's draft (Mail's mail_send_draft, after a 10-second
//   undo), and a reply from the Lemma's address (contact outreach);
// - which plugins this Lemma has, kept in the set-up for the functions;
// - webhook doors (a hook and its trigger), once the webhook address is live.

import { DEMO, client, connectionProblem, errorText, items, runFunction, update } from "@lemma-plugins/kit";
import { call } from "./data";
import type { Answer, Draft, Form, Settings } from "./types";

const pod = () => client.podId as string;

/** A caught failure in words, never the platform's own text. */
export function why(e: unknown, connector?: string): string {
  const problem = connectionProblem(e, connector);
  if (problem) return problem.text;
  const err = e as { status?: number; statusCode?: number };
  const status = err?.status || err?.statusCode;
  const text = errorText(e);
  if (status === 403) return `Lemma refused it (${text}). This needs edit access in this Lemma; ask whoever runs it.`;
  return text;
}

export interface Step { step: string; ok: boolean; said: string }

/** The starter website forms: table, name, workflow. */
export const STARTERS: { table: string; name: string; workflow: string; note?: string }[] = [
  { table: "forms_contact", name: "Contact us", workflow: "forms-web-contact" },
  { table: "forms_demo", name: "Request a demo", workflow: "forms-web-demo" },
  { table: "forms_careers", name: "Careers", workflow: "forms-web-careers", note: "Everyone in the Lemma can read applications, CVs too. Leave it off until you want that." },
  { table: "forms_beta", name: "Beta sign-up", workflow: "forms-web-beta" },
];

/** Each starter's open columns, in order: what the form asks. */
export const COLUMNS: Record<string, { key: string; label: string; file?: boolean; hidden?: boolean }[]> = {
  forms_contact: [{ key: "name", label: "Your name" }, { key: "email", label: "Your email" }, { key: "company", label: "Company" },
    { key: "about", label: "What is it about?" }, { key: "message", label: "How can we help?" }, { key: "file", label: "A file, if it helps", file: true },
    { key: "page", label: "Page", hidden: true }, { key: "campaign", label: "Campaign", hidden: true }],
  forms_demo: [{ key: "name", label: "Your name" }, { key: "email", label: "Work email" }, { key: "company", label: "Company" },
    { key: "project", label: "What are you working on?" }, { key: "how_much", label: "How many do you need?" },
    { key: "message", label: "Anything else we should know?" }, { key: "drawings", label: "Drawings or a brief (optional)", file: true },
    { key: "page", label: "Page", hidden: true }, { key: "campaign", label: "Campaign", hidden: true }],
  forms_careers: [{ key: "name", label: "Your name" }, { key: "email", label: "Your email" }, { key: "company", label: "Where you work now (optional)" },
    { key: "role", label: "Which role?" }, { key: "cv", label: "Your CV", file: true }, { key: "notice", label: "When could you start?" },
    { key: "message", label: "Why this role?" }, { key: "page", label: "Page", hidden: true }, { key: "campaign", label: "Campaign", hidden: true }],
  forms_beta: [{ key: "name", label: "Your name" }, { key: "email", label: "Your email" }, { key: "company", label: "Company" },
    { key: "projects", label: "What would you try it on?" }, { key: "message", label: "Anything else?" },
    { key: "page", label: "Page", hidden: true }, { key: "campaign", label: "Campaign", hidden: true }],
};

export const WIDGET_NAME = "Forms";

interface Widget { id: string; name: string; public_key: string; allowed_origins: string[]; answer: string; page_url?: string }

/** The API's own address, for the hosted form link and the snippets. */
export function apiBase(): string {
  if (DEMO) return "https://api.lemma.work";
  const c = client as unknown as { apiUrl?: string; baseUrl?: string; config?: { apiUrl?: string } };
  return (c.apiUrl || c.baseUrl || c.config?.apiUrl || "").replace(/\/$/, "");
}

export function hostedLink(widgetKey: string | null | undefined, table: string): string | null {
  return widgetKey ? `${apiBase()}/public/web/${widgetKey}/page?table=${table}` : null;
}

async function findSchedule(name: string): Promise<{ id: string; include_outside_rows?: boolean } | undefined> {
  return items<{ id: string; name: string; include_outside_rows?: boolean }>(await client.schedules.list({ name, limit: 5 } as never))
    .find((x) => x.name === name);
}

async function makeSchedule(name: string, body: Record<string, unknown>): Promise<string> {
  const found = await findSchedule(name);
  if (found) return found.id;
  const made = (await client.schedules.create({ name, ...body } as never)) as unknown as { id: string };
  return made.id;
}

const short = (id: string) => id.replace(/-/g, "").slice(0, 8);

/** Turn a starter website form on, each step read back: public rows, the widget, the trigger, the door. */
export async function turnOnForm(table: string, me: string, audience: "anyone" | "contacts", ways: string[], origins: string[], onStep: (r: Step) => void): Promise<boolean> {
  let ok = true;
  const say = (r: Step) => { ok = ok && r.ok; onStep(r); };
  const starter = STARTERS.find((s) => s.table === table);
  if (!starter) return false;
  if (DEMO) {
    say({ step: "open", ok: true, said: "In the demo nothing is opened." });
    await call("forms_door_save", { source: "web", source_id: table, state: "on", held_by_user_id: me });
    return true;
  }
  // `page` and `campaign` are filled by the team's own page or product, never
  // typed: the hosted link would ask visitors for them (the platform draws
  // every open column), so they open only when the form is shared there.
  const hiddenToo = ways.some((w) => w !== "link");
  const columns = COLUMNS[table].filter((c) => hiddenToo || !c.hidden).map((c) => c.key);
  try {
    await client.request("PUT", `/pods/${pod()}/datastore/tables/${table}/public-rows`, { body: { audience, columns } });
    const back = await client.request<{ audience: string | null; columns: string[] }>("GET", `/pods/${pod()}/datastore/tables/${table}/public-rows`);
    say({ step: "open", ok: back.audience === audience, said: `${starter.name} takes answers from ${audience === "anyone" ? "anyone with the link" : "people who confirm their email"}, for ${back.columns.length} fields.` });
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
  let scheduleId = "";
  try {
    scheduleId = await makeSchedule(starter.workflow, {
      schedule_type: "DATASTORE", workflow_name: starter.workflow,
      config: { table_name: table, operations: ["INSERT"], bulk_writes: "each" }, include_outside_rows: true,
    });
    const back = (await client.schedules.get(scheduleId)) as unknown as { include_outside_rows?: boolean };
    say({ step: "trigger", ok: back.include_outside_rows === true,
      said: back.include_outside_rows ? "Each answer is filed as it arrives." : "The form's trigger was made, but Lemma says it doesn't take visitors' rows: answers would be dropped." });
  } catch (e) {
    say({ step: "trigger", ok: false, said: why(e) });
  }
  const url = hostedLink(widget?.public_key, table);
  await call("forms_door_save", {
    source: "web", source_id: table, name: starter.name, state: ok ? "on" : "broken", state_why: ok ? null : "It couldn't be turned on; open it to try again",
    held_by_user_id: me, source_account: widget?.id || null, audience, share: { ways, url },
    place: ways.includes("link") ? "Hosted link" : ways.includes("page") ? "On your page" : "In your product",
    fields: COLUMNS[table].filter((c) => !c.hidden).map((c, i) => ({ key: c.key, label: c.label, order: i, on: true })),
  }).catch(() => undefined);
  await call("forms_setup_save", { widget_id: widget?.id || null, widget_key: widget?.public_key || null, schedules: scheduleId ? { [starter.workflow]: scheduleId } : {} }).catch(() => undefined);
  return ok;
}

/** Stop a website form taking answers (its table closed), keeping its answers. */
export async function pauseForm(f: Form, by: string): Promise<void> {
  if (!DEMO && f.source === "web") await client.request("DELETE", `/pods/${pod()}/datastore/tables/${f.source_id}/public-rows`).catch(() => undefined);
  await call("forms_door_save", { source: f.source, source_id: f.source_id, state: "paused", state_why: `Paused by ${by}` });
}

/** Re-open a form's table with the columns the team keeps on. */
export async function setOpenColumns(f: Form, keys: string[]): Promise<void> {
  if (DEMO || f.source !== "web" || f.state !== "on") return;
  const hidden = (COLUMNS[f.source_id] || []).filter((c) => c.hidden).map((c) => c.key);
  await client.request("PUT", `/pods/${pod()}/datastore/tables/${f.source_id}/public-rows`, {
    body: { audience: f.audience || "anyone", columns: [...keys, ...hidden] },
  });
}

/** This member's own schedules, made on their first visit. */
export async function ensureMine(s: Settings | null, me: { id: string; name: string }): Promise<string[]> {
  const mine = s?.members.find((m) => m.user_id === me.id);
  if (DEMO || (mine?.schedules?.take && mine.schedules.let_go && mine.schedules.write)) return [];
  const x = short(me.id);
  const base = { table_name: "form_answer", operations: ["UPDATE"], bulk_writes: "each", rows: "OWNER_READABLE", run_as: "SCHEDULE_OWNER" };
  const made: Record<string, string> = {};
  const problems: string[] = [];
  const want: [string, string, string, Record<string, unknown>][] = [
    ["take", `forms-take-${x}`, "forms-take", { owner_user_id: { equals: me.id }, hand_version: { changed: true } }],
    ["let_go", `forms-let-go-${x}`, "forms-let-go", { owner_user_id: { from: me.id, changed: true } }],
    ["write", `forms-write-${x}`, "forms-write", { owner_user_id: { equals: me.id }, draft_state: { to: "wanted" } }],
  ];
  for (const [key, name, workflow, when] of want) {
    try {
      made[key] = await makeSchedule(name, { schedule_type: "DATASTORE", workflow_name: workflow, config: { ...base, when } });
    } catch (e) {
      problems.push(`${key.replace("_", " ")}: ${why(e)}`);
    }
  }
  await call("forms_setup_save", { member: { user_id: me.id, name: me.name, schedules: made } }).catch(() => undefined);
  return problems;
}

/** The 15-minute read of this member's Google Forms (and Meta, once checked). */
export async function ensurePoll(me: { id: string; name: string }): Promise<void> {
  if (DEMO) return;
  const id = await makeSchedule(`forms-poll-${short(me.id)}`, { schedule_type: "TIME", workflow_name: "forms-poll", config: { cron: "*/15 * * * *", timezone: "UTC" } });
  await call("forms_setup_save", { member: { user_id: me.id, name: me.name, schedules: { poll: id } } }).catch(() => undefined);
}

export const UNDO_MS = 10_000;

/** Approve the owner's draft now; Mail sends it once the undo window has passed. */
export async function approveDraft(d: Draft, body?: string): Promise<void> {
  const fields: Record<string, unknown> = { state: "approved", send_at: new Date(Date.now() + UNDO_MS).toISOString() };
  if (body != null) fields.body = body;
  await update("draft", d.id, fields);
}

export async function undoDraft(d: Draft): Promise<void> {
  await update("draft", d.id, { state: "proposed", send_at: null });
}

/** Mail's sender, after the undo window: "sent", or why not. */
export async function deliverDraft(d: Draft): Promise<{ sent: boolean; message: string }> {
  const out = await runFunction<{ sent?: boolean; message?: string }>("mail_send_draft", { draft_id: d.id });
  return { sent: Boolean(out?.sent), message: out?.message || (out?.sent ? "Sent." : "Not sent.") };
}

/** A reply from the Lemma's own address (contact outreach), for a confirmed contact. */
export async function replyFromLemma(a: Answer, text: string): Promise<string> {
  if (!a.contact_id) throw new Error("Only a confirmed contact can be written to from the Lemma's address.");
  if (!DEMO) await client.request("POST", `/pods/${pod()}/contacts/${a.contact_id}/outreach`, { body: { handle: a.handle, text } });
  const out = await call("forms_decide", { answer: a.id, action: "replied", via: "lemma_address" });
  return out.message || "Sent from the Lemma's address.";
}

async function exists(path: string): Promise<boolean> {
  try {
    await client.request("GET", path);
    return true;
  } catch {
    return false;
  }
}

/** Which of Forms' neighbours this Lemma has; kept in the set-up when it changes. */
export async function detectPlugins(s: Settings | null): Promise<Record<string, boolean>> {
  if (DEMO) return s?.plugins || { triage: true, deals: true, leads: true, people: true };
  const [triage, deals, leads, people] = await Promise.all([
    exists(`/pods/${pod()}/functions/triage_report_add`),
    exists(`/pods/${pod()}/functions/deals_save`),
    exists(`/pods/${pod()}/functions/leads_request`),
    exists(`/pods/${pod()}/functions/people_refresh`),
  ]);
  const plugins = { triage, deals, leads, people };
  if (JSON.stringify(plugins) !== JSON.stringify(s?.plugins || {})) await call("forms_setup_save", { plugins }).catch(() => undefined);
  return plugins;
}

/* ---------- webhook doors (lemma-platform#1255) ---------- */

export const HOOK_SOURCES: { source: string; name: string; idPath: string }[] = [
  { source: "typeform", name: "Typeform", idPath: "form_response.token" },
  { source: "tally", name: "Tally", idPath: "data.responseId" },
  { source: "webflow", name: "Webflow", idPath: "payload.id" },
  { source: "fillout", name: "Fillout", idPath: "submission.submissionId" },
  { source: "google_ads", name: "Google Ads lead forms", idPath: "lead_id" },
  { source: "zapier", name: "LinkedIn, through Zapier or Make", idPath: "id" },
];

/** Whether this Lemma has the webhook address yet: false until it is live here. */
export async function hooksLive(): Promise<boolean> {
  if (DEMO) return false;
  return exists(`/pods/${pod()}/datastore/hooks`);
}

export interface IssuedHook { name: string; url: string; secret: string }

/** Make a webhook door: the hook (its address shown once), its trigger, and the door. */
export async function makeHook(source: string, label: string, me: string): Promise<IssuedHook> {
  const spec = HOOK_SOURCES.find((h) => h.source === source);
  if (!spec) throw new Error("Not a form tool Forms reads.");
  const name = `${source.replace("_", "-")}-${Math.random().toString(36).slice(2, 7)}`;
  const hook = await client.request<{ name: string; url: string; secret: string }>("POST", `/pods/${pod()}/datastore/hooks`, {
    body: { name, table: "forms_hooked", fields: { payload: "$", delivery_id: spec.idPath } },
  });
  const sched = await makeSchedule("forms-hooked", {
    schedule_type: "DATASTORE", workflow_name: "forms-hooked",
    config: { table_name: "forms_hooked", operations: ["INSERT"], bulk_writes: "each" }, include_outside_rows: true,
  });
  await call("forms_door_save", { source, source_id: name, name: label || spec.name, state: "on", held_by_user_id: me, place: `${spec.name} · webhook` });
  await call("forms_setup_save", { schedules: { "forms-hooked": sched } }).catch(() => undefined);
  return { name: hook.name, url: hook.url, secret: hook.secret };
}

/** A Google Form's id from its edit link: the part after /forms/d/ and before /edit. */
export function googleFormId(link: string): string | null {
  const m = /\/forms\/d\/(?!e\/)([A-Za-z0-9_-]{20,})/.exec(link.trim());
  return m ? m[1] : null;
}
