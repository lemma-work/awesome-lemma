// Days off: typed in Sprints, team-visible, no reason. Capacity is each
// person's usual times the share of the sprint's working days they are here.
// Reading out-of-office from calendars is not built (see the README).

import { useState } from "react";
import { X } from "lucide-react";
import { Button, Field, Sheet, useToast } from "@lemma-plugins/kit";
import { addAway, removeAway, useWho } from "./data";
import { WhoMark } from "./marks";
import { awayText, personKey, firstName, workingDays, type Capacity, type World } from "./model";
import type { Away, Sprint } from "./types";

export interface Person { key: string; user_id: string | null; name: string }

/** Everyone who can have days off or take work: members, and people known by name from past sprints. */
export function people(w: World, cap: Capacity | null, members: { user_id: string; name: string }[]): Person[] {
  const out = new Map<string, Person>();
  for (const m of members) out.set(personKey(m.user_id, m.name), { key: personKey(m.user_id, m.name), user_id: m.user_id, name: m.name });
  for (const p of cap?.people || []) if (!out.has(p.key)) out.set(p.key, { key: p.key, user_id: p.user_id || null, name: p.name });
  for (const a of w.away) {
    const key = personKey(a.member_id, a.name);
    if (!out.has(key)) out.set(key, { key, user_id: a.member_id, name: a.name });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function DaysOff({ w, sprint, cap }: { w: World; sprint: Sprint; cap: Capacity }) {
  const { members } = useWho();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const rows = w.away.filter((a) => a.day >= sprint.starts_on && a.day <= sprint.ends_on);
  const by = new Map<string, Away[]>();
  for (const a of rows) {
    const key = personKey(a.member_id, a.name);
    (by.get(key) || by.set(key, []).get(key)!).push(a);
  }
  return (
    <section className="sp-off">
      <div className="sp-sechead"><h2 className="sp-sec">Days off in Sprint {sprint.number}</h2><span className="c-grow" /><Button size="sm" onClick={() => setOpen(true)}>Add days off</Button></div>
      {by.size ? [...by.values()].map((list) => (
        <div key={list[0].id} className="sp-offrow">
          <WhoMark who={{ kind: "person", key: list[0].name, name: list[0].name }} />
          <span>{firstName(list[0].name)}</span>
          <span className="c-faint">{awayText(list.map((a) => a.day), true)}{list.some((a) => a.part === "half") ? " (half days count half)" : ""}</span>
          <span className="c-grow" />
          <Button size="sm" variant="ghost" icon={X} label={`Remove ${firstName(list[0].name)}'s days off`}
            onClick={() => void removeAway(list).catch((e) => toast(String(e)))} />
        </div>
      )) : <p className="c-faint">Nobody is off in this sprint.</p>}
      <p className="c-faint sp-small">Typed here; Sprints doesn't read anyone's calendar.</p>
      <AwaySheet open={open} onClose={() => setOpen(false)} sprint={sprint} options={people(w, cap, members)} have={w.away} />
    </section>
  );
}

function AwaySheet({ open, onClose, sprint, options, have }: { open: boolean; onClose: () => void; sprint: Sprint; options: Person[]; have: Away[] }) {
  const toast = useToast();
  const [who, setWho] = useState("");
  const [from, setFrom] = useState(sprint.starts_on);
  const [until, setUntil] = useState(sprint.starts_on);
  const [part, setPart] = useState<"full" | "half">("full");
  const [busy, setBusy] = useState(false);
  const person = options.find((o) => o.key === who);
  const days = from && until && until >= from ? workingDays(from, until) : [];
  const save = async () => {
    if (!person || !days.length) return;
    setBusy(true);
    try {
      await addAway(person, days, part, have);
      toast(`${firstName(person.name)}: ${days.length} working ${days.length === 1 ? "day" : "days"} off.`);
      onClose();
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Add days off"
      footer={<><Button variant="primary" busy={busy} disabled={!person || !days.length} onClick={() => void save()}>Save</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <Field label="Who">
        <select className="c-select" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Choose someone</option>
          {options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
        </select>
      </Field>
      <Field label="From"><input className="c-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="Until" hint={days.length ? `${days.length} working ${days.length === 1 ? "day" : "days"}; weekends don't count.` : "On or after the first day."}>
        <input className="c-input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
      </Field>
      <Field label="How long each day">
        <select className="c-select" value={part} onChange={(e) => setPart(e.target.value as "full" | "half")}>
          <option value="full">The whole day</option>
          <option value="half">Half the day</option>
        </select>
      </Field>
    </Sheet>
  );
}
