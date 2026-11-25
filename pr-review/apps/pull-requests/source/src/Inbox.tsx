// The inbox (A1): every open pull request, grouped by who it waits on, which
// code decides (usePrr's sectionOf). Live checks come from GitHub as the
// person; everything else is PR review's own rows.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, GitPullRequest, Hand, ListChecks, Settings as SettingsIcon } from "lucide-react";
import {
  Avatar, Button, Card, Empty, Header, go, Kbd, Pill, SearchField, Segmented, Skeleton, ago, canOpenApps, cx, openApp, plural, useToast,
} from "@lemma-plugins/kit";
import { mergeAsMe } from "./actions";
import { SECTIONS, WEEK, act, errText, postWord, usePrr, useWho, whoIs, type Prr, type Section } from "./data";
import { ChecksPill, ConnectGithub, FindingsPill, RulesBar, short, useChecks, useGithubMissing } from "./marks";
import { prPath, to, type View } from "./route";
import type { PullRequest } from "./types";

const AGE = (pr: PullRequest) => pr.waits_since || pr.updated_at || pr.created_at || null;

function minutesLeft(at: string | null | undefined): number | null {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isNaN(t) ? null : Math.ceil((t - Date.now()) / 60_000);
}

/** When a pull request merging by itself will merge: its own time, else the wait after its last push. */
export function mergeAt(prr: Prr, pr: PullRequest): string | null {
  if (pr.merge_due_at) return pr.merge_due_at;
  const wait = prr.settings?.merge?.wait_minutes;
  const since = pr.waits_since || pr.updated_at;
  if (!wait || !since) return null;
  return new Date(Date.parse(since) + wait * 60_000).toISOString();
}

export function itselfText(prr: Prr, pr: PullRequest): string {
  if (pr.merge_state === "held") return "Held";
  const left = minutesLeft(mergeAt(prr, pr));
  if (left != null && left > 0) return left >= 90 ? `Merges in ${Math.round(left / 60)} h` : `Merges in ${left} min`;
  const how = prr.settings?.merge?.how;
  return how === "queue" ? "In the merge queue" : how === "auto" ? "Auto-merge on" : "Merging";
}

