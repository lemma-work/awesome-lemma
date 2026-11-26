// The app once set up, in the same frame as the other plugins' apps: places on
// the left (this week, after, not sure, promised, settings), the page on the
// right. Below 860px one pane, with the left side as a drawer.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarClock, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, Handshake, Menu as MenuIcon, NotebookPen, Settings as Cog, TriangleAlert, X,
  type LucideIcon,
} from "lucide-react";
import { Avatar, Banner, Button, cx } from "@lemma-plugins/kit";
import { stoppedText } from "./connection";
import { useMeetings } from "./data";
import { isOver } from "./marks";
import { MeetingPage } from "./MeetingPage";
import { to, useRoute, type Route } from "./route";
import { SettingsPage } from "./Settings";
import { at, dayKey, weekDays, weekLabel } from "./time";
import { AfterList, PromisedPage, UnsureList, Week } from "./Week";

function useCounts() {
  const { meetings, promises } = useMeetings();
  return useMemo(() => {
    const now = new Date();
    const days = new Set(weekDays(0, now).map((d) => d.key));
    return {
      week: meetings.filter((m) => m.outside && m.status !== "cancelled" && days.has(dayKey(at(m.start_at) || now))).length,
      after: meetings.filter((m) => isOver(m, now) && m.wants_brief && ["waiting", "failed"].includes(m.notes_state)).length,
      unsure: meetings.filter((m) => m.unsure && m.status !== "cancelled" && !isOver(m, now)).length,
      promised: promises.filter((p) => p.state === "open").length,
    };
  }, [meetings, promises]);
}

function Nav({ route, onPick }: { route: Route; onPick: () => void }) {
  const { calendars, settings } = useMeetings();
  const counts = useCounts();
  const items: { id: Route["page"]; label: string; icon: LucideIcon; n?: number; hot?: boolean; go: () => void }[] = [
    { id: "week", label: "This week", icon: CalendarDays, n: counts.week, go: () => to.week(0) },
    { id: "after", label: "After", icon: NotebookPen, n: counts.after, hot: true, go: () => to.after() },
    { id: "unsure", label: "Not sure", icon: CircleHelp, n: counts.unsure, hot: true, go: () => to.unsure() },
    { id: "promised", label: "Promised", icon: Handshake, n: counts.promised, go: () => to.promised() },
  ];
  const here = route.page === "meeting" ? "" : route.page;
  return (
    <nav className="mt-nav" aria-label="Meetings">
      <div className="mt-nav__brand">
        <span className="c-header__icon" aria-hidden="true"><CalendarClock size={15} /></span>
        <span>Meetings</span>
      </div>
      <div className="c-nav">
        {items.map((n) => (
          <button key={n.id} type="button" className="c-nav__item" aria-current={here === n.id ? "page" : undefined}
            onClick={() => { n.go(); onPick(); }}>
            <n.icon aria-hidden="true" />
            {n.label}
            <span className={cx("c-nav__n", n.hot && "c-nav__n--hot")}>{n.n || ""}</span>
          </button>
        ))}
        <p className="c-nav__label">Yours</p>
        <button type="button" className="c-nav__item" aria-current={here === "settings" ? "page" : undefined}
          onClick={() => { to.settings(); onPick(); }}>
          <Cog aria-hidden="true" />
          Briefs and settings
        </button>
      </div>
      <div className="mt-nav__foot">
        {calendars.map((c) => (
          <div key={c.id} className="mt-nav__cal" title={c.last_error ? stoppedText(c.last_error, c.provider) : undefined}>
            <Avatar name={settings?.display_name} email={c.email} size={22} you />
            <span className="c-ellipsis">{c.provider === "sample" ? "Sample calendar" : c.email}</span>
            {c.last_error ? <TriangleAlert size={13} aria-label="Reading stopped" /> : null}
          </div>
        ))}
      </div>
    </nav>
  );
}

