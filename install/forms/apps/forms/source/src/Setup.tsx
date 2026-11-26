// Set-up, once, by whoever opens Forms first: they become the person who
// holds the forms open. Every step but the first is optional, and each is
// read back when it's done. "Look around with a sample week" is on every
// step. Re-running it later changes only what's changed.
//   1 Where do people fill in forms for you?   2 Your website
//   3 Google Forms   4 Meta lead ads   5 Another form tool
//   6 Who gets what   7 How fast

import { useEffect, useMemo, useState } from "react";
import { Check, FileInput, FlaskConical, X } from "lucide-react";
import { Button, Connect, DEMO, Field, Pill, Switch, cx, runFunction, useToast } from "@lemma-plugins/kit";
import { useTargets } from "./actions";
import { call, useForms, useWho } from "./data";
import { Gap, Hook, KIND_WORDS, MODE_WORDS } from "./marks";
import { to } from "./route";
import type { Kind, ReplyMode } from "./types";
import { STARTERS, detectPlugins, ensureMine, ensurePoll, googleFormId, turnOnForm, why, type Step } from "./wire";

type Door = "website" | "google" | "meta" | "tool" | "plugin";
const DOORS: { id: Door; label: string; hint: string }[] = [
  { id: "website", label: "Your website", hint: "A contact form, a demo request, careers, a beta list" },
  { id: "google", label: "Google Forms", hint: "Forms you already made there" },
  { id: "meta", label: "Meta lead ads", hint: "Facebook and Instagram lead forms" },
  { id: "tool", label: "Another form tool", hint: "Typeform, Tally, Webflow, Fillout, Google Ads, LinkedIn through Zapier" },
  { id: "plugin", label: "A plugin's form", hint: "Triage's report form, counted here and kept there" },
];
const WAYS = [{ id: "link", label: "A link" }, { id: "page", label: "On your page" }, { id: "product", label: "In your product" }];
const KINDS = (Object.keys(KIND_WORDS) as Kind[]).filter((k) => k !== "spam");

