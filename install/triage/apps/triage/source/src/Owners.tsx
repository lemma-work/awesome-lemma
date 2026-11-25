// Owners: the routing and mark-down rules in order, who's on triage (a week
// each, in order), who's away, and how members appear on GitHub and Slack,
// so CODEOWNERS and the last change to a line name a member.

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, DEMO, Empty, Field, Pill, Sheet, Switch, client, create, runFunction, update, useToast } from "@lemma-plugins/kit";
import { nameOf, nowMs, onTriage, useTriage, useWho } from "./data";
import { Gap, Who } from "./marks";
import type { Rule } from "./types";
import { why } from "./wire";

const DOOR_OPTIONS = ["", "app", "assistant", "slack", "github", "form", "sentry", "posthog", "dependabot", "code_scanning", "secret_scanning"];

function matchWords(m: Rule["match"]): string {
  const bits: string[] = [];
  if (m.path) bits.push(`files ${m.path}`);
  if (m.repo) bits.push(`in ${m.repo}`);
  if (m.label) bits.push(`labelled ${m.label}`);
  if (m.door) bits.push(`from ${m.door.replace("_", " ")}`);
  if (m.kind) bits.push(`kind ${m.kind}`);
  if (m.text) bits.push(`saying “${m.text}”`);
  return bits.join(", ") || "anything";
}

