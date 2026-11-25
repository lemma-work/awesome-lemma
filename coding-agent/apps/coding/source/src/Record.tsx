// A task's record, beside the board: where it came from, its facts, and
// three tabs. Activity is everyone's (the coding_event timeline). The
// transcript is the conversation, which only the person who started the
// session can read; they steer, answer and stop it from here. Changes is the
// worktree's diff when the server can give it, else the pull request's files
// on GitHub, else the branch compared with its base, else what the
// transcript's edits add up to (and it says which).

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, CircleStop, Cloud, ExternalLink, FileText, GitPullRequest, Lock, RotateCcw, Send, Undo2, X } from "lucide-react";
import { Button, Empty, Markdown, Menu, MenuItem, MenuLabel, Pill, Skeleton, Spinner, cx, plural, useToast, when } from "@lemma-plugins/kit";
import { agentName, handBack, isLive, moveToCloud, runtimeOf, sendToAgent, startWork, stopAgent, useCoding, useConversation, useWorld, type Card, type Live } from "./data";
import { Diff, EventIcon, Inline, Mono, Prose, SessionPill, fromWords } from "./marks";
import { dollars, useCost } from "./cost";
import { compareChanges, openFile, proofFiles, pullChanges, worktreeChanges, type Changes as ChangeSet } from "./platform";
import { doing, files as editedFiles, said, summary, type Item } from "./transcript";
import { AssignMenu } from "./Board";
import { to, type Tab } from "./route";
import type { CodingEvent, Session } from "./types";

