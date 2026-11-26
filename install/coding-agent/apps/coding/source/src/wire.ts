// What only a person can do, done by the app as them: making schedules.
//
// No function's grant holds `schedule.create`, and a schedule runs as its
// maker, so each member's GitHub events and 15-minute check are their own
// schedules, made here at set-up and again on open when one is missing. Each
// is named `<workflow>-<first 8 of the user id>`; the bodies match the
// bundle's bin/app-schedules.json.
//
// GitHub sends the webhook once per schedule, so every member's schedule
// fires for every event: the functions write events idempotently and only
// the session's starter's run fixes anything.

import { DEMO, client, items, errorText } from "@lemma-plugins/kit";

interface Body {
  name: string;
  schedule_type: "WEBHOOK" | "TIME";
  workflow_name: string;
  pod_connector?: string;
  connector_trigger_id?: string;
  config: Record<string, unknown>;
}

const WEBHOOKS: [event: string, workflow: string, actions: string[], words: string][] = [
  ["pull_request", "coding-on-pull-request", ["opened", "reopened", "ready_for_review", "synchronize", "closed"], "pull requests"],
  ["check_run", "coding-on-check-run", ["completed"], "check runs"],
  ["check_suite", "coding-on-check-suite", ["completed"], "check suites"],
  ["pull_request_review_comment", "coding-on-review-comment", ["created"], "review comments"],
  ["pull_request_review", "coding-on-review", ["submitted"], "reviews"],
  ["issues", "coding-on-issues", ["labeled"], "labelled issues"],
];

export function schedulesFor(userId: string): { body: Body; words: string }[] {
  const tag = userId.slice(0, 8);
  return [
    ...WEBHOOKS.map(([event, workflow, actions, words]) => ({
      words: `GitHub ${words}`,
      body: {
        name: `${workflow}-${tag}`, schedule_type: "WEBHOOK" as const, workflow_name: workflow, pod_connector: "github",
        connector_trigger_id: `github:http:${event}`, config: { source: "github", event, actions },
      },
    })),
    {
      words: "the 15-minute check",
      body: { name: `coding-tick-${tag}`, schedule_type: "TIME" as const, workflow_name: "coding-tick", config: { cron: "*/15 * * * *" } },
    },
  ];
}

async function mine(): Promise<Set<string>> {
  const out = new Set<string>();
  let token: string | null = null;
  for (let page = 0; page < 5; page++) {
    const r = (await client.schedules.list({ limit: 100, ...(token ? { page_token: token } : {}) } as never)) as unknown as { next_page_token?: string | null };
    for (const s of items<{ name: string }>(r)) out.add(s.name);
    token = r.next_page_token || null;
    if (!token) break;
  }
  return out;
}

/** Make whichever of the person's schedules are missing. Says which couldn't be made. */
export async function ensureSchedules(userId: string): Promise<{ made: number; problems: string[] }> {
  if (DEMO || !userId) return { made: 0, problems: [] };
  let have: Set<string>;
  try {
    have = await mine();
  } catch (e) {
    return { made: 0, problems: [`your schedules couldn't be read (${errorText(e)})`] };
  }
  let made = 0;
  const problems: string[] = [];
  for (const { body, words } of schedulesFor(userId)) {
    if (have.has(body.name)) continue;
    try {
      await client.schedules.create(body as never);
      made += 1;
    } catch (e) {
      problems.push(`${words} (${errorText(e)})`);
    }
  }
  return { made, problems };
}
