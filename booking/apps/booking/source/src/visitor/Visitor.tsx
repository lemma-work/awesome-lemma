// The page a visitor books on: <app address>/<handle>. Nobody signs in.
//
//   pick      days with open times, then the times of one, in the visitor's
//             own time zone (which they can change)
//   details   their name, email, what it's about
//   code      the 6-digit code sent to that email (once per browser)
//   checking  the request is added; the owner's run checks it against their
//             live calendars and answers in booking_outcome
//   done      booked, declined with the reason, or still being checked
//
// Everything is read through the Lemma's web widget from what it made Public.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarCheck, CalendarX, Clock, Globe, Mail, MessageCircle, Video } from "lucide-react";
import { Avatar, Button, Spinner } from "./marks";
import { browserZone, clock, current, dayKey, dayMonth, length, longDay, offset, place, span, weekday, zones } from "../time";
import { explain, loadWidget, widgetKey, type LemmaWidget } from "./widget";

interface Page {
  id: string;
  handle: string;
  name: string;
  about?: string | null;
  more?: string | null;
  minutes: number;
  video: "google_meet" | "teams" | "none";
  timezone?: string | null;
  notice_hours: number;
  state: "on" | "off";
  slots?: string[] | null;
  chat?: boolean | null;
}

type Step = "pick" | "details" | "code" | "checking" | "booked" | "declined" | "waiting";

