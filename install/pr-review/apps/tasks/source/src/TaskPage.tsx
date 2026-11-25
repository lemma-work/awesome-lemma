// One task: its title and notes, sub-tasks, and one timeline where people and
// agents both write. With an agent on it: what it is doing (its steps, read
// from its conversation), its questions and its asks for approval, answered
// right here; a reply goes back into its conversation.
//
// Properties beside it: status, priority, who has it, due, project or
// private, labels, where it came from.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Bot, CalendarDays, Check, ChevronDown, ChevronRight, CircleDot, Eye, FileText, FolderKanban, Globe, Handshake, Lock, MoreHorizontal,
  MoveRight, Pencil, Play, Plus, Search, Send, Sparkles, Square, Tag, Terminal, Trash2, Undo2, UserRound, Users, Wrench, X,
} from "lucide-react";
import {
  Avatar, Button, Card, Empty, Evidence, Face, Markdown, Menu, MenuItem, MenuLabel, Pill, Sheet, Skeleton, ago, client, cx, items, plural, useToast,
} from "@lemma-plugins/kit";
import {
  ACTIVITY, createTask, decide, deleteTasks, dismissSuggestion, handOver, loadActivity, moveTask, patchTask, reply, startAgain, stopAgent, useTasks, useWorld,
} from "./data";
import { Assignee, Due, PriorityIcon, RunPill, StatusIcon, agentName } from "./marks";
import { AssignPicker, PriorityPicker, StatusPicker } from "./pickers";
import { backToList, to } from "./route";
import { typing } from "./Shell";
import { SUGGEST_FROM, ASSISTANT, PRIORITY_LABEL, STATUS_LABEL, type Activity, type Run, type Task } from "./types";

interface Step {
  at: string;
  run: string;
  tool: string;
  what: string;
}

/** Live rows of one timeline: read, then re-read when its table changes. */
function useTimeline(task: Task | undefined) {
  const [rows, setRows] = useState<Activity[] | null>(null);
  const load = useCallback(async () => {
    if (!task) return;
    setRows(await loadActivity(task).catch(() => []));
  }, [task?.id, task?.scope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRows(null);
    void load();
    if (!task) return;
    const table = ACTIVITY[task.scope];
    let timer = 0;
    const handle = client.datastore.watchChanges({
      onChange: (frame: { table_name: string }) => {
        if (frame.table_name !== table) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void load(), 350);
      },
      onError: () => undefined,
    } as never) as unknown as { close?: () => void; stop?: () => void } | undefined;
    return () => {
      window.clearTimeout(timer);
      handle?.close?.();
      handle?.stop?.();
    };
  }, [task?.id, task?.scope, load]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, reload: load };
}

const STEP_WORDS: Record<string, [string, string]> = {
  web_search: ["web search", "web searches"],
  web_fetch: ["page read", "pages read"],
  exec_command: ["command", "commands"],
  pod_read_file: ["file read", "files read"],
  pod_write_file: ["file written", "files written"],
  pod_search_files: ["file search", "file searches"],
  pod_query: ["look-up in this Lemma", "look-ups in this Lemma"],
  pod_run_function: ["function run", "functions run"],
  pod_get_records: ["record read", "records read"],
  pod_list_files: ["folder look", "folder looks"],
  pod_tables: ["table list", "table lists"],
  browser: ["browser step", "browser steps"],
};

const TOOL_WORDS: Record<string, [string, typeof Search]> = {
  pod_query: ["Looked up records", Search],
  pod_search_files: ["Searched files", Search],
  pod_run_function: ["Ran a function", Play],
  web_search: ["Searched the web", Search],
  web_fetch: ["Read pages", Globe],
  exec_command: ["Ran a command", Terminal],
  pod_read_file: ["Read a file", FileText],
  pod_write_file: ["Wrote a file", FileText],
  browser: ["Used the browser", Globe],
  final_result: ["Finished its turn", Check],
};

