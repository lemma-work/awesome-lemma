// One person's drawer (/p/<id>): where they stand, the note drafted for them
// (Send, Edit, Not now), their beta from sign-up to the last thing they said,
// and what a member can do: open them in Mail or PostHog, set their fit,
// tick a by-hand flag, take them out.

import { useState } from "react";
import { ExternalLink, Mail, Sparkles, UserMinus } from "lucide-react";
import {
  Avatar, Button, DEMO, Menu, MenuItem, Pill, Sheet, day, demoNote, openApp, runFunction, update, useToast,
} from "@lemma-plugins/kit";
import { openDraft, sendingBox, useEA, type Beta, type Tester } from "./data";
import { FLAG_WORDS, FitPill, ProofPill, StatusPill, sourceOf } from "./marks";
import { sendDraft, why } from "./wire";

const NOTE_LINE: Record<string, string> = {
  chase: "The only note they get. After it, they show as quiet until they use it or reply.",
  checkin: "Links to the three-question check-in page; answers land in what they said.",
  invite: "Sent when you press Let in on the next batch, or here.",
  not_now: "Says why not this round, and what would change it.",
};
const NOTE_TITLE: Record<string, string> = { chase: "One note drafted", checkin: "Check-in drafted", invite: "Invite drafted", not_now: "Not-now note drafted" };

