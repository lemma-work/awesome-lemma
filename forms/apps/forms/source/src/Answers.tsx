// Answers (A), the home screen: every answer in one queue. The strip says
// the week's honest numbers; Not sure sits first, then waiting answers by
// the clock (the only colour, and only past the goal), then replied or
// filed, then set aside with why. A row opens a side pane on a wide screen
// and the answer's page on a phone.
//   J K move    Enter open    N not sure    S set aside    U put back    R re-route    / search

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, CircleHelp, FileInput, Trash2 } from "lucide-react";
import { Button, Empty, Kbd, Segmented, cx } from "@lemma-plugins/kit";
import { AnswerPane } from "./Answer";
import { RerouteMenu, useActions } from "./actions";
import { isOpen, median, minutes, nowMs, ownerName, replyMinutes, segmentOf, useForms, useWho, type Data, type Segment } from "./data";
import { busyKey } from "./keys";
import { Ai, Chip, Clock, KIND_WORDS, NoOne, ROUTED_WORDS, SOURCE_WORDS, Who, firstOf } from "./marks";
import { to } from "./route";
import type { Answer, Kind } from "./types";

function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 900px)").matches);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

const WEEK = 7 * 86_400_000;
const t = (s: string | null | undefined) => Date.parse(s || "") || 0;

