// The board: what needs a person on top, then the work in four columns
// (Ready for an agent, Working, Pull request open, Merged this week). A
// card is a team task; its latest session says where it stands. Below 760px
// one list with a filter for each lane, and a task's record full screen.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, CircleDot, Inbox } from "lucide-react";
import { Button, Empty, Menu, MenuItem, MenuLabel, Pill, SearchField, Segmented, Spinner, cx, plural, useToast } from "@lemma-plugins/kit";
import { agentName, fixConflicts, moveToCloud, startWork, useCoding, useConversation, useWorld, type Card, type Column } from "./data";
import { Diff, Mono, PriorityPill, SessionPill, sourceWord } from "./marks";
import { dollars, useCost, useWeekCost } from "./cost";
import { hintOf, statusWord } from "./pickers";
import { Record } from "./Record";
import { lastLine } from "./transcript";
import { to, type Tab } from "./route";

const COLUMNS: { id: Exclude<Column, "needs">; label: string; empty: string }[] = [
  { id: "ready", label: "Ready for an agent", empty: "Nothing from Triage or PR review is waiting." },
  { id: "working", label: "Working", empty: "No agent is working right now." },
  { id: "open", label: "Pull request open", empty: "No pull request is open." },
  { id: "merged", label: "Merged this week", empty: "Nothing merged this week yet." },
];

const narrowQuery = typeof window !== "undefined" ? window.matchMedia("(max-width: 760px)") : null;
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      narrowQuery?.addEventListener("change", cb);
      return () => narrowQuery?.removeEventListener("change", cb);
    },
    () => !!narrowQuery?.matches,
    () => false,
  );
}

