// A · The inbox: each new quote with who said it and where, and the Lemma's
// filing (feature, kind, importance). Keep, move or set aside each one, one
// key each (J/K, Enter, M, X). "From your mail and meetings" is the private
// gate: only this person sees it, with Share and Keep private.
//
// The reason under each feature choice is worked out from the filing row:
// the words of the quote that match the feature's name or other names, else
// "The Lemma's pick" with how sure it was. Never the model's own words.

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Globe, Lock, Mail, MessageSquareText, Plus, Send, Sparkles, Video } from "lucide-react";
import { Avatar, Button, Empty, Field, Kbd, Menu, MenuItem, Pill, Segmented, Sheet, Skeleton, Switch, agoText, ago, errorText, money, update, useToast, DEMO } from "@lemma-plugins/kit";
import {
  IMP_WORD, KIND_TONE, KIND_WORD, SOURCE_WORD, call, clock, featureOf, parentOf, useNarrow, useUF, useWho, whereSaid, whoSaid,
  type Feature, type Importance, type Kind, type Quote, type UF,
} from "./data";
import { to, type Tab } from "./route";
import { Top } from "./Top";
import { NoteSheet } from "./Note";

const KINDS: Kind[] = ["request", "problem", "praise", "question", "comparison"];
const IMPS: Importance[] = ["unknown", "nice", "important", "blocker"];
type Scope = "all" | "ours" | "rivals";

