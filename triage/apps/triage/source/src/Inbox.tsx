// The inbox (A): the list sorted by reach, each row with its figure and
// unit, its doors, a suggested owner with the reason, and its age; the
// selected item beside it, decided with one key. Below 900px the list alone,
// and a row opens the case file.
//   J K move    Enter open    1 accept    2 decline    3 duplicate
//   H snooze    G give to an agent    A owner    C new report    / search

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Copy, Inbox as InboxIcon, Sparkles } from "lucide-react";
import { Button, Empty, Kbd, Pill, cx, openApp, runFunction } from "@lemma-plugins/kit";
import { DecisionButtons, afterLine, useDecide } from "./Decide";
import { nowMs, useTriage, type Data } from "./data";
import { typing } from "./keys";
import { Ai, Chip, EvidencePill, Gap, NoOne, Reach, Who, age, doorChips, doorWord, itemPills, metaLine, num, statePill, whenShort } from "./marks";
import { to, type View } from "./route";
import type { Item } from "./types";

function matches(d: Data, it: Item, q: string): boolean {
  const reps = d.reportsBy.get(it.id) || [];
  const hay = `T-${it.number} ${it.title} ${it.owner_name || ""} ${it.paths.join(" ")} ${reps.map((r) => `${r.quote || ""} ${r.reporter_name || ""}`).join(" ")}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

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

export function Inbox({ view, query, onNew }: { view: View; query: string; onNew: () => void }) {
  const d = useTriage();
  const now = nowMs(d);
  const wide = useWide();
  const sections = useMemo(() => {
    if (query.trim()) return [{ key: "search", title: "Search", note: "", rows: d.items.filter((i) => matches(d, i, query)) }];
    if (view === "accepted") return [{ key: "accepted", title: "Accepted", note: "team tasks in Tasks; done when their task is", rows: d.accepted }];
    if (view === "down") return [{ key: "down", title: "Marked down", note: "set aside, each with why; it comes back if it changes", rows: d.down }];
    if (view === "declined") return [{ key: "declined", title: "Declined and duplicates", note: "", rows: d.declined }];
    const out = [{ key: "inbox", title: "Needs a decision", note: "sorted by people reached, then security, then reports", rows: d.inbox }];
    if (d.down.length) out.push({ key: "down", title: "Marked down", note: "the Lemma set these aside; each comes back if it changes", rows: d.down });
    if (d.snoozed.length) out.push({ key: "snoozed", title: "Snoozed", note: "back on their own when the time comes, or sooner if they get worse", rows: d.snoozed });
    return out;
  }, [d, view, query]);
  const flat = sections.flatMap((s) => s.rows);
  const [selected, setSelected] = useState<string | null>(null);
  const sel = flat.find((i) => i.id === selected) || flat[0] || null;
  const flatRef = useRef(flat);
  flatRef.current = flat;
  const selRef = useRef(sel);
  selRef.current = sel;

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".c-sheet")) return;
      const list = flatRef.current;
      const at = list.findIndex((i) => i.id === selRef.current?.id);
      const move = (step: number) => {
        e.preventDefault();
        const next = list[Math.max(0, Math.min(list.length - 1, at < 0 ? 0 : at + step))];
        if (next) {
          setSelected(next.id);
          document.querySelector(`[data-item="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
        }
      };
      if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") move(1);
      else if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") move(-1);
      else if (e.key === "Enter" && selRef.current) { e.preventDefault(); to.item(selRef.current.number); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const x = useDecide(wide ? sel : null, { keys: wide && !!sel });

  if (!flat.length) {
    return (
      <main className="c-body">
        {query.trim() ? <Empty title="Nothing matches">Search looks at the number, title, owner, files and what people wrote.</Empty>
          : view === "inbox" ? (
            <Empty icon={InboxIcon} title="Nothing waiting for a decision" action={<Button variant="primary" onClick={onNew}>New report <Kbd>C</Kbd></Button>}>
              Reports arrive from every door you set up; ask the Lemma, or file one here.
            </Empty>
          ) : <Empty title={view === "accepted" ? "Nothing accepted yet" : view === "down" ? "Nothing marked down" : "Nothing declined"}>Decided items land here.</Empty>}
      </main>
    );
  }

  return (
    <div className="tr-split">
      <section className="tr-list" aria-label="Reports">
        <div className="tr-lh" aria-hidden="true"><span>Reach</span><span>Report</span><span>Suggested owner</span><span className="tr-r">Age</span></div>
        {sections.map((s) => (
          <div key={s.key}>
            <div className="tr-sec">{s.title}{s.note ? <span className="tr-sec__note">{s.note}</span> : null}</div>
            {s.rows.length ? s.rows.map((it) => (
              <Row key={it.id} it={it} d={d} now={now} on={wide && sel?.id === it.id} down={s.key === "down"}
                onPick={() => (wide ? setSelected(it.id) : to.item(it.number))} onOpen={() => to.item(it.number)} />
            )) : <p className="tr-none">Nothing here.</p>}
          </div>
        ))}
        <div className="tr-foot" aria-label="Keys">
          <span><Kbd>J</Kbd> <Kbd>K</Kbd> move</span><span><Kbd>1</Kbd> accept</span><span><Kbd>2</Kbd> decline</span>
          <span><Kbd>3</Kbd> duplicate</span><span><Kbd>H</Kbd> snooze</span><span><Kbd>A</Kbd> owner</span>
          <span><Kbd>G</Kbd> give to an agent</span><span><Kbd>C</Kbd> new report</span>
        </div>
        <p className="tr-phone-note">Tap a report to open it and decide. Owners and agents are picked there, the same as on a computer.</p>
      </section>
      {wide && sel ? <Pane it={sel} d={d} now={now} x={x} /> : null}
      {x.sheets}
    </div>
  );
}

