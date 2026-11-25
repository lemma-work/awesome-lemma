// Which agent runs a task, and on which model: Lemma in the cloud, or a
// coding agent (Claude Code, Codex…) on the person's Mac, each with its live
// status. Lifted from the factory's runtime picker, drawn with the kit.

import { Check, ChevronDown, Cloud, Laptop } from "lucide-react";
import { Menu, MenuLabel, Pill, cx, type Tone } from "@lemma-plugins/kit";
import { useWorld } from "./data";
import type { Runtime } from "./types";

const WORD: Record<string, string> = { READY: "Ready", OFFLINE: "Offline", NOT_INSTALLED: "Not installed", UNAVAILABLE: "Unavailable", UNAVAILABLE_FOR_YOU: "Not yours" };

export function statusWord(r: Runtime): { word: string; tone: Tone } {
  return { word: WORD[r.status] || r.status.toLowerCase().replace(/_/g, " "), tone: r.ready ? "success" : "plain" };
}

export function hintOf(r: Runtime): string {
  if (r.kind === "MODEL_PROVIDER") return r.id === "system:lemma" ? "Billed to this Lemma" : r.model ? `Model provider · ${r.model}` : "Model provider";
  if (r.status === "NOT_INSTALLED") return "Not on your Mac";
  if (r.status === "OFFLINE") return "Open Lemma on your Mac";
  return "Runs on your own plan";
}

/** The agent menu, grouped by where it runs. `place` narrows it to one side. */
export function AgentMenu({ value, onChange, place, size = "md" }: { value: string; onChange: (id: string) => void; place?: "cloud" | "mac"; size?: "md" | "sm" }) {
  const { runtimes } = useWorld();
  const list = runtimes || [];
  const current = list.find((r) => r.id === value);
  const cloud = list.filter((r) => r.kind === "MODEL_PROVIDER" && place !== "mac");
  const mac = list.filter((r) => r.kind === "HARNESS" && place !== "cloud");
  const row = (r: Runtime, close: () => void) => {
    const s = statusWord(r);
    return (
      <button key={r.id} type="button" role="menuitemradio" aria-checked={r.id === value} className="c-menu__item cd-agent"
        onClick={() => { onChange(r.id); close(); }}>
        <span className={cx("cd-dot", r.ready ? "cd-dot--ok" : "cd-dot--off")} aria-hidden="true" />
        <span className="c-grow">
          <span className="cd-agent__name">{r.name}</span>
          <span className="cd-agent__hint">{hintOf(r)}</span>
        </span>
        <Pill tone={s.tone}>{s.word}</Pill>
        {r.id === value ? <Check size={14} aria-hidden="true" /> : <span style={{ width: 14 }} />}
      </button>
    );
  };
  return (
    <Menu size={size} title="Which agent" label={<>
      {current?.kind === "HARNESS" ? <Laptop size={14} aria-hidden="true" /> : <Cloud size={14} aria-hidden="true" />}
      <span className="cd-ellipsis-120">{current?.name || (value === "system:lemma" ? "Lemma" : "Pick an agent")}</span>
      <ChevronDown size={13} aria-hidden="true" className="c-faint" />
    </>}>
      {(close) => (
        <div className="cd-agentmenu">
          {cloud.length ? <MenuLabel>In the cloud</MenuLabel> : null}
          {cloud.map((r) => row(r, close))}
          {mac.length ? <MenuLabel>On your Mac, through Lemma desktop</MenuLabel> : null}
          {mac.map((r) => row(r, close))}
          {!list.length ? <MenuLabel>{runtimes ? "No agents are set up for this organization." : "Reading the agents…"}</MenuLabel> : null}
        </div>
      )}
    </Menu>
  );
}

export function ModelMenu({ runtime, value, onChange, size = "md" }: { runtime: Runtime | null; value: string | null; onChange: (model: string | null) => void; size?: "md" | "sm" }) {
  const models = runtime?.models || [];
  if (!runtime || (!models.length && !runtime.model)) return null;
  const label = models.find((m) => m.name === value)?.label || value || (runtime.model ? `${models.find((m) => m.name === runtime.model)?.label || runtime.model}` : "Default model");
  return (
    <Menu size={size} title="Model" label={<>{label}<ChevronDown size={13} aria-hidden="true" className="c-faint" /></>}>
      {(close) => (
        <>
          <MenuLabel>Model</MenuLabel>
          <button type="button" className="c-menu__item" role="menuitemradio" aria-checked={!value} onClick={() => { onChange(null); close(); }}>
            <span className="c-grow">Its default{runtime.model ? ` (${models.find((m) => m.name === runtime.model)?.label || runtime.model})` : ""}</span>
            {!value ? <Check size={14} aria-hidden="true" /> : null}
          </button>
          {models.map((m) => (
            <button key={m.name} type="button" className="c-menu__item" role="menuitemradio" aria-checked={m.name === value} onClick={() => { onChange(m.name); close(); }}>
              <span className="c-grow">{m.label}</span>
              {m.name === value ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}
