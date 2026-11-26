// A person's decisions on an answer, the same from the list (keys, swipes)
// and from the answer's page (buttons): set aside (S) and put back (U), not
// sure (N), pick a kind or an owner, re-route (R). Each goes through
// forms_decide, which writes the timeline line and a correction.

import { useCallback } from "react";
import { CircleHelp, Forward, Undo2 } from "lucide-react";
import { Menu, MenuItem, MenuLabel, useToast } from "@lemma-plugins/kit";
import { decide, useForms, useWho } from "./data";
import { KINDS, KIND_WORDS, firstOf } from "./marks";
import type { Answer, Kind } from "./types";
import { why } from "./wire";

export function useActions() {
  const d = useForms();
  const toast = useToast();
  const run = useCallback(async (a: Answer, action: string, extra: Record<string, unknown>, said: string, undo?: () => void) => {
    try {
      const out = await decide(a, action, extra);
      if (out.ok === false && out.message) toast(out.message);
      else toast(said || out.message || "Done.", undo ? { action: { label: "Undo", run: undo } } : undefined);
      await d.reload();
    } catch (e) {
      toast(`Couldn't change it: ${why(e)}`);
    }
  }, [d, toast]);
  const who = (a: Answer) => firstOf(a.name) || "it";
  return {
    setAside: (a: Answer, reason?: string) => a.state === "set_aside" ? Promise.resolve()
      : run(a, "set_aside", { why: reason || "a person set it aside as spam" }, `Set ${who(a)}'s answer aside. U puts it back.`,
        () => void run(a, "put_back", {}, "Put back.")),
    putBack: (a: Answer) => a.state !== "set_aside" ? Promise.resolve() : run(a, "put_back", {}, `Put ${who(a)}'s answer back.`),
    notSure: (a: Answer) => a.state === "unsure" ? Promise.resolve() : run(a, "unsure", {}, `Marked ${who(a)}'s answer not sure: it waits for a pick.`),
    pick: (a: Answer, kind: Kind) => kind === "spam"
      ? run(a, "set_aside", { why: "a person picked spam" }, `Set ${who(a)}'s answer aside.`)
      : run(a, "pick", { kind }, `Read as ${KIND_WORDS[kind].toLowerCase()} and sent on by your rules.`),
    reroute: (a: Answer, to: { owner_user_id?: string; owner_name?: string; plugin?: string }) =>
      run(a, a.state === "unsure" ? "pick" : "reroute", to, `Sent to ${to.owner_name || (to.plugin === "triage" ? "Triage" : to.plugin)}.`),
  };
}

/** Everyone an answer can go to: members (who opened Forms first), and Triage when it's here. */
export function useTargets() {
  const d = useForms();
  const { members, me } = useWho();
  const list = new Map<string, { id: string; name: string; opened: boolean }>();
  for (const m of d.settings?.members || []) list.set(m.user_id, { id: m.user_id, name: m.name, opened: Boolean(m.schedules?.take) });
  for (const m of members) if (!list.has(m.user_id)) list.set(m.user_id, { id: m.user_id, name: m.name, opened: false });
  if (me && !list.has(me.id)) list.set(me.id, { id: me.id, name: me.name, opened: false });
  return { people: [...list.values()], triage: Boolean(d.settings?.plugins?.triage), me };
}

export function RerouteMenu({ a, label = "Re-route", align = "left", up }: { a: Answer; label?: string; align?: "left" | "right"; up?: boolean }) {
  const x = useActions();
  const { people, triage, me } = useTargets();
  return (
    <Menu label={label} icon={Forward} title={label} align={align} up={up}>
      {(close) => (
        <>
          <MenuLabel>Send it to</MenuLabel>
          {people.filter((p) => p.id !== a.owner_user_id).map((p) => (
            <MenuItem key={p.id} hint={p.id === me?.id ? "you" : p.opened ? undefined : "hasn't opened Forms"} onSelect={() => { close(); void x.reroute(a, { owner_user_id: p.id, owner_name: p.name }); }}>
              {p.name}
            </MenuItem>
          ))}
          {triage && a.routed_to !== "triage" ? <MenuItem hint="files it as a bug" onSelect={() => { close(); void x.reroute(a, { plugin: "triage" }); }}>Triage</MenuItem> : null}
          {a.state !== "unsure" && a.state !== "set_aside" ? (
            <MenuItem icon={CircleHelp} hint="N" onSelect={() => { close(); void x.notSure(a); }}>Not sure</MenuItem>
          ) : null}
          {a.state === "set_aside" ? <MenuItem icon={Undo2} hint="U" onSelect={() => { close(); void x.putBack(a); }}>Put back</MenuItem> : null}
        </>
      )}
    </Menu>
  );
}

/** The kinds, as buttons: where a not-sure answer goes. */
export function KindPicker({ a }: { a: Answer }) {
  const x = useActions();
  return (
    <div className="fm-kinds" role="group" aria-label="What is it?">
      {KINDS.map((k) => (
        <button key={k} type="button" className="fm-kind" onClick={() => void x.pick(a, k)}>{KIND_WORDS[k]}</button>
      ))}
    </div>
  );
}