const VIDEO: Record<Page["video"], string> = {
  google_meet: "Google Meet link in the invite",
  teams: "Microsoft Teams link in the invite",
  none: "Details in the invite",
};
const CONFIRMED = "booking:confirmed-email";

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function token(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function kept(key: string): string {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function keep(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* blocked */
  }
}

export function Visitor({ handle }: { handle: string }) {
  const [widget, setWidget] = useState<LemmaWidget | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [problem, setProblem] = useState<"" | "nokey" | "missing" | "unreachable">("");
  const [zone, setZone] = useState(browserZone());
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Date | null>(null);
  const [step, setStep] = useState<Step>("pick");
  const [form, setForm] = useState({ name: "", email: "", about: "" });
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const flow = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    const key = widgetKey();
    if (!key) return setProblem("nokey");
    try {
      const lemma = await loadWidget(key, { chat: true, greeting: "Hi! Ask me when someone is free, or what a call is for." });
      setWidget(lemma);
      const read = await lemma.readRows("booking_page");
      const found = (read.rows as unknown as Page[]).find((p) => p.handle === handle);
      if (!found) return setProblem("missing");
      setPage(found);
      document.title = `Book time with ${found.name}`;
      setNow(Date.now());
    } catch (error) {
      setProblem("unreachable");
      setMessage(explain(error));
    }
  }, [handle]);

  useEffect(() => {
    void load();
  }, [load]);

  // The chat bubble only where the page wants it (widget.js draws it).
  useEffect(() => {
    const bubble = document.querySelector<HTMLElement>("[data-lemma-launcher], .lemma-web-launcher, #lemma-web-launcher");
    if (bubble && page && page.chat === false) bubble.style.display = "none";
  }, [page]);

  const slots = useMemo(() => {
    if (!page) return [] as Date[];
    const earliest = now + page.notice_hours * 3600_000;
    return (page.slots || []).map((s) => new Date(s)).filter((d) => d.getTime() >= earliest).sort((a, b) => a.getTime() - b.getTime());
  }, [page, now]);

  const days = useMemo(() => {
    const groups = new Map<string, Date[]>();
    for (const s of slots) {
      const k = dayKey(s, zone);
      groups.set(k, [...(groups.get(k) || []), s]);
    }
    return [...groups.entries()];
  }, [slots, zone]);

  useEffect(() => {
    if (!days.length) return;
    if (!day || !days.some(([k]) => k === day)) setDay(days[0][0]);
  }, [days, day]);

  const times = days.find(([k]) => k === day)?.[1] || [];
  const minutes = page?.minutes || 30;
  const ownerZone = current(page?.timezone || "UTC");
  const first = page ? firstName(page.name) : "";

  const show = (next: Step) => {
    setStep(next);
    setMessage("");
    flow.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const choose = (s: Date) => {
    setSlot(s);
    show("details");
  };

  const ref = useRef("");
  const book = async () => {
    if (!widget || !page || !slot) return;
    ref.current = token();
    await widget.addRow("booking_request", {
      page_id: page.id,
      starts_at: slot.toISOString().replace(/\.\d{3}Z$/, "Z"),
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      about: form.about.trim(),
      zone,
      ref: ref.current,
    });
    keep(CONFIRMED, form.email.trim().toLowerCase());
    show("checking");
    const began = Date.now();
    const look = async (): Promise<void> => {
      try {
        const read = await widget.readRows("booking_outcome");
        const found = read.rows.find((r) => r.ref === ref.current) as { state?: string; reason?: string } | undefined;
        if (found?.state === "confirmed") {
          setReason(String(found.reason || ""));
          return show("booked");
        }
        if (found?.state === "declined") {
          setReason(String(found.reason || ""));
          return show("declined");
        }
      } catch {
        /* a refused read is retried until the wait is up */
      }
      if (Date.now() - began > 75_000) return show("waiting");
      await new Promise((r) => window.setTimeout(r, 2500));
      return look();
    };
    await look();
  };

  const details = async (event: React.FormEvent) => {
    event.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!form.name.trim() || !form.about.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      return setMessage("Add your name, a working email address, and a line on what you'd like to talk about.");
    }
    if (!widget) return;
    setBusy(true);
    setMessage("");
    try {
      if (widget.isContact() && kept(CONFIRMED) === email) await book();
      else {
        await widget.sendCode(email);
        show("code");
      }
    } catch (error) {
      setMessage(explain(error));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) return setMessage("The code is 6 digits.");
    if (!widget) return;
    setBusy(true);
    setMessage("");
    try {
      await widget.verifyCode(form.email.trim().toLowerCase(), digits);
      await book();
    } catch (error) {
      setMessage(explain(error));
    } finally {
      setBusy(false);
    }
  };

  const again = async () => {
    setSlot(null);
    setCode("");
    setReason("");
    show("pick");
    await load();
  };

  if (problem) return <Problem kind={problem} message={message} />;
  if (!page) return <Loading />;

  const end = slot ? new Date(slot.getTime() + minutes * 60_000) : null;
  const theirs =
    slot && ownerZone !== zone
      ? `${clock(slot, ownerZone)} ${dayKey(slot, ownerZone) !== dayKey(slot, zone) ? weekday(slot, ownerZone) + " " : ""}for ${first} (${place(ownerZone)})`
      : "";

  return (
    <div className="c-app vb-app">
      <main className="vb">
        <aside className="vb-who" aria-label={`About ${page.name}`}>
          <Avatar name={page.name} size={52} />
          <p className="vb-eyebrow">Book time with</p>
          <h1>{page.name}</h1>
          {page.about ? <p className="vb-about">{page.about}</p> : null}
          <ul className="vb-facts">
            <li><Clock size={14} aria-hidden="true" />{length(minutes)}</li>
            <li><Video size={14} aria-hidden="true" />{VIDEO[page.video] || VIDEO.none}</li>
            <li><Mail size={14} aria-hidden="true" />The invite comes from {first}'s calendar</li>
          </ul>
          <Extra page={page} widget={widget} className="vb-extra--side" />
        </aside>

        <section className="vb-flow c-card" ref={(el) => { flow.current = el; }} aria-live="polite">
          {page.state !== "on" ? (
            <div className="vb-state">
              <CalendarX size={20} aria-hidden="true" />
              <h2>{first} isn't taking bookings right now</h2>
              <p>Try again later, or ask them for another way to find a time.</p>
            </div>
          ) : step === "pick" ? (
            <>
              <div className="vb-bar">
                <h2>Pick a time</h2>
                <label className="vb-zone">
                  <Globe size={13} aria-hidden="true" />
                  <span className="c-sr">Your time zone</span>
                  <select className="c-select" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Your time zone">
                    {zones([zone, ownerZone]).map((z) => (
                      <option key={z} value={z}>{place(z)} ({offset(z)})</option>
                    ))}
                  </select>
                </label>
              </div>
              {!days.length ? (
                <div className="vb-state">
                  <CalendarX size={20} aria-hidden="true" />
                  <h2>No open times in the next two weeks</h2>
                  <p>{first}'s calendar is full for now. Check back in a few days{page.chat !== false ? ", or ask a question" : ""}.</p>
                </div>
              ) : (
                <>
                  <div className="vb-days" role="group" aria-label="Days with open times">
                    {days.map(([k, list]) => (
                      <button key={k} type="button" className="vb-day" aria-pressed={k === day} onClick={() => setDay(k)}>
                        <span className="vb-day__wd">{weekday(list[0], zone)}</span>
                        <span className="vb-day__dt">{dayMonth(list[0], zone)}</span>
                        <span className="vb-day__n">{list.length} {list.length === 1 ? "time" : "times"}</span>
                      </button>
                    ))}
                  </div>
                  <p className="vb-dayname">{times.length ? longDay(times[0], zone) : null}</p>
                  <div className="vb-times" role="group" aria-label="Open times">
                    {times.map((t) => (
                      <button key={t.toISOString()} type="button" className="vb-time" onClick={() => choose(t)}
                        aria-label={`Book ${span(t, new Date(t.getTime() + minutes * 60_000), zone)}`}>
                        {clock(t, zone)}
                      </button>
                    ))}
                  </div>
                  <p className="vb-note">Times are in {place(zone)} time ({offset(zone)}). {first} is in {place(ownerZone)}.</p>
                </>
              )}
            </>
          ) : step === "details" || step === "code" ? (
            <>
              <button type="button" className="vb-back" onClick={() => show("pick")} disabled={busy}>
                <ArrowLeft size={14} aria-hidden="true" /> Pick another time
              </button>
              {slot && end ? (
                <div className="vb-slot">
                  <p className="vb-slot__when">{span(slot, end, zone)}</p>
                  <p className="vb-slot__sub">{place(zone)} time{theirs ? ` · ${theirs}` : ""}</p>
                </div>
              ) : null}
              {step === "details" ? (
                <form className="vb-form" onSubmit={(e) => void details(e)} noValidate method="post">
                  <label className="c-field"><span>Your name</span>
                    <input className="c-input" autoComplete="name" maxLength={120} value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                  </label>
                  <label className="c-field"><span>Your email</span>
                    <input className="c-input" type="email" autoComplete="email" maxLength={320} value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })} required aria-describedby="vb-email-hint" />
                    <small id="vb-email-hint" className="vb-hint">We'll send a code to check it's you. The invite goes here.</small>
                  </label>
                  <label className="c-field"><span>What would you like to talk about?</span>
                    <textarea className="c-textarea" rows={4} maxLength={1500} value={form.about} placeholder="A few lines is plenty."
                      onChange={(e) => setForm({ ...form, about: e.target.value })} required />
                  </label>
                  {message ? <p className="vb-msg" role="alert">{message}</p> : null}
                  <div className="vb-actions">
                    <Button type="submit" variant="primary" busy={busy}>Continue</Button>
                  </div>
                </form>
              ) : (
                <form className="vb-form" onSubmit={(e) => void verify(e)} noValidate method="post">
                  <label className="c-field"><span>Enter the 6-digit code we sent to {form.email.trim().toLowerCase()}</span>
                    <input className="c-input vb-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                      placeholder="123456" onChange={(e) => setCode(e.target.value)} required autoFocus />
                  </label>
                  {message ? <p className="vb-msg" role="alert">{message}</p> : null}
                  <div className="vb-actions">
                    <Button type="submit" variant="primary" busy={busy}>Book this time</Button>
                    <Button type="button" variant="ghost" disabled={busy}
                      onClick={() => void widget?.sendCode(form.email.trim().toLowerCase()).then(() => setMessage("Sent a new code."), (e) => setMessage(explain(e)))}>
                      Send a new code
                    </Button>
                  </div>
                </form>
              )}
            </>
          ) : step === "checking" ? (
            <div className="vb-state">
              <Spinner />
              <h2>Checking {first}'s calendar</h2>
              <p>{slot && end ? span(slot, end, zone) : null}. This takes a few seconds.</p>
            </div>
          ) : step === "booked" ? (
            <div className="vb-state vb-state--done">
              <CalendarCheck size={22} aria-hidden="true" />
              <h2>You're booked</h2>
              <p className="vb-slot__when">{slot && end ? span(slot, end, zone) : null}</p>
              <p>{place(zone)} time{theirs ? ` · ${theirs}` : ""}</p>
              {reason && reason !== "Booked." ? (
                <p>{reason}</p>
              ) : (
                <p>The invite is on its way to {form.email.trim().toLowerCase()} from {first}'s calendar{page.video !== "none" ? ", with the video link" : ""}. To move or cancel, reply to it.</p>
              )}
              <p><Button variant="ghost" size="sm" onClick={() => void again()}>Book another time</Button></p>
            </div>
          ) : step === "declined" ? (
            <div className="vb-state">
              <CalendarX size={22} aria-hidden="true" />
              <h2>That time couldn't be booked</h2>
              <p>{reason || "It was taken a moment ago."}</p>
              <p><Button variant="primary" onClick={() => void again()}>Pick another time</Button></p>
            </div>
          ) : (
            <div className="vb-state">
              <Mail size={22} aria-hidden="true" />
              <h2>Requested</h2>
              <p>{slot && end ? span(slot, end, zone) : null}</p>
              <p>It's taking longer than usual to check. You'll get the invite at {form.email.trim().toLowerCase()}, or an email saying why not.</p>
            </div>
          )}
        </section>
        <Extra page={page} widget={widget} className="vb-extra--after" />
      </main>
      <footer className="vb-foot">
        <span>Open times come straight from {first}'s calendar.</span>
        <a href="https://lemma.work" target="_blank" rel="noopener noreferrer">Runs on Lemma</a>
      </footer>
    </div>
  );
}

