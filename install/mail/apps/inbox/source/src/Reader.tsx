// One conversation: where it was put and why, the messages (older ones
// folded), the promises in it, and the reply underneath, holding the draft
// when one was written. Sending waits ten seconds for Undo, then leaves from
// the mailbox the conversation arrived in.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock, ArrowLeft, BellOff, CheckCheck, ChevronDown, ChevronUp, CircleHelp, ExternalLink, FolderInput, Handshake, ListChecks, Loader2,
  Mail, MoreHorizontal, RotateCcw, Send, Sparkles, Trash2,
} from "lucide-react";
import {
  Avatar, Button, Evidence, Menu, MenuItem, MenuLabel, Pill, client, create, due, nameOf, plural, runFunction, update, useToast,
} from "@lemma-plugins/kit";
import { isSample, useAct, useMail } from "./data";
import { MailBody, peek } from "./mail-body";
import { snoozeOptions } from "./List";
import { to, type View } from "./route";
import { parseThreadDoc, type DocMessage } from "./thread-doc";
import { ago, full, localAt, nextWeekday, short, until } from "./time";
import type { Conv, DraftRow, Mailbox } from "./types";

const UNDO_MS = 10_000;
const STATES: Record<string, [string, "plain" | "info" | "success" | "warning" | "ai"]> = {
  needs_reply: ["Needs your reply", "ai"], waiting: ["Waiting on them", "warning"], fyi: ["For reading", "plain"],
  done: ["Done", "success"], new: ["Being sorted", "plain"],
};
const STATE_CHOICES: [string, string][] = [["needs_reply", "Needs my reply"], ["waiting", "Waiting on them"], ["fyi", "Just for reading"], ["done", "Nothing to do"]];

function providerLink(c: Conv, box?: Mailbox): string | null {
  if (!box || box.account_id === "sample") return null;
  if (box.provider === "gmail") return `https://mail.google.com/mail/u/${encodeURIComponent(box.email)}/#all/${c.source_id}`;
  if (c.latest_message_id) return `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(c.latest_message_id)}`;
  return "https://outlook.office.com/mail/";
}

const pct = (v?: number | null) => (typeof v === "number" ? `${Math.round(v * 100)}%` : null);

