// C: closing the running sprint. The numbers, one row per unfinished task with
// the sprints it was in and a choice (carry, split, backlog, drop) beside the
// Lemma's suggestion, what came in after the start, the last six sprints, and
// the summary drafted from the numbers, which the lead can edit. Every
// unfinished task needs a choice before the sprint closes: none is made for
// anyone.

import { useEffect, useMemo, useState } from "react";
import { Copy, FileText, Pencil, RefreshCw } from "lucide-react";
import { Button, Empty, Markdown, Pill, Segmented, cx, useToast } from "@lemma-plugins/kit";
import { SixSprints, type Bar } from "./charts";
import { call, refreshNeedsYou, useSprints, useWho } from "./data";
import { AiMark, WhoMark, openTask } from "./marks";
import { SOURCE_NAMES, isDone, localKey, longDay, num, numbers, present, range, shortDay, sourceText, sprintsOf, whoOf, type World } from "./model";
import { to } from "./route";
import { Stats, unitWord } from "./SprintView";
import { Top } from "./Top";
import type { Choice, Item, Sprint } from "./types";

interface Pick { choice?: Choice; carry_points?: number | null; rest_title?: string; rest_points?: number | null }

export function Close() {
  const { w, settings } = useSprints();
  const { me } = useWho();
  const toast = useToast();
  const sprint = w.running;
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const lead = !!me && settings?.lead_user_id === me.id;

  const open = useMemo(() => (sprint ? present(w.itemsBy.get(sprint.id) || []).filter((i) => !isDone(w, i))
    .sort((a, b) => (w.tasks.get(a.task_id)?.number || 0) - (w.tasks.get(b.task_id)?.number || 0)) : []), [w, sprint]);
  const suggestions = useMemo(() => new Map(w.suggestions.filter((s) => sprint && s.sprint_id === sprint.id && s.kind === "close").map((s) => [s.task_ids[0], s])), [w, sprint]);
  useEffect(() => { if (sprint?.summary && text == null) setText(sprint.summary); }, [sprint?.summary, text]);

  if (!sprint) {
    return (
      <>
        <Top title="Close" here="none" />
        <main className="c-body"><Empty title="No sprint is running">There is nothing to close.</Empty></main>
      </>
    );
  }
  const next = sprint.number + 1;
  const u = unitWord(w.measure);
  const ended = w.today >= sprint.ends_on;
  const decided = open.filter((i) => picks[i.task_id]?.choice).length;
  const withSuggestion = open.filter((i) => suggestions.get(i.task_id)?.choice).length;
  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch (e) {
      toast(`Couldn't do that: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  const choices = () => Object.fromEntries(open.map((i) => [i.task_id, { ...picks[i.task_id] }]));
  const prepare = () => run("prepare", async () => {
    const out = await call("sprints_close_prepare", { sprint: sprint.number, mode: "prepare" });
    toast(out.message || "Asked the Lemma.");
    setText(null);
    refreshNeedsYou();
  });
  const redraft = () => run("draft", async () => {
    await call("sprints_close_prepare", { sprint: sprint.number, mode: "summary", choices: choices() });
    setText(null);
    setEditing(false);
  });
  const take = () => setPicks((p) => {
    const out = { ...p };
    for (const i of open) {
      const s = suggestions.get(i.task_id);
      if (s?.choice && !out[i.task_id]?.choice) out[i.task_id] = { choice: s.choice as Choice };
    }
    return out;
  });
  const close = () => run("close", async () => {
    const edited = editing || (text != null && text !== sprint.summary) ? text : null;
    const out = await call("sprints_close", { sprint: sprint.number, choices: choices(), summary: edited });
    toast(out.message || `Closed Sprint ${sprint.number}.`);
    if ((out as { closed?: boolean }).closed) to.sprint(sprint.number);
  });

  const added = (w.itemsBy.get(sprint.id) || []).filter((i) => !i.in_at_start);
  const bars: Bar[] = [...w.closed.slice(-5), sprint].map((s) => barOf(w, s, s.id === sprint.id));
  const lastDay = sprint.ends_on;
  return (
    <>
      <Top title={`Close Sprint ${sprint.number}`} here="none"
        pill={<Pill tone="warning">{ended ? (w.today === lastDay ? "Ends today" : `Ended ${longDay(lastDay)}`) : `Ends ${shortDay(lastDay)}`}</Pill>}
        dates={`${range(sprint.starts_on, sprint.ends_on)}${ended && settings?.lead_name ? ` · in Today for ${settings.lead_name.split(" ")[0]} as “Close Sprint ${sprint.number}”` : !ended ? " · closing early keeps the numbers as they are now" : ""}`}>
        <Button variant="ghost" onClick={() => to.run()}>Back to the sprint</Button>
        <Button variant="primary" busy={busy === "close"} disabled={!lead || decided < open.length}
          title={!lead ? `${settings?.lead_name || "The lead"} closes sprints` : decided < open.length ? `Choose for ${open.length - decided} more` : undefined}
          onClick={() => void close()}>Close {sprint.number} and open {next}</Button>
      </Top>
      <div className="sp-body">
        <div className="sp-main">
          <Stats w={w} sprint={sprint} measure={w.measure} capacityTotal={sprint.capacity_total} closing />
          <div className="sp-sechead">
            <h2 className="sp-sec">Not done: decide each one</h2>
            <span className="c-faint sp-hint">{decided} of {open.length} decided</span>
            <span className="c-grow" />
            {withSuggestion ? <Button size="sm" onClick={take}>Take the Lemma's suggestions</Button>
              : <Button size="sm" busy={busy === "prepare"} onClick={() => void prepare()}>Ask the Lemma for suggestions</Button>}
          </div>
          {open.length ? (
            <div className="sp-box">
              <div className="sp-u sp-u--head"><span>#</span><span>Task</span><span /><span>{u}</span><span>Sprints it was in</span><span>What happens to it</span></div>
              {open.map((i) => (
                <Undone key={i.id} w={w} sprint={sprint} item={i} pick={picks[i.task_id] || {}} next={next}
                  suggestion={suggestions.get(i.task_id)?.text || null} suggested={(suggestions.get(i.task_id)?.choice as Choice) || null}
                  onPick={(p) => setPicks((all) => ({ ...all, [i.task_id]: { ...all[i.task_id], ...p } }))} />
              ))}
            </div>
          ) : <p className="c-faint">Everything in the sprint is done.</p>}
          <h2 className="sp-sec">Came in after the start</h2>
          <div className="sp-box">
            {added.length ? added.map((i) => {
              const t = w.tasks.get(i.task_id);
              const src = sourceText(w, t) || "added";
              const who = whoOf(t);
              return (
                <div key={i.id} className="sp-a">
                  <span className="sp-mono c-faint">#{t?.number}</span>
                  <button type="button" className="sp-row__main" onClick={() => openTask(t)}><span className="c-ellipsis">{t?.title}</span></button>
                  <span className="c-faint c-ellipsis sp-small">{src}{who.kind === "agent" ? " · assistant" : ""}</span>
                  <span className="c-faint">{w.measure === "tasks" ? "" : num(w.est.get(i.task_id) ?? 0)}</span>
                  <span>{i.removed_at ? <Pill>Taken out</Pill> : isDone(w, i) ? <Pill tone="success">Done</Pill> : <Pill tone="warning">Not done</Pill>}</span>
                </div>
              );
            }) : <div className="sp-empty-row c-faint">Nothing came in after the start.</div>}
          </div>
          <div className="sp-sechead"><h2 className="sp-sec">Last six sprints</h2><span className="c-grow" /><span className="c-faint sp-hint">scope and done, in {w.measure === "points" ? "points" : "tasks"}</span></div>
          <div className="sp-box sp-box--pad"><SixSprints bars={bars} unit={u} /></div>
        </div>
        <aside className="sp-side">
          <section className="sp-doc">
            <div className="sp-doc__head">
              <AiMark><span className="sp-doc__title">Summary</span></AiMark>
              <span className="c-faint sp-small">drafted from the numbers · you edit it</span>
              <span className="c-grow" />
              {sprint.summary ? <Button size="sm" icon={Pencil} onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}</Button> : null}
            </div>
            <div className="sp-doc__body">
              {editing ? (
                <textarea className="c-textarea" aria-label="Summary" value={text || ""} onChange={(e) => setText(e.target.value)} />
              ) : text ? (
                <SummaryView text={text} />
              ) : (
                <p className="c-faint">No draft yet. The Lemma drafts it from the numbers when it suggests what happens to each task.</p>
              )}
            </div>
            <div className="sp-doc__foot">
              <Button size="sm" icon={Copy} disabled={!text} onClick={() => void navigator.clipboard?.writeText(text || "").then(() => toast("Copied."))}>Copy</Button>
              <Button size="sm" icon={RefreshCw} busy={busy === "draft"} onClick={() => void redraft()}>{text ? "Draft again with these choices" : "Draft it"}</Button>
              <span className="c-faint sp-small"><FileText size={12} aria-hidden="true" /> Saved as /sprints/{sprint.number}.md when you close</span>
            </div>
          </section>
          <p className="c-faint sp-small">Nothing is rounded up, and a task done after the close counts in Sprint {next}. {sprint.summary_draft?.how ? `Which sentences are in: ${sprint.summary_draft.how}.` : ""}</p>
        </aside>
      </div>
    </>
  );
}

/** The summary, with its numbers line drawn as pills. */
export function SummaryView({ text }: { text: string }) {
  const lines = text.split("\n");
  const head = lines[0]?.startsWith("# ") ? lines[0].slice(2) : null;
  const numbersLine = lines.find((l) => /^Planned [\d.]+ · Added/.test(l));
  const rest = lines.filter((l, k) => !(k === 0 && head) && l !== numbersLine).join("\n").trim();
  const pills = numbersLine ? numbersLine.replace(" (tasks)", "").split(" · ") : [];
  const tone = (p: string) => (p.startsWith("Added") ? "info" : p.startsWith("Done") ? "success" : p.startsWith("Not done") ? "warning" : "plain") as "info" | "success" | "warning" | "plain";
  return (
    <div className="sp-summary">
      {head ? <h3>{head}</h3> : null}
      {pills.length ? <div className="sp-pills">{pills.map((p) => <Pill key={p} tone={tone(p)} dot={false}>{p}</Pill>)}</div> : null}
      <Markdown text={rest} />
    </div>
  );
}

function barOf(w: World, s: Sprint, now: boolean): Bar {
  const n = numbers(w, s);
  const st = s.stats;
  const carried = st ? (st.carried?.tasks || 0) + (st.split?.tasks || 0) : n.notDone.tasks;
  return { label: String(s.number), scope: n.scope, done: n.done.size, carried, now };
}

function Undone({ w, sprint, item, pick, next, suggestion, suggested, onPick }: {
  w: World; sprint: Sprint; item: Item; pick: Pick; next: number; suggestion: string | null; suggested: Choice | null; onPick: (p: Pick) => void;
}) {
  const t = w.tasks.get(item.task_id);
  const who = whoOf(t);
  const was = sprintsOf(w, item.task_id).filter((n) => n <= sprint.number);
  const shown = [sprint.number - 2, sprint.number - 1, sprint.number];
  const changed = [t?.updated_at, ...w.events.filter((e) => e.task_id === item.task_id).map((e) => e.at)].filter(Boolean).sort().pop();
  const state = [t?.status === "in_progress" ? "In progress" : t?.status === "waiting" ? "Waiting" : "Todo",
    item.in_at_start ? null : `added ${shortDay(localKey(item.added_at, w.zone) || "")}${t?.source && !["tasks", "chat"].includes(t.source) ? ` from ${SOURCE_NAMES[t.source] || t.source}` : ""}`,
    who.kind === "none" ? "nobody had it" : null,
    changed ? `last change ${shortDay(localKey(changed, w.zone) || "")}` : null].filter(Boolean).join(" · ");
  const pts = w.est.get(item.task_id);
  const scale = [1, 2, 3, 5, 8];
  return (
    <div className="sp-u">
      <span className="sp-mono c-faint">#{t?.number}</span>
      <button type="button" className="sp-row__main" onClick={() => openTask(t)}>
        <span className="c-ellipsis">{t?.title}</span>
        <span className="c-ellipsis c-faint sp-row__sub">{state}</span>
      </button>
      <WhoMark who={who} />
      <span className="c-faint">{w.measure === "tasks" ? "" : pts != null ? num(pts) : "–"}</span>
      <span className="sp-hist" aria-label={`In sprints ${was.join(", ")}`}>
        {shown.filter((n) => n > 0).map((n) => <i key={n} className={cx(was.includes(n) && "is-in")}>{n}</i>)}
      </span>
      <span className="sp-choice">
        <Segmented label={`What happens to #${t?.number}`} value={(pick.choice || "") as Choice}
          items={[{ id: "carry", label: `Carry to ${next}` }, { id: "split", label: "Split" }, { id: "backlog", label: "Backlog" }, { id: "drop", label: "Drop" }]}
          onChange={(c) => onPick({ choice: c as Choice })} />
      </span>
      <div className="sp-u__sub">
        {suggestion ? <AiMark><span>{suggestion}</span></AiMark> : <span className="c-faint">No suggestion yet.</span>}
        {pick.choice === "split" && w.measure === "points" ? (
          <div className="sp-split">
            <label>Carries to {next}
              <select className="c-select" value={pick.carry_points ?? ""} onChange={(e) => onPick({ carry_points: e.target.value === "" ? null : Number(e.target.value) })}>
                <option value="">as it is</option>
                {scale.filter((p) => pts == null || p < pts).map((p) => <option key={p} value={p}>{p} pts</option>)}
              </select>
            </label>
            <label className="sp-split__rest">The rest, as a new task in the backlog
              <input className="c-input" value={pick.rest_title ?? `${t?.title}: the rest`} onChange={(e) => onPick({ rest_title: e.target.value })} />
            </label>
            <label>its estimate
              <select className="c-select" value={pick.rest_points ?? ""} onChange={(e) => onPick({ rest_points: e.target.value === "" ? null : Number(e.target.value) })}>
                <option value="">{pts != null && pick.carry_points != null ? `${num(pts - pick.carry_points)} pts (the difference)` : "none"}</option>
                {scale.map((p) => <option key={p} value={p}>{p} pts</option>)}
              </select>
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
