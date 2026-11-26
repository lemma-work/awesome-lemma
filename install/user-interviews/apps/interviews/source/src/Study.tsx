// A study: the home of the work. Its question and counts; everyone who fits,
// with why, where they stand and the one thing to do; what the calls found so
// far; and beside it who fits as the Lemma read it, the contact rules, and how
// invites, booking, the call and thanks work.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarCheck, Check, ClipboardPaste, Ellipsis, ExternalLink, Info, MailPlus, RefreshCw, Send, Sparkles, Users,
} from "lucide-react";
import {
  Avatar, Banner, Button, DEMO, Empty, Evidence, Kbd, Menu, MenuItem, MenuLabel, Pill, SearchField, Segmented, Sheet, Spinner,
  cx, day, errorText, openApp, plural, useToast,
} from "@lemma-plugins/kit";
import { SetupLink, Top } from "./App";
import { draftInvite, mark, parseList, peoplePath, readFit, rebuild, savePasted, sendInvite, useUI, useWho, where, type UI, type Where } from "./data";
import { gridOf } from "./grid";
import { STAGE_LABEL, forever, isResting, segmentOf, standing, stageTone, studyTone, toReview, upcoming } from "./marks";
import { SEGMENTS, to, type Segment } from "./route";
import type { Person, Study } from "./types";

const SEG_LABEL: Record<Segment, string> = { all: "All", invite: "To invite", invited: "Invited", booked: "Booked", done: "Done", resting: "Resting" };
const BATCH = 5;

/** The study's header and its two tabs, shared by People and Findings. */
export function StudyHead({ study, tab, actions }: { study: Study; tab: "people" | "findings"; actions?: ReactNode }) {
  const ui = useUI();
  const who = useWho();
  const people = ui.people.filter((p) => p.study_id === study.id);
  const kept = ui.findings.filter((f) => f.study_id === study.id);
  const t = studyTone(study);
  const about = study.feature_ids.map((id) => ui.features.get(id)?.name).filter(Boolean);
  const owner = study.owner_user_id === who.me?.id ? "you" : study.owner_name || "someone";
  return (
    <div className="ui-head">
      <div className="ui-head__main">
        <div className="ui-line">
          <Pill tone={t.tone}>{t.text}</Pill>
          <span className="c-faint ui-small">
            {study.opened_at ? `Opened ${day(study.opened_at)}` : `Written ${day(study.created_at)}`} by {owner}
          </span>
        </div>
        <h1 className="ui-title">{study.question}</h1>
        <div className="ui-facts">
          <span><span className="c-faint">Want</span> {plural(study.want, "call")}</span>
          <span><span className="c-faint">Booked</span> {people.filter((p) => p.stage === "booked").length}</span>
          <span><span className="c-faint">Done</span> {people.filter((p) => p.stage === "done").length}</span>
          <span><span className="c-faint">Findings kept</span> {kept.length}{kept.length ? `, from ${plural(new Set(kept.map((k) => k.person_id)).size, "person", "people")}` : ""}</span>
          {about.length ? <span><span className="c-faint">About</span> {about.join(" · ")}</span> : null}
        </div>
      </div>
      <div className="ui-head__acts">{actions}</div>
      <div className="ui-tabs">
        <Segmented<"people" | "findings"> label="Study" value={tab}
          onChange={(v) => (v === "people" ? to.study(study.id) : to.findings(study.id))}
          items={[{ id: "people", label: "People", count: people.filter((p) => p.stage !== "skipped").length }, { id: "findings", label: "Findings", count: kept.length }]} />
      </div>
    </div>
  );
}

