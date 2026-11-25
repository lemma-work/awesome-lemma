// A list of tasks, as a list grouped by status or as a board that drags.
//
//   My tasks      your own list and team tasks on you
//   With agents   every task an agent has, yours and the team's
//   A project     the project's tasks, anyone's
//
// Keys (not while typing): J/K or the arrows move, X selects, Enter opens,
// 1–4 set the status of the selected tasks (or the one under the cursor),
// B switches list and board, Esc clears the selection.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, ChevronDown, ChevronRight, CircleCheck, FolderKanban, Inbox, LayoutList, Lock, Plus, Sparkles, SquareKanban, Trash2, UserRound, X,
} from "lucide-react";
import { Button, Empty, Kbd, Menu, MenuItem, MenuLabel, Pill, SearchField, Segmented, Skeleton, cx, plural, useToast } from "@lemma-plugins/kit";
import { deleteTasks, handOver, assignPerson, patchTask, setStatus, useTasks, useWorld, type TasksData } from "./data";
import { Assignee, Due, Labels, PriorityIcon, RunPill, StatusIcon } from "./marks";
import { AssignPicker, PriorityPicker, StatusPicker } from "./pickers";
import { to, type ListPage as Page, type Route } from "./route";
import { typing, useUi } from "./Shell";
import { SUGGEST_FROM, ASSISTANT, BOARD, PRIORITIES, PRIORITY_LABEL, PRIORITY_RANK, STATUSES, STATUS_LABEL, type Status, type Task } from "./types";

type ListRoute = Extract<Route, { board: boolean }>;

export function pick(data: TasksData, page: Page, meId: string | undefined, projectId?: string): Task[] {
  return data.tasks.filter((t) => {
    if (t.parent_id) return false;
    if (page === "mine") return t.scope === "personal" || (!!meId && t.assignee_user_id === meId);
    if (page === "agents") return t.assignee_kind === "agent";
    if (page === "project") return t.project_id === projectId;
    return false;
  });
}

function order(a: Task, b: Task): number {
  const due = (t: Task) => (t.due_on ? t.due_on.slice(0, 10) : "9999");
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || due(a).localeCompare(due(b)) || String(b.created_at).localeCompare(String(a.created_at));
}