function describe(tool: string, args: Record<string, unknown> | null): string {
  const a = args || {};
  if (tool === "web_search") return String(a.query || "");
  if (tool === "web_fetch") return (Array.isArray(a.urls) ? (a.urls as string[]) : [String(a.url || "")]).map((u) => u.replace(/^https?:\/\//, "").split("/")[0]).join(", ");
  if (tool === "exec_command") return String(a.comment || String(a.cmd || "").split("\n")[0]).slice(0, 140);
  if (tool.startsWith("pod_")) return String(a.path || "");
  if (tool === "final_result") return "";
  return Object.values(a).filter((v) => typeof v === "string").join(" ").slice(0, 120);
}

/** The agent's steps, from its conversation: tool calls grouped by turn. */
function useSteps(run: Run | null | undefined) {
  const [steps, setSteps] = useState<Step[]>([]);
  const live = !!run && ["starting", "working"].includes(run.state);
  useEffect(() => {
    if (!run?.conversation_id) return;
    let alive = true;
    const read = async () => {
      try {
        const page = await client.conversations.messages.list(run.conversation_id!, { limit: 300 });
        const list = items<{ kind?: string; tool_name?: string; tool_args?: Record<string, unknown>; created_at: string; agent_run_id?: string }>(page);
        if (!alive) return;
        setSteps(list.filter((m) => m.kind === "TOOL_CALL" && m.tool_name).map((m) => ({
          at: m.created_at, run: m.agent_run_id || "", tool: m.tool_name || "", what: describe(m.tool_name || "", m.tool_args || null),
        })));
      } catch {
        /* the conversation is someone else's: no steps to show */
      }
    };
    void read();
    const timer = live ? window.setInterval(() => void read(), 5000) : 0;
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [run?.conversation_id, live, run?.last_report_at]); // eslint-disable-line react-hooks/exhaustive-deps
  return steps;
}

type Item = { at: string; key: string; activity?: Activity; steps?: Step[] };

export function TaskPage({ id }: { id: string }) {
  const data = useTasks();
  const { me, lemmaName } = useWorld();
  const toast = useToast();
  const task = data.byId.get(id);
  const run = task ? data.runById.get(task.id) || null : null;
  const decision = task ? data.decisionById.get(task.id) || null : null;
  const { rows, reload } = useTimeline(task);
  const steps = useSteps(task?.assignee_kind === "agent" ? run : null);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !typing(e) && !document.querySelector(".c-sheet, .tk-palette, .c-menu")) backToList();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const timeline = useMemo<Item[]>(() => {
    const list: Item[] = (rows || []).map((a) => ({ at: a.created_at, key: a.id, activity: a }));
    const byRun = new Map<string, Step[]>();
    for (const s of steps) {
      if (s.tool === "final_result") continue;
      (byRun.get(s.run) || byRun.set(s.run, []).get(s.run)!).push(s);
    }
    for (const [runId, group] of byRun) list.push({ at: group[0].at, key: `steps:${runId}`, steps: group });
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [rows, steps]);

  if (!data.loaded) return <div className="tk-pad"><Skeleton kind="record" /></div>;
  if (!task) {
    return (
      <div className="tk-pad">
        <Empty icon={Search} title="This task isn't here" action={<Button onClick={backToList}>Back to the list</Button>}>
          It was deleted, moved, or it's someone else's own task.
        </Empty>
      </div>
    );
  }

  const project = task.project_id ? data.projectById.get(task.project_id) : undefined;
  const parent = task.parent_id ? data.byId.get(task.parent_id) : undefined;
  const subs = data.children.get(task.id) || [];
  const pending = (rows || []).filter((a) => a.state === "pending");
  const question = pending.find((a) => a.kind === "question");
  const agentOn = task.assignee_kind === "agent";
  const who = agentName(task.assignee_agent, lemmaName);
  const mine = !task.owner_user_id || task.owner_user_id === me?.id;

  return (
    <>
      <header className="tk-head">
        <nav className="c-header__crumb" aria-label="Back">
          <button type="button" onClick={backToList}><ArrowLeft size={15} aria-hidden="true" />{project ? project.name : task.scope === "personal" ? "My tasks" : "Team"}</button>
          {parent ? <><span aria-hidden="true">/</span><button type="button" onClick={() => to.task(parent.id)} className="c-ellipsis">{parent.title}</button></> : null}
          <span aria-hidden="true">/</span>
          <span className="c-faint num">{task.scope === "team" && task.number ? `#${task.number}` : "Private"}</span>
        </nav>
        <span className="c-grow" />
        <TaskMenu task={task} mine={mine} />
      </header>
      <main className="tk-record">
        <div className="tk-record__main">
          <div className="tk-title">
            <StatusPicker task={task} size={20} />
            <TitleField task={task} />
          </div>
          <div className="c-record-head__facts tk-facts">
            <Pill tone={task.status === "waiting" ? "warning" : task.status === "done" ? "success" : task.status === "in_progress" ? "info" : "plain"}>{STATUS_LABEL[task.status]}</Pill>
            {task.priority !== "none" ? <Pill dot={false}><span className="c-row" style={{ gap: 5 }}><PriorityIcon priority={task.priority} />{PRIORITY_LABEL[task.priority]}</span></Pill> : null}
            {task.due_on ? <Pill dot={false} icon={CalendarDays}><Due on={task.due_on} zone={data.settings?.timezone} done={task.status === "done"} /></Pill> : null}
            {task.scope === "personal" ? <Pill dot={false} icon={Lock}>Only you</Pill> : <Pill dot={false} icon={Users}>{project ? project.name : "Team"}</Pill>}
            {task.source === "promise" ? <Pill dot={false} icon={Handshake}>From a promise</Pill> : null}
            {task.source === "chat" ? <Pill tone="ai" icon={Sparkles}>Added in chat</Pill> : null}
          </div>

          <div className="tk-props-inline"><Properties task={task} /></div>

          {decision?.state === "open" && decision.answer === "yes" && (decision.confidence ?? 1) >= SUGGEST_FROM && !agentOn && !["done", "canceled"].includes(task.status) ? (
            <div className="tk-suggestion">
              <Face size={32} />
              <div className="c-grow">
                <p><b>{decision.reason || "An agent could do this."}</b></p>
                <p className="c-muted">It works in a conversation of its own and reports here. Nothing goes outside this Lemma without your approval.</p>
              </div>
              <div className="tk-suggestion__acts">
                <Button variant="primary" icon={Sparkles} onClick={() => void handOver(task, ASSISTANT, me, decision).then(() => toast(`Handed to ${lemmaName}`)).catch((e) => toast(`Couldn't hand it over: ${e.message}`))}>
                  Hand it to {lemmaName}
                </Button>
                <Button variant="ghost" onClick={() => void dismissSuggestion(decision).then(() => toast("Noted. Tasks learns from it."))}>Not this one</Button>
              </div>
            </div>
          ) : null}

          {agentOn ? <AgentCard task={task} run={run} who={who} steps={steps.length} /> : null}

          <Notes task={task} />
          {task.quote ? (
            <div className="tk-quote">
              <p className="tk-quote__label"><Handshake size={13} aria-hidden="true" /> {task.source === "promise" ? "What you said" : "Where it came from"}</p>
              <Evidence quote={task.quote} />
            </div>
          ) : null}

          {!task.parent_id ? <SubTasks task={task} subs={subs} /> : null}

          <section className="tk-activity" aria-label="Activity">
            <h2 className="tk-activity__head">Activity</h2>
            {rows === null ? <Skeleton kind="list" rows={3} /> : (
              <ol className="tk-tl">
                {timeline.map((item) => item.steps
                  ? <StepsItem key={item.key} steps={item.steps} who={who} />
                  : <ActivityItem key={item.key} a={item.activity!} task={task} run={run} lemmaName={lemmaName} onChange={reload} />)}
                {!timeline.length ? <li className="tk-tl__empty c-faint">Nothing yet.</li> : null}
              </ol>
            )}
            <Composer task={task} run={run} question={question} pending={pending} who={who} onSent={reload} />
          </section>
        </div>
        <aside className="tk-record__side">
          <Properties task={task} />
        </aside>
      </main>
    </>
  );
}

function TitleField({ task }: { task: Task }) {
  const { me } = useWorld();
  const toast = useToast();
  const [value, setValue] = useState(task.title);
  useEffect(() => setValue(task.title), [task.title]);
  const save = () => {
    const next = value.trim();
    if (!next || next === task.title) return setValue(task.title);
    void patchTask(task, { title: next }, me).catch((e) => toast(`Couldn't rename it: ${e.message}`));
  };
  return (
    <textarea className="tk-title__input" value={value} rows={1} aria-label="Title"
      onChange={(e) => setValue(e.target.value.replace(/\n/g, " "))}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } if (e.key === "Escape") { setValue(task.title); (e.target as HTMLTextAreaElement).blur(); } }} />
  );
}

