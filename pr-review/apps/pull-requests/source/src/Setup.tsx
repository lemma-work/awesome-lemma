// First run: connect GitHub, pick the repositories, read their rule files.
// Or look around on a sample first. Picking again later comes back here.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, FlaskConical, GitPullRequest, Lock } from "lucide-react";
import { Button, Face, Header, SearchField, Spinner, canOpenApps, openApp, plural, q as query, useToast } from "@lemma-plugins/kit";
import { act, ensureMine, ensureTeamSchedules, errText, usePrr, useWho } from "./data";
import { githubSays, myRepos, needsGithub, type GhRepo } from "./github";
import { ConnectGithub } from "./marks";
import { to } from "./route";

export const RULE_FILES = ["AGENTS.md", "CLAUDE.md", "REVIEW.md", "CONTRIBUTING.md", ".github/copilot-instructions.md", ".github/instructions/*.instructions.md", ".cursor/BUGBOT.md"];

export function Setup() {
  const prr = usePrr();
  const { canAdmin, me } = useWho();
  const toast = useToast();
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [problem, setProblem] = useState<"missing" | string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(prr.repos.map((r) => r.full_name)));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const again = !!prr.settings?.setup_done_at;

  useEffect(() => {
    let alive = true;
    setProblem(null);
    myRepos()
      .then((list) => alive && setRepos(list))
      .catch((e) => alive && setProblem(needsGithub(e) ? "missing" : githubSays(e)));
    return () => {
      alive = false;
    };
  }, [tick]);

  const shown = useMemo(() => (repos || []).filter((r) => !q || r.full_name.toLowerCase().includes(q.toLowerCase())).slice(0, 60), [repos, q]);

  const start = async () => {
    setBusy("start");
    try {
      const had = new Map(prr.repos.map((r) => [r.full_name, r]));
      const list = (repos || []).filter((r) => picked.has(r.full_name)).map((r) => ({
        full_name: r.full_name, review_mode: had.get(r.full_name)?.review_mode || "every_push", merge_mode: had.get(r.full_name)?.merge_mode || "off",
      }));
      const out = await act.setup({ repos: list, read_rules: true });
      if (out?.saved === false) {
        toast(out.message || "Not saved.");
        return;
      }
      if (me) {
        const row = (await query<{ id: string }>("SELECT id FROM prr_settings ORDER BY created_at LIMIT 1"))[0];
        const problem = await ensureTeamSchedules(row?.id, me.id, out?.schedules?.length ? out.schedules : undefined);
        const mine = await ensureMine(me.id);
        if (problem || mine) toast([problem, mine].filter(Boolean).join(" "));
      }
      toast(out?.message || `Reading the rule files in ${plural(list.length, "repository", "repositories")}. Proposed rules wait in Rules for someone to accept.`);
      await prr.reload();
      to.inbox();
    } catch (e) {
      toast(`Couldn't start: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const sample = async () => {
    setBusy("sample");
    try {
      const out = await act.sample("load");
      toast(out?.message || "Loaded a sample: made-up pull requests in made-up repositories.");
      await prr.reload();
      to.inbox();
    } catch (e) {
      toast(`Couldn't load the sample: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="c-app">
      {again ? <Header back={{ label: "Settings", icon: ArrowLeft, onClick: () => to.settings() }} title="Repositories" /> : null}
      <main className="c-setup">
        <Face size={56} />
        <h1>{again ? "Which repositories it reads" : "Every pull request read against your own rules"}</h1>
        <p className="c-setup__lead">
          Pick the repositories. It reads the rule files on each one's default branch, splits them into checkable rules, and proposes more from the review comments on your last merged pull requests. Then every push gets a review round: each rule passed, broken, or not checked and why.
        </p>

        <div className="c-card prr-setup__card">
          <div className="c-card__head"><h2><GitPullRequest size={15} aria-hidden="true" />Repositories</h2><span className="c-grow" />{repos ? <span className="c-faint prr-meta">{picked.size} picked</span> : null}</div>
          {problem === "missing" ? (
            <div className="prr-pad-s">
              <ConnectGithub />
              <div className="c-setup__row"><Button size="sm" onClick={() => setTick((t) => t + 1)}>I've connected it</Button></div>
            </div>
          ) : problem ? (
            <div className="prr-pad-s c-muted">GitHub didn't answer: {problem} <Button size="sm" onClick={() => setTick((t) => t + 1)}>Try again</Button></div>
          ) : !repos ? (
            <div className="prr-pad-s c-row c-muted"><Spinner /> Asking GitHub which repositories you can see…</div>
          ) : !repos.length ? (
            <div className="prr-pad-s c-muted">Your GitHub account can't see any repository. Install the Lemma's GitHub App on your organization, then try again.</div>
          ) : (
            <>
              {repos.length > 8 ? <div className="prr-pad-s"><SearchField value={q} onChange={setQ} placeholder="Find a repository" /></div> : null}
              <div className="c-choices" style={{ marginTop: 0 }}>
                {shown.map((r) => (
                  <label key={r.full_name} className="c-choice">
                    <input type="checkbox" checked={picked.has(r.full_name)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.full_name); else n.delete(r.full_name); return n; })} />
                    <span className="prr-mono c-grow c-ellipsis">{r.full_name}</span>
                    {r.private ? <Lock size={13} className="c-faint" aria-label="Private" /> : null}
                    <span className="c-faint prr-meta">{r.default_branch}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="c-setup__row">
          <Button variant="primary" icon={BookOpen} busy={busy === "start"} disabled={!picked.size || !canAdmin} onClick={() => void start()}>
            {again ? "Save and read the rules again" : `Read the rules in ${picked.size ? plural(picked.size, "repository", "repositories") : "them"}`}
          </Button>
          {!again ? <Button icon={FlaskConical} busy={busy === "sample"} onClick={() => void sample()}>Look around with a sample</Button> : null}
          {again && canOpenApps() ? <Button onClick={() => void openApp("rules")}>Open the rules</Button> : null}
        </div>
        <p className="c-setup__note">
          {canAdmin ? null : <>Only an admin of this Lemma can pick repositories. </>}
          Read from each default branch, which pull requests can't change: {RULE_FILES.map((f, i) => <span key={f}>{i ? ", " : ""}<span className="prr-mono">{f}</span></span>)}. Nothing proposed is used until someone accepts it. Nothing is posted on GitHub until Settings says so.
        </p>
      </main>
    </div>
  );
}