export function Owners() {
  const d = useTriage();
  const { members } = useWho();
  const toast = useToast();
  const s = d.settings;
  const now = nowMs(d);
  const [editing, setEditing] = useState<Rule | "new-route" | "new-down" | null>(null);
  const [awayOpen, setAwayOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const people = useMemo(() => {
    const byId = new Map<string, { user_id: string; name: string; github?: string | null; slack?: string | null; email?: string | null }>();
    for (const p of s?.people || []) byId.set(p.user_id, { ...p });
    for (const m of members) byId.set(m.user_id, { ...(byId.get(m.user_id) || {}), user_id: m.user_id, name: m.name, email: m.email });
    return [...byId.values()];
  }, [s, members]);
  if (!s) return null;
  const rotation = s.rotation;
  const extra = s.sprints_away?.days || [];
  const duty = onTriage(s, d.away, extra, new Date(now));
  const today = new Date(now).toISOString().slice(0, 10);
  const awayRows = [...d.away.map((a) => ({ ...a, from: "Triage" })), ...extra.map((a, i) => ({ id: `s${i}`, member_id: a.member_id || null, name: a.name, day: a.day, part: a.part as "full" | "half", from: "Sprints" }))]
    .filter((a) => String(a.day).slice(0, 10) >= today).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const stretches: { key: string; name: string; from: string; to: string; part: string; source: string; member_id: string | null }[] = [];
  for (const a of awayRows) {
    const last = stretches[stretches.length - 1];
    const day = String(a.day).slice(0, 10);
    const next = last ? new Date(Date.parse(`${last.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : "";
    if (last && last.name === a.name && last.source === a.from && last.part === a.part && day === next) last.to = day;
    else stretches.push({ key: `${a.name}${day}${a.from}`, name: a.name, from: day, to: day, part: a.part, source: a.from, member_id: a.member_id || null });
  }

  const save = async (patch: Record<string, unknown>, said = "Saved.") => {
    if (DEMO) { toast("In the demo the set-up isn't saved."); return; }
    setBusy("save");
    try { await runFunction("triage_setup_save", patch); toast(said); await d.reload(); }
    catch (e) { toast(`Couldn't save: ${why(e)}`); } finally { setBusy(""); }
  };
  const move = (list: string[], i: number, step: number) => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + step)), 0, x);
    return next;
  };
  const rules = d.rules;
  const routes = rules.filter((r) => r.kind === "route");
  const downs = rules.filter((r) => r.kind === "mark_down");
  const reorder = async (list: Rule[], i: number, step: number) => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + step)), 0, x);
    try { await Promise.all(next.map((r, n) => update("triage_rule", r.id, { position: n + 1 }))); await d.reload(); }
    catch (e) { toast(`Couldn't: ${why(e)}`); }
  };

  const ruleList = (list: Rule[], kind: "route" | "mark_down") => (
    <div className="tr-rules">
      {list.length ? list.map((r, i) => (
        <div key={r.id} className="tr-rule">
          <span className="tr-faint tr-num">{i + 1}</span>
          <div className="tr-rule__x">
            <div>{kind === "route" ? <>When {matchWords(r.match)}: <span className="tr-strong">{r.owner_name || nameOf(d, members, r.owner_user_id) || "nobody"}</span></> : <>Mark down {matchWords(r.match)}</>}</div>
            {r.reason ? <div className="tr-small tr-muted">Said beside it: {r.reason}</div> : null}
          </div>
          {!r.enabled ? <Pill>Off</Pill> : null}
          <span className="tr-row-inline">
            <Button size="sm" variant="ghost" icon={ArrowUp} label="Earlier" disabled={i === 0} onClick={() => void reorder(list, i, -1)} />
            <Button size="sm" variant="ghost" icon={ArrowDown} label="Later" disabled={i === list.length - 1} onClick={() => void reorder(list, i, 1)} />
            <Button size="sm" onClick={() => setEditing(r)}>Edit</Button>
          </span>
        </div>
      )) : <p className="tr-faint tr-small">{kind === "route" ? "No routing rules: CODEOWNERS, the last change to the line, then whoever is on triage." : "No rules of your own. The Lemma still marks down one person in a loop and development-only dependencies."}</p>}
    </div>
  );

  return (
    <main className="c-body tr-owners">
      <section>
        <div className="tr-h2row"><h2 className="tr-h2">Routing<span className="tr-sub">tried in order, before CODEOWNERS, the last change and the rotation</span></h2>
          <Button size="sm" icon={Plus} onClick={() => setEditing("new-route")}>Add a rule</Button></div>
        {ruleList(routes, "route")}
      </section>
      <section>
        <div className="tr-h2row"><h2 className="tr-h2">Mark down<span className="tr-sub">set aside with the reason; back if it changes</span></h2>
          <Button size="sm" icon={Plus} onClick={() => setEditing("new-down")}>Add a rule</Button></div>
        {ruleList(downs, "mark_down")}
      </section>
      <section>
        <h2 className="tr-h2">Who's on triage<span className="tr-sub">a week each, in this order{s.rotation_start ? `, from ${s.rotation_start}` : ""}</span></h2>
        <div className="tr-rules">
          {rotation.map((id, i) => (
            <div key={id} className="tr-rule">
              <span className="tr-faint tr-num">{i + 1}</span>
              <span className="tr-who"><Who name={nameOf(d, members, id)} />{nameOf(d, members, id)}</span>
              {duty === id ? <Pill tone="info">This week</Pill> : null}
              <span className="tr-fill" />
              <span className="tr-row-inline">
                <Button size="sm" variant="ghost" icon={ArrowUp} label="Earlier" disabled={i === 0} onClick={() => void save({ rotation: move(rotation, i, -1) })} />
                <Button size="sm" variant="ghost" icon={ArrowDown} label="Later" disabled={i === rotation.length - 1} onClick={() => void save({ rotation: move(rotation, i, 1) })} />
                <Button size="sm" variant="ghost" icon={Trash2} label="Take off the rotation" onClick={() => void save({ rotation: rotation.filter((x) => x !== id) })} />
              </span>
            </div>
          ))}
          {!rotation.length ? <p className="tr-faint tr-small">Nobody yet. Urgent items then go to their suggested owner.</p> : null}
        </div>
        <div className="tr-row-inline tr-gapline">
          <select className="c-select" aria-label="Add someone to the rotation" value="" onChange={(e) => e.target.value && void save({ rotation: [...rotation, e.target.value] })}>
            <option value="">Add someone…</option>
            {people.filter((p) => !rotation.includes(p.user_id)).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
          <Gap>Set by hand: no on-call source (PagerDuty, Opsgenie) is connected</Gap>
        </div>
      </section>
      <section>
        <div className="tr-h2row"><h2 className="tr-h2">Away<span className="tr-sub">skipped on the rotation; shared with Sprints</span></h2>
          <Button size="sm" icon={Plus} onClick={() => setAwayOpen(true)}>Someone's away</Button></div>
        {stretches.length ? (
          <div className="tr-rules">
            {stretches.map((a) => (
              <div key={a.key} className="tr-rule">
                <span className="tr-who"><Who name={a.name} />{a.name}</span>
                <span className="tr-muted">{a.from === a.to ? a.from : `${a.from} to ${a.to}`}{a.part === "half" ? " · half days" : ""}</span>
                <span className="tr-fill" />
                {a.source === "Sprints" ? <span className="tr-faint tr-small">from Sprints</span> : (
                  <Button size="sm" variant="ghost" icon={Trash2} label="Not away" busy={busy === a.key} onClick={async () => {
                    setBusy(a.key);
                    try { await runFunction("triage_away", { member_id: a.member_id, name: a.name, start: a.from, end: a.to, clear: true }); await d.reload(); }
                    catch (e) { toast(`Couldn't: ${why(e)}`); } finally { setBusy(""); }
                  }} />
                )}
              </div>
            ))}
          </div>
        ) : <Empty title="Nobody is away">Add a stretch away; each day is kept, and the rotation skips them.</Empty>}
      </section>
      <section>
        <h2 className="tr-h2">On GitHub and Slack<span className="tr-sub">so CODEOWNERS and a commit's author name a member</span></h2>
        <Handles people={people} onSave={(list) => void save({ people: list })} />
      </section>
      <RuleSheet rule={editing} onClose={() => setEditing(null)} people={people} />
      <AwaySheet open={awayOpen} people={people} onClose={() => setAwayOpen(false)} />
    </main>
  );
}

