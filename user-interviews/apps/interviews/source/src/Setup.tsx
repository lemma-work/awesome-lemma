// Set-up, once for the Lemma and once for each person: the product findings
// are filed under and the contact rules (the team's); and your part, each a
// button here: the mailbox invites go from, where your calls' words come from
// afterwards, your booking page, and your own checks on your meetings.

import { useEffect, useState } from "react";
import { CalendarDays, Check, FlaskConical, Link2, Mail, MessagesSquare, Radio } from "lucide-react";
import { Button, DEMO, Field, Pill, Spinner, errorText, openApp, runFunction, useToast } from "@lemma-plugins/kit";
import { ensureMine, setNotesFrom, useUI, useWho, where, type Where } from "./data";
import { to } from "./route";

export function Setup() {
  const ui = useUI();
  const who = useWho();
  const toast = useToast();
  const s = ui.settings;
  const [w, setW] = useState<Where | null>(null);
  const [product, setProduct] = useState<string>(s?.product_id || "");
  const [name, setName] = useState("");
  const [gap, setGap] = useState(String(s?.invite_gap_days || 30));
  const [noShow, setNoShow] = useState(String(s?.no_show_days || 90));
  const [nudge, setNudge] = useState(String(s?.nudge_days || 4));
  const [busy, setBusy] = useState("");

  const look = async () => {
    try {
      const got = await where();
      setW(got);
      if (!product && got.settings.product_id) setProduct(got.settings.product_id);
      else if (!product && got.products[0]) setProduct(got.products[0].id);
    } catch (e) {
      toast(`Couldn't check your set-up: ${errorText(e)}`);
    }
  };
  useEffect(() => {
    void look();
    // Coming back from Mail, Meetings or Booking's own set-up: look again.
    const back = () => document.visibilityState === "visible" && void look();
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy("save");
    try {
      const out = await runFunction<{ message?: string }>("interviews_setup", {
        mode: "save", product_id: product && product !== "new" ? product : null, product_name: product === "new" || !product ? name : null,
        invite_gap_days: Number(gap) || 30, no_show_days: Number(noShow) || 90, nudge_days: Number(nudge) || 4,
      });
      if (who.me && !DEMO) {
        const problem = await ensureMine(who.me, ui.member);
        if (problem) toast(problem);
      }
      toast(out.message || "Saved.");
      await ui.reload();
      to.studies();
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const sample = async () => {
    setBusy("sample");
    try {
      const out = await runFunction<{ message?: string }>("interviews_sample_data", { mode: "load" });
      toast(out.message || "Loaded the sample.");
      await ui.reload();
      to.studies();
    } catch (e) {
      toast(`Couldn't load the sample: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const after = async (value: "meet" | "notes") => {
    setBusy(value);
    try {
      await setNotesFrom(value);
      await look();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  };
  const openOther = async (app: string, label: string) => {
    if (!(await openApp(app, "/"))) toast(`Open ${label} from this Lemma to set it up.`);
  };

  const done = !!s?.setup_done_at;
  return (
    <div className="c-app">
      <main className="c-setup ui-setup">
        <span className="ui-top__icon ui-setup__icon" aria-hidden="true"><MessagesSquare size={18} /></span>
        <h1>{done ? "User interviews set-up" : "Set up User interviews"}</h1>
        <p className="c-setup__lead">Studies the team runs by talking to people: who fits, the invites, the calls, and what each call found. The product and the contact rules are the team's; the rest is yours, so invites go from your mailbox and your calls are read for you.</p>

        <section className="ui-setsec">
          <h2>The product findings are filed under</h2>
          {w ? (
            <div className="c-stack" style={{ gap: 8 }}>
              {w.products.length ? (
                <select className="c-input" value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Product">
                  {w.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value="new">Another product…</option>
                </select>
              ) : null}
              {!w.products.length || product === "new" ? (
                <input className="c-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your product's name" aria-label="Product name" />
              ) : null}
            </div>
          ) : <Spinner />}
        </section>

        <section className="ui-setsec">
          <h2>Contact rules, for the whole team</h2>
          <div className="ui-rulegrid">
            <Field label="Days between invites"><input className="c-input ui-numin" type="number" min={1} value={gap} onChange={(e) => setGap(e.target.value)} /></Field>
            <Field label="Days of rest after a no-show"><input className="c-input ui-numin" type="number" min={1} value={noShow} onChange={(e) => setNoShow(e.target.value)} /></Field>
            <Field label="Working days before a nudge"><input className="c-input ui-numin" type="number" min={1} value={nudge} onChange={(e) => setNudge(e.target.value)} /></Field>
          </div>
          <p className="c-setup__note">Never anyone who asked not to be invited again. A person can invite someone resting anyway; who did is kept on their row.</p>
        </section>

        <section className="ui-setsec">
          <h2>Your part</h2>
          {!w ? <Spinner /> : (
            <div className="ui-steps">
              <Step icon={Mail} title="Your mailbox" ok={w.mail.ok && !w.mail.sample}
                said={w.mail.ok ? (w.mail.sample ? "Mail is on its sample mailbox: invites can be written, not sent." : `Invites go from ${w.mail.email}, only when you press Send.`) : "Invites go from your own mailbox, written in your voice."}
                action={!w.mail.ok || w.mail.sample ? <Button size="sm" onClick={() => void openOther("inbox", "Mail")}>Set up Mail</Button> : null} />
              <Step icon={CalendarDays} title="After a call" ok={w.meetings.ok && w.meetings.notes_from !== "skip"}
                said={!w.meetings.ok ? "Meetings puts your calls on the calendar and keeps what was said afterwards." : "Where a call's words come from afterwards:"}
                action={!w.meetings.ok ? <Button size="sm" onClick={() => void openOther("meetings", "Meetings")}>Set up Meetings</Button> : (
                  <div className="ui-line">
                    <Button size="sm" busy={busy === "meet"} className={w.meetings.notes_from === "meet" ? "ui-on" : undefined} aria-pressed={w.meetings.notes_from === "meet"} onClick={() => void after("meet")}>
                      {w.meetings.notes_from === "meet" ? <Check size={13} aria-hidden="true" /> : null} Meet transcript</Button>
                    <Button size="sm" busy={busy === "notes"} className={w.meetings.notes_from === "notes" ? "ui-on" : undefined} aria-pressed={w.meetings.notes_from === "notes"} onClick={() => void after("notes")}>
                      {w.meetings.notes_from === "notes" ? <Check size={13} aria-hidden="true" /> : null} My notes</Button>
                  </div>
                )} />
              <Step icon={Link2} title="Your booking page" ok={w.booking.ok}
                said={w.booking.ok ? `Each invite carries ${w.booking.page_url}${w.booking.on ? "" : " (on its sample calendar for now)"}.` : "Each invite carries a link where they pick a time with you."}
                action={!w.booking.ok ? <Button size="sm" onClick={() => void openOther("booking", "Booking page")}>Turn on your booking page</Button> : null} />
              <Step icon={Radio} title="Your own checks" ok={!!ui.member?.ready_at}
                said={ui.member?.ready_at ? "A booking or a call's transcript is noticed as it comes in, with a check each morning at 09:00." : "Made when you save: a booking or a call's transcript is noticed as it comes in, and a check each morning at 09:00."} />
            </div>
          )}
        </section>

        <div className="c-setup__row">
          <Button variant="primary" busy={busy === "save"} disabled={!w || (!w.products.length && !name.trim()) || (product === "new" && !name.trim())} onClick={() => void save()}>{done ? "Save" : "Start"}</Button>
          {!ui.sample && !done ? <Button icon={FlaskConical} busy={busy === "sample"} onClick={() => void sample()}>Look around with a sample</Button> : null}
          {done || ui.sample ? <Button variant="ghost" onClick={() => to.studies()}>Back to studies</Button> : null}
        </div>
        <p className="c-setup__note">Nobody is paid through Lemma: when you thank someone for their time, you tick Thanked yourself.</p>
      </main>
    </div>
  );
}

function Step({ icon: Icon, title, ok, said, action }: { icon: typeof Mail; title: string; ok: boolean; said: string; action?: React.ReactNode }) {
  return (
    <div className="ui-step">
      <span className="ui-step__icon" aria-hidden="true"><Icon size={15} /></span>
      <div className="c-grow">
        <div className="ui-line"><span className="ui-strong">{title}</span>{ok ? <Pill tone="success">Ready</Pill> : <Pill tone="warning">To do</Pill>}</div>
        <p className="c-muted ui-small">{said}</p>
        {action ? <div className="ui-gap">{action}</div> : null}
      </div>
    </div>
  );
}
