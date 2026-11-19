// Today's working set, kept fresh by the change stream (the kit's
// DataProvider). Every table is per person, so all of it is the signed-in
// person's own. Today reads only needs_you, its own tables and the platform's
// Needs you; it knows nothing of the plugins that write the list.

import { client, create, items, q, update, type Loaders } from "@lemma-plugins/kit";
import type { Item, PlatformAsk, Settings } from "./types";

/** Local midnight, `days` from today. */
export function dayStart(days = 0): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

export const LOADERS: Loaders = {
  settings: { sql: "select * from today_settings order by created_at limit 1", tables: ["today_settings"] },
  items: {
    sql:
      "select n.* from needs_you n " +
      "where n.state = 'open' or (n.state = 'snoozed' and n.snoozed_until <= now()) order by n.due_at asc nulls last limit 600",
    tables: ["needs_you"],
  },
  // The platform's own Needs you: questions, approvals and forms waiting on
  // the person anywhere in this Lemma. Null when it cannot be read.
  platform: {
    load: async () => {
      try {
        const inbox = (await client.channels.inbox(client.podId || "")) as unknown as { waiting?: PlatformAsk[] };
        return (inbox.waiting || []).filter((w) => w.message?.question && ["OPEN", "ANSWERING"].includes(w.message.question.state));
      } catch {
        return null;
      }
    },
    tables: [],
  },
};

export type { Item, PlatformAsk, Settings };

/** Change one item: Today writes only the person's own state on it. */
export function setItem(id: string, patch: Record<string, unknown>): Promise<void> {
  return update("needs_you", id, patch);
}

/** The person's own morning schedule: the day is checked at that time, as them. */
export async function saveMorning(settings: Settings | null, me: { id: string; name: string | null } | null, at: string, zone: string): Promise<Settings> {
  const [h, m] = at.split(":").map((n) => Number(n));
  const cron = `${m || 0} ${h || 0} * * *`;
  const name = `today-morning-${(me?.id || "me").slice(0, 8)}`;
  let scheduleId = settings?.schedule_id || null;
  if (scheduleId) {
    try {
      await client.schedules.update(scheduleId, { config: { cron, timezone: zone } } as never);
    } catch {
      scheduleId = null;
    }
  }
  if (!scheduleId) {
    const existing = items<{ id: string; name: string }>(await client.schedules.list({ name, limit: 5 } as never)).find((s) => s.name === name);
    if (existing) {
      await client.schedules.update(existing.id, { config: { cron, timezone: zone } } as never);
      scheduleId = existing.id;
    } else {
      const made = (await client.schedules.create({ name, schedule_type: "TIME", workflow_name: "today-sweep", config: { cron, timezone: zone } } as never)) as unknown as { id: string };
      scheduleId = made.id;
    }
  }
  const patch = { morning_at: at, timezone: zone, schedule_id: scheduleId, display_name: settings?.display_name || me?.name || null, setup_step: "done" };
  if (settings) {
    await update("today_settings", settings.id, patch);
    return { ...settings, ...patch } as Settings;
  }
  return create<Settings>("today_settings", { ...patch, setup_done_at: new Date().toISOString() });
}

/** Check the day now: one run of the person's own morning schedule. */
export async function checkNow(settings: Settings | null): Promise<void> {
  if (!settings?.schedule_id) throw new Error("Choose a morning time first.");
  await client.schedules.runNow(settings.schedule_id);
}

/** Lemma's own address for a chat, from the sign-in address the app was given. */
export function chatLink(ask: PlatformAsk): string | null {
  try {
    const origin = new URL(client.authUrl).origin;
    const word = ask.channel.kind === "GROUP" ? "groups" : ask.channel.kind === "CONTACT" ? "contacts" : "chats";
    return `${origin}/l/${encodeURIComponent(client.podId || "")}/${word}/${encodeURIComponent(ask.channel.id)}`;
  } catch {
    return null;
  }
}

export { q };
