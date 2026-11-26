// One answer (C): what they wrote, the Lemma's read, why it went where it
// went (every rule in order), the reply drafted in the owner's own mailbox,
// and a timeline; beside it the answer's properties, who they are, the
// company and its open deal, and Lead research's read. The same sections,
// shorter, are the side pane on Answers.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, CircleHelp, FileText, Paperclip, Send, Sparkles, SquarePen, Trash2, Undo2 } from "lucide-react";
import { Avatar, Button, DEMO, Empty, Kbd, Logo, Money, Pill, Spinner, cx, domainOf, openApp, q, runFunction, sql, update, useToast } from "@lemma-plugins/kit";
import { KindPicker, RerouteMenu, useActions } from "./actions";
import { hasOpened, isOpen, minutes, nowMs, ownerName, replyMinutes, useForms, useWho, type Data } from "./data";
import { busyKey } from "./keys";
import { Ai, Chip, Clock, Gap, KIND_WORDS, MODE_WORDS, NOT_BUILT, ROUTED_WORDS, SOURCE_WORDS, Who, age, fileName, firstOf, hhmm, kindPill, mins, statePill, whenShort } from "./marks";
import { to } from "./route";
import type { Answer as A, Draft } from "./types";
import { UNDO_MS, approveDraft, deliverDraft, replyFromLemma, undoDraft, why } from "./wire";

const t = (s: string | null | undefined) => Date.parse(s || "") || 0;

function useQuery<T>(text: string | null): T[] | null {
  const [rows, setRows] = useState<T[] | null>(null);
  useEffect(() => {
    let live = true;
    if (!text) { setRows([]); return; }
    q<T>(text).then((r) => live && setRows(r)).catch(() => live && setRows([]));
    return () => { live = false; };
  }, [text]);
  return rows;
}

function waitingList(d: Data): A[] {
  return d.answers.filter(isOpen).sort((a, b) => t(a.received_at) - t(b.received_at));
}

/** An option's stored word as people read it: "something_else" -> "Something else". */
export function pretty(v: unknown): string {
  const s = String(v ?? "");
  return /^[a-z]+(_[a-z]+)+$/.test(s) ? (s[0].toUpperCase() + s.slice(1)).replace(/_/g, " ") : s;
}

/* ---------- the page ---------- */

export function Answer({ id }: { id: string }) {
  const d = useForms();
  const a = d.byId.get(id);
  const waiting = useMemo(() => waitingList(d), [d]);
  const at = a ? waiting.findIndex((x) => x.id === a.id) : -1;
  const x = useActions();
  const ref = useRef({ a, waiting, at, x });
  ref.current = { a, waiting, at, x };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (busyKey(e)) return;
      const { a, waiting, at, x } = ref.current;
      const k = e.key.toLowerCase();
      if ((k === "j" || k === "k") && waiting.length) {
        e.preventDefault();
        const next = waiting[Math.max(0, Math.min(waiting.length - 1, at < 0 ? 0 : at + (k === "j" ? 1 : -1)))];
        if (next) to.answer(next.id);
      } else if (!a) return;
      else if (k === "s") { e.preventDefault(); void x.setAside(a); }
      else if (k === "u") { e.preventDefault(); void x.putBack(a); }
      else if (k === "n") { e.preventDefault(); void x.notSure(a); }
      else if (k === "r") { e.preventDefault(); (document.querySelector(".fm-reroute .c-btn") as HTMLButtonElement | null)?.click(); }
      else if (e.key === "Escape") to.answers();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  if (!a) {
    return <main className="c-body"><Empty icon={FileText} title="No such answer" action={<Button onClick={() => to.answers()}>Back to answers</Button>}>It may have been cleared with the sample.</Empty></main>;
  }
  return (
    <div className="fm-case">
      <nav className="fm-crumb" aria-label="Where you are">
        <button type="button" onClick={() => to.answers()}><ArrowLeft aria-hidden="true" />Answers</button>
        <span className="fm-faint">/</span>
        <span className="fm-ellipsis">{d.formsById.get(a.form_id)?.name || "A form"}</span>
        <span className="fm-fill" />
        {at >= 0 ? (
          <span className="fm-nav">
            <span className="fm-muted fm-small">{at + 1} of {waiting.length} waiting</span>
            <Button size="sm" variant="ghost" icon={ChevronUp} label="Previous waiting (K)" disabled={at <= 0} onClick={() => to.answer(waiting[at - 1].id)} />
            <Button size="sm" variant="ghost" icon={ChevronDown} label="Next waiting (J)" disabled={at >= waiting.length - 1} onClick={() => to.answer(waiting[at + 1].id)} />
          </span>
        ) : null}
      </nav>
      <Head a={a} d={d} />
      <div className="fm-body">
        <main className="fm-main">
          <Wrote a={a} d={d} />
          <Read a={a} />
          <WhyWent a={a} d={d} />
          <Reply a={a} d={d} />
          <Timeline a={a} d={d} />
        </main>
        <aside className="fm-side">
          <Props a={a} d={d} />
          <div className="fm-hr" />
          <WhoTheyAre a={a} d={d} />
          <div className="fm-hr" />
          <LeadRead a={a} d={d} />
        </aside>
      </div>
    </div>
  );
}

