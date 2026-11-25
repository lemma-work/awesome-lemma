// Who asked: everyone who asked for what's in the note, grouped by line, and
// each one's reply in the place they asked.
//
//   yours to tell     you heard them (your mail): the reply is a Mail draft in
//                     your thread, sent through Mail
//   told by others    another member heard them: who and when, never their
//                     words; the reply waits in that member's Today
//   public places     a GitHub issue or a Slack thread: a comment or a thread
//                     reply drafted here, sent through release_notes_send_reply
//   told              done

import { useEffect, useMemo, useState } from "react";
import { GitPullRequestArrow, Hash, Lock, Mail, MessageSquare, Send, Sparkles } from "lucide-react";
import { Avatar, Button, Empty, Pill, Skeleton, Segmented, ago, day, plural, update as _u, useToast } from "@lemma-plugins/kit";
import { asksFor, confirmAsk, conversationOf, issueNumber, messagesOf, sendMailDraft, sendReply, useRN, useWho } from "./data";
import { to } from "./route";
import { Top, focusNote } from "./Top";
import type { Ask, Draft, Line, Note, Reply } from "./types";

type Filter = "mine" | "others" | "public" | "told";

const ICON = { mail: Mail, slack: Hash, github: GitPullRequestArrow, other: MessageSquare, lock: Lock };

function bucket(a: Ask, me: string | undefined): Filter {
  if (a.state === "told") return "told";
  if (!a.heard_by) return "public";
  return a.heard_by === me ? "mine" : "others";
}

function weeks(at: string | null): string {
  if (!at) return "";
  const d = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 86_400_000));
  if (d < 14) return d <= 1 ? "a day" : `${d} days`;
  return `${Math.round(d / 7)} weeks`;
}

