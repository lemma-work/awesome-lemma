// What a study found, by feature, counted in people: the same numbers
// interviews_findings gives the Lemma's assistant, worked out here from the
// rows the page already holds so the grid moves the moment a finding is kept.

import type { UI } from "./data";
import type { Feature, Feedback, Person } from "./types";

export interface Cell { n: number; blocker: boolean }
export interface GridRow {
  key: string;
  feature: Feature | null;
  name: string;
  people: number;
  findings: number;
  blockers: number;
  cells: Map<string, Cell>;
  quotes: (Feedback & { person: Person })[];
}
export interface Grid { people: Person[]; rows: GridRow[]; since: string[]; total: number; kept: number }

function build(found: (Feedback & { person: Person })[], features: UI["features"]): Map<string, GridRow> {
  const rows = new Map<string, GridRow>();
  for (const f of found) {
    let fid = f.feature_id || "none";
    let feature = f.feature_id ? features.get(f.feature_id) || null : null;
    // A merged feature's findings count under the one it was merged into.
    for (let i = 0; feature?.state === "merged" && feature.merged_into && i < 4; i++) {
      fid = feature.merged_into;
      feature = features.get(fid) || null;
    }
    let row = rows.get(fid);
    if (!row) {
      row = { key: fid, feature, name: feature?.name || "Not filed", people: 0, findings: 0, blockers: 0, cells: new Map(), quotes: [] };
      rows.set(fid, row);
    }
    const cell = row.cells.get(f.person.id) || { n: 0, blocker: false };
    cell.n += 1;
    cell.blocker = cell.blocker || f.importance === "blocker";
    row.cells.set(f.person.id, cell);
    row.findings += 1;
    row.quotes.push(f);
  }
  for (const row of rows.values()) {
    row.people = row.cells.size;
    row.blockers = [...row.cells.values()].filter((c) => c.blocker).length;
  }
  return rows;
}

export function gridOf(ui: UI, studyId: string): Grid {
  const byId = new Map(ui.people.map((p) => [p.id, p]));
  const fb = new Map(ui.feedback.map((f) => [f.id, f]));
  const found: (Feedback & { person: Person })[] = [];
  for (const link of ui.findings) {
    if (link.study_id !== studyId) continue;
    const f = fb.get(link.id);
    const person = byId.get(link.person_id);
    if (f && person) found.push({ ...f, person });
  }
  const people = [...new Map(found.map((f) => [f.person.id, f.person])).values()]
    .sort((a, b) => String(a.call_at || "").localeCompare(String(b.call_at || "")));
  const rows = [...build(found, ui.features).values()]
    .sort((a, b) => b.people - a.people || b.blockers - a.blockers || b.findings - a.findings || a.name.localeCompare(b.name));
  for (const r of rows) {
    r.quotes.sort((a, b) => Number(b.importance === "blocker") - Number(a.importance === "blocker") || String(b.said_at || "").localeCompare(String(a.said_at || "")));
  }
  // Since the last call: what the newest call with findings changed.
  const since: string[] = [];
  const last = people[people.length - 1];
  if (last && people.length > 1) {
    const before = build(found.filter((f) => f.person.id !== last.id), ui.features);
    for (const r of rows) {
      const was = before.get(r.key);
      const wasPeople = was?.people || 0;
      if (r.people > wasPeople) since.push(wasPeople ? `${r.name} went from ${wasPeople} to ${r.people} people.` : `${r.name} came up for the first time.`);
      if (r.blockers && !was?.blockers) since.push(`${r.name} gained its first blocker.`);
    }
  }
  return { people, rows, since, total: people.length, kept: found.length };
}