function Handles({ people, onSave }: { people: { user_id: string; name: string; github?: string | null; slack?: string | null; email?: string | null }[]; onSave: (list: unknown[]) => void }) {
  const [draft, setDraft] = useState<Record<string, { github: string; slack: string }>>({});
  const value = (id: string, k: "github" | "slack", fallback?: string | null) => draft[id]?.[k] ?? fallback ?? "";
  return (
    <div className="tr-handles">
      <div className="tr-handle tr-handle--th"><span>Member</span><span>GitHub login</span><span>Slack user id</span></div>
      {people.map((p) => (
        <div key={p.user_id} className="tr-handle">
          <span className="tr-who"><Who name={p.name} />{p.name}</span>
          <input className="c-input" aria-label={`${p.name} on GitHub`} value={value(p.user_id, "github", p.github)} placeholder="login"
            onChange={(e) => setDraft((x) => ({ ...x, [p.user_id]: { github: e.target.value, slack: value(p.user_id, "slack", p.slack) } }))} />
          <input className="c-input" aria-label={`${p.name} on Slack`} value={value(p.user_id, "slack", p.slack)} placeholder="U0123ABC"
            onChange={(e) => setDraft((x) => ({ ...x, [p.user_id]: { slack: e.target.value, github: value(p.user_id, "github", p.github) } }))} />
        </div>
      ))}
      <div><Button size="sm" disabled={!Object.keys(draft).length} onClick={() => {
        onSave(people.map((p) => ({ user_id: p.user_id, name: p.name, email: p.email || null, github: (draft[p.user_id]?.github ?? p.github ?? "").replace(/^@/, "") || null, slack: draft[p.user_id]?.slack ?? p.slack ?? null })));
        setDraft({});
      }}>Save handles</Button></div>
    </div>
  );
}

