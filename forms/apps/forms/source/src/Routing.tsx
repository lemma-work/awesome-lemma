// Routing: who gets what, in order. An open deal's owner always comes
// first and each form's default owner last; the team's own rules sit in
// between, each in one sentence: a kind, a form or who they are, to a
// member, members taking turns, or a plugin. Beside it, who's away today
// (turns skip them) and who hasn't opened Forms yet (answers wait for them).

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Field, Pill, Sheet, useToast } from "@lemma-plugins/kit";
import { useTargets } from "./actions";
import { call, nameOf, nowMs, useForms, useWho } from "./data";
import { Gap, KIND_WORDS, Who, firstOf } from "./marks";
import type { Kind, Rule } from "./types";
import { why } from "./wire";

const KINDS = (Object.keys(KIND_WORDS) as Kind[]).filter((k) => k !== "spam") as Exclude<Kind, "spam">[];

export function Routing() {
  const d = useForms();
  const { members } = useWho();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = new Date(nowMs(d)).toISOString().slice(0, 10);
  const away = d.away.filter((a) => String(a.day).slice(0, 10) === today);
  const opened = new Set((d.settings?.members || []).filter((m) => m.schedules?.take).map((m) => m.user_id));
  const notOpened = [...new Map([...members.map((m) => [m.user_id, m.name] as const), ...(d.settings?.members || []).map((m) => [m.user_id, m.name] as const)]).entries()]
    .filter(([id]) => !opened.has(id));
  const name = (id: string) => nameOf(d, members, id, "a member");
  const words = (r: Rule) => r.reason || describe(r, d.forms.find((f) => f.id === r.form_id)?.name, name);

  const saveAll = async (list: Rule[], said: string) => {
    setBusy(true);
    try {
      await call("forms_setup_save", { rules: list.map((r) => ({ id: r.id, form_id: r.form_id, kind: r.kind, describes: r.describes, to_kind: r.to_kind,
        members: r.members, plugin: r.plugin, reason: r.reason || describe(r, d.forms.find((f) => f.id === r.form_id)?.name, name), enabled: true })) });
      await d.reload();
      toast(said);
    } catch (e) {
      toast(`Couldn't save the rules: ${why(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const move = (i: number, step: number) => {
    const list = [...d.rules];
    const [r] = list.splice(i, 1);
    list.splice(i + step, 0, r);
    void saveAll(list, "Saved the order.");
  };

  return (
    <main className="c-body c-body--wide fm-routing">
      <section>
        <div className="fm-h2row">
          <h2 className="fm-h2">Who gets what<span className="fm-sub">the first rule that answers decides, in this order</span></h2>
          <Button icon={Plus} onClick={() => setAdding(true)}>Add a rule</Button>
        </div>
        <ol className="fm-ruletable">
          <li className="fm-rule fm-rule--fixed">
            <span className="fm-rule__n">1</span>
            <span className="fm-rule__x"><span>An open deal's owner</span><span className="fm-small fm-muted">When their company has an open deal in Deal tracker, its owner gets the answer.</span></span>
            <Pill>Always first</Pill>
          </li>
          {d.rules.map((r, i) => (
            <li key={r.id} className="fm-rule">
              <span className="fm-rule__n">{i + 2}</span>
              <span className="fm-rule__x">
                <span>{words(r)}</span>
                <span className="fm-small fm-muted">{[r.kind ? KIND_WORDS[r.kind] : "Any kind", r.form_id ? d.forms.find((f) => f.id === r.form_id)?.name : "any form", r.describes ? `who: ${r.describes}` : null]
                  .filter(Boolean).join(" · ")} → {r.to_kind === "plugin" ? (r.plugin === "triage" ? "Triage" : r.plugin) : r.members.map(name).join(" and ") + (r.to_kind === "turns" ? ", in turns" : "")}</span>
                {r.to_kind === "plugin" && r.plugin === "triage" && !d.settings?.plugins?.triage ? <Gap>Triage isn't installed: this rule is skipped</Gap> : null}
              </span>
              <span className="fm-acts">
                <Button size="sm" variant="ghost" icon={ArrowUp} label="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" icon={ArrowDown} label="Move down" disabled={busy || i === d.rules.length - 1} onClick={() => move(i, 1)} />
                <Button size="sm" variant="ghost" icon={Trash2} label="Remove" disabled={busy} onClick={() => void saveAll(d.rules.filter((x) => x.id !== r.id), "Removed the rule.")} />
              </span>
            </li>
          ))}
          <li className="fm-rule fm-rule--fixed">
            <span className="fm-rule__n">{d.rules.length + 2}</span>
            <span className="fm-rule__x"><span>Each form's default owner</span><span className="fm-small fm-muted">{d.forms.filter((f) => f.owner_plugin === "forms" && f.default_owner_user_id).map((f) => `${f.name}: ${firstOf(name(f.default_owner_user_id!))}`).join(" · ") || "Set on each door."}</span></span>
            <Pill>Always last</Pill>
          </li>
        </ol>
        <p className="fm-small fm-muted fm-gapline">Spam is set aside before any rule, never deleted. Not sure waits for a pick for {d.settings?.unsure_after_minutes || 60} minutes, then goes to the form's default owner, still marked not sure.</p>
      </section>
      <div className="fm-two">
        <section>
          <h2 className="fm-h2">Away today<span className="fm-sub">turns skip them</span></h2>
          {away.length ? <ul className="fm-people">{away.map((a) => <li key={a.id} className="fm-who"><Who name={a.name} />{a.name}{a.part === "half" ? <span className="fm-faint"> · half the day</span> : null}</li>)}</ul>
            : <p className="fm-small fm-muted">Nobody.</p>}
        </section>
        <section>
          <h2 className="fm-h2">Hasn't opened Forms yet<span className="fm-sub">their answers wait here, visible to everyone</span></h2>
          {notOpened.length ? <ul className="fm-people">{notOpened.map(([id, n]) => <li key={id} className="fm-who"><Who name={n} />{n}</li>)}</ul>
            : <p className="fm-small fm-muted">Everyone has.</p>}
          {notOpened.length ? <Gap>Someone who hasn't opened Forms gets nothing in their space or Today</Gap> : null}
        </section>
      </div>
      <AddRule open={adding} onClose={() => setAdding(false)} onSave={(r) => saveAll([...d.rules, r], "Added the rule.")} />
    </main>
  );
}

export function describe(r: Pick<Rule, "kind" | "describes" | "to_kind" | "members" | "plugin">, form: string | undefined, name: (id: string) => string): string {
  const what = [r.kind ? `${KIND_WORDS[r.kind]}s` : "", r.describes || ""].filter(Boolean).join(" from ") || "Everything";
  const from = form ? ` from ${form}` : "";
  if (r.to_kind === "plugin") return `${what}${from} go to ${r.plugin === "triage" ? "Triage" : r.plugin}`;
  const names = r.members.map((m) => firstOf(name(m)));
  if (r.to_kind === "turns") return `${what}${from}: ${names.join(" and ")} take turns`;
  return `${what}${from} go to ${names[0] || "nobody"}`;
}

function AddRule({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (r: Rule) => Promise<void> }) {
  const d = useForms();
  const { people, triage } = useTargets();
  const [kind, setKind] = useState("");
  const [form, setForm] = useState("");
  const [who, setWho] = useState("");
  const [toKind, setToKind] = useState<Rule["to_kind"]>("member");
  const [picked, setPicked] = useState<string[]>([]);
  const ok = toKind === "plugin" || picked.length > 0;
  return (
    <Sheet open={open} title="Add a rule" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ok} onClick={async () => {
          await onSave({ id: "", position: d.rules.length, form_id: form || null, kind: (kind || null) as Rule["kind"], describes: who.trim() || null,
            to_kind: toKind, members: toKind === "plugin" ? [] : picked, next_turn: 0, plugin: toKind === "plugin" ? "triage" : null, reason: null, enabled: true, sample: false });
          setKind(""); setForm(""); setWho(""); setPicked([]); onClose();
        }}>Add it</Button>
      </>
    }>
      <div className="fm-stack fm-gap16">
        <Field label="Which answers">
          <select className="c-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Any kind</option>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}s</option>)}
          </select>
        </Field>
        <Field label="From which form">
          <select className="c-input" value={form} onChange={(e) => setForm(e.target.value)}>
            <option value="">Any form</option>
            {d.forms.filter((f) => f.owner_plugin === "forms").map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Who they are, in a sentence (optional)" hint="The Lemma matches it when it reads each answer: “architects and lighting designers”.">
          <input className="c-input" value={who} onChange={(e) => setWho(e.target.value)} />
        </Field>
        <Field label="Goes to">
          <select className="c-input" value={toKind} onChange={(e) => setToKind(e.target.value as Rule["to_kind"])}>
            <option value="member">One person</option>
            <option value="turns">People taking turns</option>
            {triage ? <option value="plugin">Triage</option> : null}
          </select>
        </Field>
        {toKind !== "plugin" ? (
          <div className="fm-picks">
            {people.map((p) => (
              <label key={p.id} className="fm-pick">
                <input type={toKind === "turns" ? "checkbox" : "radio"} name="rule-who" checked={picked.includes(p.id)}
                  onChange={(e) => setPicked(toKind === "turns" ? (e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id)) : [p.id])} />
                <span>{p.name}</span>{p.opened ? null : <span className="fm-faint fm-small">hasn't opened Forms</span>}
              </label>
            ))}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
