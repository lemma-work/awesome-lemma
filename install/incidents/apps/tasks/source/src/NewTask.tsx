// A new task, in a drawer: the title first, then whatever else is known.
// Enter makes it; ⌘Enter makes it and opens it. Without a project it is the
// person's own and private; with one, the team's.

import { useEffect, useRef, useState } from "react";
import { Lock, Users } from "lucide-react";
import { Button, Field, Sheet, useToast } from "@lemma-plugins/kit";
import { addDays, todayKey, useTasks, useWorld, type NewTask } from "./data";
import { agentName } from "./marks";
import { ASSISTANT, BOARD, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, type Priority, type Status, type Task } from "./types";

export function NewTaskSheet({ preset, onClose, onCreate }: {
  preset: Partial<NewTask>;
  onClose: () => void;
  onCreate: (input: NewTask, open: boolean) => Promise<Task>;
}) {
  const { projects, settings } = useTasks();
  const { me, members, lemmaName } = useWorld();
  const toast = useToast();
  const [title, setTitle] = useState(preset.title || "");
  const [description, setDescription] = useState(preset.description || "");
  const [status, setStatus] = useState<Status>(preset.status || "todo");
  const [priority, setPriority] = useState<Priority>(preset.priority || "none");
  const [due, setDue] = useState(preset.due_on || "");
  const [project, setProject] = useState(preset.project_id || "");
  const [who, setWho] = useState<string>("me");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const agents = settings?.agents?.length ? settings.agents : [ASSISTANT];
  const today = todayKey(settings?.timezone);

  const submit = async (open: boolean) => {
    if (!title.trim()) return input.current?.focus();
    setBusy(true);
    try {
      const member = members.find((m) => m.user_id === who);
      await onCreate({
        title, description, status, priority, due_on: due || null, project_id: project || null,
        assignee: who === "me" ? { kind: "person", user_id: me?.id, name: me?.name }
          : who === "none" ? { kind: "none" }
          : who.startsWith("agent:") ? { kind: "agent", agent: who.slice(6) }
          : { kind: "person", user_id: member?.user_id, name: member?.name },
      }, open);
      setTitle("");
      setDescription("");
      input.current?.focus();
    } catch (e) {
      toast(`Couldn't add it: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title="New task" onClose={onClose}
      footer={(
        <>
          <span className="c-faint tk-sheet-note">{project ? <><Users size={13} aria-hidden="true" /> The team sees it</> : <><Lock size={13} aria-hidden="true" /> Only you see it</>}</span>
          <span className="c-grow" />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void submit(false)}>Add task</Button>
        </>
      )}>
      <input ref={input} className="c-input tk-new-title" placeholder="What needs doing?" value={title} aria-label="Title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(e.metaKey || e.ctrlKey); } }} />
      <Field label="Notes">
        <textarea className="c-textarea" style={{ minHeight: 110 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything that helps, in markdown" />
      </Field>
      <div className="tk-new-grid">
        <Field label="Status">
          <select className="c-input" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {BOARD.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="c-input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </Field>
        <Field label="Due" hint={<span className="tk-quick">
          <button type="button" onClick={() => setDue(today)}>Today</button>
          <button type="button" onClick={() => setDue(addDays(today, 1))}>Tomorrow</button>
          <button type="button" onClick={() => setDue(addDays(today, 7))}>Next week</button>
        </span>}>
          <input type="date" className="c-input" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Project">
          <select className="c-input" value={project} onChange={(e) => { setProject(e.target.value); if (!e.target.value && !["me", "none"].includes(who) && !who.startsWith("agent:")) setWho("me"); }}>
            <option value="">None: my own list (private)</option>
            {projects.filter((p) => p.state === "active").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Who does it">
          <select className="c-input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="me">Me</option>
            {project ? members.filter((m) => m.user_id !== me?.id).map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>) : null}
            {agents.map((a) => <option key={a} value={`agent:${a}`}>{agentName(a, lemmaName)}{a === ASSISTANT ? " (this Lemma)" : ""}</option>)}
            <option value="none">Nobody yet</option>
          </select>
        </Field>
      </div>
      <p className="c-faint tk-sheet-note">Enter adds it. ⌘Enter adds it and opens it.</p>
    </Sheet>
  );
}
