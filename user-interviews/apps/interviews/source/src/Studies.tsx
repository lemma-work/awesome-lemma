// The studies: one line each, with how many calls it wants, how many are
// booked and done, the findings kept, and where it stands.

import { useMemo, useState } from "react";
import { FlaskConical, MessagesSquare, Plus } from "lucide-react";
import { Button, Empty, Pill, Segmented, errorText, plural, runFunction, useToast } from "@lemma-plugins/kit";
import { Top, SetupLink } from "./App";
import { useUI } from "./data";
import { studyTone } from "./marks";
import { to } from "./route";

type Show = "open" | "done" | "all";

export function Studies() {
  const ui = useUI();
  const toast = useToast();
  const [show, setShow] = useState<Show>("open");
  const [loading, setLoading] = useState(false);
  const rows = useMemo(() => ui.studies.map((s) => {
    const people = ui.people.filter((p) => p.study_id === s.id);
    const kept = ui.findings.filter((f) => f.study_id === s.id);
    return {
      s, booked: people.filter((p) => p.stage === "booked").length, done: people.filter((p) => p.stage === "done").length,
      kept: kept.length, from: new Set(kept.map((f) => f.person_id)).size, people: people.length,
    };
  }), [ui.studies, ui.people, ui.findings]);
  const open = rows.filter((r) => r.s.state === "draft" || r.s.state === "running");
  const done = rows.filter((r) => r.s.state === "done" || r.s.state === "archived");
  const list = show === "open" ? open : show === "done" ? done : rows;

  const sample = async () => {
    setLoading(true);
    try {
      const out = await runFunction<{ message?: string }>("interviews_sample_data", { mode: "load" });
      toast(out.message || "Loaded the sample.");
      await ui.reload();
    } catch (e) {
      toast(`Couldn't load the sample: ${errorText(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Top crumbs={[{ label: "User interviews" }, { label: "Studies" }]}>
        <SetupLink />
        <Button variant="primary" icon={Plus} onClick={() => to.new()}>New study</Button>
      </Top>
      <main className="c-body">
        {!ui.studies.length ? (
          <Empty icon={MessagesSquare} title="No studies yet"
            action={<div className="c-row" style={{ flexWrap: "wrap", justifyContent: "center" }}>
              <Button variant="primary" icon={Plus} onClick={() => to.new()}>New study</Button>
              {!ui.sample ? <Button icon={FlaskConical} busy={loading} onClick={() => void sample()}>Look around with a sample</Button> : null}
            </div>}>
            A study is a question you want answered by talking to people. Say who fits, and the Lemma finds them among the people your team already knows.
          </Empty>
        ) : (
          <>
            <div className="ui-toolbar">
              <Segmented<Show> label="Studies" value={show} onChange={setShow}
                items={[{ id: "open", label: "Open", count: open.length }, { id: "done", label: "Done", count: done.length }, { id: "all", label: "All", count: rows.length }]} />
            </div>
            {list.length ? (
              <div className="c-table-wrap">
                <table className="c-table ui-studies">
                  <thead>
                    <tr><th>Question</th><th className="right">Calls</th><th className="c-hide-sm">Findings kept</th><th>Where it stands</th></tr>
                  </thead>
                  <tbody>
                    {list.map(({ s, booked, done: d, kept, from, people }) => {
                      const t = studyTone(s);
                      return (
                        <tr key={s.id} onClick={() => to.study(s.id)}>
                          <td className="ui-wrap">
                            <button type="button" className="ui-link ui-strong" onClick={(e) => { e.stopPropagation(); to.study(s.id); }}>{s.question}</button>
                            <div className="c-cell__sub">{plural(people, "person", "people")} fit{s.owner_name ? ` · ${s.owner_name}` : ""}</div>
                          </td>
                          <td className="right num">
                            <span title="booked">{booked}</span><span className="c-faint"> booked · </span>
                            <span title="done">{d}</span><span className="c-faint"> of {s.want} done</span>
                          </td>
                          <td className="c-hide-sm num">{kept ? <>{kept}<span className="c-faint">, from {plural(from, "person", "people")}</span></> : <span className="c-faint">None yet</span>}</td>
                          <td><Pill tone={t.tone}>{t.text}</Pill></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <Empty title={show === "done" ? "No finished studies" : "No open studies"} />}
          </>
        )}
      </main>
    </>
  );
}
