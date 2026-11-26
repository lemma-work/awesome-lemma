// The Companies app's working set. Companies, their domains, People map's
// look-ups and notes, and the team's rows are team-wide; "yours" (the people
// you deal with, your conversations and meetings) is per person (RLS).

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DataProvider, useData, whoAmI, type CompanyRow, type Loaders, type Me } from "@lemma-plugins/kit";

export type Warmth = "warm" | "cooling" | "cold" | "new";
export interface Company extends CompanyRow {
  research_state: "none" | "wanted" | "writing" | "ready" | "failed" | null;
  researched_at: string | null;
}
export interface Mine {
  id: string;
  company_id: string;
  handle: string | null;
  kind: string | null;
  last_contact_at: string | null;
  warmth: Warmth | null;
  quiet: boolean | null;
  name: string | null;
  title: string | null;
}
export interface Link {
  id: string;
  member_id: string;
  member_name: string | null;
  handle: string;
  name: string | null;
  title: string | null;
  company_id: string | null;
  last_contact_at: string | null;
  warmth: Warmth | null;
}
export interface Facts {
  company: Company;
  domains: string[];
  mine: Mine[];
  team: Link[];
  /** Distinct addresses anyone on the team deals with there. */
  handles: string[];
  last: string | null;
  lastMine: string | null;
}

const LOADERS: Loaders = {
  settings: { sql: "select id, setup_step, display_name from people_settings order by created_at limit 1", tables: ["people_settings"] },
  companies: {
    sql:
      "select c.*, pc.research_state, pc.researched_at from company c left join people_company pc on pc.id = c.id " +
      "order by c.name limit 5000",
    tables: ["company", "people_company"],
  },
  domains: { sql: "select company_id, domain from company_domain order by domain limit 20000", tables: ["company_domain"] },
  mine: {
    sql:
      "select pp.id, pp.company_id, pp.handle, pp.kind, pp.last_contact_at, pp.warmth, pp.quiet, p.name, p.title " +
      "from people_person pp join person p on p.id = pp.id " +
      "where pp.in_scope is true and pp.deal_with is true and pp.company_id is not null limit 5000",
    tables: ["people_person", "person"],
  },
  team: { sql: "select * from people_link where company_id is not null limit 8000", tables: ["people_link"] },
};

const MeContext = createContext<Me | null>(null);

export function CompaniesProvider({ children }: { children: ReactNode }) {
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

export function useCompanies() {
  const { data, loaded, errors, reload } = useData();
  const me = useContext(MeContext);
  return useMemo(() => {
    const settings = ((data.settings as { id: string; setup_step: string; display_name: string | null }[] | undefined) || [])[0] || null;
    const companies = (data.companies as Company[] | undefined) || [];
    const domains = new Map<string, string[]>();
    for (const d of (data.domains as { company_id: string; domain: string }[] | undefined) || []) {
      domains.set(d.company_id, [...(domains.get(d.company_id) || []), d.domain]);
    }
    const mine = new Map<string, Mine[]>();
    for (const m of (data.mine as Mine[] | undefined) || []) {
      if (m.kind === "colleague" || m.kind === "other") continue;
      mine.set(m.company_id, [...(mine.get(m.company_id) || []), m]);
    }
    const team = new Map<string, Link[]>();
    for (const l of (data.team as Link[] | undefined) || []) {
      if (!l.company_id) continue;
      team.set(l.company_id, [...(team.get(l.company_id) || []), l]);
    }
    const facts = new Map<string, Facts>();
    for (const c of companies) {
      const m = mine.get(c.id) || [];
      const t = team.get(c.id) || [];
      if (!m.length && !t.length) continue;
      const handles = [...new Set([...t.map((l) => l.handle.toLowerCase()), ...m.map((x) => (x.handle || "").toLowerCase()).filter(Boolean)])];
      const times = [...m.map((x) => x.last_contact_at), ...t.map((l) => l.last_contact_at)].filter(Boolean) as string[];
      const mineTimes = m.map((x) => x.last_contact_at).filter(Boolean) as string[];
      facts.set(c.id, {
        company: c, domains: domains.get(c.id) || (c.domain ? [c.domain] : []), mine: m, team: t, handles,
        last: times.sort().pop() || null, lastMine: mineTimes.sort().pop() || null,
      });
    }
    return { loaded, errors, reload, me, settings, companies, facts, domains };
  }, [data, loaded, errors, reload, me]);
}

export function memberName(id: string | null, me: Me | null, name?: string | null): string {
  if (id && me && id === me.id) return "You";
  return name || "Someone on the team";
}
