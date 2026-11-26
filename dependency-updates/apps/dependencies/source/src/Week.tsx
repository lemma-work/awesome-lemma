// A. The week: a status line, then Security, Ready for Monday, Waiting for
// you, Waiting out the wait, Held as risky and Ignored, with a rail of rules,
// repositories and where it runs. An update opens as a sheet (/u/<id>).

import { useMemo, useState, type ReactNode } from "react";
import { CircleAlert, Clock, EyeOff, GitPullRequest, Package, Play, Settings as Cog, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button, Card, Empty, Header, Pill, SearchField, Segmented, Toolbar, useToast, errorText } from "@lemma-plugins/kit";
import { decide, openNow, useDeps, useMe } from "./data";
import { Bump, Change, Mono, Reach, Read, RepoPill, Severity, StatePill, Tried } from "./marks";
import { WEEKDAY_LONG, age, counted, joins, lastBatch, nextBatch, outFor, plural, repoReady, short, week } from "./model";
import { to } from "./route";
import type { Batch, Update } from "./types";
import { UpdateSheet } from "./UpdateSheet";

export function Week({ open }: { open?: string }) {
  const d = useDeps();
  const { settings, updates, batches, active } = d;
  const toast = useToast();
  const [repo, setRepo] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const filter = repo === "all" ? null : repo;
  const w = useMemo(() => week(updates, filter, search), [updates, filter, search]);
  const segs = [{ id: "all", label: "All", count: updates.filter(counted).length },
    ...active.map((r) => ({ id: r.repo, label: r.repo, count: updates.filter((u) => u.repo === r.repo && counted(u)).length }))];
  const last = lastBatch(batches, filter);
  const targets = active.filter((r) => (!filter || r.repo === filter) && repoReady(r));

  const run = async () => {
    setBusy(true);
    try {
      const msg = await openNow(targets);
      if (msg) toast(msg);
    } catch (e) {
      toast(`Couldn't start it: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header icon={Package} title="Dependencies" count={plural(active.length, "repository", "repositories")}>
        <Button variant="ghost" size="sm" label="Rules" onClick={() => to.rules()}>Rules</Button>
        <Button variant="ghost" size="sm" icon={Cog} label="Set-up" onClick={() => to.setup()} />
      </Header>
      <Toolbar>
        <Segmented label="Repository" items={segs} value={repo} onChange={setRepo} />
        <div className="dp-toolbar-end">
          <SearchField value={search} onChange={setSearch} placeholder="Search packages" />
          <Button variant="primary" icon={Play} busy={busy} disabled={!targets.length} onClick={() => void run()}>
            Open {settings ? WEEKDAY_LONG[settings.weekday] : "Monday"}'s batch now
          </Button>
        </div>
      </Toolbar>
      {settings ? <StatusLine last={last} /> : null}
      <main className="c-body c-body--wide dp-body">
        <div className="dp-split">
          <div className="dp-main">
            <SecuritySection list={w.security} batches={batches} />
            <ReadySection list={w.ready} />
            <YouSection list={w.you} />
            <div className="dp-pair">
              <WaitingSection list={w.waiting} />
              <RiskySection list={w.risky} />
            </div>
            <IgnoredSection list={w.ignored} />
          </div>
          <Rail />
        </div>
      </main>
      <UpdateSheet id={open} />
    </>
  );
}

function StatusLine({ last }: { last: Batch | null }) {
  const { settings } = useDeps();
  if (!settings) return null;
  const alerts = settings.alerts === "github" ? "Dependabot alerts" : "OSV, checked daily";
  return (
    <div className="dp-status" role="status">
      <span><span className="c-muted">Next batch</span> <b>{nextBatch(settings)}</b></span>
      <span>
        <span className="c-muted">Last batch</span>{" "}
        {last ? (
          <button className="dp-link" onClick={() => to.batch(last.id)}>{last.repo} #{last.pr_number ?? "…"}</button>
        ) : <span className="c-faint">none yet</span>}
        {last ? <> <BatchWord b={last} /></> : null}
      </span>
      <span><span className="c-muted">Waits</span> <b>{plural(settings.wait_days, "day")}</b> <span className="c-muted">for a release, {settings.wait_major_days} for a major</span></span>
      <span><span className="c-muted">Security</span> <b>opens the same day</b> <span className="c-muted">· {alerts}</span></span>
    </div>
  );
}

function BatchWord({ b }: { b: Batch }) {
  if (b.state === "merged") return <Pill tone="success">Merged {b.merged_at ? new Date(b.merged_at).toLocaleDateString(undefined, { weekday: "short" }) : ""}</Pill>;
  if (b.state === "open") return <Pill tone={b.checks === "failed" ? "danger" : "info"}>{b.checks === "failed" ? "Open, checks failing" : "Open"}</Pill>;
  return <Pill tone="plain">{b.state}</Pill>;
}

function Section({ id, icon, title, sub, children, count, end }: { id: string; icon: typeof Package; title: string; sub?: ReactNode; children: ReactNode; count: number; end?: ReactNode }) {
  const Icon = icon;
  return (
    <section className="dp-section" aria-labelledby={id}>
      <div className="dp-section__head">
        <h2 id={id}><Icon size={15} aria-hidden="true" />{title}</h2>
        <span className="c-count">{count}</span>
        {sub ? <span className="c-muted dp-section__sub">{sub}</span> : null}
        {end ? <span className="dp-section__end">{end}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Pkg({ u, showRepo = true }: { u: Update; showRepo?: boolean }) {
  return (
    <div className="dp-pkg">
      <button className="dp-link dp-pkg__name" onClick={() => to.update(u.id)}>{u.package}</button>
      {showRepo ? <div className="c-cell__sub">{short(u.repo)}</div> : null}
    </div>
  );
}

function SecuritySection({ list, batches }: { list: Update[]; batches: Batch[] }) {
  if (!list.length) return null;
  return (
    <Section id="s-sec" icon={ShieldAlert} title="Security" count={list.length} sub="opened the same day, outside the batch and the wait">
      <div className="c-table-wrap">
        <table className="c-table dp-table">
          <thead><tr><th>Package</th><th>Change</th><th>Advisory</th><th>Does your code reach it</th><th>Pull request</th></tr></thead>
          <tbody>
            {list.map((u) => {
              const b = batches.find((x) => x.id === u.batch_id);
              return (
                <tr key={u.id} onClick={() => to.update(u.id)}>
                  <td><Pkg u={u} /></td>
                  <td><Change u={u} /></td>
                  <td><Severity value={u.security?.severity} /><div className="c-cell__sub dp-mono">{u.security?.ghsa || u.security?.cve}</div></td>
                  <td className="dp-wrap"><Reach u={u} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {b ? <span className="c-row"><button className="dp-link" onClick={() => to.batch(b.id)}>#{b.pr_number}</button>
                      <Pill tone={b.checks === "passed" ? "success" : b.checks === "failed" ? "danger" : "info"}>
                        {b.state === "merged" ? "Merged" : b.checks === "passed" ? "Checks passing" : b.checks === "failed" ? "Checks failing" : "Tests running"}</Pill></span>
                      : <StatePill u={u} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="dp-foot">Reach is the Lemma reading your code, not a call graph.</p>
    </Section>
  );
}

function ReadySection({ list }: { list: Update[] }) {
  const { settings } = useDeps();
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 8);
  return (
    <Section id="s-ready" icon={GitPullRequest} title={`Ready for ${settings ? WEEKDAY_LONG[settings.weekday] : "Monday"}`} count={list.length}
      sub="one pull request per repository, installed and tested before it opens">
      {list.length ? (
        <div className="c-table-wrap">
          <table className="c-table dp-table">
            <thead><tr><th>Package</th><th>Change</th><th>Released</th><th>The Lemma's read of the changelog</th><th>Tested</th></tr></thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} onClick={() => to.update(u.id)}>
                  <td><Pkg u={u} /></td>
                  <td><span className="c-row"><Change u={u} /><Bump u={u} /></span></td>
                  <td className="c-muted">{age(u)}</td>
                  <td className="dp-wrap">
                    {u.state === "by_hand" || u.state === "dropped" ? <div className="dp-why"><StatePill u={u} /> <span className="c-muted">{u.why}</span></div> : null}
                    <Read>{u.lemma_read || u.why || "Not read yet."}</Read>
                  </td>
                  <td><Tried u={u} /></td>
                </tr>
              ))}
              {list.length > 8 && !all ? (
                <tr className="dp-more"><td colSpan={5}><Button size="sm" onClick={(e) => { e.stopPropagation(); setAll(true); }}>{plural(list.length - 8, "more update")}</Button></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={GitPullRequest} title="Nothing ready yet">Updates join once they've waited out the wait.</Empty>}
    </Section>
  );
}

function YouSection({ list }: { list: Update[] }) {
  if (!list.length) return null;
  return (
    <Section id="s-you" icon={CircleAlert} title="Waiting for you" count={list.length} sub="also in Today as decide">
      <div className="c-table-wrap">
        <table className="c-table dp-table">
          <thead><tr><th>Package</th><th>Change</th><th>What breaks for you</th><th><span className="c-sr">Decide</span></th></tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} onClick={() => to.update(u.id)}>
                <td><Pkg u={u} /></td>
                <td><Change u={u} /></td>
                <td className="dp-wrap"><Read>{u.why || u.lemma_read}</Read></td>
                <td onClick={(e) => e.stopPropagation()}><Decide u={u} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function Decide({ u, compact = true }: { u: Update; compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      toast(await decide(u.id, action, extra));
    } catch (e) {
      toast(`Couldn't do that: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const big = (u.touches || 0) > 3;
  if (u.state === "needs_you") {
    return (
      <div className="dp-acts">
        {!big || !compact ? <Button size="sm" busy={busy === "monday"} onClick={() => void act("monday")}>Add to Monday</Button> : null}
        <Button size="sm" busy={busy === "own"} onClick={() => void act("own")}>Its own PR</Button>
        <Button size="sm" busy={busy === "not_yet"} onClick={() => void act("not_yet")}>Not yet</Button>
      </div>
    );
  }
  if (u.state === "risky") {
    return (
      <div className="dp-acts">
        <Button size="sm" busy={busy === "ignore"} onClick={() => void act("ignore", { version_range: u.to_version, reason: "Held as risky" })}>Ignore this version</Button>
        <Button size="sm" busy={busy === "let_through"} onClick={() => void act("let_through")}>Let it through</Button>
      </div>
    );
  }
  return null;
}

function WaitingSection({ list }: { list: Update[] }) {
  const { settings } = useDeps();
  return (
    <Section id="s-wait" icon={Clock} title={`Waiting out ${plural(settings?.wait_days ?? 3, "day")}`} count={list.length}>
      {list.length ? (
        <div className="c-card">
          <ul className="c-list dp-list">
            {list.map((u) => (
              <li key={u.id} className="c-li c-li--link" onClick={() => to.update(u.id)}>
                <div className="c-li__main"><b>{u.package}</b> <Mono>{u.to_version}</Mono><div className="c-li__sub">{short(u.repo)} · {outFor(u)}</div></div>
                <span className="c-muted dp-nowrap">joins {joins(u, settings)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="dp-none">Nothing waiting.</p>}
    </Section>
  );
}

function RiskySection({ list }: { list: Update[] }) {
  return (
    <Section id="s-risk" icon={TriangleAlert} title="Held, looks risky" count={list.length}>
      {list.length ? (
        <div className="c-card">
          {list.map((u) => (
            <div key={u.id} className="dp-risk">
              <div className="c-row dp-wrap-row"><button className="dp-link" onClick={() => to.update(u.id)}><b>{u.package}</b></button> <Change u={u} /> <Pill tone="danger">Held</Pill></div>
              <p className="c-muted">{u.risk?.note || u.why || riskWords(u)}</p>
              <Decide u={u} />
            </div>
          ))}
          <p className="dp-foot dp-foot--in">The Lemma checks the registry's own data: age, publisher, install scripts. It isn't a malware scan.</p>
        </div>
      ) : <p className="dp-none">Nothing held.</p>}
    </Section>
  );
}

function riskWords(u: Update): string {
  const r = u.risk || {};
  const bits = [r.install_script ? `Adds a ${typeof r.install_script === "string" ? r.install_script : "install"} script.` : "",
    r.new_publisher ? "Published by a maintainer new to the package." : "",
    r.age_hours != null ? `Out ${Math.round(Number(r.age_hours))} hours.` : ""].filter(Boolean);
  return bits.join(" ") || "The registry's data looks unusual for this package.";
}

function IgnoredSection({ list }: { list: Update[] }) {
  const { ignores } = useDeps();
  const toast = useToast();
  if (!ignores.length && !list.length) return null;
  return (
    <Section id="s-ign" icon={EyeOff} title="Ignored" count={ignores.length} sub="each with who and why">
      <div className="c-card">
        <ul className="c-list dp-list">
          {ignores.map((ig) => (
            <li key={ig.id} className="c-li">
              <div className="c-li__main"><b>{ig.package}</b> <Mono>{ig.version_range}</Mono>
                <div className="c-li__sub">{ig.reason || "No reason given"} · {ig.by_kind === "rule" ? "a rule" : ig.by_name || "a person"}{ig.repo ? ` · ${short(ig.repo)}` : " · every repository"}</div>
              </div>
              <Button size="sm" onClick={() => void decide(ig.id, "stop_ignoring").then(toast).catch((e) => toast(String(e)))}>Stop ignoring</Button>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function Rail() {
  const { settings, rules, active } = useDeps();
  const me = useMe();
  const p = settings?.platform || {};
  const said = (key: string, yes: string, no: string, unknown: string) => {
    const st = p[key]?.state;
    return { text: st === "yes" ? yes : st === "no" ? no : unknown, tone: (st === "yes" ? "success" : st === "no" ? "warning" : "plain") as "success" | "warning" | "plain", note: p[key]?.note || null };
  };
  const lines = settings ? [
    `Batch weekly, ${WEEKDAY_LONG[settings.weekday]} ${settings.run_time}, one pull request per repository.`,
    `Wait ${plural(settings.wait_days, "day")} for a release, ${settings.wait_major_days} for a major.`,
    "Security opens the same day.",
    "Ask before any major. Never merge on its own.",
    ...(settings.hold_install_scripts ? ["Hold a release that adds an install script."] : []),
  ] : [];
  const plat = [
    { label: "Checkout", ...said("repository_schedule", "Starts in a checkout", "Clones by hand", "Not tried yet") },
    { label: "Actions updates", ...said("workflows", "Pushed with the batch", "Listed to do by hand", "Not tried yet") },
    { label: "Security source", ...said("alerts", "Dependabot alerts", "OSV, daily", "Not tried yet") },
    { label: "Check run", ...said("checks", "On each pull request", "In the description", "Not tried yet") },
  ];
  return (
    <aside className="dp-rail" aria-label="Rules, repositories and where it runs">
      <Card title="Rules" action={<Button size="sm" variant="ghost" onClick={() => to.rules()}>Change in words</Button>}>
        <ul className="dp-lines">
          {lines.map((l) => <li key={l}>{l}</li>)}
          {rules.filter((r) => r.active).map((r) => <li key={r.id}>{r.text}</li>)}
        </ul>
      </Card>
      <Card title="Repositories" flush>
        <ul className="c-list">
          {active.map((r) => (
            <li key={r.id} className="c-li dp-repo">
              <div className="c-li__main">
                <b>{r.repo}</b>
                <div className="c-li__sub">{r.managers.length === 1 && r.managers[0] === "actions" ? "GitHub Actions only" : [r.managers.join(", "), r.test_cmd].filter(Boolean).join(" · ") || "Not looked at yet"}</div>
                {r.status_note && r.status !== "ok" ? <div className="c-li__sub">{r.status_note}</div> : null}
              </div>
              {r.status === "needs_confirm" ? <Button size="sm" onClick={() => to.setup()}>Confirm commands</Button> : <RepoPill r={r} />}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Where it runs">
        <p className="c-muted dp-para">
          On {settings?.owner_user_id && me?.id === settings.owner_user_id ? "your" : `${settings?.owner_name || "the owner"}'s`} schedules: each repository
          is cloned as {settings?.owner_user_id && me?.id === settings.owner_user_id ? "you" : "them"}, installed and tested in a cloud workspace of this Lemma, never on a laptop.
        </p>
        <dl className="c-props dp-props">
          {plat.map((x) => (
            <Fragmented key={x.label} label={x.label} tone={x.tone} text={x.text} note={x.note} />
          ))}
        </dl>
        <div className="dp-managers">{["npm", "pnpm", "yarn", "pip", "uv", "poetry", "Actions"].map((m) => <Pill key={m} tone="plain">{m}</Pill>)}</div>
        <p className="dp-foot dp-foot--in">Not yet: Go, Cargo, Maven and Gradle, and private registries.</p>
      </Card>
    </aside>
  );
}

function Fragmented({ label, tone, text, note }: { label: string; tone: "success" | "warning" | "plain"; text: string; note: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd><Pill tone={tone}>{text}</Pill>{note && tone === "warning" ? <div className="c-li__sub dp-note">{note}</div> : null}</dd>
    </>
  );
}
