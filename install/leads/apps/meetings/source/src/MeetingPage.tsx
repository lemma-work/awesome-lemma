// One meeting: the brief before it; after it, what was said, with the
// decisions and promises each beside the sentence it came from. Beside them,
// who is on it (and what the person's mail knows of each), and how it was
// sorted, which the person can change.

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CalendarDays, CircleHelp, Clock, FileText, Gavel, Globe, Handshake, Link2, MapPin, NotebookPen, RefreshCw, Repeat, Search, UserRound,
} from "lucide-react";
import {
  Avatar, Banner, Button, Card, Connect, Empty, Evidence, Header, Markdown, Menu, MenuItem, MenuLabel, Pill, Skeleton, Spinner, client, plural, q, runFunction, sql, update, useToast, errorText,
} from "@lemma-plugins/kit";
import { PURPOSE, stoppedText } from "./connection";
import { useMeetings } from "./data";
import { KIND_ICON, KIND_LABEL, KindPill, StatusPill, isOver, nameOf, statusOf } from "./marks";
import { to } from "./route";
import { at, clock, duration, longWhen, minutesBetween, relDay, shortDay } from "./time";
import { KINDS, type Attendee, type Kind, type Meeting } from "./types";
import { PromiseItem } from "./Week";

const RESPONSE: Record<string, string> = { accepted: "Going", tentative: "Maybe", declined: "Not going", needs_action: "No answer" };

export function MeetingPage({ id }: { id: string }) {
  const { meetings, loaded } = useMeetings();
  const m = meetings.find((x) => x.id === id);
  return (
    <>
      <Header back={{ label: "Meetings", icon: ArrowLeft, onClick: () => history.length > 1 ? history.back() : to.week(0) }} title={m?.title || ""} />
      {!loaded ? (
        <Skeleton kind="record" />
      ) : !m ? (
        <div className="c-body">
          <Card>
            <Empty icon={CalendarDays} title="This meeting isn't here" action={<Button onClick={() => to.week(0)}>Back to the week</Button>}>
              It may be more than a month old, or was removed from the calendar.
            </Empty>
          </Card>
        </div>
      ) : (
        <Page m={m} />
      )}
    </>
  );
}

function Page({ m }: { m: Meeting }) {
  const start = at(m.start_at);
  const end = at(m.end_at);
  const over = isOver(m);
  const s = statusOf(m);
  return (
    <div className="c-body">
      <div className="c-record-head">
        <span className="mt-datebox" aria-hidden="true">
          <span>{start ? shortDay(start).split(" ")[0] : ""}</span>
          <b className="num">{start ? start.toLocaleDateString("en-GB", { day: "numeric" }) : ""}</b>
        </span>
        <div className="c-grow">
          <h1>{m.title || "(no title)"}</h1>
          <div className="c-record-head__sub num">
            <span>{start ? `${longWhen(start)}, ${clock(start)}–${clock(end)}` : ""}</span>
            {minutesBetween(start, end) ? <span>· {duration(minutesBetween(start, end))}</span> : null}
            {m.location ? <span>· {m.location}</span> : m.join_url ? <span>· video call</span> : null}
          </div>
          <div className="c-record-head__facts">
            <KindPill m={m} />
            <Pill dot={false} icon={m.outside ? Globe : UserRound}>{m.outside ? "People from outside" : "Your team"}</Pill>
            {m.series_id ? <Pill dot={false} icon={Repeat}>Repeats</Pill> : null}
            <StatusPill s={s} />
          </div>
        </div>
        <div className="c-record-head__actions">
          <SortMenu m={m} />
        </div>
      </div>

      {m.status === "cancelled" ? <Banner icon={CalendarDays}>This meeting was cancelled or removed from the calendar.</Banner> : null}
      {m.unsure ? <Settle m={m} /> : null}

      <div className="c-split c-split--record">
        <div className="c-stack">
          {over ? <AfterPart m={m} /> : null}
          <BriefCard m={m} />
        </div>
        <aside className="c-stack">
          <People m={m} />
          <About m={m} />
        </aside>
      </div>
    </div>
  );
}

