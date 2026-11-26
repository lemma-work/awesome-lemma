// A · Answers, the home tab: every question asked, where, and what answered
// it. Grouped Missed, then Past check date, then Answered; a question opens
// its detail beside the list (alone on a phone). A miss opens on the draft
// made from its owner's reply, or on what the Lemma found, or on asking the
// owner. Keys: J K move, W write it, O ask the owner, C covered by, S set
// aside, Enter save the draft, / search.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Check, CornerDownLeft, FileText, Link2, MessageCircleQuestion, Send, Sparkles, UserRound } from "lucide-react";
import { Button, DEMO, Empty, Kbd, Pill, Segmented, Sheet, Skeleton, ago, plural, useToast } from "@lemma-plugins/kit";
import { AUDIENCE, WHERE, call, decide, firstOf, fmtDay, nowMs, refreshMine, useKnowhow, useWho, type Article, type Data, type Question } from "./data";
import { Ai, Gap, OutcomePill, Page, SourceLine, WhereChip, inline } from "./marks";
import { WhereTheyAsk } from "./WhereTheyAsk";
import { to, typing } from "./route";
import { notify, readPage, tellAskers } from "./wire";

type Seg = "all" | "missed" | "late" | "answered";
type When = "30" | "7" | "all";
const MISSED = ["missed", "partly", "wrong", "passed_on"];

export interface Group { first: Question; all: Question[] }

export function groupsOf(d: Data): Group[] {
  return d.questions.filter((q) => !q.same_as && !q.walk_step).map((first) => ({ first, all: [first, ...(d.repeats.get(first.id) || [])] }));
}

function bucket(g: Group): "missed" | "late" | "answered" {
  const q = g.first;
  if (q.state === "saved" || q.state === "covered") return q.outcome === "late" ? "late" : "answered";
  if (MISSED.includes(q.outcome)) return "missed";
  return q.outcome === "late" ? "late" : "answered";
}

export function usePageText(path: string | null | undefined): { text: string | null; failed: boolean } {
  const [state, setState] = useState<{ text: string | null; failed: boolean }>({ text: null, failed: false });
  useEffect(() => {
    let live = true;
    setState({ text: null, failed: false });
    if (!path) return;
    readPage(path).then((t) => live && setState({ text: t, failed: false })).catch(() => live && setState({ text: "", failed: true }));
    return () => { live = false; };
  }, [path]);
  return state;
}

