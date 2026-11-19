// The app's working set: one read per table, kept fresh by the change stream
// (the kit's DataProvider). Leads and corrections are per person (RLS): the
// signed-in person's own. Company facts and their fit, and who fits the team,
// are team-wide, and hold only what public pages said and what the team set.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DataProvider, useData, whoAmI, type Loaders, type Me } from "@lemma-plugins/kit";
import type { Candidate, CompanyFacts, Lead, Profile, Settings } from "./types";

/** The team's description of a good fit is one row: uuid5(PROFILE_NS, "profile"). */
export const PROFILE_ID = "19ec847e-97a0-522c-831c-9200d7e39393";

const LEAD_SQL =
  "select lp.id, lp.state, lp.company_id, lp.kind, lp.worth, lp.worth_by, lp.worth_confidence, lp.worth_reason, " +
  "lp.wanted_at, lp.forced, lp.looked_up_at, lp.lookup_seconds, lp.lookup_error, lp.found, lp.facts, lp.not_found, " +
  "lp.role, lp.location, lp.profile_url, lp.summary, lc.fit, lc.fit_sure, lc.fit_why, lp.review, lp.reviewed_at, " +
  "lp.sample, lp.created_at, p.name, p.title as mail_title, pp.handle, pp.last_inbound_at, pp.last_contact_at, " +
  "pp.next_meeting_at, c.name as company_name, c.domain as company_domain " +
  "from leads_person lp join person p on p.id = lp.id left join people_person pp on pp.id = lp.id " +
  "left join company c on c.id = lp.company_id left join leads_company lc on lc.id = lp.company_id " +
  "order by lc.fit desc nulls last, lp.looked_up_at desc nulls last limit 3000";

const LOADERS: Loaders = {
  settings: { sql: "select * from leads_settings order by created_at limit 1", tables: ["leads_settings"] },
  leads: { sql: LEAD_SQL, tables: ["leads_person", "leads_company", "person", "people_person", "company"] },
  profile: { sql: "select * from leads_profile limit 1", tables: ["leads_profile"] },
  companies: { sql: "select id, looked_up_at, found, facts, news, sample from leads_company limit 5000", tables: ["leads_company"] },
  peopleSetup: { sql: "select setup_step from people_settings order by created_at limit 1", tables: ["people_settings"] },
};

const MeContext = createContext<Me | null>(null);

export function LeadsProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    void whoAmI().then(setMe);
  }, []);
  return (
    <MeContext.Provider value={me}>
      <DataProvider loaders={LOADERS}>{children}</DataProvider>
    </MeContext.Provider>
  );
}

export const IN_LINE = ["proposed", "queued", "wanted", "looking", "failed"];

export interface LeadsData {
  loaded: boolean;
  errors: Record<string, string | undefined>;
  reload: (name?: string) => Promise<void>;
  me: Me | null;
  settings: Settings | null;
  /** Who fits the team: one per Lemma. */
  profile: Profile | null;
  peopleSetup: string | null;
  all: Lead[];
  byId: Map<string, Lead>;
  /** Looked up, not yet kept or passed: best fit first. */
  fresh: Lead[];
  ready: Lead[];
  line: Lead[];
  skipped: Lead[];
  unsure: Lead[];
  companies: Map<string, CompanyFacts>;
  /** Look-ups taken today, in the person's own day: the limit's, and the ones asked for past it. */
  usedToday: number;
  forcedToday: number;
  limit: number;
  sample: boolean;
}

function dayStart(zone: string | null): number {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      .formatToParts(now).reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
    const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    const offset = local - now.getTime();
    const midnightLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
    return midnightLocal - offset;
  } catch {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
}

/** Best first: a fit the person can trust, higher, then the newest look-up. */
export function byFit(a: Lead, b: Lead): number {
  const score = (l: Lead) => (l.fit == null ? -1 : l.fit + (l.fit_sure ? 0.5 : 0));
  return score(b) - score(a) || (b.looked_up_at || "").localeCompare(a.looked_up_at || "");
}

export function useLeads(): LeadsData {
  const { data, loaded, errors, reload } = useData();
  const me = useContext(MeContext);
  return useMemo(() => {
    const settings = ((data.settings as Settings[] | undefined) || [])[0] || null;
    const all = ((data.leads as Lead[] | undefined) || []).map((l) => ({ ...l, review: l.review || "new" }));
    const ready = all.filter((l) => l.state === "ready").sort(byFit);
    const since = dayStart(settings?.timezone || null);
    return {
      loaded,
      errors,
      reload,
      me,
      settings,
      profile: ((data.profile as Profile[] | undefined) || [])[0] || null,
      peopleSetup: ((data.peopleSetup as { setup_step: string }[] | undefined) || [])[0]?.setup_step || null,
      all,
      byId: new Map(all.map((l) => [l.id, l])),
      fresh: ready.filter((l) => l.review === "new"),
      ready,
      line: all.filter((l) => IN_LINE.includes(l.state)),
      skipped: all.filter((l) => l.state === "skipped"),
      unsure: all.filter((l) => l.state === "unsure"),
      companies: new Map(((data.companies as CompanyFacts[] | undefined) || []).map((c) => [c.id, c])),
      usedToday: all.filter((l) => !l.sample && !l.forced && l.wanted_at && new Date(l.wanted_at).getTime() >= since).length,
      forcedToday: all.filter((l) => !l.sample && l.forced && l.wanted_at && new Date(l.wanted_at).getTime() >= since).length,
      limit: settings?.daily_limit || 10,
      sample: all.some((l) => l.sample),
    };
  }, [data, loaded, errors, reload, me]);
}

/** People in People map not looked up yet, for "Look someone up". */
export const CANDIDATES_SQL =
  "select pp.id, p.name, pp.handle, pp.kind, c.name as company_name, c.domain as company_domain, pp.last_contact_at " +
  "from people_person pp join person p on p.id = pp.id left join company c on c.id = pp.company_id " +
  "left join leads_person lp on lp.id = pp.id " +
  "where pp.in_scope is true and pp.deal_with is true and pp.company_id is not null " +
  "and coalesce(pp.kind, '') not in ('colleague', 'other') and (lp.id is null or lp.state in ('skipped', 'unsure', 'failed')) " +
  "order by pp.last_contact_at desc nulls last limit 400";
export type { Candidate };