/** What calls are for, and the chat: beside the picker on a desk, after it on a phone. */
function Extra({ page, widget, className }: { page: Page; widget: LemmaWidget | null; className: string }) {
  if (!page.more && !(page.chat !== false && widget?.openChat)) return null;
  return (
    <div className={`vb-extra ${className}`}>
      {page.more ? <p className="vb-more">{page.more}</p> : null}
      {page.chat !== false && widget?.openChat ? (
        <p className="vb-ask">
          <Button variant="ghost" size="sm" icon={MessageCircle} onClick={() => widget.openChat?.()}>Ask a question</Button>
        </p>
      ) : null}
    </div>
  );
}

function Loading() {
  return (
    <div className="c-app vb-app" aria-busy="true">
      <main className="vb">
        <aside className="vb-who">
          <span className="c-skel vb-skel-av" />
          <span className="c-skel vb-skel-line" style={{ width: "40%" }} />
          <span className="c-skel vb-skel-title" />
          <span className="c-skel vb-skel-line" style={{ width: "80%" }} />
          <span className="c-skel vb-skel-line" style={{ width: "60%" }} />
        </aside>
        <section className="vb-flow c-card">
          <span className="c-skel vb-skel-line" style={{ width: "30%" }} />
          <div className="vb-days">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="c-skel vb-skel-day" />)}</div>
          <div className="vb-times">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} className="c-skel vb-skel-time" />)}</div>
        </section>
      </main>
    </div>
  );
}

function Problem({ kind, message }: { kind: "nokey" | "missing" | "unreachable"; message: string }) {
  const words = {
    nokey: ["This link is missing its last part", "Booking links end in ?k= and a code. Ask the person for their full link, or open it from their message again."],
    missing: ["There's no booking page here", "The address may have changed. Ask the person for their current link."],
    unreachable: ["The booking page didn't load", message || "Refresh to try again."],
  }[kind];
  return (
    <div className="c-app vb-app">
      <main className="vb vb--narrow">
        <section className="vb-flow c-card">
          <div className="vb-state">
            <CalendarX size={22} aria-hidden="true" />
            <h2>{words[0]}</h2>
            <p>{words[1]}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