export function Inbox({ tab, id }: { tab: Tab; id: string | null }) {
  const uf = useUF();
  const { me } = useWho();
  const narrow = useNarrow();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [source, setSource] = useState<string>("");
  const [note, setNote] = useState(false);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const lists = useMemo(() => ({
    file: uf.quotes.filter((q) => q.state === "new"),
    mine: uf.heard,
    unfiled: uf.quotes.filter((q) => q.state === "processed" && !featureOf(q, uf)),
    aside: uf.quotes.filter((q) => q.state === "set_aside"),
  }), [uf]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return lists[tab].filter((q) => {
      const about = q.product_id ? uf.productById.get(q.product_id) : null;
      const rival = about?.role === "rival" || q.compared_with.length > 0;
      if (scope === "ours" && about?.role === "rival") return false;
      if (scope === "rivals" && !rival) return false;
      if (source && q.source !== source) return false;
      if (needle && !`${q.quote} ${q.name || ""} ${q.company_name || ""} ${featureOf(q, uf)?.name || ""}`.toLowerCase().includes(needle)) return false;
      return true;
    }).sort((a, b) => b.said_at.localeCompare(a.said_at));
  }, [lists, tab, scope, source, search, uf]);

  const sources = useMemo(() => [...new Set(lists[tab].map((q) => q.source))].sort(), [lists, tab]);
  const selected = rows.find((q) => q.id === id) || rows[0] || null;
  const index = selected ? rows.indexOf(selected) : -1;
  const pick = (q: Quote | null | undefined) => to.inbox(tab, q ? q.id : null);

  // The pane's choices for each quote: the quote's own until the person changes one.
  const current = selected ? featureOf(selected, uf) : null;
  const [edits, setEdits] = useState<Record<string, { chosen?: string | null; kind?: Kind; imp?: Importance }>>({});
  const mine = selected ? edits[selected.id] || {} : {};
  const chosen = mine.chosen !== undefined ? mine.chosen : current?.id || null;
  const kind: Kind = mine.kind || selected?.kind || "other";
  const imp: Importance = mine.imp || selected?.importance || "unknown";
  const edit = (patch: { chosen?: string | null; kind?: Kind; imp?: Importance }) => {
    if (selected) setEdits((all) => ({ ...all, [selected.id]: { ...(all[selected.id] || {}), ...patch } }));
  };
  const setChosen = (id: string | null) => edit({ chosen: id });
  const setKind = (k: Kind) => edit({ kind: k });
  const setImp = (i: Importance) => edit({ imp: i });

  const after = () => {
    const next = rows[index + 1] || rows[index - 1] || null;
    pick(next && next.id !== selected?.id ? next : null);
  };

  const act = async (action: "keep" | "set_aside" | "share" | "keep_private" | "restore", featureId: string | null = chosen) => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      let out: { message?: string };
      if (selected.mine) {
        if (action === "share") {
          const patch: Record<string, unknown> = {};
          if (featureId !== (selected.feature_id || null)) patch.feature_id = featureId;
          if (kind !== selected.kind) patch.kind = kind;
          if (imp !== selected.importance) patch.importance = imp;
          if (Object.keys(patch).length) await update("user_feedback_heard", selected.id, patch);
          out = await call("user_feedback_share", { ids: [selected.id], action: "share" });
        } else {
          out = await call("user_feedback_share", { ids: [selected.id], action: "keep_private" });
        }
      } else if (action === "restore") {
        out = await call("user_feedback_keep", { id: selected.id, action: "restore" });
      } else if (action === "set_aside") {
        out = await call("user_feedback_keep", { id: selected.id, action: "set_aside" });
      } else {
        const moved = featureId && featureId !== (current?.id || null);
        out = await call("user_feedback_keep", {
          id: selected.id, action: featureId ? (moved ? "move" : "keep") : "unfile", feature_id: featureId,
          kind: kind !== selected.kind ? kind : null, importance: imp !== selected.importance ? imp : null,
        });
      }
      toast(String(out.message || "Done."));
      after();
      await uf.reload();
    } catch (e) {
      toast(`Couldn't do that: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // J/K, Enter, M, X; never while typing or with a sheet open.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent) => {
    const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']");
    if (typing || e.metaKey || e.ctrlKey || e.altKey || note || picker) return;
    const k = e.key.toLowerCase();
    if (k === "j" || k === "arrowdown") { e.preventDefault(); pick(rows[Math.min(rows.length - 1, index + 1)]); }
    else if (k === "k" || k === "arrowup") { e.preventDefault(); pick(rows[Math.max(0, index - 1)]); }
    else if (k === "enter" && selected) { e.preventDefault(); void act(tab === "mine" ? "share" : tab === "aside" ? "restore" : "keep"); }
    else if (k === "m" && selected && tab !== "aside") { e.preventDefault(); setPicker(true); }
    else if (k === "x" && selected && tab !== "aside") { e.preventDefault(); void act(tab === "mine" ? "keep_private" : "set_aside"); }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  if (!uf.loaded) return <div className="c-app"><Top here="inbox" /><Skeleton rows={8} /></div>;

  const tabs = [
    { id: "file" as Tab, label: narrow ? "To file" : "To file", count: lists.file.length },
    { id: "mine" as Tab, label: narrow ? "Yours" : "From your mail and meetings", count: lists.mine.length },
    { id: "unfiled" as Tab, label: "Not filed", count: lists.unfiled.length },
    ...(narrow ? [] : [{ id: "aside" as Tab, label: "Set aside", count: lists.aside.length }]),
  ];

  return (
    <div className="c-app uf-app">
      <Top here="inbox" search={search} onSearch={setSearch} onNote={() => setNote(true)} />
      <div className="uf-bar">
        <Segmented<Tab> label="Inbox" items={tabs} value={tab} onChange={(t) => to.inbox(t)} />
        <span className="c-grow" />
        {!narrow ? (
          <>
            <Segmented<Scope> label="Products" value={scope} onChange={setScope}
              items={[{ id: "all", label: "All products" }, { id: "ours", label: "Ours" }, { id: "rivals", label: "Rivals" }]} />
            <Menu label={source ? SOURCE_WORD[source] || source : "All sources"} align="right">
              {(close) => (
                <>
                  <MenuItem onSelect={() => { setSource(""); close(); }}>All sources</MenuItem>
                  {sources.map((s) => <MenuItem key={s} onSelect={() => { setSource(s); close(); }}>{SOURCE_WORD[s] || s}</MenuItem>)}
                </>
              )}
            </Menu>
          </>
        ) : null}
      </div>
      <MemberSetup />
      <div className="uf-wrap">
        <div className="uf-list" role="listbox" aria-label="Quotes">
          {tab === "mine" ? <MineNote /> : null}
          {rows.length === 0 ? <InboxEmpty tab={tab} filtered={!!(search || source || scope !== "all")} /> : null}
          {rows.map((q) => narrow
            ? <PhoneItem key={q.id} q={q} uf={uf} on={q.id === selected?.id} onPick={() => pick(q)}
                busy={busy} tab={tab} onAct={(a) => void act(a, featureOf(q, uf)?.id || null)} onMove={() => setPicker(true)} />
            : <Row key={q.id} q={q} uf={uf} on={q.id === selected?.id} onPick={() => pick(q)} me={me?.id || null} />)}
          {rows.length && !narrow ? (
            <div className="uf-keys">
              <span><Kbd>J</Kbd> <Kbd>K</Kbd> next and previous</span>
              {tab === "aside" ? <span><Kbd>Enter</Kbd> back to the inbox</span> : (
                <>
                  <span><Kbd>Enter</Kbd> {tab === "mine" ? "share" : "keep as filed"}</span>
                  <span><Kbd>M</Kbd> move</span>
                  <span><Kbd>X</Kbd> {tab === "mine" ? "keep private" : "set aside"}</span>
                </>
              )}
            </div>
          ) : null}
        </div>
        {!narrow && selected ? (
          <Pane q={selected} uf={uf} me={me?.id || null} tab={tab} chosen={chosen} setChosen={setChosen} kind={kind} setKind={setKind}
            imp={imp} setImp={setImp} busy={busy} onAct={(a) => void act(a)} onPicker={() => setPicker(true)} />
        ) : null}
      </div>
      <FeaturePicker open={picker} uf={uf} current={chosen} onClose={() => setPicker(false)}
        onPick={(fid) => { setPicker(false); setChosen(fid); if (narrow) void act(tab === "mine" ? "share" : "keep", fid); }} />
      <NoteSheet open={note} onClose={() => setNote(false)} />
    </div>
  );
}

/* ---------- a row ---------- */

export function SourceIcon({ q }: { q: Quote }) {
  const Icon = q.source === "mail" ? Mail : q.source === "meeting" || q.source === "interview" ? Video : q.source === "note" ? FileText
    : q.is_public ? Globe : MessageSquareText;
  return <span className="uf-src" aria-hidden="true"><Icon size={14} /></span>;
}

function KindPill({ kind }: { kind: Kind }) {
  return <Pill tone={KIND_TONE[kind]}>{KIND_WORD[kind]}</Pill>;
}

function ImpPill({ imp }: { imp: Importance }) {
  if (imp === "unknown") return null;
  return <Pill tone={imp === "blocker" ? "danger" : "plain"}>{imp === "nice" ? "Nice to have" : IMP_WORD[imp]}</Pill>;
}

function Row({ q, uf, on, onPick, me }: { q: Quote; uf: UF; on: boolean; onPick: () => void; me: string | null }) {
  const f = featureOf(q, uf);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (on) ref.current?.scrollIntoView({ block: "nearest" }); }, [on]);
  return (
    <button ref={ref} type="button" role="option" aria-selected={on} className={`uf-row${on ? " is-on" : ""}`} onClick={onPick}>
      <SourceIcon q={q} />
      <span className="uf-row__main">
        <span className="uf-q">“{q.quote}”</span>
        <span className="uf-meta">
          <span className="uf-meta__who">{whoSaid(q, uf)}</span><span aria-hidden="true">·</span>
          <span>{whereSaid(q, me)}</span><span aria-hidden="true">·</span><span>{ago(q.said_at)}</span>
          {q.source === "note" ? <Pill tone="plain" dot={false}>Their words, as noted</Pill> : null}
        </span>
      </span>
      <span className="uf-row__file">
        <span className="uf-feat">{f ? <Sparkles size={13} aria-hidden="true" className="c-faint" /> : null}{f ? f.name : <span className="c-faint">Not filed</span>}</span>
        <span className="uf-pills"><KindPill kind={q.kind} /><ImpPill imp={q.importance} />
          {q.compared_with.length ? <Pill tone="plain">vs {q.compared_with.map((id) => uf.productById.get(id)?.name).filter(Boolean).join(", ")}</Pill> : null}
        </span>
      </span>
    </button>
  );
}

function PhoneItem({ q, uf, on, onPick, busy, tab, onAct, onMove }: {
  q: Quote; uf: UF; on: boolean; onPick: () => void; busy: boolean; tab: Tab;
  onAct: (a: "keep" | "set_aside" | "share" | "keep_private" | "restore") => void; onMove: () => void;
}) {
  const f = featureOf(q, uf);
  const { me } = useWho();
  return (
    <div className={`uf-item${on ? " is-on" : ""}`}>
      <button type="button" className="uf-item__tap" onClick={onPick} aria-expanded={on}>
        <span className="uf-item__q">“{q.quote}”</span>
        <span className="uf-meta">{whoSaid(q, uf)} · {whereSaid(q, me?.id || null)} · {ago(q.said_at)}</span>
        <span className="uf-pills uf-pills--left">
          {on ? <span className="c-faint uf-small">Filed under</span> : null}
          <span className="uf-feat">{f ? f.name : <span className="c-faint">Not filed</span>}</span>
          <KindPill kind={q.kind} /><ImpPill imp={q.importance} />
          {q.compared_with.length ? <Pill tone="plain">vs {q.compared_with.map((id) => uf.productById.get(id)?.name).filter(Boolean).join(", ")}</Pill> : null}
        </span>
      </button>
      {on ? (
        <div className="uf-item__acts">
          {tab === "mine" ? (
            <>
              <Button variant="primary" busy={busy} onClick={() => onAct("share")}>Share</Button>
              <Button onClick={onMove}>Move</Button>
              <Button onClick={() => onAct("keep_private")}>Keep private</Button>
            </>
          ) : tab === "aside" ? (
            <Button variant="primary" busy={busy} onClick={() => onAct("restore")}>Back to the inbox</Button>
          ) : (
            <>
              <Button variant="primary" busy={busy} onClick={() => onAct("keep")}>Keep</Button>
              <Button onClick={onMove}>Move</Button>
              <Button onClick={() => onAct("set_aside")}>Set aside</Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- the pane ---------- */

function reasonFor(fid: string, q: Quote, uf: UF): string {
  const filing = uf.filing.get(q.id);
  const words = filing?.matched?.[fid] || [];
  const f = uf.featureById.get(fid);
  if (words.length) {
    const whole = f && words.some((w) => w.toLowerCase() === f.name.toLowerCase() || f.aliases.some((a) => a.toLowerCase() === w.toLowerCase()));
    return `${whole ? "Names" : "Says"} “${words.join("”, “")}”`;
  }
  const picked = filing?.picked || filing?.options?.[0];
  if (fid === picked) {
    const c = filing?.confidence;
    return c == null ? "The Lemma's pick" : `The Lemma's pick · ${c >= 0.6 ? "sure" : "not sure"}`;
  }
  const pf = picked ? uf.featureById.get(picked) : null;
  if (pf && f && (f.parent_id === pf.parent_id || f.id === pf.parent_id || f.parent_id === pf.id)) return "Close to the pick, same area";
  return "Another close choice";
}

