// The app once set up, in the same frame as the other plugins' apps: places on
// the left (your tasks, with agents, from promises, the team's projects,
// settings), the page on the right. Below 860px one pane, the left a drawer.
//
// Keys anywhere (not while typing): c new task, ⌘K or Ctrl+K the command
// palette, ? the keys. The list's own keys are in List.tsx.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bot, FolderKanban, Handshake, Inbox, ListChecks, Menu as MenuIcon, Plus, Settings as Cog, X, type LucideIcon,
} from "lucide-react";
import { Banner, Button, Kbd, Sheet, cx, useToast } from "@lemma-plugins/kit";
import { createTask, ensureDaily, refreshNeedsYou, todayKey, useTasks, useWorld, type NewTask } from "./data";
import { ListPage } from "./List";
import { NewTaskSheet } from "./NewTask";
import { Palette } from "./Palette";
import { PromisesPage } from "./Promises";
import { listPath, rememberList, to, useRoute, type Route } from "./route";
import { SettingsPage } from "./Settings";
import { TaskPage } from "./TaskPage";
import { ProjectSheet } from "./Projects";
import type { Task } from "./types";

interface Ui {
  newTask: (preset?: Partial<NewTask>) => void;
  openPalette: () => void;
  newProject: () => void;
  selection: Set<string>;
  setSelection: (s: Set<string>) => void;
  cursor: string | null;
  setCursor: (id: string | null) => void;
}

const UiContext = createContext<Ui | null>(null);
export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi needs the Shell around it.");
  return ui;
}

export function typing(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof Element && !!t.closest("input, textarea, select, [contenteditable='true'], [role='dialog'] input");
}

function useCounts() {
  const { tasks, promises, settings } = useTasks();
  const { me } = useWorld();
  return useMemo(() => {
    const open = (t: Task) => !t.parent_id && !["done", "canceled"].includes(t.status);
    const mine = tasks.filter((t) => open(t) && (t.scope === "personal" || t.assignee_user_id === me?.id));
    return {
      mine: mine.length,
      waiting: tasks.filter((t) => open(t) && t.status === "waiting" && (t.scope === "personal" || t.assignee_user_id === me?.id || t.owner_user_id === me?.id)).length,
      agents: tasks.filter((t) => open(t) && t.assignee_kind === "agent").length,
      promises: promises.filter((p) => p.state === "open" && p.d_state === "open").length,
      today: mine.filter((t) => t.due_on && t.due_on.slice(0, 10) <= todayKey(settings?.timezone)).length,
    };
  }, [tasks, promises, me, settings]);
}

function Nav({ route, onPick }: { route: Route; onPick: () => void }) {
  const { projects, tasks, settings } = useTasks();
  const ui = useUi();
  const counts = useCounts();
  const hasPromises = !!settings?.capabilities?.has_promises || settings?.promises !== "never";
  const here = route.page === "task" ? "" : route.page === "project" ? `p:${route.projectId}` : route.page;
  const board = "board" in route && route.board;
  const items: { id: string; label: string; icon: LucideIcon; n?: number; hot?: boolean; go: () => void; show?: boolean }[] = [
    { id: "mine", label: "My tasks", icon: Inbox, n: counts.mine, go: () => to.list("mine", board) },
    { id: "agents", label: "With agents", icon: Bot, n: counts.agents, go: () => to.list("agents", board) },
    { id: "promises", label: "From promises", icon: Handshake, n: counts.promises, hot: true, go: () => to.promises(), show: hasPromises },
  ];
  const active = projects.filter((p) => p.state === "active" || p.state === "paused");
  return (
    <nav className="tk-nav" aria-label="Tasks">
      <div className="tk-nav__brand">
        <span className="c-header__icon" aria-hidden="true"><ListChecks size={15} /></span>
        <span className="c-grow">Tasks</span>
        <Button size="sm" variant="ghost" icon={Plus} label="New task (C)" onClick={() => { ui.newTask(); onPick(); }} />
      </div>
      <div className="c-nav">
        {items.filter((n) => n.show !== false).map((n) => (
          <button key={n.id} type="button" className="c-nav__item" aria-current={here === n.id ? "page" : undefined}
            onClick={() => { n.go(); onPick(); }}>
            <n.icon aria-hidden="true" />
            {n.label}
            <span className={cx("c-nav__n", n.hot && n.n ? "c-nav__n--hot" : false)}>{n.n || ""}</span>
          </button>
        ))}
        {settings?.scope === "team" || projects.length ? (
          <>
            <p className="c-nav__label tk-nav__label">
              <span className="c-grow">Team projects</span>
              <button type="button" className="tk-nav__add" aria-label="New project" title="New project" onClick={() => { ui.newProject(); onPick(); }}>
                <Plus size={13} aria-hidden="true" />
              </button>
            </p>
            {active.map((p) => {
              const n = tasks.filter((t) => t.project_id === p.id && !t.parent_id && !["done", "canceled"].includes(t.status)).length;
              return (
                <button key={p.id} type="button" className="c-nav__item" aria-current={here === `p:${p.id}` ? "page" : undefined}
                  onClick={() => { to.list("project", board, p.id); onPick(); }}>
                  <FolderKanban aria-hidden="true" />
                  <span className="c-ellipsis">{p.name}</span>
                  <span className="c-nav__n">{n || ""}</span>
                </button>
              );
            })}
            {!active.length ? <p className="tk-nav__hint">No team project yet.</p> : null}
          </>
        ) : null}
        <p className="c-nav__label">Yours</p>
        <button type="button" className="c-nav__item" aria-current={here === "settings" ? "page" : undefined} onClick={() => { to.settings(); onPick(); }}>
          <Cog aria-hidden="true" />
          Settings
        </button>
      </div>
      <div className="tk-nav__foot">
        <span><Kbd>C</Kbd> new</span>
        <span><Kbd>⌘K</Kbd> commands</span>
        <span><Kbd>?</Kbd> keys</span>
      </div>
    </nav>
  );
}

