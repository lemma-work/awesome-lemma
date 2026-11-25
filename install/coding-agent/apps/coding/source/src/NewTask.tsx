// New task: one composer, and under it where the work runs (the cloud or
// the person's Mac), which repository, where its branch starts (a branch, a
// tag or an open pull request), which agent and model, its own branch or the
// pull request's, and whether to keep the pull request green. Start calls
// coding_start and opens the task on the board. Below: what's waiting for an
// agent, to hand over in one press. Beside: the repository's set-up, the
// week's cost (when the server can say) and the person's Mac.

import { useEffect, useMemo, useState } from "react";
import { BookMarked, Check, ChevronDown, Cloud, GitBranch, GitPullRequest, Inbox, Laptop, Tag } from "lucide-react";
import { Button, Menu, MenuLabel, Pill, Spinner, cx, plural, useToast } from "@lemma-plugins/kit";
import { startWork, useCoding, useWorld, type Card } from "./data";
import { AgentMenu, ModelMenu, statusWord } from "./pickers";
import { Mono, PriorityPill, sourceWord } from "./marks";
import { dollars, useWeekCost } from "./cost";
import { refsOf, type RefChoice } from "./platform";
import { client } from "@lemma-plugins/kit";
import { to } from "./route";

type RepoChoice = { full_name: string; default_branch: string | null; enabled: boolean };

let listed: Promise<RepoChoice[]> | null = null;
/** The repositories a conversation can be opened in, as GitHub's installation covers them for this person. */
function listRepos(): Promise<RepoChoice[]> {
  if (!listed) {
    listed = client.conversations.repositories()
      .then((r) => ((r as unknown as { items?: { full_name: string; default_branch?: string | null }[] }).items || [])
        .map((x) => ({ full_name: x.full_name, default_branch: x.default_branch || null, enabled: false })))
      .catch(() => []);
  }
  return listed;
}

