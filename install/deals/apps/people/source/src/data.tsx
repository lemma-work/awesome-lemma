// The app's working set: one read per table, kept fresh by the change stream
// (the kit's DataProvider) and re-read when the tab comes back. People,
// promises and conversations are per person (RLS): the signed-in person's
// own. The team's rows (`people_link`) and companies are team-wide, and hold
// no words anyone wrote.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DataProvider, useData, whoAmI, type Loaders, type Me } from "@lemma-plugins/kit";
import type { Category, Link, Person, Promise_, Settings, TeamPerson, Warmth } from "./types";

export const SAMPLE_MEMBER = "288188c9-7991-4da2-9318-b3254d59480e";

const PEOPLE_SQL =
  "select pp.id, pp.handle, pp.domain, pp.in_scope, pp.deal_with, pp.kind, pp.sorted_by, pp.sorted_at, pp.unsure, pp.reason, " +
  "pp.answers, pp.company_id, pp.first_contact_at, pp.last_contact_at, pp.last_contact_dir, pp.conversation_count, " +
  "pp.meeting_count, pp.episodes, pp.usual_gap_days, pp.warmth, pp.quiet, pp.quiet_days, pp.waiting_on_me, " +
  "pp.next_meeting_at, pp.next_meeting_id, pp.summary_state, " +
  "p.name, p.org, p.title, p.is_vip, c.name as company_name, c.domain as company_domain " +
  "from people_person pp join person p on p.id = pp.id left join company c on c.id = pp.company_id " +
  "where pp.in_scope is true order by pp.last_contact_at desc nulls last limit 3000";

const LOADERS: Loaders = {
  settings: { sql: "select * from people_settings order by created_at limit 1", tables: ["people_settings"] },
  people: { sql: PEOPLE_SQL, tables: ["people_person", "person", "company"] },
  handles: { sql: "select person_id, handle from person_handle where kind = 'email' limit 20000", tables: ["person_handle"] },
  promises: {
    sql: "select id, person_handle, person_name, direction, text, quote, due_at, conversation_id, source, source_id from promise where state = 'open' order by due_at nulls last limit 2000",
    tables: ["promise"],
  },
  companies: { sql: "select id, name, domain from company order by name limit 10000", tables: ["company"] },
  team: { sql: "select * from people_link order by last_contact_at desc nulls last limit 8000", tables: ["people_link"] },
  categories: { sql: "select key, name, sentence, kind from mail_category where state = 'active' order by position, name", tables: ["mail_category"] },
  mailSetup: { sql: "select setup_step from mail_settings order by created_at limit 1", tables: ["mail_settings"] },
  meetingsSetup: { sql: "select setup_step from meetings_settings order by created_at limit 1", tables: ["meetings_settings"] },
  mailSample: { sql: "select count(*) as n from mail_mailbox where account_id = 'sample'", tables: ["mail_mailbox"] },
  meetingsSample: { sql: "select count(*) as n from meetings_calendar where provider = 'sample'", tables: ["meetings_calendar"] },
  peopleSample: { sql: "select count(*) as n from people_sample_contact", tables: ["people_sample_contact"] },
};

const MeContext = createContext<Me | null>(null);

export function PeopleProvider({ children }: { children: ReactNode }) {
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

const RANK: Record<Warmth, number> = { warm: 3, new: 2, cooling: 1, cold: 0 };

export interface PeopleData {
  loaded: boolean;
  errors: Record<string, string | undefined>;
  reload: (name?: string) => Promise<void>;
  me: Me | null;
  settings: Settings | null;
  /** Everyone in the counted conversations and meetings, read or not. */
  everyone: Person[];
  /** The people the owner deals with: the list. */
  people: Person[];
  unsure: Person[];
  byId: Map<string, Person>;
  /** Address -> the owner's person id. */
  personOf: Map<string, string>;
  /** Person id -> their open promises, either way. */
  owed: Map<string, Promise_[]>;
  team: TeamPerson[];
  teamOf: Map<string, TeamPerson>;
  companies: Map<string, { id: string; name: string; domain: string | null }>;
  categories: Category[];
  bases: { mail: string | null; meetings: string | null };
  sample: { mail: boolean; meetings: boolean; people: boolean; team: boolean };
}

export function usePeople(): PeopleData {
  const { data, loaded, errors, reload } = useData();
  const me = useContext(MeContext);
  return useMemo(() => {
    const settings = ((data.settings as Settings[] | undefined) || [])[0] || null;
    const everyone = (data.people as Person[] | undefined) || [];
    const people = everyone.filter((p) => p.deal_with === true && p.kind !== "colleague");
    const unsure = everyone.filter((p) => p.unsure && p.deal_with !== false);
    const byId = new Map(everyone.map((p) => [p.id, p]));
    const personOf = new Map<string, string>();
    for (const h of (data.handles as { person_id: string; handle: string }[] | undefined) || []) personOf.set(h.handle.toLowerCase(), h.person_id);
    for (const p of everyone) if (p.handle) personOf.set(p.handle.toLowerCase(), p.id);
    const owed = new Map<string, Promise_[]>();
    for (const pr of (data.promises as Promise_[] | undefined) || []) {
      const pid = personOf.get((pr.person_handle || "").toLowerCase());
      if (!pid) continue;
      owed.set(pid, [...(owed.get(pid) || []), pr]);
    }
    const grouped = new Map<string, TeamPerson>();
    for (const l of (data.team as Link[] | undefined) || []) {
      const key = l.handle.toLowerCase();
      const t = grouped.get(key) || { handle: key, name: null, title: null, company_id: null, last_contact_at: null, last_by: null, warmth: null, members: [] };
      t.name = t.name || l.name;
      t.title = t.title || l.title;
      t.company_id = t.company_id || l.company_id;
      if (l.last_contact_at && (!t.last_contact_at || l.last_contact_at > t.last_contact_at)) {
        t.last_contact_at = l.last_contact_at;
        t.last_by = l.member_id;
      }
      if (l.warmth && (!t.warmth || RANK[l.warmth] > RANK[t.warmth])) t.warmth = l.warmth;
      t.members.push({ id: l.member_id, name: l.member_name, last_contact_at: l.last_contact_at, warmth: l.warmth });
      grouped.set(key, t);
    }
    const team = [...grouped.values()].sort((a, b) => (b.last_contact_at || "").localeCompare(a.last_contact_at || ""));
    const step = (name: string) => ((data[name] as { setup_step: string }[] | undefined) || [])[0]?.setup_step || null;
    const count = (name: string) => Number(((data[name] as { n: number }[] | undefined) || [])[0]?.n || 0);
    const bases = { mail: step("mailSetup"), meetings: step("meetingsSetup") };
    return {
      loaded,
      errors,
      reload,
      me,
      settings,
      everyone,
      people,
      unsure,
      byId,
      personOf,
      owed,
      team,
      teamOf: grouped,
      companies: new Map(((data.companies as { id: string; name: string; domain: string | null }[] | undefined) || []).map((c) => [c.id, c])),
      categories: (data.categories as Category[] | undefined) || [],
      bases,
      sample: {
        mail: count("mailSample") > 0,
        meetings: count("meetingsSample") > 0,
        people: count("peopleSample") > 0,
        team: ((data.team as Link[] | undefined) || []).some((l) => l.member_id === SAMPLE_MEMBER),
      },
    };
  }, [data, loaded, errors, reload, me]);
}

/** The owner's own name for a member id, or theirs. */
export function memberName(id: string | null, me: Me | null, name?: string | null): string {
  if (id && me && id === me.id) return "You";
  return name || "Someone on the team";
}