export function Setup() {
  const d = useForms();
  const { me } = useWho();
  const { people } = useTargets();
  const toast = useToast();
  const s = d.settings;
  const first = !s?.setup_done_at;
  const [doors, setDoors] = useState<Door[]>(["website"]);
  const [on, setOn] = useState<Record<string, boolean>>({ forms_contact: true });
  const [ways, setWays] = useState<Record<string, string>>({});
  const [links, setLinks] = useState("");
  const [owner, setOwner] = useState("");
  const [bugs, setBugs] = useState(true);
  const [ruleKind, setRuleKind] = useState("");
  const [ruleWho, setRuleWho] = useState("");
  const [mode, setMode] = useState<ReplyMode>("draft");
  const [busy, setBusy] = useState("");
  const [said, setSaid] = useState<Step[]>([]);
  const [triage, setTriage] = useState(Boolean(s?.plugins?.triage));

  useEffect(() => { void detectPlugins(s).then((p) => setTriage(Boolean(p.triage))); }, [s]);
  useEffect(() => {
    if (!s) return;
    if (s.doors_wanted.length) setDoors(s.doors_wanted as Door[]);
    const state: Record<string, boolean> = {};
    for (const st of STARTERS) state[st.table] = d.forms.find((f) => f.source_id === st.table)?.state === "on";
    if (Object.values(state).some(Boolean)) setOn(state);
    if (s.steward_user_id) setOwner(s.steward_user_id);
  }, [s, d.forms]);
  useEffect(() => { if (!owner && me) setOwner(me.id); }, [me, owner]);
  const tick = (id: Door) => setDoors((xs) => xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);
  const googleIds = useMemo(() => links.split(/\s+/).map(googleFormId).filter((x): x is string => !!x), [links]);
  const badLinks = links.split(/\s+/).filter((l) => l.trim() && !googleFormId(l)).length;

  const sample = async () => {
    setBusy("sample");
    try {
      const out = await runFunction<{ message?: string }>("forms_sample_data", { mode: "load" });
      toast(out?.message || "Loaded the sample week.");
      await d.reload();
      to.answers();
    } catch (e) {
      toast(`Couldn't load the sample: ${why(e)}`);
    } finally {
      setBusy("");
    }
  };
  const Sample = () => <Button variant="ghost" size="sm" icon={FlaskConical} busy={busy === "sample"} onClick={() => void sample()}>Look around with a sample week</Button>;

  const finish = async () => {
    if (!me) return;
    setBusy("save");
    const steps: Step[] = [];
    const say = (x: Step) => { steps.push(x); setSaid([...steps]); };
    try {
      await call("forms_setup_save", { steward_user_id: s?.steward_user_id || me.id, doors_wanted: doors });
      if (doors.includes("website")) {
        for (const st of STARTERS) {
          const f = d.forms.find((x) => x.source_id === st.table);
          if (on[st.table] && f?.state !== "on") {
            const ok = await turnOnForm(st.table, me.id, "anyone", [ways[st.table] || "link"], [], (x) => say({ ...x, said: `${st.name}: ${x.said}` }));
            if (ok) await call("forms_door_save", { source: "web", source_id: st.table, reply_mode: mode, default_owner_user_id: owner || me.id });
          } else if (f) {
            await call("forms_door_save", { source: "web", source_id: st.table, reply_mode: mode, default_owner_user_id: f.default_owner_user_id || owner || me.id });
          }
        }
      }
      if (doors.includes("google") && googleIds.length) {
        for (const id of googleIds) await call("forms_door_save", { source: "google_forms", source_id: id, name: "Google Form", state: "on", held_by_user_id: me.id, default_owner_user_id: owner || me.id, reply_mode: mode, place: `Google Forms · ${me.email || me.name}` });
        await ensurePoll(me);
        say({ step: "google", ok: true, said: `${googleIds.length} Google ${googleIds.length === 1 ? "Form is" : "Forms are"} read every 15 minutes from your account.` });
      }
      const rules = [];
      if (bugs && triage) rules.push({ kind: "bug", to_kind: "plugin", plugin: "triage", reason: "Bugs go to Triage", members: [] });
      if (ruleKind && ruleWho) rules.push({ kind: ruleKind, to_kind: "member", members: [ruleWho], reason: `${KIND_WORDS[ruleKind as Kind]}s go to ${people.find((p) => p.id === ruleWho)?.name.split(" ")[0] || "them"}` });
      if (first || rules.length) await call("forms_setup_save", { rules: first ? rules : [...d.rules.map((r) => ({ ...r })), ...rules] });
      say({ step: "rules", ok: true, said: `An open deal's owner first${rules.length ? `, then ${rules.map((r) => r.reason).join(", then ")}` : ""}, then the form's default owner.` });
      const problems = await ensureMine(s, me);
      say({ step: "mine", ok: !problems.length, said: problems.length ? `Your own schedules: ${problems.join("; ")}` : "Answers sent to you reach your space and your Today." });
      const out = await call("forms_setup_save", { done: true });
      say({ step: "done", ok: true, said: out.message || "Set up." });
      await d.reload();
      if (steps.every((x) => x.ok)) to.answers();
    } catch (e) {
      say({ step: "error", ok: false, said: why(e) });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="c-app fm-app">
      <header className="fm-top">
        <span className="fm-top__name"><FileInput aria-hidden="true" />Forms</span>
        <span className="fm-top__fill" />
        {!first ? <Button variant="ghost" onClick={() => to.answers()}>Back to answers</Button> : null}
      </header>
      <main className="c-body fm-setup">
        <div className="fm-setup__lead">
          <h1 className="fm-title">{first ? "Every answer to every form, sent to whoever should reply" : "Set-up"}</h1>
          <p className="fm-muted">Forms reads each answer, sends it to one person, and drafts their reply in their own mailbox. Nothing goes out until they press Send.{first ? " You'll hold the forms open for the team." : ""}</p>
          {first ? <div><Sample /></div> : null}
        </div>
        <ol className="fm-steps">
          <li>
            <h2 className="fm-h2"><span className="fm-stepn">1</span>Where do people fill in forms for you?</h2>
            <div className="fm-ticks">
              {DOORS.map((x) => (
                <label key={x.id} className={cx("fm-tick", doors.includes(x.id) && "fm-tick--on")}>
                  <input type="checkbox" checked={doors.includes(x.id)} onChange={() => tick(x.id)} />
                  <span className="fm-stack"><span>{x.label}</span><span className="fm-small fm-muted">{x.hint}</span></span>
                </label>
              ))}
            </div>
          </li>
          {doors.includes("website") ? (
            <li>
              <h2 className="fm-h2"><span className="fm-stepn">2</span>Your website<span className="fm-sub">start with a contact form</span></h2>
              <div className="fm-starters">
                {STARTERS.map((st) => {
                  const f = d.forms.find((x) => x.source_id === st.table);
                  return (
                    <div key={st.table} className="fm-starter">
                      <Switch label={st.name} checked={Boolean(on[st.table])} disabled={f?.state === "on"} onChange={(v) => setOn({ ...on, [st.table]: v })} />
                      <span className="fm-stack fm-grow"><span>{st.name}{f?.state === "on" ? <Pill tone="success">Taking answers</Pill> : null}</span>{st.note ? <span className="fm-small fm-muted">{st.note}</span> : null}</span>
                      <select className="c-input fm-select" aria-label={`How to share ${st.name}`} value={ways[st.table] || "link"} onChange={(e) => setWays({ ...ways, [st.table]: e.target.value })}>
                        {WAYS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
              <p className="fm-small fm-muted">Turning a form on opens its table to people outside the Lemma, makes the Lemma's web widget (the form, with the Lemma's chat beside it), and files each answer as it arrives. Each is read back.</p>
              <Gap>The link shows the table's name: no title, intro or thank-you yet</Gap>
            </li>
          ) : null}
          {doors.includes("google") ? (
            <li>
              <h2 className="fm-h2"><span className="fm-stepn">3</span>Google Forms<span className="fm-sub">read every 15 minutes</span></h2>
              <Connect connector="googleforms" mode="per_member" purpose="Reads new answers to the Google Forms you add, every 15 minutes." />
              <Field label="Each form's edit link, one a line" hint="Open the form in Google Forms and copy the address: it ends in /edit. The link people fill in carries a different id, and Google has no list of your forms to pick from.">
                <textarea className="c-input c-textarea" rows={3} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://docs.google.com/forms/d/…/edit" />
              </Field>
              {googleIds.length ? <p className="fm-small">{googleIds.length} {googleIds.length === 1 ? "form" : "forms"} to add.</p> : null}
              {badLinks ? <p className="fm-small fm-bad">{badLinks} {badLinks === 1 ? "line isn't" : "lines aren't"} an edit link.</p> : null}
            </li>
          ) : null}
          {doors.includes("meta") ? (
            <li>
              <h2 className="fm-h2"><span className="fm-stepn">4</span>Meta lead ads</h2>
              <p className="fm-small fm-muted">Leads from your page's lead forms, read every 15 minutes.</p>
              <Gap>Coming soon: reading Meta leads isn't checked against a live account yet</Gap>
            </li>
          ) : null}
          {doors.includes("tool") ? (
            <li>
              <h2 className="fm-h2"><span className="fm-stepn">5</span>Another form tool</h2>
              <p className="fm-small fm-muted">Typeform, Tally, Webflow, Fillout, Google Ads lead forms, and LinkedIn through Zapier or Make post each answer to your Lemma's own address.</p>
              <Hook>Coming soon: the webhook address isn't live in this Lemma yet</Hook>
            </li>
          ) : null}
          <li>
            <h2 className="fm-h2"><span className="fm-stepn">6</span>Who gets what<span className="fm-sub">skip it and everything goes to the default owner</span></h2>
            <Field label="Default owner" hint="Who gets an answer no rule answers for.">
              <select className="c-input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === me?.id ? " (you)" : ""}</option>)}
              </select>
            </Field>
            <ul className="fm-prerules">
              <li><Check aria-hidden="true" /><span>An open deal's owner first<span className="fm-faint fm-small"> · always</span></span></li>
              <li>{triage ? <Switch label="Bugs go to Triage" checked={bugs} onChange={setBugs} /> : <X aria-hidden="true" />}
                <span>Bugs go to Triage{triage ? null : <span className="fm-faint fm-small"> · Triage isn't installed</span>}</span></li>
              <li className="fm-prerule">
                <span>And</span>
                <select className="c-input fm-select" aria-label="Which kind" value={ruleKind} onChange={(e) => setRuleKind(e.target.value)}>
                  <option value="">no rule for a kind</option>
                  {KINDS.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}s</option>)}
                </select>
                {ruleKind ? (
                  <>
                    <span>go to</span>
                    <select className="c-input fm-select" aria-label="Who" value={ruleWho} onChange={(e) => setRuleWho(e.target.value)}>
                      <option value="">choose someone</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </>
                ) : null}
              </li>
            </ul>
          </li>
          <li>
            <h2 className="fm-h2"><span className="fm-stepn">7</span>How fast they hear back</h2>
            <div className="fm-modes" role="radiogroup" aria-label="How fast they hear back">
              {(["chat_only", "draft", "lemma_address"] as ReplyMode[]).map((m) => (
                <label key={m} className={cx("fm-mode", mode === m && "fm-mode--on")}>
                  <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                  <span className="fm-stack"><span>{MODE_WORDS[m]}{m === "draft" ? <span className="fm-faint"> (the default)</span> : null}</span>
                    <span className="fm-small fm-muted">{m === "chat_only" ? "The Lemma answers in the chat beside the form; nobody emails them."
                      : m === "draft" ? "A reply is drafted in the owner's own mailbox, and goes when they press Send."
                        : "Only for people who confirm their email: the owner sends from the Lemma's address, 200 emails a day at most."}</span></span>
                </label>
              ))}
            </div>
          </li>
        </ol>
        {said.length ? (
          <ul className="fm-readback">
            {said.map((x, i) => <li key={i} className={cx(!x.ok && "fm-bad")}>{x.ok ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}{x.said}</li>)}
          </ul>
        ) : null}
        <div className="fm-acts">
          <Button variant="primary" busy={busy === "save"} disabled={!me || DEMO} onClick={() => void finish()}>{first ? "Start taking answers" : "Save"}</Button>
          <Sample />
          {DEMO ? <span className="fm-small fm-muted">In the demo the set-up isn't saved.</span> : null}
        </div>
      </main>
    </div>
  );
}