function RuleSheet({ rule, onClose, people }: { rule: Rule | "new-route" | "new-down" | null; onClose: () => void; people: { user_id: string; name: string }[] }) {
  const d = useTriage();
  const toast = useToast();
  const existing = typeof rule === "object" && rule ? rule : null;
  const kind = existing ? existing.kind : rule === "new-down" ? "mark_down" : "route";
  const [m, setM] = useState<Rule["match"]>({});
  const [owner, setOwner] = useState("");
  const [reason, setReason] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<unknown>(null);
  if (rule !== seen) {
    setSeen(rule);
    setM(existing?.match || {});
    setOwner(existing?.owner_user_id || "");
    setReason(existing?.reason || "");
    setEnabled(existing ? existing.enabled : true);
  }
  if (!rule) return null;
  const set = (k: keyof Rule["match"], v: string) => setM((x) => ({ ...x, [k]: v || undefined }));
  const save = async () => {
    setBusy(true);
    try {
      const match = Object.fromEntries(Object.entries(m).filter(([, v]) => v));
      const owner_name = people.find((p) => p.user_id === owner)?.name || null;
      const row = { kind, match, owner_user_id: kind === "route" ? owner || null : null, owner_name: kind === "route" ? owner_name : null, reason: reason || null, enabled };
      if (existing) await update("triage_rule", existing.id, row);
      else await create("triage_rule", { ...row, position: d.rules.filter((r) => r.kind === kind).length + 1 });
      await d.reload();
      onClose();
    } catch (e) {
      toast(`Couldn't save: ${why(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open title={kind === "route" ? "Routing rule" : "Mark-down rule"} onClose={onClose}
      footer={<>{existing ? <Button variant="danger" busy={busy} onClick={async () => { setBusy(true); try { await client.records.delete("triage_rule", existing.id); await d.reload(); onClose(); } catch (e) { toast(`Couldn't: ${why(e)}`); } finally { setBusy(false); } }}>Delete</Button> : null}
        <Button variant="primary" busy={busy} disabled={!Object.values(m).some(Boolean) || (kind === "route" && !owner)} onClick={() => void save()}>Save</Button></>}>
      <p className="tr-small tr-muted">Everything you fill in must match.</p>
      <Field label="Files" hint="A glob, as in CODEOWNERS: web/checkout/**"><input className="c-input" value={m.path || ""} onChange={(e) => set("path", e.target.value)} /></Field>
      <Field label="Repository"><input className="c-input" value={m.repo || ""} onChange={(e) => set("repo", e.target.value)} placeholder="acme/web" /></Field>
      <Field label="Words in the report"><input className="c-input" value={m.text || ""} onChange={(e) => set("text", e.target.value)} /></Field>
      <Field label="Label (GitHub)"><input className="c-input" value={m.label || ""} onChange={(e) => set("label", e.target.value)} /></Field>
      <Field label="Door">
        <select className="c-select" value={m.door || ""} onChange={(e) => set("door", e.target.value)}>
          {DOOR_OPTIONS.map((o) => <option key={o} value={o}>{o ? o.replace("_", " ") : "Any"}</option>)}
        </select>
      </Field>
      {kind === "route" ? (
        <Field label="Owner">
          <select className="c-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Pick someone…</option>
            {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
        </Field>
      ) : null}
      <Field label="Said beside it" hint={kind === "route" ? "Why them: “owns checkout”" : "Why it's set aside: “a harmless browser warning”"}><input className="c-input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <Switch checked={enabled} onChange={setEnabled} label="On" />
    </Sheet>
  );
}

function AwaySheet({ open, people, onClose }: { open: boolean; people: { user_id: string; name: string }[]; onClose: () => void }) {
  const d = useTriage();
  const toast = useToast();
  const [who, setWho] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [half, setHalf] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} title="Someone's away" onClose={onClose}
      footer={<Button variant="primary" busy={busy} disabled={!who || !start} onClick={async () => {
        setBusy(true);
        try {
          const p = people.find((x) => x.user_id === who);
          const out = await runFunction<{ message?: string }>("triage_away", { member_id: who, name: p?.name || "Someone", start, end: end || start, part: half ? "half" : "full" });
          toast(out?.message || "Saved.");
          await d.reload();
          onClose();
        } catch (e) {
          toast(`Couldn't: ${why(e)}`);
        } finally {
          setBusy(false);
        }
      }}>Save</Button>}>
      <Field label="Who">
        <select className="c-select" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Pick someone…</option>
          {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="From"><input className="c-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      <Field label="Until (the last day away)"><input className="c-input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      <Switch checked={half} onChange={setHalf} label="Half days" />
      <p className="tr-small tr-muted">Kept one day per row in the shared away table, which Sprints reads too.</p>
    </Sheet>
  );
}
