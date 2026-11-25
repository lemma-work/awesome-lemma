// /rules: rules in words, ignores, the wait and the schedule.

import { useState } from "react";
import { ArrowLeft, BookOpen, Clock, EyeOff, Package, Trash2 } from "lucide-react";
import { Button, Card, Empty, Header, Pill, useToast } from "@lemma-plugins/kit";
import { addRule, decide, removeRule, useDeps, useMe } from "./data";
import { Mono } from "./marks";
import { WEEKDAY_LONG, dayOf, nextBatch, plural, short } from "./model";
import { to } from "./route";

export function Rules() {
  const { settings, rules, ignores } = useDeps();
  const me = useMe();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await addRule(text, me);
      setText("");
      toast("Added. The Lemma reads it on its next run.");
    } catch (e) {
      toast(`Couldn't add it: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Header icon={Package} back={{ label: "Dependencies", icon: ArrowLeft, onClick: () => to.week() }} title="Rules" />
      <main className="c-body dp-body dp-narrow">
        <div className="c-stack">
          <Card title="Rules in words" icon={BookOpen} flush
            foot={<form className="dp-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
              <input className="c-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Take boto3 monthly" aria-label="A rule in words" />
              <Button busy={busy} disabled={!text.trim()} type="submit">Add</Button>
            </form>}>
            <ul className="c-list">
              {settings ? (
                <>
                  <li className="c-li"><div className="c-li__main">Batch weekly, {WEEKDAY_LONG[settings.weekday]} {settings.run_time}, one pull request per repository.</div><Pill tone="plain">set-up</Pill></li>
                  <li className="c-li"><div className="c-li__main">Wait {plural(settings.wait_days, "day")} for a release, {settings.wait_major_days} for a major. Security opens the same day.</div><Pill tone="plain">set-up</Pill></li>
                  <li className="c-li"><div className="c-li__main">Ask before any major. Never merge on its own.</div><Pill tone="plain">always</Pill></li>
                  {settings.hold_install_scripts ? <li className="c-li"><div className="c-li__main">Hold a release that adds an install script or comes from a new publisher.</div><Pill tone="plain">set-up</Pill></li> : null}
                </>
              ) : null}
              {rules.map((r) => (
                <li key={r.id} className="c-li">
                  <div className="c-li__main">{r.text}<div className="c-li__sub">{r.by_name || "Someone"} · {dayOf(r.created_at)}</div></div>
                  <Button size="sm" variant="ghost" icon={Trash2} label={`Remove "${r.text}"`}
                    onClick={() => void removeRule(r).then(() => toast("Removed.")).catch((e) => toast(String(e)))} />
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Ignores" icon={EyeOff} count={ignores.length} flush>
            {ignores.length ? (
              <div className="dp-scroll">
                <table className="c-table dp-table dp-table--flat">
                  <thead><tr><th>Package</th><th>Versions</th><th>Where</th><th>Why</th><th>Who</th><th><span className="c-sr">Act</span></th></tr></thead>
                  <tbody>
                    {ignores.map((ig) => (
                      <tr key={ig.id}>
                        <td><b>{ig.package}</b></td>
                        <td><Mono>{ig.version_range}</Mono></td>
                        <td className="c-muted">{ig.repo ? short(ig.repo) : "every repository"}</td>
                        <td className="dp-wrap">{ig.reason || <span className="c-faint">No reason given</span>}</td>
                        <td className="c-muted">{ig.by_kind === "rule" ? "a rule" : ig.by_name || "a person"} · {dayOf(ig.created_at)}</td>
                        <td><Button size="sm" onClick={() => void decide(ig.id, "stop_ignoring").then(toast).catch((e) => toast(String(e)))}>Stop ignoring</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty icon={EyeOff} title="Nothing ignored">Ignore a package from its sheet: a version, a major, its patches, or every version.</Empty>}
          </Card>

          {settings ? (
            <Card title="The wait and the schedule" icon={Clock} action={<Button size="sm" onClick={() => to.setup()}>Change</Button>}>
              <dl className="c-props">
                <dt>Next batch</dt><dd>{nextBatch(settings)} <span className="c-faint">({settings.timezone})</span></dd>
                <dt>The wait</dt><dd>{plural(settings.wait_days, "day")}; a major {plural(settings.wait_major_days, "day")}</dd>
                <dt>Security</dt><dd>Every day at 07:00, and {settings.alerts === "github" ? "on each Dependabot alert" : "from OSV"}</dd>
                <dt>Decides</dt><dd>{settings.owner_name || "The owner"}</dd>
              </dl>
            </Card>
          ) : null}
        </div>
      </main>
    </>
  );
}