export function Record({ card, tab, onClose }: { card: Card; tab: Tab; onClose: () => void }) {
  const { me, runtimes } = useWorld();
  const data = useCoding();
  const s = card.session;
  const mine = !!s && !!me && s.started_by === me.id;
  const readable = !!s?.conversation_id && mine;
  const live = useConversation(readable ? s!.conversation_id : null);
  const cost = useCost(s, me?.id, live.status === "RUNNING");
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']");
      if (e.key === "Escape" && !typing) onClose();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(".cd-sheet__scroll")?.scrollTo({ top: 0 });
  }, [card.id, tab]);

  const runtime = s ? runtimeOf(s.profile_id, runtimes) : null;
  const model = s?.model ? runtime?.models.find((m) => m.name === s.model)?.label || s.model : null;
  return (
    <aside className="cd-sheet" aria-label={card.title} ref={panel}>
      <div className="cd-sheet__head">
        <div className="cd-sheet__top">
          <div className="c-grow">
            <p className="cd-sheet__from">
              {fromWords(card.source)}
              {card.repo ? <> · <Mono>{card.repo}</Mono></> : null}
              {s ? <> · {agentName(s, runtimes, me?.id)}</> : null}
              {model ? <> · {model}</> : null}
            </p>
            <h2 className="cd-sheet__title">{card.title}</h2>
          </div>
          <Button size="sm" icon={X} label="Close" onClick={onClose} />
        </div>
        {s ? (
          <div className="cd-sheet__chips">
            <SessionPill s={s} meId={me?.id} />
            {s.branch ? <Mono className="c-faint c-ellipsis">{s.branch}</Mono> : null}
            {cost != null ? <span className="cd-faint-num">{dollars(cost)} so far</span> : null}
            {card.task?.source_url ? <a className="cd-link" href={card.task.source_url} target="_blank" rel="noreferrer">Where it came from <ExternalLink size={12} aria-hidden="true" /></a> : null}
          </div>
        ) : null}
        {s ? (
          <div className="cd-tabs" role="tablist" aria-label="Task">
            {(["activity", "transcript", "changes"] as Tab[]).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => to.task(card.id, t)}>
                {t === "activity" ? "Activity" : t === "transcript" ? "Transcript" : "Changes"}
                {t === "changes" && s.files_changed ? <span className="cd-tabs__n">{s.files_changed}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!s ? <NotStarted card={card} /> : tab === "transcript" ? <Transcript s={s} live={live} mine={mine} />
        : tab === "changes" ? <div className="cd-sheet__scroll"><ChangesTab s={s} live={live} mine={mine} defaultBranch={data.repos.find((r) => r.full_name === s.repo)?.default_branch || null} /></div>
          : <Activity card={card} s={s} live={live} mine={mine} cost={cost} />}
    </aside>
  );
}

/* ---------- a task no agent has started ---------- */

function NotStarted({ card }: { card: Card }) {
  return (
    <div className="cd-sheet__scroll cd-pad">
      <div className="cd-facts">
        <div><span>Status</span><span><Pill>{card.column === "working" ? "Handing over" : "Waiting for an agent"}</Pill></span></div>
        <div><span>Repository</span><span>{card.repo ? <Mono>{card.repo}</Mono> : <span className="c-faint">Not known yet</span>}</span></div>
        <div><span>Added</span><span>{when(card.task?.created_at)}</span></div>
      </div>
      {card.task?.description ? <div className="cd-brief"><Markdown text={card.task.description} /></div> : <p className="c-faint">No description.</p>}
      {card.column === "ready" ? (
        <div className="cd-row-acts">
          <AssignMenu card={card} label="Hand it to an agent" size="md" />
          <Button variant="ghost" onClick={() => to.newTask({ task: card.id })}>Edit the brief first</Button>
        </div>
      ) : <p className="c-muted">The agent is being handed this task. Its first events appear here in a moment.</p>}
    </div>
  );
}

/* ---------- Activity ---------- */

/** An event's time: the clock, and the day too when it isn't the day of the event before. */
function fmtTime(at: string, before?: string): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const sameDay = before ? new Date(before).toDateString() === d.toDateString() : d.toDateString() === new Date().toDateString();
  return sameDay ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

function Activity({ card, s, live, mine, cost }: { card: Card; s: Session; live: Live; mine: boolean; cost: number | null }) {
  const data = useCoding();
  const { me, runtimes, members } = useWorld();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const events = data.eventsBy.get(card.id) || [];
  const sum = mine ? summary(live.items) : null;
  const firstWork = events.find((e) => e.kind === "started" || e.kind === "checked_out" || e.kind === "setup");
  const ready = s.status === "pr_open" && s.checks === "passed" && s.mergeable !== "conflict";
  const others = data.sessionsBy.get(card.id)?.slice(1) || [];

  const act = async (name: string, run: () => Promise<unknown>, done: string) => {
    setBusy(name);
    try {
      const out = (await run()) as { message?: string } | undefined;
      toast(out?.message || done);
    } catch (e) {
      toast(`Couldn't do that: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  const checks = s.checks_text || { none: "Not run yet", running: "Running", passed: "Passed", failed: "Failing" }[s.checks];
  return (
    <>
      <div className="cd-sheet__scroll">
        <dl className="cd-facts">
          <div><dt>Status</dt><dd><SessionPill s={s} meId={me?.id} /></dd></div>
          <div><dt>Assignee</dt><dd className="c-ellipsis">{agentName(s, runtimes, me?.id)}</dd></div>
          <div><dt>Pull request</dt><dd>{s.pr_number ? <><a className="cd-link" href={s.pr_url || "#"} target="_blank" rel="noreferrer"><Mono>#{s.pr_number}</Mono></a> <Diff add={s.additions} del={s.deletions} /></> : <span className="c-faint">Not yet</span>}</dd></div>
          <div><dt>Checks</dt><dd className="c-ellipsis">{s.pr_number ? checks : <span className="c-faint">After the pull request</span>}</dd></div>
          <div><dt>Keep green</dt><dd>{s.keep_green ? `On · ${s.tries} of ${s.max_tries} ${s.max_tries === 1 ? "try" : "tries"}` : "Off"}</dd></div>
          {s.place === "mac" ? <div><dt>Cost</dt><dd>{mine ? "Your own plan" : "Their own plan"}</dd></div>
            : cost != null ? <div><dt>Cost</dt><dd>{dollars(cost)}</dd></div> : null}
        </dl>
        {s.result ? (
          <div className="cd-result">
            <p className="cd-result__h">What it did</p>
            <Markdown text={s.result} />
          </div>
        ) : null}
        <ol className="cd-tl">
          {events.map((e, i) => (
            <li key={e.id} className="cd-ev">
              <EventIcon e={e} />
              <div className="cd-ev__body">
                <EventText e={e} repo={s.repo} sha={s.head_sha} />
                {e === firstWork && sum && sum.line ? (
                  <div className="cd-box">
                    <span className="c-muted">Worked for {sum.minutes} min · {sum.line}</span>
                    <button type="button" className="cd-link" onClick={() => to.task(card.id, "transcript")}>See the transcript</button>
                  </div>
                ) : null}
              </div>
              <time className="cd-ev__t" dateTime={e.at} title={when(e.at)}>{fmtTime(e.at, events[i - 1]?.at)}</time>
            </li>
          ))}
          {ready ? (
            <li className="cd-ev">
              <span className="cd-evi cd-evi--ok" aria-hidden="true"><GitPullRequest size={13} /></span>
              <div className="cd-ev__body"><span>Ready to merge. Merging stays with a person.</span></div>
              <span />
            </li>
          ) : null}
          {!events.length ? <li className="cd-ev cd-ev--empty"><span /><span className="c-faint">Nothing has happened yet.</span><span /></li> : null}
        </ol>
        {s.pr_state === "open" ? <p className="cd-note">Checks and reviews arrive as GitHub sends them. A conflict with the base branch sends nothing, so it is looked for every 15 minutes.</p> : null}
        {others.length ? <p className="cd-note">{plural(others.length, "earlier session")} on this task: {others.map((o) => agentName(o, runtimes, me?.id)).join(", ")}.</p> : null}
      </div>
      <div className="cd-sheet__foot">
        {s.pr_url && s.pr_state === "open" ? <a className="c-btn c-btn--primary" href={s.pr_url} target="_blank" rel="noreferrer"><GitPullRequest aria-hidden="true" />Merge on GitHub</a> : null}
        {s.pr_url && s.pr_state !== "open" ? <a className="c-btn" href={s.pr_url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Pull request</a> : null}
        {s.needs === "waiting_mac" ? (
          <Button variant="primary" icon={Cloud} busy={busy === "cloud"} onClick={() => void act("cloud", () => moveToCloud(s, card.task, runtimes), "Moved to Lemma in the cloud.")}>Move to the cloud</Button>
        ) : null}
        {(s.status === "failed" || s.status === "stopped") && card.task ? (
          <Button icon={RotateCcw} busy={busy === "again"} onClick={() => void act("again", () => startWork({
            task_id: s.task_id, title: card.title, brief: card.task?.description || card.title, repo: s.repo, ref: s.ref, push_to: s.push_to,
            profile_id: s.profile_id, model: s.model, keep_green: s.keep_green, source: card.task?.source, source_url: card.task?.source_url,
          }, runtimes), "Started again.")}>Start again</Button>
        ) : null}
        {!["merged", "done", "stopped"].includes(s.status) ? (
          <Menu up label={<><Undo2 size={14} aria-hidden="true" />Hand back to a person</>} title="Hand back to a person">
            {(close) => (
              <>
                <MenuLabel>Stops the agent and gives the task to</MenuLabel>
                {[...members].sort((a, b) => (a.user_id === me?.id ? -1 : b.user_id === me?.id ? 1 : a.name.localeCompare(b.name))).map((m) => (
                  <MenuItem key={m.user_id} onSelect={() => { close(); void act("back", () => handBack(s, card.task, m, me), `Handed back to ${m.user_id === me?.id ? "you" : m.name}.`); }}>
                    {m.user_id === me?.id ? `${m.name} (you)` : m.name}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        ) : null}
        {mine && isLive(s) && live.status === "RUNNING" ? <Button variant="ghost" icon={CircleStop} busy={busy === "stop"} onClick={() => void act("stop", () => stopAgent(s, me), "Stopped.")}>Stop</Button> : null}
        <span className="c-grow" />
        {s.pr_state === "open" ? <span className="cd-note cd-note--inline">Merging stays with a person</span> : null}
      </div>
    </>
  );
}

function EventText({ e, repo, sha }: { e: CodingEvent; repo: string; sha: string | null }) {
  const d = (e.detail || {}) as Record<string, unknown>;
  const [head, ...rest] = (e.text || e.kind.replace(/_/g, " ")).split("\n");
  const tail = rest.filter(Boolean).join(" · ") || (e.kind === "check_failed" ? String(d.summary || d.log_tail || "").split("\n").filter(Boolean).slice(-2).join(" · ") : "");
  const actor = e.actor && !head.startsWith(e.actor) && ["review_comment", "review"].includes(e.kind) ? e.actor : null;
  return (
    <>
      <span className="cd-ev__text">
        <Inline text={head} repo={repo} sha={sha} />
        {e.url ? <> <a className="cd-ev__open" href={e.url} target="_blank" rel="noreferrer" aria-label="Open on GitHub"><ExternalLink size={12} /></a></> : null}
      </span>
      {tail ? <Mono className="cd-ev__sub">{tail}</Mono> : null}
      {actor ? <span className="cd-ev__sub">{actor}</span> : null}
      {e.kind === "review_comment" && d.path && !head.includes(String(d.path)) ? <span className="cd-ev__sub"><Inline text={`${d.path}${d.line ? `:${d.line}` : ""}`} repo={repo} sha={sha} /></span> : null}
      {(e.kind === "pushed" || e.kind === "fixing") && (d.additions != null || d.deletions != null) ? (
        <span className="cd-ev__sub">{d.try ? `Try ${d.try} of ${d.of} · ` : ""}<Diff add={Number(d.additions || 0)} del={Number(d.deletions || 0)} /></span>
      ) : null}
    </>
  );
}

/* ---------- Transcript ---------- */

function Transcript({ s, live, mine }: { s: Session; live: Live; mine: boolean }) {
  const { me } = useWorld();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [proof, setProof] = useState<{ name: string; path: string }[]>([]);
  const asking = s.status === "needs_you" && (s.needs === "question" || s.needs === "approval");

  useEffect(() => {
    if (!mine) return;
    void proofFiles(s.id).then(setProof);
  }, [s.id, mine, live.items.length]);
  useEffect(() => {
    if (asking) box.current?.focus();
  }, [asking]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [live.items.length, proof.length, live.loading]);

  if (!s.conversation_id) {
    return (
      <div className="cd-sheet__scroll">
        <Empty icon={FileText} title="No transcript">
          {s.needs === "waiting_mac" ? "The agent hasn't started: its Mac is offline. Move it to the cloud, or open Lemma on that Mac."
            : s.status === "starting" ? "The agent is being started. Its conversation appears here in a moment."
              : "No agent conversation is behind this task, so there's nothing to read. Its activity is on the Activity tab."}
        </Empty>
      </div>
    );
  }
  if (!mine) {
    return (
      <div className="cd-sheet__scroll">
        <Empty icon={Lock} title={`Only ${s.started_by_name || "the person who started it"} can see the transcript`}>
          A conversation with an agent is its starter's own. What the agent did, every check and every review is on the Activity tab for everyone.
        </Empty>
      </div>
    );
  }

  const running = live.status === "RUNNING" || live.status === "STOP_REQUESTED";
  const lastItem = live.items[live.items.length - 1];
  const pendingCmd = lastItem?.kind === "steps" && lastItem.group === "command" && !lastItem.steps[lastItem.steps.length - 1].done;
  const now = running && !pendingCmd ? doing(live.items) : null;
  const browsed = live.items.some((i) => i.kind === "steps" && i.group === "browser");
  const send = async () => {
    if (!text.trim()) return;
    setBusy("send");
    try {
      await sendToAgent(s, text.trim(), me);
      setText("");
      live.refresh();
    } catch (e) {
      toast(`Couldn't send: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <div className="cd-sheet__scroll cd-feed" aria-live="polite">
        {live.loading ? <Skeleton kind="list" rows={5} /> : null}
        {live.error ? <p className="cd-note">Couldn't read the conversation: {live.error}</p> : null}
        {live.items.map((item) => <Row key={item.id} item={item} repo={s.repo} sha={s.head_sha} />)}
        {proof.length ? (
          <div className="cd-group">
            <div className="cd-group__h"><FileText size={14} aria-hidden="true" />Proof it saved<span className="c-grow" /></div>
            {proof.map((f) => (
              <button key={f.path} type="button" className="cd-group__row cd-group__row--link" onClick={() => void openFile(f.path).catch((e) => toast(e.message))}>
                <Mono className="c-ellipsis">{f.name}</Mono><span className="c-grow" /><ExternalLink size={12} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}
        {now ? <div className="cd-livel"><Spinner /><span className="c-ellipsis">{now}…</span></div>
          : running && !pendingCmd ? <div className="cd-livel"><Spinner /><span>Working…</span></div> : null}
        {running && browsed ? <p className="cd-note">Watching the agent's browser live happens in Lemma.</p> : null}
        {!live.loading && !live.items.length ? <p className="c-faint">Nothing in the conversation yet.</p> : null}
        <div ref={end} />
      </div>
      <div className="cd-steer">
        {asking && s.needs_text ? <p className="cd-quote cd-quote--ask"><b>It asks:</b> {s.needs_text}</p> : null}
        <textarea ref={box} className="c-input cd-steer__in" value={text} onChange={(e) => setText(e.target.value)} rows={2}
          placeholder={asking ? "Answer it…" : running ? "Steer it while it works…" : "Send the agent a message…"}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
        <div className="cd-steer__row">
          {running ? <Button size="sm" icon={CircleStop} busy={busy === "stop"} onClick={async () => { setBusy("stop"); try { await stopAgent(s, me); live.refresh(); } finally { setBusy(""); } }}>Stop</Button> : null}
          <span className="c-grow" />
          <span className="cd-note cd-note--inline cd-hide-xs">⌘ Enter sends</span>
          <Button size="sm" variant="primary" icon={Send} busy={busy === "send"} disabled={!text.trim()} onClick={() => void send()}>{asking ? "Answer" : "Send"}</Button>
        </div>
      </div>
    </>
  );
}

function Row({ item, repo, sha }: { item: Item; repo: string; sha: string | null }) {
  const [open, setOpen] = useState(false);
  if (item.kind === "you") return <div className="cd-you">{item.text}</div>;
  if (item.kind === "text") return <Prose className="cd-said" text={item.text} repo={repo} sha={sha} />;
  const line = said(item.group, item.steps);
  if (item.group === "edit") {
    const list = editedFiles(item.steps);
    const add = list.reduce((n, f) => n + f.add, 0);
    const del = list.reduce((n, f) => n + f.del, 0);
    return (
      <div className="cd-group">
        <button type="button" className="cd-group__h" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <ChevronRight size={14} aria-hidden="true" className={cx("cd-chev", open && "is-open")} />{line}<span className="c-grow" /><Diff add={add} del={del} />
        </button>
        {list.map((f) => (
          <div key={f.path} className="cd-group__row"><Mono className="c-ellipsis">{f.path}</Mono><span className="c-grow" /><Diff add={f.add} del={f.del} /></div>
        ))}
        {open ? item.steps.map((st) => <pre key={st.id} className="cd-pre">{String(st.args.new_string ?? st.args.content ?? st.args.patch ?? "").slice(0, 2000)}</pre>) : null}
      </div>
    );
  }
  if (item.group === "command") {
    return (
      <div className="cd-group">
        <div className="cd-group__h">
          {line.split(" · ").map((part, i) => <span key={i} className={i && part.endsWith("failed") ? "cd-del" : undefined}>{i ? <>&nbsp;· </> : null}{part}</span>)}
        </div>
        {item.steps.map((st) => (
          <div key={st.id} className="cd-cmd">
            <span className={cx("cd-cmd__mark", st.failed ? "cd-del" : st.done ? "cd-add" : "cd-run")} aria-label={st.failed ? "failed" : st.done ? "passed" : "running"}>
              {st.failed ? "✗" : st.done ? "✓" : <Spinner />}
            </span>
            <Mono className="c-ellipsis">{st.subject || st.tool}</Mono>
            <span className="cd-cmd__said c-ellipsis">{st.said}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="cd-gl">
      <button type="button" className="cd-gl__btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronRight size={14} aria-hidden="true" className={cx("cd-chev", open && "is-open")} />{line}
      </button>
      {open ? (
        <ul className="cd-gl__list">
          {item.steps.map((st) => <li key={st.id}><Mono className="c-ellipsis">{st.subject || st.tool}</Mono></li>)}
        </ul>
      ) : null}
    </div>
  );
}

/* ---------- Changes ---------- */

function ChangesTab({ s, live, mine, defaultBranch }: { s: Session; live: Live; mine: boolean; defaultBranch: string | null }) {
  const [set, setSet] = useState<ChangeSet | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fromTranscript = useMemo<ChangeSet | null>(() => {
    if (!mine) return null;
    const steps = live.items.flatMap((i) => (i.kind === "steps" && i.group === "edit" ? i.steps : []));
    if (!steps.length) return null;
    const list = editedFiles(steps).map((f) => ({ path: f.path, status: "modified", additions: f.add, deletions: f.del }));
    return { from: "transcript", files: list, additions: list.reduce((n, f) => n + f.additions, 0), deletions: list.reduce((n, f) => n + f.deletions, 0) };
  }, [mine, live.items]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void (async () => {
      let note: string | null = null;
      try {
        if (mine && s.conversation_id) {
          const w = await worktreeChanges(s.conversation_id);
          if (w && "files" in w) {
            if (alive) { setSet(w); setState(null); setLoading(false); }
            return;
          }
          if (w) note = w.state;
        }
        if (s.pr_number) {
          const p = await pullChanges(s.repo, s.pr_number);
          if (alive) { setSet(p); setState(note); setLoading(false); }
          return;
        }
        if (s.branch) {
          const c = await compareChanges(s.repo, s.ref && !s.ref.startsWith("pull/") ? s.ref : defaultBranch || "main", s.branch);
          if (alive) { setSet(c); setState(note); setLoading(false); }
          return;
        }
        if (alive) { setSet(null); setState(note); setLoading(false); }
      } catch (e) {
        if (alive) { setSet(null); setError(e instanceof Error ? e.message : String(e)); setLoading(false); }
      }
    })();
    return () => {
      alive = false;
    };
  }, [s.id, s.conversation_id, s.pr_number, s.branch, s.head_sha, mine, s.repo, s.ref, defaultBranch]);

  const shown = set && set.files.length ? set : fromTranscript;
  if (loading) return <div className="cd-pad"><Skeleton kind="list" rows={4} /></div>;
  if (!shown) {
    return (
      <Empty icon={FileText} title="No changes to show yet">
        {error ? `GitHub didn't answer: ${error}.` : STATE[state || ""] || "The change shows here once the agent has edited something, pushed its branch or opened the pull request."}
      </Empty>
    );
  }
  const FROM: Record<ChangeSet["from"], string> = {
    worktree: `From the agent's checkout${shown.uncommitted ? ", including what isn't committed yet" : ""}`,
    pull: "From the pull request on GitHub",
    compare: `The branch compared with ${shown.base || "its base"} on GitHub`,
    transcript: "Added up from the transcript's edits: the pull request may differ",
  };
  return (
    <div className="cd-changes">
      <div className="cd-changes__head">
        <span>{plural(shown.files.length, "file")}</span>
        <Diff add={shown.additions} del={shown.deletions} />
        <span className="c-grow" />
        <span className="cd-note cd-note--inline">{FROM[shown.from]}</span>
      </div>
      {state && STATE[state] ? <p className="cd-note">{STATE[state]}</p> : null}
      {error ? <p className="cd-note">GitHub didn't answer: {error}.</p> : null}
      {shown.files.map((f, i) => <FileDiff key={f.path} f={f} first={i === 0} />)}
      {shown.truncated ? <p className="cd-note">The change is too large to show in full here.</p> : null}
    </div>
  );
}

const STATE: Record<string, string> = {
  no_repository: "This session wasn't opened on a repository.",
  not_checked_out: "The agent hasn't checked the repository out yet.",
  machine_unavailable: "The machine with the checkout is offline, so its changes can't be read right now.",
  elsewhere: "The checkout is on another person's machine.",
};

function FileDiff({ f, first }: { f: ChangeSet["files"][number]; first: boolean }) {
  const [open, setOpen] = useState(first);
  const lines = (f.patch || "").split("\n");
  return (
    <div className="cd-file">
      <button type="button" className="cd-file__h" aria-expanded={open} onClick={() => setOpen((v) => !v)} disabled={!f.patch}>
        <ChevronRight size={14} aria-hidden="true" className={cx("cd-chev", open && "is-open", !f.patch && "is-hidden")} />
        <Mono className="c-ellipsis">{f.old_path && f.old_path !== f.path ? `${f.old_path} → ${f.path}` : f.path}</Mono>
        <span className="c-grow" />
        {f.status !== "modified" ? <span className="cd-note cd-note--inline">{f.status}</span> : null}
        {f.binary ? <span className="cd-note cd-note--inline">binary</span> : <Diff add={f.additions} del={f.deletions} />}
      </button>
      {open && f.patch ? (
        <pre className="cd-patch">
          {lines.slice(0, 600).map((l, i) => (
            <span key={i} className={cx("cd-patch__l", l.startsWith("+") ? "is-add" : l.startsWith("-") ? "is-del" : l.startsWith("@@") ? "is-hunk" : "")}>{l || " "}{"\n"}</span>
          ))}
        </pre>
      ) : null}
    </div>
  );
}
