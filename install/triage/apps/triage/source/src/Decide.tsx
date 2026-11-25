// One key per decision, on the inbox's pane and on the case file:
//   1 accept   2 decline   3 duplicate   H snooze   G give to an agent   A owner
// Accept makes a team task with the evidence; decline asks for a reason and
// tells the askers; duplicate moves them onto the original. Give to an agent
// is Coding agent when it's installed (Dependency updates for a Dependabot
// item when that is), otherwise the Lemma's own assistant through Tasks.

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Clock, Copy, Flame, Undo2, UserRound, X } from "lucide-react";
import { Button, DEMO, Field, Kbd, Sheet, openApp, useToast } from "@lemma-plugins/kit";
import { typing } from "./keys";
import { decide, nameOf, useTriage, useWho, type Data } from "./data";
import { Who } from "./marks";
import type { Item } from "./types";
import { declareIncident, giveToCoding, tellFormAsks, why } from "./wire";

export type Sheetname = "decline" | "duplicate" | "snooze" | "owner" | null;

export function agentLabel(d: Data, item: Item): { label: string; kind: "coding" | "deps" | "lemma" } {
  const p = d.settings?.plugins || {};
  if (item.doors.includes("dependabot") && p.dependency_updates) return { label: "Give to Dependency updates", kind: "deps" };
  if (p.coding && item.kind !== "request") return { label: "Give to Coding agent", kind: "coding" };
  return { label: "Give to the Lemma", kind: "lemma" };
}

export function acceptLabel(d: Data, members: { user_id: string; name: string }[], item: Item): string {
  if (item.state === "marked_down" || item.state === "snoozed" || item.state === "declined") return "Bring back";
  if (item.state === "accepted") return "Accepted";
  const name = item.owner_name || nameOf(d, members, item.owner_user_id);
  return name ? `Accept and assign ${name.split(" ")[0]}` : "Accept";
}

/** What deciding does, said before it's done. */
export function afterLine(d: Data, item: Item): string {
  const asks = d.asksBy.get(item.id) || [];
  const where = [...new Set(asks.map((a) => ({ web: "the form's email", slack: "Slack", github: "GitHub", mail: "email", teams: "Teams", lemma: "the Lemma" } as Record<string, string>)[a.source] || a.source))];
  if (item.state === "marked_down") return item.marked_down_by === "lemma" ? "It comes back on its own if it changes." : "Marked down by a person: it stays down until someone brings it back.";
  if (item.looks_like && d.byId.get(item.looks_like)) {
    const o = d.byId.get(item.looks_like)!;
    return `Marking it a duplicate moves the ${asks.length} ${asks.length === 1 ? "person" : "people"} who asked onto T-${o.number}, and they are told when T-${o.number} is fixed.`;
  }
  const who = item.owner_name ? `, assigned to ${item.owner_name.split(" ")[0]}` : ", with no owner yet; Tasks shows it to whoever is on triage";
  const told = asks.length ? ` The ${asks.length} ${asks.length === 1 ? "person" : "people"} who reported it ${asks.length === 1 ? "is" : "are"} told when it is fixed, each where they wrote: ${where.join(", ")}.` : "";
  return `Accepting makes ${item.priority === "urgent" ? "an urgent" : `a ${item.priority}`} task in Tasks${who}.${told}`;
}

