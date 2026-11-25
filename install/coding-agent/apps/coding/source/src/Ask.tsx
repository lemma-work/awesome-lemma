// Ask about the code: the team's questions on the left, a question and its
// answer in the middle, what it read beside. An answer's `path:line` is a
// link to that line on GitHub at the commit it read. Make this a task opens
// New task with the question and answer as the brief, on the same commit;
// the task's status shows back here. The answer is saved on the row by the
// agent, so the whole team reads it; the conversation stays the asker's.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookMarked, Check, ChevronDown, Copy, FileSearch, ListPlus, MessageSquarePlus, SquareTerminal } from "lucide-react";
import { Button, Empty, Menu, MenuLabel, Spinner, cx, useToast, when } from "@lemma-plugins/kit";
import { agentName, call, useCoding, useConversation, useWorld } from "./data";
import { Mono, Prose, SessionPill } from "./marks";
import { github, split } from "./platform";
import { said, summary } from "./transcript";
import { useNarrow } from "./Board";
import { to } from "./route";
import type { Question } from "./types";

const DAY = 86_400_000;

export function Ask({ id }: { id: string | null }) {
  const { questions } = useCoding();
  const narrow = useNarrow();
  const q = id ? questions.find((x) => x.id === id) || null : null;
  const groups = useMemo(() => {
    const now = Date.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const out: { label: string; list: Question[] }[] = [{ label: "Today", list: [] }, { label: "This week", list: [] }, { label: "Earlier", list: [] }];
    for (const x of questions) {
      const t = Date.parse(x.created_at);
      out[t >= start.getTime() ? 0 : now - t < 7 * DAY ? 1 : 2].list.push(x);
    }
    return out.filter((g) => g.list.length);
  }, [questions]);

  const list = (
    <nav className="cd-qlist" aria-label="Questions">
      <div className="cd-qlist__head">
        <span className="c-grow">Questions</span>
        <Button size="sm" icon={MessageSquarePlus} onClick={() => to.ask()}>New question</Button>
      </div>
      {groups.map((g) => (
        <div key={g.label}>
          <p className="c-nav__label">{g.label}</p>
          {g.list.map((x) => <QRow key={x.id} q={x} on={x.id === id} />)}
        </div>
      ))}
      {!questions.length ? <p className="cd-note cd-pad">No questions yet. Ask how something works and the answer points at the lines.</p> : null}
    </nav>
  );

  if (narrow) {
    return (
      <main className="cd-ask cd-ask--narrow">
        {id ? (
          <>
            <div className="cd-backbar"><Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => to.ask()}>Questions</Button></div>
            {q ? <Thread q={q} /> : <Empty title="This question isn't here">It may have been removed with the sample.</Empty>}
          </>
        ) : (
          <>
            <Composer />
            {list}
          </>
        )}
      </main>
    );
  }
  return (
    <main className="cd-ask">
      {list}
      <div className="cd-ask__main">{id ? (q ? <Thread q={q} /> : <Empty title="This question isn't here">It may have been removed with the sample.</Empty>) : <Composer />}</div>
      {q ? <Rail q={q} /> : <HowRail />}
    </main>
  );
}

function QRow({ q, on }: { q: Question; on: boolean }) {
  const { taskById } = useCoding();
  return (
    <button type="button" className={cx("cd-qrow", on && "is-on")} aria-current={on ? "page" : undefined} onClick={() => to.ask(q.id)}>
      <span className="c-ellipsis">{q.question}</span>
      <span className="cd-qrow__sub">
        <Mono>{q.repo}</Mono>
        {q.state === "asking" ? " · reading the code…" : q.state === "failed" ? " · couldn't answer" : ""}
        {q.task_id && taskById.get(q.task_id) ? " · became a task" : ""}
      </span>
    </button>
  );
}

/* ---------- asking ---------- */