function Row({ it, d, now, on, down, onPick, onOpen }: { it: Item; d: Data; now: number; on: boolean; down: boolean; onPick: () => void; onOpen: () => void }) {
  const reps = d.reportsBy.get(it.id) || [];
  const looks = it.looks_like ? d.byId.get(it.looks_like) : null;
  const task = d.tasksBy.get(it.id);
  return (
    <div className={cx("tr-row", on && "tr-row--on", down && "tr-row--down")} data-item={it.id}>
      <button type="button" className="tr-row__hit" onClick={onPick} onDoubleClick={onOpen} aria-label={`T-${it.number} ${it.title}`} />
      <Reach item={it} reports={reps} />
      <span className="tr-row__main">
        <span className="tr-row__title"><span className="tr-tag">T-{it.number}</span>{it.title}</span>
        <span className="tr-row__meta">
          {doorChips(it, reps).map((c) => <Chip key={c}>{c}</Chip>)}
          {looks ? <Pill tone="info">Looks like T-{looks.number}</Pill> : null}
          {task ? <span className="tr-faint">task #{task.number} · {task.status.replace("_", " ")}</span> : null}
          <span className="tr-ellipsis">{metaLine(it)}</span>
        </span>
      </span>
      <span className="tr-row__own">
        {down ? <span className="tr-faint tr-small">{it.marked_down_reason}</span> : it.state === "declined" ? <span className="tr-faint tr-small">{it.decline_reason}</span> : (
          <>
            {it.owner_name ? <Who name={it.owner_name} /> : <NoOne />}
            <span className="tr-row__ownt">
              <span className="tr-ellipsis">{it.owner_name || "Nobody yet"}</span>
              <span className="tr-faint tr-small tr-ellipsis">{it.owner_reason}</span>
            </span>
          </>
        )}
      </span>
      <span className="tr-row__age">{age(it.first_seen || it.created_at, now)}</span>
      <button type="button" className="tr-row__go" onClick={onOpen} aria-label={`Open T-${it.number}`}><ChevronRight aria-hidden="true" /></button>
    </div>
  );
}

export function facts(it: Item, d: Data): string[] {
  const out: string[] = [];
  const sec = it.security;
  if (sec && (sec.alert_number || sec.package || sec.rule)) {
    const reps = d.reportsBy.get(it.id) || [];
    const kind = reps[0] ? doorWord(reps[0]) : "Alert";
    out.push(`${kind} alert #${sec.alert_number ?? "?"} · ${sec.severity || "unknown"}`);
    if (sec.relationship || sec.scope) out.push([sec.relationship === "direct" ? "Direct dependency" : sec.relationship === "transitive" ? "Transitive" : null, sec.scope].filter(Boolean).join(", "));
    if (sec.rule && sec.tool) out.push(`${sec.tool} ${sec.rule}`);
    if (sec.reachable) out.push("GitHub says reachable");
    if (it.repo) out.push(it.repo);
    return out;
  }
  if (it.reach_people != null) out.push(`${num(it.reach_people)} ${it.reach_people === 1 ? "person" : "people"}`);
  if (it.reach_companies) out.push(`${num(it.reach_companies)} ${it.reach_companies === 1 ? "company" : "companies"}`);
  if (it.reach_events != null) out.push(`${num(it.reach_events)} events`);
  if (it.reach_asks && it.reach_people != null) out.push(`${it.reach_asks} asked`);
  if (it.reach_asks && it.reach_people == null) out.push(`${it.reach_asks} ${it.reach_asks === 1 ? "person" : "people"} asked`);
  if (it.first_seen) out.push(`First seen ${new Date(it.first_seen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`);
  if (it.repo) out.push(it.repo);
  return out;
}

function Pane({ it, d, now, x }: { it: Item; d: Data; now: number; x: ReturnType<typeof useDecide> }) {
  const reps = d.reportsBy.get(it.id) || [];
  const looks = it.looks_like ? d.byId.get(it.looks_like) : null;
  const places = new Set(reps.map((r) => doorWord(r))).size;
  const ownerGap = it.owner_rule === "last_change";
  const task = d.tasksBy.get(it.id);
  return (
    <section className="tr-pane" aria-label="Selected report">
      <div className="tr-pane__head">
        <div className="tr-pills">
          {itemPills(it, null, now).map((p) => <Pill key={p.text} tone={p.tone}>{p.text}</Pill>)}
        </div>
        <button type="button" className="tr-pane__title" onClick={() => to.item(it.number)}><span className="tr-tag">T-{it.number}</span>{it.title}</button>
        <div className="tr-facts">{facts(it, d).map((f) => <span key={f}>{f}</span>)}</div>
      </div>

      <div>
        <div className="tr-lab">Reports<span className="tr-faint">{reps.length > 1 ? `${reps.length} reports from ${places} ${places === 1 ? "place" : "places"}, merged into one` : "1 report"}</span></div>
        {reps.slice(0, 6).map((r) => (
          <div key={r.id} className="tr-rep">
            <Chip>{doorWord(r)}</Chip>
            <div className="tr-rep__x">
              <div>{r.reporter_name || r.title}</div>
              <div className="tr-muted">{r.reporter_kind === "machine" ? r.title : `“${r.quote || r.title}”`}
                {[r.page, r.app_version, r.browser].filter(Boolean).length ? ` · ${[r.page, r.app_version, r.browser].filter(Boolean).join(" · ")}` : ""}
                {r.files.length ? " · screenshot" : ""}</div>
            </div>
            <span className="tr-faint tr-small">{whenShort(r.received_at, now)}</span>
          </div>
        ))}
      </div>

      {looks ? (
        <div className="tr-dup">
          <Copy aria-hidden="true" />
          <span>{it.looks_like_note || `Looks like T-${looks.number}: ${looks.title}`}</span>
          <span className="tr-fill" />
          <Button size="sm" onClick={() => x.setSheet("duplicate")}>Mark duplicate <Kbd>3</Kbd></Button>
        </div>
      ) : null}

      <div className="tr-read">
        <div className="tr-read__head"><Sparkles aria-hidden="true" />The Lemma's read<span className="tr-fill" /><Ai /></div>
        {it.summary ? <div>{it.summary}</div> : <ReadIt it={it} />}
      </div>

      {it.evidence.length ? (
        <div>
          <div className="tr-lab">What was checked<span className="tr-faint">and what wasn't</span></div>
          {it.evidence.map((e, i) => (
            <div key={i} className="tr-ev"><EvidencePill state={e.state} /><span className="tr-ev__src">{e.source}</span><span className="tr-muted">{e.answer}</span></div>
          ))}
        </div>
      ) : null}

      <div>
        <div className="tr-lab">Owner</div>
        <div className="tr-owner">
          {it.owner_name ? <Who name={it.owner_name} /> : <NoOne />}
          <span className="tr-strong">{it.owner_name || "Nobody yet"}</span>
          <span className="tr-muted tr-small">{it.owner_reason}</span>
        </div>
        {ownerGap ? <div className="tr-gapline"><Gap>Sentry's own suspect commit isn't reachable through its connector; this is the last change to the line, read from GitHub</Gap></div> : null}
      </div>

      {task ? (
        <div className="tr-owner">
          <span className="tr-muted">Task</span>
          <button type="button" className="tr-link" onClick={() => void openApp("tasks", `/t/${task.id}`)}>#{task.number} {task.status.replace("_", " ")}</button>
          {statePill(it)}
        </div>
      ) : null}

      <DecisionButtons item={it} x={x} />
      <div className="tr-muted tr-small">{afterLine(d, it)}</div>
      {it.doors.includes("sentry") || it.doors.includes("posthog") ? <div><Gap>Sentry and PostHog have no trigger; their numbers are up to 15 minutes old</Gap></div> : null}
    </section>
  );
}

export function ReadIt({ it }: { it: Item }) {
  const d = useTriage();
  const [busy, setBusy] = useState(false);
  if (it.read_state === "reading") return <div className="tr-muted"><Sparkles size={13} aria-hidden="true" /> Reading it now: the reports, and every source this Lemma has.</div>;
  return (
    <div className="tr-row-inline">
      <span className="tr-muted">{it.read_state === "failed" ? "The last read didn't finish." : "Not read yet: it reads on its own from 25 people or a high security alert."}</span>
      <Button size="sm" icon={Sparkles} busy={busy} onClick={async () => {
        setBusy(true);
        try {
          await runFunction("triage_read", { item: it.id });
          await d.reload();
        } finally {
          setBusy(false);
        }
      }}>Read it</Button>
    </div>
  );
}