export function Shell() {
  const route = useRoute();
  const { meetings, sample, calendars, reload, errors } = useMeetings();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [route.page]);

  // While a brief or a write-up is being made, look again every few seconds:
  // the change stream says so too, but a missed frame must not leave
  // "Writing" on screen.
  const busy = meetings.some((m) => ["wanted", "writing"].includes(m.brief_state) || ["wanted", "reading"].includes(m.notes_state));
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      void reload("meetings");
      void reload("decisions");
      void reload("promises");
    }, 5000);
    return () => window.clearInterval(timer);
  }, [busy, reload]);

  const errs = Object.entries(errors).filter(([, v]) => v);
  // A calendar whose last read failed, said in words (the mark beside it in
  // the side list is only a sign).
  const stopped = calendars.filter((c) => c.last_error && c.provider !== "sample" && c.state !== "stopped");
  let page;
  if (route.page === "meeting") page = <MeetingPage id={route.id} />;
  else if (route.page === "settings") page = <SettingsPage />;
  else if (route.page === "after") page = <Titled title="After meetings"><AfterList /></Titled>;
  else if (route.page === "unsure") page = <Titled title="Not sure"><UnsureList /></Titled>;
  else if (route.page === "promised") page = <Titled title="Promised in meetings"><PromisedPage /></Titled>;
  else {
    const title = route.offset === 0 ? "This week" : route.offset === 1 ? "Next week" : route.offset === -1 ? "Last week" : "Week";
    page = <Titled title={title} nav={<WeekNav offset={route.offset} />}><Week offset={route.offset} /></Titled>;
  }

  return (
    <div className={cx("mt-shell", open && "is-nav-open")}>
      <aside className="mt-side">
        <Nav route={route} onPick={() => setOpen(false)} />
      </aside>
      {open ? <button type="button" className="mt-scrim" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <main className="mt-main">
        <div className="mt-mobilebar">
          <Button variant="ghost" icon={open ? X : MenuIcon} label={open ? "Close menu" : "Menu"} onClick={() => setOpen((v) => !v)} />
          <span className="mt-mobilebar__title">Meetings</span>
        </div>
        {sample ? (
          <div className="mt-strip">
            <Banner action={<Button size="sm" onClick={() => to.settings()}>Connect my calendar</Button>}>
              <b>Sample calendar.</b> Made-up meetings at .example addresses, so you can see how it works.
            </Banner>
          </div>
        ) : null}
        {stopped.length ? (
          <div className="mt-strip">
            {stopped.map((c) => (
              <Banner key={c.id} tone="danger" icon={TriangleAlert}
                action={route.page === "settings" ? undefined : <Button size="sm" onClick={() => to.settings()}>Calendars</Button>}>
                <b>Couldn't read {c.email}.</b> {stoppedText(c.last_error || "", c.provider)}
              </Banner>
            ))}
          </div>
        ) : null}
        {errs.length ? (
          <div className="mt-strip">
            {errs.map(([name, text]) => (
              <Banner key={name} tone="danger" action={<Button size="sm" onClick={() => void reload(name)}>Try again</Button>}>
                Couldn't load {name}: {text}
              </Banner>
            ))}
          </div>
        ) : null}
        <div className="mt-page">{page}</div>
      </main>
    </div>
  );
}

function Titled({ title, nav, children }: { title: string; nav?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="mt-head">
        <h1>{title}</h1>
        {nav}
      </div>
      <div className="c-body">{children}</div>
    </>
  );
}

function WeekNav({ offset }: { offset: number }) {
  const days = useMemo(() => weekDays(offset), [offset]);
  return (
    <div className="c-row mt-weeknav">
      <span className="c-faint num">{weekLabel(days)}</span>
      <span className="c-grow" />
      {offset !== 0 ? <Button size="sm" variant="ghost" onClick={() => to.week(0)}>Today</Button> : null}
      <Button size="sm" icon={ChevronLeft} label="Week before" disabled={offset <= -5} onClick={() => to.week(offset - 1)} />
      <Button size="sm" icon={ChevronRight} label="Week after" disabled={offset >= 2} onClick={() => to.week(offset + 1)} />
    </div>
  );
}