export function Asked({ askId }: { askId: string | null }) {
  const rn = useRN();
  const { me, members } = useWho();
  const [filter, setFilter] = useState<Filter>("mine");
  const [search, setSearch] = useState("");
  const note = focusNote(rn);
  const lines = useMemo(() => (note ? rn.lines.filter((l) => l.note_id === note.id && !l.hidden) : []), [rn.lines, note]);
  const groups = useMemo(() => note ? lines.map((l) => ({ line: l, people: asksFor(l, note.repo, rn.asks).filter((a) => a.state !== "dropped") }))
    .filter((g) => g.people.length) : [], [lines, note, rn.asks]);
  const all = groups.flatMap((g) => g.people);
  const counted = new Set(all.filter((a) => ["open", "shipped", "told"].includes(a.state)).map((a) => `${a.handle_kind}:${a.handle}`)).size;
  const counts: Record<Filter, number> = { mine: 0, others: 0, public: 0, told: 0 };
  for (const a of all) counts[bucket(a, me?.id)] += 1;
  const hasMine = counts.mine > 0;
  const start: Filter = filter === "mine" && !hasMine ? (counts.public ? "public" : counts.others ? "others" : "told") : filter;
  const shown = groups.map((g) => ({ ...g, total: g.people.filter((a) => a.state !== "suggested").length, people: g.people.filter((a) => bucket(a, me?.id) === start
    && (!search || `${a.name} ${a.handle} ${a.company_name}`.toLowerCase().includes(search.toLowerCase()))) }))
    .filter((g) => g.people.length);
  const selected = all.find((a) => a.id === askId) || shown[0]?.people[0] || null;
  const nameOf = (id: string | null) => members.find((m) => m.user_id === id)?.name?.split(" ")[0] || "a member";

  if (!rn.loaded) return <Skeleton kind="list" rows={8} />;
  return (
    <>
      <Top here="asked" search={search} onSearch={setSearch} placeholder="Search people" />
      {!note || !groups.length ? (
        <main className="c-body">
          <Empty icon={MessageSquare} title="Nobody has asked for what's in this note yet">
            People who ask on a GitHub issue are found when the pull request that closes it merges. Someone who asked you by
            email is suggested here after a release goes out, for you to confirm.
          </Empty>
        </main>
      ) : (
        <>
          <div className="rn-bar">
            <span className="rn-big">{note.state === "published" ? `${note.name} shipped what ${plural(counted, "person", "people")} asked for` : `${note.name} answers what ${plural(counted, "person", "people")} asked for`}</span>
            <span className="c-muted">{note.live_at ? `Live in ${note.live_env || "production"} since ${day(note.live_at)}` : "Not live yet"}{note.state !== "published" ? " · replies are drafted when it's published" : ""}</span>
            <span className="c-grow" />
            <Segmented label="Filter" value={start} onChange={setFilter} items={[
              { id: "mine", label: "Yours to tell", count: counts.mine },
              { id: "others", label: "Told by others", count: counts.others },
              { id: "public", label: "Public places", count: counts.public },
              { id: "told", label: "Told", count: counts.told },
            ]} />
          </div>
          <div className="rn-asked">
            <section className="rn-list" aria-label="People who asked">
              {shown.length === 0 ? <p className="rn-pad rn-meta">{search ? "Nobody matches." : "Nobody here."}</p> : null}
              {shown.map((g) => (
                <div key={g.line.id}>
                  <div className="rn-grp">
                    <span className="rn-grp__h">{g.line.title || g.line.text}</span>
                    {g.line.issues[0] ? <span className="rn-meta">issue {issueNumber(g.line.issues[0])}</span> : null}
                    <span className="c-grow" />
                    <Pill tone="info" dot={false}>{g.total} asked</Pill>
                  </div>
                  {g.people.map((a) => (
                    <PersonRow key={a.id} a={a} selected={selected?.id === a.id} note={note} who={nameOf(a.heard_by)} />
                  ))}
                </div>
              ))}
              <p className="rn-pad rn-meta">For someone who asked another member, you see who and when, never what they said. Their reply is drafted in that member's own thread and waits in their Today.</p>
            </section>
            <section className="rn-pane" aria-label={selected?.name || "Someone who asked"}>
              {selected ? <Pane a={selected} note={note} line={groups.find((g) => g.people.includes(selected))?.line || null} who={nameOf(selected.heard_by)} /> : null}
              {selected ? <NextUp current={selected} all={all} filter={start} /> : null}
            </section>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- a row ---------- */

function whereOf(a: Ask, mine: boolean, who: string): { icon: keyof typeof ICON; text: string } {
  const when = day(a.asked_at);
  if (a.heard_by && !mine) return { icon: "lock", text: `Asked ${who} by ${a.source === "mail" ? "email" : a.source} · ${when} · their words stay in ${who}'s ${a.source === "mail" ? "mail" : "threads"}` };
  if (a.source === "mail") return { icon: "mail", text: `Your mail · ${when}${a.state === "suggested" ? " · the Lemma thinks it matches" : ""}` };
  if (a.source === "slack") return { icon: "slack", text: `Slack · ${when}` };
  if (a.source === "github") return { icon: "github", text: `GitHub issue ${issueNumber(a.work_id)}${a.source_id === a.work_id ? "" : ", a comment"} · ${when}` };
  return { icon: "other", text: `${a.source} · ${when}` };
}

function stateOf(a: Ask, rn: ReturnType<typeof useRN>, mine: boolean, who: string, note: Note): { text: string; tone: "info" | "success" | "warning" | "plain" } {
  if (a.state === "suggested") return { text: "Suggested", tone: "warning" };
  if (a.state === "told") return { text: `Told ${a.told_at ? ago(a.told_at) : ""}`.trim(), tone: "success" };
  if (a.state === "open") return { text: note.state === "published" ? "Not in this release" : "Told when published", tone: "plain" };
  if (!a.heard_by) {
    const r = rn.replies.find((x) => x.ask_id === a.id);
    if (!r) return { text: "Being drafted", tone: "plain" };
    if (r.state === "failed") return { text: "Couldn't send", tone: "warning" };
    return { text: a.source === "github" ? "Comment drafted" : "Reply drafted", tone: "info" };
  }
  if (!mine) return { text: `Waiting on ${who}`, tone: "plain" };
  const d = rn.drafts.find((x) => x.built_from?.ask_id === a.id);
  if (!d) return { text: "Being drafted", tone: "plain" };
  if (d.state === "failed") return { text: "Couldn't send", tone: "warning" };
  if (d.state === "discarded") return { text: "Not telling", tone: "plain" };
  return { text: "Reply drafted", tone: "info" };
}

function PersonRow({ a, selected, note, who }: { a: Ask; selected: boolean; note: Note; who: string }) {
  const rn = useRN();
  const { me } = useWho();
  const toast = useToast();
  const mine = a.heard_by === me?.id;
  const where = whereOf(a, mine, who);
  const Icon = ICON[where.icon];
  const st = stateOf(a, rn, mine, who, note);
  const yes = async (ok: boolean) => {
    try {
      await confirmAsk(a, ok, note.state === "published" ? note.name : null);
      toast(ok ? (note.state === "published" ? "Linked. A reply is being drafted in your thread." : "Linked. They're told when it's published.") : "Not linked. Nobody is told.");
    } catch (e) {
      toast(`Couldn't change it: ${e instanceof Error ? e.message : e}`);
    }
  };
  return (
    <>
      <button type="button" className={`rn-person${selected ? " is-sel" : ""}`} onClick={() => to.asked(a.id)}>
        <Avatar name={a.name || a.handle} size={28} />
        <span className="c-grow">
          <span className="rn-person__t c-ellipsis">{a.name || a.handle}{a.company_name ? <span className="c-faint"> · {a.company_name}</span> : a.handle_kind === "github" ? <span className="c-faint"> · @{a.handle}</span> : null}</span>
          <span className="rn-meta rn-where"><Icon size={12} aria-hidden="true" />{where.text}</span>
        </span>
        <Pill tone={st.tone}>{st.text}</Pill>
      </button>
      {a.state === "suggested" && mine ? (
        <div className="rn-yn">
          <span className="rn-meta">Same thing they asked for?</span>
          <Button size="sm" onClick={() => void yes(true)}>Yes, link it</Button>
          <Button size="sm" variant="ghost" onClick={() => void yes(false)}>No</Button>
        </div>
      ) : null}
    </>
  );
}

/* ---------- the selected person ---------- */

interface Msg { id: string; direction: string; from_name: string | null; from_handle: string | null; sent_at: string; snippet: string | null }

function Pane({ a, note, line, who }: { a: Ask; note: Note; line: Line | null; who: string }) {
  const rn = useRN();
  const { me } = useWho();
  const mine = a.heard_by === me?.id;
  const [thread, setThread] = useState<{ subject: string | null; msgs: Msg[] } | null>(null);
  useEffect(() => {
    let live = true;
    setThread(null);
    if (!mine || !a.conversation_id) return;
    void Promise.all([conversationOf(a.conversation_id), messagesOf(a.conversation_id)])
      .then(([c, m]) => { if (live) setThread({ subject: c?.subject || null, msgs: m }); })
      .catch(() => { if (live) setThread({ subject: null, msgs: [] }); });
    return () => { live = false; };
  }, [a.id, a.conversation_id, mine]);
  const draft = rn.drafts.find((d) => d.built_from?.ask_id === a.id) || null;
  const reply = rn.replies.find((r) => r.ask_id === a.id) || null;
  const st = stateOf(a, rn, mine, who, note);
  const how = a.source === "mail" ? "by email" : a.source === "slack" ? "in Slack" : "on GitHub";
  return (
    <div className="rn-pane__in">
      <div className="rn-who">
        <Avatar name={a.name || a.handle} size={36} />
        <div className="c-grow">
          <div className="rn-who__n">{a.name || a.handle}</div>
          <div className="rn-meta">{[a.handle_kind === "github" ? `@${a.handle}` : a.handle_kind === "email" ? a.handle : null, a.company_name,
            `asked ${mine ? "you " : a.heard_by ? `${who} ` : ""}${how}, ${weeks(a.asked_at)} ago`].filter(Boolean).join(" · ")}</div>
        </div>
        <Pill tone={st.tone}>{st.text}</Pill>
      </div>

      {a.heard_by && !mine ? (
        <p className="rn-quiet"><Lock size={13} aria-hidden="true" /> {a.name || "They"} asked {who} {how} on {day(a.asked_at)}. What they said stays in {who}'s own mail; {who}'s reply is drafted in that thread and waits in {who}'s Today.</p>
      ) : null}

      {mine ? (
        <>
          <div className="rn-meta">Your thread{thread?.subject ? ` · ${thread.subject}` : ""}</div>
          {!thread ? <Skeleton kind="list" rows={2} /> : thread.msgs.filter((m) => m.direction === "inbound").slice(0, 2).map((m) => (
            <div key={m.id} className="rn-msg"><div className="rn-meta">{m.from_name || m.from_handle} · {day(m.sent_at)}</div><div>{m.snippet}</div></div>
          ))}
        </>
      ) : null}
      {!a.heard_by ? (
        <div className="rn-msg"><div className="rn-meta">{a.source === "github" ? `GitHub issue ${issueNumber(a.work_id)}${a.work_title ? ` · ${a.work_title}` : ""}` : "Slack thread"} · {day(a.asked_at)}</div>
          <div className="c-muted">{a.source_id === a.work_id ? "They opened the issue." : a.source === "github" ? "They added to the issue." : "They asked in the thread."}</div></div>
      ) : null}

      <div className="rn-div">{weeks(a.asked_at)} later · {a.state === "open" ? "in" : "shipped in"} {note.name}{note.live_at ? ` · live since ${day(note.live_at)}` : ""}</div>

      {a.state === "suggested" ? <p className="rn-quiet"><Sparkles size={13} aria-hidden="true" /> The Lemma thinks {line?.title || "this"} is what they asked for. Say Yes on the left and a reply is drafted; No and nobody hears anything.</p> : null}
      {a.state === "open" ? <p className="rn-quiet">Once {note.name} is published, a reply is drafted {mine ? "in your thread, in your voice" : a.heard_by ? `in ${who}'s thread` : "here"}, for {mine || !a.heard_by ? "you" : who} to send.</p> : null}
      {mine && a.state !== "open" && a.state !== "suggested" ? <MailComposer a={a} draft={draft} /> : null}
      {!a.heard_by && a.state !== "open" && a.state !== "suggested" ? <ReplyComposer a={a} reply={reply} /> : null}
    </div>
  );
}

function MailComposer({ a, draft }: { a: Ask; draft: Draft | null }) {
  const toast = useToast();
  const [body, setBody] = useState(draft?.body || "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBody(draft?.body || ""); }, [draft?.id, draft?.body]);
  if (!draft) return <p className="rn-quiet">Your reply is being written in your voice. It shows here, and in your Today, in a minute or two.</p>;
  const sent = draft.state === "sent";
  const send = async () => {
    setBusy(true);
    try {
      toast(await sendMailDraft(draft, body));
    } catch (e) {
      toast(`Couldn't send: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  const notNow = async () => {
    await _u("draft", draft.id, { state: "discarded" }).catch(() => undefined);
    toast("Not telling them. Nobody asks you again.");
  };
  return (
    <div className="rn-cmp">
      <div className="rn-cmp__f"><span>To</span><span>{draft.to_handles.join(", ") || a.handle}</span></div>
      <div className="rn-cmp__f"><span>From</span><span>you, in the same thread</span></div>
      <div className="rn-cmp__b">
        {editing && !sent ? <textarea className="c-input c-textarea" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Reply" />
          : body.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
        <div className="rn-why"><Sparkles size={13} aria-hidden="true" className="c-muted" /><span className="rn-meta">Drafted in your voice from:</span>
          {(draft.built_from.used?.length ? draft.built_from.used : [draft.rationale || "your thread"]).map((u) => <span key={u} className="rn-chip">{u}</span>)}</div>
      </div>
      <div className="rn-cmp__a">
        {sent ? <Pill tone="success">Sent {ago(draft.sent_at)}</Pill> : (
          <>
            <Button variant="primary" icon={Send} busy={busy} onClick={() => void send()}>Send</Button>
            <Button onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}</Button>
            <Button variant="ghost" onClick={() => void notNow()}>Not now</Button>
          </>
        )}
        <span className="c-grow" />
        <span className="rn-meta">{draft.source_account === "sample" ? "A sample thread: Send only marks it sent." : "Sends from your mailbox through Mail. Also in your Today as an answer to give."}</span>
      </div>
    </div>
  );
}

function ReplyComposer({ a, reply }: { a: Ask; reply: Reply | null }) {
  const toast = useToast();
  const [body, setBody] = useState(reply?.body || "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBody(reply?.body || ""); }, [reply?.id, reply?.body]);
  if (!reply) return <p className="rn-quiet">The reply is being drafted.</p>;
  const sent = reply.state === "sent";
  const send = async () => {
    setBusy(true);
    try {
      toast(await sendReply(reply, body));
    } catch (e) {
      toast(`Couldn't send: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  const where = reply.channel === "github" ? `A comment on issue ${issueNumber(reply.target)}, posted as you` : "A reply in their Slack thread, posted by the Lemma's Slack app";
  return (
    <div className="rn-cmp">
      <div className="rn-cmp__f"><span>Where</span><span>{where}</span></div>
      <div className="rn-cmp__b">
        {sent ? body.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)
          : <textarea className="c-input c-textarea rn-cmp__ta" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Reply" />}
        {reply.error ? <p className="rn-warn-text">{reply.error}</p> : null}
      </div>
      <div className="rn-cmp__a">
        {sent ? <Pill tone="success">Sent {ago(reply.sent_at)}</Pill>
          : <Button variant="primary" icon={Send} busy={busy} onClick={() => void send()} disabled={!body.trim()}>Send</Button>}
        <span className="c-grow" />
        <span className="rn-meta">{reply.channel === "github" ? "Goes on the public issue." : "Goes in the thread they asked in."}</span>
      </div>
    </div>
  );
}

function NextUp({ current, all, filter }: { current: Ask; all: Ask[]; filter: Filter }) {
  const rn = useRN();
  const { me } = useWho();
  const next = all.filter((a) => a.id !== current.id && bucket(a, me?.id) === filter && a.state !== "suggested").slice(0, 3);
  if (!next.length) return null;
  return (
    <div className="rn-next">
      <span className="rn-meta">Next, {filter === "mine" ? "yours to tell" : filter === "public" ? "in public places" : filter === "others" ? "told by others" : "told"}</span>
      {next.map((a) => {
        const mine = a.heard_by === me?.id;
        const where = whereOf(a, mine, "a member");
        const st = stateOf(a, rn, mine, "a member", rn.notes.find((n) => n.state !== "published") || rn.notes[0]);
        return (
          <button key={a.id} type="button" className="rn-msg rn-msg--row" onClick={() => to.asked(a.id)}>
            <Avatar name={a.name || a.handle} size={28} />
            <span className="c-grow"><span>{a.name || a.handle}{a.company_name ? ` · ${a.company_name}` : ""}</span><span className="rn-meta rn-block">{where.text}</span></span>
            <Pill tone={st.tone}>{st.text}</Pill>
          </button>
        );
      })}
    </div>
  );
}
