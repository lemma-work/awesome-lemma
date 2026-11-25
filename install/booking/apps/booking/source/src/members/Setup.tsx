// Set-up, one person at a time. The booking-setup workflow does the work and
// waits on four forms; this is the screen for them, then the page is turned
// on (turnOn.ts) and its link shown.
//
//   calendars  which of Meetings' calendars to keep clear of
//   hours      proposed from how those calendars are used, each with why
//   page       the address (handle) and one line about them
//   video      Google Meet or Teams, which calendar bookings go on, and the
//              mailbox a declined booking is emailed from
//   on         the platform steps, each checked

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, CircleAlert, Copy, Link2, Mail, Video } from "lucide-react";
import { Button, client, openApp, orgId, q, sql, startWorkflow, update, create, useToast, whoAmI } from "@lemma-plugins/kit";
import { browserZone, daysText, DAY_NAMES, length } from "../time";
import { PROVIDER_LABEL, useBooking, type Calendar, type Page, type Settings } from "./data";
import { appOrigin, findWidget, pageLink, turnOn, type StepResult } from "./turnOn";

type StepRow = { node_id: string; status?: string; output_data?: Record<string, unknown> | null };
type Run = { id: string; status?: string; active_wait?: { node_id?: string } | null; step_history?: StepRow[] };

const STEPS = ["Calendars", "Hours", "Page", "Video", "On"];
const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED = new Set(["setup", "settings", "upcoming", "about", "api", "app", "admin", "help", "new", "b", "s", "page", "pages"]);

function output(run: Run | null, node: string): Record<string, unknown> | null {
  const steps = (run?.step_history || []).filter((s) => s.node_id === node && s.output_data);
  return steps.length ? (steps[steps.length - 1].output_data as Record<string, unknown>) : null;
}

function stepOf(run: Run | null, settings: Settings | null): number {
  if (settings?.setup_step === "done") return 4;
  const node = run?.active_wait?.node_id || "";
  return { calendars: 0, propose: 1, hours: 1, page: 2, video: 3 }[node] ?? (run?.status === "COMPLETED" ? 4 : 0);
}