export function Inbox({ view }: { view: View }) {
  const prr = usePrr();
  const { me, people } = useWho();
  const [q, setQ] = useState("");
  const [showMerged, setShowMerged] = useState(view === "merged");
  const [cursor, setCursor] = useState(0);
  const missing = useGithubMissing();
  const toast = useToast();

  const match = (pr: PullRequest) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return [pr.title, pr.key, pr.author, prr.repoOf(pr)].some((s) => (s || "").toLowerCase().includes(needle));
  };

  const open = prr.prs.filter((p) => !["merged", "closed"].includes(prr.sectionOf(p)));
  const mergedWeek = prr.prs.filter((p) => prr.sectionOf(p) === "merged" && p.merged_at && Date.now() - Date.parse(p.merged_at) < WEEK);
  const mergedAll = prr.prs.filter((p) => prr.sectionOf(p) === "merged").sort((a, b) => Date.parse(b.merged_at || "") - Date.parse(a.merged_at || ""));
  const inboxCount = open.filter(prr.inInbox).length;
  const reviewing = open.filter((p) => prr.sectionOf(p) === "reviewing").length;

  const groups = useMemo(() => {
    if (view === "merged") return [{ id: "merged" as Section, label: "Merged", rows: mergedAll.filter(match) }];
    if (view === "all") return [{ id: "others" as Section, label: "All open", rows: [...open].sort((a, b) => Date.parse(AGE(b) || "") - Date.parse(AGE(a) || "")).filter(match) }];
    return SECTIONS.map((s) => ({ ...s, rows: open.filter((p) => prr.inInbox(p) && prr.sectionOf(p) === s.id && match(p)).sort((a, b) => Date.parse(AGE(b) || "") - Date.parse(AGE(a) || "")) })).filter((g) => g.rows.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, prr, q]);

  const flat = groups.flatMap((g) => g.rows);
  const list = useRef<HTMLDivElement>(null);

  // j/k move, o (or Enter) opens, r goes to the rules.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']");
      if (typing) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setCursor((c) => {
          const n = Math.max(0, Math.min(flat.length - 1, c + (e.key === "j" ? 1 : -1)));
          window.setTimeout(() => list.current?.querySelector(`[data-row="${n}"]`)?.scrollIntoView({ block: "nearest" }), 0);
          return n;
        });
      } else if ((e.key === "o" || e.key === "Enter") && flat[cursor]) {
        e.preventDefault();
        const pr = flat[cursor];
        to.pr(prr.repoOf(pr), pr.number);
      } else if (e.key === "r" && canOpenApps()) {
        void openApp("rules");
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [flat, cursor, prr]);

  const repoNames = prr.repos.filter((r) => r.review_mode !== "off").map((r) => r.full_name);
  let index = 0;

  return (
    <div className="c-app">
      <Header icon={GitPullRequest} title="Pull requests">
        {reviewing ? <span className="c-hide-sm"><Pill tone="info">Reviewing {reviewing} now</Pill></span> : null}
        {repoNames.length ? <span className="c-faint c-hide-sm prr-meta c-ellipsis" style={{ maxWidth: 260 }}>{repoNames.join(" · ")}</span> : null}
        <Button variant="ghost" icon={SettingsIcon} label="Settings" onClick={() => to.settings()} />
      </Header>
      <div className="c-toolbar">
        <Segmented
          label="Views"
          value={view}
          onChange={(v) => to.inbox(v)}
          items={[
            { id: "inbox", label: "Inbox", count: inboxCount },
            { id: "all", label: "All open", count: open.length },
            { id: "merged", label: "Merged" },
          ]}
        />
        <SearchField value={q} onChange={setQ} placeholder="Search pull requests" />
      </div>
      {prr.settings?.paused ? (
        <div className="prr-strip prr-strip--warn" role="status">Reviews are paused: new pushes aren't read until someone resumes them in Settings.</div>
      ) : null}

      <div className="prr-inbox">
        <div className="prr-list" ref={list}>
          {missing ? <div className="prr-pad"><ConnectGithub /></div> : null}
          {!prr.loaded ? (
            <div className="prr-pad"><Skeleton rows={8} /></div>
          ) : !flat.length && !(view === "inbox" && mergedWeek.length) ? (
            <Empty
              icon={GitPullRequest}
              title={q ? "No pull request matches" : view === "merged" ? "Nothing merged yet" : view === "all" ? "No open pull requests" : "Nothing waits on you"}
              action={q ? <Button size="sm" onClick={() => setQ("")}>Clear the search</Button> : view === "inbox" && open.length ? <Button size="sm" onClick={() => to.inbox("all")}>See all {open.length} open</Button> : undefined}
            >
              {q ? null : view === "inbox" ? "Pull requests that need your review or your press show here, with the rules each one was read against." : "Each pull request opened in the repositories you picked shows here once its first review starts."}
            </Empty>
          ) : (
            <>
              <div className="prr-colh" aria-hidden="true">
                <span />
                <span>Pull request</span>
                <span>Rules</span>
                <span>Findings</span>
                <span>Checks</span>
                <span>Review</span>
                <span>Waits on</span>
                <span className="prr-r">Age</span>
              </div>
              {groups.map((g) => (
                <section key={g.id + g.label} aria-label={g.label}>
                  <h2 className="prr-grp">
                    {g.label}
                    <span className="c-faint">{g.rows.length}</span>
                  </h2>
                  {g.rows.map((pr) => {
                    const i = index++;
                    return <Row key={pr.id} pr={pr} section={view === "inbox" ? g.id : prr.sectionOf(pr)} on={i === cursor} i={i} prr={prr} meId={me?.id} people={people} toast={toast} />;
                  })}
                </section>
              ))}
              {view === "inbox" ? (
                <section aria-label="Merged this week">
                  <h2 className="prr-grp">
                    Merged this week
                    <span className="c-faint">{mergedWeek.length}</span>
                    {mergedWeek.length ? (
                      <button type="button" className="prr-link" onClick={() => setShowMerged((v) => !v)} aria-expanded={showMerged}>
                        {showMerged ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        {showMerged ? "Hide" : "Show"}
                      </button>
                    ) : null}
                  </h2>
                  {showMerged ? mergedWeek.filter(match).map((pr) => <Row key={pr.id} pr={pr} section="merged" on={false} i={-1} prr={prr} meId={me?.id} people={people} toast={toast} />) : null}
                </section>
              ) : null}
            </>
          )}
          <div className="prr-keys c-faint c-hide-sm">
            <span><Kbd>j</Kbd> <Kbd>k</Kbd> move</span>
            <span><Kbd>o</Kbd> open</span>
            <span><Kbd>/</Kbd> search</span>
            {canOpenApps() ? <span><Kbd>r</Kbd> rules</span> : null}
          </div>
        </div>
        <Side prr={prr} />
      </div>
    </div>
  );
}