function Pane({ q, uf, me, tab, chosen, setChosen, kind, setKind, imp, setImp, busy, onAct, onPicker }: {
  q: Quote; uf: UF; me: string | null; tab: Tab; chosen: string | null; setChosen: (id: string | null) => void;
  kind: Kind; setKind: (k: Kind) => void; imp: Importance; setImp: (i: Importance) => void; busy: boolean;
  onAct: (a: "keep" | "set_aside" | "share" | "keep_private" | "restore") => void; onPicker: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const filing = uf.filing.get(q.id);
  const current = featureOf(q, uf);
  const options = [...new Set([...(chosen ? [chosen] : []), ...(current ? [current.id] : []), ...(filing?.options || [])])]
    .filter((fid) => uf.featureById.get(fid)?.state !== "archived").slice(0, 4);
  const chosenF = chosen ? uf.featureById.get(chosen) || null : null;
  const deal = q.company_id ? uf.dealOf.get(q.company_id) : null;
  const theirs = q.handle ? uf.quotes.filter((x) => x.handle === q.handle && x.id !== q.id) : [];
  const sameCo = q.company_id ? uf.quotes.filter((x) => x.company_id === q.company_id && x.id !== q.id && Date.now() - new Date(x.said_at).getTime() < 86_400_000 * 7) : [];
  const sameFeature = current ? theirs.filter((x) => featureOf(x, uf)?.id === current.id).length : 0;
  const history = q.is_public
    ? (q.compared_with.length ? `Compared with ${q.compared_with.map((id) => uf.productById.get(id)?.name).filter(Boolean).join(", ")}`
      : uf.productById.get(q.product_id || "")?.role === "rival" ? `About a rival: ${uf.productById.get(q.product_id || "")?.name}` : "Said in public")
    : theirs.length ? `${theirs.length} earlier ${theirs.length === 1 ? "quote" : "quotes"}` + (sameFeature ? ` · ${sameFeature} under ${current?.name}` : "")
    : sameCo.length ? `Same company as ${sameCo.length} other ${sameCo.length === 1 ? "quote" : "quotes"} this week` : "First quote from this person";
  const where = [whereSaid(q, me), q.mine && q.place ? q.place : null].filter(Boolean).join(" · ");
  const isRequest = kind === "request" && !!q.handle;
  return (
    <aside className="uf-pane" aria-label="Selected quote">
      <div>
        <div className="uf-meta uf-meta--top"><span className="uf-meta__who">{where}</span><span aria-hidden="true">·</span><span>{agoText(q.said_at)}</span></div>
        <blockquote className="uf-big">“{q.quote}”</blockquote>
        <div className="uf-note">
          {q.mine ? "Only you can see the thread. Sharing sends this sentence and who said it."
            : q.is_public ? <>Said in public.{q.source_url ? <> <a href={q.source_url} target="_blank" rel="noreferrer">Open the post</a></> : null}</>
            : q.source === "note" ? "Written down by the colleague who heard it: their words, not the speaker's."
            : "Only the sentence was shared. The thread stays with whoever heard it."}
        </div>
      </div>

      <div className="uf-person">
        {q.is_public ? <span className="uf-av" aria-hidden="true">{(SOURCE_WORD[q.source] || "?").slice(0, 2).toUpperCase()}</span>
          : <Avatar name={q.company_name || q.name} email={q.handle} size={32} />}
        <div className="c-grow" style={{ minWidth: 0 }}>
          <div className="uf-b">{whoSaid(q, uf)}</div>
          <div className="uf-small c-faint">{history}</div>
        </div>
        {deal ? <Pill tone="plain">{deal.status === "won" ? "Won" : "Open deal"} · {money(deal.amount, deal.currency)}</Pill> : null}
      </div>

      {tab !== "aside" ? (
        <div>
          <p className="uf-sec">File under</p>
          <div className="uf-opts">
            {options.map((fid) => {
              const f = uf.featureById.get(fid);
              if (!f) return null;
              const parent = parentOf(f, uf);
              return (
                <button key={fid} type="button" className={`uf-opt${fid === chosen ? " is-on" : ""}`} aria-pressed={fid === chosen} onClick={() => setChosen(fid)}>
                  <span className="uf-radio" aria-hidden="true" />
                  <span className="uf-opt__main"><span className="uf-b">{f.name}</span>{f.state === "suggested" ? <> <Pill tone="ai">Suggested</Pill></> : null}
                    <span className="uf-small c-faint uf-block">{reasonFor(fid, q, uf)}</span></span>
                  <span className="uf-small c-faint">{parent?.name || ""}</span>
                </button>
              );
            })}
            {!options.length ? <p className="uf-small c-faint">The Lemma didn't find a feature this fits. Pick one, or add it.</p> : null}
            <div className="uf-row-btns">
              <Button size="sm" variant="ghost" onClick={onPicker}>Another feature…</Button>
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setCreating(true)}>New feature…</Button>
              {chosen ? <Button size="sm" variant="ghost" onClick={() => setChosen(null)}>None of these</Button> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="uf-chips-block">
        <div>
          <p className="uf-sec">What they're doing</p>
          <div className="uf-chips">{KINDS.map((k) => <button key={k} type="button" className={`uf-chip${k === kind ? " is-on" : ""}`} aria-pressed={k === kind} onClick={() => setKind(k)}>{KIND_WORD[k]}</button>)}</div>
        </div>
        <div>
          <p className="uf-sec">How much it matters to them</p>
          <div className="uf-chips">{IMPS.map((k) => <button key={k} type="button" className={`uf-chip${k === imp ? " is-on" : ""}`} aria-pressed={k === imp} onClick={() => setImp(k)}>{IMP_WORD[k]}</button>)}</div>
        </div>
      </div>

      {isRequest && chosenF ? (
        <div className="uf-tell">
          <Send size={14} aria-hidden="true" />
          <div>{chosenF.work_id
            ? <>Kept as an ask. Told in their own thread when {chosenF.name} ships.</>
            : <>Kept as an ask on {chosenF.name}. They're told where they asked once it has linked work.</>}</div>
        </div>
      ) : null}

      <div className="uf-acts">
        {tab === "mine" ? (
          <>
            <Button variant="primary" busy={busy} onClick={() => onAct("share")}>Share with the team <Kbd>Enter</Kbd></Button>
            <Button onClick={() => onAct("keep_private")}>Keep private <Kbd>X</Kbd></Button>
          </>
        ) : tab === "aside" ? (
          <Button variant="primary" busy={busy} onClick={() => onAct("restore")}>Back to the inbox <Kbd>Enter</Kbd></Button>
        ) : (
          <>
            <Button variant="primary" busy={busy} onClick={() => onAct("keep")}>
              {chosenF ? `Keep under ${chosenF.name}` : "Keep, not filed"} <Kbd>Enter</Kbd>
            </Button>
            <Button onClick={() => onAct("set_aside")}>Set aside <Kbd>X</Kbd></Button>
          </>
        )}
      </div>
      <NewFeatureSheet open={creating} uf={uf} onClose={() => setCreating(false)} onMade={(fid) => { setCreating(false); setChosen(fid); }} />
    </aside>
  );
}

/* ---------- the private gate ---------- */

function MineNote() {
  const uf = useUF();
  const toast = useToast();
  const on = !!uf.member?.auto_share;
  const [busy, setBusy] = useState(false);
  return (
    <div className="uf-mine">
      <Lock size={14} aria-hidden="true" />
      <div className="c-grow">Only you can see these: sentences about the product found in your own mail and meetings. Share one and only the sentence and who said it reach the team, never the thread.</div>
      <label className="uf-switch">
        <Switch checked={on} disabled={busy} label="Always share" onChange={(v) => {
          setBusy(true);
          void call("user_feedback_member_save", { auto_share: v, done: true })
            .then((out) => { toast(String(out.message || "Saved.")); return uf.reload(); })
            .catch((e) => toast(`Couldn't save: ${errorText(e)}`)).finally(() => setBusy(false));
        }} />
        <span>Always share</span>
      </label>
    </div>
  );
}

/** Each member's own set-up, once: read my mail, read my meetings, share on my own. */
function MemberSetup() {
  const uf = useUF();
  const toast = useToast();
  const [mail, setMail] = useState(true);
  const [meetings, setMeetings] = useState(true);
  const [auto, setAuto] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "reading">("idle");
  if (!uf.settings?.setup_done_at || uf.member?.setup_done_at || DEMO) return null;
  const save = async () => {
    setState("saving");
    try {
      await call("user_feedback_member_save", { read_mail: mail, read_meetings: meetings, auto_share: auto, done: true });
      setState("reading");
      let found = 0;
      for (let i = 0; i < 6; i++) {
        const out = await call("user_feedback_read", { catch_up: true, days: 21, max_items: 6 });
        found += Number(out.found || 0);
        if (!Number(out.remaining || 0)) break;
      }
      toast(found ? `Found ${found} sentences about the product in your last three weeks. Only you can see them.` : "Read your last three weeks: nothing about the product yet.");
      await uf.reload();
    } catch (e) {
      toast(`Couldn't finish: ${errorText(e)}`);
    } finally {
      setState("idle");
    }
  };
  return (
    <div className="uf-member">
      <div className="uf-member__lead">
        <Lock size={14} aria-hidden="true" />
        <div><span className="uf-b">Your own mail and meetings.</span> The Lemma reads them for what customers say about the product. Only you see what it finds until you share it.</div>
      </div>
      <div className="uf-member__opts">
        <label className="uf-switch"><Switch checked={mail} label="Read my mail" onChange={setMail} /><span>Read my mail</span></label>
        <label className="uf-switch"><Switch checked={meetings} label="Read my meetings" onChange={setMeetings} /><span>Read my meetings</span></label>
        <label className="uf-switch"><Switch checked={auto} label="Share on my own" onChange={setAuto} /><span>Share what customers say on my own</span></label>
        <Button variant="primary" size="sm" busy={state !== "idle"} onClick={() => void save()}>{state === "reading" ? "Reading your last three weeks…" : "Save"}</Button>
      </div>
    </div>
  );
}

function InboxEmpty({ tab, filtered }: { tab: Tab; filtered: boolean }) {
  if (filtered) return <Empty title="Nothing matches">Clear the search or the filters to see everything.</Empty>;
  if (tab === "mine") return <Empty icon={Lock} title="Nothing waiting from your mail and meetings">Sentences about the product show here as your mail is sorted and your meetings are written up.</Empty>;
  if (tab === "unfiled") return <Empty title="Everything kept is filed">A quote kept without a feature shows here, and so do quotes that fit none until the nightly pass suggests one.</Empty>;
  if (tab === "aside") return <Empty title="Nothing set aside">Quotes that aren't feedback, or are already here, go here with X.</Empty>;
  return <Empty title="Nothing new to file" action={<Button onClick={() => to.week()}>See this week</Button>}>New quotes from shared mail, meetings, notes and public posts land here, already filed.</Empty>;
}

/* ---------- picking a feature ---------- */

export function FeaturePicker({ open, uf, current, onClose, onPick, title = "File under", exclude }: {
  open: boolean; uf: UF; current: string | null; onClose: () => void; onPick: (id: string) => void; title?: string; exclude?: string;
}) {
  const [find, setFind] = useState("");
  const groups = useMemo(() => {
    const live = uf.features.filter((f) => (f.state === "active" || f.state === "suggested") && f.id !== exclude);
    const needle = find.trim().toLowerCase();
    const hit = (f: Feature) => !needle || `${f.name} ${f.aliases.join(" ")}`.toLowerCase().includes(needle);
    const tops = live.filter((f) => !f.parent_id || !uf.featureById.get(f.parent_id));
    return tops.map((t) => ({ top: t, kids: live.filter((k) => k.parent_id === t.id) }))
      .filter((g) => hit(g.top) || g.kids.some(hit))
      .map((g) => ({ ...g, kids: needle ? g.kids.filter(hit) : g.kids }));
  }, [uf, find, exclude]);
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <input className="c-input" autoFocus placeholder="Find a feature" aria-label="Find a feature" value={find} onChange={(e) => setFind(e.target.value)} />
      <div className="uf-pick">
        {groups.map((g) => (
          <div key={g.top.id}>
            <button type="button" className={`uf-pick__row${g.top.id === current ? " is-on" : ""}`} onClick={() => onPick(g.top.id)}>
              <span className="uf-b">{g.top.name}</span>{g.top.state === "suggested" ? <Pill tone="ai">Suggested</Pill> : null}
            </button>
            {g.kids.map((k) => (
              <button key={k.id} type="button" className={`uf-pick__row uf-pick__row--kid${k.id === current ? " is-on" : ""}`} onClick={() => onPick(k.id)}>
                <span>{k.name}</span>{k.state === "suggested" ? <Pill tone="ai">Suggested</Pill> : null}
              </button>
            ))}
          </div>
        ))}
        {!groups.length ? <p className="uf-small c-faint">No feature by that name. Add it with New feature.</p> : null}
      </div>
    </Sheet>
  );
}

export function NewFeatureSheet({ open, uf, onClose, onMade, parent }: { open: boolean; uf: UF; onClose: () => void; onMade: (id: string) => void; parent?: string | null }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [parentId, setParentId] = useState<string>(parent || "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(""); setDesc(""); setParentId(parent || ""); } }, [open, parent]);
  const tops = uf.features.filter((f) => f.state === "active" && !f.parent_id);
  const save = async () => {
    setBusy(true);
    try {
      const out = await call("user_feedback_feature", { action: "create", name, description: desc || null, parent_id: parentId || null });
      toast(String(out.message || "Added."));
      await uf.reload();
      if (out.id) onMade(String(out.id));
    } catch (e) {
      toast(`Couldn't add it: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title={parent ? "Add an improvement" : "New feature"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => void save()}>Add</Button></>}>
      <Field label="Name" hint="The team's words for it, not a customer's sentence."><input className="c-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bulk edit" /></Field>
      <Field label="What it is" hint="One line: what's in it and what isn't. Filing reads it."><input className="c-input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <Field label="Part of">
        <select className="c-input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">Nothing: a top-level area</option>
          {tops.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
    </Sheet>
  );
}

export { KindPill, ImpPill };
export type { Scope };
