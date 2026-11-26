// What only a person can do, done by the app as them, each step read back.
//
// Functions run with their grants, and no grant holds a table's public rows,
// a web widget, schedule.create or a contact's addresses. So, as the person:
//
//   open      early_access_signup takes rows from visitors who confirmed their
//             email with a code (contact-owned, stamped with their contact),
//             for the eight columns the page sends
//   checkin   early_access_checkin takes rows from anyone with the link, for
//             its six columns (the ref ties an answer to a tester)
//   widget    the Lemma's web widget, allowed on this app's address, chat off
//   triggers  early-access-signup and early-access-checkin, INSERT, taking rows
//             from outside: a bundle can't carry include_outside_rows, and
//             without it every visitor's row is dropped
//   sweep     this person's hourly early-access-sweep-<id>
//   page      the beta open, with its link (and the widget's key)
//
// and later: sending a note (Mail's draft approved, then mail_send_draft),
// and checking that the address on a sign-up is the one its contact proved.

import { DEMO, client, connectionProblem, errorText, runFunction, update, whoAmI } from "@lemma-plugins/kit";
import type { Beta, Draft, Step, Tester } from "./data";

const pod = () => client.podId as string;

export const SIGNUP_COLUMNS = ["beta_id", "email", "name", "company", "role", "use_for", "today", "ref"];
export const CHECKIN_COLUMNS = ["beta_id", "ref", "used", "worked", "got_in_way", "would_miss"];
export const WIDGET_NAME = "Early access";

/** A caught failure in words, never the platform's own text. */
export function why(e: unknown, connector?: string): string {
  const problem = connectionProblem(e, connector);
  if (problem) return problem.text;
  const err = e as { status?: number; statusCode?: number };
  const status = err?.status || err?.statusCode;
  if (status === 403) return "Lemma refused it: this needs edit access in this Lemma. Ask someone who runs it.";
  return errorText(e);
}