function Rail({ at }: { at: number }) {
  return (
    <ol className="bk-rail" aria-label="Set-up steps">
      {STEPS.map((label, i) => (
        <li key={label} className={i < at ? "is-done" : i === at ? "is-here" : ""} aria-current={i === at ? "step" : undefined}>
          <span className="bk-rail__dot">{i < at ? <Check size={11} aria-hidden="true" /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function NeedMeetings() {
  return (
    <div className="c-app">
      <div className="c-setup">
        <CalendarDays size={22} aria-hidden="true" className="bk-mark" />
        <h1>Booking reads your calendars through Meetings</h1>
        <p className="c-setup__lead">
          Set Meetings up first: connect Google Calendar or Outlook there (or look around with its sample calendar). Your page then offers
          only times that are free on it, and every booking becomes one of your meetings, with a brief on who's coming.
        </p>
        <div className="c-setup__row">
          <Button variant="primary" onClick={() => void openApp("meetings")}>Open Meetings</Button>
        </div>
      </div>
    </div>
  );
}

export function Setup() {
  const { settings, page, reload } = useBooking();
  const [run, setRun] = useState<Run | null>(null);
  const [lost, setLost] = useState(false);
  const runId = settings?.setup_run_id || null;

  const poll = useCallback(async () => {
    if (!runId) return;
    try {
      const fresh = (await client.workflows.runs.get(runId)) as unknown as Run;
      setRun(fresh);
      setLost(false);
      if (fresh.status === "COMPLETED") void reload();
    } catch {
      setLost(true);
    }
  }, [runId, reload]);

  useEffect(() => {
    if (!runId || settings?.setup_step === "done") return;
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => window.clearInterval(timer);
  }, [runId, poll, settings?.setup_step]);

  const restart = async () => {
    const id = await startWorkflow("booking-setup");
    if (settings) await update("booking_settings", settings.id, { setup_run_id: id || null, setup_step: "calendars" });
    setRun(null);
    await reload("settings");
  };

  const failed = !!run && ["FAILED", "CANCELLED"].includes(String(run.status));
  const waiting = run?.status === "WAITING" ? run.active_wait?.node_id : null;
  const here = stepOf(run, settings);
  let body;
  if (settings?.setup_step === "done" && page) body = <TurnOn settings={settings} page={page} />;
  else if (!runId || lost || failed || (run?.status === "COMPLETED" && settings?.setup_step !== "done"))
    body = <Restart failed={failed} onRestart={restart} />;
  else if (waiting === "calendars") body = <Calendars run={run!} />;
  else if (waiting === "hours") body = <Hours run={run!} />;
  else if (waiting === "page") body = <PageForm run={run!} />;
  else if (waiting === "video") body = <VideoForm run={run!} />;
  else body = <Working node={run?.step_history?.[run.step_history.length - 1]?.node_id || ""} />;
  return (
    <div className="c-app">
      <div className="c-setup bk-setup">
        <Rail at={here} />
        {body}
      </div>
    </div>
  );
}

export async function startSetup(): Promise<void> {
  const me = await whoAmI();
  const meetings = (await q<{ timezone: string | null; display_name: string | null }>("SELECT timezone, display_name FROM meetings_settings LIMIT 1"))[0];
  const id = await startWorkflow("booking-setup");
  await create("booking_settings", {
    display_name: meetings?.display_name || me?.name || null,
    timezone: meetings?.timezone || browserZone(),
    setup_step: "calendars",
    setup_run_id: id || null,
  });
}

function Restart({ failed, onRestart }: { failed: boolean; onRestart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1>{failed ? "The set-up stopped partway" : "Set up your booking page"}</h1>
      <p className="c-setup__lead">{failed ? "Start it again; nothing on your calendars changed." : "Start the set-up to choose your calendars and hours."}</p>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => { setBusy(true); void onRestart().finally(() => setBusy(false)); }}>Start the set-up</Button>
      </div>
    </>
  );
}

function Working({ node }: { node: string }) {
  const said: Record<string, string> = {
    calendars: "Reading how your calendar is used…",
    propose: "Reading how your calendar is used…",
    save: "Keeping your page…",
    slots: "Working out your open times from your calendars…",
  };
  return (
    <>
      <h1>{said[node] || "One moment…"}</h1>
      <p className="c-setup__lead">Counted from the meetings Meetings read, never guessed.</p>
      <div className="c-meter" aria-hidden="true"><span style={{ width: node === "slots" ? "85%" : "45%" }} /></div>
    </>
  );
}

async function submit(run: Run, node: string, inputs: Record<string, unknown>) {
  await client.workflows.runs.submitForm(run.id, { node_id: node, inputs } as never);
}

/* ---------- 1. calendars ---------- */

function Calendars({ run }: { run: Run }) {
  const { calendars, settings } = useBooking();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => setPicked(new Set(calendars.map((c) => c.id))), [calendars]);
  const go = async () => {
    if (!picked.size) return toast("Choose at least one calendar.");
    setBusy(true);
    try {
      if (settings) await update("booking_settings", settings.id, { setup_step: "hours" });
      await submit(run, "calendars", { calendar_ids: [...picked] });
    } catch (e) {
      toast(`Couldn't go on: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Which calendars should your page keep clear of?</h1>
      <p className="c-setup__lead">
        A time is offered only when it's free on every one you choose, read live before each booking too. These are the calendars Meetings reads.
      </p>
      <div className="c-card c-choices">
        {calendars.map((c) => (
          <label key={c.id} className="c-choice">
            <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => {
              const next = new Set(picked);
              if (e.target.checked) next.add(c.id); else next.delete(c.id);
              setPicked(next);
            }} />
            <span className="bk-choice__main">
              <span>{PROVIDER_LABEL[c.provider]}</span>
              <span className="c-faint">{c.provider === "sample" ? "Made-up meetings to try the page with" : c.email}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => void go()}>Continue</Button>
      </div>
    </>
  );
}

/* ---------- 2. hours ---------- */

const LENGTHS = [15, 20, 30, 45, 60];
const BUFFERS = [0, 5, 10, 15, 20, 30];
const NOTICE = [2, 4, 12, 24, 48];
const AHEAD = [7, 14, 21, 30];

function Hours({ run }: { run: Run }) {
  const proposed = output(run, "propose") as null | {
    days: number[]; day_starts: string; day_ends: string; minutes: number; buffer_minutes: number; notice_hours: number;
    days_ahead: number; max_per_day: number; reasons: Record<string, string>; counted: Record<string, number>; timezone: string;
  };
  const { settings } = useBooking();
  const toast = useToast();
  const [v, setV] = useState(() => ({
    days: proposed?.days || [0, 1, 2, 3, 4], day_starts: proposed?.day_starts || "09:30", day_ends: proposed?.day_ends || "17:30",
    minutes: proposed?.minutes || 30, buffer_minutes: proposed?.buffer_minutes ?? 15, notice_hours: proposed?.notice_hours || 12,
    days_ahead: proposed?.days_ahead || 14, max_per_day: proposed?.max_per_day || 3,
  }));
  const [busy, setBusy] = useState(false);
  const why = proposed?.reasons || {};
  const go = async () => {
    if (!v.days.length) return toast("Choose at least one day.");
    if (v.day_starts >= v.day_ends) return toast("The day has to end after it starts.");
    setBusy(true);
    try {
      if (settings) await update("booking_settings", settings.id, { setup_step: "page" });
      await submit(run, "hours", v);
    } catch (e) {
      toast(`Couldn't go on: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };
  const Why = ({ k }: { k: string }) => (why[k] ? <p className="bk-why">{why[k]}</p> : null);
  return (
    <>
      <h1>When do you take calls?</h1>
      <p className="c-setup__lead">
        Proposed from {proposed?.counted?.meetings ?? 0} meetings on your calendar over the last month and the next two weeks, in your time ({proposed?.timezone || settings?.timezone}). Change anything.
      </p>
      <div className="bk-form">
        <div className="c-field"><span>Days</span>
          <div className="bk-days" role="group" aria-label="Days">
            {DAY_NAMES.map((d, i) => (
              <button key={d} type="button" className="bk-daychip" aria-pressed={v.days.includes(i)}
                onClick={() => setV({ ...v, days: v.days.includes(i) ? v.days.filter((x) => x !== i) : [...v.days, i].sort() })}>{d}</button>
            ))}
          </div>
          <Why k="days" />
        </div>
        <div className="bk-pair">
          <label className="c-field"><span>From</span><input className="c-input" type="time" value={v.day_starts} onChange={(e) => setV({ ...v, day_starts: e.target.value })} /></label>
          <label className="c-field"><span>Until</span><input className="c-input" type="time" value={v.day_ends} onChange={(e) => setV({ ...v, day_ends: e.target.value })} /></label>
        </div>
        <Why k="hours" />
        <div className="bk-pair">
          <label className="c-field"><span>Call length</span>
            <select className="c-select" value={v.minutes} onChange={(e) => setV({ ...v, minutes: Number(e.target.value) })}>
              {LENGTHS.map((n) => <option key={n} value={n}>{length(n)}</option>)}
            </select>
          </label>
          <label className="c-field"><span>Buffer either side</span>
            <select className="c-select" value={v.buffer_minutes} onChange={(e) => setV({ ...v, buffer_minutes: Number(e.target.value) })}>
              {BUFFERS.map((n) => <option key={n} value={n}>{n ? `${n} minutes` : "None"}</option>)}
            </select>
          </label>
        </div>
        <Why k="minutes" /><Why k="buffer" />
        <div className="bk-pair">
          <label className="c-field"><span>Notice</span>
            <select className="c-select" value={v.notice_hours} onChange={(e) => setV({ ...v, notice_hours: Number(e.target.value) })}>
              {NOTICE.map((n) => <option key={n} value={n}>{n < 24 ? `${n} hours` : n === 24 ? "A day" : "Two days"}</option>)}
            </select>
          </label>
          <label className="c-field"><span>How far ahead</span>
            <select className="c-select" value={v.days_ahead} onChange={(e) => setV({ ...v, days_ahead: Number(e.target.value) })}>
              {AHEAD.map((n) => <option key={n} value={n}>{n === 7 ? "One week" : n === 14 ? "Two weeks" : n === 21 ? "Three weeks" : "A month"}</option>)}
            </select>
          </label>
        </div>
        <Why k="notice" /><Why k="days_ahead" />
        <label className="c-field bk-narrow"><span>Daily limit</span>
          <select className="c-select" value={v.max_per_day} onChange={(e) => setV({ ...v, max_per_day: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n} {n === 1 ? "booking" : "bookings"} a day</option>)}
          </select>
        </label>
        <Why k="max_per_day" />
      </div>
      <p className="c-setup__note">{daysText(v.days)}, {v.day_starts}–{v.day_ends}, calls of {length(v.minutes)}.</p>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => void go()}>Continue</Button>
      </div>
    </>
  );
}

/* ---------- 3. page ---------- */

function PageForm({ run }: { run: Run }) {
  const proposed = output(run, "propose") as null | { handle: string; name: string };
  const { settings } = useBooking();
  const toast = useToast();
  const [v, setV] = useState({ handle: proposed?.handle || "", name: proposed?.name || "", about: "", more: "" });
  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const handle = v.handle.trim().toLowerCase();
  const shape = HANDLE.test(handle) && handle.length >= 2 && !RESERVED.has(handle);
  useEffect(() => {
    if (!shape) return setTaken(false);
    const t = window.setTimeout(() => {
      void q<{ id: string }>(`SELECT id FROM booking_page WHERE handle = ${sql(handle)} LIMIT 1`).then((r) => setTaken(r.length > 0), () => setTaken(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [handle, shape]);
  const go = async () => {
    if (!shape) return toast("The address is two to forty lowercase letters, digits or dashes.");
    if (taken) return toast(`Someone in this Lemma already has /${handle}.`);
    if (!v.name.trim()) return toast("Your page needs a name.");
    setBusy(true);
    try {
      if (settings) await update("booking_settings", settings.id, { setup_step: "video" });
      await submit(run, "page", { handle, name: v.name.trim(), about: v.about.trim() || undefined, more: v.more.trim() || undefined });
    } catch (e) {
      toast(`Couldn't go on: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Your page</h1>
      <p className="c-setup__lead">What people see when they open your link. Nothing about your calendar shows beyond the open times.</p>
      <div className="bk-form">
        <label className="c-field"><span>Address</span>
          <span className="bk-prefix"><span className="c-faint">{new URL(appOrigin()).host}/</span>
            <input className="c-input" value={v.handle} maxLength={40} onChange={(e) => setV({ ...v, handle: e.target.value })} aria-invalid={!shape || taken} />
          </span>
          <span className={`c-field__hint ${(!shape && handle) || taken ? "bk-bad" : ""}`}>
            {!handle ? "Lowercase letters, digits and dashes." : !shape ? "Two to forty lowercase letters, digits or dashes, not a word the page uses." : taken ? "Someone in this Lemma has that one." : "Free."}
          </span>
        </label>
        <label className="c-field"><span>Name</span><input className="c-input" value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label className="c-field"><span>One line about you</span>
          <input className="c-input" value={v.about} maxLength={200} placeholder="What you do, and what a call with you is good for." onChange={(e) => setV({ ...v, about: e.target.value })} />
        </label>
        <label className="c-field"><span>More, for the chat beside your page (optional)</span>
          <textarea className="c-textarea" rows={3} value={v.more} maxLength={1500} placeholder="Which calls you take, what to bring. The chat answers visitors only from this and your open times."
            onChange={(e) => setV({ ...v, more: e.target.value })} />
        </label>
      </div>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => void go()}>Continue</Button>
      </div>
    </>
  );
}

/* ---------- 4. video ---------- */

interface Account { id: string; connector_id: string; status?: string; email?: string | null; display_name?: string | null }

export function useMailAccounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  useEffect(() => {
    void (async () => {
      const org = await orgId();
      if (!org) return setAccounts([]);
      const lists = await Promise.all(["gmail", "outlook"].map((c) =>
        client.connectors.accounts.list(org, { connectorId: c, limit: 50 } as never).then(
          (r) => ((r as { items?: Account[] }).items || []) as Account[], () => [] as Account[])));
      setAccounts(lists.flat().filter((a) => !a.status || a.status === "CONNECTED" || a.status === "ACTIVE"));
    })();
  }, []);
  return accounts;
}

export const addressOf = (a: Account) => (a.email || (a.display_name?.includes("@") ? a.display_name : "") || "").toLowerCase();

function VideoForm({ run }: { run: Run }) {
  const proposed = output(run, "propose") as null | { video: string; event_calendar: string | null };
  const chosen = (output(run, "calendars")?.calendar_ids as string[] | undefined) || [];
  const { calendars, settings } = useBooking();
  const toast = useToast();
  const mail = useMailAccounts();
  const mine = calendars.filter((c) => !chosen.length || chosen.includes(c.id));
  const [eventCal, setEventCal] = useState(proposed?.event_calendar || mine[0]?.id || "");
  const cal: Calendar | undefined = mine.find((c) => c.id === eventCal);
  const options = cal?.provider === "google" ? ["google_meet", "none"] : cal?.provider === "outlook" ? ["teams", "none"] : ["google_meet", "none"];
  const [video, setVideo] = useState(proposed?.video && proposed.video !== "none" ? proposed.video : options[0]);
  useEffect(() => { if (!options.includes(video)) setVideo(options[0]); }, [options, video]);
  const senders = useMemo(() => {
    if (!cal || cal.provider === "sample") return [] as { connector: "gmail" | "outlook"; id: string; address: string }[];
    const fit = (mail || []).filter((a) => (cal.provider === "outlook" ? a.connector_id === "outlook" : a.connector_id === "gmail"));
    const same = fit.filter((a) => addressOf(a) === cal.email.toLowerCase());
    return (same.length ? same : fit).map((a) => ({ connector: a.connector_id as "gmail" | "outlook", id: a.id, address: addressOf(a) }));
  }, [mail, cal]);
  const [sender, setSender] = useState("");
  useEffect(() => setSender(senders[0]?.id || ""), [senders]);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const s = senders.find((x) => x.id === sender);
    setBusy(true);
    try {
      if (settings) await update("booking_settings", settings.id, { setup_step: "video" });
      await submit(run, "video", {
        video, event_calendar: eventCal,
        mail_connector: s ? s.connector : "none", mail_account_id: s?.id, mail_address: s?.address,
      });
    } catch (e) {
      toast(`Couldn't finish: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };
  const VIDEO_TEXT: Record<string, [string, string]> = {
    google_meet: ["Google Meet", cal?.provider === "sample" ? "On the sample calendar the link is a made-up one at meet.example." : "Google Calendar makes a Meet link for each booking, in the invite."],
    teams: ["Microsoft Teams", "Outlook makes a Teams link for each booking. It needs a work or school Microsoft 365 account; a personal Outlook.com account can't."],
    none: ["No video link", "The invite says when, and you add the details."],
  };
  return (
    <>
      <h1>The video link</h1>
      <p className="c-setup__lead">Each booking becomes an event on your calendar, inviting the person who booked, with this link.</p>
      {mine.length > 1 ? (
        <label className="c-field bk-gap"><span>Add bookings to</span>
          <select className="c-select" value={eventCal} onChange={(e) => setEventCal(e.target.value)}>
            {mine.map((c) => <option key={c.id} value={c.id}>{PROVIDER_LABEL[c.provider]}{c.provider === "sample" ? "" : ` · ${c.email}`}</option>)}
          </select>
        </label>
      ) : null}
      <div className="c-card c-choices" role="radiogroup" aria-label="Video">
        {options.map((o) => (
          <label key={o} className="c-choice">
            <input type="radio" name="video" checked={video === o} onChange={() => setVideo(o)} />
            <span className="bk-choice__main"><span>{VIDEO_TEXT[o][0]}</span><span className="c-faint">{VIDEO_TEXT[o][1]}</span></span>
          </label>
        ))}
      </div>
      <div className="bk-sub">
        <h2><Mail size={14} aria-hidden="true" />When a booking can't be taken</h2>
        {cal?.provider === "sample" ? (
          <p className="c-muted">The person is told on the page. On the sample calendar no email is sent.</p>
        ) : senders.length ? (
          <label className="c-field"><span>Email them why, from</span>
            <select className="c-select" value={sender} onChange={(e) => setSender(e.target.value)}>
              {senders.map((s) => <option key={s.id} value={s.id}>{s.address || s.connector}</option>)}
              <option value="">Don't email; the page tells them</option>
            </select>
          </label>
        ) : (
          <p className="c-muted">
            The person is told on the page. To email them too, connect {cal?.provider === "google" ? "Gmail" : "Outlook"} in this Lemma and choose it in settings.
          </p>
        )}
      </div>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => void go()}>Finish</Button>
      </div>
    </>
  );
}

/* ---------- 5. on ---------- */

let turning = false;
/** True while this page shows the turn-on results: the person leaves them by pressing on. */
export let holdTurnOn = false;

const STEP_LABEL: Record<StepResult["step"], string> = {
  open: "Visitors can send a booking",
  widget: "The page can read your open times",
  trigger: "New bookings reach you",
  refresh: "Open times stay current",
  page: "Your page",
};

function TurnOn({ settings, page }: { settings: Settings; page: Page }) {
  const { reload } = useBooking();
  const toast = useToast();
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [done, setDone] = useState<boolean | null>(null);
  const [link, setLink] = useState("");
  const held = steps.some((s) => s.held);
  const begin = useCallback(async () => {
    setSteps([]);
    setDone(null);
    const ok = await turnOn(settings, page, (r) => setSteps((s) => [...s.filter((x) => x.step !== r.step), r]));
    const widget = await findWidget().catch(() => null);
    setLink(pageLink(page, widget?.public_key || null));
    setDone(ok);
    await reload();
  }, [settings, page, reload]);
  const started = useRef(false);
  useEffect(() => {
    // Once per page: React's development double-run must not make two triggers.
    if (started.current || turning) return;
    started.current = true;
    turning = true;
    holdTurnOn = true;
    void begin().finally(() => {
      turning = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <h1>{done && held ? "Your page is ready to try" : done ? "Your page is on" : done === false ? "Your page isn't on yet" : "Turning your page on…"}</h1>
      <p className="c-setup__lead">
        {done && held
          ? "It stays off while bookings go on the sample calendar. Add a sample booking to see one go through; to take real bookings, connect Google Calendar or Outlook in Meetings, then choose it in settings."
          : done ? "Share the link anywhere. People pick a time in their own time zone and confirm their email; you get the event and a brief." : "Each step is checked after it's done."}
      </p>
      <ul className="bk-checks">
        {(["open", "widget", "trigger", "refresh", "page"] as const).map((s) => {
          const r = steps.find((x) => x.step === s);
          return (
            <li key={s} className={r ? (r.held ? "is-held" : r.ok ? "is-ok" : "is-bad") : ""}>
              {r ? (r.ok && !r.held ? <Check size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />) : <span className="c-spin" aria-hidden="true" />}
              <span><strong>{STEP_LABEL[s]}</strong><span className="c-muted">{r?.said || "…"}</span></span>
            </li>
          );
        })}
      </ul>
      {done && link && !held ? (
        <div className="bk-link">
          <Link2 size={14} aria-hidden="true" />
          <span className="c-ellipsis">{link.split("?")[0]}</span>
          <Button size="sm" icon={Copy} onClick={() => void navigator.clipboard.writeText(link).then(() => toast("Link copied."))}>Copy link</Button>
        </div>
      ) : null}
      <div className="c-setup__row">
        {done === false ? <Button variant="primary" onClick={() => void begin()}>Try again</Button> : null}
        {done ? <Button variant="primary" icon={CalendarDays} onClick={() => { holdTurnOn = false; void reload(); }}>See your bookings</Button> : null}
        {done && held ? <Button onClick={() => void openApp("meetings")}>Open Meetings</Button> : null}
      </div>
    </>
  );
}
