// Settings (S2) and its Merging page (A3). Every change goes through
// prr_setup_save, which checks the person may make it and logs it; risky
// paths are their own rows. What GitHub says about a repository (branch
// protection, auto-merge, a merge queue) is read, never set, here.

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Clock, ExternalLink, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Button, Card, Connect, Header, Pill, Switch, client, create, cx, plural, update, useToast } from "@lemma-plugins/kit";
import { act, errText, postWord, usePrr, useWho, WEEK, type Prr } from "./data";
import { MY_GITHUB, SHARED_GITHUB } from "./marks";
import { to, useRoute } from "./route";
import type { MergeMode, MergePolicy, ReviewMode, Settings as SettingsRow } from "./types";

const MERGE_DEFAULTS: Required<Pick<MergePolicy, "paths" | "max_lines" | "max_files" | "wait_minutes" | "how">> = {
  paths: ["docs/**", "**/package-lock.json", "**/uv.lock"],
  max_lines: 40,
  max_files: 5,
  wait_minutes: 10,
  how: "auto",
};

/** How a condition that failed reads in the record, by the name prr_merge gives it. */
const REFUSED: Record<string, string> = {
  paths: "changed a file outside the paths",
  size: "were too big",
  lines: "were over the line limit",
  files: "changed too many files",
  rules: "broke a rule",
  not_checked: "had a rule not checked",
  findings: "had an open finding",
  risk: "touched a risky path",
  author: "came from outside the team",
  checks: "had a check not passing",
  mergeable: "couldn't merge on GitHub",
  gate: "changed the rules or who reviews",
  gate_files: "changed the rules or who reviews",
  review: "had a review that didn't finish",
  round_finished: "had a review that didn't finish",
  open: "were closed or drafts",
  not_held: "were held",
  daily_cap: "came after the day's cap",
  how: "couldn't merge the chosen way",
  wait: "were still in their wait",
};

export const NEVER = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", "REVIEW.md", ".cursor/BUGBOT.md", "CODEOWNERS", ".github/**"];

function useSave() {
  const prr = usePrr();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const save = async (what: string, input: Record<string, unknown>, done: string) => {
    setBusy(what);
    try {
      const out = await act.setup(input);
      toast(out?.saved === false ? out.message || "Not saved." : out?.message || done);
      await prr.reload();
    } catch (e) {
      toast(`Couldn't save: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };
  // prr_setup_save takes the settings flat; pausing and the daily merge cap are plain fields of the row.
  const direct = async (what: string, patch: Partial<SettingsRow>, done: string) => {
    if (!prr.settings) return;
    setBusy(what);
    try {
      await update("prr_settings", prr.settings.id, patch as Record<string, unknown>);
      toast(done);
    } catch (e) {
      toast(`Couldn't save: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const setSettings = (what: string, patch: Partial<SettingsRow>, done = "Saved.") =>
    "paused" in patch || "daily_merge_cap" in patch ? direct(what, patch, done) : save(what, patch as Record<string, unknown>, done);
  /** A repository's modes, both sent: the function resets one it isn't given. */
  const setRepo = (what: string, r: { full_name: string; review_mode: string | null; merge_mode: string | null }, patch: { review_mode?: string; merge_mode?: string }, done: string) =>
    save(what, { repos: [{ full_name: r.full_name, review_mode: patch.review_mode || r.review_mode || "every_push", merge_mode: patch.merge_mode || r.merge_mode || "off" }] }, done);
  return { busy, save, setSettings, setRepo };
}

function Sec({ id, title, sub, children }: { id?: string; title: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="prr-sec" id={id}>
      <h2>{title}</h2>
      {sub ? <div className="c-faint prr-meta prr-sec__sub">{sub}</div> : null}
      <div className="c-card">{children}</div>
    </section>
  );
}

function Opt({ name, checked, onChange, title, note, disabled }: { name: string; checked: boolean; onChange: () => void; title: ReactNode; note?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("prr-opt", disabled && "is-off")}>
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="c-check" />
      <div style={{ minWidth: 0 }}>
        <div>{title}</div>
        {note ? <div className="c-faint prr-meta">{note}</div> : null}
      </div>
    </label>
  );
}

