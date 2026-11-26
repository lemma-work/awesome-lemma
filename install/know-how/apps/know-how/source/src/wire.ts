// What only a person can do, done by the app as them.
//
// Functions run with their grants, and no grant holds `schedule.create`, a
// table's visibility, a folder's access, opening a function to contacts,
// contact outreach, or a notice to another member. So, as the person:
//
// - set-up: `article` marked Public when customers or the public are on;
//   knowhow_answer_for_contact and knowhow_missing opened to contacts; a
//   restricted topic's folder made RESTRICTED, read by its role; the
//   knowhow-sweep schedule and the Slack channel trigger;
// - each person, on first open: their own knowhow-mine-<id> schedule;
// - telling people: members who asked, by a line in their own Lemma channel;
//   customers who asked, by contact outreach from the Lemma's mailbox;
// - uploads to /know-how/_inbox/, and reading a page's file.

import { DEMO, client, connectionProblem, errorText, items, runFunction } from "@lemma-plugins/kit";
import { call, type Settings, type Topic } from "./data";

const pod = () => client.podId as string;
const enc = encodeURIComponent;

/** A caught failure in words: a connection problem as the kit says it, never the platform's own text. */
export function why(e: unknown, connector?: string): string {
  const problem = connectionProblem(e, connector);
  if (problem) return problem.text;
  const err = e as { status?: number; statusCode?: number; body?: { message?: string; detail?: string } };
  const status = err?.status || err?.statusCode;
  const text = errorText(err?.body?.message || err?.body?.detail ? { message: err.body!.message || err.body!.detail } : e);
  if (status === 403) return `Lemma refused it (${text}). This needs edit access in this Lemma; ask whoever runs it.`;
  return text;
}

/** A page's text, read as the person. */
export async function readPage(path: string): Promise<string> {
  const blob = await client.files.download(path);
  return typeof blob === "string" ? blob : await (blob as Blob).text();
}

export async function uploadToInbox(files: File[], onEach: (name: string, ok: boolean, said: string) => void): Promise<number> {
  let n = 0;
  if (DEMO) {
    files.forEach((f) => onEach(f.name, true, "In the demo nothing is uploaded."));
    return files.length;
  }
  for (const f of files) {
    try {
      await client.files.upload(f, { directoryPath: "/know-how/_inbox", name: f.name, searchEnabled: true });
      n += 1;
      onEach(f.name, true, "Saved to the inbox.");
    } catch (e) {
      onEach(f.name, false, why(e));
    }
  }
  return n;
}

async function findSchedule(name: string): Promise<string | undefined> {
  return items<{ id: string; name: string }>(await client.schedules.list({ name, limit: 5 } as never)).find((x) => x.name === name)?.id;
}

const user8 = (id: string) => id.replace(/-/g, "").slice(0, 8);

export interface Step { step: string; ok: boolean; said: string }

