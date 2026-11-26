// Each person, on first open: the topics they own, how they want to be asked
// about a question nobody answered, when they'd like checks, and any
// procedures assigned to them. Then the app makes their own Today refresh.

import { useState } from "react";
import { BookOpen, Play } from "lucide-react";
import { Button, DEMO, Field, client, runFunction, useToast } from "@lemma-plugins/kit";
import { firstOf, refreshMine, useKnowhow, useWho } from "./data";
import { to } from "./route";
import { ensureMine } from "./wire";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function Me({ first = false }: { first?: boolean }) {
  const d = useKnowhow();
  const { me } = useWho();
  const toast = useToast();
  const mine = me ? d.people.find((p) => p.member_id === me.id) : undefined;
  const [askBy, setAskBy] = useState<"teams" | "today">(mine?.ask_by || "teams");
  const [rhythm, setRhythm] = useState<"daily" | "weekly">(mine?.check_rhythm || "daily");
  const [day, setDay] = useState(mine?.check_day || 0);
  const [busy, setBusy] = useState(false);
  const topics = d.topics.filter((t) => me && (t.owner_member_id === me.id || t.backup_member_id === me.id));
  const assigned = d.assignments.filter((g) => me && g.member_id === me.id && g.state !== "done");
  const save = async () => {
    if (!me) return;
    setBusy(true);
    const inputs = { ask_by: askBy, check_rhythm: rhythm, check_day: day };
    try {
      if (DEMO) {
        toast("In the demo nothing is saved.");
      } else {
        try {
          const run = (await client.workflows.runs.create("knowhow-me")) as unknown as { id: string };
          await client.workflows.runs.submitForm(run.id, { node_id: "me", inputs } as never);
        } catch {
          await runFunction("knowhow_me_save", { ...inputs, done: true });
        }
        await ensureMine(me.id);
        refreshMine();
        // The workflow saves a moment later; wait for it so the gate lets them through.
        for (let i = 0; i < 6; i++) {
          await d.reload("people");
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      if (!first) to.answers();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="c-app kh-setup-page">
      <div className="c-setup kh-setup">
        <section className="kh-setup__body">
          <h1>{first ? `Welcome to Know-how, ${firstOf(me?.name)}` : "Your Know-how"}</h1>
          <p className="c-setup__lead">The Lemma answers your team's questions from its pages. When a page doesn't answer one in your topics, you're asked; your reply becomes the answer.</p>
          <Field label="Topics you own">
            {topics.length ? <ul className="kh-mini">{topics.map((t) => <li key={t.id}><button type="button" onClick={() => to.library(t.slug)}><BookOpen aria-hidden="true" /><span className="c-grow">{t.name}</span><span className="c-faint">{t.owner_member_id === me?.id ? "owner" : "backup"}</span></button></li>)}</ul>
              : <p className="c-faint">None yet. Whoever set up Know-how can make you a topic's owner in the Library.</p>}
          </Field>
          <Field label="When nobody's answer fits a question in your topics">
            <div className="kh-choices">
              <label><input type="radio" checked={askBy === "teams"} onChange={() => setAskBy("teams")} /> A Teams message from the Lemma</label>
              <label><input type="radio" checked={askBy === "today"} onChange={() => setAskBy("today")} /> Today only</label>
            </div>
          </Field>
          <Field label="When you'd like checks" hint="Pages past their check date show in Today on this rhythm.">
            <div className="kh-choices">
              <label><input type="radio" checked={rhythm === "daily"} onChange={() => setRhythm("daily")} /> Daily</label>
              <label><input type="radio" checked={rhythm === "weekly"} onChange={() => setRhythm("weekly")} /> Weekly, on
                <select className="c-select" value={day} onChange={(e) => { setDay(Number(e.target.value)); setRhythm("weekly"); }}>{DAYS.map((x, i) => <option key={x} value={i}>{x}</option>)}</select></label>
            </div>
          </Field>
          {assigned.length ? (
            <Field label="Procedures assigned to you">
              <ul className="kh-mini">{assigned.map((g) => { const a = d.articleBy.get(g.article_id); return a ? (
                <li key={g.id}><button type="button" onClick={() => to.walk(a.id)}><Play aria-hidden="true" /><span className="c-grow">{a.title}</span><span className="c-faint">Walk it here, or ask the Lemma in Teams</span></button></li>) : null; })}</ul>
            </Field>
          ) : null}
          <div className="kh-actions"><Button variant="primary" busy={busy} onClick={() => void save()}>{first ? "Start" : "Save"}</Button></div>
        </section>
      </div>
    </div>
  );
}
