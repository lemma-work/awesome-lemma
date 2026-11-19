// The command palette (⌘K): go anywhere, find any task by its words or number,
// and act on the selected tasks (or the open one). Arrows move, Enter runs,
// Esc closes.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, CircleCheck, FolderKanban, Handshake, Inbox, LayoutList, Plus, Search, Settings as Cog, Sparkles, SquareKanban, UserRound } from "lucide-react";
import { Kbd, cx, useToast } from "@lemma-plugins/kit";
import { handOver, assignPerson, setStatus, useTasks, useWorld } from "./data";
import { StatusIcon } from "./marks";
import { to, useRoute } from "./route";
import { useUi } from "./Shell";
import { ASSISTANT, BOARD, STATUS_LABEL, type Task } from "./types";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: ReactNode;
  icon: ReactNode;
  run: () => void | Promise<unknown>;
}

export function Palette({ onClose }: { onClose: () => void }) {
  const data = useTasks();
  const { me, lemmaName } = useWorld();
  const ui = useUi();
  const route = useRoute();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const targets: Task[] = useMemo(() => {
    if (ui.selection.size) return [...ui.selection].map((id) => data.byId.get(id)).filter(Boolean) as Task[];
    if (route.page === "task") return [data.byId.get(route.id)].filter(Boolean) as Task[];
    const cur = ui.cursor ? data.byId.get(ui.cursor) : undefined;
    return cur ? [cur] : [];
  }, [ui.selection, ui.cursor, route, data.byId]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    const on = targets.length === 1 ? `“${targets[0].title.slice(0, 40)}”` : `${targets.length} tasks`;
    if (targets.length) {
      for (const [i, s] of BOARD.entries()) {
        list.push({ id: `status:${s}`, group: `For ${on}`, label: `Move to ${STATUS_LABEL[s]}`, hint: <Kbd>{String(i + 1)}</Kbd>, icon: <StatusIcon status={s} size={14} />,
          run: () => Promise.all(targets.map((t) => setStatus(t, s, me))).then(() => toast(`Moved to ${STATUS_LABEL[s]}`)) });
      }
      list.push({ id: "hand", group: `For ${on}`, label: `Hand to ${lemmaName}`, icon: <Sparkles size={14} />,
        run: () => Promise.all(targets.map((t) => handOver(t, ASSISTANT, me, data.decisionById.get(t.id)))).then(() => toast(`Handed to ${lemmaName}`)) });
      list.push({ id: "mine", group: `For ${on}`, label: "Assign to me", icon: <UserRound size={14} />,
        run: () => Promise.all(targets.map((t) => assignPerson(t, me ? { user_id: me.id, name: me.name, email: me.email || "" } : null, me, data.runById.get(t.id)))).then(() => toast("Yours now")) });
    }
    list.push({ id: "new", group: "Do", label: "New task", hint: <Kbd>C</Kbd>, icon: <Plus size={14} />, run: () => ui.newTask() });
    list.push({ id: "newproject", group: "Do", label: "New team project", icon: <FolderKanban size={14} />, run: () => ui.newProject() });
    if ("board" in route) {
      list.push({ id: "view", group: "Do", label: route.board ? "Show as a list" : "Show as a board", hint: <Kbd>B</Kbd>,
        icon: route.board ? <LayoutList size={14} /> : <SquareKanban size={14} />, run: () => to.list(route.page, !route.board, route.projectId) });
    }
    list.push({ id: "go:mine", group: "Go to", label: "My tasks", icon: <Inbox size={14} />, run: () => to.list("mine") });
    list.push({ id: "go:agents", group: "Go to", label: "With agents", icon: <Bot size={14} />, run: () => to.list("agents") });
    if (data.settings?.capabilities?.has_promises || (data.settings?.promises && data.settings.promises !== "never")) {
      list.push({ id: "go:promises", group: "Go to", label: "From promises", icon: <Handshake size={14} />, run: () => to.promises() });
    }
    for (const p of data.projects.filter((p) => p.state === "active")) {
      list.push({ id: `go:p:${p.id}`, group: "Go to", label: p.name, icon: <FolderKanban size={14} />, run: () => to.list("project", false, p.id) });
    }
    list.push({ id: "go:settings", group: "Go to", label: "Settings", icon: <Cog size={14} />, run: () => to.settings() });
    const q = query.trim().toLowerCase();
    if (q) {
      const found = data.tasks
        .filter((t) => `${t.title} ${t.description || ""} ${(t.labels || []).join(" ")} ${t.number ? `#${t.number}` : ""}`.toLowerCase().includes(q))
        .sort((a, b) => Number(["done", "canceled"].includes(a.status)) - Number(["done", "canceled"].includes(b.status)))
        .slice(0, 8);
      for (const t of found) {
        list.push({ id: `task:${t.id}`, group: "Tasks", label: t.title, hint: t.scope === "team" && t.number ? <span className="c-faint">#{t.number}</span> : undefined,
          icon: <StatusIcon status={t.status} size={14} />, run: () => to.task(t.id) });
      }
    }
    return q ? list.filter((c) => c.group === "Tasks" || c.label.toLowerCase().includes(q)) : list;
  }, [targets, data, me, lemmaName, query, route, ui, toast]);

  useEffect(() => setAt(0), [query]);
  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    void Promise.resolve(c.run()).catch((e: Error) => toast(`Couldn't do it: ${e.message}`));
  };

  let group = "";
  return (
    <div className="tk-palette" role="dialog" aria-modal="true" aria-label="Commands">
      <button type="button" className="tk-palette__scrim" aria-label="Close" onClick={onClose} />
      <div className="tk-palette__panel">
        <label className="tk-palette__search">
          <Search size={15} aria-hidden="true" />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={targets.length ? "Do something with the selection, or find a task" : "Go to, find a task, or do something"}
            aria-label="Command"
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(commands.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); run(commands[at]); }
            }} />
          <Kbd>Esc</Kbd>
        </label>
        <div className="tk-palette__list" role="listbox">
          {commands.map((c, i) => {
            const head = c.group !== group ? (group = c.group) : null;
            return (
              <div key={c.id}>
                {head ? <p className="c-menu__label">{head}</p> : null}
                <button type="button" role="option" aria-selected={i === at} className={cx("c-menu__item", i === at && "is-at")}
                  onMouseMove={() => setAt(i)} onClick={() => run(c)}>
                  <span className="tk-palette__icon">{c.icon}</span>
                  <span className="c-grow c-ellipsis">{c.label}</span>
                  {c.hint}
                </button>
              </div>
            );
          })}
          {!commands.length ? <p className="tk-palette__none"><CircleCheck size={14} aria-hidden="true" /> Nothing matches.</p> : null}
        </div>
      </div>
    </div>
  );
}
