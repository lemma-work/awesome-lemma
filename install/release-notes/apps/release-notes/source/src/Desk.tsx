// The draft desk: what merged, turned into the note, with each line's sources,
// and where it goes when it's published.
//
//   left    the merged pull requests: in the note, left out, all
//   middle  the note, drafted by the Lemma, edited by typing; a person's
//           edit is never redrafted
//   right   the selected line's sources, and Publish to

import { useMemo, useState } from "react";
import { Check, CircleMinus, CirclePlus, GitMerge, Package, Pencil, RefreshCw, Sparkles, TriangleAlert, Users } from "lucide-react";
import { AskButton, Avatar, Button, Card, Connect, DEMO, Empty, Pill, Sheet, ago, day, demoNote, plural, useToast, errorText } from "@lemma-plugins/kit";
import { asksFor, call, issueNumber, leaveOut, publishProblems, publishText, redraft, saveLine, useRN, useWho } from "./data";
import { to } from "./route";
import { Top } from "./Top";
import type { Line, Note, Pr } from "./types";

type Tab = "in" | "out" | "all";

export function liveWords(note: Note): { tone: "success" | "warning" | "plain"; text: string } {
  if (note.state === "published") return { tone: "success", text: "Published" };
  if (note.live_at && (note.live_via === "workflow" || note.live_via === "deployment")) return { tone: "success", text: `Live in ${note.live_env || "production"}` };
  if (note.live_at && note.live_via === "tag") return { tone: "success", text: `Tagged ${note.tag || note.name}` };
  return { tone: "warning", text: "Merged, not live yet" };
}

export function Desk() {
  const rn = useRN();
  const note = rn.open;
  const [search, setSearch] = useState("");
  if (!note) {
    return (
      <>
        <Top here="desk" />
        <main className="c-body">
          <Empty icon={GitMerge} title="Nothing merged since the last release"
            action={rn.published[0] ? <Button onClick={() => to.note(rn.published[0].id)}>Open {rn.published[0].name}</Button> : undefined}>
            The next note starts with the next pull request that merges in {(rn.settings?.repos || []).map((r) => r.name).join(", ") || "your repositories"}.
          </Empty>
        </main>
      </>
    );
  }
  return (
    <>
      <Top here="desk" search={search} onSearch={setSearch} placeholder="Search notes and merges" />
      <DeskFor note={note} search={search} />
    </>
  );
}

