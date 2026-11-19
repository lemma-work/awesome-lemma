// The members' side: your page (its link, on or off, the hours it keeps) and
// the bookings on it, coming up first, each with Meetings' brief.

import { useMemo, useState } from "react";
import { CalendarCheck, CalendarClock, CalendarX, Copy, ExternalLink, FlaskConical, Link2, Settings as Cog, Sparkles, Trash2 } from "lucide-react";
import { Avatar, Banner, Button, Card, Empty, Header, Pill, Segmented, Switch, agoText, go, plural, runFunction, useToast } from "@lemma-plugins/kit";
import { clock, daysText, length, place, shortDay } from "../time";
import { KIND_LABEL, PROVIDER_LABEL, useBooking, type Request } from "./data";
import { pageLink, findWidget, turnOff, turnOn } from "./turnOn";
import { useEffect } from "react";

type View = "ahead" | "declined" | "past";

export function BriefMark({ r }: { r: Request }) {
  if (r.state !== "confirmed") return null;
  if (r.headline) return <Pill tone="ai" icon={Sparkles}>Brief ready</Pill>;
  if (r.brief_state === "failed") return <Pill tone="warning">Brief failed</Pill>;
  return <Pill tone="plain">Writing brief</Pill>;
}

export function KindMark({ r }: { r: Request }) {
  const kind = r.meeting_kind || r.kind;
  if (r.unsure) return <Pill tone="warning">Not sure</Pill>;
  return kind ? <Pill tone="plain" dot={false}>{KIND_LABEL[kind]}</Pill> : null;
}

export function useLink(): string {
  const { page } = useBooking();
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    void findWidget().then((w) => setKey(w?.public_key || null), () => setKey(null));
  }, []);
  return page ? pageLink(page, key) : "";
}