function Row({ pr, section, on, i, prr, meId, people, toast }: {
  pr: PullRequest; section: Section; on: boolean; i: number; prr: Prr; meId?: string; people: { user_id: string; name: string; email: string }[]; toast: (t: string) => void;
}) {
  const repo = prr.repoOf(pr);
  const round = prr.latest(pr);
  const findings = (prr.findingsByPr.get(pr.id) || []);
  const merged = section === "merged";
  const checks = useChecks(repo, pr.head_sha, !merged);
  const [busy, setBusy] = useState(false);
  const author = pr.author_kind === "agent" ? "opened by an agent" : prr.isMine(pr) ? "you" : pr.author || "someone";
  const size = pr.additions != null ? `+${pr.additions} −${pr.deletions ?? 0}` : "";
  const files = pr.changed_files != null ? plural(pr.changed_files, "file") : "";
  const waits = whoIs(prr, people, meId, pr.waits_on, pr.waits_on_name);
  const href = prPath(repo, pr.number);

  const hold = async (value: boolean) => {
    setBusy(true);
    try {
      const out = await act.hold(pr.id, value);
      toast(out?.message || (value ? `Held ${pr.key}: it waits for a person now.` : `${pr.key} merges by itself again.`));
    } catch (e) {
      toast(`Couldn't ${value ? "hold" : "release"} it: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const merge = async () => {
    setBusy(true);
    try {
      await mergeAsMe(repo, pr, prr.settings?.merge?.how);
      toast(`Merged ${pr.key} as you.`);
      void prr.reload("prs");
    } catch (e) {
      toast(`GitHub didn't merge it: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  let review: React.ReactNode = round ? `Round ${round.seq} · ${short(round.sha)}` : pr.review_state === "off" ? "Reviews off" : "Not reviewed";
  if (section === "itself") review = itselfText(prr, pr);
  if (merged) review = pr.merge_state === "merged_by_itself" ? "Merged by itself" : "Merged";

  let waitsCell: React.ReactNode = <span className="c-ellipsis">{waits}</span>;
  if (section === "itself") {
    waitsCell = (
      <span className="c-row" style={{ gap: 4 }}>
        <span className="c-faint">nobody ·</span>
        <button type="button" className="prr-link" disabled={busy} onClick={(e) => { e.stopPropagation(); void hold(pr.merge_state !== "held"); }}>
          {pr.merge_state === "held" ? "Unhold" : "Hold"}
        </button>
      </span>
    );
  } else if (section === "merge") {
    waitsCell = (
      <span className="c-row" style={{ gap: 4 }}>
        <span className="c-faint">you ·</span>
        <button type="button" className="prr-link" disabled={busy} onClick={(e) => { e.stopPropagation(); void merge(); }}>Merge</button>
      </span>
    );
  } else if (section === "returned") waitsCell = <span>you, to fix</span>;
  else if (section === "reviewing") waitsCell = <span className="c-faint">the review</span>;
  else if (merged) waitsCell = <span className="c-faint">—</span>;

  const note = section === "merge" && pr.risk && pr.risk !== "low" ? " · clean, but it needs a person" : pr.merge_state === "would_merge" ? " · would have merged by itself" : "";

  return (
    <div
      role="link"
      tabIndex={0}
      className={cx("prr-row", on && "is-on")}
      data-row={i}
      onClick={() => go(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) go(href);
      }}
    >
      <Avatar name={pr.author_kind === "agent" ? "Agent" : pr.author} size={22} />
      <div className="prr-row__pr">
        <div className="c-ellipsis prr-row__title">{pr.title}</div>
        <div className="c-faint c-ellipsis prr-meta">
          <span className="prr-mono">{repo}#{pr.number}</span> · {author}
          {size ? ` · ${size}` : ""}
          {files ? ` · ${files}` : ""}
          {note}
        </div>
      </div>
      <div className="prr-row__rules">{merged ? <span className="c-faint">—</span> : <RulesBar round={round} />}</div>
      <div className="prr-row__find">{merged ? <span className="c-faint">—</span> : <FindingsPill pr={pr} round={round} findings={findings} />}</div>
      <div className="prr-row__checks">{merged ? <span className="c-faint">—</span> : <ChecksPill list={checks.list} err={checks.err} last={pr.checks} />}</div>
      <div className="prr-row__review c-faint prr-meta c-ellipsis">{review}</div>
      <div className="prr-row__waits prr-meta" onClick={(e) => e.stopPropagation()}>{waitsCell}</div>
      <div className="prr-row__age c-faint prr-meta prr-r">{ago(merged ? pr.merged_at : AGE(pr))}</div>
    </div>
  );
}

/* ---------- this week, beside the list ---------- */

function Side({ prr }: { prr: Prr }) {
  const since = Date.now() - WEEK;
  const thisWeek = prr.findings.filter((f) => Date.parse(f.created_at || "") > since && f.rule_id);
  const byRule = new Map<string, number>();
  for (const f of thisWeek) byRule.set(f.rule_id!, (byRule.get(f.rule_id!) || 0) + 1);
  const broken = [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  const roundsWeek = prr.rounds.filter((r) => Date.parse(r.created_at || r.started_at || "") > since);
  const skipped = new Map<string, { text: string; note: string; prs: Set<string> }>();
  for (const r of roundsWeek)
    for (const x of r.ledger || [])
      if (x.state === "not_checked") {
        const k = x.rule_id || x.text;
        const e = skipped.get(k) || { text: x.text, note: x.note || "", prs: new Set<string>() };
        e.prs.add(r.pull_request_id);
        skipped.set(k, e);
      }
  const notChecked = [...skipped.values()].sort((a, b) => b.prs.size - a.prs.size).slice(0, 2);

  const logWeek = prr.log.filter((l) => Date.parse(l.at || l.created_at || "") > since);
  const mergedItself = new Set(logWeek.filter((l) => l.action === "merged").map((l) => l.pull_request_id)).size;
  const held = new Set(logWeek.filter((l) => l.action === "held").map((l) => l.pull_request_id)).size;
  const would = new Set(logWeek.filter((l) => l.action === "would_merge").map((l) => l.pull_request_id)).size;
  const modes = new Set(prr.repos.map((r) => r.merge_mode || "off"));
  const s = prr.settings;
  const bot = prr.botBlocked;
  const latestCheck = postWord(prr.rounds.find((r) => r.github?.check)?.github?.check) || postWord(prr.platform?.checks);
  const checkState = !s?.check_on ? "Off"
    : bot === "needs_platform" || latestCheck === "needs_platform" ? "Can't post yet: needs the platform update"
    : latestCheck === "no_permission" ? "Can't post yet: the GitHub App needs Checks write"
    : latestCheck === "ok" ? "Posting on every round" : latestCheck === "failed" ? "Didn't post on the last round" : "Not posted yet";
  const required = prr.repos.filter((r) => !!r.required_check);

  return (
    <aside className="prr-side" aria-label="This week">
      <Card
        title="Rules broken most this week"
        action={canOpenApps() ? <button type="button" className="prr-link" onClick={() => void openApp("rules")}>All rules</button> : undefined}
      >
        <div className="prr-sb">
          {broken.length ? broken.map(([id, n]) => (
            <div className="prr-srow" key={id}>
              <span>{prr.ruleById.get(id)?.text || "A rule since removed"}</span>
              <Pill tone={n >= 3 ? "danger" : "warning"}>{n}</Pill>
            </div>
          )) : <div className="c-muted">No rule broken in a review this week.</div>}
          <div className="c-faint prr-meta">Counted from findings raised in review rounds in the last 7 days.</div>
        </div>
      </Card>

      <Card title={<>Merged by itself <span className="c-count">this week</span></>} action={<button type="button" className="prr-link" onClick={() => to.settings("merging")}>When it merges</button>}>
        <div className="prr-sb">
          {modes.has("merge") ? (
            <>
              <div className="prr-srow"><span>{plural(mergedItself, "pull request")} merged with nobody pressing anything</span></div>
              <div className="prr-srow"><span>{held} held by a person before they merged</span><span className="c-muted c-row" style={{ gap: 4 }}><Hand size={13} aria-hidden="true" />Hold</span></div>
            </>
          ) : modes.has("watch") ? (
            <div className="prr-srow"><span>Watching: {plural(would, "pull request")} would have merged by itself</span><Pill dot={false}>Nothing merged</Pill></div>
          ) : (
            <div className="c-muted">Off. Small clean pull requests wait for one press under Ready for you to merge.</div>
          )}
          {s && (modes.has("merge") || modes.has("watch")) ? (
            <div className="c-faint prr-meta">
              Only {s.merge?.paths?.length ? s.merge.paths.join(", ") : "the paths you allow"}, at most {s.merge?.max_lines ?? 40} lines and {plural(s.merge?.max_files ?? 5, "file")}, every rule passed.
              {bot === "needs_platform" ? " Merging as the Lemma's bot needs the platform update; until then nothing merges by itself." : " Merged as the Lemma's bot."}
            </div>
          ) : null}
        </div>
      </Card>

      {notChecked.length ? (
        <Card title={<>Not checked <span className="c-count">this week</span></>}>
          <div className="prr-sb">
            {notChecked.map((x) => (
              <div key={x.text}>
                <div>{x.text}</div>
                <div className="c-faint prr-meta">Skipped on {plural(x.prs.size, "pull request")}{x.note ? `: ${x.note}` : ""}. Each pull request's page says so.</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="On GitHub" foot={<button type="button" className="prr-link" onClick={() => to.settings()}>Settings</button>}>
        <div className="prr-sb">
          <div className="prr-srow">
            <span>Lemma check{required.length ? <>, required on <span className="prr-mono">{required[0].default_branch || "main"}</span></> : ""}</span>
            <span className={cx("prr-meta", checkState.startsWith("Can't") ? "prr-warn" : "c-muted")}>{checkState}</span>
          </div>
          <div className="prr-srow"><span>Reviews posted as</span><span className="c-muted">{s?.posts_as === "reviewer" ? "each reviewer" : "the Lemma's bot"}</span></div>
          <div className="prr-srow"><span>Comments on GitHub</span><span className="c-muted">{s?.comments === "summary" ? "One summary" : s?.comments === "review" ? "Findings as a review" : "Off"}</span></div>
        </div>
      </Card>
      {prr.sample ? null : <div className="prr-meta c-faint prr-sidefoot"><ListChecks size={13} aria-hidden="true" /> {plural(prr.rules.filter((r) => r.state === "active").length, "active rule")} · {plural(prr.rules.filter((r) => r.state === "proposed").length, "proposed")}</div>}
    </aside>
  );
}
