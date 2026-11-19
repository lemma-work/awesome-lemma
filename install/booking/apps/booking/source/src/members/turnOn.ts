// Turning a person's page on: what a bundle import cannot carry, done from the
// app as that person, each step checked after.
//
//   open     booking_request takes rows from confirmed visitors, for the seven
//            columns a page sends (once for the Lemma; needs edit access)
//   widget   the Lemma's web widget, answered by booking-host, open to anyone
//            (a visitor must be able to confirm an email to become a contact),
//            allowed on this app's address (once for the Lemma)
//   trigger  the person's own booking-request-<id>: INSERT on booking_request
//            where page_id is theirs, starting booking-confirm as them, with
//            include_outside_rows on. Read back after: a trigger without it
//            drops every visitor's row as FILTERED
//   refresh  the person's own booking-refresh-<id>, every 15 minutes
//   page     the link (with the widget's key) kept for decline emails; the
//            page on; its first open times

import { client, runFunction, update, whoAmI } from "@lemma-plugins/kit";
import type { Page, Settings } from "./data";

export const OPEN_COLUMNS = ["page_id", "starts_at", "name", "email", "about", "zone", "ref"];
/** What a visitor may read of their own requests (through the chat). */
export const CONTACT_COLUMNS = ["starts_at", "ends_at", "state", "reason", "join_url"];
export const WIDGET_NAME = "Booking page";

export interface StepResult {
  step: "open" | "widget" | "trigger" | "refresh" | "page";
  ok: boolean;
  said: string;
}

interface Widget {
  id: string;
  name: string;
  public_key: string;
  allowed_origins: string[];
  answer: string;
}

const pod = () => client.podId as string;

function why(e: unknown): string {
  const err = e as { status?: number; statusCode?: number; message?: string; body?: { message?: string } };
  const status = err?.status || err?.statusCode;
  const text = err?.body?.message || err?.message || String(e);
  if (status === 403) return `Lemma refused it (${text}). Turning a page on needs edit access in this Lemma; ask whoever runs it.`;
  return text;
}