function DeskFor({ note, search }: { note: Note; search: string }) {
  const rn = useRN();
  const { me } = useWho();
  const toast = useToast();
  const prs = useMemo(() => rn.prs.filter((p) => p.note_id === note.id), [rn.prs, note.id]);
  const lines = useMemo(() => rn.lines.filter((l) => l.note_id === note.id), [rn.lines, note.id]);
  const shown = lines.filter((l) => !l.hidden);
  const [selected, setSelected] = useState<string | null>(null);
  const sel = lines.find((l) => l.id === selected) || shown[0] || null;
  const [publishing, setPublishing] = useState(false);
  const [dest, setDest] = useState({ github: true, page: true, slack: true });
  const [preview, setPreview] = useState(false);
  const [problems, setProblems] = useState<Record<string, { code: string }>>({});
  const publisher = !rn.settings?.publishers?.length || rn.settings.publishers.some((p) => p.user_id === me?.id);
  const asked = new Set(shown.flatMap((l) => asksFor(l, note.repo, rn.asks).filter((a) => ["open", "shipped", "told"].includes(a.state)).map((a) => a.id))).size;
  const merged = prs.length;
  const since = rn.published.find((n) => n.name === note.from_ref)?.published_at || prs[prs.length - 1]?.merged_at;
  const live = liveWords(note);
  const slack = rn.settings?.slack_channel ? `#${rn.settings.slack_channel_name || rn.settings.slack_channel}` : null;

  const publish = async () => {
    setPublishing(true);
    try {
      const out = await call("release_notes_publish", { note_id: note.id, ...dest, slack: dest.slack && !!slack });
      setProblems(publishProblems(out));
      toast(publishText(out));
      if (out.published) to.asked();
    } catch (e) {
      toast(`Couldn't publish: ${errorText(e)}`);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <div className="rn-bar">
        <span className="rn-ver">{note.name}</span>
        <span className="c-muted">{note.repo} · {note.from_ref || "start"} → main · {merged} merged{since ? ` since ${day(since)}` : ""}</span>
        <Pill tone={live.tone}>{live.text}</Pill>
        {note.live_ref ? <span className="rn-meta">{note.live_ref}{note.live_at ? `, ${ago(note.live_at)}` : ""}</span> : null}
        {!note.live_at ? <span className="rn-meta">Ready when {liveHow(rn.settings?.repos?.find((r) => r.name === note.repo)?.live_via, rn.settings?.repos?.find((r) => r.name === note.repo)?.workflow)}</span> : null}
        <span className="c-grow" />
        <Button onClick={() => setPreview(true)}>Preview page</Button>
        {publisher
          ? <Button variant="primary" busy={publishing} onClick={() => void publish()} disabled={!shown.length}>Publish {note.name}</Button>
          : <span className="rn-meta">Publishers: {rn.settings?.publishers.map((p) => p.name || "a member").join(", ")}</span>}
      </div>
      <div className="rn-desk">
        <Merged prs={prs} search={search} note={note} />
        <section className="rn-col rn-col--note" aria-label="The note">
          <NoteCard note={note} lines={lines} asked={asked} prs={prs} selected={sel?.id || null} onSelect={setSelected} search={search} />
        </section>
        <aside className="rn-col rn-col--side" aria-label="Details">
          {sel ? <ThisLine line={sel} note={note} prs={prs} /> : null}
          <Card title="Publish to" flush foot={
            <span className="rn-meta">
              {asked ? `After publishing, ${plural(asked, "person", "people")} who asked get${asked === 1 ? "s" : ""} a reply drafted in the thread they asked in. ` : ""}
              Nothing is sent until someone presses Send. GitHub posts go out as the person who presses Publish.
            </span>}>
            {/* A publish that couldn't reach GitHub or Slack for want of a connection: its next step, here. */}
            {problems.github || problems.slack ? (
              <div className="rn-pad rn-connects">
                {problems.github ? (
                  <Connect quiet connector="github" slug="github" mode="shared" error={problems.github}
                    purpose="Publishing puts the note on the GitHub release. Connect GitHub, then publish again." />
                ) : null}
                {problems.slack ? (
                  <Connect quiet connector="slack" slug="slack" mode="shared" error={problems.slack}
                    purpose={`Publishing posts the note to ${slack || "your Slack channel"}. Connect Slack, then publish again.`} />
                ) : null}
              </div>
            ) : null}
            <Dest checked={dest.github} onChange={(v) => setDest({ ...dest, github: v })} title={`GitHub release ${note.tag || note.name}`} meta={`${note.repo}, as the release's description`} />
            <Dest checked={dest.page} onChange={(v) => setDest({ ...dest, page: v })} title="Changelog page" meta="Your public page, newest first" />
            {slack
              ? <Dest checked={dest.slack} onChange={(v) => setDest({ ...dest, slack: v })} title={`Slack ${slack}`} meta="Posted by the Lemma's Slack app" />
              : <div className="rn-dest rn-dest--off"><span className="rn-meta">No Slack channel. Pick one in Settings.</span></div>}
          </Card>
        </aside>
      </div>
      <Sheet open={preview} title={`${note.name} as the page will show it`} onClose={() => setPreview(false)}>
        <PagePreview note={note} lines={shown} />
      </Sheet>
    </>
  );
}

function liveHow(via?: string, workflow?: string | null): string {
  if (via === "tag") return "a tag is pushed";
  if (via === "merge") return "you publish it";
  return `the ${workflow || "deploy"} workflow finishes`;
}

function Dest({ checked, onChange, title, meta }: { checked: boolean; onChange: (v: boolean) => void; title: string; meta: string }) {
  return (
    <label className="rn-dest">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="c-grow"><span className="rn-dest__t">{title}</span><span className="rn-meta">{meta}</span></span>
    </label>
  );
}

/* ---------- what merged ---------- */

function prState(p: Pr): { text: string; tone: "info" | "plain" | "warning" } | null {
  if (p.left_out) return { text: "Left out", tone: "plain" };
  if (!p.live_at) return { text: "Not live yet", tone: "warning" };
  return null;
}

function Merged({ prs, search, note }: { prs: Pr[]; search: string; note: Note }) {
  const rn = useRN();
  const { me } = useWho();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("in");
  const inNote = prs.filter((p) => !p.left_out && p.kind && !["routine", "internal"].includes(p.kind));
  const out = prs.filter((p) => !inNote.includes(p));
  const list = (tab === "in" ? inNote : tab === "out" ? out : prs)
    .filter((p) => !search || `${p.title} #${p.number} ${p.author}`.toLowerCase().includes(search.toLowerCase()));
  const kinds = out.reduce<Record<string, number>>((acc, p) => {
    const k = /^Bump |dependabot|renovate/i.test(`${p.title} ${p.author}`) ? "dependency updates"
      : /\b(ci|workflow|pipeline|e2e|cache)\b/i.test(p.title) ? "CI changes" : /typo/i.test(p.title) ? "typo fixes"
      : p.left_out?.startsWith("Left out by") ? "left out by hand" : "internal changes";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const askedFor = (p: Pr) => {
    const refs = new Set([`${p.repo}#${p.number}`, ...p.closes.map((c) => c.ref)]);
    return new Set(rn.asks.filter((a) => refs.has(a.work_id) && ["open", "shipped", "told"].includes(a.state)).map((a) => `${a.handle_kind}:${a.handle}`)).size;
  };
  const toggle = async (p: Pr) => {
    try {
      await leaveOut(p, !p.left_out && inNote.includes(p), me);
      if (!DEMO) await redraft(note.id);
      toast(inNote.includes(p) ? `#${p.number} is left out; the note is being redrafted.` : `#${p.number} is in; the note is being redrafted.`);
    } catch (e) {
      toast(`Couldn't change it: ${errorText(e)}`);
    }
  };
  return (
    <section className="rn-col rn-col--merged" aria-label="What merged">
      <Card title="Merged" flush action={
        <div className="rn-seg-sm">
          {([["in", "In the note", inNote.length], ["out", "Left out", out.length], ["all", "All", prs.length]] as const).map(([id, label, n]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}<span>{n}</span></button>
          ))}
        </div>}>
        {list.length === 0 ? <p className="rn-pad rn-meta">{search ? "Nothing matches." : tab === "out" ? "Nothing left out." : "Nothing yet."}</p> : null}
        {list.map((p) => {
          const st = prState(p);
          const n = askedFor(p);
          return (
            <div key={p.id} className={`rn-pr${st?.text === "Left out" ? " rn-pr--out" : ""}`}>
              <GitMerge size={14} aria-hidden="true" />
              <div className="c-grow">
                <div className="c-ellipsis" title={p.title}>{p.title}</div>
                <div className="rn-meta">#{p.number}{p.author ? ` · ${p.author}` : ""} · {p.left_out ? p.left_out.replace(/^(Routine|Internal): .*/, "$1").toLowerCase() : p.live_at ? "live" : `merged ${ago(p.merged_at)}`}{p.kind === "breaking" ? " · breaking" : ""}</div>
              </div>
              <div className="rn-pr__end">
                {n && !p.left_out ? <Pill tone="info" dot={false}>{n} asked</Pill> : st ? <Pill tone={st.tone}>{st.text}</Pill> : null}
                <Button size="sm" variant="ghost" icon={inNote.includes(p) ? CircleMinus : CirclePlus}
                  label={inNote.includes(p) ? `Leave #${p.number} out of the note` : `Put #${p.number} in the note`} onClick={() => void toggle(p)} />
              </div>
            </div>
          );
        })}
        {tab === "in" && out.length ? (
          <div className="rn-fold">
            <Package size={14} aria-hidden="true" />
            <span className="c-grow">Left out: {Object.entries(kinds).map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, "").replace(/updates$/, "update") : k}`).join(", ")}</span>
            <Button size="sm" variant="ghost" onClick={() => setTab("out")}>Show</Button>
          </div>
        ) : null}
      </Card>
      <p className="rn-meta rn-note">Pull requests come in from GitHub as they merge. Each one's plain summary is written from its description and the issues it closes; routine and internal work is folded out.</p>
    </section>
  );
}

/* ---------- the note ---------- */

function NoteCard({ note, lines, asked, prs, selected, onSelect, search }: {
  note: Note; lines: Line[]; asked: number; prs: Pr[]; selected: string | null; onSelect: (id: string) => void; search: string;
}) {
  const rn = useRN();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const shown = lines.filter((l) => !l.hidden && (!search || `${l.title || ""} ${l.text}`.toLowerCase().includes(search.toLowerCase())));
  const issues = new Set(lines.flatMap((l) => l.issues)).size;
  const usedPrs = new Set(lines.flatMap((l) => l.prs)).size;
  const latest = prs.reduce<Pr | null>((a, p) => (!a || String(p.merged_at) > String(a.merged_at) ? p : a), null);
  const by = (s: Line["section"]) => shown.filter((l) => l.section === s);
  const again = async () => {
    setBusy(true);
    try {
      if (DEMO) demoNote("In the demo the note isn't redrafted: in a Lemma the writer drafts it again from every pull request since the last release, keeping your edits.");
      else await redraft(note.id);
      if (!DEMO) toast("Redrafting from every merge since the last release. Your edits stay.");
    } catch (e) {
      toast(`Couldn't redraft: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="c-card rn-notecard">
      <div className="rn-notecard__head">
        <Sparkles size={14} aria-hidden="true" className="c-muted" />
        <span className="rn-meta rn-grow-text">
          Drafted from {plural(usedPrs, "pull request")}, {plural(issues, "issue")}{asked ? ` and what ${plural(asked, "person", "people")} asked` : ""}.
          {note.drafted_at ? ` Redrafted ${ago(note.drafted_at)}${latest ? ` when #${latest.number} merged` : ""}.` : " Not drafted yet."}
        </span>
        <Pill tone="ai" dot={false}>ai</Pill>
        <span className="c-grow" />
        <AskButton label="Ask for a change" text={`In Release notes, change the ${note.name} note: `} />
        <Button size="sm" icon={RefreshCw} busy={busy} onClick={() => void again()}>Redraft</Button>
      </div>
      {note.draft_error ? <p className="rn-pad rn-warn-text">{note.draft_error}</p> : null}
      <div className="rn-doc">
        <div className="rn-meta">{day(note.drafted_at || note.updated_at)} · {note.name}{rn.brand?.voice ? " · in your brand's voice, from Brand kit" : ""}</div>
        <h2 className="rn-doc__title">{note.title || `What's new in ${note.name}`}</h2>
        {shown.length === 0 ? <p className="rn-meta">Nothing people would notice has merged yet. Routine and internal work is folded out on the left.</p> : null}
        {by("lead").length ? <div className="rn-sec">Lead with</div> : null}
        {by("lead").map((l) => (
          <LineView key={l.id} line={l} note={note} big selected={selected === l.id} onSelect={onSelect} />
        ))}
        {by("need").map((l) => (
          <div key={l.id} className={`rn-need${selected === l.id ? " is-sel" : ""}`} role="button" tabIndex={0} onClick={() => onSelect(l.id)} onKeyDown={(e) => e.key === "Enter" && onSelect(l.id)}>
            <TriangleAlert size={14} aria-hidden="true" />
            <div className="c-grow">
              <div className="rn-need__h">You need to</div>
              <Editable line={l} />
              <div className="rn-src">{l.prs.map((n) => <span key={n} className="rn-chip">#{n} · labelled breaking</span>)}</div>
            </div>
          </div>
        ))}
        {(["improved", "fixed"] as const).map((s) => by(s).length ? (
          <div key={s}>
            <div className="rn-sec">{s === "improved" ? "Improved" : "Fixed"}</div>
            {by(s).map((l) => <LineView key={l.id} line={l} note={note} selected={selected === l.id} onSelect={onSelect} />)}
          </div>
        ) : null)}
      </div>
    </div>
  );
}

function LineView({ line, note, big, selected, onSelect }: { line: Line; note: Note; big?: boolean; selected: boolean; onSelect: (id: string) => void }) {
  const rn = useRN();
  const n = asksFor(line, note.repo, rn.asks).filter((a) => ["open", "shipped", "told"].includes(a.state)).length;
  const notLive = line.prs.some((num) => { const p = rn.prs.find((x) => x.note_id === note.id && x.number === num); return p && !p.live_at; });
  return (
    <div className={`${big ? "rn-lead" : "rn-li"}${selected ? " is-sel" : ""}`} role="button" tabIndex={0}
      onClick={() => onSelect(line.id)} onKeyDown={(e) => e.key === "Enter" && onSelect(line.id)}>
      <div className="c-grow">
        <Editable line={line} big={big} />
        {big ? <Sources line={line} n={n} notLive={notLive} /> : null}
      </div>
      {!big ? <Sources line={line} n={n} notLive={notLive} compact /> : null}
    </div>
  );
}

function Sources({ line, n, notLive, compact }: { line: Line; n: number; notLive: boolean; compact?: boolean }) {
  return (
    <span className={compact ? "rn-src rn-src--end" : "rn-src"}>
      {line.prs.map((p) => <span key={p} className="rn-chip">#{p}</span>)}
      {!compact ? line.issues.map((i) => <span key={i} className="rn-chip">issue {issueNumber(i)}</span>) : null}
      {n ? <Pill tone="info" dot={false}>{n} asked</Pill> : null}
      {notLive ? <Pill tone="warning">Not live yet</Pill> : null}
      {line.edited_by ? <span className="rn-meta">Edited</span> : null}
    </span>
  );
}

/** A line edited by typing in place. Saving marks it a person's, so no redraft rewrites it. */
function Editable({ line, big }: { line: Line; big?: boolean }) {
  const { me } = useWho();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(line.title || "");
  const [text, setText] = useState(line.text);
  if (editing) {
    const save = async () => {
      try {
        await saveLine(line, { ...(big ? { title: title.trim() || null } : {}), text: text.trim() }, me);
        setEditing(false);
        toast("Saved. A redraft keeps your words.");
      } catch (e) {
        toast(`Couldn't save: ${errorText(e)}`);
      }
    };
    return (
      <div className="rn-edit" onClick={(e) => e.stopPropagation()}>
        {big ? <input className="c-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Heading" /> : null}
        <textarea className="c-input c-textarea rn-edit__text" value={text} onChange={(e) => setText(e.target.value)} aria-label="Line" />
        <div className="c-row">
          <Button size="sm" variant="primary" icon={Check} onClick={() => void save()} disabled={!text.trim()}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setTitle(line.title || ""); setText(line.text); }}>Cancel</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="rn-text">
      {big && line.title ? <h3 className="rn-lead__h">{line.title}</h3> : null}
      <p>{line.text}
        <button type="button" className="rn-pen" aria-label="Edit this line" title="Edit this line" onClick={(e) => { e.stopPropagation(); setEditing(true); }}>
          <Pencil size={12} aria-hidden="true" />
        </button>
      </p>
    </div>
  );
}

/* ---------- the selected line ---------- */

function ThisLine({ line, note, prs }: { line: Line; note: Note; prs: Pr[] }) {
  const rn = useRN();
  const { me, members } = useWho();
  const toast = useToast();
  const mine = prs.filter((p) => line.prs.includes(p.number));
  const people = asksFor(line, note.repo, rn.asks).filter((a) => ["open", "shipped", "told"].includes(a.state));
  const companies = new Set(people.map((a) => a.company_name).filter(Boolean)).size;
  const liveAt = mine.map((p) => p.live_at).filter(Boolean).sort()[0];
  const hide = async () => {
    try {
      await saveLine(line, { hidden: !line.hidden }, me);
      toast(line.hidden ? "Back in the note." : "Hidden from the note; it stays here.");
    } catch (e) {
      toast(`Couldn't change it: ${errorText(e)}`);
    }
  };
  const editor = line.edited_by ? members.find((m) => m.user_id === line.edited_by)?.name || (line.edited_by === me?.id ? "you" : "a member") : null;
  return (
    <Card title="This line" flush foot={
      <div className="c-row" style={{ flexWrap: "wrap" }}>
        {people.length ? <Button size="sm" icon={Users} onClick={() => to.asked()}>See who asked</Button> : null}
        <Button size="sm" variant="ghost" onClick={() => void hide()}>{line.hidden ? "Show in the note" : "Hide from the note"}</Button>
      </div>}>
      <div className="rn-kv">
        <span className="rn-kv__l">Line</span><span>{line.title || line.text}</span>
        <span className="rn-kv__l">Merged</span>
        <span>{mine.length ? mine.map((p) => <span key={p.id} className="rn-block">#{p.number} {(p.summary || p.title).replace(/\.$/, "")}, {day(p.merged_at)}</span>) : "Written by a person"}</span>
        <span className="rn-kv__l">Live</span><span>{liveAt ? `${note.live_env ? note.live_env[0].toUpperCase() + note.live_env.slice(1) : "Live"}, ${day(liveAt)}` : "Not yet"}</span>
        {line.issues.length ? (<>
          <span className="rn-kv__l">Issue</span>
          <span>{line.issues.map((i) => {
            const t = mine.flatMap((p) => p.closes).find((c) => c.ref === i)?.title;
            return <span key={i} className="rn-block">{issueNumber(i)}{t ? ` ${t}` : ""}</span>;
          })}</span>
        </>) : null}
        <span className="rn-kv__l">Asked by</span>
        <span>{people.length ? (
          <span className="c-row">
            <span className="c-stack-av">{people.slice(0, 4).map((a) => <Avatar key={a.id} name={a.name || a.handle} size={22} />)}</span>
            <span className="c-muted">{plural(people.length, "person", "people")}{companies ? `, ${plural(companies, "company", "companies")}` : ""}</span>
          </span>) : <span className="c-muted">Nobody yet</span>}</span>
        {editor ? (<><span className="rn-kv__l">Edited</span><span>By {editor}; a redraft keeps it as it is</span></>) : null}
      </div>
    </Card>
  );
}

/* ---------- preview ---------- */

export function PagePreview({ note, lines }: { note: Note; lines: Line[] }) {
  const lead = lines.filter((l) => l.section === "lead");
  const need = lines.filter((l) => l.section === "need");
  return (
    <article className="rn-preview">
      <div className="rn-meta">{day(note.published_at || note.updated_at)} · {note.name}</div>
      <h2>{note.title || note.name}</h2>
      {lead.map((l) => (
        <div key={l.id}>
          {l.title ? <h3>{l.title}</h3> : null}
          <p>{l.text}</p>
          {l.asked ? <p className="rn-credit"><Users size={13} aria-hidden="true" /> {l.asked === 1 ? "One of you asked for this." : `${l.asked} of you asked for this.`} Thank you.</p> : null}
        </div>
      ))}
      {need.length ? <p className="rn-need rn-need--flat"><b>You need to:</b> {need.map((l) => l.text).join(" ")}</p> : null}
      {(["improved", "fixed"] as const).map((s) => {
        const part = lines.filter((l) => l.section === s);
        return part.length ? (
          <div key={s}><div className="rn-sec">{s === "improved" ? "Improved" : "Fixed"}</div><ul>{part.map((l) => <li key={l.id}>{l.text}</li>)}</ul></div>
        ) : null;
      })}
    </article>
  );
}