export function Reader(props: { c: Conv; view: View; onDone: () => void; onSnooze: (label: string, iso: string) => void; onPrev?: () => void; onNext?: () => void }) {
  const { c, view } = props;
  const { categories, drafts, mailboxes, promises } = useMail();
  const act = useAct();
  const toast = useToast();
  const [doc, setDoc] = useState<{ messages: DocMessage[]; error?: string } | null>(null);
  const [unfold, setUnfold] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const box = mailboxes.find((m) => m.id === c.source_account);
  const category = categories.find((k) => k.key === c.category);
  const draft = drafts.find((d) => d.conversation_id === c.id && ["proposed", "approved", "sending", "failed"].includes(d.state));
  const here = promises.filter((p) => p.conversation_id === c.id);
  const link = providerLink(c, box);
  const [stateLabel, stateTone] = STATES[c.state] || [c.state, "plain"];
  const names = useMemo(() => Object.fromEntries(categories.map((k) => [k.key, k.name])), [categories]);

  useEffect(() => {
    let alive = true;
    if (!c.document_path) {
      setDoc({ messages: [] });
      return;
    }
    setDoc(null);
    client.files
      .download(c.document_path)
      .then((blob: Blob) => blob.text())
      .then((text: string) => alive && setDoc({ messages: parseThreadDoc(text) }))
      .catch((e: unknown) => alive && setDoc({ messages: [], error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [c.document_path, c.updated_at]);

  useEffect(() => {
    if (c.unread) void act([c.id], "read").catch(() => undefined);
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (key: string) =>
    void act([c.id], "move", { category: key }).then((r) => toast(`Moved to ${names[key] || key}${r?.corrections ? ". The sort will learn from it." : ""}`));
  const setState = (state: string) =>
    void act([c.id], "state", { state }).then((r) => toast(`Marked “${STATE_CHOICES.find((s) => s[0] === state)?.[1]}”${r?.corrections ? ". The sort will learn from it." : ""}`));
  const mute = () => {
    void act([c.id], "mute");
    toast("Muted: it won’t come back, even on new replies.", { action: { label: "Undo", run: () => void act([c.id], "restore") } });
    props.onDone();
  };

  const fromDoc = doc?.messages || [];
  // What was sent from here shows at once, from the sent draft, until the
  // conversation's document catches up.
  const sentHere: DocMessage[] = drafts
    .filter((d) => d.conversation_id === c.id && (d.state === "sent" || d.state === "sending") && d.body)
    .filter((d) => !fromDoc.some((m) => m.you && Math.abs(Date.parse(m.when || "") - Date.parse(d.sent_at || d.updated_at || "")) < 180_000))
    .map((d) => ({ who: "You", you: true, when: d.sent_at || d.updated_at || undefined, to: (d.to_handles || []).join(", "), body: d.body }));
  const messages = [...fromDoc, ...sentHere].sort((a, b) => Date.parse(a.when || "") - Date.parse(b.when || ""));
  const lastTwo = Math.max(0, messages.length - 2);
  const folded = !unfold && lastTwo >= 3;
  const conf = c.confidence || {};

  return (
    <div className="m-reader">
      <div className="m-readerbar" role="toolbar" aria-label="Conversation actions">
        <Button variant="ghost" icon={ArrowLeft} label="Back to the list" className="m-only-narrow" onClick={() => to.list(view)} />
        <Button size="sm" icon={CheckCheck} onClick={props.onDone} title="Done (e)">Done</Button>
        <Menu label={<span className="m-hide-xs">Snooze</span>} icon={AlarmClock} title="Snooze">
          {(close) => (
            <>
              <MenuLabel>Snooze until</MenuLabel>
              {snoozeOptions().map(([label, when, iso]) => (
                <MenuItem key={label} hint={when} onSelect={() => { close(); props.onSnooze(label, iso); }}>{label}</MenuItem>
              ))}
            </>
          )}
        </Menu>
        <Menu label={<span className="m-hide-xs">Move</span>} icon={FolderInput} title="Move to a category">
          {(close) => (
            <>
              <MenuLabel>Move to</MenuLabel>
              {categories.filter((k) => k.state === "active" && k.key !== c.category).map((k) => (
                <MenuItem key={k.key} onSelect={() => { close(); move(k.key); }}>{k.name}</MenuItem>
              ))}
            </>
          )}
        </Menu>
        <Menu label={<span className="m-hide-xs">It needs</span>} icon={ListChecks} title="What it needs from you">
          {(close) => (
            <>
              <MenuLabel>What it needs from you</MenuLabel>
              {STATE_CHOICES.map(([key, label]) => (
                <MenuItem key={key} onSelect={() => { close(); setState(key); }}>{label}</MenuItem>
              ))}
            </>
          )}
        </Menu>
        <span className="c-grow" />
        <Menu icon={MoreHorizontal} title="More" align="right" variant="ghost">
          {(close) => (
            <>
              <MenuItem icon={BellOff} onSelect={() => { close(); mute(); }}>Mute</MenuItem>
              <MenuItem icon={Mail} onSelect={() => { close(); void act([c.id], "unread").then(() => toast("Marked unread")); }}>Mark unread</MenuItem>
            </>
          )}
        </Menu>
        {link ? (
          <a className="c-btn c-btn--ghost c-btn--icon" href={link} target="_blank" rel="noopener noreferrer" title={`Open in ${box?.provider === "gmail" ? "Gmail" : "Outlook"}`} aria-label={`Open in ${box?.provider === "gmail" ? "Gmail" : "Outlook"}`}>
            <ExternalLink aria-hidden="true" />
          </a>
        ) : null}
        <span className="m-hide-narrow c-row" style={{ gap: 2 }}>
          <Button variant="ghost" icon={ChevronUp} label="Previous (k)" onClick={props.onPrev} disabled={!props.onPrev} />
          <Button variant="ghost" icon={ChevronDown} label="Next (j)" onClick={props.onNext} disabled={!props.onNext} />
        </span>
      </div>

      <div className="m-readerscroll">
        <article className="m-article">
          <h2 className="m-subject">{c.subject || "(no subject)"}</h2>
          <div className="m-meta">
            <Pill tone={stateTone}>{stateLabel}</Pill>
            {category ? <Pill dot={false}>{category.name}</Pill> : c.unsure ? <Pill tone="warning">Not sure</Pill> : null}
            {(c.priority || 0) >= 2 && c.state === "needs_reply" ? <Pill tone={c.priority === 3 ? "danger" : "warning"}>{c.priority === 3 ? "Today" : "This week"}</Pill> : null}
            <span className="m-quiet">{box?.account_id === "sample" ? "Sample mailbox" : c.place}</span>
          </div>

          {c.state === "new" ? (
            <div className="m-why"><Loader2 size={14} className="m-spin" aria-hidden="true" /> Reading it…</div>
          ) : c.unsure ? (
            <div className="m-why m-why--unsure">
              <div className="m-why__head"><CircleHelp size={14} aria-hidden="true" /> {c.reason || "Not sure where this goes."}</div>
              <p>Put it where it belongs. The sort reads your last twenty moves as examples, so the next one like it lands right.</p>
              <div className="m-chips">
                {!c.category
                  ? categories.filter((k) => k.state === "active").map((k) => (
                      <button key={k.key} type="button" className="m-chip" onClick={() => move(k.key)}>{k.name}</button>
                    ))
                  : STATE_CHOICES.map(([key, label]) => (
                      <button key={key} type="button" className="m-chip" onClick={() => setState(key)}>{label}</button>
                    ))}
              </div>
            </div>
          ) : (
            <div className="m-why">
              <div className="m-why__head">
                <Sparkles size={13} aria-hidden="true" />
                <span>{c.ask || c.reason || stateLabel}</span>
              </div>
              <p className="m-why__sub">
                {c.sorted_by === "person" ? "You put it here." : `${category?.name || "Sorted"}${pct(conf.category) ? ` (${pct(conf.category)} sure)` : ""}, ${stateLabel.toLowerCase()}${pct(conf.state) ? ` (${pct(conf.state)})` : ""}.`}
                {c.state === "waiting" && c.follow_up_at ? ` Nudge ${until(c.follow_up_at)}, ${full(c.follow_up_at)}.` : ""}
              </p>
            </div>
          )}

          {here.length ? (
            <div className="m-promises">
              {here.map((p) => {
                const d = due(p.due_at);
                return (
                  <div key={p.id} className="m-promise">
                    <div className="m-promise__head">
                      <Handshake size={13} aria-hidden="true" />
                      <span>{p.direction === "i_owe" ? "You promised" : `${nameOf(p.person_name, p.person_handle)} promised`}</span>
                      <span className="m-promise__text">{p.text}</span>
                      {d.text ? <Pill tone={d.late ? "danger" : "plain"} dot={false}>{d.text}</Pill> : null}
                    </div>
                    <Evidence quote={p.quote} />
                  </div>
                );
              })}
            </div>
          ) : null}

          <section className="m-msgs" aria-label="Messages">
            {!doc ? (
              <div className="m-msg"><div className="c-skel" style={{ height: 14, width: "35%", marginBottom: 12 }} /><div className="c-skel" style={{ height: 80 }} /></div>
            ) : messages.length ? (
              messages.map((m, i) => {
                if (i < lastTwo && !expanded.has(i)) {
                  if (folded && i > 0) {
                    return i === 1 ? (
                      <button key="fold" type="button" className="m-fold" onClick={() => setUnfold(true)}>{plural(lastTwo - 1, "more message")}</button>
                    ) : null;
                  }
                  return (
                    <button key={i} type="button" className="m-msg m-msg--folded" onClick={() => setExpanded((x) => new Set(x).add(i))}>
                      <Avatar name={m.you ? "You" : m.who} email={m.email} size={22} you={m.you} />
                      <span className="m-msg__who">{m.you ? "You" : m.who}</span>
                      <span className="m-msg__peek">{peek(m.body)}</span>
                      <span className="m-msg__when num">{short(m.when)}</span>
                    </button>
                  );
                }
                return (
                  <div key={i} className="m-msg">
                    <div className="m-msg__head">
                      <Avatar name={m.you ? "You" : m.who} email={m.email} size={28} you={m.you} />
                      <div className="m-msg__from">
                        <span className="m-msg__who">{m.you ? "You" : m.who}</span>
                        {!m.you && m.email ? <span className="m-msg__addr">{m.email}</span> : null}
                      </div>
                      <span className="m-msg__when num" title={m.when ? new Date(m.when).toLocaleString() : undefined}>
                        {full(m.when)} · {ago(m.when)}
                      </span>
                    </div>
                    <MailBody text={m.body} />
                  </div>
                );
              })
            ) : (
              <div className="m-msg">
                <p>{c.snippet || "No text in this message."}</p>
                {doc.error ? <p className="c-faint m-small">The whole conversation couldn’t be loaded: {doc.error}</p> : null}
              </div>
            )}
          </section>

          <Composer c={c} draft={draft} box={box} />
        </article>
      </div>
    </div>
  );
}

/* ---------- the reply ---------- */

const INTENTS: { label: string; hint: string }[] = [
  { label: "Say yes", hint: "Agree to what they asked, warmly and briefly." },
  { label: "Decline kindly", hint: "Say no, kindly and briefly, without over-explaining." },
  { label: "Ask a question", hint: "Ask the one question I need answered before I can reply properly." },
];

const addresses = (text: string) => text.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@"));

function Composer({ c, draft, box }: { c: Conv; draft?: DraftRow; box?: Mailbox }) {
  const act = useAct();
  const toast = useToast();
  const writing = c.draft_state === "wanted" || c.draft_state === "writing";
  const want = (hint: string) =>
    void act([c.id], "draft", { hint: hint || undefined, kind: c.state === "waiting" ? "follow_up" : "reply" }).catch((e: unknown) =>
      toast(`Couldn’t ask for a draft: ${e instanceof Error ? e.message : e}`),
    );
  if (writing) {
    return (
      <section className="m-compose is-drafted" aria-live="polite">
        <div className="m-writing"><Loader2 size={15} className="m-spin" aria-hidden="true" /> Writing a {c.draft_kind === "follow_up" ? "nudge" : "reply"} in your voice{c.draft_hint ? <span className="c-faint"> · “{c.draft_hint}”</span> : <span className="c-faint"> · usually under a minute</span>}</div>
      </section>
    );
  }
  return <ReplyBox key={draft?.id || "blank"} c={c} draft={draft} box={box} onWant={want} />;
}

function ReplyBox({ c, draft, box, onWant }: { c: Conv; draft?: DraftRow; box?: Mailbox; onWant: (hint: string) => void }) {
  const { patchDraft, patch, reload, mailboxes } = useMail();
  const toast = useToast();
  const [body, setBody] = useState(draft?.body || "");
  const [to, setTo] = useState((draft?.to_handles || [c.counterpart_handle || ""]).filter(Boolean).join(", "));
  const [why, setWhy] = useState(false);
  const [redraft, setRedraft] = useState("");
  const [sending, setSending] = useState(!!draft && (draft.state === "sending" || (draft.state === "approved" && !!draft.send_at)));
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const drafted = Boolean(draft);
  const sample = isSample(mailboxes, c.source_account);
  const who = nameOf(c.counterpart_name, c.counterpart_handle);
  const dirty = !!draft && (body !== draft.body || to !== (draft.to_handles || []).join(", "));

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.max(drafted ? 140 : 90, el.scrollHeight + 2) + "px";
  }, [body, drafted]);

  // Edits to a draft are kept quietly, so a reload never loses them.
  useEffect(() => {
    if (!draft || !dirty) return;
    const t = window.setTimeout(() => void update("draft", draft.id, { body, to_handles: addresses(to) }), 900);
    return () => window.clearTimeout(t);
  }, [body, to, dirty, draft]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const deliver = useCallback(async (id: string) => {
    try {
      const out = await runFunction<{ sent: boolean; message: string }>("mail_send_draft", { draft_id: id });
      toast(out.message || (out.sent ? "Sent" : "Not sent"));
    } catch (e) {
      toast(`Couldn’t send: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSending(false);
      void reload("drafts");
      void reload("conversations");
    }
  }, [toast, reload]);

  const send = useCallback(async (at?: string, label?: string) => {
    const recipients = addresses(to);
    if (!recipients.length) return toast("Add a recipient first.");
    if (!body.trim()) return toast("Write something first.");
    const sendAt = at || new Date(Date.now() + UNDO_MS).toISOString();
    setSending(true);
    let id = draft?.id;
    const fields = { body, to_handles: recipients, state: "approved", send_at: sendAt };
    try {
      if (id) {
        patchDraft(id, { state: "approved", send_at: sendAt });
        await update("draft", id, fields);
      } else {
        // A reply you wrote yourself becomes a draft too: one path out, one Undo.
        const row = await create<{ id: string }>("draft", {
          conversation_id: c.id, source: "mail", source_account: c.source_account, kind: c.state === "waiting" ? "follow_up" : "reply",
          subject: c.subject ? (/^re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`) : null, original_body: body, cc_handles: [], ...fields,
        });
        id = row.id;
      }
    } catch (e) {
      setSending(false);
      return toast(`Couldn’t save the reply: ${e instanceof Error ? e.message : e}`);
    }
    const undo = () => {
      window.clearTimeout(timer.current);
      setSending(false);
      if (id) void update("draft", id, { state: "proposed", send_at: null });
    };
    if (at) {
      patch([c.id], { state: "waiting" });
      toast(`Scheduled for ${label}`, { action: { label: "Undo", run: undo } });
      return;
    }
    toast(`Sending to ${nameOf(c.counterpart_name, recipients[0])}…`, { ms: UNDO_MS, action: { label: "Undo", run: undo } });
    const sendId = id!;
    timer.current = window.setTimeout(() => void deliver(sendId), UNDO_MS);
  }, [to, body, draft, c, patchDraft, patch, toast, deliver]);

  const discard = () => {
    if (!draft) return setBody("");
    void update("draft", draft.id, { state: "discarded" });
    void update("mail_thread", c.id, { draft_state: "none" });
    patch([c.id], { draft_state: "none" });
    toast("Draft thrown away", { action: { label: "Undo", run: () => void update("draft", draft.id, { state: "proposed" }) } });
  };

  const kind = draft?.kind === "follow_up" ? "Nudge" : "Reply";
  const title = drafted ? `${kind} to ${who}` : c.state === "waiting" ? `Follow up with ${who}` : `Reply to ${who}`;
  return (
    <section className={"m-compose" + (drafted ? " is-drafted" : "")} onKeyDown={(e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !sample) {
        e.preventDefault();
        void send();
      }
    }}>
      <div className="m-compose__head">
        <Avatar name="You" email={box?.email} size={22} you />
        <span className="m-compose__title">{title}</span>
        <span className="c-grow" />
        {draft?.state === "failed" ? <Pill tone="danger">Didn’t send</Pill> : null}
        {drafted ? <Pill tone="ai" icon={Sparkles}>Drafted in your voice</Pill> : null}
        {drafted && draft?.rationale ? (
          <Button size="sm" variant="ghost" onClick={() => setWhy((v) => !v)} aria-expanded={why}>Why?</Button>
        ) : null}
      </div>
      {why && draft ? (
        <div className="m-note">
          {draft.rationale}
          {Array.isArray(draft.built_from) && draft.built_from.length ? (
            <div className="m-chips">{(draft.built_from as string[]).slice(0, 8).map((s) => <span key={s} className="c-pill c-pill--plain">{s}</span>)}</div>
          ) : null}
        </div>
      ) : null}
      {draft?.state === "failed" && draft.error ? <div className="m-note m-note--warn">{draft.error}</div> : null}
      <label className="m-to">
        <span>To</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} disabled={sending} aria-label="To" />
      </label>
      <textarea ref={boxRef} className="m-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Write to ${who}, or have it drafted…`} aria-label="Reply" disabled={sending} spellCheck />
      {!drafted && !body.trim() && !sending ? (
        <div className="m-chips" aria-label="Have it drafted">
          <Button size="sm" icon={Sparkles} onClick={() => onWant("")}>{c.state === "waiting" ? "Write a nudge" : "Draft a reply"}</Button>
          {c.state !== "waiting" ? INTENTS.map((i) => <Button key={i.label} size="sm" variant="ghost" onClick={() => onWant(i.hint)}>{i.label}</Button>) : null}
        </div>
      ) : null}
      <div className="m-compose__foot">
        <Button variant="primary" icon={Send} onClick={() => void send()} disabled={sending || !body.trim() || sample} title={sample ? "Nothing can be sent from the sample mailbox" : "Send (⌘↵)"}>
          Send
        </Button>
        <Menu label="Send later" up>
          {(close) => (
            <>
              <MenuLabel>Send at</MenuLabel>
              <MenuItem hint="08:30" onSelect={() => { close(); if (!sample) void send(localAt(1, 8, 30), "tomorrow 08:30"); }}>Tomorrow morning</MenuItem>
              <MenuItem hint="08:30" onSelect={() => { close(); if (!sample) void send(localAt(nextWeekday(1), 8, 30), "Monday 08:30"); }}>Monday morning</MenuItem>
            </>
          )}
        </Menu>
        {drafted ? (
          <form className="m-redraft" onSubmit={(e) => {
            e.preventDefault();
            if (redraft.trim()) {
              onWant(redraft.trim());
              setRedraft("");
            }
          }}>
            <RotateCcw size={13} className="c-faint" aria-hidden="true" />
            <input value={redraft} onChange={(e) => setRedraft(e.target.value)} placeholder="Redraft: “shorter”, “say no to the call”…" aria-label="Redraft with a note" disabled={sending} />
          </form>
        ) : <span className="c-grow" />}
        {drafted || body ? <Button variant="ghost" icon={Trash2} label="Throw away the draft" onClick={discard} disabled={sending} /> : null}
      </div>
      {sample ? <p className="c-faint m-small">This is the sample mailbox, so nothing can be sent. Drafts, moves and promises all work.</p> : null}
    </section>
  );
}