/** This app's own address, which the widget must allow. */
export function appOrigin(): string {
  const cfg = (window as unknown as { __LEMMA_CONFIG__?: { app?: { url?: string } } }).__LEMMA_CONFIG__;
  const url = cfg?.app?.url;
  if (url && /^https?:\/\//.test(url)) return new URL(url).origin;
  // Development only: the dev server stands in for the hosted app, whose
  // address the links and the widget must still name.
  const dev = import.meta.env.VITE_BOOKING_APP_ORIGIN as string | undefined;
  if (dev) return new URL(dev).origin;
  return window.location.origin;
}

export async function findWidget(): Promise<Widget | null> {
  const list = (await client.request<{ items: Widget[] }>("GET", `/pods/${pod()}/web-widgets`)).items || [];
  return list.find((w) => w.name === WIDGET_NAME) || null;
}

export function pageLink(page: Page, key: string | null): string {
  return `${appOrigin()}/${page.handle}${key ? `?k=${key}` : ""}`;
}

export async function turnOn(settings: Settings, page: Page, onStep: (r: StepResult) => void): Promise<boolean> {
  const me = await whoAmI();
  const short = (me?.id || "me").replace(/-/g, "").slice(0, 8);
  let ok = true;
  const say = (r: StepResult) => {
    ok = ok && r.ok;
    onStep(r);
  };

  // 1. open the table to confirmed visitors, each row naming its visitor.
  // The bundle says contact_owned, but a server-side install doesn't carry it
  // (pod_bundle applier.py creates tables without it), so it is set here.
  try {
    const table = await client.request<{ contact_owned?: boolean }>("GET", `/pods/${pod()}/datastore/tables/booking_request`);
    if (!table.contact_owned) {
      await client.request("PATCH", `/pods/${pod()}/datastore/tables/booking_request`, {
        body: { contact_owned: true, contact_columns: CONTACT_COLUMNS },
      });
      const back = await client.request<{ contact_owned?: boolean }>("GET", `/pods/${pod()}/datastore/tables/booking_request`);
      if (!back.contact_owned) throw new Error("Lemma didn't keep booking_request as contact-owned.");
    }
    const now = await client.request<{ audience: string | null; columns: string[] }>(
      "GET", `/pods/${pod()}/datastore/tables/booking_request/public-rows`);
    const same = now.audience === "contacts" && OPEN_COLUMNS.every((c) => now.columns.includes(c)) && now.columns.length === OPEN_COLUMNS.length;
    if (!same) {
      await client.request("PUT", `/pods/${pod()}/datastore/tables/booking_request/public-rows`, {
        body: { audience: "contacts", columns: OPEN_COLUMNS },
      });
    }
    say({ step: "open", ok: true, said: same ? "Already open to confirmed visitors; each request names its visitor." : "Open to visitors who confirm their email; each request names its visitor." });
  } catch (e) {
    say({ step: "open", ok: false, said: why(e) });
  }

  // 2. the widget
  let key: string | null = null;
  try {
    const wanted = [...new Set([appOrigin(), window.location.origin])];
    let widget = await findWidget();
    if (!widget) {
      widget = await client.request<Widget>("POST", `/pods/${pod()}/web-widgets`, {
        body: { name: WIDGET_NAME, agent_name: "booking-host", answer: "anyone", allowed_origins: wanted },
      });
      say({ step: "widget", ok: true, said: "Made the Lemma's web widget for booking pages." });
    } else {
      const origins = widget.allowed_origins || [];
      if (wanted.some((o) => !origins.includes(o)) || widget.answer !== "anyone") {
        widget = await client.request<Widget>("PATCH", `/pods/${pod()}/web-widgets/${widget.id}`, {
          body: { allowed_origins: [...new Set([...origins, ...wanted])].slice(0, 20), answer: "anyone" },
        });
      }
      say({ step: "widget", ok: true, said: "The Lemma's web widget allows this page." });
    }
    key = widget.public_key;
  } catch (e) {
    say({ step: "widget", ok: false, said: why(e) });
  }

  // 3. the person's own trigger, taking rows from outside, read back
  const schedules = { ...(settings.schedules || {}) };
  const triggerName = `booking-request-${short}`;
  try {
    let id = schedules[triggerName];
    if (id) {
      await client.schedules.update(id, { include_outside_rows: true, is_active: true } as never).catch(() => {
        id = "";
      });
    }
    if (!id) {
      const made = (await client.schedules.create({
        name: triggerName,
        schedule_type: "DATASTORE",
        workflow_name: "booking-confirm",
        config: { table_name: "booking_request", operations: ["INSERT"], when: { page_id: page.id }, bulk_writes: "each" },
        include_outside_rows: true,
      } as never)) as unknown as { id: string };
      id = made.id;
      schedules[triggerName] = id;
    }
    const back = (await client.schedules.get(id)) as unknown as {
      id: string; include_outside_rows?: boolean; is_active?: boolean; config?: { when?: unknown };
    };
    const trigger = {
      id: back.id, name: triggerName, include_outside_rows: back.include_outside_rows === true,
      active: back.is_active !== false, when: back.config?.when ?? null, checked_at: new Date().toISOString(),
    };
    await update("booking_settings", settings.id, { schedules, trigger });
    say({
      step: "trigger",
      ok: trigger.include_outside_rows,
      said: trigger.include_outside_rows
        ? "Your new-booking trigger takes visitors' rows (checked after it was made)."
        : "Your trigger was made, but Lemma says it doesn't take visitors' rows: bookings would be dropped.",
    });
  } catch (e) {
    say({ step: "trigger", ok: false, said: why(e) });
  }

  // 4. the 15-minute refresh
  const refreshName = `booking-refresh-${short}`;
  try {
    if (!schedules[refreshName]) {
      const made = (await client.schedules.create({
        name: refreshName,
        schedule_type: "TIME",
        workflow_name: "booking-refresh",
        config: { cron: "*/15 * * * *", timezone: settings.timezone || "UTC" },
      } as never)) as unknown as { id: string };
      schedules[refreshName] = made.id;
      await update("booking_settings", settings.id, { schedules });
    } else {
      await client.schedules.update(schedules[refreshName], { is_active: true } as never);
    }
    say({ step: "refresh", ok: true, said: "Open times are worked out again every 15 minutes." });
  } catch (e) {
    say({ step: "refresh", ok: false, said: why(e) });
  }

  // 5. the page itself
  try {
    if (!ok) throw new Error("Left off until the steps above work.");
    await update("booking_settings", settings.id, { page_url: pageLink(page, key) });
    await update("booking_page", page.id, { state: "on" });
    const slots = await runFunction<{ open: number; days: number; message: string; errors: string[] }>("booking_slots", {});
    say({ step: "page", ok: !slots.errors?.length, said: slots.errors?.length ? slots.errors.join(" ") : `On, with ${slots.open} open times over ${slots.days} days.` });
  } catch (e) {
    say({ step: "page", ok: false, said: why(e) });
  }
  return ok;
}

/** Off: the page says it isn't taking bookings, and the person's schedules pause. */
export async function turnOff(settings: Settings, page: Page): Promise<void> {
  await update("booking_page", page.id, { state: "off" });
  for (const id of Object.values(settings.schedules || {})) {
    await client.schedules.update(id, { is_active: false } as never).catch(() => undefined);
  }
}