function matches(d: Data, a: Answer, q: string): boolean {
  const f = d.formsById.get(a.form_id);
  const hay = `${a.name || ""} ${a.handle || ""} ${a.company_name || ""} ${a.message || ""} ${f?.name || ""} ${a.owner_name || ""} ${a.kind || ""}
    ${a.fields.map((x) => String(x.value ?? "")).join(" ")}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** The week's numbers, said honestly: what came in, who has it, and the median first reply. */
export function useWeek(d: Data, now: number) {
  return useMemo(() => {
    const week = d.answers.filter((a) => now - t(a.received_at) < WEEK);
    const doors = new Set(week.map((a) => a.form_id)).size;
    const aside = week.filter((a) => a.state === "set_aside").length;
    const replies = week.map(replyMinutes).filter((m): m is number => m != null);
    return { total: week.length, doors, aside, withSomeone: week.length - aside, median: median(replies), replies: replies.length };
  }, [d.answers, now]);
}

export function Answers({ seg, query }: { seg: Segment; query: string }) {
  const d = useForms();
  const { members } = useWho();
  const now = nowMs(d);
  const wide = useWide();
  const goal = d.settings?.goal_minutes || 60;
  const x = useActions();
  const week = useWeek(d, now);
  const [door, setDoor] = useState("");
  const [kind, setKind] = useState("");
  const [owner, setOwner] = useState("");

  const counts = useMemo(() => {
    const c = { waiting: 0, unsure: 0, done: 0, aside: 0, all: d.answers.length };
    for (const a of d.answers) c[segmentOf(a)] += 1;
    return c;
  }, [d.answers]);

  const filtered = useMemo(() => d.answers.filter((a) => (!door || a.form_id === door) && (!kind || (kind === "unsure" ? !a.kind : a.kind === kind))
    && (!owner || (owner === "none" ? !a.owner_user_id && !a.owner_name : (a.owner_user_id || a.owner_name) === owner))), [d.answers, door, kind, owner]);

  const sections = useMemo(() => {
    const byClock = (a: Answer, b: Answer) => t(a.received_at) - t(b.received_at);
    const newest = (a: Answer, b: Answer) => t(b.received_at) - t(a.received_at);
    if (query.trim()) return [{ key: "search", title: "Search", note: "", rows: filtered.filter((a) => matches(d, a, query)).sort(newest) }];
    const unsure = filtered.filter((a) => a.state === "unsure").sort(byClock);
    const waiting = filtered.filter((a) => isOpen(a) && a.state !== "unsure").sort(byClock);
    const done = filtered.filter((a) => a.state === "replied" || a.state === "filed").sort(newest);
    const aside = filtered.filter((a) => a.state === "set_aside").sort(newest);
    const S = {
      unsure: { key: "unsure", title: "Not sure where this goes", note: "pick a kind or an owner; each pick teaches the next read", rows: unsure },
      waiting: { key: "waiting", title: "Waiting for a reply", note: "longest first", rows: waiting },
      done: { key: "done", title: "Replied or filed", note: "", rows: done },
      aside: { key: "aside", title: "Set aside as spam", note: "never deleted; U puts one back", rows: aside },
    };
    if (seg === "unsure") return [S.unsure];
    if (seg === "done") return [S.done];
    if (seg === "aside") return [S.aside];
    if (seg === "all") return [S.unsure, S.waiting, S.done, S.aside].filter((s) => s.rows.length);
    return [S.unsure, S.waiting].filter((s, i) => i === 1 || s.rows.length);
  }, [d, filtered, seg, query]);
  const flat = sections.flatMap((s) => s.rows);
  const [selected, setSelected] = useState<string | null>(null);
  const sel = flat.find((a) => a.id === selected) || flat[0] || null;
  const flatRef = useRef(flat);
  flatRef.current = flat;
  const selRef = useRef(sel);
  selRef.current = sel;
  const xRef = useRef(x);
  xRef.current = x;
  const wideRef = useRef(wide);
  wideRef.current = wide;

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (busyKey(e)) return;
      const list = flatRef.current;
      const cur = selRef.current;
      const at = list.findIndex((a) => a.id === cur?.id);
      const move = (step: number) => {
        e.preventDefault();
        const next = list[Math.max(0, Math.min(list.length - 1, at < 0 ? 0 : at + step))];
        if (next) {
          setSelected(next.id);
          document.querySelector(`[data-answer="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
        }
      };
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") move(1);
      else if (k === "k" || e.key === "ArrowUp") move(-1);
      else if (e.key === "Enter" && cur) { e.preventDefault(); to.answer(cur.id); }
      else if (!cur) return;
      else if (k === "s") { e.preventDefault(); void xRef.current.setAside(cur); }
      else if (k === "u") { e.preventDefault(); void xRef.current.putBack(cur); }
      else if (k === "n") { e.preventDefault(); void xRef.current.notSure(cur); }
      else if (k === "r") {
        e.preventDefault();
        (document.querySelector(".fm-pane .fm-reroute .c-btn, .fm-reroute .c-btn") as HTMLButtonElement | null)?.click();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const owners = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of d.answers) {
      const key = a.owner_user_id || a.owner_name;
      if (key) m.set(key, ownerName(d, members, a) || a.owner_name || "a member");
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [d, members]);

  const items = [
    { id: "waiting" as Segment, label: "Waiting", count: counts.waiting }, { id: "unsure" as Segment, label: "Not sure", count: counts.unsure },
    { id: "done" as Segment, label: "Done", count: counts.done }, { id: "aside" as Segment, label: "Set aside", count: counts.aside },
    { id: "all" as Segment, label: "All", count: counts.all },
  ];
  const late = week.median != null && week.median > goal;

  return (
    <>
      <div className="fm-strip">
        <p className="fm-strip__line">
          <b className="fm-num">{week.total}</b> answers this week from <b className="fm-num">{week.doors}</b> {week.doors === 1 ? "door" : "doors"}
          <span className="fm-sep">·</span><b className="fm-num">{week.withSomeone}</b> are with someone
          {week.aside ? <><span className="fm-sep">·</span><b className="fm-num">{week.aside}</b> set aside as spam</> : null}
        </p>
        <p className="fm-strip__line">
          First reply: {week.median != null ? <b className={cx("fm-num", late && "fm-late")}>{minutes(week.median)}</b> : <b>no replies yet</b>}
          <span className="fm-muted"> median this week{week.replies ? ` (${week.replies} ${week.replies === 1 ? "reply" : "replies"})` : ""}, goal {minutes(goal)}</span>
        </p>
        <p className="fm-strip__line fm-muted">No reply goes out on its own: a person sends every one</p>
      </div>
      <div className="fm-bar">
        <Segmented label="Answers" value={query.trim() ? ("all" as Segment) : seg} onChange={(v) => to.answers(v)} items={items} />
        <span className="fm-filters">
          <select className="c-input fm-select" aria-label="Door" value={door} onChange={(e) => setDoor(e.target.value)}>
            <option value="">Any door</option>
            {d.forms.filter((f) => d.answersBy.get(f.id)?.length).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select className="c-input fm-select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Any kind</option>
            <option value="unsure">Not sure</option>
            {(Object.keys(KIND_WORDS) as Kind[]).map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
          </select>
          <select className="c-input fm-select" aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Anyone</option>
            {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            <option value="none">Nobody</option>
          </select>
        </span>
        <span className="fm-keys" aria-hidden="true"><Kbd>J</Kbd><Kbd>K</Kbd> move <Kbd>N</Kbd> not sure <Kbd>S</Kbd> spam <Kbd>U</Kbd> put back <Kbd>R</Kbd> re-route</span>
      </div>
      {!flat.length ? (
        <main className="c-body">
          {d.answers.length ? (
            <Empty icon={FileInput} title={seg === "unsure" ? "Nothing waits for a pick" : seg === "aside" ? "Nothing set aside" : "Nothing waiting"}>
              {seg === "waiting" ? "Every answer has had its reply. New ones land here, with the reply drafted for whoever gets it." : "Nothing here right now."}
            </Empty>
          ) : (
            <Empty icon={FileInput} title="No answers yet" action={<Button onClick={() => to.doors()}>See your doors</Button>}>
              When someone fills in one of your forms, their answer lands here, read and sent to whoever should reply.
            </Empty>
          )}
        </main>
      ) : (
        <div className="fm-split">
          <section className="fm-list" aria-label="Answers">
            <div className="fm-lh" aria-hidden="true">
              <span>Waiting</span><span>Who, and what they wrote</span><span>Door</span><span>The Lemma's read</span><span>Went to</span>
            </div>
            {sections.map((s) => (
              <div key={s.key}>
                <h2 className="fm-sec">{s.title}<span className="fm-sec__n">{s.rows.length}</span>{s.note ? <span className="fm-sec__note">{s.note}</span> : null}</h2>
                {s.rows.length ? s.rows.map((a) => (
                  <Row key={a.id} a={a} d={d} on={wide && sel?.id === a.id} now={now} goal={goal}
                    onPick={() => (wide ? setSelected(a.id) : to.answer(a.id))} />
                )) : <p className="fm-none">Nothing here.</p>}
              </div>
            ))}
            <p className="fm-phone-note">Swipe left to set an answer aside, right for not sure. Both are buttons on the answer too.</p>
          </section>
          {wide && sel ? <AnswerPane key={sel.id} a={sel} /> : null}
        </div>
      )}
    </>
  );
}

function Row({ a, d, on, now, goal, onPick }: { a: Answer; d: Data; on: boolean; now: number; goal: number; onPick: () => void }) {
  const { members, me } = useWho();
  const x = useActions();
  const f = d.formsById.get(a.form_id);
  const owner = ownerName(d, members, a);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [shift, setShift] = useState(0);
  const said = a.message || a.fields.find((v) => v.type !== "email" && v.key !== "name")?.value || "";
  return (
    <div
      className={cx("fm-row", on && "fm-row--on", a.state === "set_aside" && "fm-row--aside")}
      data-answer={a.id}
      style={shift ? { transform: `translateX(${shift}px)` } : undefined}
      onTouchStart={(e) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchMove={(e) => {
        if (!start.current) return;
        const dx = e.touches[0].clientX - start.current.x;
        if (Math.abs(dx) > Math.abs(e.touches[0].clientY - start.current.y)) setShift(Math.max(-90, Math.min(90, dx)));
      }}
      onTouchEnd={() => {
        if (shift <= -70) void x.setAside(a);
        else if (shift >= 70) void x.notSure(a);
        setShift(0);
        start.current = null;
      }}
    >
      <button type="button" className="fm-row__hit" aria-label={`${a.name || "An answer"}, ${f?.name || "a form"}`} onClick={onPick} />
      <span className="fm-row__clock"><Clock a={a} now={now} goal={goal} /></span>
      <span className="fm-row__main">
        <span className="fm-row__who">{a.name || a.handle || "Someone"}{a.company_name ? <span className="fm-faint"> · {a.company_name}</span> : null}</span>
        <span className="fm-row__said">{String(said)}</span>
      </span>
      <span className="fm-row__door"><Chip>{f?.name || "A form"}</Chip><span className="fm-faint fm-small">{SOURCE_WORDS[a.source] || a.source}</span></span>
      <span className="fm-row__read">
        {a.state === "set_aside" ? (
          <><span className="fm-readk"><Trash2 aria-hidden="true" />Set aside</span><span className="fm-faint fm-small fm-ellipsis">{a.set_aside_why}</span></>
        ) : a.kind ? (
          <><span className="fm-readk">{KIND_WORDS[a.kind]}{a.kind_by === "lemma" ? <Ai /> : null}</span><span className="fm-faint fm-small fm-ellipsis">{a.kind_why}</span></>
        ) : (
          <><span className="fm-readk fm-unsure"><CircleHelp aria-hidden="true" />Not sure</span><span className="fm-faint fm-small fm-ellipsis">{a.kind_why || "waits for a pick"}</span></>
        )}
      </span>
      <span className="fm-row__own">
        {a.state === "set_aside" ? <NoOne /> : owner ? <Who name={owner} you={a.owner_user_id === me?.id} /> : <NoOne />}
        <span className="fm-row__ownt">
          <span className="fm-ellipsis">{a.state === "set_aside" ? "Nobody" : owner ? (a.owner_user_id === me?.id ? `${firstOf(owner)} (you)` : owner) : "Nobody yet"}</span>
          <span className="fm-faint fm-small fm-ellipsis">{a.work_label ? `${ROUTED_WORDS[a.routed_to || ""] || ""} ${a.work_label}`.trim() : a.routed_to && a.routed_to !== "forms" ? ROUTED_WORDS[a.routed_to] : a.state === "drafted" ? "Reply drafted" : ""}</span>
        </span>
      </span>
      <span className="fm-row__phone">{[a.kind ? KIND_WORDS[a.kind] : "Not sure", f?.name, a.state === "set_aside" ? "set aside" : owner ? firstOf(owner) : null].filter(Boolean).join(" · ")}</span>
      <button type="button" className="fm-row__go" aria-label="Open the answer" onClick={() => to.answer(a.id)}><ChevronRight aria-hidden="true" /></button>
    </div>
  );
}

export { RerouteMenu };