export function useDecide(item: Item | null, opts: { keys: boolean; onDone?: () => void }) {
  const d = useTriage();
  const { members } = useWho();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheetname>(null);
  const [busy, setBusy] = useState("");
  const ref = useRef(item);
  ref.current = item;

  const run = async (what: string, fn: () => Promise<string | void>) => {
    if (!ref.current) return;
    setBusy(what);
    try {
      const said = await fn();
      if (said) toast(said);
      await d.reload();
      opts.onDone?.();
    } catch (e) {
      toast(`Couldn't: ${why(e)}`);
    } finally {
      setBusy("");
    }
  };

  const accept = () => run("accept", async () => {
    const it = ref.current!;
    if (["marked_down", "snoozed", "declined"].includes(it.state)) {
      const out = await decide(it, "bring_back");
      return String(out.message || "Back in the inbox.");
    }
    if (it.state === "accepted") return "Already accepted.";
    const out = await decide(it, "accept", it.owner_user_id ? { user_id: it.owner_user_id, name: it.owner_name } : {});
    const taskId = String(out.task_id || "");
    if (taskId) toast(String(out.message || "Accepted."), { action: { label: "Open in Tasks", run: () => void openApp("tasks", `/t/${taskId}`) } });
    return undefined;
  });

  const agent = () => run("agent", async () => {
    const it = ref.current!;
    const a = agentLabel(d, it);
    if (a.kind === "lemma") {
      const out = await decide(it, "agent", { agent: "pod_default" });
      return String(out.message || "Given to the Lemma.");
    }
    const out = it.task_id ? { task_id: it.task_id } : await decide(it, "accept", it.owner_user_id ? { user_id: it.owner_user_id, name: it.owner_name } : {});
    if (a.kind === "coding") return giveToCoding(it, String(out.task_id));
    await decide(it, "record", { event_kind: "agent", text: "Handed to Dependency updates, which opens the bump as a pull request." });
    void openApp("dependencies", "/");
    return "Accepted; Dependency updates opens the bump.";
  });

  const declare = () => run("declare", async () => {
    const out = await declareIncident(ref.current!);
    if (out.number) void openApp("incidents", `/i/${out.number}`);
    return out.message;
  });

  useEffect(() => {
    if (!opts.keys) return;
    const on = (e: KeyboardEvent) => {
      if (!ref.current || typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".c-sheet")) return;
      const k = e.key.toLowerCase();
      if (k === "1") { e.preventDefault(); void accept(); }
      else if (k === "2") { e.preventDefault(); setSheet("decline"); }
      else if (k === "3") { e.preventDefault(); setSheet("duplicate"); }
      else if (k === "h") { e.preventDefault(); setSheet("snooze"); }
      else if (k === "a") { e.preventDefault(); setSheet("owner"); }
      else if (k === "g") { e.preventDefault(); void agent(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const sheets = item ? (
    <DecisionSheets item={item} which={sheet} close={() => setSheet(null)} after={() => { void d.reload(); opts.onDone?.(); }} />
  ) : null;
  return { d, members, sheet, setSheet, busy, accept, agent, declare, sheets };
}

export type Decider = ReturnType<typeof useDecide>;

/** The buttons, each with its key. Accept is the view's one accent. */
export function DecisionButtons({ item, x, full }: { item: Item; x: Decider; full?: boolean }) {
  const a = agentLabel(x.d, item);
  const open = item.state === "inbox" || item.state === "marked_down" || item.state === "snoozed";
  const accept = acceptLabel(x.d, x.members, item);
  return (
    <div className="tr-acts">
      {item.state !== "accepted" && item.state !== "done" && item.state !== "duplicate" ? (
        <Button variant="primary" icon={item.state === "inbox" ? Check : Undo2} busy={x.busy === "accept"} onClick={() => void x.accept()}>{accept} <Kbd>1</Kbd></Button>
      ) : null}
      {item.state !== "done" && item.state !== "duplicate" && item.state !== "declined" ? (
        <Button icon={Bot} busy={x.busy === "agent"} onClick={() => void x.agent()}>{a.label} <Kbd>G</Kbd></Button>
      ) : null}
      {full && x.d.settings?.plugins?.incidents && item.kind !== "request" && open ? (
        <Button icon={Flame} busy={x.busy === "declare"} onClick={() => void x.declare()}>Declare incident</Button>
      ) : null}
      {open ? <Button icon={X} onClick={() => x.setSheet("decline")}>Decline <Kbd>2</Kbd></Button> : null}
      {open ? <Button icon={Copy} onClick={() => x.setSheet("duplicate")}>{full ? "Duplicate of…" : "Duplicate"} <Kbd>3</Kbd></Button> : null}
      {item.state === "inbox" ? <Button icon={Clock} onClick={() => x.setSheet("snooze")}>Snooze <Kbd>H</Kbd></Button> : null}
      {full && item.state !== "done" ? <Button icon={UserRound} onClick={() => x.setSheet("owner")}>Owner <Kbd>A</Kbd></Button> : null}
    </div>
  );
}

function DecisionSheets({ item, which, close, after }: { item: Item; which: Sheetname; close: () => void; after: () => void }) {
  const d = useTriage();
  const { members } = useWho();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<string>("");
  useEffect(() => {
    setReason("");
    setPick(which === "duplicate" ? item.looks_like || "" : which === "owner" ? item.owner_user_id || "" : "");
  }, [which, item]);

  const go = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast(await fn());
      close();
      after();
    } catch (e) {
      toast(`Couldn't: ${why(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const candidates = useMemo(() => d.items.filter((i) => i.id !== item.id && ["inbox", "accepted", "snoozed", "marked_down"].includes(i.state)), [d.items, item.id]);
  const people = useMemo(() => {
    const list = members.length ? members.map((m) => ({ user_id: m.user_id, name: m.name })) : (d.settings?.people || []).map((p) => ({ user_id: p.user_id, name: p.name }));
    return list;
  }, [members, d.settings]);
  const asks = d.asksBy.get(item.id) || [];
  const formAsks = asks.filter((a) => a.source === "web" && a.state !== "told");

  if (which === "decline") {
    return (
      <Sheet open title={`Decline T-${item.number}`} onClose={close}
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="danger" busy={busy} disabled={!reason.trim()} onClick={() => void go(async () => {
            const out = await decide(item, "decline", { reason: reason.trim() });
            let said = String(out.message || "Declined.");
            if (formAsks.length) {
              const t = await tellFormAsks(item, formAsks, d.reportsBy.get(item.id) || [], `We've decided not to work on this: ${reason.trim()} Thanks for reporting it.`, "declined");
              if (t.told.length) said += ` Wrote to ${t.told.length} who used the form.`;
              if (t.left.length) said += ` Couldn't write to ${t.left.length}.`;
            }
            return said;
          })}>Decline and tell them</Button></>}>
        <Field label="Why" hint={asks.length ? `${asks.length} ${asks.length === 1 ? "person" : "people"} who asked ${asks.length === 1 ? "is" : "are"} told this, where they asked.` : "Kept on the item."}>
          <textarea className="c-textarea" rows={4} value={reason} autoFocus onChange={(e) => setReason(e.target.value)}
            placeholder="Works as designed: exports over 100,000 rows go by email." />
        </Field>
      </Sheet>
    );
  }
  if (which === "duplicate") {
    return (
      <Sheet open title={`T-${item.number} is a duplicate of…`} onClose={close}
        footer={<>
          {item.looks_like ? <Button variant="ghost" busy={busy} onClick={() => void go(async () => String((await decide(item, "refuse_duplicate")).message || "Kept apart."))}>Not the same</Button> : null}
          <Button variant="primary" busy={busy} disabled={!pick} onClick={() => void go(async () => String((await decide(item, "duplicate", { of: pick })).message || "Merged."))}>Mark duplicate</Button></>}>
        <p className="c-muted tr-small">Its reports and the {asks.length} {asks.length === 1 ? "person" : "people"} who asked move onto the original, and are told when it's fixed.</p>
        <div className="tr-picks" role="radiogroup" aria-label="Original">
          {candidates.slice(0, 40).map((c) => (
            <label key={c.id} className="tr-pick">
              <input type="radio" name="dup" checked={pick === c.id} onChange={() => setPick(c.id)} />
              <span className="tr-pick__tag">T-{c.number}</span>
              <span className="tr-pick__t">{c.title}</span>
              {item.looks_like === c.id ? <span className="c-faint tr-small">the Lemma's guess</span> : null}
            </label>
          ))}
        </div>
      </Sheet>
    );
  }
  if (which === "snooze") {
    const at = (days: number, hour = 9) => {
      const t = new Date();
      t.setDate(t.getDate() + days);
      t.setHours(hour, 0, 0, 0);
      return t.toISOString();
    };
    const monday = (() => { const t = new Date(); const add = ((8 - t.getDay()) % 7) || 7; return at(add); })();
    const choices: [string, string][] = [["Tomorrow morning", at(1)], ["Next Monday", monday], ["In a week", at(7)], ["In a month", at(30)]];
    return (
      <Sheet open title={`Snooze T-${item.number}`} onClose={close}>
        <p className="c-muted tr-small">It leaves the inbox and comes back then, or sooner if it gets worse.</p>
        <div className="tr-stack">
          {choices.map(([label, until]) => (
            <Button key={label} busy={busy} onClick={() => void go(async () => String((await decide(item, "snooze", { until })).message || "Snoozed."))}>{label}</Button>
          ))}
        </div>
      </Sheet>
    );
  }
  if (which === "owner") {
    const alts = item.alternatives || [];
    return (
      <Sheet open title={`Who owns T-${item.number}?`} onClose={close}
        footer={<Button variant="primary" busy={busy} disabled={!pick} onClick={() => void go(async () => {
          const p = people.find((x) => x.user_id === pick);
          return String((await decide(item, "owner", { user_id: pick, name: p?.name })).message || "Changed.");
        })}>Make them the owner</Button>}>
        {item.owner_name ? <p className="tr-small"><span className="c-muted">Suggested:</span> {item.owner_name} · {item.owner_reason}</p> : null}
        {alts.length ? <p className="tr-small c-muted">Also fits: {alts.map((a) => `${a.name} (${a.reason})`).join("; ")}</p> : null}
        <div className="tr-picks" role="radiogroup" aria-label="Owner">
          {people.map((p) => (
            <label key={p.user_id} className="tr-pick">
              <input type="radio" name="owner" checked={pick === p.user_id} onChange={() => setPick(p.user_id)} />
              <Who name={p.name} />
              <span className="tr-pick__t">{p.name}</span>
            </label>
          ))}
          {!people.length ? <p className="c-faint tr-small">{DEMO ? "In the demo the Lemma's members are made up." : "No members to pick from."}</p> : null}
        </div>
      </Sheet>
    );
  }
  return null;
}