/** This app's own address, which the widget must allow and the links name. */
export function appOrigin(): string {
  const cfg = (window as unknown as { __LEMMA_CONFIG__?: { app?: { url?: string } } }).__LEMMA_CONFIG__;
  const url = cfg?.app?.url;
  if (url && /^https?:\/\//.test(url)) return new URL(url).origin;
  const dev = import.meta.env.VITE_EA_APP_ORIGIN as string | undefined;
  if (dev) return new URL(dev).origin;
  return window.location.origin;
}

export function pageLink(beta: Pick<Beta, "slug">, key: string | null | undefined): string {
  return `${appOrigin()}/${beta.slug}${key ? `?k=${key}` : ""}`;
}

interface Widget { id: string; name: string; public_key: string; allowed_origins: string[]; answer: string }

async function findSchedule(name: string): Promise<{ id: string; include_outside_rows?: boolean } | undefined> {
  const list = (await client.schedules.list({ name, limit: 5 } as never)) as unknown as { items?: { id: string; name: string }[] };
  return (list.items || []).find((x) => x.name === name);
}

async function trigger(name: string, table: string): Promise<boolean> {
  let found = await findSchedule(name);
  if (found) {
    await client.schedules.update(found.id, { include_outside_rows: true, is_active: true } as never);
  } else {
    found = (await client.schedules.create({
      name, schedule_type: "DATASTORE", workflow_name: name,
      config: { table_name: table, operations: ["INSERT"], bulk_writes: "each" }, include_outside_rows: true,
    } as never)) as unknown as { id: string };
  }
  const back = (await client.schedules.get(found!.id)) as unknown as { include_outside_rows?: boolean };
  return back.include_outside_rows === true;
}

/** Turn a beta's page on, each step read back. */
export async function turnOn(beta: Beta, onStep: (r: Step) => void): Promise<boolean> {
  const steps: Step[] = [];
  let ok = true;
  const say = (r: Step) => {
    const s = { ...r, at: new Date().toISOString() };
    ok = ok && r.ok;
    steps.push(s);
    onStep(s);
  };
  if (DEMO) {
    for (const [step, said] of [["open", "Sign-ups open to visitors who confirm their email."], ["checkin", "The check-in page takes answers."],
      ["widget", "The Lemma's web widget allows this page."], ["triggers", "Sign-ups and check-ins are handled as they arrive."],
      ["sweep", "Usage is read every hour."]] as const) say({ step, ok: true, said });
    await runFunction("early_access_setup_save", { beta_id: beta.id, state: "open", turned_on: steps });
    say({ step: "page", ok: true, said: "The page is on." });
    return true;
  }
  // 1. sign-ups, from confirmed contacts only. The bundle says contact_owned,
  // but a server-side install doesn't carry it, so it is set here.
  try {
    const table = await client.request<{ contact_owned?: boolean }>("GET", `/pods/${pod()}/datastore/tables/early_access_signup`);
    if (!table.contact_owned) {
      await client.request("PATCH", `/pods/${pod()}/datastore/tables/early_access_signup`, { body: { contact_owned: true, contact_columns: ["ref"] } });
    }
    await client.request("PUT", `/pods/${pod()}/datastore/tables/early_access_signup/public-rows`, { body: { audience: "contacts", columns: SIGNUP_COLUMNS } });
    const back = await client.request<{ audience: string | null; columns: string[] }>("GET", `/pods/${pod()}/datastore/tables/early_access_signup/public-rows`);
    const again = await client.request<{ contact_owned?: boolean }>("GET", `/pods/${pod()}/datastore/tables/early_access_signup`);
    const good = back.audience === "contacts" && SIGNUP_COLUMNS.every((c) => back.columns.includes(c)) && again.contact_owned === true;
    say({ step: "open", ok: good, said: good ? `Sign-ups open to visitors who confirm their email, for ${back.columns.length} fields; each names its visitor.`
      : "The sign-up table didn't stay open to confirmed visitors." });
  } catch (e) {
    say({ step: "open", ok: false, said: why(e) });
  }
  // 2. check-ins, from anyone with the link (each answer solves a proof first).
  try {
    await client.request("PUT", `/pods/${pod()}/datastore/tables/early_access_checkin/public-rows`, { body: { audience: "anyone", columns: CHECKIN_COLUMNS } });
    const back = await client.request<{ audience: string | null; columns: string[] }>("GET", `/pods/${pod()}/datastore/tables/early_access_checkin/public-rows`);
    say({ step: "checkin", ok: back.audience === "anyone", said: `The check-in page takes answers from the link in a tester's note, for ${back.columns.length} fields.` });
  } catch (e) {
    say({ step: "checkin", ok: false, said: why(e) });
  }
  // 3. the widget
  let key: string | null = beta.widget_key;
  try {
    const wanted = [...new Set([appOrigin(), window.location.origin])];
    const list = (await client.request<{ items: Widget[] }>("GET", `/pods/${pod()}/web-widgets`)).items || [];
    let widget = list.find((w) => w.name === WIDGET_NAME) || null;
    if (!widget) {
      widget = await client.request<Widget>("POST", `/pods/${pod()}/web-widgets`, {
        body: { name: WIDGET_NAME, agent_name: "pod_default", answer: "anyone", allowed_origins: wanted },
      });
    } else if (wanted.some((o) => !(widget!.allowed_origins || []).includes(o)) || widget.answer !== "anyone") {
      widget = await client.request<Widget>("PATCH", `/pods/${pod()}/web-widgets/${widget.id}`, {
        body: { allowed_origins: [...new Set([...(widget.allowed_origins || []), ...wanted])].slice(0, 20), answer: "anyone" },
      });
    }
    key = widget.public_key;
    say({ step: "widget", ok: true, said: "The Lemma's web widget allows this page and sends the email codes." });
  } catch (e) {
    say({ step: "widget", ok: false, said: why(e) });
  }
  // 4. the two triggers, read back
  try {
    const a = await trigger("early-access-signup", "early_access_signup");
    const b = await trigger("early-access-checkin", "early_access_checkin");
    say({ step: "triggers", ok: a && b, said: a && b ? "Sign-ups and check-ins are handled as they arrive (checked after they were made)."
      : "The triggers were made, but Lemma says they don't take visitors' rows: sign-ups would be dropped." });
  } catch (e) {
    say({ step: "triggers", ok: false, said: why(e) });
  }
  // 5. this person's hourly sweep
  try {
    const me = await whoAmI();
    const name = `early-access-sweep-${(me?.id || "me").replace(/-/g, "").slice(0, 8)}`;
    let found = await findSchedule(name);
    if (!found) {
      found = (await client.schedules.create({ name, schedule_type: "TIME", workflow_name: "early-access-sweep",
        config: { cron: "17 * * * *", timezone: "UTC" } } as never)) as unknown as { id: string };
    } else {
      await client.schedules.update(found.id, { is_active: true } as never);
    }
    say({ step: "sweep", ok: true, said: "Usage is read and notes are drafted every hour, as you." });
  } catch (e) {
    say({ step: "sweep", ok: false, said: why(e) });
  }
  // 6. the page
  try {
    const link = pageLink(beta, key);
    const out = await runFunction<{ ok: boolean; problem?: string }>("early_access_setup_save", {
      beta_id: beta.id, state: ok ? "open" : beta.state === "open" ? "open" : "draft", page_url: link, widget_key: key, turned_on: steps,
    });
    if (!out.ok) throw new Error(out.problem || "Not saved.");
    say({ step: "page", ok, said: ok ? "The page is on." : "Left off until the steps above work." });
    void runFunction("early_access_memory", {}).catch(() => undefined);
  } catch {
    say({ step: "page", ok: false, said: "The page wasn't switched on: saving the beta didn't go through. Press Save and turn on again." });
  }
  return ok;
}

/** Approve a note and hand it to Mail's sender. "Sent", or why not, in words. */
export async function sendDraft(d: Draft, body?: string): Promise<{ sent: boolean; message: string }> {
  if (!d.source_account) return { sent: false, message: "There's no mailbox to send it from. Set up your mail in Mail first; the note stays drafted." };
  const fields: Record<string, unknown> = { state: "approved" };
  if (body != null) fields.body = body;
  await update("draft", d.id, fields);
  try {
    const out = await runFunction<{ sent?: boolean; message?: string }>("mail_send_draft", { draft_id: d.id });
    return { sent: Boolean(out?.sent), message: out?.sent ? "Sent." : out?.message || "Not sent." };
  } catch (e) {
    return { sent: false, message: `Not sent: ${why(e)}` };
  }
}

/** One early-access-draft run per tester, in this person's mailbox. */
export async function startDrafts(kind: "invite" | "checkin" | "chase" | "not_now", testerIds: string[]): Promise<number> {
  if (!testerIds.length) return 0;
  const out = await runFunction<{ started?: number }>("early_access_draft", { mode: "start", kind, tester_ids: testerIds });
  return out?.started || 0;
}

interface Contact { identities?: { kind: string; value: string; strength?: string; verified_at?: string | null }[] }

/**
 * Whether each sign-up's address is the one its contact proved with a code.
 * A function can't read contacts; a member who may (an editor) can, so the
 * roster checks on open. A member who can't leaves them "not checked".
 */
export async function checkEmails(testers: Tester[]): Promise<number> {
  if (DEMO) return 0;
  let checked = 0;
  for (const t of testers.filter((x) => x.email_proof === "unchecked" && x.contact_id && !x.sample).slice(0, 40)) {
    try {
      const c = await client.request<Contact>("GET", `/pods/${pod()}/contacts/${t.contact_id}`);
      const proven = (c.identities || []).some((i) => i.kind?.toLowerCase() === "email" && i.value?.toLowerCase() === t.handle.toLowerCase()
        && (String(i.strength || "").toLowerCase() === "code" || !!i.verified_at));
      await update("early_access_tester", t.id, { email_proof: proven ? "code" : "not_confirmed" });
      checked += 1;
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 403 || status === 401) return checked;
    }
  }
  return checked;
}