export function Answers({ openId, query }: { openId: string | null; query: string }) {
  const d = useKnowhow();
  const now = nowMs(d.questions);
  const [seg, setSeg] = useState<Seg>("all");
  const [where, setWhere] = useState("all");
  const [when, setWhen] = useState<When>("30");
  const since = when === "all" ? 0 : now - Number(when) * 86_400_000;
  const groups = useMemo(() => groupsOf(d), [d]);
  const inRange = groups.filter((g) => (Date.parse(g.first.asked_at) || 0) >= since && (where === "all" || g.all.some((q) => q.where_source === where)));
  const needle = query.trim().toLowerCase();
  const matched = needle ? inRange.filter((g) => g.all.some((q) => q.text.toLowerCase().includes(needle)) || (d.articleBy.get(g.first.article_id || "")?.title || "").toLowerCase().includes(needle)) : inRange;
  const count = { missed: 0, late: 0, answered: 0 };
  for (const g of inRange) count[bucket(g)] += 1;
  const order = { missed: 0, late: 1, answered: 2 };
  const shown = matched.filter((g) => seg === "all" || bucket(g) === seg)
    .sort((a, b) => order[bucket(a)] - order[bucket(b)] || String(b.first.asked_at).localeCompare(String(a.first.asked_at)));
  const open = openId ? groups.find((g) => g.first.id === openId || g.all.some((q) => q.id === openId)) || null : null;

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".c-sheet")) return;
      const i = open ? shown.findIndex((g) => g.first.id === open.first.id) : -1;
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        const next = shown[Math.min(shown.length - 1, i + 1)];
        if (next) to.answers(next.first.id);
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        const prev = shown[Math.max(0, i - 1)];
        if (prev) to.answers(prev.first.id);
      } else if (e.key === "Escape" && open) {
        to.answers();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [shown, open]);

  const total = inRange.length;
  return (
    <main className={`kh-answers${open ? " has-open" : ""}`}>
      <div className="kh-list">
        <div className="kh-toolbar">
          <Segmented<Seg> label="Questions" value={seg} onChange={setSeg} items={[
            { id: "all", label: "All", count: total }, { id: "missed", label: "Missed", count: count.missed },
            { id: "late", label: "Past check date", count: count.late }, { id: "answered", label: "Answered", count: count.answered }]} />
          <span className="kh-filters">
            <select className="c-select" aria-label="Where" value={where} onChange={(e) => setWhere(e.target.value)}>
              <option value="all">Everywhere</option>
              {Object.entries(WHERE).filter(([k]) => k !== "app").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="c-select" aria-label="When" value={when} onChange={(e) => setWhen(e.target.value as When)}>
              <option value="30">Last 30 days</option><option value="7">Last 7 days</option><option value="all">All time</option>
            </select>
          </span>
        </div>
        <p className="kh-summary">
          <b>{plural(total, "question")}</b> in {when === "all" ? "all" : `the last ${when} days`} · {count.answered} answered from a checked page ·{" "}
          {count.late} from a page past its check date · {count.missed} missed
        </p>
        {!d.loaded ? <Skeleton kind="list" rows={8} /> : shown.length ? (
          <ul className="kh-qlist" role="list">
            {shown.map((g, i) => {
              const b = bucket(g);
              const head = i === 0 || bucket(shown[i - 1]) !== b;
              return (
                <li key={g.first.id}>
                  {head && seg === "all" ? <h3 className="kh-group">{b === "missed" ? "Missed" : b === "late" ? "Past check date" : "Answered"}<span className="c-faint num">{count[b]}</span></h3> : null}
                  <QRow g={g} d={d} now={now} open={open?.first.id === g.first.id} />
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty icon={MessageCircleQuestion} title={needle ? "Nothing matches" : "No questions here yet"}>
            {needle ? "Try other words." : "When people ask the Lemma in Teams, Slack, its mailbox or web chat, every question shows here with what answered it."}
          </Empty>
        )}
        <div className="kh-gaps">
          <Gap>Misses count only when the Lemma logs them: there's no signal when a run fails to answer. A daily sweep catches the rest.</Gap>
          <Gap>Teams channels are read only when the Lemma is asked there.</Gap>
          <Gap>IES files, spreadsheets, slides and images are never indexed; sheets get a table page.</Gap>
        </div>
      </div>
      {open ? <Detail g={open} /> : DEMO ? <aside className="kh-detail c-hide-sm"><WhereTheyAsk /></aside>
        : <aside className="kh-detail kh-detail--empty c-hide-sm"><Empty icon={MessageCircleQuestion} title="Pick a question">Its askings, what answered it, and what's next. <Kbd>J</Kbd> <Kbd>K</Kbd> move.</Empty></aside>}
    </main>
  );
}

function QRow({ g, d, now, open }: { g: Group; d: Data; now: number; open: boolean }) {
  const q = g.first;
  const a = d.articleBy.get(q.article_id || "") || null;
  const draft = d.articleBy.get(q.draft_article_id || "") || null;
  const b = bucket(g);
  const places = [...new Set(g.all.map((x) => x.where_source))];
  return (
    <button type="button" className={`kh-q${open ? " is-open" : ""}`} aria-current={open ? "true" : undefined} onClick={() => to.answers(q.id)}>
      <span className="kh-q__text">{q.text}</span>
      <span className="kh-q__from">
        {b === "missed" ? (
          <>
            <span className="kh-q__none">No answer yet</span>
            {draft ? <><span className="c-faint">·</span><Ai>Draft ready for {firstOf(draft.owner_name)}</Ai></>
              : q.next_note ? <><span className="c-faint">·</span><span className="c-muted">{q.next_note}</span></> : null}
          </>
        ) : a ? (
          <><FileText aria-hidden="true" /><span className="c-ellipsis">{a.title}</span>{b === "late" ? <Pill tone="warning">Past check date</Pill> : null}</>
        ) : <span className="c-muted">{q.state === "covered" ? "Covered by another page" : "Answered"}</span>}
      </span>
      <span className="kh-q__meta">
        {g.all.length > 1 ? <span className="kh-times num">Asked {g.all.length}×</span> : null}
        {places.slice(0, 3).map((p) => <WhereChip key={p} where={p} />)}
        <span className="c-faint">{ago(q.asked_at, now)}</span>
        {q.sensitive ? <span className="kh-hidden">Name not kept</span> : null}
      </span>
    </button>
  );
}

function Detail({ g }: { g: Group }) {
  const d = useKnowhow();
  const { me } = useWho();
  const toast = useToast();
  const now = nowMs(d.questions);
  const q = g.first;
  const a = d.articleBy.get(q.article_id || "") || null;
  const draft = d.articleBy.get(q.draft_article_id || "") || null;
  const topic = d.topicBy.get(q.topic_id || draft?.topic_id || a?.topic_id || "") || null;
  const owner = draft?.owner_name || topic?.owner_name || a?.owner_name || null;
  const ownerId = draft?.owner_member_id || topic?.owner_member_id || a?.owner_member_id || null;
  const b = bucket(g);
  const ids = g.all.map((x) => x.id);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(false);
  const [covering, setCovering] = useState(false);
  const draftText = usePageText(draft?.path);
  const events = g.all.flatMap((x) => d.eventsBy.get(x.id) || []).sort((x, y) => String(x.at).localeCompare(String(y.at)));

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const said = await fn();
      if (said) toast(said);
      refreshMine();
      await d.reload();
    } catch (e) {
      toast(`Couldn't do that: ${e instanceof Error ? e.message : "try again"}`);
    } finally {
      setBusy("");
    }
  };
  const save = (body?: string) => run("save", async () => {
    if (!draft) return "There's no draft yet.";
    const out = await decide("save", { article_id: draft.id, question_ids: ids, ...(body ? { body_md: body } : {}) });
    if (out.ok === false) return out.message;
    const told = await tellAskers(draft.title, out.tell_members || [], [], me?.name || "Someone");
    const hidden = out.tell_hidden ? ` ${plural(out.tell_hidden, "person")} on a sensitive topic will be told by their own Lemma.` : "";
    const customers = (out.tell_contacts || []).length;
    return out.message && !told.told && !out.tell_hidden && !customers ? out.message
      : `Saved ${draft.title}.${told.told ? ` Told ${plural(told.told, "person", "people")} who asked, in their own Lemma channel.` : ""}${hidden}${customers ? ` ${plural(customers, "customer")} hear once it's approved for customers.` : ""}`;
  });
  const askOwner = () => run("ask", async () => {
    const out = await decide("ask_owner", { question_ids: [q.id] });
    if (out.owner_member_id) await notify(out.owner_member_id, `${g.all.length > 1 ? `${g.all.length} people asked` : "Someone asked"}: “${q.text}”. No page answers it yet. Reply here or in Know-how and your reply becomes the answer.`);
    return out.message;
  });
  const writeIt = () => run("write", async () => {
    const out = await call("knowhow_draft", { question_ids: [q.id] });
    return out.message || "Drafting it.";
  });

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".c-sheet") || busy) return;
      const k = e.key.toLowerCase();
      if (k === "w" && b === "missed" && !draft) { e.preventDefault(); void writeIt(); }
      else if (k === "o" && b === "missed") { e.preventDefault(); void askOwner(); }
      else if (k === "c" && b === "missed") { e.preventDefault(); setCovering(true); }
      else if (k === "s" && b === "missed") { e.preventDefault(); void run("aside", async () => (await decide("set_aside", { question_ids: [q.id] })).message); }
      else if (e.key === "Enter" && draft) { e.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  return (
    <aside className="kh-detail" aria-label="Question">
      <div className="kh-detail__top">
        <button type="button" className="kh-back" onClick={() => to.answers()}><ArrowLeft aria-hidden="true" />All questions</button>
        <OutcomePill outcome={b === "late" ? "late" : b === "answered" ? "answered" : q.outcome} />
      </div>
      <h2 className="kh-detail__q">{q.text}</h2>
      <p className="kh-detail__sub">
        {topic ? <>{topic.name}</> : <>No topic yet</>}{owner ? <> · owned by {owner}</> : null}
        {g.all.length > 1 ? <> · asked {g.all.length} times</> : null}
      </p>
      <section className="kh-askings" aria-label="Every way it was asked">
        {g.all.map((x) => (
          <div key={x.id} className="kh-asking">
            <span className="kh-asking__who">{x.sensitive ? <span className="kh-hidden">Name not kept</span> : x.asked_by_name || "Someone"}</span>
            <WhereChip where={x.where_source} place={x.where_place} />
            <span className="c-faint">{ago(x.asked_at, now)}</span>
            {x.id !== q.id ? <span className="kh-asking__words">“{x.text}”</span> : null}
          </div>
        ))}
      </section>

      {b === "missed" && draft ? (
        <section className="kh-block kh-block--draft">
          <h3><Sparkles aria-hidden="true" />A draft from {firstOf(draft.quote_who || owner)}'s {draft.source === "reply" ? "reply" : "notes"}<Ai /></h3>
          {draft.quote ? <blockquote className="kh-quote">“{draft.quote}”<span className="kh-quote__by">{draft.quote_who}{draft.quote_where ? ` · ${draft.quote_where}` : ""}</span></blockquote> : null}
          <div className="kh-draft">
            <div className="kh-draft__title">{draft.title}</div>
            {draftText.text == null ? <Skeleton kind="list" rows={3} /> : <Page text={draftText.text} />}
            {draft.missing.length ? <p className="kh-missing">{draft.missing.map((m) => <span key={m}>[ask {firstOf(owner)}: {m}]</span>)}</p> : null}
          </div>
          <p className="kh-saves">Saves as a page in <b>{topic?.name || "General"}</b> · Seen by <b>{AUDIENCE[draft.audience] || "The team"}</b></p>
          <div className="kh-actions">
            <Button variant="primary" icon={Check} busy={busy === "save"} onClick={() => void save()}>Save as answer <Kbd>↵</Kbd></Button>
            <Button onClick={() => setEditing(true)}>Edit draft</Button>
            <Button onClick={() => setCovering(true)}>Covered by… <Kbd>C</Kbd></Button>
            <Button variant="ghost" busy={busy === "aside"} onClick={() => void run("aside", async () => (await decide("set_aside", { question_ids: [q.id] })).message)}>Set aside</Button>
          </div>
          <p className="kh-foot">
            Saving tells the {plural(g.all.filter((x) => x.asked_by_kind === "member" || x.sensitive).length, "person", "people")} who asked, where they asked.
            {g.all.some((x) => x.asked_by_kind === "contact") ? ` Customers get it only once ${firstOf(owner)} approves it for customers.` : ""}
          </p>
        </section>
      ) : b === "missed" && q.found.length ? (
        <section className="kh-block">
          <h3><Sparkles aria-hidden="true" />What the Lemma found<Ai /></h3>
          {q.found.map((f) => (
            <blockquote key={f.path} className="kh-quote">“{f.text}”<span className="kh-quote__by">{f.path.split("/").pop()}{f.page ? ` · page ${f.page}` : ""}</span></blockquote>
          ))}
          {q.next_note === "Files can't be read" ? <Gap>That file can't be searched, so the Lemma can't answer from it.</Gap> : null}
          <div className="kh-actions">
            <Button variant="primary" icon={Sparkles} busy={busy === "write"} onClick={() => void writeIt()}>Draft it for {firstOf(owner)} <Kbd>W</Kbd></Button>
            <Button icon={Send} busy={busy === "ask"} onClick={() => void askOwner()}>Ask {firstOf(owner)} <Kbd>O</Kbd></Button>
            <Button onClick={() => setCovering(true)}>Covered by…</Button>
            <Button variant="ghost" onClick={() => void run("aside", async () => (await decide("set_aside", { question_ids: [q.id] })).message)}>Set aside</Button>
          </div>
          <p className="kh-foot">The draft goes to {owner || "the owner"} to fix and confirm. Nothing is said to anyone until they save it.</p>
        </section>
      ) : b === "missed" ? (
        <section className="kh-block">
          <h3>Nothing in the pages answers this</h3>
          <p className="c-muted">{q.state === "asked" ? `${owner || "The owner"} has been asked. Their reply comes back here as a draft.` : "Ask the topic's owner: their reply comes back as a draft they save in one step."}</p>
          <div className="kh-actions">
            <Button variant="primary" icon={Send} busy={busy === "ask"} onClick={() => void askOwner()}>{q.state === "asked" ? `Ask ${firstOf(owner)} again` : `Ask ${firstOf(owner)}`} <Kbd>O</Kbd></Button>
            <Button icon={Sparkles} busy={busy === "write"} onClick={() => void writeIt()}>Write it <Kbd>W</Kbd></Button>
            <Button onClick={() => setCovering(true)}>Covered by… <Kbd>C</Kbd></Button>
            <Button variant="ghost" onClick={() => void run("aside", async () => (await decide("set_aside", { question_ids: [q.id] })).message)}>Set aside <Kbd>S</Kbd></Button>
          </div>
        </section>
      ) : a ? (
        <Answered a={a} late={b === "late"} now={now} ownerId={ownerId} />
      ) : null}

      <section className="kh-activity" aria-label="Activity">
        <h3>Activity</h3>
        {events.length ? (
          <ol className="kh-log">
            {events.map((e) => (
              <li key={e.id}><span className="kh-log__dot" aria-hidden="true" /><span className="kh-log__text">{inline(e.text)}</span><span className="c-faint">{ago(e.at, now)}</span></li>
            ))}
          </ol>
        ) : <p className="c-faint">Nothing yet.</p>}
      </section>
      <EditDraft open={editing} onClose={() => setEditing(false)} draft={draft} text={draftText.text || ""} onSave={(body) => { setEditing(false); void save(body); }} />
      <CoveredBy open={covering} onClose={() => setCovering(false)} onPick={(target) => { setCovering(false); void run("cover", async () => {
        const out = await decide("covered_by", { question_ids: [q.id], target_article_id: target.id });
        if (out.tell_members?.length) await tellAskers(target.title, out.tell_members, [], me?.name || "Someone");
        return out.message;
      }); }} />
    </aside>
  );
}

function Answered({ a, late, now, ownerId }: { a: Article; late: boolean; now: number; ownerId: string | null }) {
  const d = useKnowhow();
  const toast = useToast();
  const text = usePageText(a.path);
  const [busy, setBusy] = useState(false);
  return (
    <section className={`kh-block${late ? " kh-block--late" : ""}`}>
      <h3><BookOpen aria-hidden="true" />Answered from <button type="button" className="kh-link" onClick={() => to.page(a.id)}>{a.title}</button></h3>
      <div className="kh-excerpt">{text.text == null ? <Skeleton kind="list" rows={3} /> : <Page text={text.text} />}</div>
      <SourceLine a={a} now={now} />
      {late ? <p className="kh-warn">The team got it with a warning: “Past its check date (due {fmtDay(a.due_on)}). I've asked {firstOf(a.owner_name)} to look.” Customers don't get it until it's checked.</p> : null}
      <div className="kh-actions">
        {late ? <Button variant="primary" icon={UserRound} busy={busy} onClick={() => void (async () => {
          setBusy(true);
          const out = await decide("ask_check", { article_id: a.id });
          if (ownerId) await notify(ownerId, `“${a.title}” is past its check date and people are still asking about it. Open it in Know-how and press Keep if it's still right.`);
          toast(out.message || "Asked.");
          setBusy(false);
          await d.reload();
        })()}>Ask {firstOf(a.owner_name)} to check</Button> : null}
        <Button icon={Link2} onClick={() => to.page(a.id)}>Open the page</Button>
      </div>
    </section>
  );
}

function EditDraft({ open, onClose, draft, text, onSave }: { open: boolean; onClose: () => void; draft: Article | null; text: string; onSave: (body: string) => void }) {
  const [body, setBody] = useState(text);
  useEffect(() => { if (open) setBody(text); }, [open, text]);
  return (
    <Sheet open={open} title={draft ? `Edit: ${draft.title}` : "Edit"} onClose={onClose}
      footer={<><Button variant="primary" icon={CornerDownLeft} onClick={() => onSave(body)}>Save as answer</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <p className="c-muted kh-hint">Markdown. A procedure's steps are <code>### 1. Title</code> headings, with an optional first line <code>Who: Warehouse</code>.</p>
      <textarea className="c-textarea kh-editor" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Page text" />
    </Sheet>
  );
}

export function CoveredBy({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (a: Article) => void }) {
  const d = useKnowhow();
  const [q, setQ] = useState("");
  const list = d.articles.filter((a) => ["live", "due", "may_disagree"].includes(a.state) && (!q || a.title.toLowerCase().includes(q.toLowerCase()) || a.asks.some((x) => x.toLowerCase().includes(q.toLowerCase()))));
  return (
    <Sheet open={open} title="Covered by which page?" onClose={onClose}>
      <input className="c-input" placeholder="Find a page" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="kh-picklist">
        {list.slice(0, 40).map((a) => (
          <li key={a.id}><button type="button" onClick={() => onPick(a)}><FileText aria-hidden="true" /><span className="c-grow c-ellipsis">{a.title}</span><span className="c-faint">{d.topicBy.get(a.topic_id || "")?.name}</span></button></li>
        ))}
      </ul>
      <p className="c-faint kh-hint">The question's words join that page's other ways to ask, so the Lemma finds it next time.</p>
    </Sheet>
  );
}