export function NewTask({ from }: { from: { question?: string; task?: string } }) {
  const data = useCoding();
  const { runtimes, me } = useWorld();
  const toast = useToast();
  const settings = data.settings;
  const [text, setText] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState<RefChoice | null>(null);
  const [profile, setProfile] = useState(settings?.default_profile_id || "system:lemma");
  const [model, setModel] = useState<string | null>(settings?.default_model || null);
  const [ownBranch, setOwnBranch] = useState(true);
  const [keepGreen, setKeepGreen] = useState(settings?.keep_green ?? true);
  const [listedRepos, setListedRepos] = useState<RepoChoice[] | null>(null);
  const [refs, setRefs] = useState<RefChoice[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listRepos().then(setListedRepos);
  }, []);
  const repos = useMemo(() => {
    const mineRepos: RepoChoice[] = data.repos.filter((r) => r.enabled).map((r) => ({ full_name: r.full_name, default_branch: r.default_branch, enabled: true }));
    const rest = (listedRepos || []).filter((r) => !mineRepos.some((m) => m.full_name === r.full_name));
    return [...mineRepos, ...rest];
  }, [data.repos, listedRepos]);
  const repoRow = repos.find((r) => r.full_name === repo) || null;
  const base = repoRow?.default_branch || "main";

  // Prefill: from an answer (Make this a task), or a task on the board (Hand over, Fix it).
  useEffect(() => {
    if (from.question) {
      const q = data.questions.find((x) => x.id === from.question);
      if (q) {
        setText(`${q.question}\n\nWhat the code says${q.sha ? ` (at ${q.sha.slice(0, 7)})` : ""}:\n${q.answer || ""}`.trim());
        setRepo(q.repo);
        if (q.sha || q.ref) setRef({ kind: q.sha ? "branch" : "branch", name: q.sha ? q.sha.slice(0, 7) : q.ref || "", ref: q.sha || q.ref || "" });
      }
    } else if (from.task) {
      const c = data.cards.find((x) => x.id === from.task);
      if (c) prefill(c);
    }
  }, [from.question, from.task]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!repo && repos.length) setRepo(repos[0].full_name);
  }, [repos, repo]);
  useEffect(() => {
    setRefs(null);
    if (!repo) return;
    let alive = true;
    void refsOf(repo).then((r) => alive && setRefs(r));
    return () => {
      alive = false;
    };
  }, [repo]);

  const runtime = runtimes?.find((r) => r.id === profile) || null;
  const place: "cloud" | "mac" = runtime?.kind === "HARNESS" ? "mac" : "cloud";
  const harnesses = (runtimes || []).filter((r) => r.kind === "HARNESS");
  const macReady = harnesses.some((r) => r.ready);
  const pickPlace = (p: "cloud" | "mac") => {
    if (p === place) return;
    const list = (runtimes || []).filter((r) => (p === "mac" ? r.kind === "HARNESS" : r.kind === "MODEL_PROVIDER"));
    const next = list.find((r) => r.ready) || list[0];
    if (next) {
      setProfile(next.id);
      setModel(null);
    }
  };

  function prefill(c: Card) {
    setTaskId(c.task?.id || null);
    setText([c.title, c.task?.description || ""].filter(Boolean).join("\n\n"));
    if (c.repo) setRepo(c.repo);
  }

  const start = async () => {
    const body = text.trim();
    if (!body) return toast("Say what the agent should do.");
    if (!repo) return toast("Pick a repository.");
    const firstLine = body.split("\n").find((l) => l.trim())!.trim().replace(/^https?:\/\/\S+\s*/, "") || body;
    const url = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+/.exec(body)?.[0] || null;
    const task = taskId ? data.taskById.get(taskId) : null;
    setBusy(true);
    try {
      const out = await startWork({
        task_id: taskId || undefined,
        title: task?.title || (firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine),
        brief: body, repo, ref: ref?.ref || null,
        push_to: ref?.kind === "pull" && !ownBranch ? ref.head || null : null,
        profile_id: profile, model, keep_green: keepGreen, max_tries: settings?.max_tries ?? null,
        source: task?.source || (from.question ? "coding-agent" : null), source_url: task?.source_url || url,
      }, runtimes);
      toast(out.message || (place === "mac" && runtime && !runtime.ready ? "Saved: it starts when your Mac is back." : "Started."));
      if (out.task_id) to.task(String(out.task_id));
      else to.board();
    } catch (e) {
      toast(`Couldn't start: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const waiting = data.cards.filter((c) => c.column === "ready");
  const setupRow = data.repos.find((r) => r.full_name === repo);
  const week = useWeekCost(data.sessions, me?.id);
  const fromWord = ref ? (ref.kind === "pull" ? ref.name : ref.name) : base;

  return (
    <div className="cd-new">
      <main className="cd-new__main">
        <h1 className="cd-h1">New task</h1>
        <div className="cd-composer">
          <label className="c-sr" htmlFor="cd-task">What should the agent do</label>
          <textarea id="cd-task" className="cd-composer__in" value={text} onChange={(e) => setText(e.target.value)} rows={4}
            placeholder="Describe the change, or paste an issue or pull request link"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void start(); } }} />
          <div className="cd-composer__ctrls">
            <div className="c-seg" role="tablist" aria-label="Where it runs">
              <button type="button" role="tab" aria-selected={place === "cloud"} onClick={() => pickPlace("cloud")}><Cloud size={14} aria-hidden="true" />Cloud</button>
              <button type="button" role="tab" aria-selected={place === "mac"} disabled={!harnesses.length} title={harnesses.length ? undefined : "No coding agent is set up on a Mac for this organization"} onClick={() => pickPlace("mac")}>
                <Laptop size={14} aria-hidden="true" />Your Mac{harnesses.length && !macReady ? <span className="cd-minipill">Offline</span> : null}
              </button>
            </div>
            <Menu title="Repository" label={<><BookMarked size={14} aria-hidden="true" /><Mono className="cd-ellipsis-160">{repo || "Pick a repository"}</Mono><ChevronDown size={13} aria-hidden="true" className="c-faint" /></>}>
              {(close) => (
                <div className="cd-scrollmenu">
                  {repos.some((r) => r.enabled) ? <MenuLabel>Set up for the agent</MenuLabel> : null}
                  {repos.filter((r) => r.enabled).map((r) => <RepoItem key={r.full_name} r={r} on={r.full_name === repo} pick={() => { setRepo(r.full_name); setRef(null); close(); }} />)}
                  {repos.some((r) => !r.enabled) ? <MenuLabel>Others GitHub lets you open</MenuLabel> : null}
                  {repos.filter((r) => !r.enabled).map((r) => <RepoItem key={r.full_name} r={r} on={r.full_name === repo} pick={() => { setRepo(r.full_name); setRef(null); close(); }} />)}
                  {!repos.length ? <MenuLabel>{listedRepos ? "No repositories: connect GitHub in set-up." : "Reading your repositories…"}</MenuLabel> : null}
                </div>
              )}
            </Menu>
            <Menu title="Where its branch starts" label={<><GitBranch size={14} aria-hidden="true" />from <Mono className="cd-ellipsis-120">{fromWord}</Mono><ChevronDown size={13} aria-hidden="true" className="c-faint" /></>}>
              {(close) => (
                <div className="cd-scrollmenu">
                  {!refs ? <MenuLabel><Spinner /> Reading branches…</MenuLabel> : null}
                  {refs && !refs.length ? <MenuLabel>GitHub didn't list any: it starts from {base}.</MenuLabel> : null}
                  {(["branch", "pull", "tag"] as const).map((kind) => {
                    const list = (refs || []).filter((r) => r.kind === kind);
                    if (!list.length) return null;
                    const Icon = kind === "branch" ? GitBranch : kind === "pull" ? GitPullRequest : Tag;
                    return (
                      <div key={kind}>
                        <MenuLabel>{kind === "branch" ? "Branches" : kind === "pull" ? "Open pull requests" : "Tags"}</MenuLabel>
                        {list.map((r) => (
                          <button key={r.ref} type="button" className="c-menu__item" onClick={() => { setRef(r.name === base && kind === "branch" ? null : r); close(); }}>
                            <Icon aria-hidden="true" /><Mono>{r.name}</Mono>
                            <span className="c-grow c-ellipsis c-faint">{r.title || ""}</span>
                            {(ref?.ref || base) === r.ref ? <Check aria-hidden="true" /> : null}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </Menu>
            <AgentMenu value={profile} onChange={(id) => { setProfile(id); setModel(null); }} place={place} />
            <ModelMenu runtime={runtime} value={model} onChange={setModel} />
            <span className="c-grow" />
            <Button variant="primary" busy={busy} disabled={!text.trim() || !repo} onClick={() => void start()}>Start</Button>
          </div>
          <div className="cd-composer__opts">
            <label className="cd-check">
              <input type="checkbox" className="c-check" checked={ownBranch || ref?.kind !== "pull"} disabled={ref?.kind !== "pull"} onChange={(e) => setOwnBranch(e.target.checked)} />
              <span>Its own branch, <Mono>lemma/…</Mono>, made from <Mono>{fromWord}</Mono></span>
            </label>
            <label className="cd-check">
              <input type="checkbox" className="c-check" checked={keepGreen} onChange={(e) => setKeepGreen(e.target.checked)} />
              <span>Keep the pull request green until it merges{settings ? ` (up to ${plural(settings.max_tries, "try", "tries")})` : ""}</span>
            </label>
          </div>
        </div>
        <p className="cd-note">
          {ref?.kind === "pull"
            ? ownBranch ? "Untick the first box to have the agent push to that pull request's own branch instead." : `It pushes to ${ref.head ? `${ref.head}, ` : ""}the pull request's own branch, and opens no new one.`
            : "Starting from a pull request instead? Pick it under from, and untick the first box to push to its own branch."}
          {place === "mac" && runtime && !runtime.ready ? ` ${runtime.name} is ${statusWord(runtime).word.toLowerCase()}: the task waits for your Mac, or you can move it to the cloud.` : ""}
        </p>

        <section className="cd-waiting" aria-labelledby="waiting-h">
          <h2 className="cd-waiting__h" id="waiting-h"><Inbox size={14} aria-hidden="true" />Waiting for an agent<span className="c-count">{waiting.length}</span><span className="cd-note cd-note--inline">from Triage, PR review and labelled issues</span></h2>
          {waiting.length ? waiting.map((c) => (
            <div key={c.id} className={cx("cd-wrow", taskId === c.id && "is-on")}>
              <div className="c-grow">
                <p className="c-ellipsis">{c.title}</p>
                <p className="cd-wrow__sub">{sourceWord(c.source)}{c.repo ? <> · <Mono>{c.repo}</Mono></> : null}{c.why ? ` · ${c.why}` : ""}</p>
              </div>
              <PriorityPill task={c.task} />
              <Button size="sm" onClick={() => prefill(c)}>{c.source === "pr-review" ? "Fix it" : "Hand over"}</Button>
            </div>
          )) : <p className="cd-wrow cd-note">Nothing is waiting. Work from Triage, PR review and GitHub issues labelled <Mono>{settings?.issue_label || "lemma"}</Mono> lands here.</p>}
        </section>
        <p className="cd-note">Also starts from a GitHub issue labelled <Mono>{settings?.issue_label || "lemma"}</Mono>, a task handed to the coding agent in Tasks, or asking for it in any chat with this Lemma.</p>
      </main>

      <aside className="cd-rail" aria-label="Before you start">
        {repo ? (
          <section className="cd-railcard">
            <h2><Mono>{repo}</Mono>{place === "cloud" ? " in the cloud" : " on your Mac"}</h2>
            {setupRow?.setup ? (
              <>
                <p className="c-faint">Set-up it runs first, then reports</p>
                <pre className="cd-setup-lines">{setupRow.setup}</pre>
              </>
            ) : <p className="c-faint">No set-up commands: the agent reads the README and the repository's agent docs first.</p>}
            <div><Button size="sm" onClick={() => to.setup()}>Edit set-up</Button></div>
            {place === "cloud" ? <p className="cd-note">The cloud checkout has no secrets of yours, and set-up runs again for each task.</p> : null}
          </section>
        ) : null}
        {week ? (
          <section className="cd-railcard">
            <h2>Cost</h2>
            <div className="cd-railrow"><span className="c-faint">Yours this week</span><span className="num">{dollars(week.total)} · {plural(week.count, "session")}</span></div>
            <p className="cd-note">Lemma in the cloud is billed to this Lemma. Claude Code and Codex on your Mac run on your own plan and report no cost.</p>
          </section>
        ) : null}
        {harnesses.length ? (
          <section className="cd-railcard">
            <h2>Your Mac</h2>
            {harnesses.map((r) => {
              const st = statusWord(r);
              return <div key={r.id} className="cd-railrow"><span>{r.name}</span><Pill tone={st.tone}>{st.word}</Pill></div>;
            })}
            <p className="cd-note">Open Lemma on your Mac to run these there. Each task gets its own checkout of the repository.</p>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function RepoItem({ r, on, pick }: { r: RepoChoice; on: boolean; pick: () => void }) {
  return (
    <button type="button" className="c-menu__item" role="menuitemradio" aria-checked={on} onClick={pick}>
      <Mono className="c-grow c-ellipsis">{r.full_name}</Mono>
      {on ? <Check aria-hidden="true" /> : null}
    </button>
  );
}
