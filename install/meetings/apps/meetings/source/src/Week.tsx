// This week by day, each meeting with where its brief is; beside it the next
// meeting's headline and the promises meetings left open. And the two lists:
// meetings that are over (written up or waiting for notes), and the ones the
// read was not sure of.

import { useMemo } from "react";
import { ArrowRight, CalendarCheck, CircleHelp, FileText, Handshake, NotebookPen } from "lucide-react";
import { Button, Card, Empty, Evidence, plural, update } from "@lemma-plugins/kit";
import { useMeetings } from "./data";
import { Faces, KindPill, StatusPill, isOver, peopleLine, statusOf } from "./marks";
import { to } from "./route";
import { at, clock, dayKey, dayName, duration, minutesBetween, relDay, shortDay, weekDays } from "./time";
import type { Meeting, PromiseRow } from "./types";

export function MeetingRow({ m, showDay }: { m: Meeting; showDay?: boolean }) {
  const start = at(m.start_at);
  const s = statusOf(m);
  const quiet = s.quiet && !m.outside;
  return (
    <button type="button" className={`mt-row${quiet || m.status === "cancelled" ? " mt-row--quiet" : ""}`} onClick={() => to.meeting(m.id)}>
      <span className="mt-row__time num">
        {showDay && start ? <span className="mt-row__day">{shortDay(start)}</span> : null}
        {clock(start)}
        <small>{duration(minutesBetween(start, at(m.end_at)))}</small>
      </span>
      <span className="mt-row__main">
        <span className="mt-row__title c-ellipsis">{m.title || "(no title)"}</span>
        <span className="mt-row__sub c-ellipsis">
          <Faces m={m} max={3} />
          {peopleLine(m)}
        </span>
        {m.headline && !isOver(m) && m.brief_state === "ready" ? <span className="mt-row__headline">{m.headline}</span> : null}
        {m.summary && isOver(m) ? <span className="mt-row__headline">{m.summary}</span> : null}
      </span>
      <span className="mt-row__marks">
        <span className="mt-hide-xs"><KindPill m={m} /></span>
        <StatusPill s={s} />
      </span>
    </button>
  );
}

export function Week({ offset }: { offset: number }) {
  const { meetings, loaded } = useMeetings();
  const now = new Date();
  const today = dayKey(now);
  const days = useMemo(() => weekDays(offset), [offset]);
  const byDay = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of meetings) {
      const s = at(m.start_at);
      if (!s || m.status === "cancelled") continue;
      const key = dayKey(s);
      map.set(key, [...(map.get(key) || []), m]);
    }
    return map;
  }, [meetings]);
  const inWeek = days.flatMap((d) => byDay.get(d.key) || []);
  const outside = inWeek.filter((m) => m.outside);
  const ready = inWeek.filter((m) => m.brief_state === "ready" && !isOver(m, now)).length;
  const coming = inWeek.filter((m) => m.wants_brief && !isOver(m, now) && m.brief_state !== "ready").length;

  return (
    <div className="c-split">
      <div className="c-stack mt-days">
        <p className="mt-weekline">
          <b>{plural(outside.length, "meeting")}</b> with people from outside
          {ready ? <> · <b>{ready}</b> {ready === 1 ? "brief" : "briefs"} ready</> : null}
          {coming ? <> · {coming} to come</> : null}
        </p>
        {loaded && !inWeek.length ? (
          <Card>
            <Empty icon={CalendarCheck} title="No meetings this week">
              Meetings with people from outside show here, each with its brief.
            </Empty>
          </Card>
        ) : null}
        {days.map(({ key, date }) => {
          const list = byDay.get(key) || [];
          const weekend = [5, 6].includes(days.findIndex((d) => d.key === key));
          if (!list.length && (weekend || !inWeek.length)) return null;
          return (
            <section key={key} className={`mt-day${key < today ? " mt-day--past" : ""}`} aria-label={dayName(date)}>
              <h2 className="mt-day__head">
                {dayName(date)}
                {key === today ? <span className="mt-today">Today</span> : null}
                <span className="c-count">{list.length || ""}</span>
              </h2>
              {list.length ? (
                <div className="c-card mt-rows">{list.map((m) => <MeetingRow key={m.id} m={m} />)}</div>
              ) : (
                <p className="mt-day__none">No meetings</p>
              )}
            </section>
          );
        })}
      </div>
      <aside className="c-stack mt-aside">
        <UpNext />
        <OpenPromises />
      </aside>
    </div>
  );
}

