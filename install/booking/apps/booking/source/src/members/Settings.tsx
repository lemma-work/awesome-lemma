// Your page's settings: hours, the page itself, the video link and where a
// declined booking is emailed from, the calendars it keeps clear of, and
// turning it off. Saving re-works the open times at once.

import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Clock, Link2, Power, Video } from "lucide-react";
import { Button, Card, Connect, Header, Switch, go, openApp, runFunction, update, useToast, errorText } from "@lemma-plugins/kit";
import { DAY_NAMES, length } from "../time";
import { PROVIDER_LABEL, useBooking } from "./data";
import { appOrigin, onSample, turnOff, turnOn } from "./turnOn";
import { MAIL_PURPOSE, addressOf, useMailAccounts } from "./Setup";

export function Settings() {
  const { settings, page, calendars, reload } = useBooking();
  const toast = useToast();
  const [v, setV] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState("");
  useEffect(() => {
    if (!settings || !page) return;
    setV({
      days: settings.days || [0, 1, 2, 3, 4], day_starts: settings.day_starts, day_ends: settings.day_ends, minutes: settings.minutes,
      buffer_minutes: settings.buffer_minutes, notice_hours: settings.notice_hours, days_ahead: settings.days_ahead,
      max_per_day: settings.max_per_day, handle: page.handle, name: page.name, about: page.about || "", more: page.more || "",
      video: settings.video || "none", chat: page.chat !== false, calendars: settings.calendars || [], event_calendar: settings.event_calendar,
    });
  }, [settings, page]);
  // Read again once a mailbox is connected below.
  const [again, setAgain] = useState(0);
  const mail = useMailAccounts(again);
  if (!settings || !page) return null;
  const set = (k: string, value: unknown) => setV({ ...v, [k]: value });
  const days = (v.days as number[]) || [];
  const cals = (v.calendars as string[]) || [];
  const eventCal = calendars.find((c) => c.id === v.event_calendar);
  const videos = eventCal?.provider === "outlook" ? ["teams", "none"] : ["google_meet", "none"];
  const mailConnector = eventCal?.provider === "outlook" ? "outlook" : "gmail";
  const senders = (mail || []).filter((a) => (eventCal?.provider === "outlook" ? a.connector_id === "outlook" : a.connector_id === "gmail"));
  const sender = String(v.mail_account_id ?? settings?.mail_account_id ?? "");
  const held = onSample(settings, calendars);

  const save = async () => {
    setBusy("save");
    try {
      const out = await runFunction<{ ok: boolean; problem?: string; message: string }>("booking_save", v);
      if (!out.ok) return toast(out.problem || "Couldn't save.");
      // Moved onto the sample calendar: a real visitor there would get no invite.
      const off = page.state === "on" && onSample({ ...settings, calendars: cals, event_calendar: (v.event_calendar as string) || null }, calendars);
      if (off) await update("booking_page", page.id, { state: "off" });
      const slots = await runFunction<{ open: number; errors: string[] }>("booking_slots", { force: true });
      toast(off ? "Saved. Your page is off while bookings go on the sample calendar."
        : slots.errors?.length ? `Saved, but ${slots.errors[0]}` : `Saved. ${slots.open} open times.`);
      await reload();
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const flip = async () => {
    setBusy("flip");
    try {
      if (page.state === "on") await turnOff(settings, page);
      else await turnOn(settings, page, () => undefined);
      await reload();
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="c-app">
      <Header back={{ label: "Bookings", icon: ArrowLeft, onClick: () => go("/") }} title="Settings">
        <Button size="sm" variant="primary" busy={busy === "save"} onClick={() => void save()}>Save</Button>
      </Header>
      <div className="c-body bk-settings">
        <Card title="When you take calls" icon={Clock}>
          <div className="bk-form">
            <div className="c-field"><span>Days</span>
              <div className="bk-days" role="group" aria-label="Days">
                {DAY_NAMES.map((d, i) => (
                  <button key={d} type="button" className="bk-daychip" aria-pressed={days.includes(i)}
                    onClick={() => set("days", days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}>{d}</button>
                ))}
              </div>
            </div>
            <div className="bk-pair">
              <label className="c-field"><span>From</span><input className="c-input" type="time" value={String(v.day_starts || "")} onChange={(e) => set("day_starts", e.target.value)} /></label>
              <label className="c-field"><span>Until</span><input className="c-input" type="time" value={String(v.day_ends || "")} onChange={(e) => set("day_ends", e.target.value)} /></label>
            </div>
            <div className="bk-pair">
              <label className="c-field"><span>Call length</span>
                <select className="c-select" value={Number(v.minutes)} onChange={(e) => set("minutes", Number(e.target.value))}>
                  {[15, 20, 30, 45, 60].map((n) => <option key={n} value={n}>{length(n)}</option>)}
                </select>
              </label>
              <label className="c-field"><span>Buffer either side</span>
                <select className="c-select" value={Number(v.buffer_minutes)} onChange={(e) => set("buffer_minutes", Number(e.target.value))}>
                  {[0, 5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n ? `${n} minutes` : "None"}</option>)}
                </select>
              </label>
            </div>
            <div className="bk-pair">
              <label className="c-field"><span>Notice (hours)</span>
                <input className="c-input" type="number" min={0} max={336} value={Number(v.notice_hours)} onChange={(e) => set("notice_hours", Number(e.target.value))} />
              </label>
              <label className="c-field"><span>How far ahead (days)</span>
                <input className="c-input" type="number" min={1} max={90} value={Number(v.days_ahead)} onChange={(e) => set("days_ahead", Number(e.target.value))} />
              </label>
            </div>
            <label className="c-field bk-narrow"><span>Daily limit</span>
              <input className="c-input" type="number" min={1} max={24} value={Number(v.max_per_day)} onChange={(e) => set("max_per_day", Number(e.target.value))} />
            </label>
          </div>
        </Card>

        <Card title="Your page" icon={Link2}>
          <div className="bk-form">
            <label className="c-field"><span>Address</span>
              <span className="bk-prefix"><span className="c-faint">{new URL(appOrigin()).host}/</span>
                <input className="c-input" value={String(v.handle || "")} maxLength={40} onChange={(e) => set("handle", e.target.value)} /></span>
              <span className="c-field__hint">Changing it breaks the link you've shared.</span>
            </label>
            <label className="c-field"><span>Name</span><input className="c-input" value={String(v.name || "")} maxLength={120} onChange={(e) => set("name", e.target.value)} /></label>
            <label className="c-field"><span>One line about you</span><input className="c-input" value={String(v.about || "")} maxLength={200} onChange={(e) => set("about", e.target.value)} /></label>
            <label className="c-field"><span>More, for the chat</span><textarea className="c-textarea" rows={3} value={String(v.more || "")} maxLength={1500} onChange={(e) => set("more", e.target.value)} /></label>
            <div className="bk-switchrow"><Switch checked={!!v.chat} label="A chat beside the page answers visitors from what it shows" onChange={(x) => set("chat", x)} /></div>
          </div>
        </Card>

        <Card title="Calendars and the video link" icon={CalendarDays}>
          <div className="bk-form">
            <div className="c-field"><span>Keep clear of</span>
              <div className="c-card c-choices">
                {calendars.map((c) => (
                  <label key={c.id} className="c-choice">
                    <input type="checkbox" checked={cals.includes(c.id)} onChange={(e) => set("calendars", e.target.checked ? [...cals, c.id] : cals.filter((x) => x !== c.id))} />
                    <span>{PROVIDER_LABEL[c.provider]}{c.provider === "sample" ? "" : ` · ${c.email}`}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="c-field"><span>Add bookings to</span>
              <select className="c-select" value={String(v.event_calendar || "")} onChange={(e) => set("event_calendar", e.target.value)}>
                {calendars.filter((c) => cals.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{PROVIDER_LABEL[c.provider]}{c.provider === "sample" ? "" : ` · ${c.email}`}</option>)}
              </select>
            </label>
            <label className="c-field"><span><Video size={12} aria-hidden="true" /> Video link</span>
              <select className="c-select" value={String(v.video)} onChange={(e) => set("video", e.target.value)}>
                {videos.map((o) => <option key={o} value={o}>{o === "google_meet" ? "Google Meet" : o === "teams" ? "Microsoft Teams (work or school accounts)" : "None"}</option>)}
              </select>
            </label>
            {eventCal?.provider === "sample" ? (
              <p className="c-faint bk-small">On the sample calendar nothing is sent: a declined visitor is told on the page.</p>
            ) : (
              <label className="c-field"><span>Email a declined booking from</span>
                <select className="c-select" value={sender} onChange={(e) => {
                  const a = senders.find((x) => x.id === e.target.value);
                  setV({ ...v, mail_connector: a ? a.connector_id : "none", mail_account_id: a?.id || null, mail_address: a ? addressOf(a) : null });
                }}>
                  {senders.map((a) => <option key={a.id} value={a.id}>{addressOf(a) || a.connector_id}</option>)}
                  <option value="">Don't email; the page tells them</option>
                </select>
                <span className="c-field__hint">
                  {senders.length ? "From your own mailbox." : `Connect your ${eventCal?.provider === "outlook" ? "Outlook" : "Gmail"} below to email them too.`}
                </span>
              </label>
            )}
            {eventCal && eventCal.provider !== "sample" ? (
              <Connect connector={mailConnector} mode="per_member" purpose={MAIL_PURPOSE[mailConnector]} quiet onReady={() => setAgain((n) => n + 1)} />
            ) : null}
          </div>
        </Card>

        <Card title="Turn the page off" icon={Power}>
          <p className="bk-small c-muted">Off, the page says you aren't taking bookings and your open times stop being worked out. Bookings already made stay on your calendar.</p>
          {held && page.state !== "on" ? (
            <p className="bk-small c-muted bk-note">It can't go on while bookings go on the sample calendar: a real visitor would get no invite. Connect Google Calendar or Outlook in Meetings, then choose it above and save.</p>
          ) : null}
          <div className="bk-row">
            <Button variant={page.state === "on" ? "danger" : "primary"} busy={busy === "flip"} disabled={held && page.state !== "on"} onClick={() => void flip()}>
              {page.state === "on" ? "Turn the page off" : "Turn the page on"}
            </Button>
            {held && page.state !== "on" ? <Button onClick={() => void openApp("meetings")}>Open Meetings</Button> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
