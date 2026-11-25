// A conversation's messages as a person reads the work: what was asked, what
// the agent said, and its steps grouped the way a person reports them ("Read 7
// files · searched 3 times", "Edited 2 files", "Ran 3 commands · 1 failed"),
// not as a log of tool names. The idea is the Lemma web app's own
// (lemma-frontend/src/thread/step-groups.ts and tool-cards.ts), kept small.

export interface Message {
  id: string;
  role: string;
  kind: "TEXT" | "THINKING" | "NOTIFICATION" | "TOOL_CALL" | "TOOL_RETURN";
  text?: string | null;
  tool_name?: string | null;
  tool_call_id?: string | null;
  tool_args?: unknown;
  tool_result?: unknown;
  created_at: string;
  sequence?: number;
}

type Kind = "read" | "search" | "edit" | "command" | "browser" | "web" | "other";

export interface Step {
  id: string;
  tool: string;
  kind: Kind;
  subject: string;
  args: Record<string, unknown>;
  done: boolean;
  failed: boolean;
  exit: number | null;
  /** One line of what came back: "exit 1 · 2 failing", "38 passed". */
  said: string;
  at: string;
  add: number;
  del: number;
}

export type Item =
  | { kind: "you"; id: string; text: string; at: string }
  | { kind: "text"; id: string; text: string; at: string }
  | { kind: "steps"; id: string; group: Kind; steps: Step[] };

const KIND: Record<string, Kind> = {
  read_file: "read", read: "read", pod_read_file: "read", view_image: "read", notebookread: "read",
  list_files: "search", glob: "search", grep: "search", search: "search", pod_search_files: "search", ls: "search",
  edit_file: "edit", edit: "edit", multiedit: "edit", write_file: "edit", write: "edit", apply_patch: "edit", delete_file: "edit", notebookedit: "edit",
  exec_command: "command", shell: "command", terminal: "command", bash: "command", execute_python: "command", python: "command",
  browser: "browser", browser_open: "browser", browser_act: "browser", browser_read: "browser", browser_snapshot: "browser", browser_screenshot: "browser",
  web_search: "web", websearch: "web", web_fetch: "web", fetch: "web", webfetch: "web",
};

function kindOf(tool: string): Kind {
  return KIND[tool.toLowerCase()] || "other";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function first(args: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) if (str(args[k]).trim()) return str(args[k]).replace(/\s+/g, " ").trim();
  return "";
}

function lines(text: string): number {
  if (!text) return 0;
  return text.replace(/\n$/, "").split("\n").length;
}

function subjectOf(kind: Kind, args: Record<string, unknown>): string {
  if (kind === "read" || kind === "edit") return first(args, "path", "file_path", "filepath", "notebook_path");
  if (kind === "search") return first(args, "pattern", "query", "q", "path");
  if (kind === "command") return first(args, "cmd", "command", "code");
  if (kind === "web" || kind === "browser") return first(args, "url", "query", "action");
  return "";
}

/** What came back, as one line, and whether it failed. */
function outcome(result: unknown): { failed: boolean; exit: number | null; said: string } {
  let r = result;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {
      /* plain text */
    }
  }
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  const exit = typeof o.exit_code === "number" ? o.exit_code : typeof o.returncode === "number" ? o.returncode : null;
  const failed = (exit != null && exit !== 0) || o.success === false || (o.error != null && o.error !== "");
  const text = typeof r === "string" ? r : str(o.output) || str(o.stdout) || str(o.stderr) || str(o.error) || str(o.result);
  const last = text.split("\n").map((l) => l.trim()).filter(Boolean).pop() || "";
  const clipped = last.length > 48 ? last.slice(0, 47) + "…" : last;
  return { failed, exit, said: [failed && exit != null ? `exit ${exit}` : "", clipped].filter(Boolean).join(" · ") };
}

function diffOf(tool: string, args: Record<string, unknown>): { add: number; del: number } {
  const t = tool.toLowerCase();
  if (t === "write_file" || t === "write") return { add: lines(first(args, "content", "text") || str(args.content)), del: 0 };
  if (t === "apply_patch") {
    const p = str(args.patch) || str(args.input);
    return { add: (p.match(/^\+(?!\+\+)/gm) || []).length, del: (p.match(/^-(?!--)/gm) || []).length };
  }
  if (t === "multiedit" && Array.isArray(args.edits)) {
    return (args.edits as Record<string, unknown>[]).reduce<{ add: number; del: number }>(
      (n, e) => ({ add: n.add + lines(str(e.new_string)), del: n.del + lines(str(e.old_string)) }), { add: 0, del: 0 });
  }
  return { add: lines(str(args.new_string) || str(args.new_str)), del: lines(str(args.old_string) || str(args.old_str)) };
}

/** The brief the bundle sends starts with `[coding session <id>]`: a person reads the rest. */
export function cleanBrief(text: string): string {
  return text.replace(/^\s*\[coding (session|question) [^\]]+\]\s*/i, "").trim();
}

