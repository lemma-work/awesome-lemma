// Sprints' own small marks: who a task is on, its status and its flag, all
// pills with words; the Lemma's own work with the sparkles icon.

import { Sparkles } from "lucide-react";
import { Avatar, Pill, openApp, type Tone } from "@lemma-plugins/kit";
import { firstName, type Who } from "./model";
import type { Task } from "./types";

export function WhoMark({ who, size = 20 }: { who: Who; size?: number }) {
  if (who.kind === "agent") {
    return (
      <span className="sp-bot" style={{ width: size, height: size }} title={who.name} aria-label={who.name}>
        <Sparkles size={Math.round(size * 0.6)} aria-hidden="true" />
      </span>
    );
  }
  if (who.kind === "none") return <span className="sp-nobody" style={{ width: size, height: size }} title="Nobody yet" aria-label="Nobody yet" />;
  return <span title={who.name} className="sp-av"><Avatar name={who.name} size={size} /></span>;
}

const STATUS: Record<Task["status"], [string, Tone]> = {
  todo: ["Todo", "plain"], in_progress: ["In progress", "info"], waiting: ["Waiting", "warning"], done: ["Done", "success"], canceled: ["Canceled", "plain"],
};

export function StatusPill({ status }: { status: Task["status"] }) {
  const [word, tone] = STATUS[status] || ["Todo", "plain"];
  return <Pill tone={tone}>{word}</Pill>;
}

export function AiMark({ children }: { children?: React.ReactNode }) {
  return (
    <span className="sp-ai">
      <Sparkles size={13} aria-hidden="true" />
      {children}
      <Pill tone="ai">ai</Pill>
    </span>
  );
}

export function openTask(t: Task | undefined) {
  if (t) void openApp("tasks", `/t/${t.id}`);
}

export function name(who: Who): string {
  return who.kind === "agent" ? "The Lemma's assistant" : who.kind === "none" ? "Nobody yet" : firstName(who.name);
}