function matches(t: Task, query: string, projectName?: string): boolean {
  if (!query) return true;
  const hay = [t.title, t.description, ...(t.labels || []), projectName, t.assignee_name, t.number ? `#${t.number}` : ""].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

export function ListPage({ route }: { route: ListRoute }) {
  const data = useTasks();
  const { me, lemmaName } = useWorld();
  const ui = useUi();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  const project = route.page === "project" ? data.projectById.get(route.projectId || "") : undefined;

  const all = useMemo(() => pick(data, route.page, me?.id, route.projectId), [data, route.page, route.projectId, me?.id]);
  const shown = useMemo(
    () => all.filter((t) => matches(t, query, data.projectById.get(t.project_id || "")?.name)).sort(order),
    [all, query, data.projectById],
  );
  const groups = STATUSES.map((s) => ({
    status: s,
    tasks: shown.filter((t) => t.status === s || (s === "done" && t.status === "canceled")),
  }));
  const flat = route.board
    ? BOARD.flatMap((s) => shown.filter((t) => t.status === s))
    : groups.flatMap((g) => (g.status === "done" && !showDone ? [] : g.tasks));

  // Keys.
  const flatRef = useRef(flat);
  flatRef.current = flat;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".c-sheet, .tk-palette")) return;
      const list = flatRef.current;
      const at = list.findIndex((t) => t.id === ui.cursor);
      const move = (d: number) => {
        e.preventDefault();
        const next = list[Math.max(0, Math.min(list.length - 1, at < 0 ? 0 : at + d))];
        if (next) {
          ui.setCursor(next.id);
          document.querySelector(`[data-task="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
        }
      };
      if (e.key === "j" || e.key === "ArrowDown") move(1);
      else if (e.key === "k" || e.key === "ArrowUp") move(-1);
      else if ((e.key === "Enter" || e.key === "o") && at >= 0) {
        e.preventDefault();
        to.task(list[at].id);
      } else if (e.key === "x" && at >= 0) {
        e.preventDefault();
        const s = new Set(ui.selection);
        if (s.has(list[at].id)) s.delete(list[at].id);
        else s.add(list[at].id);
        ui.setSelection(s);
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        const ids = ui.selection.size ? [...ui.selection] : at >= 0 ? [list[at].id] : [];
        if (!ids.length) return;
        e.preventDefault();
        const status = BOARD[Number(e.key) - 1];
        void Promise.all(ids.map((id) => data.byId.get(id)).filter(Boolean).map((t) => setStatus(t as Task, status, me)))
          .then(() => toast(`${plural(ids.length, "task")} to ${STATUS_LABEL[status]}`))
          .catch((err) => toast(`Couldn't move them: ${err.message}`));
      } else if (e.key === "b") {
        e.preventDefault();
        to.list(route.page, !route.board, route.projectId);
      } else if (e.key === "Escape" && ui.selection.size) {
        e.preventDefault();
        ui.setSelection(new Set());
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [ui, data.byId, me, route, toast]);

  const title = route.page === "mine" ? "My tasks" : route.page === "agents" ? "With agents" : project?.name || "Project";
  const Icon = route.page === "mine" ? Inbox : route.page === "agents" ? Bot : FolderKanban;
  const open = all.filter((t) => !["done", "canceled"].includes(t.status)).length;

  return (
    <>
      <header className="tk-head">
        <span className="c-header__icon" aria-hidden="true"><Icon size={15} /></span>
        <h1 className="c-ellipsis">{title}</h1>
        <span className="c-header__count">{open}</span>
        {route.page === "mine" ? <span className="tk-head__note c-hide-sm"><Lock size={12} aria-hidden="true" /> Your own tasks are only yours</span> : null}
        <span className="c-grow" />
        <Segmented
          label="View"
          value={route.board ? "board" : "list"}
          onChange={(v) => to.list(route.page, v === "board", route.projectId)}
          items={[{ id: "list", label: "List" }, { id: "board", label: "Board" }]}
        />
        <span className="tk-wide"><Button variant="primary" icon={Plus} onClick={() => ui.newTask()}>New task</Button></span>
      </header>
      <div className="tk-toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Search tasks" />
        {project ? <ProjectFacts projectId={project.id} /> : null}
        <span className="c-grow" />
        <span className="tk-hint c-hide-sm"><Kbd>J</Kbd><Kbd>K</Kbd> move <Kbd>X</Kbd> select <Kbd>1</Kbd>–<Kbd>4</Kbd> status</span>
      </div>
      {ui.selection.size ? <BulkBar /> : null}
      {!data.loaded ? (
        <div className="tk-pad"><Skeleton kind="list" rows={8} /></div>
      ) : !all.length ? (
        <EmptyPage page={route.page} />
      ) : route.board ? (
        <Board tasks={shown} lemmaName={lemmaName} showProject={route.page !== "project"} />
      ) : (
        <div className="tk-list" role="list" aria-label={title}>
          {groups.map((g) => {
            const isDone = g.status === "done";
            if (!g.tasks.length && (isDone || route.page !== "project")) return null;
            const folded = isDone && !showDone;
            return (
              <section key={g.status} className="tk-group" aria-label={STATUS_LABEL[g.status]}>
                <h2 className="tk-group__head">
                  {isDone ? (
                    <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={!folded}>
                      {folded ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                      <StatusIcon status="done" size={14} /> {STATUS_LABEL.done}
                    </button>
                  ) : (
                    <span><StatusIcon status={g.status} size={14} /> {STATUS_LABEL[g.status]}</span>
                  )}
                  <span className="c-count">{g.tasks.length}</span>
                  <span className="c-grow" />
                  {!isDone ? (
                    <button type="button" className="tk-group__add" aria-label={`New task in ${STATUS_LABEL[g.status]}`} title="New task here"
                      onClick={() => ui.newTask({ status: g.status, project_id: route.page === "project" ? route.projectId : undefined })}>
                      <Plus size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </h2>
                {folded ? null : g.tasks.map((t) => <Row key={t.id} task={t} showProject={route.page !== "project"} />)}
              </section>
            );
          })}
          {!shown.length ? <Empty icon={CircleCheck} title="No task matches">Try other words, or clear the search.</Empty> : null}
        </div>
      )}
    </>
  );
}

function ProjectFacts({ projectId }: { projectId: string }) {
  const { tasks, projectById } = useTasks();
  const p = projectById.get(projectId);
  const mine = tasks.filter((t) => t.project_id === projectId && !t.parent_id);
  const done = mine.filter((t) => t.status === "done").length;
  if (!p) return null;
  return (
    <span className="tk-projfacts">
      <span className="tk-meter" aria-hidden="true"><span style={{ width: `${mine.length ? Math.round((done / mine.length) * 100) : 0}%` }} /></span>
      <span className="c-muted num">{done} of {mine.length} done</span>
      {p.lead_name ? <span className="c-faint">· Lead {p.lead_name}</span> : null}
      {p.target_on ? <span className="c-faint">· Target <Due on={p.target_on} /></span> : null}
    </span>
  );
}

function EmptyPage({ page }: { page: Page }) {
  const ui = useUi();
  if (page === "agents") {
    return (
      <Empty icon={Bot} title="No task is with an agent">
        Hand a task over from its page, or pick an agent where it says who has it. Tasks suggests the ones an agent could do.
      </Empty>
    );
  }
  return (
    <Empty icon={Inbox} title={page === "project" ? "This project has no tasks yet" : "Nothing on your list"}
      action={<Button variant="primary" icon={Plus} onClick={() => ui.newTask()}>New task</Button>}>
      {page === "project" ? "Everyone in this Lemma sees a project's tasks." : "Type one, ask the Lemma in chat to add one, or load the sample in Settings. Only you see your own tasks."}
    </Empty>
  );
}

export function Row({ task, showProject = true, depth = 0 }: { task: Task; showProject?: boolean; depth?: number }) {
  const data = useTasks();
  const { me, lemmaName } = useWorld();
  const ui = useUi();
  const run = data.runById.get(task.id);
  const decision = data.decisionById.get(task.id);
  const project = task.project_id ? data.projectById.get(task.project_id) : undefined;
  const subs = data.children.get(task.id) || [];
  const selected = ui.selection.has(task.id);
  const active = ui.cursor === task.id;
  const suggest = decision?.state === "open" && decision.answer === "yes" && (decision.confidence ?? 1) >= SUGGEST_FROM && task.assignee_kind !== "agent" && !["done", "canceled"].includes(task.status);
  return (
    <div
      role="listitem"
      data-task={task.id}
      className={cx("tk-row", active && "is-cursor", selected && "is-selected", ["done", "canceled"].includes(task.status) && "is-done")}
      style={depth ? { paddingLeft: 16 + depth * 22 } : undefined}
      onClick={() => to.task(task.id)}
      onMouseMove={() => ui.cursor !== task.id && ui.setCursor(task.id)}
    >
      <input type="checkbox" className="c-check tk-row__check" checked={selected} aria-label={`Select ${task.title}`}
        onClick={(e) => e.stopPropagation()}
        onChange={() => {
          const s = new Set(ui.selection);
          if (s.has(task.id)) s.delete(task.id);
          else s.add(task.id);
          ui.setSelection(s);
        }} />
      <span className="tk-row__prio c-hide-sm"><PriorityPicker task={task} /></span>
      <StatusPicker task={task} />
      {task.scope === "team" && task.number ? <span className="tk-num c-hide-sm">#{task.number}</span> : null}
      <span className="tk-row__title">
        <a href={`#${task.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); to.task(task.id); }}>{task.title}</a>
        {subs.length ? <span className="tk-subs num">{subs.filter((s) => s.status === "done").length}/{subs.length}</span> : null}
        {task.source === "promise" ? <span className="tk-src" title="Made from a promise you made">promise</span> : null}
      </span>
      {suggest ? (
        <span className="tk-suggest c-hide-sm" title={decision?.reason || "An agent could do this"}>
          <Sparkles size={12} aria-hidden="true" /> An agent could do this
        </span>
      ) : null}
      {task.assignee_kind === "agent" && run && ["starting", "working", "waiting", "failed"].includes(run.state) ? <span className="c-hide-sm"><RunPill run={run} /></span> : null}
      <span className="tk-row__meta">
        <span className="c-hide-sm"><Labels labels={task.labels} /></span>
        {showProject && project ? <span className="tk-chip c-hide-sm"><FolderKanban size={11} aria-hidden="true" />{project.name}</span> : null}
        {showProject && task.scope === "personal" && task.assignee_kind === "agent" ? <Lock size={12} className="c-faint" aria-label="Private" /> : null}
        <Due on={task.due_on} zone={data.settings?.timezone} done={task.status === "done"} />
        <AssignPicker task={task}><Assignee task={task} lemmaName={lemmaName} meId={me?.id} /></AssignPicker>
      </span>
    </div>
  );
}

function BulkBar() {
  const ui = useUi();
  const data = useTasks();
  const { me, lemmaName } = useWorld();
  const toast = useToast();
  const tasks = [...ui.selection].map((id) => data.byId.get(id)).filter(Boolean) as Task[];
  const all = (fn: (t: Task) => Promise<unknown>, done: string) =>
    void Promise.all(tasks.map(fn)).then(() => toast(done)).catch((e) => toast(`Couldn't do it: ${e.message}`));
  return (
    <div className="tk-bulk" role="toolbar" aria-label="Selected tasks">
      <span className="num">{plural(tasks.length, "task")} selected</span>
      <Menu label="Status" icon={CircleCheck}>
        {(close) => (
          <>
            {BOARD.map((s, i) => (
              <MenuItem key={s} hint={String(i + 1)} onSelect={() => { close(); all((t) => setStatus(t, s, me), `Moved to ${STATUS_LABEL[s]}`); }}>
                {STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
      <Menu label="Priority">
        {(close) => (
          <>
            {PRIORITIES.map((p) => (
              <MenuItem key={p} onSelect={() => { close(); all((t) => patchTask(t, { priority: p }, me, "priority"), `Priority: ${PRIORITY_LABEL[p]}`); }}>
                <span className="c-row"><PriorityIcon priority={p} /> {PRIORITY_LABEL[p]}</span>
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
      <Menu label="Assign" icon={UserRound}>
        {(close) => (
          <>
            <MenuLabel>Who has them</MenuLabel>
            <MenuItem icon={UserRound} onSelect={() => { close(); all((t) => assignPerson(t, me ? { user_id: me.id, name: me.name, email: me.email || "" } : null, me, data.runById.get(t.id)), "Yours now"); }}>You</MenuItem>
            <MenuItem icon={Sparkles} onSelect={() => { close(); all((t) => handOver(t, ASSISTANT, me, data.decisionById.get(t.id)), `Handed to ${lemmaName}`); }}>{lemmaName}</MenuItem>
          </>
        )}
      </Menu>
      <Button size="sm" variant="ghost" icon={Trash2} className="c-btn--danger"
        onClick={() => {
          if (!window.confirm(`Delete ${plural(tasks.length, "task")}, with their sub-tasks and timelines? This can't be undone.`)) return;
          void deleteTasks(tasks.map((t) => t.id)).then((r) => { toast(r.message); ui.setSelection(new Set()); }).catch((e) => toast(`Couldn't delete: ${e.message}`));
        }}>
        Delete
      </Button>
      <span className="c-grow" />
      <Button size="sm" variant="ghost" icon={X} label="Clear the selection (Esc)" onClick={() => ui.setSelection(new Set())} />
    </div>
  );
}

/* ---------- the board ---------- */

function Board({ tasks, lemmaName, showProject }: { tasks: Task[]; lemmaName: string; showProject: boolean }) {
  const data = useTasks();
  const { me } = useWorld();
  const ui = useUi();
  const toast = useToast();
  const [over, setOver] = useState<Status | null>(null);
  // Drag with the pointer (mouse or pen): press a card, move it over another
  // column, let go. A touch scrolls the board instead; the card's status
  // circle moves it there.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; title: string } | null>(null);
  const pending = useRef<{ id: string; x: number; y: number; title: string; active: boolean } | null>(null);
  const dragged = useRef(false);
  const columnAt = (x: number, y: number): Status | null => {
    const el = document.elementFromPoint(x, y)?.closest("[data-col]") as HTMLElement | null;
    return (el?.dataset.col as Status) || null;
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p) return;
      if (!p.active && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
      p.active = true;
      setDrag({ id: p.id, x: e.clientX, y: e.clientY, title: p.title });
      setOver(columnAt(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      const p = pending.current;
      pending.current = null;
      if (!p?.active) return;
      dragged.current = true;
      window.setTimeout(() => { dragged.current = false; }, 0);
      setDrag(null);
      setOver(null);
      const status = columnAt(e.clientX, e.clientY);
      const task = data.byId.get(p.id);
      if (task && status && task.status !== status) {
        void setStatus(task, status, me).then(() => toast(`Moved to ${STATUS_LABEL[status]}`)).catch((err) => toast(`Couldn't move it: ${err.message}`));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [data.byId, me, toast]);
  return (
    <div className="tk-board" aria-label="Board">
      {BOARD.map((status) => {
        const col = tasks.filter((t) => t.status === status);
        return (
          <section key={status} data-col={status} className={cx("tk-col", over === status && "is-over")} aria-label={STATUS_LABEL[status]}>
            <h2 className="tk-col__head">
              <StatusIcon status={status} size={14} />
              {STATUS_LABEL[status]}
              <span className="c-count">{col.length}</span>
              <span className="c-grow" />
              {status !== "done" ? (
                <button type="button" className="tk-group__add" aria-label={`New task in ${STATUS_LABEL[status]}`}
                  onClick={() => ui.newTask({ status })}><Plus size={13} aria-hidden="true" /></button>
              ) : null}
            </h2>
            <div className="tk-col__cards">
              {col.map((t) => {
                const run = data.runById.get(t.id);
                const decision = data.decisionById.get(t.id);
                const project = t.project_id ? data.projectById.get(t.project_id) : undefined;
                const suggest = decision?.state === "open" && decision.answer === "yes" && (decision.confidence ?? 1) >= SUGGEST_FROM && t.assignee_kind !== "agent" && t.status !== "done";
                return (
                  <article key={t.id} data-task={t.id}
                    className={cx("tk-card", ui.cursor === t.id && "is-cursor", ui.selection.has(t.id) && "is-selected", drag?.id === t.id && "is-dragging")}
                    onPointerDown={(e) => {
                      if (e.pointerType === "touch" || e.button !== 0 || (e.target as Element).closest("button, input, a")) return;
                      pending.current = { id: t.id, x: e.clientX, y: e.clientY, title: t.title, active: false };
                    }}
                    onClick={() => { if (!dragged.current) to.task(t.id); }}>
                    <div className="tk-card__top">
                      <StatusPicker task={t} size={14} />
                      {t.scope === "team" && t.number ? <span className="tk-num">#{t.number}</span> : null}
                      <span className="c-grow" />
                      <AssignPicker task={t}><Assignee task={t} lemmaName={lemmaName} meId={me?.id} size={20} /></AssignPicker>
                    </div>
                    <p className="tk-card__title">{t.title}</p>
                    <div className="tk-card__meta">
                      <PriorityPicker task={t} />
                      <Due on={t.due_on} zone={data.settings?.timezone} done={t.status === "done"} />
                      {project && showProject ? <span className="tk-chip"><FolderKanban size={11} aria-hidden="true" />{project.name}</span> : null}
                      <Labels labels={t.labels} />
                      {t.assignee_kind === "agent" && run && ["working", "starting", "waiting"].includes(run.state) ? <RunPill run={run} /> : null}
                      {suggest ? <Pill tone="ai" icon={Sparkles}>Agent could</Pill> : null}
                    </div>
                  </article>
                );
              })}
              {!col.length ? <p className="tk-col__empty">Drag a task here</p> : null}
            </div>
          </section>
        );
      })}
      {drag ? <div className="tk-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }} aria-hidden="true">{drag.title}</div> : null}
    </div>
  );
}

export { LayoutList, SquareKanban };