export function build(messages: Message[]): Item[] {
  const sorted = [...messages].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.created_at.localeCompare(b.created_at));
  const returns = new Map<string, Message>();
  for (const m of sorted) if (m.kind === "TOOL_RETURN" && m.tool_call_id) returns.set(m.tool_call_id, m);
  const out: Item[] = [];
  for (const m of sorted) {
    if (m.kind === "TEXT" && m.text?.trim()) {
      const you = m.role === "user";
      out.push({ kind: you ? "you" : "text", id: m.id, text: you ? cleanBrief(m.text) : m.text.trim(), at: m.created_at });
    } else if (m.kind === "TOOL_CALL") {
      const tool = m.tool_name || "tool";
      const kind = kindOf(tool);
      const args = (m.tool_args && typeof m.tool_args === "object" ? m.tool_args : {}) as Record<string, unknown>;
      const ret = m.tool_call_id ? returns.get(m.tool_call_id) : undefined;
      const res = ret ? outcome(ret.tool_result) : { failed: false, exit: null, said: "" };
      const diff = kind === "edit" ? diffOf(tool, args) : { add: 0, del: 0 };
      const step: Step = { id: m.id, tool, kind, subject: subjectOf(kind, args), args, done: !!ret, ...res, at: m.created_at, ...diff };
      // Reading and searching are one kind of work; so are browsing and fetching pages.
      const group: Kind = kind === "search" ? "read" : kind === "web" ? "browser" : kind;
      const last = out[out.length - 1];
      if (last && last.kind === "steps" && last.group === group) last.steps.push(step);
      else out.push({ kind: "steps", id: m.id, group, steps: [step] });
    }
  }
  return out;
}

const n = (count: number, one: string, many: string) => (count === 1 ? one : many.replace("{n}", String(count)));

/** One group's line: "Read 7 files · searched 3 times". */
export function said(group: Kind, steps: Step[]): string {
  if (group === "read") {
    const files = new Set(steps.filter((s) => s.kind === "read").map((s) => s.subject || s.id)).size;
    const searches = steps.filter((s) => s.kind === "search").length;
    const parts = [files ? n(files, "Read a file", "Read {n} files") : "", searches ? n(searches, "searched once", "searched {n} times") : ""].filter(Boolean);
    const line = parts.join(" · ");
    return line.charAt(0).toUpperCase() + line.slice(1);
  }
  if (group === "edit") return n(files(steps).length, "Edited a file", "Edited {n} files");
  if (group === "command") {
    const failed = steps.filter((s) => s.failed).length;
    const done = steps.filter((s) => s.done).length;
    if (!done) return n(steps.length, "Running a command", "Running {n} commands");
    return n(done, "Ran a command", "Ran {n} commands") + (failed ? ` · ${failed} failed` : "") + (done < steps.length ? " · running one" : "");
  }
  if (group === "browser") return n(steps.length, "Used the browser", "Used the browser {n} times");
  const names = [...new Set(steps.map((s) => s.tool.replace(/_/g, " ")))];
  return `Used ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`;
}

/** Each edited file once, with its lines added and taken out. */
export function files(steps: Step[]): { path: string; add: number; del: number }[] {
  const by = new Map<string, { path: string; add: number; del: number }>();
  for (const s of steps) {
    const path = s.subject || "a file";
    const f = by.get(path) || { path, add: 0, del: 0 };
    f.add += s.add;
    f.del += s.del;
    by.set(path, f);
  }
  return [...by.values()];
}

/** The step in hand while a run works: "Running pnpm typecheck". */
export function doing(items: Item[]): string | null {
  const last = items[items.length - 1];
  if (!last || last.kind !== "steps") return null;
  const step = last.steps[last.steps.length - 1];
  if (step.done) return null;
  const x = step.subject ? ` ${short(step.subject)}` : "";
  if (step.kind === "command") return `Running${x}`;
  if (step.kind === "read") return `Reading${x}`;
  if (step.kind === "search") return `Searching${x}`;
  if (step.kind === "edit") return `Editing${x}`;
  if (step.kind === "browser" || step.kind === "web") return "Using the browser";
  return `Using ${step.tool.replace(/_/g, " ")}`;
}

/** The last thing it did, for the board card: the command as typed, or the file. */
export function lastLine(items: Item[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "steps") continue;
    const step = item.steps[item.steps.length - 1];
    if (step.kind === "command") return short(step.subject, 80);
    if (step.kind === "search") return `search ${short(step.subject, 70)}`;
    return `${step.kind === "edit" ? "edit" : step.kind === "read" ? "read" : step.tool} ${short(step.subject, 70)}`.trim();
  }
  return null;
}

/** The whole run in one line, for Activity: "Read 11 files · Edited 4 files · Ran 9 commands · 1 failed". */
export function summary(items: Item[]): { line: string; minutes: number } | null {
  const steps = items.flatMap((i) => (i.kind === "steps" ? i.steps : []));
  if (!steps.length) return null;
  const reads = new Set(steps.filter((s) => s.kind === "read").map((s) => s.subject)).size;
  const edits = files(steps.filter((s) => s.kind === "edit")).length;
  const cmds = steps.filter((s) => s.kind === "command");
  const failed = cmds.filter((s) => s.failed).length;
  const parts = [
    reads ? n(reads, "Read a file", "Read {n} files") : "",
    edits ? n(edits, "Edited a file", "Edited {n} files") : "",
    cmds.length ? n(cmds.length, "Ran a command", "Ran {n} commands") + (failed ? ` · ${failed} failed` : "") : "",
  ].filter(Boolean);
  const times = items.map((i) => Date.parse(i.kind === "steps" ? i.steps[0].at : i.at)).filter(Number.isFinite);
  const minutes = times.length ? Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60000)) : 0;
  return { line: parts.join(" · "), minutes };
}

function short(text: string, most = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > most ? t.slice(0, most - 1) + "…" : t;
}