export function Home() {
  const { settings, page, requests, calendars, reload, errors } = useBooking();
  const toast = useToast();
  const link = useLink();
  const [view, setView] = useState<View>("ahead");
  const [busy, setBusy] = useState("");
  const zone = settings?.timezone || "UTC";
  const now = Date.now();
  const lists = useMemo(() => {
    const ahead = requests.filter((r) => r.state !== "declined" && new Date(r.ends_at || r.starts_at).getTime() >= now);
    const declined = requests.filter((r) => r.state === "declined").sort((a, b) => (b.handled_at || b.created_at).localeCompare(a.handled_at || a.created_at));
    const past = requests.filter((r) => r.state === "confirmed" && new Date(r.ends_at || r.starts_at).getTime() < now).reverse();
    return { ahead, declined, past };
  }, [requests, now]);
  if (!settings || !page) return null;
  const rows = lists[view];
  const open = (page.slots || []).filter((s) => new Date(s).getTime() >= now + page.notice_hours * 3600_000);
  const unsure = lists.ahead.filter((r) => r.unsure).length;
  const used = calendars.filter((c) => (settings.calendars || []).includes(c.id));
  const sample = used.some((c) => c.provider === "sample");

  const flip = async (on: boolean) => {
    setBusy("flip");
    try {
      if (on) {
        const ok = await turnOn(settings, page, () => undefined);
        toast(ok ? "Your page is on." : "Some steps didn't work: open settings to see which.");
      } else {
        await turnOff(settings, page);
        toast("Your page is off. Visitors see that you aren't taking bookings.");
      }
      await reload();
    } finally {
      setBusy("");
    }
  };
  const sampleRun = async (mode: "load" | "clear") => {
    setBusy(mode);
    try {
      const out = await runFunction<{ message: string }>("booking_sample_data", { mode });
      if (mode === "clear") await runFunction("booking_needs_you", {});
      toast(out.message);
      await reload();
    } catch (e) {
      toast(`Couldn't ${mode === "load" ? "add" : "clear"} the sample: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="c-app">
      <Header icon={CalendarCheck} title="Booking page" count={lists.ahead.length ? plural(lists.ahead.length, "booking") + " ahead" : undefined}>
        <Button size="sm" icon={Cog} onClick={() => go("/settings")}>Settings</Button>
      </Header>
      <div className="c-body bk-home">
        <div className="bk-main">
          <div className="c-toolbar bk-toolbar">
            <Segmented<View> label="Bookings" value={view} onChange={setView} items={[
              { id: "ahead", label: "Coming up", count: lists.ahead.length },
              { id: "declined", label: "Declined", count: lists.declined.length },
              { id: "past", label: "Past", count: lists.past.length },
            ]} />
            {unsure ? <Pill tone="warning">{plural(unsure, "booking")} to check</Pill> : null}
          </div>
          {errors.requests ? <Banner tone="danger">Couldn't read your bookings: {errors.requests}</Banner> : null}
          {rows.length ? (
            <div className="c-card bk-list" role="list">
              {rows.map((r) => <Row key={r.id} r={r} zone={zone} />)}
            </div>
          ) : (
            <Card>
              <Empty icon={view === "declined" ? CalendarX : CalendarClock}
                title={view === "ahead" ? "No bookings coming up" : view === "declined" ? "Nothing declined" : "No past bookings"}
                action={view === "ahead" && link ? <Button icon={Copy} onClick={() => void navigator.clipboard.writeText(link).then(() => toast("Link copied."))}>Copy your link</Button> : undefined}>
                {view === "ahead" ? "Share your link; a booking shows here the moment it's taken, with a brief on who's coming." : view === "declined" ? "Requests that clash, came too late or didn't read as genuine show here, with the reason they were sent." : "Calls that are over."}
              </Empty>
            </Card>
          )}
        </div>

        <aside className="bk-side">
          <Card title="Your page" icon={Link2} action={<Switch checked={page.state === "on"} label={page.state === "on" ? "On" : "Off"} disabled={!!busy} onChange={(v) => void flip(v)} />}>
            <div className="bk-props">
              <div className="bk-linkline">
                <span className="c-ellipsis">{link ? link.split("?")[0].replace(/^https?:\/\//, "") : "…"}</span>
                <Button size="sm" variant="ghost" icon={Copy} label="Copy link" onClick={() => void navigator.clipboard.writeText(link).then(() => toast("Link copied."))} />
                <Button size="sm" variant="ghost" icon={ExternalLink} label="Open your page" onClick={() => window.open(link, "_blank", "noopener")} />
              </div>
              <dl>
                <dt>State</dt><dd>{page.state === "on" ? <Pill tone="success">Taking bookings</Pill> : <Pill tone="plain">Off</Pill>}</dd>
                <dt>Open times</dt><dd>{open.length ? `${open.length}, next ${shortDay(new Date(open[0]), zone)} ${clock(new Date(open[0]), zone)}` : "None in reach"}</dd>
                <dt>Hours</dt><dd>{daysText(settings.days || [])}, {settings.day_starts}–{settings.day_ends} ({place(zone)})</dd>
                <dt>Calls</dt><dd>{length(settings.minutes || 30)}, {settings.buffer_minutes} min buffer, {settings.max_per_day} a day at most</dd>
                <dt>Notice</dt><dd>{settings.notice_hours} hours, up to {settings.days_ahead} days ahead</dd>
                <dt>Keeps clear of</dt><dd>{used.map((c) => (c.provider === "sample" ? PROVIDER_LABEL.sample : c.email)).join(", ") || "No calendar"}</dd>
                <dt>New bookings</dt>
                <dd>{settings.trigger?.include_outside_rows ? <>Reach you{settings.trigger.checked_at ? <span className="c-faint">, checked {agoText(settings.trigger.checked_at)}</span> : null}</> : <Pill tone="danger">Not reaching you</Pill>}</dd>
                <dt>Times worked out</dt><dd>{page.slots_at ? agoText(page.slots_at) : "Not yet"}</dd>
              </dl>
            </div>
          </Card>
          {sample ? (
            <Card title="Sample" icon={FlaskConical}>
              <p className="c-muted bk-small">Book your page as a made-up visitor at a .example address. It goes through everything a real booking does, on the sample calendar, and sends nothing.</p>
              <div className="bk-row">
                <Button size="sm" busy={busy === "load"} onClick={() => void sampleRun("load")}>Add a sample booking</Button>
                <Button size="sm" variant="ghost" icon={Trash2} busy={busy === "clear"} onClick={() => void sampleRun("clear")}>Clear it</Button>
              </div>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Row({ r, zone }: { r: Request; zone: string }) {
  const start = new Date(r.starts_at);
  return (
    <button type="button" role="listitem" className="bk-item" onClick={() => go(`/b/${r.id}`)}>
      <span className="bk-item__when">
        <span>{shortDay(start, zone)}</span>
        <span className="c-faint">{clock(start, zone)}</span>
      </span>
      <Avatar name={r.name} email={r.email} size={28} />
      <span className="bk-item__main">
        <span className="bk-item__who">{r.name}<span className="c-faint"> · {r.email}</span>{r.sample ? <span className="c-faint"> · sample</span> : null}</span>
        <span className="bk-item__sub c-muted">{r.state === "declined" ? r.reason : r.headline || r.about}</span>
      </span>
      <span className="bk-item__marks">
        {r.state === "declined" ? (
          r.told?.sent ? <Pill tone="plain">Emailed</Pill> : <Pill tone="plain" dot={false}>Told on the page</Pill>
        ) : r.state === "requested" ? <Pill tone="info">Checking</Pill> : (
          <>
            <KindMark r={r} />
            <BriefMark r={r} />
          </>
        )}
      </span>
    </button>
  );
}