export function StudyPage({ id, show, invites }: { id: string; show: Segment; invites: boolean }) {
  const ui = useUI();
  const who = useWho();
  const toast = useToast();
  const study = ui.studies.find((s) => s.id === id);
  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<"invites" | "paste" | null>(invites ? "invites" : null);
  const [drafting, setDrafting] = useState(false);
  const [mine, setMine] = useState<Where | null>(null);
  const me = who.me?.id;

  useEffect(() => {
    if (DEMO) return;
    void where().then(setMine).catch(() => setMine(null));
  }, []);
  useEffect(() => { if (invites) setSheet("invites"); }, [invites]);

  const people = useMemo(() => ui.people.filter((p) => p.study_id === id && p.stage !== "skipped"), [ui.people, id]);
  const counts = useMemo(() => {
    const c: Record<Segment, number> = { all: people.length, invite: 0, invited: 0, booked: 0, done: 0, resting: 0 };
    for (const p of people) {
      const s = segmentOf(p);
      if (s !== "other") c[s] += 1;
    }
    return c;
  }, [people]);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return people.filter((p) => (show === "all" || segmentOf(p) === show)
      && (!needle || [p.name, p.handle, p.company_name, p.title].some((x) => (x || "").toLowerCase().includes(needle))))
      // Best fit first; those the contact rules hold back go last, since nobody can invite them.
      .sort((a, b) => Number(isResting(a)) - Number(isResting(b)) || b.rank - a.rank);
  }, [people, show, search]);

  if (!study) {
    return (
      <>
        <Top crumbs={[{ label: "User interviews", go: () => to.studies() }, { label: "Study" }]} />
        <main className="c-body"><Empty title="This study isn't here" action={<Button onClick={() => to.studies()}>All studies</Button>}>It may have been cleared with the sample.</Empty></main>
      </>
    );
  }

  const myDrafts = people.filter((p) => p.stage === "drafted" && p.invite_state === "drafted" && (!p.inviter_user_id || p.inviter_user_id === me)
    && ui.drafts.some((d) => d.built_from.person_id === p.id && d.state === "proposed"));
  const writing = people.filter((p) => p.invite_state === "writing");
  const free = people.filter((p) => p.stage === "fits" && !isResting(p) && p.invite_state !== "writing");
  const needed = Math.max(0, study.want - people.filter((p) => ["invited", "booked", "done"].includes(p.stage)).length - myDrafts.length);
  const batch = Math.min(BATCH, free.length, Math.max(needed, 0) || 0);
  const blocked = mine && (!mine.mail.ok || !mine.booking.ok);

  const draftSome = async () => {
    setDrafting(true);
    try {
      for (const p of free.slice(0, batch)) await draftInvite(p, me);
      toast(`Writing ${plural(batch, "invite")} in your voice. They'll be here to review, and nothing goes out until you press Send.`);
    } catch (e) {
      toast(`Couldn't start the invites: ${errorText(e)}`);
    } finally {
      setDrafting(false);
    }
  };

  const primary = myDrafts.length ? (
    <Button variant="primary" icon={Send} onClick={() => setSheet("invites")}>Review {plural(myDrafts.length, "invite")}</Button>
  ) : writing.length ? (
    <Button variant="primary" busy disabled>Writing {plural(writing.length, "invite")}</Button>
  ) : batch > 0 && study.state !== "done" ? (
    <Button variant="primary" icon={Sparkles} busy={drafting} disabled={!!blocked} onClick={() => void draftSome()}>Draft {plural(batch, "invite")}</Button>
  ) : null;

  return (
    <>
      <Top crumbs={[{ label: "User interviews", go: () => to.studies() }, { label: "Studies", go: () => to.studies() }, { label: "Study" }]}>
        <div className="ui-search c-hide-sm"><SearchField value={search} onChange={setSearch} placeholder="Search people" /></div>
        <SetupLink />
      </Top>
      <main className="ui-page">
        <StudyHead study={study} tab="people" actions={<>
          <Button onClick={() => to.edit(study.id)}>Edit question</Button>
          {primary}
        </>} />
        {blocked ? (
          <div className="ui-pad">
            <Banner icon={Info} action={<Button size="sm" onClick={() => to.setup()}>Finish set-up</Button>}>
              {!mine!.mail.ok && !mine!.booking.ok ? "Invites go from your mailbox and carry your booking page's link: set up both first."
                : !mine!.mail.ok ? "Invites go from your own mailbox: set up Mail first." : "Each invite carries a link to book you: turn on your booking page first."}
            </Banner>
          </div>
        ) : null}
        <div className="ui-split">
          <section className="ui-main" aria-label="People">
            <div className="ui-toolbar">
              <Segmented<Segment> label="People by stage" value={show} onChange={(v) => to.study(study.id, v)}
                items={SEGMENTS.map((s) => ({ id: s, label: SEG_LABEL[s], count: counts[s] }))} />
              <span className="c-grow" />
              <span className="c-faint ui-small c-hide-sm">Sorted by how well they fit</span>
            </div>
            <div className="ui-search ui-only-sm"><SearchField value={search} onChange={setSearch} placeholder="Search people" /></div>
            {study.fit_state === "reading" && !people.length ? (
              <div className="c-table-wrap"><div className="ui-reading"><Spinner /> Reading who fits and finding them among the people your team knows…</div></div>
            ) : !people.length ? (
              <Empty icon={Users} title="Nobody fits yet"
                action={<div className="c-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  <Button onClick={() => setSheet("paste")} icon={ClipboardPaste}>Paste a list</Button>
                  <Button onClick={() => void rebuild(study).then(toast).catch((e) => toast(errorText(e)))} icon={RefreshCw}>Look again</Button>
                </div>}>
                Nobody the team knows matches who fits. Loosen the sentence, or paste a list of people to choose from.
              </Empty>
            ) : shown.length ? (
              <PeopleTable people={shown} ui={ui} me={me} />
            ) : <Empty title={`Nobody ${SEG_LABEL[show].toLowerCase()}`}>{search ? "Nobody matches the search." : "Nobody is at this stage yet."}</Empty>}
            <SoFar study={study} />
          </section>
          <Side study={study} people={people} mine={mine} onPaste={() => setSheet("paste")} />
        </div>
      </main>
      <InvitesSheet open={sheet === "invites"} people={myDrafts} onClose={() => { setSheet(null); if (invites) to.study(study.id, show); }} />
      <PasteSheet open={sheet === "paste"} study={study} onClose={() => setSheet(null)} />
    </>
  );
}

