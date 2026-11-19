// Tasks' own small marks on the kit: a status circle, priority bars, the due
// day, who has it (a person, or an agent with the Lemma's face). Only the
// kit's --c-* roles; every mark also has a word for readers.

import { Bot, CircleDashed, CircleDot, CircleCheck, CircleX, Hourglass, Sparkles } from "lucide-react";
import { Avatar, Face, Pill, cx } from "@lemma-plugins/kit";
import { addDays, todayKey } from "./data";
import { ASSISTANT, PRIORITY_LABEL, STATUS_LABEL, type Priority, type Run, type Status, type Task } from "./types";

export function StatusIcon({ status, size = 15 }: { status: Status; size?: number }) {
  const Icon = { todo: CircleDashed, in_progress: CircleDot, waiting: Hourglass, done: CircleCheck, canceled: CircleX }[status] || CircleDashed;
  return (
    <span className={cx("tk-status", `tk-status--${status}`)} role="img" aria-label={STATUS_LABEL[status]} title={STATUS_LABEL[status]}>
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}

/** Three rising bars, filled by level; urgent is a filled square with "!". */
export function PriorityIcon({ priority }: { priority: Priority }) {
  if (priority === "urgent") {
    return (
      <span className="tk-prio tk-prio--urgent" role="img" aria-label={PRIORITY_LABEL.urgent} title={PRIORITY_LABEL.urgent}>
        !
      </span>
    );
  }
  const level = { none: 0, low: 1, medium: 2, high: 3, urgent: 3 }[priority] ?? 0;
  return (
    <span className={cx("tk-prio", level === 0 && "tk-prio--none")} role="img" aria-label={PRIORITY_LABEL[priority]} title={PRIORITY_LABEL[priority]}>
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= level ? "is-on" : undefined} style={{ height: 3 + n * 3 }} />
      ))}
    </span>
  );
}

/** "Today", "Tomorrow", "Fri 21", "2 days late": late in red, today in amber, with the word. */
export function Due({ on, zone, done }: { on?: string | null; zone?: string | null; done?: boolean }) {
  if (!on) return null;
  const today = todayKey(zone);
  const key = on.slice(0, 10);
  let text: string;
  let tone = "";
  if (key === today) {
    text = "Today";
    tone = "today";
  } else if (key === addDays(today, 1)) {
    text = "Tomorrow";
  } else if (key < today && done) {
    text = new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  } else if (key < today) {
    const days = Math.round((Date.parse(today) - Date.parse(key)) / 86400000);
    text = days === 1 ? "Yesterday" : `${days} days late`;
    tone = "late";
  } else {
    const d = new Date(`${key}T12:00:00Z`);
    const within = Date.parse(key) - Date.parse(today) < 6 * 86400000;
    text = within
      ? d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })
      : d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  }
  return <span className={cx("tk-due", !done && tone && `tk-due--${tone}`)} title={`Due ${key}`}>{text}</span>;
}

/** "meetings-notes-reader" → "Meetings notes reader"; the Lemma's own assistant is the Lemma. */
export function agentName(agent: string | null | undefined, lemmaName: string): string {
  if (!agent || agent === ASSISTANT || agent === "POD_DEFAULT") return lemmaName;
  const spaced = agent.replace(/[-_]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : agent;
}

/** Who has it: a person's initials, the Lemma's face, or a named agent's bot. */
export function Assignee({ task, lemmaName, meId, size = 22 }: { task: Task; lemmaName: string; meId?: string | null; size?: number }) {
  if (task.assignee_kind === "agent") {
    const name = agentName(task.assignee_agent, lemmaName);
    return (
      <span className="tk-who" title={`${name} is on it`}>
        {task.assignee_agent === ASSISTANT || !task.assignee_agent ? <Face size={size} /> : <span className="tk-bot" style={{ width: size, height: size }}><Bot size={Math.round(size * 0.62)} aria-hidden="true" /></span>}
        <span className="c-sr">{name}</span>
      </span>
    );
  }
  if (task.assignee_kind === "person") {
    const you = !!meId && task.assignee_user_id === meId;
    return (
      <span className="tk-who" title={you ? "You" : task.assignee_name || "Someone"}>
        <Avatar name={task.assignee_name} size={size} you={you} />
        <span className="c-sr">{you ? "You" : task.assignee_name}</span>
      </span>
    );
  }
  return (
    <span className="tk-who tk-who--none" title="Nobody yet">
      <span className="tk-nobody" style={{ width: size, height: size }} aria-hidden="true" />
      <span className="c-sr">Nobody yet</span>
    </span>
  );
}

/** An agent's state, with a word. */
export function RunPill({ run }: { run: Run | null | undefined }) {
  if (!run) return null;
  const map: Record<Run["state"], { text: string; tone: "plain" | "info" | "success" | "warning" | "danger" | "ai" }> = {
    starting: { text: "Starting", tone: "ai" },
    working: { text: "Working", tone: "ai" },
    waiting: { text: "Waiting on you", tone: "warning" },
    done: { text: "Finished", tone: "success" },
    stopped: { text: "Stopped", tone: "plain" },
    failed: { text: "Couldn't start", tone: "danger" },
  };
  const m = map[run.state];
  return <Pill tone={m.tone} icon={run.state === "working" || run.state === "starting" ? Sparkles : undefined}>{m.text}</Pill>;
}

export function Labels({ labels }: { labels?: string[] | null }) {
  if (!labels?.length) return null;
  return (
    <span className="tk-labels">
      {labels.slice(0, 3).map((l) => (
        <span key={l} className="tk-label">{l}</span>
      ))}
    </span>
  );
}