export function Shell() {
  const route = useRoute();
  const { settings, sample } = useTasks();
  const { me } = useWorld();
  const toast = useToast();
  const [navOpen, setNavOpen] = useState(false);
  const [creating, setCreating] = useState<Partial<NewTask> | null>(null);
  const [palette, setPalette] = useState(false);
  const [keys, setKeys] = useState(false);
  const [projectSheet, setProjectSheet] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    if (route.page !== "task" && route.page !== "settings" && route.page !== "promises") {
      rememberList(listPath(route.page, route.board, route.page === "project" ? route.projectId : undefined));
    }
    if (route.page !== "task") setSelection(new Set());
  }, [route.page, "board" in route ? route.board : false, route.page === "project" ? route.projectId : ""]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once per open: what in Tasks needs the person, and their daily refresh.
  useEffect(() => {
    if (!settings || !me) return;
    refreshNeedsYou();
    void ensureDaily(settings, me);
  }, [settings?.id, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const newTask = useCallback((preset?: Partial<NewTask>) => {
    let base: Partial<NewTask> = { ...(preset || {}) };
    if (!preset && route.page === "project") base = { project_id: route.projectId };
    setCreating(base);
  }, [route]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (creating || palette) return;
      if (e.key === "c") {
        e.preventDefault();
        newTask();
      } else if (e.key === "?") {
        e.preventDefault();
        setKeys(true);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [creating, palette, newTask]);

  const ui: Ui = {
    newTask,
    openPalette: () => setPalette(true),
    newProject: () => setProjectSheet(true),
    selection, setSelection, cursor, setCursor,
  };

  let page: ReactNode;
  if (route.page === "task") page = <TaskPage id={route.id} />;
  else if (route.page === "settings") page = <SettingsPage />;
  else if (route.page === "promises") page = <PromisesPage />;
  else page = <ListPage route={route} />;

  return (
    <UiContext.Provider value={ui}>
      <div className={cx("tk-shell", navOpen && "is-nav-open")}>
        <aside className="tk-side"><Nav route={route} onPick={() => setNavOpen(false)} /></aside>
        {navOpen ? <button type="button" className="tk-scrim" aria-label="Close the menu" onClick={() => setNavOpen(false)} /> : null}
        <div className="tk-main">
          <div className="tk-mobilebar">
            <Button variant="ghost" icon={navOpen ? X : MenuIcon} label="Places" onClick={() => setNavOpen((v) => !v)} />
            <span className="tk-mobilebar__title">Tasks</span>
            <span className="c-grow" />
            <Button size="sm" variant="primary" icon={Plus} onClick={() => newTask()}>New</Button>
          </div>
          {sample && route.page !== "task" && settings?.setup_step === "done" ? (
            <div className="tk-strip">
              <Banner>
                You're looking at <b>a sample list</b>: made-up tasks and a made-up team project. Clear it in Settings when you're done.
              </Banner>
            </div>
          ) : null}
          <div className="tk-page">{page}</div>
        </div>
      </div>
      {creating ? (
        <NewTaskSheet
          preset={creating}
          onClose={() => setCreating(null)}
          onCreate={async (input, open) => {
            const made = await createTask(input, me);
            toast(made.scope === "personal" ? "Added to your list. Only you can see it." : "Added to the project.", {
              action: { label: "Open", run: () => to.task(made.id) },
            });
            if (open) to.task(made.id);
            setCreating(open ? null : { ...creating, title: "" });
            return made;
          }}
        />
      ) : null}
      {palette ? <Palette onClose={() => setPalette(false)} /> : null}
      {projectSheet ? <ProjectSheet onClose={() => setProjectSheet(false)} /> : null}
      <Sheet open={keys} title="Keys" onClose={() => setKeys(false)}>
        <dl className="c-props tk-keys">
          {[
            ["C", "New task"], ["⌘K", "Commands, go to, find a task"], ["/", "Search"], ["J / K", "Next / previous task"],
            ["X", "Select the task"], ["Enter", "Open it"], ["1 2 3 4", "To do, In progress, Waiting on you, Done"],
            ["B", "List or board"], ["Esc", "Back, or clear the selection"],
          ].map(([k, v]) => (
            <div key={k} className="tk-keys__row"><dt><Kbd>{k}</Kbd></dt><dd>{v}</dd></div>
          ))}
        </dl>
      </Sheet>
    </UiContext.Provider>
  );
}