/* ---------- the people table ---------- */

function PeopleTable({ people, ui, me }: { people: Person[]; ui: UI; me: string | undefined }) {
  return (
    <div className="c-table-wrap">
      <table className="c-table ui-ptable">
        <thead>
          <tr><th style={{ width: "26%" }}>Person</th><th>Why they fit</th><th style={{ width: "24%" }}>Where it stands</th><th style={{ width: 120 }} aria-label="Next" /></tr>
        </thead>
        <tbody>
          {people.map((p) => <PersonRow key={p.id} p={p} ui={ui} me={me} />)}
        </tbody>
      </table>
    </div>
  );
}

function PersonRow({ p, ui, me }: { p: Person; ui: UI; me: string | undefined }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const st = standing(p, ui.settings, me);
  const resting = isResting(p);
  const hasCall = ["booked", "done", "no_show", "invited"].includes(p.stage);
  const open = () => (hasCall ? to.call(p.study_id, p.id) : undefined);
  const act = async (what: string) => {
    setBusy(true);
    try {
      toast(await mark(p, what));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const write = async () => {
    setBusy(true);
    try {
      await draftInvite(p, me);
      toast(`Writing ${p.name?.split(" ")[0] || "their"} invite in your voice.`);
    } catch (e) {
      toast(`Couldn't start the invite: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const people = async () => {
    if (!(await openApp("people", await peoplePath(p.handle)))) toast("Open People map to see everything about them.");
  };

  let action: ReactNode = null;
  if (resting) {
    action = (
      <Menu label="Why" align="right" size="sm">{(close) => <>
        <MenuLabel>{p.rest_rule || (p.stage === "no_show" ? "Missed the call" : "Contact rules")}</MenuLabel>
        {p.stage !== "opted_out" && p.stage !== "no_show" && !forever(p.rests_until)
          ? <MenuItem icon={MailPlus} onSelect={() => { close(); void act("override"); }}>Invite anyway</MenuItem>
          : <MenuLabel>Not invited again unless they ask.</MenuLabel>}
      </>}</Menu>
    );
  } else if (p.stage === "fits" && p.invite_state !== "writing") {
    action = <Button size="sm" busy={busy} onClick={(e) => { e.stopPropagation(); void write(); }}>{p.invite_state === "failed" ? "Try again" : "Draft invite"}</Button>;
  } else if (p.invite_state === "writing") {
    action = <span className="c-writing"><Spinner /> Writing</span>;
  } else if (p.stage === "drafted") {
    action = <Button size="sm" onClick={() => to.invites(p.study_id)}>Review</Button>;
  } else if (p.stage === "done" && toReview(p) && p.inviter_user_id === me) {
    action = <Button size="sm" onClick={() => open()}>Review</Button>;
  } else if (hasCall) {
    action = <Button size="sm" onClick={() => open()}>Open</Button>;
  }

  return (
    <tr onClick={() => open()} className={cx(!hasCall && "ui-nolink")}>
      <td>
        <div className="c-cell ui-person">
          <Avatar name={p.name} email={p.handle} size={26} />
          <div>
            <button type="button" className="ui-link" onClick={(e) => { e.stopPropagation(); void people(); }}>{p.name || p.handle}</button>
            <div className="c-cell__sub">{[p.title, p.company_name].filter(Boolean).join(" · ") || p.handle}</div>
          </div>
        </div>
      </td>
      <td className="ui-wrap">
        <div className="ui-chips">{p.why.map((w) => <span key={w} className="ui-chip">{w}</span>)}</div>
        {p.quote ? <div className="ui-quote"><Evidence quote={p.quote} />{p.quote_from ? <span className="c-faint ui-small"> · {p.quote_from}</span> : null}</div> : null}
      </td>
      <td className="ui-wrap">
        <Pill tone={st.tone}>{st.pill}</Pill>
        <div className="c-faint ui-small ui-detail">{st.detail}</div>
        {st.note ? <div className="ui-note"><Info size={12} aria-hidden="true" /> {st.note}</div> : null}
      </td>
      <td className="right" onClick={(e) => e.stopPropagation()}>
        <div className="ui-rowacts">
          {action}
          <Menu icon={Ellipsis} title={`More for ${p.name || p.handle}`} align="right" size="sm" variant="ghost">{(close) => <>
            <MenuItem icon={ExternalLink} onSelect={() => { close(); void people(); }}>Open in People map</MenuItem>
            {p.stage === "booked" && !upcoming(p) ? <MenuItem onSelect={() => { close(); void act("no_show"); }}>They didn't show up</MenuItem> : null}
            {p.stage === "invited" || p.stage === "drafted" || p.stage === "fits" ? <MenuItem onSelect={() => { close(); void act("declined"); }}>They said no</MenuItem> : null}
            {p.stage !== "opted_out" ? <MenuItem onSelect={() => { close(); void act("opted_out"); }}>Never invite again</MenuItem> : null}
            {p.stage === "fits" || p.stage === "drafted" ? <MenuItem onSelect={() => { close(); void act("skip"); }}>Leave out of this study</MenuItem> : null}
            {p.stage === "declined" ? <MenuItem onSelect={() => { close(); void act("restore"); }}>Put back in the list</MenuItem> : null}
            {p.stage === "done" ? <MenuItem icon={Check} onSelect={() => { close(); void act(p.thanked_at ? "unthanked" : "thanked"); }}>{p.thanked_at ? "Untick Thanked" : "Thanked"}</MenuItem> : null}
          </>}</Menu>
        </div>
      </td>
    </tr>
  );
}

/* ---------- findings so far ---------- */

function SoFar({ study }: { study: Study }) {
  const ui = useUI();
  const grid = useMemo(() => gridOf(ui, study.id), [ui, study.id]);
  if (!grid.rows.length) return null;
  return (
    <section className="c-section ui-sofar">
      <div className="c-section__head">
        <h2>Findings so far</h2>
        <span className="c-faint ui-small">Counted in people, not quotes · filed under the team's features</span>
      </div>
      <div className="c-table-wrap">
        <table className="c-table ui-sofar__table">
          <thead><tr><th>Feature</th><th>People</th><th className="c-hide-sm">Blockers</th><th className="c-hide-sm">On the roadmap</th><th className="c-hide-sm">Strongest quote</th></tr></thead>
          <tbody>
            {grid.rows.slice(0, 6).map((r) => (
              <tr key={r.key} onClick={() => to.findings(study.id, r.feature?.id)}>
                <td className="ui-wrap">{r.name}{r.feature?.state === "suggested" ? <> <Pill tone="ai" dot={false}>Suggested</Pill></> : null}</td>
                <td className="num"><span className="ui-strong">{r.people} of {grid.total}</span> <span className="c-faint">· {plural(r.findings, "finding")}</span></td>
                <td className="num c-hide-sm">{r.blockers}</td>
                <td className="c-hide-sm">{r.feature ? <Pill tone={stageTone(r.feature.stage)}>{STAGE_LABEL[r.feature.stage] || r.feature.stage}</Pill> : <span className="c-faint">Not filed</span>}</td>
                <td className="ui-wrap c-hide-sm"><Evidence quote={r.quotes[0]?.quote} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- the side panel ---------- */

function Side({ study, people, mine, onPaste }: { study: Study; people: Person[]; mine: Where | null; onPaste: () => void }) {
  const ui = useUI();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const read = study.fit_read;
  const counts = study.pool_counts || {};
  const resting = people.filter((p) => isResting(p)).length;
  const s = ui.settings;
  const stale = study.fit_state === "reading" && study.updated_at && Date.now() - Date.parse(study.updated_at) > 4 * 60_000;
  const again = async (what: "read" | "pool") => {
    setBusy(what);
    try {
      if (what === "read") await readFit(study);
      else toast(await rebuild(study));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  };
  return (
    <aside className="ui-side" aria-label="How this study works">
      <section className="ui-sec">
        <h3>Who fits</h3>
        {study.fit_sentence ? <div className="ui-sentence">{study.fit_sentence}</div> : <p className="c-muted">Everyone the team knows who said something, has a deal, or is one of your people.</p>}
        {study.fit_state === "reading" && !stale ? (
          <div className="c-writing ui-gap"><Spinner /> Reading it into filters…</div>
        ) : study.fit_state === "failed" || stale ? (
          <div className="ui-gap"><span className="c-muted">That didn't read. </span><Button size="sm" busy={busy === "read"} onClick={() => void again("read")}>Read again</Button></div>
        ) : read ? (
          <div className="ui-read">
            <Pill tone="ai" icon={Sparkles}>Read as</Pill>
            {read.filters.map((f, i) => <div key={i}>{f.line}</div>)}
            <div>Not resting under the contact rules</div>
            {read.unknown.map((u, i) => <div key={`u${i}`} className="ui-unknown"><s>{u.line}</s> <span className="ui-small">no data for this</span></div>)}
          </div>
        ) : null}
        <p className="c-faint ui-small ui-gap">
          From deals {counts.deal || 0} · what people said {counts.feedback || 0} · asks {counts.ask || 0} · your own people {counts.mine || 0} · a pasted list {counts.pasted || 0}
        </p>
        <div className="ui-line ui-gap">
          <Button size="sm" icon={ClipboardPaste} onClick={onPaste}>Paste a list</Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} busy={busy === "pool"} onClick={() => void again("pool")}>Look again</Button>
        </div>
      </section>
      <section className="ui-sec">
        <h3>Contact rules, for the whole team</h3>
        <div className="ui-rules">
          <div>Not invited within {s?.invite_gap_days || 30} days of the last invite</div>
          <div>Not again for {s?.no_show_days || 90} days after a no-show</div>
          <div>Never after they ask not to be</div>
        </div>
        <p className="c-faint ui-small ui-gap">{resting ? `${plural(resting, "person", "people")} resting now, each with the rule on their row.` : "Nobody here is resting."}</p>
      </section>
      <section className="ui-sec">
        <h3>Invites</h3>
        <p>Written for each person in your voice, and sent from {mine?.mail.email ? <b>{mine.mail.email}</b> : "your mailbox"} only when you press Send. Replies arrive in Mail; after {s?.nudge_days || 4} working days with no booking, Mail drafts a nudge in that thread.</p>
      </section>
      <section className="ui-sec">
        <h3>Booking</h3>
        <p>{mine?.booking.ok ? <>Your booking page{mine.booking.minutes ? `, ${mine.booking.minutes}-minute calls` : ""}. </> : "Your booking page. "}A booking from an invited address joins this study, whether through the page or any calendar invite.</p>
        {mine?.booking.page_url ? <a className="ui-small ui-url" href={mine.booking.page_url} target="_blank" rel="noreferrer">{mine.booking.page_url}</a> : null}
      </section>
      <section className="ui-sec">
        <h3>The call</h3>
        <p>Read afterwards from {mine?.meetings.notes_from === "meet" ? "the Google Meet transcript" : "your notes in Meetings"}, or a transcript you paste. Transcription isn't on in Meet by itself: press Transcribe when the call starts.</p>
      </section>
      <section className="ui-sec">
        <h3>Thanks</h3>
        <p>Tick <i>Thanked</i> when you have thanked them yourself. Lemma never pays anyone.</p>
      </section>
    </aside>
  );
}

/* ---------- reviewing invites ---------- */

function InvitesSheet({ open, people, onClose }: { open: boolean; people: Person[]; onClose: () => void }) {
  const ui = useUI();
  const who = useWho();
  const toast = useToast();
  const [at, setAt] = useState(0);
  const p = people[Math.min(at, people.length - 1)];
  const d = p ? ui.drafts.find((x) => x.built_from.person_id === p.id) : undefined;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    setSubject(d?.subject || "");
    setBody(d?.body || "");
  }, [d?.id, d?.subject, d?.body]);
  useEffect(() => { if (!open) setAt(0); }, [open]);

  const send = async () => {
    if (!p) return;
    setBusy("send");
    try {
      const out = await sendInvite(p, subject, body);
      toast(out.message);
      if (out.sent && people.length <= 1) onClose();
    } catch (e) {
      toast(`Not sent: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const again = async () => {
    if (!p) return;
    setBusy("again");
    try {
      await draftInvite(p, who.me?.id);
      toast("Writing it again.");
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  };
  const skip = async () => {
    if (!p) return;
    setBusy("skip");
    try {
      toast(await mark(p, "skip"));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={people.length ? `Invite ${at + 1} of ${people.length}` : "Invites"}
      footer={p && d ? <>
        <Button variant="primary" icon={Send} busy={busy === "send"} onClick={() => void send()}>Send</Button>
        <Button busy={busy === "again"} icon={RefreshCw} onClick={() => void again()}>Write again</Button>
        <span className="c-grow" />
        <Button variant="ghost" busy={busy === "skip"} onClick={() => void skip()}>Leave out</Button>
        {people.length > 1 ? <Button variant="ghost" onClick={() => setAt((at + 1) % people.length)}>Next</Button> : null}
      </> : undefined}>
      {!p || !d ? (
        <Empty icon={CalendarCheck} title="No invites waiting">Every invite you drafted for this study has gone, or been left out.</Empty>
      ) : (
        <>
          <div className="c-cell ui-person">
            <Avatar name={p.name} email={p.handle} size={32} />
            <div>
              <div className="ui-strong">{p.name || p.handle}</div>
              <div className="c-cell__sub">{p.handle}{p.company_name ? ` · ${p.company_name}` : ""}</div>
            </div>
          </div>
          <div className="ui-chips">{p.why.map((w) => <span key={w} className="ui-chip">{w}</span>)}</div>
          {p.invite_error ? <Banner tone="danger">{p.invite_error}</Banner> : null}
          <label className="c-field"><span>Subject</span><input className="c-input" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="c-field"><span>Message</span><textarea className="c-textarea" value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <p className="c-faint ui-small"><Sparkles size={12} aria-hidden="true" /> Written in your voice from {(d.built_from.used || []).join(", ") || "why they fit"}. Sent from your mailbox when you press Send; nothing else goes out. <Kbd>Esc</Kbd> closes.</p>
        </>
      )}
    </Sheet>
  );
}

/* ---------- a pasted list ---------- */

function PasteSheet({ open, study, onClose }: { open: boolean; study: Study; onClose: () => void }) {
  const { me } = useWho();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => parseList(text), [text]);
  const save = async () => {
    setBusy(true);
    try {
      const n = await savePasted(study.id, rows, me?.id);
      toast(`Kept ${plural(n, "person", "people")}. ${await rebuild(study)}`);
      setText("");
      onClose();
    } catch (e) {
      toast(`Couldn't keep the list: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Paste a list"
      footer={<><Button variant="primary" busy={busy} disabled={!rows.length} onClick={() => void save()}>Add {plural(rows.length, "person", "people")}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <p className="c-muted">A CSV with a header row (email, name, company, title, and any other columns, such as plan or seats), or one person a line. Other columns can be used in who fits: "on the Team plan".</p>
      <textarea className="c-textarea" value={text} onChange={(e) => setText(e.target.value)}
        placeholder={"email,name,company,title,plan\nelena@brightline.example,Elena Costa,Brightline,Admin,Team"} />
      {rows.length ? <p className="c-faint ui-small">{plural(rows.length, "person", "people")} read{Object.keys(rows[0].fields).length ? `, with ${Object.keys(rows[0].fields).join(", ")}` : ""}.</p> : null}
    </Sheet>
  );
}
