// The list: everyone you deal with, with where you stand, and the team's view.

import { useMemo, useState } from "react";
import { ArrowUpDown, CircleHelp, Users } from "lucide-react";
import {
  Avatar, Button, Card, Empty, Logo, Pill, Rel, SearchField, Segmented, Skeleton, Toolbar, cx, nameOf, plural, runFunction, useToast, when, errorText,
} from "@lemma-plugins/kit";
import { memberName, usePeople } from "./data";
import { KIND_LABEL, KindPill, LastContact, WarmthPill } from "./marks";
import { FILTERS, to, type Filter } from "./route";
import { SettleRow } from "./Setup";
import { KINDS, type Kind, type Person } from "./types";

const FILTER_LABEL: Record<Filter, string> = {
  all: "Everyone", waiting: "Waiting on you", owed: "They owe you", quiet: "Gone quiet", meeting: "Meeting this week",
};
type Sort = "touch" | "name" | "meeting";

function useFacts() {
  const { people, owed } = usePeople();
  return useMemo(() => {
    const soon = Date.now() + 7 * 86_400_000;
    const count = (p: Person, dir: "i_owe" | "owed_to_me") => (owed.get(p.id) || []).filter((x) => x.direction === dir).length;
    const tests: Record<Filter, (p: Person) => boolean> = {
      all: () => true,
      waiting: (p) => !!p.waiting_on_me || count(p, "i_owe") > 0,
      owed: (p) => count(p, "owed_to_me") > 0,
      quiet: (p) => !!p.quiet,
      meeting: (p) => !!p.next_meeting_at && new Date(p.next_meeting_at).getTime() < soon,
    };
    const counts = Object.fromEntries(FILTERS.map((f) => [f, people.filter(tests[f]).length])) as Record<Filter, number>;
    return { tests, counts, count };
  }, [people, owed]);
}

function Scope({ team }: { team: boolean }) {
  const { people, team: rows } = usePeople();
  return (
    <Segmented<"mine" | "team">
      label="Whose"
      value={team ? "team" : "mine"}
      onChange={(v) => (v === "team" ? to.team() : to.list())}
      items={[{ id: "mine", label: "Yours", count: people.length }, { id: "team", label: "Team", count: rows.length }]}
    />
  );
}

