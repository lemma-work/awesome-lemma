// GitHub's per-file `patch` is a unified diff without file headers.
// (From the Factory pod's lib/diff.ts.)

export interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
  old?: number;
  new?: number;
  /** The new-file line this sits at (a deletion sits before the next new line). */
  at: number;
}
export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parsePatch(patch: string | null | undefined): DiffHunk[] {
  if (!patch) return [];
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  let o = 0;
  let nn = 0;
  for (const raw of patch.split("\n")) {
    const m = HEADER.exec(raw);
    if (m) {
      o = Number(m[1]);
      nn = Number(m[2]);
      cur = { header: m[3].trim(), oldStart: o, newStart: nn, lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const c = raw[0];
    const text = raw.slice(1);
    if (c === "+") cur.lines.push({ kind: "add", text, new: nn, at: nn++ });
    else if (c === "-") cur.lines.push({ kind: "del", text, old: o++, at: nn });
    else cur.lines.push({ kind: "ctx", text, old: o++, new: nn, at: nn++ });
  }
  return hunks;
}

/** The new-file lines a diff shows (added and context), where a finding can sit. */
export function shownLines(hunks: DiffHunk[]): Set<number> {
  const out = new Set<number>();
  for (const h of hunks) for (const l of h.lines) if (l.kind !== "del" && l.new != null) out.add(l.new);
  return out;
}

/** The lines a push changed (added), the only ones a new finding may sit on. */
export function addedLines(hunks: DiffHunk[]): Set<number> {
  const out = new Set<number>();
  for (const h of hunks) for (const l of h.lines) if (l.kind === "add" && l.new != null) out.add(l.new);
  return out;
}

/** A suggestion written as a diff (lines starting + or -), or as plain replacement code. */
export function suggestionLines(text: string): { kind: "add" | "del" | "ctx"; text: string }[] {
  const lines = text.replace(/\r/g, "").replace(/^```[a-z]*\n?|\n?```$/g, "").split("\n");
  const diffy = lines.some((l) => /^[+-]/.test(l));
  return lines.map((l) => (diffy ? { kind: l[0] === "+" ? "add" : l[0] === "-" ? "del" : "ctx", text: /^[+\- ]/.test(l) ? l.slice(1) : l } : { kind: "add", text: l }));
}