export function Person({ t, beta, onClose }: { t: Tester; beta: Beta; onClose: () => void }) {
  const { drafts, settings, mailboxes, reload } = useEA();
  const toast = useToast();
  const d = openDraft(t, drafts);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const box = sendingBox(settings, mailboxes);
  const kind = d?.built_from?.kind || "invite";
  const lines = [...(t.timeline || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast(why(e));
    } finally {
      setBusy("");
    }
  };

  const send = () => run("send", async () => {
    if (!d) return;
    if (t.sample || DEMO) {
      demoNote("This is the sample: nothing is sent. In your Lemma, Send hands the note to Mail, from your own mailbox.");
      return;
    }
    const out = await sendDraft(d, editing ? text : undefined);
    toast(out.sent ? `Sent to ${t.name || t.handle}.` : out.message);
    setEditing(false);
    await reload();
  });
  const notNow = () => run("skip", async () => {
    if (!d) return;
    await update("draft", d.id, { state: "discarded" });
    toast("Set aside. Nothing was sent.");
    await reload("drafts");
  });
  const saveEdit = () => run("edit", async () => {
    if (!d) return;
    await update("draft", d.id, { body: text });
    setEditing(false);
    toast("Saved the note.");
    await reload("drafts");
  });
  const setFit = (fit: string) => run("fit", async () => {
    const out = await runFunction<{ message?: string }>("early_access_take_out", { tester_id: t.id, fit });
    toast(out.message || "Saved.");
    await reload("testers");
  });
  const tick = (on: boolean) => run("tick", async () => {
    const out = await runFunction<{ message?: string }>("early_access_take_out", { tester_id: t.id, flag_on: on });
    toast(out.message || "Saved.");
    await reload("testers");
  });
  const takeOut = () => run("out", async () => {
    const reason = window.prompt(`Why is ${t.name || t.handle} leaving the beta? (optional)`) ?? null;
    if (reason === null) return;
    const out = await runFunction<{ message?: string }>("early_access_take_out", { tester_id: t.id, reason });
    toast(out.message || "Taken out.");
    await reload("testers");
  });
  const posthog = beta.posthog_url ? `${beta.posthog_url.replace(/\/$/, "")}/persons?search=${encodeURIComponent(t.handle)}` : null;

  return (
    <Sheet open title={t.name || t.handle} onClose={onClose}>
      <div className="ea-person">
        <Avatar name={t.name} email={t.handle} size={40} />
        <div className="ea-person__text">
          <div className="ea-person__name">{t.name || t.handle}</div>
          <div className="ea-sub">{[t.role, t.company_name || "personal account"].filter(Boolean).join(", ")} · {t.handle}</div>
        </div>
      </div>
      <div className="ea-pills">
        <StatusPill status={t.status} />
        <FitPill fit={t.fit} />
        {t.flag_state ? <Pill tone={t.flag_state === "failed" ? "danger" : t.flag_state === "on" ? "success" : "plain"} title={t.flag_note || undefined}>{FLAG_WORDS[t.flag_state]}</Pill> : null}
        <ProofPill t={t} />
      </div>
      {t.fit_reason ? <p className="ea-reason"><Sparkles size={13} aria-hidden="true" /> {t.fit_reason}</p> : null}
      {t.flag_state === "failed" && t.flag_note ? <p className="ea-warn">{t.flag_note}</p> : null}

      {d ? (
        <section className="ea-note" aria-label="Drafted note">
          <div className="ea-note__head">
            <Sparkles size={14} aria-hidden="true" />
            <span>{NOTE_TITLE[kind]}</span>
            <Pill tone="ai" dot={false}>ai</Pill>
            <span className="ea-sub ea-push">{box ? `from ${box.email}` : "no mailbox yet"}</span>
          </div>
          <div className="ea-sub">{d.subject}</div>
          {editing ? (
            <textarea className="c-textarea ea-note__edit" rows={7} value={text} onChange={(e) => setText(e.target.value)} aria-label="The note" />
          ) : (
            <p className="ea-note__body">{d.body}</p>
          )}
          <div className="ea-row">
            <Button variant="primary" size="sm" icon={Mail} busy={busy === "send"} onClick={() => void send()} disabled={!box && !t.sample && !DEMO}>Send</Button>
            {editing ? (
              <Button size="sm" busy={busy === "edit"} onClick={() => void saveEdit()}>Save</Button>
            ) : (
              <Button size="sm" onClick={() => { setText(d.body || ""); setEditing(true); }}>Edit</Button>
            )}
            <Button variant="ghost" size="sm" busy={busy === "skip"} onClick={() => void notNow()}>Not now</Button>
          </div>
          <p className="ea-sub">{!box && !t.sample ? "Your mailbox isn't set up in Mail yet, so this waits as a draft. " : ""}{NOTE_LINE[kind]}</p>
        </section>
      ) : null}

      <h3 className="ea-h3">Their beta</h3>
      <ol className="ea-tl">
        {lines.map((l, i) => (
          <li key={i}>
            <span className="ea-tl__when">{day(l.at)}</span>
            <div>
              <div>{l.what}{l.ai ? <> <Pill tone="ai" dot={false}>ai</Pill></> : null}</div>
              {l.quote ? <div className="ea-quote">{l.quote}{l.source ? <span className="ea-sub"> · {sourceOf(l.source)}</span> : null}</div> : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="ea-row ea-row--acts">
        <Button size="sm" icon={Mail} onClick={() => void openApp("inbox", "/").then((ok) => { if (!ok) toast("Mail isn't open here."); })}>Open in Mail</Button>
        {posthog ? <Button size="sm" icon={ExternalLink} onClick={() => window.open(posthog, "_blank", "noopener")}>Open in PostHog</Button> : null}
        <Menu label="Set fit" size="sm" title="Set their fit by hand">
          {(close) => (["strong", "maybe", "not_now"] as const).map((f) => (
            <MenuItem key={f} onSelect={() => { close(); void setFit(f); }}>{f === "not_now" ? "Not now" : f[0].toUpperCase() + f.slice(1)}</MenuItem>
          ))}
        </Menu>
        {t.flag_state === "by_hand" ? <Button size="sm" busy={busy === "tick"} onClick={() => void tick(true)}>Flag is on for them</Button> : null}
        {t.status !== "left" ? <Button variant="ghost" size="sm" icon={UserMinus} busy={busy === "out"} onClick={() => void takeOut()}>Take out of the beta</Button> : null}
      </div>
      {t.left_reason ? <p className="ea-sub">Left: {t.left_reason}</p> : null}
    </Sheet>
  );
}