/* ---------- sorting: settle or change ---------- */

async function settle(m: Meeting, patch: { kind?: Kind; wants_brief?: boolean }) {
  const out = await runFunction<{ message: string; wants_brief: boolean | null }>("meetings_settle", { meeting_id: m.id, ...patch });
  // A meeting that is over and now matters: find what was said in it.
  if (out.wants_brief && isOver(m) && ["none", "waiting"].includes(m.notes_state)) {
    await runFunction("meetings_due", { meeting_id: m.id }).catch(() => undefined);
  }
  return out;
}

function Settle({ m }: { m: Meeting }) {
  const toast = useToast();
  const { reload } = useMeetings();
  const [busy, setBusy] = useState("");
  const kindKnown = !!m.kind;
  const run = async (key: string, patch: { kind?: Kind; wants_brief?: boolean }) => {
    setBusy(key);
    try {
      const out = await settle(m, patch);
      toast(`${out.message}. The next read learns from it.`);
      await reload("meetings");
    } catch (e) {
      toast(`Couldn't keep that: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  return (
    <Banner
      icon={CircleHelp}
      action={
        kindKnown ? (
          <div className="c-row">
            <Button size="sm" variant="primary" busy={busy === "yes"} onClick={() => void run("yes", { wants_brief: true })}>Brief it</Button>
            <Button size="sm" busy={busy === "no"} onClick={() => void run("no", { wants_brief: false })}>No brief</Button>
          </div>
        ) : (
          <div className="mt-settle">
            {KINDS.map((k) => (
              <Button key={k} size="sm" icon={KIND_ICON[k]} busy={busy === k} onClick={() => void run(k, { kind: k })}>{KIND_LABEL[k]}</Button>
            ))}
          </div>
        )
      }
    >
      <b>{kindKnown ? "Does this one need a brief?" : "What kind of meeting is this?"}</b> {m.reason ? `${m.reason}.` : ""} Your answer is kept as an example for the next ones.
    </Banner>
  );
}

function SortMenu({ m }: { m: Meeting }) {
  const toast = useToast();
  const { reload } = useMeetings();
  const run = async (patch: { kind?: Kind; wants_brief?: boolean }) => {
    try {
      const out = await settle(m, patch);
      toast(out.message);
      await reload("meetings");
    } catch (e) {
      toast(`Couldn't change it: ${errorText(e)}`);
    }
  };
  return (
    <Menu label="Change" align="right" size="md">
      {(close) => (
        <>
          <MenuLabel>Kind of meeting</MenuLabel>
          {KINDS.map((k) => (
            <MenuItem key={k} icon={KIND_ICON[k]} hint={m.kind === k ? "now" : undefined} onSelect={() => { close(); void run({ kind: k }); }}>
              {KIND_LABEL[k]}
            </MenuItem>
          ))}
          <MenuLabel>Brief</MenuLabel>
          {m.wants_brief ? (
            <MenuItem icon={FileText} onSelect={() => { close(); void run({ kind: m.kind || undefined, wants_brief: false }); }}>No brief for this one</MenuItem>
          ) : (
            <MenuItem icon={FileText} onSelect={() => { close(); void run({ kind: m.kind || "other", wants_brief: true }); }}>Brief this one</MenuItem>
          )}
        </>
      )}
    </Menu>
  );
}

/* ---------- before ---------- */

/** A blank line wherever a list starts or ends, so a heading line followed
 *  straight by bullets still draws them as a list. */
function blocks(text: string): string {
  const out: string[] = [];
  const isBullet = (l: string) => /^\s*[-*•]\s+/.test(l);
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const prev = out[out.length - 1];
    if (prev && prev.trim() && isBullet(line) !== isBullet(prev)) out.push("");
    out.push(line);
  }
  return out.join("\n");
}