export function PeopleList({ filter }: { filter: Filter }) {
  const { loaded, people, unsure, errors } = usePeople();
  const { tests, counts, count } = useFacts();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [sort, setSort] = useState<Sort>("touch");
  const needle = text.trim().toLowerCase();
  const time = (v: string | null) => (v ? new Date(v).getTime() : 0);
  const shown = people
    .filter((p) => tests[filter](p) && (!kind || p.kind === kind)
      && (!needle || `${p.name} ${p.handle} ${p.company_name || p.org} ${p.title}`.toLowerCase().includes(needle)))
    .sort((a, b) =>
      sort === "name" ? nameOf(a.name, a.handle).localeCompare(nameOf(b.name, b.handle))
        : sort === "meeting" ? (time(a.next_meeting_at) || Infinity) - (time(b.next_meeting_at) || Infinity)
          : filter === "quiet" ? (b.quiet_days || 0) - (b.usual_gap_days || 14) - ((a.quiet_days || 0) - (a.usual_gap_days || 14))
            : time(b.last_contact_at) - time(a.last_contact_at));
  const head = (label: string, key: Sort) => (
    <button type="button" onClick={() => setSort(sort === key ? "touch" : key)} aria-pressed={sort === key}>
      {label}
      <ArrowUpDown aria-hidden="true" style={{ opacity: sort === key ? 1 : 0.35 }} />
    </button>
  );
  const kinds = KINDS.filter((k) => k !== "colleague" && people.some((p) => p.kind === k));

  return (
    <>
      <Toolbar>
        <Scope team={false} />
        <Segmented<Filter> label="Show" value={filter} onChange={(f) => to.list(f)}
          items={FILTERS.map((f) => ({ id: f, label: FILTER_LABEL[f], count: counts[f] }))} />
        <span className="c-grow" />
        <select className="c-input pm-kind-filter" value={kind} onChange={(e) => setKind(e.target.value as Kind | "")} aria-label="Relationship">
          <option value="">Every relationship</option>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}s</option>)}
        </select>
        <SearchField value={text} onChange={setText} placeholder="Search people" />
      </Toolbar>
      <main className="c-body">
        {unsure.length ? (
          <div className="pm-unsure-line">
            <CircleHelp size={14} aria-hidden="true" />
            <span className="c-grow">{plural(unsure.length, "person")} it wasn't sure of. Say who they are and the next read learns from it.</span>
            <Button size="sm" onClick={() => to.unsure()}>Settle {unsure.length}</Button>
          </div>
        ) : null}
        {!loaded ? (
          <Skeleton rows={8} />
        ) : errors.people ? null : shown.length === 0 ? (
          <Card>
            <Empty icon={Users} title={people.length ? "No one here." : "No people yet."}>
              {people.length
                ? filter === "quiet" ? "Nobody you talk to both ways has gone longer than usual without a word."
                  : filter === "waiting" ? "Nobody is waiting on a reply or a promise from you."
                    : filter === "owed" ? "Nobody owes you anything they promised."
                      : filter === "meeting" ? "No meetings with anyone here in the next seven days."
                        : "Try another filter, or clear the search."
                : "People appear as Mail and Meetings read: anyone in your counted conversations or on a meeting with you."}
            </Empty>
          </Card>
        ) : (
          <div className="c-table-wrap">
            <table className="c-table pm-table">
              <thead>
                <tr>
                  <th>{head("Person", "name")}</th>
                  <th className="c-hide-sm">Company</th>
                  <th className="c-hide-sm">Relationship</th>
                  <th>Warmth</th>
                  <th className="pm-hide-xs">Last contact</th>
                  <th className="c-hide-sm">Owed</th>
                  <th className="c-hide-sm">{head("Next meeting", "meeting")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((p) => {
                  const owe = count(p, "i_owe") + (p.waiting_on_me ? 1 : 0);
                  const owes = count(p, "owed_to_me");
                  return (
                    <tr key={p.id} onClick={() => to.person(p.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && to.person(p.id)}>
                      <td>
                        <div className="c-cell">
                          <Avatar name={p.name} email={p.handle} />
                          <div style={{ minWidth: 0 }}>
                            <div className="c-ellipsis pm-name">{nameOf(p.name, p.handle)}</div>
                            <div className="c-cell__sub c-ellipsis">{p.title || p.handle}</div>
                          </div>
                        </div>
                      </td>
                      <td className="c-hide-sm">
                        {p.company_name ? (
                          <div className="c-cell"><Logo name={p.company_name} domain={p.company_domain} size={20} /><span className="c-ellipsis">{p.company_name}</span></div>
                        ) : <span className="c-faint">Personal address</span>}
                      </td>
                      <td className="c-hide-sm"><KindPill kind={p.kind} unsure={p.unsure} /></td>
                      <td><WarmthPill warmth={p.warmth} gap={p.usual_gap_days} /></td>
                      <td className="pm-hide-xs"><LastContact at={p.last_contact_at} dir={p.last_contact_dir} /></td>
                      <td className="c-hide-sm">
                        <div className="c-ledger">
                          {owe ? <Pill tone="warning">You owe {owe}</Pill> : null}
                          {owes ? <Pill tone="info">Owes you {owes}</Pill> : null}
                          {!owe && !owes ? <span className="c-faint">—</span> : null}
                        </div>
                      </td>
                      <td className="c-hide-sm num">{p.next_meeting_at ? when(p.next_meeting_at) : <span className="c-faint">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > 500 ? <p className="c-faint pm-more">The first 500 of {shown.length}. Search to find the rest.</p> : null}
      </main>
    </>
  );
}

export function TeamList() {
  const { loaded, team, people, personOf, companies, me } = usePeople();
  const [text, setText] = useState("");
  const needle = text.trim().toLowerCase();
  const mine = new Set(people.map((p) => p.id));
  const shown = team.filter((t) => !needle || `${t.name} ${t.handle} ${companies.get(t.company_id || "")?.name || ""}`.toLowerCase().includes(needle));
  const open = (handle: string) => {
    const id = personOf.get(handle);
    if (id && mine.has(id)) to.person(id);
    else to.teamPerson(handle);
  };
  return (
    <>
      <Toolbar>
        <Scope team />
        <span className="c-muted pm-hide-xs">Who anyone in this Lemma deals with: the person, the company, the last contact and how warm. Never what was said.</span>
        <span className="c-grow" />
        <SearchField value={text} onChange={setText} placeholder="Search the team's people" />
      </Toolbar>
      <main className="c-body">
        {!loaded ? (
          <Skeleton rows={8} />
        ) : shown.length === 0 ? (
          <Card>
            <Empty icon={Users} title={team.length ? "No one matches." : "Nobody shared yet."}>
              {team.length ? "Clear the search to see everyone." : "Each person's own People map shares who they deal with here once they've set it up."}
            </Empty>
          </Card>
        ) : (
          <div className="c-table-wrap">
            <table className="c-table pm-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="c-hide-sm">Company</th>
                  <th>Who knows them</th>
                  <th className="c-hide-sm">Warmth</th>
                  <th className="pm-hide-xs">Last contact</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((t) => {
                  const company = companies.get(t.company_id || "");
                  const lastBy = t.members.find((m) => m.id === t.last_by);
                  return (
                    <tr key={t.handle} onClick={() => open(t.handle)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(t.handle)}>
                      <td>
                        <div className="c-cell">
                          <Avatar name={t.name} email={t.handle} />
                          <div style={{ minWidth: 0 }}>
                            <div className="c-ellipsis pm-name">{nameOf(t.name, t.handle)}</div>
                            <div className="c-cell__sub c-ellipsis">{t.title || t.handle}</div>
                          </div>
                        </div>
                      </td>
                      <td className="c-hide-sm">
                        {company ? <div className="c-cell"><Logo name={company.name} domain={company.domain} size={20} /><span className="c-ellipsis">{company.name}</span></div> : <span className="c-faint">Personal address</span>}
                      </td>
                      <td>
                        <div className="c-row">
                          <span className="c-stack-av">
                            {t.members.slice(0, 3).map((m) => <Avatar key={m.id} name={memberName(m.id, me, m.name)} email={m.id} size={22} you={!!me && m.id === me.id} />)}
                          </span>
                          <span className={cx("c-ellipsis", "pm-who")}>{t.members.map((m) => memberName(m.id, me, m.name)).join(", ")}</span>
                        </div>
                      </td>
                      <td className="c-hide-sm"><WarmthPill warmth={t.warmth} /></td>
                      <td className="pm-hide-xs">
                        {t.last_contact_at ? <span className="c-row"><Rel at={t.last_contact_at} /><span className="c-faint">· {memberName(t.last_by, me, lastBy?.name)}</span></span> : <span className="c-faint">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

export function UnsureList() {
  const { unsure, reload } = usePeople();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const correct = async (input: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const out = await runFunction<{ message: string }>("people_correct", input);
      toast(out.message);
      await reload("people");
    } catch (e) {
      toast(`Couldn't change that: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <Toolbar>
        <Button size="sm" variant="ghost" onClick={() => to.list()}>Back to everyone</Button>
        <span className="c-muted pm-hide-xs">Who it wasn't sure about. Your answer stands, and the next read learns from it.</span>
      </Toolbar>
      <main className="c-body">
        {unsure.length === 0 ? (
          <Card><Empty icon={CircleHelp} title="Nothing to settle.">When it isn't sure who someone is, they wait here for you.</Empty></Card>
        ) : (
          <Card title="Not sure" icon={CircleHelp} count={unsure.length} flush>
            <div className="c-list">{unsure.map((p) => <SettleRow key={p.id} p={p} busy={busy} onCorrect={correct} />)}</div>
          </Card>
        )}
      </main>
    </>
  );
}
