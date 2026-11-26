// One call, after it (or before it): the person and the call; the transcript
// or notes with the proposed findings numbered in it; and the findings, each a
// verbatim quote with its minute, a one-line point, its feature, kind and how
// much it mattered, to keep or set aside (J K move, A keep, X set aside).
// Before the call: why they fit and what they said before. No words yet:
// paste a transcript or write notes.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ClipboardPaste, NotebookPen, RefreshCw, Sparkles, Video } from "lucide-react";
import {
  Avatar, Banner, Button, Empty, Evidence, Kbd, Menu, MenuItem, MenuLabel, Pill, Spinner, client, cx, day, errorText, openApp, plural, q, sql, useToast,
} from "@lemma-plugins/kit";
import { SetupLink, Top } from "./App";
import { addNotes, keep, mark, peoplePath, readCall, undoKeep, useUI, useWho, whoName } from "./data";
import { IMPORTANCE_LABEL, KIND_LABEL, callTime, docLabel, mmss, standing, toReview, upcoming } from "./marks";
import { to } from "./route";
import type { Importance, Kind, Person, Proposal } from "./types";

interface Line { i: number; t: string | null; who: string | null; text: string }

const TIME = /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?:([^:\n]{1,60}):\s*)?(.*)$/;

function parseDoc(text: string): Line[] {
  const out: Line[] = [];
  const all = text.replace(/\r/g, "").split("\n");
  // Meetings' and this app's documents open with a title and a date, then "## Notes" or "## Transcript".
  const body = all.findIndex((l) => /^##\s/.test(l));
  all.forEach((raw, i) => {
    if (i < body || !raw.trim() || /^#{1,4}\s/.test(raw)) return;
    const m = TIME.exec(raw);
    if (m) out.push({ i, t: m[1], who: m[2]?.trim() || null, text: m[3] });
    else {
      const n = /^\s*([A-Z][\w .'-]{0,40}):\s+(.+)$/.exec(raw);
      if (n && n[1].split(" ").length <= 4) out.push({ i, t: null, who: n[1].trim(), text: n[2] });
      else out.push({ i, t: null, who: null, text: raw.trim() });
    }
  });
  return out;
}

type Edits = Partial<Pick<Proposal, "feature_id" | "feature_new" | "kind" | "importance">>;

export function CallPage({ id, personId }: { id: string; personId: string }) {
  const ui = useUI();
  const who = useWho();
  const toast = useToast();
  const study = ui.studies.find((s) => s.id === id);
  const p = ui.people.find((x) => x.id === personId);
  const props = useMemo(() => ui.proposals.filter((x) => x.person_id === personId).sort((a, b) => (a.n || 0) - (b.n || 0)), [ui.proposals, personId]);
  const [doc, setDoc] = useState<string | null>(null);
  const [docErr, setDocErr] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [edits, setEdits] = useState<Record<string, Edits>>({});
  const [busy, setBusy] = useState("");
  const [write, setWrite] = useState<"notes" | "transcript" | null>(null);
  const [text, setText] = useState("");
  const [before, setBefore] = useState<{ quote: string; source: string; said_at: string | null }[]>([]);
  const me = who.me?.id;

  useEffect(() => {
    setDoc(null);
    setDocErr(null);
    if (!p?.doc_path) return;
    client.files.download(p.doc_path)
      .then((blob: Blob) => blob.text())
      .then(setDoc)
      .catch(() => setDocErr(`Only ${whoName(p.inviter_user_id, who)} can read this call's ${p.doc_kind === "notes" ? "notes" : "transcript"}: it's in their own files. What they kept is in Findings.`));
  }, [p?.doc_path, p?.read_state, p?.inviter_user_id, p?.doc_kind, who]);
  useEffect(() => {
    if (!p?.handle) return;
    q<{ quote: string; source: string; said_at: string | null }>(`SELECT quote, source, said_at FROM feedback WHERE handle = ${sql(p.handle)} AND plugin <> 'user-interviews' AND state <> 'set_aside' ORDER BY said_at DESC LIMIT 5`)
      .then(setBefore).catch(() => setBefore([]));
  }, [p?.handle]);

  const open = props.filter((x) => x.state === "open");
  const decide = useCallback(async (x: Proposal, keepIt: boolean) => {
    setBusy(x.id);
    try {
      toast(await keep(x, keepIt, edits[x.id] || {}));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  }, [edits, toast]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "j") setFocus((f) => Math.min(props.length - 1, f + 1));
      else if (k === "k") setFocus((f) => Math.max(0, f - 1));
      else if ((k === "a" || k === "x") && props[focus]?.state === "open") void decide(props[focus], k === "a");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [props, focus, decide]);
  useEffect(() => {
    document.getElementById(`prop-${props[focus]?.id}`)?.scrollIntoView({ block: "nearest" });
  }, [focus, props]);

  if (!study || !p) {
    return (
      <>
        <Top crumbs={[{ label: "User interviews", go: () => to.studies() }, { label: "Call" }]} />
        <main className="c-body"><Empty title="This call isn't here" action={<Button onClick={() => to.studies()}>All studies</Button>}>It may have been cleared with the sample.</Empty></main>
      </>
    );
  }

  const lines = doc ? parseDoc(doc) : [];
  const numbered = new Map(props.filter((x) => x.line != null).map((x) => [x.line as number, x]));
  const st = standing(p, ui.settings, me);
  const mineCall = !p.inviter_user_id || p.inviter_user_id === me;
  const waiting = p.read_state === "waiting" || p.read_state === "reading";
  const ended = p.call_at && !upcoming(p);

  const act = async (what: string) => {
    setBusy(what);
    try {
      toast(await mark(p, what));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  };
  const keepAll = async () => {
    setBusy("all");
    try {
      for (const x of open) await keep(x, true, edits[x.id] || {});
      toast(`Kept ${plural(open.length, "finding")}, each under its feature.`);
      const next = ui.people.find((x) => x.study_id === study.id && x.id !== p.id && x.inviter_user_id === me && toReview(x) > 0);
      if (next) to.call(study.id, next.id);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    if (!write) return;
    setBusy("write");
    try {
      toast(await addNotes(p, text, write));
      setText("");
      setWrite(null);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  };
  const next = ui.people.find((x) => x.study_id === study.id && x.id !== p.id && x.inviter_user_id === me && toReview(x) > 0);

  return (
    <>
      <Top crumbs={[{ label: "User interviews", go: () => to.studies() }, { label: study.question, go: () => to.study(study.id) }, { label: `Call with ${p.name || p.handle}` }]}>
        <SetupLink />
      </Top>
      <main className="ui-page">
        <div className="ui-callhead">
          <div className="ui-callhead__who">
            <Avatar name={p.name} email={p.handle} size={40} />
            <div className="c-grow">
              <h1 className="ui-title ui-title--call">
                <button type="button" className="ui-link" onClick={() => void peoplePath(p.handle).then((path) => openApp("people", path))}>{p.name || p.handle}</button>
                <span className="c-faint ui-title__sub"> · {[p.title, p.company_name].filter(Boolean).join(" · ")}</span>
              </h1>
              <div className="ui-facts">
                {p.call_at && p.stage !== "no_show" ? <span><span className="c-faint">Call</span> {callTime(p)}</span> : <span><Pill tone={st.tone}>{st.pill}</Pill> <span className="c-faint">{st.detail}</span></span>}
                {p.invited_at && p.call_at ? <span><span className="c-faint">Booked</span> after {mineCall ? "your" : `${whoName(p.inviter_user_id, who)}'s`} invite</span> : null}
                {p.doc_kind && p.read_state !== "none" ? <span><span className="c-faint">Read from</span> {docLabel(p.doc_kind)}{p.doc_lines ? ` · ${plural(p.doc_lines, "line")}` : ""}</span> : null}
                {p.deal_status ? <span><span className="c-faint">Deal</span> {p.deal_status}{p.deal_stage && p.deal_status === "open" ? ` · ${p.deal_stage.toLowerCase()}` : ""}</span> : null}
              </div>
            </div>
          </div>
          <div className="ui-callhead__acts">
            {props.length ? <span className="c-faint ui-small">{p.kept} kept · {p.set_aside} set aside · {toReview(p)} to review</span> : null}
            {(p.stage === "booked" && ended) || (p.stage === "done" && !p.kept) ? <Button busy={busy === "no_show"} onClick={() => void act("no_show")}>Mark no-show</Button> : null}
            {p.stage === "no_show" ? <Button busy={busy === "showed"} onClick={() => void act("showed")}>They did come</Button> : null}
            {p.stage === "done" ? (
              <Button icon={Check} busy={busy === "thanked"} aria-pressed={!!p.thanked_at} className={cx(p.thanked_at && "ui-on")}
                onClick={() => void act(p.thanked_at ? "unthanked" : "thanked")}>{p.thanked_at ? `Thanked ${day(p.thanked_at)}` : "Thanked"}</Button>
            ) : null}
          </div>
        </div>

        <div className="ui-callsplit">
          <section className="ui-doc" aria-label="What was said">
            <div className="ui-doc__head">
              <h2>{p.doc_kind === "notes" ? "Notes" : "Transcript"}</h2>
              {p.doc_kind && p.read_state !== "none" ? <Pill dot={false}>{docLabel(p.doc_kind)}</Pill> : null}
              <span className="c-grow" />
              {lines.length && numbered.size ? <span className="c-faint ui-small">Lines with a number are proposed findings</span> : null}
            </div>
            {docErr ? <p className="c-muted ui-pad-doc">{docErr}</p> : null}
            {p.doc_path && !doc && !docErr ? <div className="ui-pad-doc"><Spinner /></div> : null}
            {lines.length ? (
              <div className="ui-lines">
                {lines.map((l) => {
                  const hit = numbered.get(l.i);
                  const you = !!l.who && /^(you|me)$/i.test(l.who);
                  return (
                    <div key={l.i} className={cx("ui-l", hit && "ui-l--hit", hit && props[focus]?.id === hit.id && "ui-l--focus")}>
                      <span className="ui-l__t num">{l.t || ""}</span>
                      <span className={cx("ui-l__who", you && "c-faint")}>{l.who || ""}</span>
                      <span className="ui-l__text">{l.text}{hit ? <button type="button" className="ui-num" onClick={() => setFocus(props.indexOf(hit))} aria-label={`Finding ${hit.n}`}>{hit.n}</button> : null}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {!p.doc_path ? (
              <Before p={p} before={before} ended={!!ended} busy={busy} onMark={act} />
            ) : null}
            {mineCall || !p.inviter_user_id ? (
              <div className="ui-other">
                <div className="c-faint ui-small">{p.doc_path ? "Read the call from something else" : "No transcript came? Read the call from"}</div>
                <div className="ui-line">
                  <Button size="sm" icon={NotebookPen} onClick={() => setWrite("notes")}>Your notes</Button>
                  <Button size="sm" icon={ClipboardPaste} onClick={() => setWrite("transcript")}>Paste a transcript</Button>
                </div>
                {write ? (
                  <div className="ui-write">
                    <textarea className="c-textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus
                      placeholder={write === "notes" ? "What they said, in your words: one point a line." : "Paste it as it is: Zoom or Teams (VTT), or Name: words lines, with or without [m:ss] times."} />
                    <div className="ui-line">
                      <Button variant="primary" size="sm" busy={busy === "write"} disabled={text.trim().length < 20} onClick={() => void save()}>Read it for findings</Button>
                      <Button variant="ghost" size="sm" onClick={() => setWrite(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : null}
                <div className="c-faint ui-small">Findings from your notes are kept as your words, not theirs.</div>
              </div>
            ) : null}
          </section>

          <section className="ui-props" aria-label="Proposed findings">
            <div className="ui-doc__head">
              <h2>Proposed findings</h2>
              <Pill tone="ai" icon={Sparkles}>Lemma</Pill>
              <span className="c-grow" />
              {props.length ? <span className="c-faint ui-small c-hide-sm"><Kbd>J</Kbd> <Kbd>K</Kbd> move · <Kbd>A</Kbd> keep · <Kbd>X</Kbd> set aside</span> : null}
            </div>
            {waiting ? (
              <div className="c-writing ui-pad-doc"><Spinner /> Reading the call for findings…</div>
            ) : p.read_state === "failed" ? (
              <div className="ui-pad-doc">
                <Banner tone="danger" action={mineCall ? <Button size="sm" icon={RefreshCw} onClick={() => void readCall(p).catch((e) => toast(errorText(e)))}>Read again</Button> : undefined}>
                  {p.read_error || "The call couldn't be read."}
                </Banner>
              </div>
            ) : !props.length ? (
              <p className="c-muted ui-pad-doc">{p.kept ? `${plural(p.kept, "finding")} kept from this call by ${whoName(p.inviter_user_id, who)}. They're in Findings.` : p.doc_path ? "Nothing proposed from this call." : "Findings are proposed here once the call's transcript or your notes come in."}</p>
            ) : (
              <>
                <p className="c-faint ui-small ui-pad-props">Each quote is checked word for word against the {p.doc_kind === "notes" ? "notes" : "transcript"}. Kept ones are shared with the team, under their feature.</p>
                {props.map((x, i) => (
                  <ProposalCard key={x.id} x={x} focused={i === focus} edits={edits[x.id] || {}} busy={busy === x.id}
                    onFocus={() => setFocus(i)} onEdit={(e) => setEdits((all) => ({ ...all, [x.id]: { ...(all[x.id] || {}), ...e } }))}
                    onDecide={(k) => void decide(x, k)} onUndo={() => void undoKeep(x).then(toast).catch((e) => toast(errorText(e)))} />
                ))}
                <div className="ui-prop ui-prop--end">
                  {open.length ? <Button variant="primary" busy={busy === "all"} onClick={() => void keepAll()}>Keep the {plural(open.length, "one")} left</Button> : <Pill tone="success">All decided</Pill>}
                  {next ? <button type="button" className="ui-link c-faint ui-small" onClick={() => to.call(study.id, next.id)}>Then the next call waiting: {next.name || next.handle}, {toReview(next)} to review</button> : null}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

function Before({ p, before, ended, busy, onMark }: { p: Person; before: { quote: string; source: string; said_at: string | null }[]; ended: boolean; busy: string; onMark: (what: string) => Promise<void> }) {
  return (
    <div className="ui-before">
      {p.stage === "booked" && !ended ? (
        <>
          <h3>Before the call</h3>
          {p.join_url ? <a className="ui-line ui-url" href={p.join_url} target="_blank" rel="noreferrer"><Video size={14} aria-hidden="true" /> Join the call</a> : null}
          <p className="ui-note"><span>Transcription isn't on in Meet by itself: press Transcribe when the call starts, and the transcript is read here afterwards.</span></p>
        </>
      ) : p.stage === "booked" && ended ? (
        <>
          <h3>Did they show up?</h3>
          <p className="c-muted">No transcript or notes have come for this call yet.</p>
          <div className="ui-line">
            <Button size="sm" busy={busy === "showed"} onClick={() => void onMark("showed")}>They came</Button>
            <Button size="sm" busy={busy === "no_show"} onClick={() => void onMark("no_show")}>They didn't</Button>
          </div>
        </>
      ) : null}
      <h3>Why they fit</h3>
      <div className="ui-chips">{p.why.map((w) => <span key={w} className="ui-chip">{w}</span>)}</div>
      {before.length ? (
        <>
          <h3>What they said before</h3>
          <div className="c-stack" style={{ gap: 8 }}>{before.map((b, i) => <Evidence key={i} quote={b.quote} by={b.source} at={b.said_at} />)}</div>
        </>
      ) : p.quote ? <Evidence quote={p.quote} by={p.quote_from} /> : null}
    </div>
  );
}

function ProposalCard({ x, focused, edits, busy, onFocus, onEdit, onDecide, onUndo }: {
  x: Proposal; focused: boolean; edits: Edits; busy: boolean; onFocus: () => void; onEdit: (e: Edits) => void; onDecide: (keep: boolean) => void; onUndo: () => void;
}) {
  const ui = useUI();
  const fid = edits.feature_id !== undefined ? edits.feature_id : x.feature_id;
  const fnew = edits.feature_new !== undefined ? edits.feature_new : x.feature_new;
  const feature = fid ? ui.features.get(fid) : null;
  const kind = (edits.kind || x.kind) as Kind;
  const importance = (edits.importance || x.importance) as Importance;
  const decided = x.state !== "open";
  const choices = ui.featureRows.filter((f) => f.state === "active" || f.state === "suggested");
  return (
    <div id={`prop-${x.id}`} className={cx("ui-prop", focused && "ui-prop--focus", x.state === "set_aside" && "ui-prop--aside")} onClick={onFocus}>
      <div className="ui-line">
        <span className="ui-num ui-num--static">{x.n}</span>
        {x.at_seconds != null ? <span className="c-faint num ui-small">{mmss(x.at_seconds)}</span> : null}
        {x.state === "kept" ? <Pill tone="success">Kept</Pill> : x.state === "set_aside" ? <Pill>Set aside</Pill> : <Pill tone="ai" dot={false}>To review</Pill>}
      </div>
      <Evidence quote={x.quote} />
      <div className="c-muted ui-point">{x.point}</div>
      <div className="ui-line ui-gap">
        {decided ? (
          <span className="ui-sel"><span className="c-faint">Feature</span> {feature?.name || fnew || "Not filed"}</span>
        ) : (
          <Menu size="sm" label={<><span className="c-faint">Feature</span> {feature?.name || fnew || "Not filed"} <ChevronDown size={12} aria-hidden="true" /></>}>{(close) => <>
            <MenuLabel>File it under</MenuLabel>
            {x.feature_new ? <MenuItem onSelect={() => { close(); onEdit({ feature_id: null, feature_new: x.feature_new }); }}>New: {x.feature_new}</MenuItem> : null}
            {choices.map((f) => <MenuItem key={f.id} onSelect={() => { close(); onEdit({ feature_id: f.id, feature_new: null }); }} hint={f.state === "suggested" ? "suggested" : undefined}>{f.name}</MenuItem>)}
            <MenuItem onSelect={() => { close(); onEdit({ feature_id: null, feature_new: null }); }}>Not filed</MenuItem>
          </>}</Menu>
        )}
        {(!fid && fnew) || feature?.state === "suggested" ? <Pill tone="ai" dot={false}>{fid ? "Suggested" : "New feature, suggested"}</Pill> : null}
        {decided ? <span className="ui-sel"><span className="c-faint">Kind</span> {KIND_LABEL[kind]}</span> : (
          <Menu size="sm" label={<><span className="c-faint">Kind</span> {KIND_LABEL[kind]} <ChevronDown size={12} aria-hidden="true" /></>}>{(close) => <>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <MenuItem key={k} onSelect={() => { close(); onEdit({ kind: k }); }}>{KIND_LABEL[k]}</MenuItem>)}
          </>}</Menu>
        )}
        {decided ? <span className="ui-sel"><span className="c-faint">Matters</span> {IMPORTANCE_LABEL[importance]}</span> : (
          <Menu size="sm" label={<><span className="c-faint">Matters</span> {IMPORTANCE_LABEL[importance]} <ChevronDown size={12} aria-hidden="true" /></>}>{(close) => <>
            {(Object.keys(IMPORTANCE_LABEL) as Importance[]).map((k) => <MenuItem key={k} onSelect={() => { close(); onEdit({ importance: k }); }}>{IMPORTANCE_LABEL[k]}</MenuItem>)}
          </>}</Menu>
        )}
        <span className="c-grow" />
        {decided ? (
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onUndo(); }}>Undo</Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" busy={busy} onClick={(e) => { e.stopPropagation(); onDecide(false); }}>Set aside</Button>
            <Button size="sm" busy={busy} onClick={(e) => { e.stopPropagation(); onDecide(true); }}>Keep</Button>
          </>
        )}
      </div>
    </div>
  );
}