function UpNext() {
  const { meetings } = useMeetings();
  const now = new Date();
  const next = meetings.find((m) => m.status !== "cancelled" && m.wants_brief && !isOver(m, now) && (at(m.start_at)?.getTime() || 0) > now.getTime());
  if (!next) return null;
  const start = at(next.start_at);
  return (
    <Card title="Up next" icon={FileText} action={<Button size="sm" variant="ghost" icon={ArrowRight} label="Open" onClick={() => to.meeting(next.id)} />}>
      <button type="button" className="mt-next" onClick={() => to.meeting(next.id)}>
        <span className="mt-next__when num">{start ? relDay(start, now) : ""}</span>
        <span className="mt-next__title">{next.title}</span>
        <span className="mt-next__who">{peopleLine(next, 3)}</span>
        {next.brief_state === "ready" && next.headline ? (
          <span className="mt-next__headline">{next.headline}</span>
        ) : (
          <span className="mt-next__state"><StatusPill s={statusOf(next, now)} /></span>
        )}
      </button>
    </Card>
  );
}

export function useMeetingOf() {
  const { meetings } = useMeetings();
  return useMemo(() => new Map(meetings.map((m) => [m.source_id, m])), [meetings]);
}

export function PromiseItem({ p, meeting }: { p: PromiseRow; meeting?: Meeting }) {
  const due = at(p.due_at);
  const late = due && due.getTime() < Date.now() && p.state === "open";
  return (
    <div className={`c-owed__item${p.state === "done" ? " mt-done" : ""}`}>
      <div>{p.text}</div>
      <div className="mt-promise-meta">
        {p.person_name || p.person_handle}
        {due ? <span className={late ? "mt-late" : ""}> · {late ? "was due" : "by"} {shortDay(due)}</span> : null}
        {meeting ? <> · <button type="button" className="mt-link" onClick={() => to.meeting(meeting.id)}>{meeting.title}</button></> : null}
      </div>
      <Evidence quote={p.quote} />
    </div>
  );
}

function OpenPromises() {
  const { promises } = useMeetings();
  const meetingOf = useMeetingOf();
  const open = promises.filter((p) => p.state === "open");
  const mine = open.filter((p) => p.direction === "i_owe");
  const theirs = open.filter((p) => p.direction === "owed_to_me");
  return (
    <Card title="Promised in meetings" icon={Handshake} count={open.length} flush>
      {open.length ? (
        <div className="mt-owed-stack">
          {[{ title: "You owe", list: mine }, { title: "Owed to you", list: theirs }].map((g) =>
            g.list.length ? (
              <div key={g.title} className="mt-owed-group">
                <h3>{g.title}<span className="c-count">{g.list.length}</span></h3>
                {g.list.slice(0, 5).map((p) => <PromiseItem key={p.id} p={p} meeting={meetingOf.get(p.source_id || "")} />)}
              </div>
            ) : null,
          )}
        </div>
      ) : (
        <div className="c-card__body c-faint">Promises made in a meeting land here once its notes are read, each with the sentence it was made in.</div>
      )}
    </Card>
  );
}

