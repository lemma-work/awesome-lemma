// The app's working set: one read per table, kept fresh by the change stream
// (the kit's DataProvider). Deals, stages, history, notes and the reviews are
// the team's; proposals (`deals_change`) are the signed-in person's own,
// read from their own conversations. People map's team view (`people_link`)
// gives each deal's warmth; it holds no words anyone wrote.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DataProvider, client, runFunction, update, useData, whoAmI, type Loaders, type Me } from "@lemma-plugins/kit";
import type { Change, Deal, Link, Member, Review, Settings, Stage } from "./types";

const LOADERS: Loaders = {
  member: { sql: "select * from deals_member order by created_at limit 1", tables: ["deals_member"] },
  settings: { sql: "select * from deals_settings limit 1", tables: ["deals_settings"] },
  stages: { sql: "select * from deals_stage order by position, name", tables: ["deals_stage"] },
  deals: { sql: "select * from deal order by last_activity_at desc nulls last limit 3000", tables: ["deal"] },
  changes: {
    sql: "select * from deals_change where state = 'proposed' order by said_at desc nulls last, created_at desc limit 500",
    tables: ["deals_change"],
  },
  reviews: { sql: "select * from deals_review order by week_end desc limit 12", tables: ["deals_review"] },
  // Other plugins' rows, read only. Each may be missing; a failed read hides
  // what needs it.
  links: { sql: "select handle, name, company_id, member_id, member_name, last_contact_at, warmth from people_link limit 10000", tables: ["people_link"] },
  peopleSetup: { sql: "select setup_step from people_settings order by created_at limit 1", tables: ["people_settings"] },
  mailSample: { sql: "select count(*) as n from mail_mailbox where account_id = 'sample'", tables: ["mail_mailbox"] },
  meetingsSample: { sql: "select count(*) as n from meetings_calendar where provider = 'sample'", tables: ["meetings_calendar"] },
  dealSample: { sql: "select count(*) as n from deal where source = 'sample'", tables: ["deal"] },
};

/** Loaders whose failure only hides something; never shown as an error. */
export const OPTIONAL = new Set(["links", "peopleSetup", "mailSample", "meetingsSample", "dealSample"]);

export interface MeFull extends Me {
  display: string;
}

const MeContext = createContext<MeFull | null>(null);

/** Who is signed in, with a name: the kit's whoAmI has none, users.current has first and last. */
async function loadMe(): Promise<MeFull | null> {
  const me = await whoAmI();
  if (!me) return null;
  let display = me.name || "";
  if (!display) {
    try {
      const u = (await (client as unknown as { users: { current: () => Promise<Record<string, unknown>> } }).users.current()) || {};
      display = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    } catch {
      display = "";
    }
  }
  return { ...me, display: display || me.email || "You" };
}

export function DealsProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeFull | null>(null);
  useEffect(() => {
    void loadMe().then(setMe);
  }, []);
  return (
    <MeContext.Provider value={me}>
      <DataProvider loaders={LOADERS}>{children}</DataProvider>
    </MeContext.Provider>
  );
}

const RANK: Record<string, number> = { warm: 3, new: 2, cooling: 1, cold: 0 };

export interface DealsData {
  loaded: boolean;
  errors: Record<string, string | undefined>;
  reload: (name?: string) => Promise<void>;
  me: MeFull | null;
  member: Member | null;
  settings: Settings | null;
  stages: Stage[];
  stageOf: (name: string) => Stage | undefined;
  deals: Deal[];
  byId: Map<string, Deal>;
  changes: Change[];
  /** Proposals waiting, per deal id (new deals under their company key). */
  changesFor: (dealId: string) => Change[];
  reviews: Review[];
  /** The warmest anyone on the team is with a deal's people, and when they last spoke. */
  warmthOf: (deal: Deal) => { warmth: Link["warmth"]; last: string | null; by: string | null; byId: string | null } | null;
  peopleReady: boolean | null;
  sample: { mail: boolean; meetings: boolean; deals: boolean };
  currency: string;
}