function Notes({ task }: { task: Task }) {
  const { me } = useWorld();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.description || "");
  useEffect(() => { if (!editing) setValue(task.description || ""); }, [task.description, editing]);
  if (editing) {
    return (
      <div className="tk-notes">
        <textarea className="c-textarea tk-notes__input" value={value} autoFocus aria-label="Notes" placeholder="Notes, in markdown"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (document.getElementById("tk-notes-save") as HTMLButtonElement)?.click(); } }} />
        <div className="c-row">
          <Button id="tk-notes-save" size="sm" variant="primary" onClick={() => { setEditing(false); void patchTask(task, { description: value.trim() || null }, me).catch((e) => toast(`Couldn't save: ${e.message}`)); }}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="tk-notes">
      {task.description ? (
        <button type="button" className="tk-notes__view" onClick={() => setEditing(true)} aria-label="Edit the notes">
          <Markdown text={task.description} />
        </button>
      ) : (
        <button type="button" className="tk-notes__empty" onClick={() => setEditing(true)}><Pencil size={13} aria-hidden="true" /> Add notes</button>
      )}
    </div>
  );
}

function SubTasks({ task, subs }: { task: Task; subs: Task[] }) {
  const { me } = useWorld();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const done = subs.filter((s) => s.status === "done").length;
  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    await createTask({ title: t, parent: task, assignee: task.assignee_kind === "person" ? { kind: "person", user_id: task.assignee_user_id || undefined, name: task.assignee_name || undefined } : { kind: "none" } }, me)
      .catch((e) => toast(`Couldn't add it: ${e.message}`));
  };
  return (
    <section className="tk-subtasks" aria-label="Sub-tasks">
      <h2 className="tk-activity__head">Sub-tasks {subs.length ? <span className="c-count num">{done}/{subs.length}</span> : null}</h2>
      {subs.map((s) => (
        <div key={s.id} className="tk-sub" onClick={() => to.task(s.id)}>
          <StatusPicker task={s} size={14} />
          <span className={cx("c-grow c-ellipsis", s.status === "done" && "tk-strike")}>{s.title}</span>
          <Due on={s.due_on} done={s.status === "done"} />
        </div>
      ))}
      <label className="tk-sub tk-sub--add">
        <Plus size={14} aria-hidden="true" />
        <input className="c-input c-input--bare" placeholder="Add a sub-task" value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} aria-label="Add a sub-task" />
      </label>
    </section>
  );
}

