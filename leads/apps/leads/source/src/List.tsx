// The list: who's new and worth your time, best fit first, with their role,
// company, fit and why; then everyone looked up, who's in line, and who was
// skipped.

import { useState } from "react";
import { CircleHelp, Clock, ScanSearch, SkipForward } from "lucide-react";
import {
  Avatar, Button, Card, Empty, Logo, Rel, SearchField, Segmented, Skeleton, Switch, Toolbar, nameOf, plural, runFunction, useToast,
} from "@lemma-plugins/kit";
import { useLeads } from "./data";
import { FitMark, KIND_LABEL, KindPill, StatePill, companySize } from "./marks";
import { FILTERS, to, type Filter } from "./route";
import type { Lead } from "./types";

const FILTER_LABEL: Record<Filter, string> = { new: "Worth a look", all: "Looked up", line: "In line", skipped: "Skipped" };

export function LeadList({ filter }: { filter: Filter }) {
  const data = useLeads();
  const { loaded, fresh, ready, line, skipped, unsure, usedToday, forcedToday, limit, errors } = data;
  const [text, setText] = useState("");
  // Worth a look: fit 3 and up (a not-sure one too, marked); the rest behind "Show all".
  const [everyone, setEveryone] = useState(false);
  const worth = fresh.filter((l) => (l.fit ?? 0) >= 3);
  const hidden = fresh.length - worth.length;
  const lists: Record<Filter, Lead[]> = { new: everyone ? fresh : worth, all: ready, line, skipped: [...unsure, ...skipped] };
  const needle = text.trim().toLowerCase();
  const shown = lists[filter].filter((l) => !needle || `${l.name} ${l.handle} ${l.company_name} ${l.role}`.toLowerCase().includes(needle));
  const waiting = line.filter((l) => l.state === "queued").length;

  return (
    <>
      <Toolbar>
        <Segmented<Filter> label="Show" value={filter} onChange={(f) => to.list(f)}
          items={FILTERS.map((f) => ({ id: f, label: FILTER_LABEL[f], count: lists[f].length }))} />
        <span className="c-grow" />
        <SearchField value={text} onChange={setText} placeholder="Search leads" />
      </Toolbar>
      <main className="c-body">
        <div className="ld-today">
          <Clock size={14} aria-hidden="true" />
          <span className="c-grow">
            <span className="num">{Math.min(usedToday, limit)}</span> of {limit} look-ups today
            {forcedToday ? <> · {forcedToday} more you asked for, past the limit</> : null}
            {waiting ? <> · {plural(waiting, "person", "people")} in line{usedToday >= limit ? " for tomorrow" : ""}</> : null}
          </span>
          {filter !== "line" && line.length ? <Button size="sm" variant="ghost" onClick={() => to.list("line")}>See who's in line</Button> : null}
        </div>
        {filter === "new" && hidden ? (
          <div className="ld-hidden-line">
            <span className="c-grow c-muted">
              {everyone ? "Showing everyone new, best fit first." : `${plural(hidden, "new lead")} with a fit under 3, or none, not shown.`}
            </span>
            <Switch label="Show all" checked={everyone} onChange={setEveryone} />
            <span className="c-muted">Show all</span>
          </div>
        ) : null}
        {!loaded ? (
          <Skeleton rows={8} />
        ) : errors.leads ? null : shown.length === 0 ? (
          <Card>
            <EmptyFor filter={filter} searching={!!needle} hidden={everyone ? 0 : hidden} />
          </Card>
        ) : filter === "line" ? (
          <LineTable rows={shown} />
        ) : filter === "skipped" ? (
          <SkippedTable rows={shown} />
        ) : (
          <LeadTable rows={shown} />
        )}
      </main>
    </>
  );
}

function EmptyFor({ filter, searching, hidden }: { filter: Filter; searching: boolean; hidden: number }) {
  const { ready, line } = useLeads();
  if (searching) return <Empty icon={ScanSearch} title="No one matches.">Clear the search to see everyone.</Empty>;
  if (filter === "new" && hidden) {
    return <Empty icon={ScanSearch} title="No new lead fits 3 or more.">{plural(hidden, "new lead")} with a lower fit, or none yet: turn on Show all to see them.</Empty>;
  }
  if (filter === "new") {
    return (
      <Empty icon={ScanSearch} title={ready.length ? "You've seen every new lead." : "No one looked up yet."}
        action={line.length ? <Button size="sm" onClick={() => to.list("line")}>See who's in line</Button> : undefined}>
        {ready.length
          ? "New people appear here once they're looked up: whenever People map finds someone you deal with who's worth it."
          : line.length
            ? `${plural(line.length, "person is", "people are")} in line; each takes about a minute.`
            : "When People map finds someone new you deal with, it's asked whether they're worth looking up, and they appear here once they are."}
      </Empty>
    );
  }
  if (filter === "line") return <Empty icon={Clock} title="Nobody in line.">Everyone worth looking up has been.</Empty>;
  if (filter === "skipped") return <Empty icon={SkipForward} title="Nobody skipped.">People it decides aren't worth a look-up appear here, to look up anyway.</Empty>;
  return <Empty icon={ScanSearch} title="No one looked up yet." />;
}

function LeadTable({ rows }: { rows: Lead[] }) {
  const { companies } = useLeads();
  return (
    <div className="c-table-wrap">
      <table className="c-table ld-table">
        <thead>
          <tr>
            <th>Person</th>
            <th className="c-hide-sm">Company</th>
            <th>Fit</th>
            <th className="c-hide-sm">Why</th>
            <th className="ld-hide-md">Looked up</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((l) => {
            const size = companySize(companies.get(l.company_id || "")?.facts);
            const facts = (l.facts?.length || 0) + (companies.get(l.company_id || "")?.facts?.length || 0);
            return (
              <tr key={l.id} onClick={() => to.lead(l.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && to.lead(l.id)}>
                <td>
                  <div className="c-cell">
                    <Avatar name={l.name} email={l.handle} />
                    <div style={{ minWidth: 0 }}>
                      <div className="c-ellipsis ld-name">{nameOf(l.name, l.handle)}</div>
                      <div className="c-cell__sub c-ellipsis">
                        {l.role || (l.found === false ? <span className="c-faint">Role not found</span> : l.mail_title || "")}
                        <span className="ld-show-sm">{l.company_name ? ` · ${l.company_name}` : ""}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="c-hide-sm">
                  {l.company_name ? (
                    <div className="c-cell">
                      <Logo name={l.company_name} domain={l.company_domain} size={22} />
                      <div style={{ minWidth: 0 }}>
                        <div className="c-ellipsis">{l.company_name}</div>
                        <div className="c-cell__sub c-ellipsis">{size || (l.kind ? KIND_LABEL[l.kind] : "")}</div>
                      </div>
                    </div>
                  ) : <span className="c-faint">Personal address</span>}
                </td>
                <td><FitMark fit={l.fit} sure={l.fit_sure} compact /></td>
                <td className="c-hide-sm ld-why"><span className="ld-clamp">{l.fit_why || (l.fit == null ? "Nothing found to score" : "")}</span></td>
                <td className="ld-hide-md">
                  <div className="ld-looked">
                    <Rel at={l.looked_up_at} />
                    <span className="c-faint">{facts ? plural(facts, "source", "sources") : "not found"}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LineTable({ rows }: { rows: Lead[] }) {
  return (
    <div className="c-table-wrap">
      <table className="c-table ld-table">
        <thead>
          <tr>
            <th>Person</th>
            <th className="c-hide-sm">Company</th>
            <th>Where</th>
            <th className="c-hide-sm">Why it's worth it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} onClick={() => to.lead(l.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && to.lead(l.id)}>
              <td>
                <div className="c-cell">
                  <Avatar name={l.name} email={l.handle} />
                  <div style={{ minWidth: 0 }}>
                    <div className="c-ellipsis ld-name">{nameOf(l.name, l.handle)}</div>
                    <div className="c-cell__sub c-ellipsis">{l.company_name || l.handle}</div>
                  </div>
                </div>
              </td>
              <td className="c-hide-sm">
                {l.company_name ? <div className="c-cell"><Logo name={l.company_name} domain={l.company_domain} size={20} /><span className="c-ellipsis">{l.company_name}</span></div> : null}
              </td>
              <td><StatePill lead={l} /></td>
              <td className="c-hide-sm c-muted"><span className="ld-clamp">{l.state === "failed" ? l.lookup_error : l.worth_reason}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SkippedTable({ rows }: { rows: Lead[] }) {
  const toast = useToast();
  const { reload } = useLeads();
  const [busy, setBusy] = useState("");
  const correct = async (l: Lead, worth: boolean) => {
    setBusy(`${l.id}-${worth}`);
    try {
      const out = await runFunction<{ message: string }>("leads_correct", { person_id: l.id, worth });
      toast(out.message);
      await reload("leads");
    } catch (e) {
      toast(`Couldn't change that: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="c-table-wrap">
      <table className="c-table ld-table">
        <thead>
          <tr>
            <th>Person</th>
            <th className="c-hide-sm">Relationship</th>
            <th className="c-hide-sm">Why</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>
                <div className="c-cell">
                  <Avatar name={l.name} email={l.handle} />
                  <div style={{ minWidth: 0 }}>
                    <div className="c-ellipsis ld-name">{nameOf(l.name, l.handle)}</div>
                    <div className="c-cell__sub c-ellipsis">{l.company_name || l.handle}</div>
                  </div>
                </div>
              </td>
              <td className="c-hide-sm"><KindPill kind={l.kind} /></td>
              <td className="c-hide-sm c-muted">
                <span className="ld-why-line">
                  {l.state === "unsure" ? <CircleHelp size={13} aria-hidden="true" /> : null}
                  <span className="ld-clamp">{l.worth_reason}</span>
                </span>
              </td>
              <td className="ld-actions">
                {l.worth_by === "rule" ? null : (
                  <Button size="sm" busy={busy === `${l.id}-true`} onClick={() => void correct(l, true)}>Look up</Button>
                )}
                {l.state === "unsure" ? (
                  <Button size="sm" variant="ghost" busy={busy === `${l.id}-false`} onClick={() => void correct(l, false)}>Skip</Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
