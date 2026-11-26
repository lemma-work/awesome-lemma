// A new study, or its question and who fits changed: the question, how many
// calls, the features it is about, who fits in a sentence (read into filters
// once saved), and the line every invite carries.

import { useMemo, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button, Field, Pill, create, errorText, update, useToast } from "@lemma-plugins/kit";
import { Top } from "./App";
import { readFit, useUI, useWho } from "./data";
import { to } from "./route";

const EXAMPLES = [
  "Admins at paying companies who said something about exports or reports",
  "People in a trial who asked for something we haven't built",
  "Anyone who called a missing feature a blocker in the last three months",
];

export function NewStudy({ id }: { id?: string }) {
  const ui = useUI();
  const { me } = useWho();
  const toast = useToast();
  const study = id ? ui.studies.find((s) => s.id === id) : undefined;
  const [question, setQuestion] = useState(study?.question || "");
  const [want, setWant] = useState(String(study?.want || 6));
  const [picked, setPicked] = useState<string[]>(study?.feature_ids || []);
  const [fit, setFit] = useState(study?.fit_sentence || "");
  const [line, setLine] = useState(study?.invite_line || "");
  const [busy, setBusy] = useState(false);
  const features = useMemo(() => ui.featureRows.filter((f) => f.state === "active" || f.state === "suggested" || picked.includes(f.id)), [ui.featureRows, picked]);

  const save = async () => {
    const q = question.trim();
    if (q.length < 8) {
      toast("Write the question first.");
      return;
    }
    setBusy(true);
    try {
      const row = {
        question: q.slice(0, 300), want: Math.max(1, Math.min(60, Number(want) || 6)), feature_ids: picked,
        fit_sentence: fit.trim() || null, invite_line: line.trim() || null,
      };
      let sid = study?.id;
      if (sid) {
        await update("interviews_study", sid, row);
      } else {
        const made = await create<{ id: string }>("interviews_study", {
          ...row, state: "draft", owner_user_id: me?.id || null, owner_name: me?.name || null, fit_state: "none", sample: false,
        });
        sid = made.id;
      }
      const changed = !study || (study.fit_sentence || "") !== (row.fit_sentence || "") || !study.pool_at;
      await ui.reload("studies");
      if (changed) await readFit({ ...(study || {}), ...row, id: sid } as never);
      to.study(sid as string);
    } catch (e) {
      toast(`Couldn't save the study: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Top crumbs={[{ label: "User interviews", go: () => to.studies() }, ...(study ? [{ label: study.question, go: () => to.study(study.id) }] : []), { label: study ? "Edit" : "New study" }]} />
      <main className="c-body ui-form">
        <div className="c-stack" style={{ gap: 18 }}>
          <Field label="The question" hint="What the team wants to learn, in a sentence.">
            <textarea className="c-textarea ui-short" value={question} onChange={(e) => setQuestion(e.target.value)}
              placeholder="Why do admins rebuild our reports in a spreadsheet?" maxLength={300} />
          </Field>
          <Field label="Calls you want">
            <input className="c-input ui-numin" type="number" min={1} max={60} value={want} onChange={(e) => setWant(e.target.value)} />
          </Field>
          <div className="c-field">
            <span>Features it is about</span>
            {features.length ? (
              <div className="ui-chips" role="group" aria-label="Features">
                {features.map((f) => {
                  const on = picked.includes(f.id);
                  return (
                    <button key={f.id} type="button" className={`ui-toggle${on ? " is-on" : ""}`} aria-pressed={on}
                      onClick={() => setPicked((p) => (on ? p.filter((x) => x !== f.id) : [...p, f.id]))}>
                      {on ? <Check size={13} aria-hidden="true" /> : null}{f.name}
                      {f.state === "suggested" ? <span className="c-faint"> · suggested</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : <small className="c-field__hint">No features on the team's list yet. Findings from the calls suggest them.</small>}
          </div>
          <Field label="Who fits, in a sentence" hint="The Lemma reads it into filters over the people your team already knows: deals, what people said, your own contacts, a pasted list. You'll see how it read it.">
            <textarea className="c-textarea ui-short" value={fit} onChange={(e) => setFit(e.target.value)} placeholder={EXAMPLES[0]} maxLength={600} />
          </Field>
          {!fit ? (
            <div className="ui-examples">
              {EXAMPLES.map((x) => <button key={x} type="button" className="ui-link c-muted" onClick={() => setFit(x)}><Sparkles size={12} aria-hidden="true" /> {x}</button>)}
            </div>
          ) : null}
          <Field label="What the call is about, for them" hint="One line every invite carries. Left empty, the invite says it from the question.">
            <input className="c-input" value={line} onChange={(e) => setLine(e.target.value)} maxLength={400}
              placeholder="How you get numbers out of the product each week, and what happens to them after." />
          </Field>
          <div className="c-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary" busy={busy} onClick={() => void save()}>{study ? "Save" : "Open the study"}</Button>
            <Button variant="ghost" onClick={() => (study ? to.study(study.id) : to.studies())}>Cancel</Button>
            {fit.trim() ? <Pill tone="ai" icon={Sparkles}>Read into filters when saved</Pill> : null}
          </div>
        </div>
      </main>
    </>
  );
}