/** After the set-up run: what only the person can do, each step read back. */
export async function finishSetup(s: Settings, topics: Topic[], roles: { id: string; name: string }[], meId: string | null, onStep: (r: Step) => void): Promise<boolean> {
  let ok = true;
  const say = (r: Step) => { ok = ok && r.ok; onStep(r); };
  const made: Record<string, unknown> = {};
  const schedules: Record<string, string> = {};
  if (DEMO) {
    say({ step: "public", ok: true, said: "In the demo nothing is changed." });
    return true;
  }
  if (s.audiences.customers || s.audiences.public) {
    try {
      await client.request("PATCH", `/pods/${pod()}/datastore/tables/article`, { body: { visibility: "PUBLIC" } });
      made.article_public = true;
      say({ step: "public", ok: true, said: "Customer answers (the shared article table) are readable by customers' runs." });
    } catch (e) {
      say({ step: "public", ok: false, said: `Couldn't mark the customer answers Public: ${why(e)}` });
    }
    const opened: string[] = [];
    for (const name of ["knowhow_answer_for_contact", "knowhow_missing"]) {
      try {
        await client.request("PUT", `/pods/${pod()}/functions/${name}/contacts`, { body: { contacts_invoke: true } });
        opened.push(name);
      } catch (e) {
        say({ step: "contacts", ok: false, said: `Couldn't let customers' runs use ${name}: ${why(e)}` });
      }
    }
    made.contact_functions = opened;
    if (opened.length === 2) say({ step: "contacts", ok: true, said: "A customer on email, Slack Connect or the web chat is answered only from checked answers meant for customers." });
  }
  for (const t of topics.filter((x) => x.audience_default === "restricted" && x.restricted_role)) {
    const role = roles.find((r) => r.name.toLowerCase() === String(t.restricted_role).toLowerCase());
    const folder = t.folder_path.replace(/\/$/, "");
    try {
      await client.files.update(folder, { visibility: "RESTRICTED" });
      if (role) {
        // By the role's own grants: the resource-access route can't take a
        // folder's path (its slashes split the address), so the folder's read
        // is added to what the role already holds.
        const now = await client.request<{ grants?: { resource_type: string; resource_name: string; permission_ids: string[] }[] }>(
          "GET", `/pods/${pod()}/roles/${enc(role.name)}/permissions`);
        const grants = (now.grants || []).filter((g) => !(g.resource_type === "folder" && g.resource_name === folder));
        await client.request("PUT", `/pods/${pod()}/roles/${enc(role.name)}/permissions`,
          { body: { grants: [...grants, { resource_type: "folder", resource_name: folder, permission_ids: ["folder.read"] }] } });
      }
      say({ step: `restrict:${t.slug}`, ok: !!role, said: role ? `${t.name} is read only by ${role.name}.` : `${t.name} is restricted, but there's no role named ${t.restricted_role} to read it.` });
      made[`restricted:${t.slug}`] = role?.name || null;
    } catch (e) {
      say({ step: `restrict:${t.slug}`, ok: false, said: `Couldn't restrict ${t.name}: ${why(e)}` });
    }
  }
  try {
    const name = "knowhow-sweep";
    schedules[name] = (await findSchedule(name)) || ((await client.schedules.create({
      name, schedule_type: "TIME", workflow_name: "knowhow-sweep", config: { cron: "30 6 * * *", timezone: s.timezone || "UTC" },
    } as never)) as unknown as { id: string }).id;
    say({ step: "sweep", ok: true, said: "Each morning, questions the Lemma didn't log are found in the chats you can see." });
  } catch (e) {
    say({ step: "sweep", ok: false, said: `Couldn't make the daily sweep: ${why(e)}` });
  }
  if (meId && s.places.slack_channels?.length) {
    const name = `knowhow-slack-${user8(meId)}`;
    try {
      schedules[name] = (await findSchedule(name)) || ((await client.schedules.create({
        name, schedule_type: "WEBHOOK", workflow_name: "knowhow-slack", pod_connector: "slack",
        connector_trigger_id: "slack:http:slack_channel_message", config: {},
      } as never)) as unknown as { id: string }).id;
      say({ step: "slack", ok: true, said: `Listening in ${s.places.slack_channels.map((c) => `#${c.name}`).join(", ")}.` });
    } catch (e) {
      say({ step: "slack", ok: false, said: `Couldn't listen in Slack: ${why(e, "slack")}` });
    }
  }
  await runFunction("knowhow_setup_save", { schedules, made }).catch(() => undefined);
  return ok;
}

/** Each person's own Today refresh, made as them on their first open. */
export async function ensureMine(meId: string): Promise<string | null> {
  if (DEMO) return null;
  const name = `knowhow-mine-${user8(meId)}`;
  try {
    const id = (await findSchedule(name)) || ((await client.schedules.create({
      name, schedule_type: "TIME", workflow_name: "knowhow-mine", config: { cron: "*/15 * * * *", timezone: "UTC" },
    } as never)) as unknown as { id: string }).id;
    await runFunction("knowhow_me_save", { schedule_name: name }).catch(() => undefined);
    await runFunction("knowhow_setup_save", { schedules: { [name]: id } }).catch(() => undefined);
    return name;
  } catch {
    return null;
  }
}

/** Is the Lemma's Teams connection on? Read from its surfaces. */
export async function teamsOn(): Promise<boolean | null> {
  if (DEMO) return true;
  try {
    const list = items<{ platform?: string; kind?: string; type?: string; name?: string; enabled?: boolean; active?: boolean; status?: string }>(
      await client.podSurfaces.list(pod()));
    return list.some((x) => /teams/i.test(`${x.platform || x.kind || x.type || x.name}`) && x.enabled !== false && x.active !== false);
  } catch {
    return null;
  }
}

/** A line in a member's own Lemma channel, from the person. */
export async function notify(memberId: string, text: string): Promise<boolean> {
  if (DEMO) return true;
  try {
    await client.request("POST", `/pods/${pod()}/members/${memberId}/notices`, { body: { text } });
    return true;
  } catch {
    return false;
  }
}

/** Tell the people who asked: members in their own channel, customers by email from the Lemma's mailbox. */
export async function tellAskers(title: string, members: { question_id: string; member_id: string; name: string | null; text: string }[],
  contacts: { question_id: string; contact_id: string; name: string | null; text: string }[], by: string): Promise<{ told: number; left: string[] }> {
  const told: string[] = [];
  const left: string[] = [];
  for (const m of members) {
    const ok = await notify(m.member_id, `${by} saved an answer to your question “${m.text}”: ${title}, in Know-how.`);
    if (ok) told.push(m.question_id);
    else left.push(`${m.name || "A member"}: couldn't reach them`);
  }
  for (const c of contacts) {
    if (DEMO) {
      told.push(c.question_id);
      continue;
    }
    try {
      const contact = await client.request<{ handles?: { kind: string; handle: string }[] }>("GET", `/pods/${pod()}/contacts/${c.contact_id}`);
      const email = (contact.handles || []).find((h) => h.kind === "email")?.handle;
      if (!email) {
        left.push(`${c.name || "A customer"}: no email to write to`);
        continue;
      }
      await client.request("POST", `/pods/${pod()}/contacts/${c.contact_id}/outreach`, {
        body: { handle: email, text: `You asked: “${c.text}”. Here's the answer: ${title}. Reply if anything isn't clear.` } });
      told.push(c.question_id);
    } catch (e) {
      left.push(`${c.name || "A customer"}: ${why(e)}`);
    }
  }
  if (told.length) await call("knowhow_tell", { mode: "mark", question_ids: told, how: "where they asked" }).catch(() => undefined);
  return { told: told.length, left };
}