function AgentCard({ task, run, who, steps }: { task: Task; run: Run | null; who: string; steps: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const live = !!run && ["starting", "working", "waiting"].includes(run.state);
  const quiet = run?.state === "working" && run.last_report_at && Date.now() - Date.parse(run.last_report_at) > 15 * 60_000;
  return (
    <div className="tk-agent">
      {task.assignee_agent === ASSISTANT ? <Face size={32} /> : <span className="tk-bot" style={{ width: 32, height: 32 }}><Bot size={18} aria-hidden="true" /></span>}
      <div className="c-grow">
        <p className="c-row" style={{ flexWrap: "wrap" }}>
          <b>{who}</b>
          <span className="c-muted">{!run ? "is about to start" : run.state === "done" ? "finished it" : run.state === "waiting" ? "is waiting on you" : run.state === "failed" ? "couldn't start" : run.state === "stopped" ? "stopped" : "is on it"}</span>
          <RunPill run={run} />
        </p>
        <p className="c-faint tk-agent__sub">
          {run?.started_at ? `Started ${ago(run.started_at)}` : "Handed over just now"}
          {steps ? ` · ${plural(steps, "step")}` : ""}
          {run?.last_report_at ? ` · last word ${ago(run.last_report_at)}` : ""}
          {quiet ? " · quiet for a while" : ""}
        </p>
        {run?.state === "failed" && run.error ? <p className="tk-agent__err">{run.error.slice(0, 300)}</p> : null}
      </div>
      <div className="tk-suggestion__acts">
        {live ? (
          <Button size="sm" icon={Square} busy={busy} onClick={() => { if (!run) return; setBusy(true); void stopAgent(task, run).then(() => toast("Stopped.")).finally(() => setBusy(false)); }}>Stop</Button>
        ) : (
          <Button size="sm" icon={Play} busy={busy} onClick={() => { setBusy(true); void startAgain(task).then(() => toast("Started again.")).catch((e) => toast(`Couldn't start: ${e.message}`)).finally(() => setBusy(false)); }}>
            {run ? "Start again" : "Start"}
          </Button>
        )}
      </div>
    </div>
  );
}

function StepsItem({ steps, who }: { steps: Step[]; who: string }) {
  const [open, setOpen] = useState(false);
  const counts = new Map<string, number>();
  for (const s of steps) counts.set(s.tool, (counts.get(s.tool) || 0) + 1);
  const summary = [...counts.entries()].map(([tool, n]) => {
    const words = STEP_WORDS[tool];
    if (words) return `${n} ${n === 1 ? words[0] : words[1]}`;
    return `${tool.replace(/^pod_/, "").replace(/_/g, " ")} ×${n}`;
  }).join(", ");
  return (
    <li className="tk-tl__item tk-tl__item--steps">
      <span className="tk-tl__icon"><Wrench size={13} aria-hidden="true" /></span>
      <div className="tk-tl__main">
        <button type="button" className="tk-steps__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          <span><b>{who}</b> worked: {summary}</span>
        </button>
        {open ? (
          <ol className="tk-steps">
            {steps.map((s, i) => {
              const [word, Icon] = TOOL_WORDS[s.tool] || [s.tool.replace(/_/g, " "), Wrench];
              return (
                <li key={i}><Icon size={12} aria-hidden="true" /><span className="tk-steps__word">{word}</span><span className="c-faint c-ellipsis">{s.what}</span></li>
              );
            })}
          </ol>
        ) : null}
      </div>
      <time className="tk-tl__when" dateTime={steps[0].at} title={new Date(steps[0].at).toLocaleString()}>{ago(steps[0].at)}</time>
    </li>
  );
}

/** An agent's words without the raw paths of files shown as chips below them:
 *  a line that only labelled a path ("Draft: `/tasks/…/x.md`") goes; a path
 *  inside a sentence becomes the file's name. */
function withoutPaths(body: string, files: string[]): string {
  if (!files.length) return body;
  let text = body;
  for (const f of files) {
    const name = f.split("/").pop() || f;
    const bare = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text
      .split("\n")
      .filter((line) => !new RegExp(`^\\s*[\\w ,'’-]{0,24}:?\\s*\`?${bare}\`?\\.?\\s*$`).test(line))
      .join("\n")
      .replace(new RegExp(`\`?${bare}\`?`, "g"), name);
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function FileLink({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const name = path.split("/").pop() || path;
  const show = async () => {
    setOpen(true);
    if (text !== null) return;
    try {
      const blob = await client.files.download(path);
      setText(await blob.text());
    } catch (e) {
      setOpen(false);
      toast(`Couldn't open ${name}: ${e instanceof Error ? e.message : e}`);
    }
  };
  return (
    <>
      <button type="button" className="tk-file" onClick={() => void show()}><FileText size={13} aria-hidden="true" />{name}</button>
      <Sheet open={open} title={name} onClose={() => setOpen(false)}>
        {text === null ? <Skeleton kind="list" rows={4} /> : name.endsWith(".md") ? <Markdown text={text} /> : <pre className="tk-pre">{text}</pre>}
      </Sheet>
    </>
  );
}

function ActivityItem({ a, task, run, lemmaName, onChange }: { a: Activity; task: Task; run: Run | null; lemmaName: string; onChange: () => void }) {
  const { me } = useWorld();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const isAgent = a.actor_kind === "agent" || a.actor_kind === "lemma";
  const name = a.actor_kind === "person" ? (a.actor_user_id && a.actor_user_id === me?.id ? "You" : a.actor_name || "Someone") : agentName(a.actor_name, lemmaName);
  const d = (a.detail || {}) as Record<string, unknown>;
  const files = Array.isArray(d.files) ? (d.files as string[]) : [];
  const when = <time className="tk-tl__when" dateTime={a.created_at} title={new Date(a.created_at).toLocaleString()}>{ago(a.created_at)}</time>;
  const face = isAgent ? (a.actor_name === ASSISTANT || a.actor_kind === "lemma" ? <Face size={22} /> : <span className="tk-bot" style={{ width: 22, height: 22 }}><Bot size={13} aria-hidden="true" /></span>) : <Avatar name={a.actor_name} size={22} you={a.actor_user_id === me?.id} />;

  // One-line events.
  if (["status", "assign", "field", "created", "moved", "started", "stopped"].includes(a.kind)) {
    let line: React.ReactNode = a.body || "";
    let Icon = CircleDot;
    if (a.kind === "status") {
      Icon = MoveRight;
      line = <>moved it to <b>{STATUS_LABEL[(d.to as Task["status"]) || "todo"]}</b></>;
    } else if (a.kind === "assign") {
      Icon = UserRound;
      line = d.kind === "agent" ? <>handed it to <b>{agentName(String(d.to || ""), lemmaName)}</b></> : d.to ? <>gave it to <b>{String(d.to)}</b></> : <>took it off whoever had it</>;
    } else if (a.kind === "field") {
      Icon = Pencil;
      line = <>set {String(d.field || "a field")}{d.to != null ? <> to <b>{String(d.field === "priority" ? PRIORITY_LABEL[d.to as Task["priority"]] || d.to : d.to)}</b></> : null}</>;
    } else if (a.kind === "created") {
      Icon = Plus;
      line = a.body || "made this task";
    } else if (a.kind === "moved") {
      Icon = FolderKanban;
    } else if (a.kind === "started") {
      Icon = Play;
      line = <>started on it, in a conversation of its own{d.by ? <>, for {String(d.by) === "You" || String(d.by) === me?.name ? "you" : String(d.by)}</> : null}</>;
    } else if (a.kind === "stopped") {
      Icon = Square;
    }
    return (
      <li className="tk-tl__item tk-tl__item--event">
        <span className="tk-tl__icon"><Icon size={13} aria-hidden="true" /></span>
        <div className="tk-tl__main"><span className="tk-tl__who">{name}</span> <span className="c-muted">{line}</span></div>
        {when}
      </li>
    );
  }

  const approval = a.kind === "approval";
  const pending = a.state === "pending";
  return (
    <li className={cx("tk-tl__item tk-tl__item--say", isAgent && "is-agent", approval && "is-approval", a.kind === "result" && "is-result", pending && "is-pending")}>
      <span className="tk-tl__face">{face}</span>
      <div className="tk-tl__main">
        <p className="tk-tl__line">
          <span className="tk-tl__who">{name}</span>
          {isAgent ? <Pill tone="ai" dot={false}>agent</Pill> : null}
          <span className="c-muted">
            {a.kind === "question" ? "asks you" : approval ? "wants your approval" : a.kind === "result" ? "finished" : ""}
          </span>
          {a.state === "answered" ? <Pill tone="success">Answered</Pill> : null}
          {a.state === "approved" ? <Pill tone="success">Approved{a.decided_by ? ` by ${a.decided_by}` : ""}</Pill> : null}
          {a.state === "declined" ? <Pill tone="danger">Declined{a.decided_by ? ` by ${a.decided_by}` : ""}</Pill> : null}
          {pending ? <Pill tone="warning">Waiting on you</Pill> : null}
        </p>
        {a.body ? <div className={cx("tk-say", isAgent && "tk-say--agent")}><Markdown text={withoutPaths(a.body, files)} /></div> : null}
        {approval ? (
          <div className="tk-approval">
            {d.action ? <p><span className="c-muted">Would</span> {String(d.action).replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase())}{d.to ? <><span className="c-muted"> to </span>{String(d.to)}</> : null}</p> : null}
            {d.text ? <pre className="tk-pre">{String(d.text)}</pre> : null}
            {pending ? (
              <div className="tk-approval__acts">
                <input className="c-input" placeholder="A note with your answer (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="A note with your answer" />
                <div className="c-row">
                  <Button variant="primary" icon={Check} busy={busy}
                    onClick={() => { setBusy(true); void decide(task, a, true, note, me, run).then((r) => { toast(r.sent ? "Approved. It goes on." : "Approved."); onChange(); }).catch((e) => toast(`Couldn't send it: ${e.message}`)).finally(() => setBusy(false)); }}>
                    Approve
                  </Button>
                  <Button icon={X} busy={busy}
                    onClick={() => { setBusy(true); void decide(task, a, false, note, me, run).then((r) => { toast(r.sent ? "Declined. It will find another way." : "Declined."); onChange(); }).catch((e) => toast(`Couldn't send it: ${e.message}`)).finally(() => setBusy(false)); }}>
                    Decline
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {files.length ? <div className="tk-files">{files.map((f) => <FileLink key={f} path={f} />)}</div> : null}
      </div>
      {when}
    </li>
  );
}

function Composer({ task, run, question, pending, who, onSent }: { task: Task; run: Run | null; question?: Activity; pending: Activity[]; who: string; onSent: () => void }) {
  const { me } = useWorld();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const toAgent = task.assignee_kind === "agent" && !!run?.conversation_id && !["stopped", "failed"].includes(run.state);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await reply(task, text, me, run, pending);
      setText("");
      onSent();
      if (toAgent) toast(r.sent ? `Sent to ${who} too. It picks up from here.` : `Saved on the task. ${who}'s conversation isn't yours, so it didn't go to the agent.`);
    } catch (e) {
      toast(`Couldn't send it: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cx("tk-composer", question && "is-answer")}>
      <textarea ref={box} className="c-textarea tk-composer__input" rows={3} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={question ? `Answer ${who}…` : toAgent ? `Reply to ${who}, or add a note…` : "Add a comment…"}
        aria-label={question ? `Answer ${who}` : "Comment"}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
      <div className="tk-composer__foot">
        <span className="c-faint">{toAgent ? `Goes to ${who} as well as the task.` : "Everyone who can see the task sees it."} <span className="c-hide-sm">⌘↵ to send</span></span>
        <Button variant={question ? "primary" : "default"} icon={Send} busy={busy} onClick={() => void send()}>{question ? "Answer" : toAgent ? "Reply" : "Comment"}</Button>
      </div>
    </div>
  );
}

function Properties({ task }: { task: Task }) {
  const data = useTasks();
  const { me, lemmaName } = useWorld();
  const toast = useToast();
  const [labels, setLabels] = useState((task.labels || []).join(", "));
  useEffect(() => setLabels((task.labels || []).join(", ")), [task.labels]);
  const project = task.project_id ? data.projectById.get(task.project_id) : undefined;
  const fail = (e: Error) => toast(`Couldn't change it: ${e.message}`);
  return (
    <Card title="Properties" flush>
      <dl className="c-props tk-props">
        <dt><CircleDot aria-hidden="true" />Status</dt>
        <dd><span className="c-row"><StatusPicker task={task} size={14} />{STATUS_LABEL[task.status]}</span></dd>
        <dt><Tag aria-hidden="true" />Priority</dt>
        <dd><PriorityPicker task={task}><span className="c-row"><PriorityIcon priority={task.priority} />{PRIORITY_LABEL[task.priority]}</span></PriorityPicker></dd>
        <dt><UserRound aria-hidden="true" />Who has it</dt>
        <dd>
          <AssignPicker task={task}>
            <span className="c-row"><Assignee task={task} lemmaName={lemmaName} meId={me?.id} size={18} />
              {task.assignee_kind === "agent" ? agentName(task.assignee_agent, lemmaName) : task.assignee_kind === "person" ? (task.assignee_user_id === me?.id ? "You" : task.assignee_name) : "Nobody yet"}
            </span>
          </AssignPicker>
        </dd>
        <dt><CalendarDays aria-hidden="true" />Due</dt>
        <dd>
          <input type="date" className="c-input c-input--bare tk-date" value={task.due_on?.slice(0, 10) || ""} aria-label="Due"
            onChange={(e) => void patchTask(task, { due_on: e.target.value || null }, me, "due").catch(fail)} />
        </dd>
        <dt><FolderKanban aria-hidden="true" />Project</dt>
        <dd>
          {task.parent_id ? (project?.name || (task.scope === "personal" ? "Private" : "None")) : (
            <select className="c-input c-input--bare tk-select" aria-label="Project" value={task.scope === "personal" ? "" : task.project_id || "team"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  if (!window.confirm("Make it private? Only you will see it, with its timeline.")) return;
                  void moveTask(task, "personal").then((r) => toast(r.message)).catch(fail);
                } else if (task.scope === "personal") {
                  void moveTask(task, "team", v === "team" ? null : v).then((r) => toast(r.message)).catch(fail);
                } else {
                  void patchTask(task, { project_id: v === "team" ? null : v }, me, "project").catch(fail);
                }
              }}>
              <option value="">Private (only you)</option>
              <option value="team">Team, no project</option>
              {data.projects.filter((p) => p.state !== "canceled").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </dd>
        <dt><Tag aria-hidden="true" />Labels</dt>
        <dd>
          <input className="c-input c-input--bare" value={labels} placeholder="Add labels" aria-label="Labels" onChange={(e) => setLabels(e.target.value)}
            onBlur={() => {
              const next = labels.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 10);
              if (next.join(",") !== (task.labels || []).join(",")) void patchTask(task, { labels: next } as Partial<Task>, me).catch(fail);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </dd>
        <dt><Eye aria-hidden="true" />Who sees it</dt>
        <dd>{task.scope === "personal" ? "Only you" : "Everyone in this Lemma"}</dd>
        <dt><Undo2 aria-hidden="true" />Made</dt>
        <dd className="c-muted">{task.created_at ? ago(task.created_at) : ""}{task.owner_name ? ` by ${task.owner_user_id === me?.id ? "you" : task.owner_name}` : ""}{task.source !== "tasks" ? ` · from ${task.source}` : ""}</dd>
      </dl>
    </Card>
  );
}

function TaskMenu({ task, mine }: { task: Task; mine: boolean }) {
  const toast = useToast();
  const data = useTasks();
  return (
    <Menu icon={MoreHorizontal} title="More" align="right" variant="ghost">
      {(close) => (
        <>
          {task.scope === "personal" && !task.parent_id ? (
            <>
              <MenuLabel>Share</MenuLabel>
              <MenuItem icon={Users} onSelect={() => { close(); void moveTask(task, "team").then((r) => toast(r.message)).catch((e) => toast(`Couldn't share it: ${e.message}`)); }}>Share with the team</MenuItem>
              {data.projects.filter((p) => p.state === "active").map((p) => (
                <MenuItem key={p.id} icon={FolderKanban} onSelect={() => { close(); void moveTask(task, "team", p.id).then((r) => toast(r.message)).catch((e) => toast(`Couldn't move it: ${e.message}`)); }}>Move to {p.name}</MenuItem>
              ))}
            </>
          ) : null}
          {task.scope === "team" && mine && !task.parent_id ? (
            <MenuItem icon={Lock} onSelect={() => { close(); if (window.confirm("Make it private? Only you will see it.")) void moveTask(task, "personal").then((r) => toast(r.message)).catch((e) => toast(`Couldn't: ${e.message}`)); }}>Make it private</MenuItem>
          ) : null}
          {task.source === "promise" ? (
            <MenuItem icon={Handshake} onSelect={() => {
              close();
              void deleteTasks([task.id], true).then(() => { toast("Removed. Tasks learns that promises like it are just replies."); backToList(); });
            }}>Not a task, just a reply</MenuItem>
          ) : null}
          <MenuItem icon={Trash2} onSelect={() => {
            close();
            if (!window.confirm("Delete this task, with its sub-tasks and timeline? This can't be undone.")) return;
            void deleteTasks([task.id]).then((r) => { toast(r.message); backToList(); }).catch((e) => toast(`Couldn't delete: ${e.message}`));
          }}>Delete</MenuItem>
        </>
      )}
    </Menu>
  );
}