function SetRow({ title, note, children }: { title: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="prr-setrow">
      <div style={{ minWidth: 0 }}>
        <div>{title}</div>
        {note ? <div className="c-faint prr-meta">{note}</div> : null}
      </div>
      {children ? <div className="prr-setrow__ctl">{children}</div> : null}
    </div>
  );
}

function platformPill(prr: Prr, kind: "app" | "checks"): ReactNode {
  const w = postWord(prr.platform?.[kind]);
  if (w === "needs_platform") return <Pill tone="warning">Can't post yet</Pill>;
  if (w === "no_permission") return <Pill tone="warning">Needs a permission</Pill>;
  if (w === "ok") return <Pill tone="success">Working</Pill>;
  return null;
}

const NAV = [
  ["github", "On GitHub"],
  ["repositories", "Repositories"],
  ["reviews", "Reviews"],
  ["people", "People and risky paths"],
  ["merging", "Merging"],
  ["connection", "Connection"],
] as const;

export function Settings() {
  const prr = usePrr();
  const { canAdmin } = useWho();
  const { busy, setSettings, setRepo } = useSave();
  const s = prr.settings;
  const route = useRoute();
  const [section, setSection] = useState<string>(route.page === "settings" && route.sub === "connection" ? "connection" : "github");
  const locked = !canAdmin;
  const jump = (id: string) => {
    setSection(id);
    if (id === "merging") return to.settings("merging");
    document.getElementById(`s-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const checks = postWord(prr.platform?.checks);
  const app = postWord(prr.platform?.app);
  // Sent here to connect your own GitHub: open on that section.
  useEffect(() => {
    if (section === "connection") window.setTimeout(() => document.getElementById("s-connection")?.scrollIntoView({ block: "start" }), 80);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="c-app">
      <Header back={{ label: "Pull requests", icon: ArrowLeft, onClick: () => to.inbox() }} title="Settings">
        <span className="c-faint prr-meta c-hide-sm">{locked ? "Only admins of this Lemma can change these." : "Every change is logged."}</span>
      </Header>
      <div className="prr-settings">
        <nav className="c-nav prr-settings__nav" aria-label="Settings">
          {NAV.map(([id, label]) => (
            <button key={id} type="button" className="c-nav__item" aria-current={section === id ? "page" : undefined} onClick={() => jump(id)}>{label}</button>
          ))}
        </nav>
        <main className="prr-settings__main">
          <div id="s-github" className="prr-anchor" />
          <Sec title="Who posts on GitHub">
            <Opt name="who" checked={s?.posts_as === "bot"} disabled={locked} onChange={() => void setSettings("who", { posts_as: "bot" }, "The Lemma's bot posts from now on.")}
              title={<span className="c-row">The Lemma's bot {app === "needs_platform" || app === "no_permission" ? platformPill(prr, "app") : null}</span>}
              note={<>Posts by itself after each review round: the check, and the review when someone sends one back. Works with nobody signed in.{app === "needs_platform" ? " It needs the platform update before it can post; until then nothing posts as the bot." : ""}</>} />
            <Opt name="who" checked={s?.posts_as !== "bot"} disabled={locked} onChange={() => void setSettings("who", { posts_as: "reviewer" }, "Each reviewer posts as themselves from now on.")}
              title="Each reviewer, as themselves"
              note="Nothing posts until a reviewer presses Send back or Approve, and then it is their name on GitHub, through their own GitHub connection: each reviewer connects it once, under Connection below. GitHub never lets the author approve their own pull request." />
          </Sec>

          <Sec id="prr-check" title="The Lemma check">
            <SetRow title="Post a check on every pull request" note="Passed, broken rules, or needs a person, with a link back to the pull request here. Branch protection can require it.">
              {checks === "needs_platform" || checks === "no_permission" ? platformPill(prr, "checks") : null}
              <Switch label="Post a check on every pull request" checked={!!s?.check_on} disabled={locked || busy === "check"} onChange={(v) => void setSettings("check", { check_on: v }, v ? "The Lemma check posts on the next round." : "The Lemma check is off.")} />
            </SetRow>
            {checks === "no_permission" ? (
              <SetRow title={<span className="c-muted">The GitHub App can read checks but not write them. An organization admin accepts the new permission on GitHub, then the next round posts.</span>} />
            ) : checks === "needs_platform" ? (
              <SetRow title={<span className="c-muted">Posting a check needs the platform update that lets the Lemma's GitHub App write checks. Until it is deployed the check stays off.</span>} />
            ) : null}
            {prr.repos.map((r) => (
              <SetRow key={r.id} title={<>Required on <span className="prr-mono">{r.full_name}</span>, branch <span className="prr-mono">{r.default_branch || "main"}</span></>}
                note={r.required_check ? `Branch protection requires “${r.required_check}”.` : "Set in GitHub's branch protection, not here. We read whether it is required."}>
                {r.required_check ? <Pill tone="success">Required</Pill> : <Pill dot={false}>Not required</Pill>}
                {r.html_url ? <Button size="sm" icon={ExternalLink} onClick={() => window.open(`${r.html_url}/settings/branches`, "_blank", "noopener")}><span className="c-hide-sm">Branch protection</span></Button> : null}
              </SetRow>
            ))}
          </Sec>

          <Sec title="Approving">
            <SetRow title="Approve when every rule passes" note="The bot approves a round with no rule broken and withdraws its approval when a later push breaks one. Never for an author outside the team or a high-risk pull request: those wait on a person.">
              <Switch label="Approve when every rule passes" checked={!!s?.approve_when_clean} disabled={locked || busy === "approve"} onChange={(v) => void setSettings("approve", { approve_when_clean: v }, v ? "The bot approves clean rounds." : "The bot no longer approves.")} />
            </SetRow>
            <SetRow title={<span className="c-muted">GitHub's docs don't say whether an approval by an app counts toward required reviews. Until that is tested on your repositories, treat the bot's approval as a signal, not a way past branch protection.</span>} />
          </Sec>

          <Sec title="Comments on GitHub">
            <Opt name="cm" checked={!s?.comments || s.comments === "off"} disabled={locked} onChange={() => void setSettings("cm", { comments: "off" }, "No comments on GitHub.")} title="None" note="The check and this app say it all. Many repositories already have bots commenting." />
            <Opt name="cm" checked={s?.comments === "summary"} disabled={locked} onChange={() => void setSettings("cm", { comments: "summary" }, "One summary comment, edited each round.")} title="One summary comment, edited in place each round" />
            <Opt name="cm" checked={s?.comments === "review"} disabled={locked} onChange={() => void setSettings("cm", { comments: "review" }, "Findings post as a review each round.")} title="The findings on their lines, as a review" note="Posted once per round. A finding fixed or dismissed is not posted again." />
          </Sec>

          <div id="s-repositories" className="prr-anchor" />
          <Sec title="Repositories">
            {prr.repos.length ? prr.repos.map((r) => (
              <SetRow key={r.id} title={<span className="prr-mono">{r.full_name}</span>}
                note={<>Rules read from <span className="prr-mono">{r.default_branch || "main"}</span> · {plural(prr.rules.filter((x) => x.state === "active" && (!x.repo || x.repo === r.full_name)).length, "active rule")}</>}>
                <select className="c-select prr-select" aria-label={`When ${r.full_name} is reviewed`} value={r.review_mode || "every_push"} disabled={locked}
                  onChange={(e) => void setRepo(`repo-${r.id}`, r, { review_mode: e.target.value as ReviewMode }, `${r.full_name}: saved.`)}>
                  <option value="every_push">Every push</option>
                  <option value="once">Once, when opened</option>
                  <option value="off">Off</option>
                </select>
              </SetRow>
            )) : <SetRow title={<span className="c-muted">No repository picked yet.</span>} />}
            <SetRow title={<span className="c-muted">Each review reads the pull request at its head commit in a checkout of its own, and never pushes to it.</span>}>
              <Button size="sm" icon={Plus} disabled={locked} onClick={() => to.setup()}>Pick repositories</Button>
            </SetRow>
          </Sec>

          <div id="s-reviews" className="prr-anchor" />
          <Sec title="Reviews">
            <SetRow title="Pause reviews" note="Nothing new is read while it is on; pull requests already reviewed keep their rounds.">
              <Switch label="Pause reviews" checked={!!s?.paused} disabled={locked || busy === "pause"} onChange={(v) => void setSettings("pause", { paused: v }, v ? "Reviews are paused." : "Reviews start again on the next push.")} />
            </SetRow>
            <SetRow title="At most this many rounds a day" note="Past it, a push waits for the next day, and the inbox says so.">
              <NumberInput value={s?.daily_cap ?? 60} disabled={locked} label="Rounds a day" onSave={(n) => void setSettings("cap", { daily_cap: n }, `At most ${n} rounds a day.`)} />
            </SetRow>
            <SetRow title="Rules read from files start active" note="Off: everything read from AGENTS.md, CONTRIBUTING.md and the like is proposed first, like the rules drawn from review comments.">
              <Switch label="Rules read from files start active" checked={!!s?.accept_file_rules} disabled={locked} onChange={(v) => void setSettings("files", { accept_file_rules: v })} />
            </SetRow>
          </Sec>

          <div id="s-people" className="prr-anchor" />
          <People locked={locked} />

          <div id="s-merging" className="prr-anchor" />
          <Sec title="Merging">
            <SetRow title={<>Merging by itself: {summaryOfModes(prr)}</>} note="Small clean pull requests, checked by code on the latest commit.">
              <Button size="sm" icon={SlidersHorizontal} onClick={() => to.settings("merging")}>When it merges</Button>
            </SetRow>
          </Sec>

          <div id="s-connection" className="prr-anchor" />
          <Connection />
        </main>
      </div>
    </div>
  );
}

function summaryOfModes(prr: Prr): string {
  const modes = new Set(prr.repos.map((r) => r.merge_mode || "off"));
  if (modes.has("merge")) return "on";
  if (modes.has("watch")) return "watching first";
  return "off";
}

function NumberInput({ value, onSave, label, disabled, max = 999 }: { value: number; onSave: (n: number) => void; label: string; disabled?: boolean; max?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Math.max(0, Math.min(max, Math.round(Number(v))));
    if (!Number.isFinite(n) || n === value) return setV(String(value));
    onSave(n);
  };
  return <input className="c-input prr-num num" inputMode="numeric" aria-label={label} value={v} disabled={disabled} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

function People({ locked }: { locked: boolean }) {
  const prr = usePrr();
  const { people } = useWho();
  const toast = useToast();
  const [glob, setGlob] = useState("");
  const [who, setWho] = useState("");
  const add = async () => {
    if (!glob.trim()) return;
    const person = people.find((p) => p.user_id === who);
    try {
      await create("prr_risk_path", { glob: glob.trim(), tier: "high", state: "active", reviewer_user_id: person?.user_id || null, reviewer_name: person?.name || null, reason: "added in Settings" });
      setGlob("");
      toast(`${glob.trim()} is a risky path now.`);
    } catch (e) {
      toast(`Couldn't add it: ${errText(e)}`);
    }
  };
  const remove = async (id: string, g: string) => {
    try {
      await client.records.delete("prr_risk_path", id);
      toast(`${g} is no longer a risky path.`);
      void prr.reload("risk");
    } catch (e) {
      toast(`Couldn't remove it: ${errText(e)}`);
    }
  };
  return (
    <section className="prr-sec">
      <h2>People and risky paths</h2>
      <div className="c-faint prr-meta prr-sec__sub">A change on a risky path is high risk: it waits for the person named, and never merges by itself.</div>
      <div className="c-card">
        {prr.risk.filter((r) => r.state !== "proposed").map((r) => (
          <SetRow key={r.id} title={<span className="prr-mono">{r.glob}</span>} note={<>{r.reviewer_name ? `Reviewed by ${r.reviewer_name}` : "Any member reviews it"}{r.repo ? ` · ${r.repo} only` : ""}{r.reason ? ` · ${r.reason}` : ""}</>}>
            <Pill tone={r.tier === "high" ? "danger" : "warning"}>{r.tier === "high" ? "High" : "Medium"}</Pill>
            {!locked ? <Button size="sm" variant="ghost" icon={Trash2} label={`Remove ${r.glob}`} onClick={() => void remove(r.id, r.glob)} /> : null}
          </SetRow>
        ))}
        {prr.risk.some((r) => r.state === "proposed") ? (
          <SetRow title={<span className="c-muted">{plural(prr.risk.filter((r) => r.state === "proposed").length, "risky path")} proposed from the rule files, waiting in Rules.</span>} />
        ) : null}
        {!locked ? (
          <div className="prr-setrow prr-addrow">
            <input className="c-input prr-mono" placeholder="billing/**" aria-label="Path" value={glob} onChange={(e) => setGlob(e.target.value)} />
            <select className="c-select prr-select" aria-label="Who reviews it" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Any member</option>
              {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
            </select>
            <Button size="sm" icon={Plus} disabled={!glob.trim()} onClick={() => void add()}>Add a risky path</Button>
          </div>
        ) : null}
        <div className="prr-setrow prr-people">
          <div style={{ minWidth: 0, width: "100%" }}>
            <div>GitHub logins on the team</div>
            <div className="c-faint prr-meta">A login with no member here is outside the team: its pull requests always wait on a person.</div>
            <div className="prr-chips" style={{ marginTop: 8 }}>
              {prr.members.map((m) => (
                <span key={m.id} className="prr-chip">
                  <span className="prr-mono">{m.login}</span>
                  <span className="c-faint">{m.name ? ` · ${m.name}` : " · not matched"}{m.owns?.length ? ` · owns ${m.owns.join(", ")}` : ""}</span>
                </span>
              ))}
              {!prr.members.length ? <span className="c-muted">None read yet: set-up matches logins to members from the repositories' contributors.</span> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Connection() {
  return (
    <section className="prr-sec">
      <h2>Connection</h2>
      <div className="c-card">
        <div className="prr-conn">
          <div>The Lemma's GitHub</div>
          <div className="c-faint prr-meta">Shared by everyone here: what it reads, and what the Lemma's bot posts.</div>
          <Connect {...SHARED_GITHUB} />
        </div>
        <div className="prr-conn">
          <div>Your own GitHub</div>
          <div className="c-faint prr-meta">Only for what you press in your own name: send back as you, approve, merge.</div>
          <Connect {...MY_GITHUB} />
        </div>
      </div>
    </section>
  );
}

/* ---------- Merging (A3) ---------- */

export function Merging() {
  const prr = usePrr();
  const { canAdmin } = useWho();
  const { busy, save, setSettings, setRepo } = useSave();
  const s = prr.settings;
  const m: MergePolicy = { ...MERGE_DEFAULTS, ...(s?.merge || {}) };
  const locked = !canAdmin;
  const setMerge = (what: string, patch: Partial<MergePolicy>, done = "Saved.") => setSettings(what, { merge: { ...m, ...patch } }, done);
  const modes = new Set(prr.repos.map((r) => r.merge_mode || "off"));
  const mode: MergeMode = modes.size === 1 ? ([...modes][0] as MergeMode) : modes.has("merge") ? "merge" : modes.has("watch") ? "watch" : "off";
  const setMode = (next: MergeMode, done: string) =>
    save("mode", { repos: prr.repos.map((r) => ({ full_name: r.full_name, review_mode: r.review_mode || "every_push", merge_mode: next })) }, done);
  const [path, setPath] = useState("");
  const bot = prr.botBlocked;
  const queueRepos = prr.repos.filter((r) => r.merge_queue);
  const autoRepos = prr.repos.filter((r) => r.allow_auto_merge);
  const approvals = prr.repos.filter((r) => (r.required_approvals || 0) > 0);

  // The watch record: the last 7 days.
  const since = Date.now() - WEEK;
  const week = prr.log.filter((l) => Date.parse(l.at || l.created_at || "") > since);
  const wouldIds = [...new Set(week.filter((l) => l.action === "would_merge").map((l) => l.pull_request_id))];
  const prOf = (id: string) => prr.prs.find((p) => p.id === id);
  const heldIds = new Set(week.filter((l) => l.action === "held").map((l) => l.pull_request_id));
  const seen = wouldIds.map((id) => {
    const pr = prOf(id);
    const would = week.find((l) => l.pull_request_id === id && l.action === "would_merge");
    const later = pr?.merged_at && would?.at ? Math.max(0, Date.parse(pr.merged_at) - Date.parse(would.at)) : null;
    const held = heldIds.has(id);
    const outcome = held ? `held${week.find((l) => l.pull_request_id === id && l.action === "held")?.note ? `: ${week.find((l) => l.pull_request_id === id && l.action === "held")!.note}` : ""}`
      : later != null ? `merged by a person ${later < 3_600_000 ? `${Math.max(1, Math.round(later / 60_000))} min` : later < 86_400_000 ? `${Math.round(later / 3_600_000)} h` : `${Math.round(later / 86_400_000)} days`} later`
      : pr?.state === "open" ? "still open" : "closed";
    return { id, pr, outcome, later, held };
  });
  const personMerged = seen.filter((x) => x.later != null).length;
  const waits = seen.map((x) => x.later).filter((x): x is number => x != null).sort((a, b) => a - b);
  const median = waits.length ? waits[Math.floor(waits.length / 2)] : null;
  const refused = week.filter((l) => l.action === "refused");
  const reasons = new Map<string, Set<string>>();
  for (const l of refused) for (const c of l.conditions || []) if (!c.ok) (reasons.get(c.name) || reasons.set(c.name, new Set()).get(c.name)!).add(l.pull_request_id);
  const mergedItself = new Set(week.filter((l) => l.action === "merged").map((l) => l.pull_request_id)).size;

  const Cond = ({ ok = true, title, note, children, right }: { ok?: boolean; title: ReactNode; note?: ReactNode; children?: ReactNode; right?: ReactNode }) => (
    <div className="prr-cond">
      {ok ? <Check size={14} className="prr-ok" aria-hidden="true" /> : <X size={14} className="prr-bad" aria-hidden="true" />}
      <div style={{ minWidth: 0 }}>
        <div>{title}</div>
        {children}
        {note ? <div className="c-faint prr-meta">{note}</div> : null}
      </div>
      {right ? <div className="prr-cond__r">{right}</div> : <span />}
    </div>
  );

  return (
    <div className="c-app">
      <Header back={{ label: "Settings", icon: ArrowLeft, onClick: () => to.settings() }} title="Merging">
        <span className="c-faint prr-meta c-hide-sm">{locked ? "Only admins of this Lemma can change this." : "Only admins of this Lemma can change this. Every change is logged."}</span>
      </Header>
      <div className="prr-merging">
        <main className="prr-merging__main">
          <div>
            <h1 className="prr-h1">When a pull request merges by itself</h1>
            <div className="c-faint" style={{ marginTop: 4 }}>For small, clean changes nobody needs to read. Everything below is checked by code on the latest commit; the model never decides it alone.</div>
          </div>
          {bot ? (
            <div className="prr-strip prr-strip--warn" role="status">
              {bot === "needs_platform" ? "Merging as the Lemma's bot needs the platform update. Until it is deployed, Merge by itself records what it would do and merges nothing, like Watch first." : "The Lemma's GitHub App is missing a permission it needs to merge. An organization admin accepts it on GitHub."}
            </div>
          ) : null}

          <section className="prr-sec">
            <h2>Mode</h2>
            <div className="c-card">
              <Opt name="mode" checked={mode === "off"} disabled={locked} onChange={() => void setMode("off", "Merging by itself is off.")} title="Off" note="Clean pull requests show under Ready for you to merge, one press each." />
              <Opt name="mode" checked={mode === "watch"} disabled={locked} onChange={() => void setMode("watch", "Watching: it records what would have merged.")} title="Watch first" note="Marks what would have merged, and merges nothing. Start here for a week; the record is beside this." />
              <Opt name="mode" checked={mode === "merge"} disabled={locked} onChange={() => void setMode("merge", "Merging small clean pull requests by itself.")} title="Merge by itself" note={<>Merges as the Lemma's bot when every condition below holds.{bot === "needs_platform" ? " Needs the platform update first." : ""}</>} />
              {prr.repos.length > 1 ? (
                <div className="prr-setrow">
                  <div className="c-faint prr-meta" style={{ minWidth: 0 }}>Per repository</div>
                  <div className="prr-setrow__ctl prr-wrap">
                    {prr.repos.map((r) => (
                      <label key={r.id} className="c-row prr-meta">
                        <span className="prr-mono">{r.full_name}</span>
                        <select className="c-select prr-select" value={r.merge_mode || "off"} disabled={locked} aria-label={`Merging for ${r.full_name}`}
                          onChange={(e) => void setRepo(`m-${r.id}`, r, { merge_mode: e.target.value as MergeMode }, `${r.full_name}: saved.`)}>
                          <option value="off">Off</option>
                          <option value="watch">Watch first</option>
                          <option value="merge">Merge by itself</option>
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="prr-sec">
            <h2>Every one of these must hold</h2>
            <div className="c-faint prr-meta prr-sec__sub">One that can't be checked counts as not holding: a review that didn't finish is not clean.</div>
            <div className="c-card">
              <Cond title="Every changed file is in one of these" note="One file outside them and it waits for a person.">
                <div className="prr-chips" style={{ marginTop: 6 }}>
                  {(m.paths || []).map((p) => (
                    <span key={p} className="prr-chip prr-mono">
                      {p}
                      {!locked ? <button type="button" className="prr-chip__x" aria-label={`Remove ${p}`} onClick={() => void setMerge("paths", { paths: (m.paths || []).filter((x) => x !== p) })}><X size={11} /></button> : null}
                    </span>
                  ))}
                  {!locked ? (
                    <form className="c-row" onSubmit={(e) => { e.preventDefault(); if (path.trim()) { void setMerge("paths", { paths: [...new Set([...(m.paths || []), path.trim()])] }, `${path.trim()} added.`); setPath(""); } }}>
                      <input className="c-input prr-chipin prr-mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Add a path" aria-label="Add a path" />
                    </form>
                  ) : null}
                </div>
              </Cond>
              <Cond title="Small" note="Lockfiles and generated files not counted."
                right={<span className="c-row prr-meta" style={{ flexWrap: "wrap" }}>at most <NumberInput label="At most lines" value={m.max_lines ?? 40} disabled={locked} onSave={(n) => void setMerge("lines", { max_lines: n })} /> lines, <NumberInput label="At most files" value={m.max_files ?? 5} disabled={locked} onSave={(n) => void setMerge("files", { max_files: n })} /> files</span>} />
              <Cond title="Every rule in scope passed, and none was skipped as not checked" />
              <Cond title="No open finding, of any severity, on the latest commit" />
              <Cond title="Low risk: it touches none of your risky paths" right={<button type="button" className="prr-link" onClick={() => { to.settings(); window.setTimeout(() => document.getElementById("s-people")?.scrollIntoView(), 80); }}>Risky paths</button>} />
              <Cond title="Opened by someone on the team, or by Dependency updates" note="Never an outside contributor. Never a pull request the bot opened and nobody on the team asked for." />
              <Cond title="Every GitHub check passed, and GitHub says it can merge" />
              <Cond ok={!!m.allow_no_checks} title="Merge when the repository has no checks at all" note="Nothing would have checked the change."
                right={<Switch label="Merge when the repository has no checks at all" checked={!!m.allow_no_checks} disabled={locked || busy === "nochecks"} onChange={(v) => void setMerge("nochecks", { allow_no_checks: v }, v ? "A repository with no checks can merge by itself." : "A repository with no checks waits for a person.")} />} />
              <Cond ok={false} title="Never when it changes the rules or who reviews" note={<>Fixed, not a setting: a pull request can't loosen its own gate. Rules are read from the default branch.</>}>
                <div className="prr-chips" style={{ marginTop: 6 }}>{NEVER.map((p) => <span key={p} className="prr-chip prr-mono">{p}</span>)}</div>
              </Cond>
            </div>
          </section>

          <section className="prr-sec">
            <h2>Before it merges</h2>
            <div className="c-card">
              <Cond ok title={<span className="c-row"><Clock size={14} className="c-muted" aria-hidden="true" />Wait after the last push</span>}
                note={<>It shows under Merging by itself, with Hold. A <span className="prr-mono">lemma-hold</span> label on GitHub holds it too. A new push starts the wait again.</>}
                right={
                  <select className="c-select prr-select" aria-label="Wait after the last push" value={String(m.wait_minutes ?? 10)} disabled={locked} onChange={(e) => void setMerge("wait", { wait_minutes: Number(e.target.value) })}>
                    <option value="10">10 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="720">12 hours</option>
                  </select>
                } />
              <Cond title="At most this many a day" right={<NumberInput label="Merges a day" value={s?.daily_merge_cap ?? 20} disabled={locked} onSave={(n) => void setSettings("mcap", { daily_merge_cap: n })} />} />
            </div>
          </section>

          <section className="prr-sec">
            <h2>How it merges</h2>
            <div className="c-card">
              <Opt name="how" checked={(m.how || "auto") === "auto"} disabled={locked} onChange={() => void setMerge("how", { how: "auto" })} title="Turn on GitHub's auto-merge"
                note={<>GitHub merges when its own requirements are met. Needs “Allow auto-merge” on the repository{prr.repos.length ? <>: {autoRepos.length ? `on for ${autoRepos.map((r) => r.full_name).join(", ")}` : "off on every repository picked"}</> : ""}.</>} />
              <Opt name="how" checked={m.how === "queue"} disabled={locked} onChange={() => void setMerge("how", { how: "queue" })} title="Add it to the merge queue"
                note={<>For repositories with a merge queue on the default branch{prr.repos.length ? <>: {queueRepos.length ? queueRepos.map((r) => r.full_name).join(", ") : "none of yours has one"}</> : ""}.</>} />
              <Opt name="how" checked={m.how === "squash"} disabled={locked} onChange={() => void setMerge("how", { how: "squash" })} title="Squash and merge" />
              {approvals.length ? (
                <div className="prr-opt prr-opt--note">
                  <div className="c-muted prr-meta">
                    {approvals.map((r) => `${r.full_name} requires ${plural(r.required_approvals || 0, "approving review")}`).join("; ")}. The bot approves first, then merges. GitHub's docs don't say whether an app's approval counts; if it doesn't, an admin adds the Lemma's app to the ruleset's bypass list on GitHub.
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </main>

        <aside className="prr-merging__side" aria-label="Watch record">
          <Card title={<>Would have merged <span className="c-count">last 7 days{mode === "watch" ? ", watching" : ""}</span></>}>
            <div className="prr-sb">
              <div className="c-row" style={{ flexWrap: "wrap", gap: 6 }}>
                <Pill tone="success">{wouldIds.length} would have merged</Pill>
                <Pill dot={false}>{personMerged} merged by a person</Pill>
                {heldIds.size ? <Pill tone="warning">{heldIds.size} held</Pill> : null}
                {mergedItself ? <Pill tone="info">{mergedItself} merged by itself</Pill> : null}
              </div>
              {median != null ? <div className="c-faint prr-meta">Median wait it would have saved: {median < 3_600_000 ? `${Math.max(1, Math.round(median / 60_000))} minutes` : `${Math.round(median / 3_600_000)} hours`}.</div> : null}
              {!seen.length ? <div className="c-muted">Nothing yet. {mode === "off" ? "Turn on Watch first to start a record." : "The record fills as small clean pull requests come in."}</div> : null}
            </div>
            {seen.length ? (
              <div className="prr-wr">
                {seen.slice(0, 8).map((x) => (
                  <button key={x.id} type="button" className="prr-wr__row" onClick={() => x.pr && to.pr(prr.repoOf(x.pr), x.pr.number)}>
                    <div className="c-ellipsis">{x.pr?.title || "A pull request"}</div>
                    <div className="c-faint prr-meta"><span className="prr-mono">{x.pr ? `${prr.repoOf(x.pr)}#${x.pr.number}` : ""}</span>{x.pr ? ` · +${x.pr.additions ?? 0} −${x.pr.deletions ?? 0}` : ""} · {x.outcome}</div>
                  </button>
                ))}
              </div>
            ) : null}
          </Card>
          <Card title="Never merged by itself">
            <div className="prr-sb">
              {reasons.size ? (
                <div className="c-muted prr-meta">Seen this week and kept for a person: {[...reasons.entries()].sort((a, b) => b[1].size - a[1].size).map(([name, set]) => `${set.size} ${REFUSED[name] || `failed “${name}”`}`).join(", ")}.</div>
              ) : <div className="c-muted prr-meta">Nothing kept back this week.</div>}
            </div>
          </Card>
          {mode !== "merge" && !locked ? (
            <Button variant="primary" busy={busy === "mode"} onClick={() => void setMode("merge", "Merging small clean pull requests by itself.")}>Start merging by itself</Button>
          ) : null}
          {mode === "merge" ? <div className="c-faint prr-meta">Anyone on the team can hold one from the inbox before it merges.</div> : null}
        </aside>
      </div>
    </div>
  );
}