function Head({ a, d }: { a: A; d: Data }) {
  const { members, me } = useWho();
  const x = useActions();
  const f = d.formsById.get(a.form_id);
  const now = nowMs(d);
  const owner = ownerName(d, members, a);
  const draft = a.draft_id ? d.drafts.get(a.draft_id) : undefined;
  const canSend = !!draft && draft.state === "proposed" && a.owner_user_id === me?.id;
  return (
    <header className="fm-casehead">
      <div className="fm-casehead__row">
        <Avatar name={a.name || a.handle || "?"} size={36} />
        <div className="fm-casehead__t">
          <h1 className="fm-title">{a.name || a.handle || "Someone"}{a.company_name ? <span className="fm-muted"> · {a.company_name}</span> : null}</h1>
          <p className="fm-facts">
            <span>{f?.name || "A form"}</span>
            {f?.place ? <span>{f.place}</span> : null}
            <span>{whenShort(a.received_at, now)}</span>
          </p>
        </div>
      </div>
      <div className="fm-pills">
        {a.state !== "unsure" ? kindPill(a, true, a.kind_why) : null}
        {statePill(a)}
        {a.routed_to && a.routed_to !== "forms" ? <Pill tone="plain">{ROUTED_WORDS[a.routed_to] || a.routed_to}{a.work_label ? ` · ${a.work_label}` : ""}</Pill> : null}
        {owner && a.state !== "set_aside" ? <span className="fm-who"><Who name={owner} you={a.owner_user_id === me?.id} />{owner}{a.owner_user_id === me?.id ? " (you)" : ""}</span> : null}
        {isOpen(a) ? <span className="fm-who">Waiting <Clock a={a} now={now} goal={d.settings?.goal_minutes || 60} /></span> : null}
      </div>
      <div className="fm-acts">
        <span className="fm-reroute"><RerouteMenu a={a} /></span>
        {a.state === "set_aside"
          ? <Button icon={Undo2} onClick={() => void x.putBack(a)}>Put back <Kbd>U</Kbd></Button>
          : <Button icon={Trash2} onClick={() => void x.setAside(a)}>Set aside <Kbd>S</Kbd></Button>}
        {a.state !== "unsure" && isOpen(a) ? <Button icon={CircleHelp} onClick={() => void x.notSure(a)}>Not sure <Kbd>N</Kbd></Button> : null}
        {canSend ? <Button variant="primary" icon={Send} onClick={() => document.getElementById("fm-reply")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Review and send</Button> : null}
      </div>
    </header>
  );
}

function Wrote({ a, d, short }: { a: A; d: Data; short?: boolean }) {
  const pronoun = "they";
  const files = a.fields.filter((f) => f.type === "file").length;
  const shown = short ? a.fields.filter((f) => f.type !== "email").slice(0, 6) : a.fields;
  return (
    <section className="fm-wrote">
      <h2 className="fm-h2">What {pronoun} wrote<span className="fm-sub">{a.fields.length} {a.fields.length === 1 ? "field" : "fields"}{files ? ` · ${files} ${files === 1 ? "file" : "files"}` : ""}</span></h2>
      <dl className="fm-fields">
        {shown.map((f, i) => (
          <div key={`${f.key || f.label}-${i}`} className="fm-field">
            <dt>{f.label}</dt>
            <dd>{f.type === "file" ? <span className="fm-file"><Paperclip aria-hidden="true" />{fileName(String(f.value))}<span className="fm-faint"> · linked, not read</span></span>
              : f.type === "email" ? <a href={`mailto:${f.value}`} className="fm-link">{String(f.value)}</a>
                : <span className="fm-said">{pretty(f.value)}</span>}</dd>
          </div>
        ))}
      </dl>
      {!short && Object.keys(a.came_from || {}).length ? (
        <p className="fm-small fm-muted fm-gapline">Came from {Object.entries(a.came_from).map(([k, v]) => `${k.replace("_", " ")}: ${v}`).join(" · ")}</p>
      ) : null}
      {d && !a.fields.length ? <p className="fm-muted">Nothing but who they are.</p> : null}
    </section>
  );
}

function Read({ a }: { a: A }) {
  return (
    <section className="fm-read">
      <h2 className="fm-read__head"><Sparkles aria-hidden="true" />The Lemma's read <Ai /></h2>
      {a.state === "set_aside" ? (
        <p>Set aside{a.kind === "spam" ? " as spam" : ""}: {a.set_aside_why || "a person set it aside"}. It's kept, never deleted.</p>
      ) : a.kind ? (
        <p>Reads as <b>{KIND_WORDS[a.kind].toLowerCase()}</b>{a.kind_why ? <>, because it “{a.kind_why}”</> : null}.
          {a.kind_by === "person" ? " A person picked this." : a.kind_sure != null ? ` ${Math.round(a.kind_sure * 100)}% sure.` : ""}</p>
      ) : (
        <>
          <p>Not sure what this is{a.kind_sure != null ? ` (${Math.round(a.kind_sure * 100)}% at best)` : ""}: {a.kind_why || "it doesn't say enough to tell"}. Pick what it is, or who should have it; each pick becomes an example for the next read.</p>
          {a.state === "unsure" ? <KindPicker a={a} /> : null}
        </>
      )}
    </section>
  );
}

function WhyWent({ a, d }: { a: A; d: Data }) {
  const { members } = useWho();
  const owner = ownerName(d, members, a);
  if (a.state === "set_aside") return null;
  const label = { used: "used", not_needed: "not needed", none_set: "none set" } as const;
  return (
    <section className="fm-why">
      <h2 className="fm-h2">Why it went to {a.routed_to === "triage" ? "Triage" : firstOf(owner) || "nobody yet"}<span className="fm-sub">the first rule that answers</span></h2>
      {a.state === "unsure" ? <p className="fm-muted">Nothing is routed until it's read: {firstOf(owner) || "the form's default owner"} is asked to pick, and after an hour it goes to them, still marked not sure.</p> : null}
      {a.rules_checked.length ? (
        <ol className="fm-rules">
          {a.rules_checked.map((r, i) => (
            <li key={i} className={cx("fm-rulecheck", r.result === "used" && "fm-rulecheck--used")}>
              <span className="fm-rulecheck__x">
                <span>{r.rule}</span>
                {r.said && r.said !== r.rule && r.result === "used" ? <span className="fm-muted fm-small">{r.said}{r.deal ? ` · “${r.deal}” in Deal tracker` : ""}</span> : null}
                {r.result !== "used" && r.said && r.said !== "Not needed" ? <span className="fm-faint fm-small">{r.said}</span> : null}
              </span>
              <Pill tone={r.result === "used" ? "success" : "plain"}>{label[r.result] || r.result}</Pill>
            </li>
          ))}
        </ol>
      ) : a.owner_why ? <p>{a.owner_why}.</p> : null}
      {a.routed_to !== "triage" && owner ? <p className="fm-small fm-muted fm-gapline">Only {firstOf(owner)} gets this as a conversation, in their own space. The rest of the team sees it here{a.routed_to === "deals" ? " and on the deal" : ""}.</p> : null}
      <div className="fm-gaps">
        {a.owner_user_id && !hasOpened(d, a.owner_user_id) && isOpen(a) ? <Gap>{firstOf(owner)} hasn't opened Forms yet</Gap> : null}
        {a.kind && NOT_BUILT[a.kind] && a.routed_to === "forms" ? <Gap>{NOT_BUILT[a.kind]}</Gap> : null}
      </div>
      {a.work_label && a.routed_to === "triage" ? (
        <p className="fm-gapline"><button type="button" className="fm-link" onClick={() => void openApp("triage", `/i/${String(a.work_label).replace(/^T-/, "")}`)}>Open {a.work_label} in Triage</button></p>
      ) : null}
    </section>
  );
}

/* ---------- the reply ---------- */

function Reply({ a, d, short }: { a: A; d: Data; short?: boolean }) {
  const { members, me } = useWho();
  const f = d.formsById.get(a.form_id);
  const owner = ownerName(d, members, a);
  const mine = !!me && a.owner_user_id === me.id;
  const draft = a.draft_id ? d.drafts.get(a.draft_id) : undefined;
  const mode = f?.reply_mode || "draft";
  const gaps = (
    <div className="fm-gaps">
      {isOpen(a) && a.state !== "unsure" && mode !== "chat_only" ? <Gap>Waits for {mine ? "your" : `${firstOf(owner)}'s`} tap: a function can't send to someone outside</Gap> : null}
      {a.handle_kind === "phone" ? <Gap>An ad lead isn't a contact, so the Lemma's address can't reply</Gap>
        : !a.contact_id && a.handle && mode !== "chat_only" ? <Gap>Not from the Lemma's address: a typed email isn't a contact</Gap> : null}
    </div>
  );
  let body: ReactNode;
  if (a.state === "set_aside") return null;
  if (a.routed_to === "triage") {
    body = <p className="fm-muted">Triage files it and tells them when it's fixed; no reply is drafted here.</p>;
  } else if (a.state === "unsure") {
    body = <p className="fm-muted">A reply is drafted once someone picks where it goes.</p>;
  } else if (a.first_reply_at) {
    const m = replyMinutes(a);
    body = <p>{nameOrYou(a.replied_by, me?.id, d, members)} replied {a.reply_via === "lemma_address" ? "from the Lemma's address" : a.reply_via === "elsewhere" ? "elsewhere" : "by email"}, {minutes(m)} after it came in.</p>;
  } else if (mine && draft) {
    body = <DraftBox a={a} d={d} draft={draft} />;
  } else if (mode === "chat_only") {
    body = <p className="fm-muted">This form answers in the chat beside it; no email is drafted. {MODE_WORDS.chat_only}.</p>;
  } else if (mine && mode === "lemma_address" && a.contact_id) {
    body = <LemmaReply a={a} />;
  } else if (a.draft_state === "ready" && !mine) {
    body = <p>Drafted for {firstOf(owner)}, in {owner ? "their" : "the owner's"} mailbox. Only {firstOf(owner) || "they"} can see it and send it.</p>;
  } else if (a.draft_state === "wanted" || a.draft_state === "writing") {
    body = <p className="fm-writing"><Spinner /> Drafting a reply in {mine ? "your" : `${firstOf(owner)}'s`} mailbox…</p>;
  } else if (a.draft_state === "no_mailbox") {
    body = mine
      ? <p>No reply drafted: you haven't connected your mail. <button type="button" className="fm-link" onClick={() => void openApp("inbox", "/")}>Connect it in Mail</button> and the next answer gets a draft.</p>
      : <p className="fm-muted">No reply drafted: {firstOf(owner)} hasn't connected a mailbox.</p>;
  } else if (a.handle_kind === "phone") {
    body = <p className="fm-muted">They left a phone number, not an email: {firstOf(owner) || "the owner"} calls them back.</p>;
  } else {
    body = <p className="fm-muted">{owner ? `Waiting for ${firstOf(owner)}.` : "Waiting for an owner."}</p>;
  }
  return (
    <section id="fm-reply" className="fm-reply">
      <h2 className="fm-h2">The reply{draft && mine && !a.first_reply_at ? ", drafted" : ""}{draft && mine ? <Ai /> : null}</h2>
      {body}
      {short ? null : gaps}
    </section>
  );
}

function nameOrYou(id: string | null, me: string | undefined, d: Data, members: { user_id: string; name: string }[]): string {
  if (id && id === me) return "You";
  return id ? (members.find((m) => m.user_id === id)?.name || d.settings?.members.find((m) => m.user_id === id)?.name || "Someone") : "Someone";
}

function DraftBox({ a, d, draft }: { a: A; d: Data; draft: Draft }) {
  const toast = useToast();
  const box = d.mailboxes.find((m) => m.id === draft.source_account);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => { if (!editing) setBody(draft.body); }, [draft.body, editing]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const pending = draft.state === "approved" || draft.state === "sending";
  const send = useCallback(async () => {
    setBusy(true);
    try {
      await approveDraft(draft, editing ? body : undefined);
      setEditing(false);
      await d.reload();
      const undo = async () => {
        window.clearTimeout(timer.current);
        await undoDraft(draft).catch(() => undefined);
        await d.reload();
        toast("Not sent. It's back as a draft.");
        setBusy(false);
      };
      toast(`Sending to ${draft.to_handles[0] || a.handle} in 10 seconds.`, { action: { label: "Undo", run: () => void undo() }, ms: UNDO_MS });
      timer.current = window.setTimeout(async () => {
        try {
          const out = await deliverDraft(draft);
          toast(out.sent ? out.message : `Not sent: ${out.message}`);
        } catch (e) {
          toast(`Couldn't send: ${why(e, box?.provider)}`);
        } finally {
          setBusy(false);
          await d.reload();
        }
      }, UNDO_MS);
    } catch (e) {
      toast(`Couldn't send: ${why(e)}`);
      setBusy(false);
    }
  }, [a.handle, body, box?.provider, d, draft, editing, toast]);
  const save = async () => {
    try {
      await update("draft", draft.id, { body });
      setEditing(false);
      await d.reload();
      toast("Saved the draft.");
    } catch (e) {
      toast(`Couldn't save it: ${why(e)}`);
    }
  };
  return (
    <div className="fm-draft">
      <div className="fm-draft__head">
        <span className="fm-k">From</span><span>{box ? `${box.email}, your own mailbox` : "your mailbox"}</span>
        <span className="fm-k">To</span><span>{draft.to_handles.join(", ")}</span>
        <span className="fm-k">Subject</span><span>{draft.subject}</span>
      </div>
      {editing
        ? <textarea className="c-input c-textarea fm-draft__edit" value={body} onChange={(e) => setBody(e.target.value)} rows={10} aria-label="The reply" />
        : <div className="fm-draft__body">{draft.body}</div>}
      {draft.rationale ? <p className="fm-small fm-muted fm-draft__why"><Sparkles aria-hidden="true" />{draft.rationale}</p> : null}
      {draft.state === "failed" ? <p className="fm-small fm-bad">It didn't go: {draft.error || "Mail couldn't send it"}. Try again.</p> : null}
      <div className="fm-acts">
        {draft.state === "sent" ? <Pill tone="success">Sent {hhmm(draft.sent_at)}</Pill> : pending ? <span className="fm-writing"><Spinner /> Sending…</span> : (
          <>
            <Button icon={Send} busy={busy} onClick={() => void send()}>Send from your mailbox</Button>
            {editing ? <Button onClick={() => void save()}>Save</Button> : <Button icon={SquarePen} onClick={() => setEditing(true)}>Edit</Button>}
          </>
        )}
        <span className="fm-small fm-muted">Also waiting in your Today</span>
      </div>
      {box?.account_id === "sample" ? <p className="fm-small fm-faint">This is the sample mailbox: nothing can be sent from it.</p> : null}
    </div>
  );
}

function LemmaReply({ a }: { a: A }) {
  const toast = useToast();
  const d = useForms();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="fm-draft">
      <p className="fm-small fm-muted">From the Lemma's own address, to {a.handle}: they confirmed this email. Up to 10 lines a day to one person, and 200 emails a day from the Lemma.</p>
      <textarea className="c-input c-textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="The reply" />
      <div className="fm-acts">
        <Button variant="primary" icon={Send} busy={busy} disabled={!text.trim()} onClick={async () => {
          setBusy(true);
          try {
            toast(await replyFromLemma(a, text));
            await d.reload();
          } catch (e) {
            toast(`Couldn't send: ${why(e)}`);
          } finally {
            setBusy(false);
          }
        }}>Send from the Lemma</Button>
      </div>
    </div>
  );
}

/* ---------- the timeline and the side ---------- */

function Timeline({ a, d }: { a: A; d: Data }) {
  const { me } = useWho();
  const events = d.eventsBy.get(a.id) || [];
  const now = nowMs(d);
  return (
    <section className="fm-timeline">
      <h2 className="fm-h2">Timeline</h2>
      <ol className="fm-tl">
        {events.map((e) => (
          <li key={e.id} className="fm-tl__row">
            <span className="fm-tl__dot" aria-hidden="true" />
            <span className="fm-tl__x">{e.text}</span>
            <span className="fm-tl__at fm-faint">{hhmm(e.at)}</span>
          </li>
        ))}
        {isOpen(a) && a.state !== "unsure" ? (
          <li className="fm-tl__row"><span className="fm-tl__dot fm-tl__dot--now" aria-hidden="true" /><span className="fm-tl__x fm-muted">{a.owner_user_id && a.owner_user_id === me?.id ? "Waiting for your reply" : `Waiting for ${firstOf(a.owner_name) || "a reply"}`}</span><span className="fm-tl__at fm-faint">{age(mins(a.received_at, now))}</span></li>
        ) : null}
      </ol>
      {!events.length ? <p className="fm-muted">Nothing yet.</p> : null}
    </section>
  );
}

function Props({ a, d }: { a: A; d: Data }) {
  const { members } = useWho();
  const f = d.formsById.get(a.form_id);
  const now = nowMs(d);
  const owner = ownerName(d, members, a);
  const m = replyMinutes(a);
  const rows: [string, ReactNode][] = [
    ["State", statePill(a)],
    ["Kind", a.kind ? KIND_WORDS[a.kind] : "Not sure"],
    ["Went to", a.state === "set_aside" ? "Nobody" : ROUTED_WORDS[a.routed_to || ""] || "Forms"],
    ["Owner", a.state === "set_aside" ? "Nobody" : owner ? <span className="fm-who"><Who name={owner} />{owner}</span> : "Nobody yet"],
    ["Door", <span key="d">{f?.name || "A form"}<span className="fm-faint"> · {SOURCE_WORDS[a.source] || a.source}</span></span>],
    ["Arrived", whenShort(a.received_at, now)],
    ["First reply", m != null ? minutes(m) : isOpen(a) ? `Not yet · ${age(mins(a.received_at, now))}` : "None"],
  ];
  if (a.came_from?.page) rows.push(["Page", a.came_from.page]);
  if (a.came_from?.campaign) rows.push(["Campaign", a.came_from.campaign]);
  if (a.came_from?.ad_name) rows.push(["Ad", a.came_from.ad_name]);
  if (a.work_label) rows.push(["Became", a.work_label]);
  return (
    <section>
      <dl className="fm-props">
        {rows.map(([k, v]) => <div key={k} className="fm-prop"><dt className="fm-k">{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </section>
  );
}

function WhoTheyAre({ a, d }: { a: A; d: Data }) {
  const { me, members } = useWho();
  const mine = !!me && a.owner_user_id === me.id;
  const owner = ownerName(d, members, a);
  const handle = (a.handle || "").toLowerCase();
  const person = useQuery<{ id: string; name: string | null; org: string | null; title: string | null; conversation_count: number | null; last_inbound_at: string | null }>(
    mine && handle ? `SELECT p.id, p.name, p.org, p.title, p.conversation_count, p.last_inbound_at FROM person_handle h JOIN person p ON p.id = h.person_id WHERE LOWER(h.handle) = ${sql(handle)} LIMIT 1` : null);
  const domain = a.handle_kind === "email" ? domainOf(a.handle) : "";
  const conds = [a.company_id ? `company_id = ${sql(a.company_id)}` : "", domain ? `LOWER(company_domain) = ${sql(domain)}` : ""].filter(Boolean).join(" OR ");
  const deals = useQuery<{ id: string; name: string; stage: string; amount: number | null; currency: string | null; owner_user_id: string | null; owner_name: string | null }>(
    conds ? `SELECT id, name, stage, amount, currency, owner_user_id, owner_name FROM deal WHERE status = 'open' AND (${conds}) ORDER BY last_activity_at DESC LIMIT 1` : null);
  const p = person?.[0];
  const deal = deals?.[0];
  return (
    <section className="fm-whois">
      <h2 className="fm-h2">Who they are</h2>
      <div className="fm-who fm-who--big">
        <Avatar name={a.name || a.handle || "?"} size={28} />
        <span className="fm-stack">
          <span>{a.name || a.handle || "Someone"}</span>
          <span className="fm-small fm-muted">{[p?.title, p?.org || a.company_name].filter(Boolean).join(", ") || a.handle}</span>
        </span>
      </div>
      {mine ? (
        p ? (
          <p className="fm-small">In your People map{p.conversation_count ? `: ${p.conversation_count} ${p.conversation_count === 1 ? "conversation" : "conversations"}` : ""}.{" "}
            <button type="button" className="fm-link" onClick={() => void openApp("people", `/${p.id}`)}>Open their card</button></p>
        ) : person ? <p className="fm-small fm-muted">New to you: they'll be on your People map after its next refresh.</p> : <p className="fm-small fm-faint">Looking…</p>
      ) : (
        <p className="fm-small fm-muted">{owner ? `${firstOf(owner)}'s threads with them stay ${firstOf(owner)}'s.` : ""} The team sees the company and the deal here.</p>
      )}
      {a.company_name ? (
        <div className="fm-co">
          <span className="fm-k fm-small">Company</span>
          <span className="fm-who"><Logo name={a.company_name} domain={domain || null} size={20} />{a.company_name}{domain ? <span className="fm-faint fm-small">{domain}</span> : null}</span>
        </div>
      ) : null}
      {deal ? (
        <dl className="fm-props">
          <div className="fm-prop"><dt className="fm-k">Open deal</dt><dd><button type="button" className="fm-link" onClick={() => void openApp("deals", `/${deal.id}`)}>{deal.name}</button> · {deal.stage}</dd></div>
          {deal.amount != null ? <div className="fm-prop"><dt className="fm-k">Amount</dt><dd><Money amount={deal.amount} currency={deal.currency} /></dd></div> : null}
          <div className="fm-prop"><dt className="fm-k">Deal owner</dt><dd>{deal.owner_user_id === me?.id ? `${deal.owner_name || "You"} (you)` : deal.owner_name || "a member"}</dd></div>
        </dl>
      ) : deals && conds ? <p className="fm-small fm-faint">No open deal with them.</p> : null}
    </section>
  );
}

function LeadRead({ a, d }: { a: A; d: Data }) {
  const toast = useToast();
  const { me } = useWho();
  const leads = Boolean(d.settings?.plugins?.leads);
  const mine = !!me && a.owner_user_id === me.id;
  const handle = (a.handle || "").toLowerCase();
  const read = useQuery<{ summary: string | null; fit_why: string | null; role: string | null; state: string | null }>(
    leads && mine && handle ? `SELECT l.summary, l.fit_why, l.role, l.state FROM leads_person l JOIN person_handle h ON h.person_id = l.id WHERE LOWER(h.handle) = ${sql(handle)} LIMIT 1` : null);
  const [asked, setAsked] = useState(false);
  if (!leads || a.handle_kind !== "email" || a.kind === "spam") return null;
  const r = read?.[0];
  return (
    <section>
      <h2 className="fm-h2">Lead research's read <Ai /></h2>
      {r?.summary ? <p className="fm-small">{r.summary}</p>
        : mine ? (
          <div className="fm-stack">
            <p className="fm-small fm-muted">{r?.state === "wanted" || asked ? "Looking them up: the read lands here and on their card." : "Not looked up yet."}</p>
            {!asked && r?.state !== "wanted" ? <Button size="sm" onClick={async () => {
              try {
                const out = await runFunction<{ message?: string }>("leads_request", { email: a.handle });
                setAsked(true);
                toast(out?.message || "Asked Lead research to look them up.");
              } catch (e) {
                toast(`Couldn't ask Lead research: ${why(e)}`);
              }
            }}>Look it up now</Button> : null}
          </div>
        ) : <p className="fm-small fm-muted">Lead research reads people for whoever owns the answer.</p>}
      {DEMO ? null : null}
    </section>
  );
}

/* ---------- the side pane on Answers ---------- */

export function AnswerPane({ a }: { a: A }) {
  const d = useForms();
  const { members, me } = useWho();
  const x = useActions();
  const f = d.formsById.get(a.form_id);
  const now = nowMs(d);
  const owner = ownerName(d, members, a);
  const draft = a.draft_id ? d.drafts.get(a.draft_id) : undefined;
  return (
    <aside className="fm-pane" aria-label="The answer">
      <div className="fm-pane__head">
        <button type="button" className="fm-pane__title" onClick={() => to.answer(a.id)}>{a.name || a.handle || "Someone"}{a.company_name ? <span className="fm-muted"> · {a.company_name}</span> : null}</button>
        <p className="fm-facts"><span>{f?.name}</span><span>{whenShort(a.received_at, now)}</span>{owner && a.state !== "set_aside" ? <span>to {a.owner_user_id === me?.id ? "you" : owner}</span> : null}</p>
        <div className="fm-pills">{a.state !== "unsure" ? kindPill(a) : null}{statePill(a)}</div>
      </div>
      <div className="fm-acts">
        <span className="fm-reroute"><RerouteMenu a={a} /></span>
        {a.state === "set_aside" ? <Button icon={Undo2} onClick={() => void x.putBack(a)}>Put back</Button> : <Button icon={Trash2} onClick={() => void x.setAside(a)}>Set aside</Button>}
        <Button onClick={() => to.answer(a.id)}>Open <Kbd>Enter</Kbd></Button>
        {draft && draft.state === "proposed" && a.owner_user_id === me?.id ? <Button variant="primary" icon={Send} onClick={() => to.answer(a.id)}>Review and send</Button> : null}
      </div>
      <Wrote a={a} d={d} short />
      <Read a={a} />
      {a.state !== "set_aside" ? (
        <section>
          <h2 className="fm-h2">Why it went {a.routed_to === "triage" ? "to Triage" : owner ? `to ${firstOf(owner)}` : "nowhere yet"}</h2>
          <p className="fm-small">{a.owner_why || "Not routed yet."}</p>
          <div className="fm-gaps">
            {a.owner_user_id && !hasOpened(d, a.owner_user_id) && isOpen(a) ? <Gap>{firstOf(owner)} hasn't opened Forms yet</Gap> : null}
            {a.kind && NOT_BUILT[a.kind] && a.routed_to === "forms" && isOpen(a) ? <Gap>{NOT_BUILT[a.kind]}</Gap> : null}
            {a.handle_kind === "phone" && isOpen(a) ? <Gap>An ad lead isn't a contact, so the Lemma's address can't reply</Gap> : null}
          </div>
        </section>
      ) : null}
      <Reply a={a} d={d} short />
      <p className="fm-small fm-faint"><Chip>{SOURCE_WORDS[a.source] || a.source}</Chip> {f?.place || ""}</p>
    </aside>
  );
}
