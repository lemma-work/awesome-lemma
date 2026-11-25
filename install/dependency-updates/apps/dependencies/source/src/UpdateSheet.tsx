// One update, as a sheet over the week (/u/<id>): what changed (the Lemma's
// read of the changelog), where this repository uses it, the Lemma's read,
// and the decision. Deciding here settles the "decide" in Today too.

import { useState } from "react";
import { FileCode, ShieldAlert, Sparkles, TriangleAlert } from "lucide-react";
import { Button, Menu, MenuItem, MenuLabel, Pill, Sheet, useToast } from "@lemma-plugins/kit";
import { decide, useDeps } from "./data";
import { Ai, Bump, Change, Mono, Reach, Severity, StatePill } from "./marks";
import { age, downloads, joins, short } from "./model";
import { to } from "./route";
import type { Update } from "./types";

export function UpdateSheet({ id }: { id?: string }) {
  const { updates, batches, settings } = useDeps();
  const u = id ? updates.find((x) => x.id === id) : undefined;
  return (
    <Sheet open={!!id} title={u ? u.package : "Update"} onClose={() => to.week()} footer={u ? <Footer u={u} /> : undefined}>
      {!u ? <p className="c-muted">This update isn't here any more: a newer version may have replaced it.</p> : (
        <>
          <div className="dp-sheet-head">
            <div className="c-row dp-wrap-row"><StatePill u={u} /><Bump u={u} />{u.security ? <Severity value={u.security.severity} /> : null}</div>
            <div className="c-row dp-wrap-row c-muted"><Change u={u} /><span>·</span><span>{u.repo}</span>{u.released_at ? <><span>·</span><span>released {age(u)} ago</span></> : null}</div>
            {u.why ? <p className="c-muted">{u.why}</p> : null}
          </div>

          <dl className="c-props">
            <dt>Read from</dt><dd>{u.read_from || "Not read yet"}</dd>
            <dt>Tried here</dt><dd>{u.tried_note || (u.tried === "passed" ? "Passed" : u.tried === "fixed" ? "Passed after one fix" : u.tried === "failed" ? "Failed" : "Not yet")}</dd>
            <dt>Downloads</dt><dd>{u.ecosystem === "npm" ? `${downloads(u.downloads_week)} a week on this version` : "Not known: npm counts downloads per version, PyPI and Actions don't"}</dd>
            {u.state === "waiting" ? <><dt>Joins</dt><dd>{joins(u, settings)}'s batch</dd></> : null}
            {u.batch_id ? <><dt>Pull request</dt><dd>{(() => {
              const b = batches.find((x) => x.id === u.batch_id);
              return b ? <button className="dp-link" onClick={() => to.batch(b.id)}>{short(b.repo)} #{b.pr_number}</button> : "—";
            })()}</dd></> : null}
          </dl>

          {u.security ? (
            <section className="dp-block">
              <h3><ShieldAlert size={14} aria-hidden="true" /> Advisory</h3>
              <p><Mono>{u.security.ghsa || u.security.cve}</Mono> {u.security.summary}</p>
              <div className="dp-block__row"><span className="c-muted">Does your code reach it</span> <Reach u={u} /></div>
              <p className="dp-foot">The Lemma read your code for this; it isn't a call graph.</p>
            </section>
          ) : null}

          {u.risk && u.state === "risky" ? (
            <section className="dp-block">
              <h3><TriangleAlert size={14} aria-hidden="true" /> Why it's held</h3>
              <ul className="dp-bullets">
                {u.risk.install_script ? <li>Adds a <Mono>{typeof u.risk.install_script === "string" ? u.risk.install_script : "install"}</Mono> script.</li> : null}
                {u.risk.new_publisher ? <li>Published by a maintainer new to the package.</li> : null}
                {u.risk.age_hours != null ? <li>Out {Math.round(Number(u.risk.age_hours))} hours.</li> : null}
              </ul>
              <p className="dp-foot">From the registry's own data. It isn't a malware scan.</p>
            </section>
          ) : null}

          <section className="dp-block">
            <h3>What changed <Ai /></h3>
            {u.changes.length ? <ul className="dp-bullets">{u.changes.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="c-muted">No changelog entry.</p>}
          </section>

          <section className="dp-block">
            <h3><FileCode size={14} aria-hidden="true" /> Where you use it</h3>
            {u.uses.length ? (
              <ul className="dp-uses">
                {u.uses.map((x) => (
                  <li key={x.at}><Mono>{x.at}</Mono>{x.line ? <code className="dp-code">{x.line}</code> : null}</li>
                ))}
              </ul>
            ) : <p className="c-muted">Nothing in your code calls what changed.</p>}
          </section>

          <section className="dp-block">
            <h3><Sparkles size={14} aria-hidden="true" /> The Lemma's read</h3>
            <p>{u.lemma_read || "Not read yet."}</p>
          </section>
        </>
      )}
    </Sheet>
  );
}

function Footer({ u }: { u: Update }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      toast(await decide(u.id, action, extra));
    } catch (e) {
      toast(`Couldn't do that: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };
  const major = u.to_version.replace(/^v/, "").split(".")[0];
  const ignore = (
    <Menu label="Ignore" size="sm" up align="right">
      {(close) => (
        <>
          <MenuLabel>Ignore {u.package}</MenuLabel>
          <MenuItem onSelect={() => { close(); void act("ignore", { version_range: u.to_version, reason: "Not this version" }); }}>This version, {u.to_version}</MenuItem>
          {u.bump === "major" ? <MenuItem onSelect={() => { close(); void act("ignore", { version_range: `${major}.x`, reason: `Not ${major}.x yet` }); }}>Every {major}.x</MenuItem> : null}
          <MenuItem onSelect={() => { close(); void act("ignore", { version_range: "patches", reason: "Patches monthly, by hand" }); }}>Its patches</MenuItem>
          <MenuItem onSelect={() => { close(); void act("ignore", { version_range: "all", reason: "Not updated by the Lemma" }); }}>Every version</MenuItem>
        </>
      )}
    </Menu>
  );
  let main: React.ReactNode = null;
  if (u.state === "needs_you") {
    main = <>
      <Button variant="primary" size="sm" busy={busy === "monday"} onClick={() => void act("monday")}>{u.uses.length ? "Add to Monday, with the fix" : "Add to Monday"}</Button>
      <Button size="sm" busy={busy === "own"} onClick={() => void act("own")}>Its own PR</Button>
      <Button size="sm" busy={busy === "not_yet"} onClick={() => void act("not_yet")}>Not yet</Button>
    </>;
  } else if (u.state === "risky") {
    main = <Button variant="primary" size="sm" busy={busy === "let_through"} onClick={() => void act("let_through")}>Let it through</Button>;
  } else if (u.state === "waiting") {
    main = <Button size="sm" busy={busy === "take_now"} onClick={() => void act("take_now")}>Take it now</Button>;
  } else if (u.state === "ready" || u.state === "by_hand") {
    main = <Button size="sm" busy={busy === "own"} onClick={() => void act("own")}>Its own PR</Button>;
  } else if (u.state === "dropped") {
    main = <Button size="sm" busy={busy === "put_back"} onClick={() => void act("put_back")}>Put back</Button>;
  } else if ((u.state === "opened" || u.state === "in_batch") && u.batch_id) {
    main = <>
      <Button size="sm" onClick={() => to.batch(u.batch_id!)}>Open #{u.pr_number}</Button>
      {!u.security ? <Button size="sm" busy={busy === "drop"} onClick={() => void act("drop")}>Drop</Button> : null}
    </>;
  } else if (u.state === "ignored") {
    main = <Pill tone="plain">Ignored</Pill>;
  }
  const canIgnore = ["needs_you", "risky", "waiting", "ready", "by_hand", "dropped"].includes(u.state);
  return (
    <div className="dp-sheet-foot">
      <div className="c-row dp-wrap-row">{main}{canIgnore ? ignore : null}</div>
      {u.state === "needs_you" || u.state === "risky" ? <span className="c-faint dp-small">Choosing here settles the "decide" in Today too.</span> : null}
    </div>
  );
}