export function useDeals(): DealsData {
  const { data, loaded, errors, reload } = useData();
  const me = useContext(MeContext);
  return useMemo(() => {
    const first = <T,>(name: string) => ((data[name] as T[] | undefined) || [])[0] || null;
    const count = (name: string) => Number(((data[name] as { n: number }[] | undefined) || [])[0]?.n || 0);
    const stages = (data.stages as Stage[] | undefined) || [];
    const deals = (data.deals as Deal[] | undefined) || [];
    const changes = (data.changes as Change[] | undefined) || [];
    const links = (data.links as Link[] | undefined) || [];
    const byHandle = new Map<string, Link[]>();
    const byCompany = new Map<string, Link[]>();
    for (const l of links) {
      const h = (l.handle || "").toLowerCase();
      byHandle.set(h, [...(byHandle.get(h) || []), l]);
      if (l.company_id) byCompany.set(l.company_id, [...(byCompany.get(l.company_id) || []), l]);
    }
    const settings = first<Settings>("settings");
    const peopleSetup = first<{ setup_step: string }>("peopleSetup");
    return {
      loaded,
      errors,
      reload,
      me,
      member: first<Member>("member"),
      settings,
      stages,
      stageOf: (name: string) => stages.find((s) => s.name === name),
      deals,
      byId: new Map(deals.map((d) => [d.id, d])),
      changes,
      changesFor: (dealId: string) => changes.filter((c) => c.deal_id === dealId),
      reviews: (data.reviews as Review[] | undefined) || [],
      warmthOf: (deal: Deal) => {
        const handles = (deal.people || []).map((p) => (p.handle || "").toLowerCase()).filter(Boolean);
        const rows = handles.length ? handles.flatMap((h) => byHandle.get(h) || []) : deal.company_id ? byCompany.get(deal.company_id) || [] : [];
        const warm = rows.filter((r) => r.warmth);
        if (!warm.length) return null;
        const best = warm.reduce((a, b) => ((RANK[b.warmth || ""] ?? -1) > (RANK[a.warmth || ""] ?? -1) ? b : a));
        const newest = warm.reduce((a, b) => ((b.last_contact_at || "") > (a.last_contact_at || "") ? b : a));
        return { warmth: best.warmth, last: newest.last_contact_at, by: newest.member_name, byId: newest.member_id };
      },
      peopleReady: errors.peopleSetup ? null : peopleSetup ? peopleSetup.setup_step === "done" : false,
      sample: { mail: count("mailSample") > 0, meetings: count("meetingsSample") > 0, deals: count("dealSample") > 0 },
      currency: settings?.currency || "USD",
    };
  }, [data, loaded, errors, reload, me]);
}

/** Everything a person does to a deal goes through one function, so it all leaves history. */
export async function save<T = { deal_id?: string | null; message?: string; changed?: string[] }>(
  action: string,
  input: Record<string, unknown>,
  me: MeFull | null,
): Promise<T> {
  return runFunction<T>("deals_save", { action, display_name: me?.display || null, ...input });
}

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return ({ "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv" } as Record<string, string>)[zone] || zone;
}

const DOW: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

/** The team's weekly review: one TIME schedule, made (or moved) as the person who picked the day. */
export async function scheduleReview(settings: Settings, me: MeFull | null): Promise<string> {
  const [h, m] = (settings.review_time || "08:00").split(":").map((x) => Number(x));
  const config = { cron: `${m || 0} ${h || 8} * * ${DOW[settings.review_day] ?? 1}`, timezone: settings.timezone || browserZone() };
  const schedules = client.schedules as unknown as {
    create: (p: unknown) => Promise<{ id: string }>;
    update: (id: string, p: unknown) => Promise<unknown>;
  };
  if (settings.review_schedule_id) {
    try {
      await schedules.update(settings.review_schedule_id, { config });
      return settings.review_schedule_id;
    } catch {
      // gone, or not this person's to change: make a new one below
    }
  }
  const row = await schedules.create({
    name: `deals-weekly-review-${(me?.id || "team").slice(0, 8)}`,
    schedule_type: "TIME", workflow_name: "deals-weekly-review", config,
  });
  await update("deals_settings", settings.id, { review_schedule_id: row.id, review_schedule_by: me?.id || null });
  return row.id;
}
