// The choices every place offers for a task: status, priority, who has it.
// Each is a short list in the kit's menu; the same lists back the palette.

import { Bot, UserRound, UserX } from "lucide-react";
import { Avatar, Face, MenuItem, MenuLabel, useToast } from "@lemma-plugins/kit";
import { assignPerson, handOver, patchTask, setStatus, useTasks, useWorld } from "./data";
import { PriorityIcon, StatusIcon, agentName } from "./marks";
import { Pop } from "./Pop";
import { ASSISTANT, BOARD, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, type Priority, type Status, type Task } from "./types";

export function StatusPicker({ task, size }: { task: Task; size?: number }) {
  const { me } = useWorld();
  const toast = useToast();
  return (
    <Pop label={`Status: ${STATUS_LABEL[task.status]}. Change it`} trigger={<StatusIcon status={task.status} size={size} />}>
      {(close) => (
        <>
          <MenuLabel>Status</MenuLabel>
          {[...BOARD, "canceled" as Status].map((s) => (
            <button key={s} type="button" role="menuitem" className="c-menu__item"
              onClick={() => { close(); void setStatus(task, s, me).catch((e) => toast(`Couldn't move it: ${e.message}`)); }}>
              <StatusIcon status={s} size={14} />
              <span className="c-grow">{STATUS_LABEL[s]}</span>
              {s === task.status ? <span className="c-faint">Now</span> : null}
            </button>
          ))}
        </>
      )}
    </Pop>
  );
}

export function PriorityPicker({ task, children }: { task: Task; children?: React.ReactNode }) {
  const { me } = useWorld();
  const toast = useToast();
  return (
    <Pop label={`Priority: ${PRIORITY_LABEL[task.priority]}. Change it`} trigger={children || <PriorityIcon priority={task.priority} />}>
      {(close) => (
        <>
          <MenuLabel>Priority</MenuLabel>
          {PRIORITIES.map((p: Priority) => (
            <button key={p} type="button" role="menuitem" className="c-menu__item"
              onClick={() => { close(); void patchTask(task, { priority: p }, me, "priority").catch((e) => toast(`Couldn't change it: ${e.message}`)); }}>
              <PriorityIcon priority={p} />
              <span className="c-grow">{PRIORITY_LABEL[p]}</span>
            </button>
          ))}
        </>
      )}
    </Pop>
  );
}

/** Who has it: you, someone on the team (team tasks), the Lemma, or a named agent. */
export function AssignItems({ task, close }: { task: Task; close: () => void }) {
  const { me, members, lemmaName } = useWorld();
  const { settings, runById, decisionById } = useTasks();
  const toast = useToast();
  const allowed = settings?.agents?.length ? settings.agents : [ASSISTANT];
  const run = runById.get(task.id) || null;
  const decision = decisionById.get(task.id) || null;
  const people = task.scope === "team" ? members : members.filter((m) => m.user_id === me?.id);
  const fail = (e: Error) => toast(`Couldn't change who has it: ${e.message}`);
  return (
    <>
      <MenuLabel>A person</MenuLabel>
      {people.map((m) => (
        <button key={m.user_id} type="button" role="menuitem" className="c-menu__item"
          onClick={() => { close(); void assignPerson(task, m, me, run).catch(fail); }}>
          <Avatar name={m.name} email={m.email} size={18} you={m.user_id === me?.id} />
          <span className="c-grow">{m.user_id === me?.id ? "You" : m.name}</span>
        </button>
      ))}
      {task.scope === "personal" ? <p className="tk-menu-note">Share it with the team to give it to someone else.</p> : null}
      <MenuLabel>An agent</MenuLabel>
      {allowed.map((a) => (
        <button key={a} type="button" role="menuitem" className="c-menu__item"
          onClick={() => {
            close();
            void handOver(task, a, me, decision).then(() => toast(`Handed to ${agentName(a, lemmaName)}. It reports here.`)).catch(fail);
          }}>
          {a === ASSISTANT ? <Face size={18} /> : <Bot size={14} aria-hidden="true" />}
          <span className="c-grow">{agentName(a, lemmaName)}</span>
          {a === ASSISTANT ? <span className="c-faint">this Lemma</span> : null}
        </button>
      ))}
      {task.assignee_kind !== "none" ? (
        <MenuItem icon={UserX} onSelect={() => { close(); void assignPerson(task, null, me, run).catch(fail); }}>Nobody</MenuItem>
      ) : null}
    </>
  );
}

export function AssignPicker({ task, children }: { task: Task; children: React.ReactNode }) {
  return (
    <Pop label="Who has it. Change it" align="right" trigger={children}>
      {(close) => <AssignItems task={task} close={close} />}
    </Pop>
  );
}

export { UserRound };