export function PromisedPage() {
  const { promises, loaded, reload } = useMeetings();
  const meetingOf = useMeetingOf();
  const open = promises.filter((p) => p.state === "open");
  const done = promises.filter((p) => p.state === "done");
  const toggle = async (id: string, state: "open" | "done") => {
    await update("promise", id, { state });
    await reload("promises");
  };
  if (loaded && !promises.length) {
    return (
      <Card>
        <Empty icon={Handshake} title="No promises from meetings yet">
          Once a meeting's transcript or your notes are read, what you said you'd do and what they said they'd do land here, each with the sentence it was said in.
        </Empty>
      </Card>
    );
  }
  const group = (list: PromiseRow[]) => list.length ? list.map((p) => (
    <div key={p.id} className="mt-promise">
      <input type="checkbox" className="c-check" checked={p.state === "done"} aria-label={`Done: ${p.text}`}
        onChange={(e) => void toggle(p.id, e.target.checked ? "done" : "open")} />
      <PromiseItem p={p} meeting={meetingOf.get(p.source_id || "")} />
    </div>
  )) : <p className="c-faint">Nothing.</p>;
  return (
    <div className="c-stack">
      <Card flush>
        <div className="c-owed">
          <div>
            <h3>You owe<span className="c-count">{open.filter((p) => p.direction === "i_owe").length}</span></h3>
            {group(open.filter((p) => p.direction === "i_owe"))}
          </div>
          <div>
            <h3>Owed to you<span className="c-count">{open.filter((p) => p.direction === "owed_to_me").length}</span></h3>
            {group(open.filter((p) => p.direction === "owed_to_me"))}
          </div>
        </div>
      </Card>
      {done.length ? (
        <Card title="Done" count={done.length}>
          <div className="c-stack">{group(done)}</div>
        </Card>
      ) : null}
    </div>
  );
}

export function AfterList() {
  const { meetings, loaded } = useMeetings();
  const now = new Date();
  const over = meetings.filter((m) => isOver(m, now) && m.status !== "cancelled" && (m.outside || m.wants_brief)).reverse();
  const waiting = over.filter((m) => m.wants_brief && ["waiting", "failed"].includes(m.notes_state));
  const rest = over.filter((m) => !waiting.includes(m));
  if (loaded && !over.length) {
    return (
      <Card>
        <Empty icon={NotebookPen} title="Nothing to write up yet">
          After a meeting with people from outside, its transcript or your notes are read for decisions and promises.
        </Empty>
      </Card>
    );
  }
  return (
    <div className="c-split">
      <div className="c-stack">
        {waiting.length ? (
          <section>
            <div className="c-section__head"><h2><NotebookPen aria-hidden="true" />Waiting for notes<span className="c-count">{waiting.length}</span></h2></div>
            <div className="c-card mt-rows">{waiting.map((m) => <MeetingRow key={m.id} m={m} showDay />)}</div>
          </section>
        ) : null}
        <section className={waiting.length ? "c-section" : ""}>
          <div className="c-section__head"><h2><CalendarCheck aria-hidden="true" />The last month<span className="c-count">{rest.length}</span></h2></div>
          <div className="c-card mt-rows">{rest.map((m) => <MeetingRow key={m.id} m={m} showDay />)}</div>
        </section>
      </div>
      <aside className="c-stack mt-aside">
        <OpenPromises />
      </aside>
    </div>
  );
}

export function UnsureList() {
  const { meetings, loaded } = useMeetings();
  const now = new Date();
  const list = meetings.filter((m) => m.unsure && m.status !== "cancelled" && !isOver(m, now));
  if (loaded && !list.length) {
    return (
      <Card>
        <Empty icon={CircleHelp} title="Nothing it isn't sure of">
          When the read can't tell what kind of meeting something is, or whether it needs a brief, it waits here for you.
        </Empty>
      </Card>
    );
  }
  return (
    <div className="c-stack">
      <p className="mt-weekline">Say what each one is. It's kept as an example, so the next meetings like it are sorted without asking.</p>
      <div className="c-card mt-rows">{list.map((m) => <MeetingRow key={m.id} m={m} showDay />)}</div>
    </div>
  );
}