function BriefCard({ m }: { m: Meeting }) {
  const toast = useToast();
  const { reload } = useMeetings();
  const [busy, setBusy] = useState(false);
  const over = isOver(m);
  const writing = ["wanted", "writing"].includes(m.brief_state);
  const due = at(m.brief_due_at);

  const write = async () => {
    setBusy(true);
    try {
      if (!m.wants_brief) await settle(m, { kind: m.kind || "other", wants_brief: true });
      await update("meetings_work", m.id, { brief_state: "wanted", brief_error: null });
      await reload("meetings");
    } catch (e) {
      toast(`Couldn't ask for the brief: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const searched = (m.searched || []).filter(Boolean);
  const from = m.built_from || {};
  const sources = [
    from.conversation_ids?.length ? plural(from.conversation_ids.length, "conversation") : "",
    from.meeting_ids?.length ? plural(from.meeting_ids.length, "earlier meeting") : "",
  ].filter(Boolean);

  let body;
  if (m.brief && !writing) {
    body = (
      <>
        {m.headline ? <p className="mt-headline">{m.headline}</p> : null}
        <div className="mt-brief"><Markdown text={blocks(m.brief)} /></div>
      </>
    );
  } else if (writing) {
    body = (
      <div className="c-stack" aria-busy="true">
        <span className="c-writing"><Spinner />Writing the brief from what your mail and earlier meetings know…</span>
        <div className="c-skel" style={{ height: 14, width: "70%" }} />
        <div className="c-skel" style={{ height: 12, width: "92%" }} />
        <div className="c-skel" style={{ height: 12, width: "84%" }} />
      </div>
    );
  } else if (m.brief_state === "failed") {
    body = <Banner tone="danger" action={<Button size="sm" busy={busy} onClick={() => void write()}>Try again</Button>}>{m.brief_error ? stoppedText(m.brief_error) : "The brief couldn't be written."}</Banner>;
  } else if (m.wants_brief && !over) {
    body = (
      <Empty icon={Clock} title={due ? `Comes ${relDay(due)}` : "Comes before the meeting"}
        action={<Button busy={busy} onClick={() => void write()}>Write it now</Button>}>
        Written when you asked for briefs, so it has the latest from your mail.
      </Empty>
    );
  } else if (over) {
    return null;
  } else {
    body = (
      <Empty icon={FileText} title="No brief for this one" action={<Button busy={busy} onClick={() => void write()}>Brief it anyway</Button>}>
        {m.kind ? `${KIND_LABEL[m.kind]} meetings don't get a brief.` : "It isn't sorted yet."} Change that under Settings.
      </Empty>
    );
  }
  return (
    <Card
      title={over ? "The brief you had" : "Before"}
      icon={FileText}
      action={m.brief && !writing && !over ? <Button size="sm" variant="ghost" icon={RefreshCw} busy={busy} onClick={() => void write()}>Write again</Button> : undefined}
      foot={m.brief && !writing ? (
        <span className="mt-foot">
          Written {m.brief_at ? relDay(at(m.brief_at)!) : ""}
          {sources.length ? ` from ${sources.join(" and ")}` : " with nothing in your mail about them"}
          {searched.length ? <> · <Search size={12} aria-hidden="true" /> looked up {searched.join(", ")}</> : null}
        </span>
      ) : undefined}
    >
      {body}
    </Card>
  );
}

/* ---------- after ---------- */

function AfterPart({ m }: { m: Meeting }) {
  const { decisions, promises, settings, reload } = useMeetings();
  const toast = useToast();
  const mine = decisions.filter((d) => d.meeting_id === m.id);
  const said = promises.filter((p) => p.source_id === m.source_id);
  const owe = said.filter((p) => p.direction === "i_owe");
  const owed = said.filter((p) => p.direction === "owed_to_me");
  const reading = ["wanted", "reading"].includes(m.notes_state);
  const [doc, setDoc] = useState<string | null>(null);
  const [showDoc, setShowDoc] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!showDoc || !m.document_path || doc != null) return;
    client.files
      .download(m.document_path)
      .then((blob: Blob) => blob.text())
      .then((text: string) => setDoc(text))
      .catch(() => setDoc("Couldn't open the text."));
  }, [showDoc, m.document_path, doc]);

  const save = async () => {
    setBusy("save");
    try {
      await runFunction("meetings_add_notes", { meeting_id: m.id, text: notes });
      setNotes("");
      await reload("meetings");
      toast("Notes kept; reading them for decisions and promises.");
    } catch (e) {
      toast(`Couldn't keep the notes: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };

  const look = async () => {
    setBusy("look");
    try {
      const out = await runFunction<{ message: string }>("meetings_due", { meeting_id: m.id });
      toast(out.message);
      await reload("meetings");
    } catch (e) {
      toast(`Couldn't look: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };

  const toggle = async (id: string, state: "open" | "done") => {
    await update("promise", id, { state });
    await reload("promises");
  };

  const hasText = !!m.document_path;
  const askNotes = !hasText && !reading;
  return (
    <>
      <Card
        title="After"
        icon={NotebookPen}
        action={hasText ? (
          <Button size="sm" variant="ghost" onClick={() => setShowDoc((v) => !v)}>{showDoc ? "Hide" : m.notes_from === "notes" ? "Your notes" : "Transcript"}</Button>
        ) : undefined}
      >
        {reading ? (
          <span className="c-writing"><Spinner />Reading what was said for decisions and promises…</span>
        ) : m.notes_state === "failed" ? (
          <Banner tone="danger">{m.notes_error ? stoppedText(m.notes_error, "googlemeet") : "The notes couldn't be read."}</Banner>
        ) : m.summary ? (
          <p className="mt-summary">{m.summary}</p>
        ) : null}
        {askNotes ? (
          <div className="c-stack">
            {m.notes_error ? <p className="c-muted">{stoppedText(m.notes_error, "googlemeet")}</p> : null}
            {m.notes_error && settings?.notes_from === "meet" ? <Connect connector="googlemeet" mode="per_member" purpose={PURPOSE.googlemeet} quiet /> : null}
            <p className="c-muted">
              {settings?.notes_from === "meet" ? "No transcript from Google Meet yet. Look again, or write what happened." : "Write what happened: what was decided, who said they'd do what."}
            </p>
            <textarea className="c-textarea mt-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="We agreed… They'll send… I said I'd…" aria-label="Your notes" />
            <div className="c-row">
              <Button variant="primary" busy={busy === "save"} disabled={notes.trim().length < 3} onClick={() => void save()}>Keep my notes</Button>
              {settings?.notes_from === "meet" ? <Button busy={busy === "look"} onClick={() => void look()}>Look for the transcript</Button> : null}
            </div>
          </div>
        ) : null}
        {showDoc && hasText ? <div className="c-thread-text mt-doc">{doc ?? "Opening…"}</div> : null}
        {m.dropped ? <p className="mt-foot" style={{ marginTop: 10 }}>{plural(m.dropped, "thing")} the reader found wasn't in the text word for word, so it was left out.</p> : null}
      </Card>

      {mine.length || said.length ? (
        <>
          <Card title="Decided" icon={Gavel} count={mine.length}>
            {mine.length ? (
              <div className="c-stack">
                {mine.map((d) => (
                  <div key={d.id}>
                    <div className="mt-decision">{d.text}</div>
                    <Evidence quote={d.quote} by={d.by_name} />
                  </div>
                ))}
              </div>
            ) : <p className="c-faint">Nothing was decided in so many words.</p>}
          </Card>
          <Card title="Promised" icon={Handshake} count={said.length} flush>
            <div className="c-owed">
              {[{ title: "You owe", list: owe }, { title: "Owed to you", list: owed }].map((g) => (
                <div key={g.title}>
                  <h3>{g.title}<span className="c-count">{g.list.length}</span></h3>
                  {g.list.length ? g.list.map((p) => (
                    <div key={p.id} className="mt-promise">
                      <input type="checkbox" className="c-check" checked={p.state === "done"} aria-label={`Done: ${p.text}`}
                        onChange={(e) => void toggle(p.id, e.target.checked ? "done" : "open")} />
                      <PromiseItem p={p} />
                    </div>
                  )) : <p className="c-faint">Nothing.</p>}
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}
    </>
  );
}

/* ---------- beside ---------- */

function People({ m }: { m: Meeting }) {
  const list = useMemo(() => [...(m.attendees || [])].sort((a, b) => Number(!!b.outside) - Number(!!a.outside) || Number(!!a.you) - Number(!!b.you)), [m.attendees]);
  const handles = list.filter((a) => !a.you).map((a) => a.handle);
  const [known, setKnown] = useState<Record<string, { n: number; last: string | null }>>({});
  useEffect(() => {
    if (!handles.length) return;
    void q<{ counterpart_handle: string; n: number; last: string | null }>(
      "select counterpart_handle, count(*) as n, max(last_message_at) as last from conversation " +
        `where kind = 'people' and counterpart_handle in (${handles.map(sql).join(", ")}) group by 1`,
    ).then((rows) => setKnown(Object.fromEntries(rows.map((r) => [r.counterpart_handle, { n: Number(r.n), last: r.last }])))).catch(() => undefined);
  }, [handles.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title="People" icon={UserRound} count={list.length} flush>
      <div className="c-list">
        {list.map((a: Attendee) => (
          <div key={a.handle} className="c-li">
            <Avatar name={a.name} email={a.handle} size={28} you={a.you} />
            <div className="c-li__main">
              <div className="c-ellipsis">{a.you ? "You" : nameOf(a)}{a.organizer ? <span className="c-faint"> · organizer</span> : null}</div>
              <div className="c-li__sub c-ellipsis">
                {a.handle}
                {known[a.handle] ? ` · ${plural(known[a.handle].n, "conversation")} in your mail` : a.outside ? " · not in your mail" : ""}
              </div>
            </div>
            {a.response && !a.you ? <span className="c-faint mt-resp">{RESPONSE[a.response] || a.response}</span> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function About({ m }: { m: Meeting }) {
  const { calendars } = useMeetings();
  const cal = calendars.find((c) => c.id === m.source_account);
  const conf = m.answers?.kind?.confidence;
  const how = m.sorted_by === "person" ? "By you" : m.sorted_by === "domains" ? "From email addresses" : m.sorted_by === "decision" ? "Read from the invitation" : "Not yet";
  return (
    <Card title="Details" icon={CalendarDays}>
      <dl className="c-props">
        <dt><CalendarDays />Calendar</dt>
        <dd>{cal ? (cal.provider === "sample" ? "Sample calendar" : `${cal.provider === "google" ? "Google" : "Outlook"} · ${cal.email}`) : "—"}</dd>
        {m.join_url ? (<><dt><Link2 />Join</dt><dd><a className="mt-link" href={m.join_url} target="_blank" rel="noreferrer">{m.join_url.replace(/^https?:\/\//, "")}</a></dd></>) : null}
        {m.location ? (<><dt><MapPin />Where</dt><dd>{m.location}</dd></>) : null}
        <dt><CircleHelp />Sorted</dt>
        <dd title={m.reason || undefined}>{how}{m.sorted_by === "decision" && typeof conf === "number" ? <span className="c-faint num"> · {Math.round(conf * 100)}% sure</span> : null}</dd>
      </dl>
      {m.agenda ? <p className="mt-agenda">{m.agenda}</p> : null}
    </Card>
  );
}