export function Board({ taskId, tab }: { taskId: string | null; tab: Tab }) {
  const data = useCoding();
  const { me } = useWorld();
  const narrow = useNarrow();
  const [repo, setRepo] = useState<string>("");
  const [who, setWho] = useState<"everyone" | "mine">("everyone");
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState<Column>("needs");

  const repos = useMemo(() => [...new Set([...data.repos.filter((r) => r.enabled).map((r) => r.full_name), ...data.cards.map((c) => c.repo).filter(Boolean) as string[]])].sort(), [data.repos, data.cards]);
  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.cards.filter((c) => (!repo || c.repo === repo)
      && (who === "everyone" || c.session?.started_by === me?.id || c.task?.assignee_user_id === me?.id)
      && (!q || c.title.toLowerCase().includes(q) || (c.repo || "").includes(q) || String(c.session?.pr_number || "") === q.replace("#", "")));
  }, [data.cards, repo, who, query, me]);
  const by = (col: Column) => cards.filter((c) => c.column === col);
  const week = useWeekCost(data.sessions, me?.id);
  const open = taskId ? data.cards.find((c) => c.id === taskId) || null : null;

  useEffect(() => {
    // On a phone the first lane with something in it is the one shown.
    if (!narrow) return;
    if (!by(lane).length) {
      const first = (["needs", "working", "open", "ready", "merged"] as Column[]).find((c) => by(c).length);
      if (first) setLane(first);
    }
  }, [narrow, cards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = (
    <div className="cd-filters">
      <Menu label={<>{repo ? <Mono>{repo}</Mono> : `Repo: all ${repos.length}`}<ChevronDown size={13} aria-hidden="true" className="c-faint" /></>} title="Repository">
        {(close) => (
          <>
            <MenuItem onSelect={() => { setRepo(""); close(); }}>All repositories</MenuItem>
            {repos.map((r) => <MenuItem key={r} onSelect={() => { setRepo(r); close(); }}><Mono>{r}</Mono></MenuItem>)}
          </>
        )}
      </Menu>
      <Segmented label="Whose" value={who} onChange={setWho} items={[{ id: "everyone", label: "Everyone" }, { id: "mine", label: "Mine" }]} />
      <div className="cd-filters__search"><SearchField value={query} onChange={setQuery} placeholder="Find a task" /></div>
      <span className="c-grow" />
      {week ? <span className="cd-cost" title={`Lemma in the cloud, for the ${plural(week.count, "session")} you started in the last 7 days. Agents on a Mac run on their own plan.`}>{dollars(week.total)} this week, yours</span> : null}
    </div>
  );

  if (narrow) {
    const lanes: { id: Column; label: string }[] = [
      { id: "needs", label: "Needs you" }, { id: "working", label: "Working" }, { id: "open", label: "Open" }, { id: "ready", label: "Ready" }, { id: "merged", label: "Merged" },
    ];
    const list = by(lane);
    return (
      <main className="cd-phone">
        <div className="cd-phone__lanes">
          <Segmented label="Lane" value={lane} onChange={setLane} items={lanes.map((l) => ({ id: l.id, label: l.label, count: by(l.id).length }))} />
        </div>
        {list.length ? (
          <div className="cd-plist">{list.map((c) => <PhoneItem key={c.id} card={c} />)}</div>
        ) : (
          <Empty icon={Inbox} title={lane === "needs" ? "Nothing needs you" : "Nothing here"}>
            {lane === "needs" ? "Questions, failing checks and waiting tasks show up here." : COLUMNS.find((c) => c.id === lane)?.empty}
          </Empty>
        )}
        {open ? <Record card={open} tab={tab} onClose={() => to.board()} /> : taskId ? <Missing onClose={() => to.board()} /> : null}
      </main>
    );
  }

  const needs = by("needs");
  return (
    <div className={cx("cd-body", open && "cd-body--open")}>
      <main className="cd-left">
        {filters}
        <section className="cd-lane" aria-labelledby="needs-h">
          <h2 className="cd-lane__h" id="needs-h"><span className="cd-dot cd-dot--warn" aria-hidden="true" />Needs you<span className="c-count">{needs.length}</span></h2>
          {needs.length ? (
            <div className="cd-lane__cards">{needs.map((c) => <NeedCard key={c.id} card={c} on={c.id === taskId} />)}</div>
          ) : (
            <p className="cd-lane__empty">Nothing needs you. Questions, checks that keep failing and tasks waiting for a Mac show up here.</p>
          )}
        </section>
        <div className="cd-cols-wrap">
          <div className="cd-cols">
            {COLUMNS.map((col) => {
              const list = by(col.id);
              return (
                <section key={col.id} className="cd-col" aria-labelledby={`col-${col.id}`}>
                  <h2 className="cd-col__h" id={`col-${col.id}`}>{col.label}<span className="c-count">{list.length}</span></h2>
                  {list.map((c) => <BoardCard key={c.id} card={c} on={c.id === taskId} />)}
                  {!list.length ? <p className="cd-col__empty">{col.empty}</p> : null}
                </section>
              );
            })}
          </div>
        </div>
        {!data.cards.length ? (
          <Empty icon={CircleDot} title="No coding work yet" action={<Button variant="primary" onClick={() => to.newTask()}>New task</Button>}>
            Describe a change and pick a repository; an agent works it in its own branch and opens the pull request. Tasks from Triage and PR review land in Ready.
          </Empty>
        ) : null}
      </main>
      {open ? <Record card={open} tab={tab} onClose={() => to.board()} /> : taskId ? <Missing onClose={() => to.board()} /> : null}
    </div>
  );
}

function Missing({ onClose }: { onClose: () => void }) {
  return (
    <aside className="cd-sheet" aria-label="Task">
      <Empty icon={Inbox} title="This task isn't on the board" action={<Button onClick={onClose}>Back to the board</Button>}>
        It may have been handed back to a person, or merged more than a week ago. It's still in Tasks.
      </Empty>
    </aside>
  );
}

/* ---------- cards ---------- */

function useNeedAction(card: Card): { label: string; run: () => Promise<void> | void } | null {
  const { me, runtimes } = useWorld();
  const toast = useToast();
  const s = card.session;
  if (!s) return null;
  if (s.status === "failed" || s.needs === "failed") return { label: "Look", run: () => to.task(card.id) };
  switch (s.needs) {
    case "question":
    case "approval":
      return { label: "Answer", run: () => to.task(card.id, "transcript") };
    case "waiting_mac":
      return {
        label: "Move to the cloud",
        run: async () => {
          try {
            const out = await moveToCloud(s, card.task, runtimes);
            toast(out.message || "Moved to Lemma in the cloud.");
            to.task(card.id);
          } catch (e) {
            toast(`Couldn't move it: ${e instanceof Error ? e.message : e}`);
          }
        },
      };
    case "conflict":
      if (s.conversation_id && s.started_by === me?.id) {
        return {
          label: "Fix conflicts",
          run: async () => {
            try {
              await fixConflicts(s, me);
              toast("Asked the agent to merge and fix the conflicts.");
            } catch (e) {
              toast(`Couldn't ask the agent: ${e instanceof Error ? e.message : e}`);
            }
          },
        };
      }
      return { label: "Look", run: () => to.task(card.id) };
    default:
      return { label: "Look", run: () => to.task(card.id) };
  }
}

function NeedCard({ card, on }: { card: Card; on: boolean }) {
  const { me, runtimes } = useWorld();
  const action = useNeedAction(card);
  const [busy, setBusy] = useState(false);
  const s = card.session!;
  const text = s.needs_text || s.error || (s.needs === "waiting_mac" ? "Its Mac is offline." : "");
  return (
    <article className={cx("cd-need", on && "is-on")}>
      <button type="button" className="cd-card__title" onClick={() => to.task(card.id)}>{card.title}</button>
      {text ? <p className="cd-quote">{text}</p> : null}
      <div className="cd-meta">
        <SessionPill s={s} meId={me?.id} />
        <span className="c-ellipsis">{s.pr_number ? `#${s.pr_number}` : agentName(s, runtimes, me?.id)}</span>
        <span className="c-grow" />
        {action ? <Button size="sm" busy={busy} onClick={async () => { setBusy(true); try { await action.run(); } finally { setBusy(false); } }}>{action.label}</Button> : null}
      </div>
    </article>
  );
}

function BoardCard({ card, on }: { card: Card; on: boolean }) {
  const { me, runtimes } = useWorld();
  const s = card.session;
  const mine = !!s && s.started_by === me?.id;
  const cost = useCost(s, me?.id);
  return (
    <article className={cx("cd-card", on && "is-on")}>
      <button type="button" className="cd-card__title" onClick={() => to.task(card.id)}>{card.title}</button>
      <div className="cd-meta">
        <span>{sourceWord(card.source)}</span>
        {card.repo ? <Mono>{card.repo}</Mono> : null}
      </div>
      {s && s.status === "working" && mine && s.conversation_id ? <LastStep id={s.conversation_id} /> : null}
      {s ? (
        <div className="cd-meta">
          <SessionPill s={s} meId={me?.id} />
          <span className="c-ellipsis">{agentName(s, runtimes, me?.id).replace(/ · .*$/, "")}</span>
          <span className="c-grow" />
          <Diff add={s.additions} del={s.deletions} />
          {cost != null ? <span className="cd-faint-num">{dollars(cost)}</span> : null}
        </div>
      ) : card.column === "working" ? (
        <div className="cd-meta"><Pill tone="info">Handing over</Pill><span>Lemma</span></div>
      ) : (
        <div className="cd-meta">
          <PriorityPill task={card.task} />
          <AssignMenu card={card} />
          {card.why ? <span className="c-ellipsis">{card.why}</span> : null}
        </div>
      )}
    </article>
  );
}

/** The agent's last step, while its starter is looking: the command as typed. */
function LastStep({ id }: { id: string }) {
  const live = useConversation(id);
  const line = lastLine(live.items);
  if (!line) return null;
  return (
    <div className="cd-last">
      <Spinner />
      <Mono className="c-ellipsis">{line}</Mono>
    </div>
  );
}

/** Hand a ready task to an agent, picked with its live status. */
export function AssignMenu({ card, label = "Assign", size = "sm" }: { card: Card; label?: string; size?: "sm" | "md" }) {
  const { runtimes } = useWorld();
  const data = useCoding();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const assign = async (profile: string) => {
    if (!card.task) return;
    if (!card.repo) {
      to.newTask({ task: card.id });
      return;
    }
    setBusy(true);
    try {
      const out = await startWork({
        task_id: card.task.id, title: card.task.title, brief: card.task.description || card.task.title, repo: card.repo,
        profile_id: profile, model: profile === data.settings?.default_profile_id ? data.settings?.default_model : null,
        keep_green: data.settings?.keep_green ?? true, max_tries: data.settings?.max_tries ?? null, source: card.task.source, source_url: card.task.source_url,
      }, runtimes);
      toast(out.message || "Handed to the agent.");
      to.task(card.id);
    } catch (e) {
      toast(`Couldn't hand it over: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  if (busy) return <Button size={size} busy>{label}</Button>;
  return (
    <Menu size={size} label={<>{label}<ChevronDown size={13} aria-hidden="true" className="c-faint" /></>} title="Hand it to an agent">
      {(close) => (
        <div className="cd-agentmenu">
          <MenuLabel>{card.repo ? <>Work it in <Mono>{card.repo}</Mono></> : "Pick the repository next"}</MenuLabel>
          {(runtimes || []).map((r) => {
            const st = statusWord(r);
            return (
              <button key={r.id} type="button" className="c-menu__item cd-agent" disabled={r.kind === "HARNESS" && r.status === "NOT_INSTALLED"}
                onClick={() => { close(); void assign(r.id); }}>
                <span className={cx("cd-dot", r.ready ? "cd-dot--ok" : "cd-dot--off")} aria-hidden="true" />
                <span className="c-grow"><span className="cd-agent__name">{r.name}</span><span className="cd-agent__hint">{hintOf(r)}</span></span>
                <Pill tone={st.tone}>{st.word}</Pill>
              </button>
            );
          })}
          {!runtimes?.length ? <MenuItem onSelect={() => { close(); void assign("system:lemma"); }}>Lemma in the cloud</MenuItem> : null}
        </div>
      )}
    </Menu>
  );
}

function PhoneItem({ card }: { card: Card }) {
  const { me, runtimes } = useWorld();
  const action = useNeedAction(card);
  const s = card.session;
  const [busy, setBusy] = useState(false);
  return (
    <article className="cd-pitem">
      <button type="button" className="cd-card__title" onClick={() => to.task(card.id)}>{card.title}</button>
      {s?.status === "needs_you" && s.needs_text ? <p className="cd-quote">{s.needs_text}</p> : null}
      <div className="cd-meta">
        {s ? <SessionPill s={s} meId={me?.id} /> : <PriorityPill task={card.task} />}
        <span className="c-ellipsis">{s ? agentName(s, runtimes, me?.id) : sourceWord(card.source)}</span>
        {card.repo ? <Mono className="c-ellipsis">{card.repo}</Mono> : null}
        {s ? <Diff add={s.additions} del={s.deletions} /> : null}
      </div>
      {card.column === "needs" && action ? (
        <div><Button busy={busy} onClick={async () => { setBusy(true); try { await action.run(); } finally { setBusy(false); } }}>{action.label}</Button></div>
      ) : card.column === "ready" ? <div><AssignMenu card={card} size="md" /></div> : null}
    </article>
  );
}
