// What a study's calls found, by feature: a grid of features by people (a
// number is that person's findings on it, dark means one was a blocker),
// "N of M people" with Roadmap's stage, what the last call changed, suggested
// features to accept or merge, and the chosen feature's quotes, each opening
// its call at its minute.

import { useMemo, useState } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Button, Empty, Evidence, Menu, MenuItem, MenuLabel, Pill, Segmented, cx, errorText, openApp, plural, useToast } from "@lemma-plugins/kit";
import { SetupLink, Top } from "./App";
import { acceptFeature, keep, mergeFeature, useUI } from "./data";
import { gridOf, type GridRow } from "./grid";
import { IMPORTANCE_LABEL, STAGE_LABEL, mmss, stageTone } from "./marks";
import { StudyHead } from "./Study";
import { to } from "./route";
import type { Person } from "./types";

type By = "person" | "company";

export function FindingsPage({ id, feature }: { id: string; feature: string | null }) {
  const ui = useUI();
  const toast = useToast();
  const study = ui.studies.find((s) => s.id === id);
  const grid = useMemo(() => gridOf(ui, id), [ui, id]);
  const [by, setBy] = useState<By>("person");
  const [busy, setBusy] = useState("");

  if (!study) {
    return (
      <>
        <Top crumbs={[{ label: "User interviews", go: () => to.studies() }, { label: "Findings" }]} />
        <main className="c-body"><Empty title="This study isn't here" action={<Button onClick={() => to.studies()}>All studies</Button>} /></main>
      </>
    );
  }

  const chosen = grid.rows.find((r) => (r.feature?.id || null) === feature) || grid.rows[0];
  const columns: { key: string; label: string; sub: string; people: Person[] }[] = by === "person"
    ? grid.people.map((p) => ({ key: p.id, label: initialsOf(p.name || p.handle), sub: (p.company_name || "").split(" ")[0], people: [p] }))
    : [...groupBy(grid.people, (p) => p.company_name || p.handle).entries()].map(([name, ps]) => ({ key: name, label: name, sub: plural(ps.length, "person", "people"), people: ps }));
  const cellOf = (r: GridRow, ps: Person[]) => {
    let n = 0, blocker = false;
    for (const p of ps) {
      const c = r.cells.get(p.id);
      if (c) { n += c.n; blocker = blocker || c.blocker; }
    }
    return { n, blocker };
  };
  const companies = groupBy(grid.people, (p) => p.company_name || p.handle);
  const dealOf = (status: string) => {
    const all = [...companies.values()].filter((ps) => ps.some((p) => p.deal_status === status));
    const said = chosen ? all.filter((ps) => ps.some((p) => chosen.cells.has(p.id))) : [];
    return `${said.length} of ${all.length}`;
  };
  const active = ui.featureRows.filter((f) => f.state === "active");
  const pending = chosen?.feature ? ui.proposals.filter((x) => x.study_id === study.id && x.state === "open" && x.feature_id === chosen.feature?.id) : [];
  const decide = async (pid: string, keepIt: boolean) => {
    const x = ui.proposals.find((y) => y.id === pid);
    if (!x) return;
    setBusy(pid);
    try {
      toast(await keep(x, keepIt));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  };

  const accept = async (r: GridRow) => {
    if (!r.feature) return;
    setBusy(r.key);
    try {
      await acceptFeature(r.feature);
      toast(`${r.feature.name} is on the team's list.`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  };
  const merge = async (r: GridRow, into: (typeof active)[number]) => {
    if (!r.feature) return;
    setBusy(r.key);
    try {
      const n = await mergeFeature(r.feature, into);
      toast(`Merged into ${into.name}; ${plural(n, "quote")} moved with it.`);
      to.findings(study.id, into.id);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <Top crumbs={[{ label: "User interviews", go: () => to.studies() }, { label: "Studies", go: () => to.studies() }, { label: "Findings" }]}>
        <SetupLink />
      </Top>
      <main className="ui-page">
        <StudyHead study={study} tab="findings" />
        {!grid.rows.length ? (
          <div className="ui-pad"><Empty icon={Sparkles} title="No findings kept yet">After each call the Lemma proposes findings from the transcript or your notes; the ones you keep are counted here, by feature and by person.</Empty></div>
        ) : (
          <>
            <div className="ui-pad ui-findhead">
              <div className="c-grow">
                <h2 className="ui-h2">What {plural(grid.total, "person", "people")} said, by feature</h2>
                <div className="c-faint ui-small">
                  {plural(grid.total, "call")} with findings · {plural(grid.kept, "finding")} kept · a number is that {by === "person" ? "person's" : "company's"} findings on the feature; a filled square means one was a blocker
                </div>
              </div>
              <Segmented<By> label="Count by" value={by} onChange={setBy} items={[{ id: "person", label: "By person" }, { id: "company", label: "By company" }]} />
            </div>
            {grid.since.length ? (
              <div className="ui-pad">
                <div className="ui-since"><Pill tone="ai" icon={Sparkles}>Since the last call</Pill><span>{grid.since.slice(0, 3).join(" ")}</span></div>
              </div>
            ) : null}
            <div className="ui-pad">
              <div className="c-table-wrap">
                <table className="c-table ui-mx">
                  <thead>
                    <tr>
                      <th className="ui-mx__feat">Feature</th>
                      <th>People</th>
                      {columns.map((c) => <th key={c.key} className="ui-mx__col" title={c.people.map((p) => p.name || p.handle).join(", ")}><div>{c.label}</div><div className="c-faint ui-mx__sub">{c.sub}</div></th>)}
                      <th>Roadmap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.rows.map((r) => {
                      const pct = Math.round((r.people / Math.max(1, grid.total)) * 100);
                      return (
                        <tr key={r.key} className={cx(chosen?.key === r.key && "ui-sel-row")} onClick={() => to.findings(study.id, r.feature?.id || null)}>
                          <td className="ui-mx__feat ui-wrap">
                            <div>{r.name}</div>
                            {r.feature?.state === "suggested" ? (
                              <div className="ui-line ui-small" onClick={(e) => e.stopPropagation()}>
                                <Pill tone="ai" icon={Sparkles}>Suggested by Lemma</Pill>
                                <Button size="sm" variant="ghost" busy={busy === r.key} onClick={() => void accept(r)}>Accept</Button>
                                <Menu size="sm" variant="ghost" label="Merge">{(close) => <>
                                  <MenuLabel>Merge into</MenuLabel>
                                  {active.map((f) => <MenuItem key={f.id} onSelect={() => { close(); void merge(r, f); }}>{f.name}</MenuItem>)}
                                </>}</Menu>
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <div className="ui-count">
                              <span className="num ui-strong">{r.people} of {grid.total}</span>
                              <span className="ui-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                            </div>
                          </td>
                          {columns.map((c) => {
                            const cell = cellOf(r, c.people);
                            return <td key={c.key} className="ui-mx__col"><span className={cx("ui-cell", !cell.n && "ui-cell--0", cell.blocker && "ui-cell--b")} title={cell.blocker ? "A blocker" : undefined}>{cell.n || "·"}</span></td>;
                          })}
                          <td>{r.feature ? <Pill tone={stageTone(r.feature.stage)}>{STAGE_LABEL[r.feature.stage] || r.feature.stage}</Pill> : <span className="c-faint">Not filed</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {chosen ? (
              <div className="ui-split ui-split--find">
                <section className="ui-main">
                  <div className="c-section__head">
                    <h2>{chosen.name}</h2>
                    <span className="c-faint ui-small">{chosen.people} of {grid.total} people · {plural(chosen.findings, "finding")}{chosen.blockers ? ` · ${plural(chosen.blockers, "blocker")}` : ""}</span>
                  </div>
                  {pending.length ? (
                    <div className="ui-pending">
                      <div className="ui-line ui-small"><Pill tone="ai" icon={Sparkles}>To review</Pill><span className="c-faint">From your calls, filed here by the Lemma; kept ones count above.</span></div>
                      {pending.map((x) => {
                        const p = ui.people.find((y) => y.id === x.person_id);
                        return (
                          <div key={x.id} className="ui-q ui-q--pending">
                            <Evidence quote={x.quote} />
                            <div className="ui-line ui-small">
                              <span>{p?.name || p?.handle}</span>
                              <span className="c-faint">{p?.company_name}</span>
                              <button type="button" className="ui-link ui-t" onClick={() => to.call(study.id, x.person_id)}>
                                Call {shortDay(p?.call_at)}{x.at_seconds != null ? ` · ${mmss(x.at_seconds)}` : ""}
                              </button>
                              <span className="c-grow" />
                              <Button size="sm" variant="ghost" busy={busy === x.id} onClick={() => void decide(x.id, false)}>Set aside</Button>
                              <Button size="sm" busy={busy === x.id} onClick={() => void decide(x.id, true)}>Keep</Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="ui-quotes">
                    {chosen.quotes.map((f) => (
                      <div key={f.id} className="ui-q">
                        <Evidence quote={f.quote} />
                        <div className="ui-line ui-small">
                          <span>{f.person.name || f.person.handle}</span>
                          <span className="c-faint">{f.person.company_name}</span>
                          <button type="button" className="ui-link ui-t" onClick={() => to.call(study.id, f.person.id)}>
                            Call {shortDay(f.person.call_at || f.said_at)}{f.at_seconds != null ? ` · ${mmss(f.at_seconds)}` : ""}
                          </button>
                          <Pill tone={f.importance === "blocker" ? "danger" : "plain"} dot={f.importance === "blocker"}>{IMPORTANCE_LABEL[f.importance]}</Pill>
                          {f.source === "note" ? <Pill dot={false}>From your notes</Pill> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <aside className="ui-side">
                  <section className="ui-sec">
                    <h3>Who said it</h3>
                    <div className="ui-kv"><span>Companies with a won deal</span><span className="num">{dealOf("won")}</span></div>
                    <div className="ui-kv"><span>Companies with an open deal</span><span className="num">{dealOf("open")}</span></div>
                    <div className="ui-kv c-faint"><span>By plan or usage</span><span className="ui-small">only from a pasted list</span></div>
                  </section>
                  <section className="ui-sec">
                    <h3>Where it goes</h3>
                    <p>Every kept finding is shared with the team as feedback, filed under its feature. Roadmap ranks the feature by the people behind it, and Release notes tells them when it ships.</p>
                    <div className="ui-line ui-gap">
                      <Button icon={ArrowUpRight} onClick={() => void openApp("roadmap", chosen.feature ? `/f/${chosen.feature.id}` : "/").then((ok) => { if (!ok) toast("Add Roadmap to rank features by who asked."); })}>Open in Roadmap</Button>
                    </div>
                  </section>
                </aside>
              </div>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of list) out.set(key(t), [...(out.get(key(t)) || []), t]);
  return out;
}

function initialsOf(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

function shortDay(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
