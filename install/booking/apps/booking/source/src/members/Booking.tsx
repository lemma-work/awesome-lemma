// One booking: who, when (in your time and theirs), what they want to talk
// about, Meetings' brief, what the Decisions read made of it, and, when it
// wasn't sure, settling it (which teaches Meetings' next read too).

import { useState } from "react";
import { ArrowLeft, CalendarCheck, ExternalLink, Mail, Sparkles, Video } from "lucide-react";
import { Avatar, Button, Card, Empty, Header, Markdown, Pill, agoText, go, openApp, runFunction, update, useToast } from "@lemma-plugins/kit";
import { clock, place, span } from "../time";
import { KINDS, KIND_LABEL, answerOf, useBooking, type Kind, type Request } from "./data";
import { BriefMark, KindMark } from "./Home";

function confidence(c: number | null | undefined): string {
  return c == null ? "" : ` (${Math.round(c * 100)}%)`;
}

export function Booking({ id }: { id: string }) {
  const { requests, settings, reload } = useBooking();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const r = requests.find((x) => x.id === id);
  const back = { label: "Bookings", icon: ArrowLeft, onClick: () => go("/") };
  if (!r) {
    return (
      <div className="c-app">
        <Header back={back} title="Booking" />
        <div className="c-body"><Card><Empty title="This booking isn't on your page">It may have been cleared, or it's someone else's.</Empty></Card></div>
      </div>
    );
  }
  const zone = settings?.timezone || "UTC";
  const theirs = r.zone || zone;
  const start = new Date(r.starts_at);
  const end = new Date(r.ends_at || start.getTime() + (settings?.minutes || 30) * 60_000);
  const genuine = answerOf(r, "genuine");
  const kind = answerOf(r, "kind");

  const settle = async (k: Kind) => {
    setBusy(k);
    try {
      if (r.meeting_id) await runFunction("meetings_settle", { meeting_id: r.meeting_id, kind: k, wants_brief: true });
      await update("booking_request", r.id, { kind: k, genuine: true, unsure: false });
      await runFunction("booking_needs_you", {});
      toast(`Kept as ${KIND_LABEL[k].toLowerCase()}. Meetings learns from it.`);
      await reload();
    } catch (e) {
      toast(`Couldn't keep it: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="c-app">
      <Header back={back} title={r.name} />
      <div className="c-body">
        <div className="c-record-head bk-record-head">
          <Avatar name={r.name} email={r.email} size={40} />
          <div className="bk-record-head__main">
            <h1>{r.name}</h1>
            <p className="c-muted">{r.email}{r.sample ? " · sample visitor" : ""}</p>
            <div className="c-record-head__facts">
              {r.state === "confirmed" ? <Pill tone="success" icon={CalendarCheck}>Booked</Pill> : r.state === "declined" ? <Pill tone="danger">Declined</Pill> : <Pill tone="info">Checking</Pill>}
              <KindMark r={r} />
              <BriefMark r={r} />
            </div>
          </div>
          <div className="c-record-head__actions">
            {r.meeting_id ? <Button size="sm" icon={ExternalLink} onClick={() => void openApp("meetings", `/${r.meeting_id}`)}>Open in Meetings</Button> : null}
          </div>
        </div>

        <div className="c-split c-split--record bk-split">
          <div className="bk-col">
            {r.unsure && r.state === "confirmed" ? (
              <Card title="Not sure" icon={Sparkles}>
                <p className="bk-small">
                  {genuine?.value === false || (genuine && (genuine.confidence ?? 1) < 0.5)
                    ? "The read wasn't sure this is a genuine request, so it was booked and left for you. "
                    : ""}
                  {!r.kind ? "It wasn't sure what kind of meeting this is, so the brief may miss. " : ""}
                  What is it?
                </p>
                <div className="bk-row bk-kinds">
                  {KINDS.map((k) => (
                    <Button key={k} size="sm" busy={busy === k} variant={(r.meeting_kind || r.kind) === k ? "primary" : "default"} onClick={() => void settle(k)}>
                      {KIND_LABEL[k]}
                    </Button>
                  ))}
                </div>
              </Card>
            ) : null}
            <Card title="What they want to talk about" icon={Mail}>
              <p className="bk-about">{r.about}</p>
            </Card>
            {r.state === "confirmed" ? (
              <Card title="Brief" icon={Sparkles} action={r.headline ? <Pill tone="ai" icon={Sparkles}>Meetings</Pill> : undefined}>
                {r.brief ? (
                  <>
                    {r.headline ? <p className="bk-headline">{r.headline}</p> : null}
                    <Markdown text={r.brief} />
                  </>
                ) : (
                  <p className="c-muted bk-small">
                    {r.brief_state === "failed" ? "Meetings couldn't write the brief. Open it in Meetings to try again." : "Meetings is writing the brief on who's coming. It shows here in a minute or so."}
                  </p>
                )}
              </Card>
            ) : null}
            {r.state === "declined" ? (
              <Card title="Why it was declined" icon={Mail}>
                <p className="bk-small">{r.reason}</p>
                {r.told ? (
                  <div className="bk-told">
                    <p className="c-faint bk-small">
                      {r.told.sent ? `Emailed to ${r.told.to}${r.told.from ? ` from ${r.told.from}` : ""}` : `Not emailed: ${r.told.why || "no mailbox chosen"}`}
                    </p>
                    {r.told.body ? <pre className="bk-mail">{r.told.body}</pre> : null}
                  </div>
                ) : <p className="c-faint bk-small">Nobody was emailed: the address was never confirmed.</p>}
              </Card>
            ) : null}
          </div>
          <aside className="bk-col">
            <Card title="When">
              <div className="bk-props">
                <dl>
                  <dt>Your time</dt><dd>{span(start, end, zone)}<span className="c-faint"> ({place(zone)})</span></dd>
                  {theirs !== zone ? (<><dt>Their time</dt><dd>{span(start, end, theirs)}<span className="c-faint"> ({place(theirs)})</span></dd></>) : null}
                  {r.join_url ? (<><dt>Video</dt><dd><a href={r.join_url} target="_blank" rel="noopener noreferrer"><Video size={13} aria-hidden="true" /> {r.join_url.replace(/^https?:\/\//, "")}</a></dd></>) : null}
                  <dt>Asked</dt><dd>{agoText(r.created_at)}</dd>
                </dl>
              </div>
            </Card>
            <Card title="What the read made of it" icon={Sparkles}>
              <div className="bk-props">
                <dl>
                  <dt>Genuine</dt><dd>{genuine ? `${genuine.value === true ? "Yes" : genuine.value === false ? "No" : "Can't tell"}${confidence(genuine.confidence)}` : "—"}</dd>
                  <dt>Kind</dt><dd>{kind && typeof kind.value === "string" ? `${KIND_LABEL[kind.value as Kind] || kind.value}${confidence(kind.confidence)}` : "—"}</dd>
                  <dt>Checked</dt><dd>{r.handled_at ? `${clock(new Date(r.handled_at), zone)}, ${agoText(r.handled_at)}` : "Not yet"}</dd>
                </dl>
                <p className="c-faint bk-small">One Decisions call per request. Under 50% counts as not sure.</p>
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

export type { Request };
