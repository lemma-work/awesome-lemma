// Settings: the team's stages and currency, the weekly review's day, whether
// Deal tracker reads this person's new conversations, and the sample.

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Database, Ear, KanbanSquare, Plus, Trash2 } from "lucide-react";
import { Button, Card, Switch, runFunction, update, useToast, errorText } from "@lemma-plugins/kit";
import { browserZone, scheduleReview, useDeals } from "./data";
import type { StageKind } from "./types";

export interface StageDraft { id?: string; name: string; kind: StageKind; meaning: string }

const KIND_WORD: Record<StageKind, string> = { open: "Open", won: "Won", lost: "Lost" };

/** The stages, in order, each with what reaching it means. Used at set-up and in Settings. */
export function StagesEditor({ value, onChange }: { value: StageDraft[]; onChange: (v: StageDraft[]) => void }) {
  const set = (i: number, patch: Partial<StageDraft>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...value];
    const [s] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, s);
    onChange(next);
  };
  return (
    <div className="dt-stages">
      {value.map((s, i) => (
        <div key={s.id || `new-${i}`} className="dt-stages__row">
          <span className="dt-stages__n num" aria-hidden="true">{i + 1}</span>
          <div className="dt-stages__fields">
            <div className="dt-stages__top">
              <input className="c-input" value={s.name} aria-label={`Stage ${i + 1} name`} onChange={(e) => set(i, { name: e.target.value })} />
              <select className="c-select dt-stages__kind" value={s.kind} aria-label={`Stage ${i + 1} kind`} onChange={(e) => set(i, { kind: e.target.value as StageKind })}>
                {(["open", "won", "lost"] as StageKind[]).map((k) => <option key={k} value={k}>{KIND_WORD[k]}</option>)}
              </select>
            </div>
            <input className="c-input dt-stages__meaning" value={s.meaning} placeholder="What reaching it means" aria-label={`What reaching ${s.name || "it"} means`}
              onChange={(e) => set(i, { meaning: e.target.value })} />
          </div>
          <div className="dt-stages__acts">
            <Button size="sm" variant="ghost" icon={ArrowUp} label={`Move ${s.name} up`} disabled={i === 0} onClick={() => move(i, -1)} />
            <Button size="sm" variant="ghost" icon={ArrowDown} label={`Move ${s.name} down`} disabled={i === value.length - 1} onClick={() => move(i, 1)} />
            <Button size="sm" variant="ghost" icon={Trash2} label={`Remove ${s.name}`} disabled={value.length <= 3} onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      <div className="dt-stages__foot">
        <Button size="sm" icon={Plus} onClick={() => {
          const at = value.findIndex((s) => s.kind !== "open");
          const next = [...value];
          next.splice(at < 0 ? next.length : at, 0, { name: "", kind: "open", meaning: "" });
          onChange(next);
        }}>Add a stage</Button>
        <span className="c-field__hint">Open stages first, then won and lost. The reader uses each one's meaning to tell when a conversation moves a deal.</span>
      </div>
    </div>
  );
}

export function stageProblem(stages: StageDraft[]): string | null {
  const names = stages.map((s) => s.name.trim().toLowerCase());
  if (names.some((n) => !n)) return "Every stage needs a name.";
  if (new Set(names).size !== names.length) return "Two stages have the same name.";
  const kinds = new Set(stages.map((s) => s.kind));
  if (!kinds.has("open") || !kinds.has("won") || !kinds.has("lost")) return "Keep at least one open stage, one for won and one for lost.";
  return null;
}

export function SettingsPage() {
  const { stages, settings, member, me, reload, sample, deals } = useDeals();
  const toast = useToast();
  const [draft, setDraft] = useState<StageDraft[]>([]);
  const [currency, setCurrency] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !stages.length) return;
    seeded.current = true;
    setDraft(stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, meaning: s.meaning || "" })));
    setCurrency(settings?.currency || "USD");
  }, [stages, settings]);

  const saveStages = async () => {
    const problem = stageProblem(draft);
    if (problem) return toast(problem);
    setBusy("stages");
    try {
      const out = await runFunction<{ message?: string }>("deals_setup_apply", { stages: draft, currency, display_name: me?.display || null });
      await Promise.all([reload("stages"), reload("settings"), reload("deals")]);
      seeded.current = false;
      toast(`Saved: ${out.message || "stages and currency"}.`);
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const setDay = async (patch: { review_day?: string; review_time?: string }) => {
    if (!settings) return;
    try {
      await update("deals_settings", settings.id, { ...patch, timezone: settings.timezone || browserZone() });
      await scheduleReview({ ...settings, ...patch }, me);
      await reload("settings");
      toast("The weekly review moved.");
    } catch (e) {
      toast(`Couldn't move it: ${errorText(e)}`);
    }
  };
  const sampleDo = async (mode: "load" | "clear") => {
    setBusy(mode);
    try {
      const out = await runFunction<{ message?: string }>("deals_sample_data", { mode, display_name: me?.display || null });
      await Promise.all([reload("deals"), reload("changes"), reload("dealSample")]);
      void runFunction("deals_needs_you", {}).catch(() => undefined);
      toast(out.message || "Done.");
    } catch (e) {
      toast(`Couldn't: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="c-body dt-settings">
      <Card title="Stages" icon={KanbanSquare} foot={
        <div className="c-row"><span className="c-grow" /><Button variant="primary" busy={busy === "stages"} onClick={() => void saveStages()}>Save stages and currency</Button></div>}>
        <StagesEditor value={draft} onChange={setDraft} />
        <label className="c-field dt-currency"><span>The team's currency</span>
          <input className="c-input" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </label>
        <p className="c-field__hint">Renaming a stage renames it on every deal. A stage you remove sends its deals to the first open stage, in each deal's history.</p>
      </Card>

      {settings ? (
        <Card title="Weekly review" icon={Database}>
          <div className="dt-two">
            <label className="c-field"><span>Day</span>
              <select className="c-select" value={settings.review_day} onChange={(e) => void setDay({ review_day: e.target.value })}>
                {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
              </select>
            </label>
            <label className="c-field"><span>Time ({settings.timezone})</span>
              <input className="c-input" type="time" defaultValue={settings.review_time} onBlur={(e) => e.target.value !== settings.review_time && void setDay({ review_time: e.target.value })} />
            </label>
          </div>
          <p className="c-field__hint">One summary for the whole team, written from what was counted. Everything else on the review is counted live.</p>
        </Card>
      ) : null}

      {member ? (
        <Card title="Reading for you" icon={Ear}>
          <div className="c-row dt-switch-row">
            <div className="c-grow">
              <div>Read my new conversations and meeting notes for deal changes</div>
              <div className="c-field__hint">Only conversations and meetings with someone at a company. What it proposes is yours until you keep it; the sentence never leaves your view.</div>
            </div>
            <Switch label="Read my new conversations" checked={member.listening} onChange={(v) => void update("deals_member", member.id, { listening: v }).then(() => reload("member"))} />
          </div>
        </Card>
      ) : null}

      {sample.mail || sample.meetings || sample.deals ? (
        <Card title="Sample" icon={Database}>
          <p className="c-muted dt-lead">
            {sample.deals ? "Four made-up deals with weeks of history are on the board, at .example companies." :
              "Your mail and meetings are the sample. Add four made-up deals with weeks of history, so the board, a deal's history and the weekly review have something in them."}
          </p>
          <div className="c-row">
            {!sample.deals ? <Button busy={busy === "load"} onClick={() => void sampleDo("load")}>Add sample deals</Button> : null}
            <Button variant="ghost" busy={busy === "clear"} onClick={() => void sampleDo("clear")}>Remove what the sample made</Button>
            <span className="c-faint">{deals.length} deals in all</span>
          </div>
        </Card>
      ) : null}
    </main>
  );
}