function Composer({ follow }: { follow?: Question }) {
  const data = useCoding();
  const toast = useToast();
  const [text, setText] = useState("");
  const [repo, setRepo] = useState(follow?.repo || "");
  const [busy, setBusy] = useState(false);
  const repos = data.repos.filter((r) => r.enabled).map((r) => r.full_name);
  useEffect(() => {
    if (!repo && repos.length) setRepo(repos[0]);
  }, [repos, repo]);
  const ask = async () => {
    if (!text.trim() || !repo) return;
    setBusy(true);
    try {
      const out = await call("coding_ask_start", {
        question: text.trim(), repo, ref: follow ? follow.sha || follow.ref : null,
        profile_id: data.settings?.default_profile_id || null, model: data.settings?.default_model || null,
      });
      setText("");
      to.ask(out.question_id ? String(out.question_id) : null);
    } catch (e) {
      toast(`Couldn't ask: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cx("cd-askbox", follow && "cd-askbox--follow")}>
      {!follow ? <h1 className="cd-h1">Ask about the code</h1> : null}
      {!follow ? <p className="cd-note">An agent reads the repository at its latest commit and answers with the lines it comes from. It changes nothing.</p> : null}
      <div className="cd-composer">
        <label className="c-sr" htmlFor={follow ? "cd-follow" : "cd-ask"}>Question</label>
        <textarea id={follow ? "cd-follow" : "cd-ask"} className="cd-composer__in" rows={follow ? 2 : 3} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={follow ? `Ask a follow-up about ${follow.repo}…` : "Where do we retry failed webhook deliveries?"}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void ask(); } }} />
        <div className="cd-composer__ctrls">
          {follow ? (
            <span className="cd-chip"><Mono>{follow.repo}</Mono> at <Mono>{(follow.sha || follow.ref || "main").slice(0, 7)}</Mono></span>
          ) : (
            <Menu title="Repository" label={<><BookMarked size={14} aria-hidden="true" /><Mono>{repo || "Pick a repository"}</Mono><ChevronDown size={13} aria-hidden="true" className="c-faint" /></>}>
              {(close) => (
                <>
                  <MenuLabel>Repositories set up for the agent</MenuLabel>
                  {repos.map((r) => (
                    <button key={r} type="button" className="c-menu__item" onClick={() => { setRepo(r); close(); }}>
                      <Mono className="c-grow">{r}</Mono>{r === repo ? <Check aria-hidden="true" /> : null}
                    </button>
                  ))}
                  {!repos.length ? <MenuLabel>None yet: add one in set-up.</MenuLabel> : null}
                </>
              )}
            </Menu>
          )}
          <span className="c-grow" />
          <Button size={follow ? "sm" : "md"} variant="primary" busy={busy} disabled={!text.trim() || !repo} onClick={() => void ask()}>Ask</Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- a question and its answer ---------- */

function Thread({ q }: { q: Question }) {
  const data = useCoding();
  const { me, runtimes } = useWorld();
  const toast = useToast();
  const mine = !!me && q.asked_by === me.id;
  const live = useConversation(mine && q.conversation_id ? q.conversation_id : null);
  const readSteps = live.items.flatMap((i) => (i.kind === "steps" && i.group === "read" ? i.steps : []));
  const steps = readSteps.length ? { line: said("read", readSteps) } : summary(live.items);
  const task = q.task_id ? data.taskById.get(q.task_id) || null : null;
  const session = task ? data.sessionsBy.get(task.id)?.[0] || null : null;
  const cite = /((?:[\w.-]+\/)*[\w.-]+\.[a-z]{1,6}):(\d+)(?:[-–](\d+))?/i.exec(q.answer || "");
  return (
    <div className="cd-thread">
      <div className="cd-thread__head">
        <h1 className="cd-thread__title">{q.question}</h1>
        <span className="cd-chip"><Mono>{q.repo}</Mono> at <Mono>{[q.ref && q.ref !== q.sha ? q.ref : null, q.sha?.slice(0, 7)].filter(Boolean).join(" · ") || "its default branch"}</Mono></span>
      </div>
      <div className="cd-thread__body">
        <div className="cd-you">{q.question}<span className="cd-you__by">{q.asked_by_name || "Someone"} · {when(q.created_at)}</span></div>
        {steps?.line ? <div className="cd-gl"><span className="cd-gl__btn cd-gl__btn--static"><FileSearch size={14} aria-hidden="true" />{steps.line}</span></div> : null}
        {q.state === "asking" ? <div className="cd-livel"><Spinner /><span>Reading the code…</span></div> : null}
        {q.state === "failed" ? <p className="cd-note">It couldn't answer this one{q.answer ? `: ${q.answer}` : "."} Ask again, or narrow the question to one part of the code.</p> : null}
        {q.state === "answered" && q.answer ? <Prose className="cd-answer" text={q.answer} repo={q.repo} sha={q.sha} /> : null}
        {q.state === "answered" && cite ? <Snippet repo={q.repo} sha={q.sha} path={cite[1]} line={Number(cite[2])} end={Number(cite[3] || cite[2])} /> : null}
        {q.state === "answered" ? (
          <div className="cd-row-acts">
            <Button variant="primary" icon={ListPlus} onClick={() => to.newTask({ question: q.id })}>Make this a task</Button>
            <Button icon={Copy} onClick={() => void navigator.clipboard?.writeText(q.answer || "").then(() => toast("Copied the answer."), () => toast("Couldn't copy."))}>Copy answer</Button>
          </div>
        ) : null}
        {task ? (
          <div className="cd-linked">
            <SquareTerminal size={14} aria-hidden="true" />
            <span>Became a task: <button type="button" className="cd-link" onClick={() => to.task(task.id)}>{task.title}</button></span>
            {session ? <SessionPill s={session} meId={me?.id} /> : null}
            {session ? <span className="cd-note cd-note--inline">{agentName(session, runtimes, me?.id)}</span> : null}
          </div>
        ) : null}
      </div>
      {q.state !== "asking" ? <Composer follow={q} /> : null}
    </div>
  );
}

/** The first cited lines, read from GitHub at the commit the answer read. */
function Snippet({ repo, sha, path, line, end }: { repo: string; sha: string | null; path: string; line: number; end: number }) {
  const [lines, setLines] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    setLines(null);
    void github<{ content?: string; encoding?: string }>("repos_get_content", { ...split(repo), path, ...(sha ? { ref: sha } : {}) })
      .then((r) => {
        if (!alive || !r?.content) return;
        const text = r.encoding === "base64" ? new TextDecoder().decode(Uint8Array.from(atob(r.content.replace(/\s/g, "")), (c) => c.charCodeAt(0))) : r.content;
        setLines(text.split("\n"));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [repo, sha, path]);
  if (!lines) return null;
  let from = Math.max(1, line - 4);
  while (from < line && !lines[from - 1]?.trim()) from += 1;
  const to = Math.min(lines.length, Math.max(end, line) + 2);
  const href = `https://github.com/${repo}/blob/${sha || "HEAD"}/${path}#L${line}${end > line ? `-L${end}` : ""}`;
  return (
    <div className="cd-snippet">
      <div className="cd-snippet__h"><Mono className="c-ellipsis">{path}</Mono><span className="cd-note cd-note--inline">lines {from}–{to}</span><span className="c-grow" /><a className="cd-link" href={href} target="_blank" rel="noreferrer">Open on GitHub</a></div>
      <pre className="cd-snippet__code">
        {lines.slice(from - 1, to).map((l, i) => {
          const n = from + i;
          return <span key={n} className={cx("cd-snippet__l", n >= line && n <= end && "is-hl")}><span className="cd-snippet__n">{n}</span>{l || " "}{"\n"}</span>;
        })}
      </pre>
    </div>
  );
}

function Rail({ q }: { q: Question }) {
  return (
    <aside className="cd-rail cd-rail--ask" aria-label="About this answer">
      {q.read.length ? (
        <section className="cd-railcard">
          <h2>What it read</h2>
          {q.read.map((r, i) => {
            const label = `${r.path}${r.start ? `:${r.start}${r.end && r.end !== r.start ? `-${r.end}` : ""}` : ""}`;
            const href = `https://github.com/${q.repo}/blob/${q.sha || "HEAD"}/${r.path}${r.start ? `#L${r.start}${r.end && r.end !== r.start ? `-L${r.end}` : ""}` : ""}`;
            return <a key={i} className="cd-link cd-mono c-ellipsis cd-readrow" href={href} target="_blank" rel="noreferrer">{label}</a>;
          })}
          <p className="cd-note">Each <Mono>path:line</Mono> opens on GitHub at the commit it read{q.sha ? <>, <Mono>{q.sha.slice(0, 7)}</Mono></> : null}.</p>
        </section>
      ) : null}
      <HowCard />
      <section className="cd-railcard">
        <h2>Make this a task</h2>
        <p className="c-muted">Opens New task with this question and answer as the brief, on the same repository and commit. The task's status shows back here.</p>
      </section>
    </aside>
  );
}

function HowCard() {
  return (
    <section className="cd-railcard">
      <h2>How it answers</h2>
      <p className="c-muted">In its own checkout of the repository, as a session told not to change anything. It can start from any branch or pull request.</p>
      <p className="cd-note">Read-only by instruction: nothing stops it writing. There's no index of the code; it searches the checkout each time.</p>
    </section>
  );
}

function HowRail() {
  return <aside className="cd-rail cd-rail--ask" aria-label="How it answers"><HowCard /></aside>;
}
