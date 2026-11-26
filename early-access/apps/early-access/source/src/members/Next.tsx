// Pick next batch (/b/<beta>/next): the people waiting, ranked by fit with a
// one-line reason each, the top N ticked, a line under the batch. The right
// side says what the press does, with the invites drafted in the person's
// own mailbox. Nothing is sent and no flag changes until they press.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Flag, Mail, MessageSquare, Sparkles } from "lucide-react";
import { Avatar, Button, DEMO, Pill, Segmented, demoNote, plural, runFunction, useToast } from "@lemma-plugins/kit";
import { sendingBox, useEA, type Beta, type Fit, type Tester } from "./data";
import { FitPill } from "./marks";
import { to } from "./route";
import { sendDraft, startDrafts, why } from "./wire";

type FitFilter = "all" | Fit;
const FIT_ORDER = { strong: 0, maybe: 1, not_now: 3 } as const;

function waitedDays(t: Tester): number {
  return t.signed_up_at ? Math.max(0, Math.floor((Date.now() - Date.parse(t.signed_up_at)) / 864e5)) : 0;
}

export function Next({ beta }: { beta: Beta }) {
  const { testers, drafts, batches, settings, mailboxes, reload } = useEA();
  const toast = useToast();
  const [size, setSize] = useState<string>(String(beta.batch_size || 10));
  const [fitFilter, setFitFilter] = useState<FitFilter>("all");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState("");
  const asked = useRef(new Set<string>());
  const box = sendingBox(settings, mailboxes);

  const waiting = useMemo(() => testers.filter((t) => t.beta_id === beta.id && t.status === "waiting")
    .sort((a, b) => FIT_ORDER[a.fit || "maybe"] - FIT_ORDER[b.fit || "maybe"] + (a.fit ? 0 : 0.5) - (b.fit ? 0 : 0.5)
      || (b.fit_sure || 0) - (a.fit_sure || 0) || String(a.signed_up_at).localeCompare(String(b.signed_up_at))), [testers, beta.id]);
  const n = Number(size) || 10;
  const defaults = useMemo(() => new Set(waiting.filter((t) => t.fit !== "not_now").slice(0, n).map((t) => t.id)), [waiting, n]);
  const chosen = picked ?? defaults;
  const rows = waiting.filter((t) => fitFilter === "all" || t.fit === fitFilter);
  const counts = { all: waiting.length, strong: 0, maybe: 0, not_now: 0 } as Record<FitFilter, number>;
  for (const t of waiting) if (t.fit) counts[t.fit] += 1;
  const chosenList = waiting.filter((t) => chosen.has(t.id));
  const invites = chosenList.map((t) => drafts.find((d) => d.built_from?.tester_id === t.id && d.built_from?.kind === "invite" && d.state !== "discarded" && d.state !== "sent") || null);
  const drafted = invites.filter(Boolean).length;
  const notNow = waiting.filter((t) => t.fit === "not_now");
  const lastBatch = batches.find((b) => b.beta_id === beta.id);
  const oldest = waiting.reduce((m, t) => Math.max(m, waitedDays(t)), 0);
  const unknown = chosenList.filter((t) => t.email_proof === "not_confirmed").length;

  // Invites are written once the batch is chosen: one draft each, in this person's mailbox.
  useEffect(() => {
    const missing = chosenList.filter((t, i) => !invites[i] && !asked.current.has(t.id)).map((t) => t.id);
    if (!missing.length) return;
    const timer = window.setTimeout(() => {
      for (const id of missing) asked.current.add(id);
      void startDrafts("invite", missing).catch((e) => toast(`The invites weren't started: ${why(e)}`));
    }, DEMO ? 300 : 1200);
    return () => window.clearTimeout(timer);
  }, [chosenList.map((t) => t.id).join(","), drafted]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (drafted < chosenList.length && !DEMO) {
      const timer = window.setInterval(() => void reload("drafts"), 5000);
      return () => window.clearInterval(timer);
    }
  }, [drafted, chosenList.length, reload]);

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const letIn = async (writeMyself: boolean) => {
    if (!chosenList.length) return;
    setBusy(writeMyself ? "self" : "send");
    try {
      const out = await runFunction<{ ok: boolean; message: string; problems?: string[] }>("early_access_let_in", {
        beta_id: beta.id, tester_ids: chosenList.map((t) => t.id), write_myself: writeMyself,
      });
      if (!out.ok) {
        toast(out.message);
        return;
      }
      let sent = 0;
      const notes: string[] = [...(out.problems || [])];
      if (!writeMyself) {
        if (beta.sample || DEMO) notes.push("This is the sample: the invites stay as drafts and nothing is sent.");
        else if (!box) notes.push("Your mailbox isn't set up in Mail yet, so the invites wait as drafts.");
        else {
          for (const d of invites) {
            if (!d) continue;
            const r = await sendDraft(d);
            if (r.sent) sent += 1;
            else notes.push(r.message);
          }
        }
      }
      toast([out.message, writeMyself ? "" : sent ? `${plural(sent, "invite")} sent.` : "", ...new Set(notes)].filter(Boolean).join(" "));
      setPicked(null);
      await reload();
      to.roster(beta.id);
    } catch (e) {
      toast(why(e));
    } finally {
      setBusy("");
    }
  };

  const draftNotNow = async () => {
    setBusy("notnow");
    try {
      if (DEMO) demoNote("In your Lemma, a short note is drafted to each, in your mailbox, saying why not this round. Nothing is sent.");
      else {
        const k = await startDrafts("not_now", notNow.map((t) => t.id));
        toast(`Writing ${plural(k, "note")} in your mailbox. Nothing is sent.`);
      }
    } catch (e) {
      toast(why(e));
    } finally {
      setBusy("");
    }
  };

  const current = invites.filter(Boolean)[Math.min(shown, Math.max(0, drafted - 1))] || null;
  const currentFor = current ? chosenList.find((t) => t.id === current.built_from?.tester_id) : null;
  const flagLine = beta.flag_tool === "posthog"
    ? { title: `${plural(chosenList.length, "person", "people")} join the PostHog cohort${beta.cohort_name ? ` "${beta.cohort_name}"` : ""}`,
        sub: !beta.cohort_id ? "No cohort is picked for the flag yet, so nobody can be added to it: pick one in the beta's settings, or they're let in with the flag off."
          : `Flag ${beta.flag_key || ""} turns on for them within a minute. Anyone PostHog doesn't know yet is added the hour after their first sign-in.` }
    : beta.flag_tool === "by_hand"
      ? { title: `Turn the feature on for ${plural(chosenList.length, "person", "people")} in your own tool`, sub: "Each shows a tick to set once it's on for them." }
      : { title: "No flag: the invite is the access", sub: "They're in as soon as they read it." };

  return (
    <>
      <header className="ea-top">
        <button type="button" className="ea-crumb" onClick={() => to.roster(beta.id)}>{beta.name}</button>
        <ChevronRight size={14} className="c-faint" aria-hidden="true" />
        <h1 className="ea-top__title">Let people in</h1>
        <span className="ea-top__since ea-push">{lastBatch?.picked_at ? `Last batch ${new Date(lastBatch.picked_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ` : ""}about {beta.batch_size} a week</span>
      </header>
      <div className="ea-split">
        <main className="ea-main">
          <div className="ea-bar">
            <span className="ea-bar__label">Batch</span>
            <Segmented label="Batch size" value={size} onChange={(v) => { setSize(v); setPicked(null); }} items={["5", "10", "20"].map((v) => ({ id: v, label: v }))} />
            <span className="ea-bar__label">Fit</span>
            <Segmented<FitFilter> label="Fit" value={fitFilter} onChange={setFitFilter} items={[
              { id: "all", label: "All", count: counts.all }, { id: "strong", label: "Strong", count: counts.strong },
              { id: "maybe", label: "Maybe", count: counts.maybe }, { id: "not_now", label: "Not now", count: counts.not_now }]} />
            <span className="ea-bar__note">{waiting.length} waiting{oldest ? ` · oldest ${oldest} days` : ""}</span>
          </div>
          <p className="ea-lead"><Sparkles size={14} aria-hidden="true" /> Ranked by fit: their sign-up answers, and what this Lemma already knows about them from Mail, People map and Deal tracker. Sign-up date only breaks ties. Untick anyone; tick anyone below the line.</p>

          {rows.length ? (
            <>
              <div className="c-table-wrap ea-wide">
                <table className="c-table ea-table ea-table--pick">
                  <thead><tr><th><span className="c-sr">Pick</span></th><th>#</th><th>Person</th><th>Fit</th><th>Why them</th><th>What they said at sign-up</th><th>Waiting</th></tr></thead>
                  <tbody>
                    {rows.map((t) => {
                      const rank = waiting.indexOf(t) + 1;
                      const on = chosen.has(t.id);
                      return (
                        <tr key={t.id} className={[on ? "" : "ea-off", rank === n ? "ea-cut" : ""].join(" ")} onClick={() => toggle(t.id)}>
                          <td><input type="checkbox" className="c-check" checked={on} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} aria-label={`Pick ${t.name || t.handle}`} /></td>
                          <td className="ea-rank">{rank}</td>
                          <td><div className="ea-who"><Avatar name={t.name} email={t.handle} size={24} /><div className="ea-who__text"><span>{t.name || t.handle}</span><span className="ea-sub">{[t.company_name || "personal account", t.role].filter(Boolean).join(" · ")}</span></div></div></td>
                          <td><FitPill fit={t.fit} /></td>
                          <td><div className="ea-why">{t.fit_reason || (t.fit ? "" : "Reading their fit now.")}</div></td>
                          <td><div className="ea-ans">{t.answers?.use_for || t.answers?.today || "—"}</div></td>
                          <td className="ea-muted">{plural(waitedDays(t), "day")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="ea-cards" aria-label="People waiting">
                {rows.map((t) => (
                  <li key={t.id}>
                    <label className="ea-card ea-card--pick">
                      <span className="ea-card__top">
                        <input type="checkbox" className="c-check" checked={chosen.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Pick ${t.name || t.handle}`} />
                        <span className="ea-card__name">{t.name || t.handle}</span>
                        <FitPill fit={t.fit} />
                      </span>
                      <span className="ea-sub">{[t.company_name || "personal account", t.role, `waiting ${plural(waitedDays(t), "day")}`].filter(Boolean).join(" · ")}</span>
                      {t.fit_reason ? <span className="ea-card__said">{t.fit_reason}</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : <div className="ea-none">Nobody is waiting{fitFilter !== "all" ? " with that fit" : ""}.</div>}

          {notNow.length ? (
            <div className="ea-band">
              <div className="ea-grow">
                <div>{plural(notNow.length, "person", "people")} marked not now</div>
                <div className="ea-sub">Each can be told why, and what would change it.</div>
              </div>
              <Button busy={busy === "notnow"} onClick={() => void draftNotNow()}>Draft a note to each</Button>
            </div>
          ) : null}
        </main>

        <aside className="ea-side" aria-label="What happens when you press Let in">
          <h2 className="ea-h2">When you press Let in</h2>
          <Stepline icon={Flag} title={flagLine.title} sub={flagLine.sub} />
          <Stepline icon={Mail} title={`${plural(chosenList.length, "invite")} go from your mailbox, one each`}
            sub={box ? `From ${box.email}.` : beta.sample ? "The sample's invites stay as drafts." : "Your mailbox isn't set up in Mail yet: the invites wait as drafts."}>
            {current ? (
              <div className="ea-note ea-note--flat">
                <div className="ea-note__head">
                  <span className="ea-sub">To {current.to_handles?.[0]}</span>
                  <Pill tone="ai" dot={false}>ai</Pill>
                  <span className="ea-sub ea-push">{Math.min(shown, drafted - 1) + 1} of {drafted}</span>
                  <Button variant="ghost" size="sm" icon={ChevronLeft} label="Previous invite" onClick={() => setShown(Math.max(0, shown - 1))} />
                  <Button variant="ghost" size="sm" icon={ChevronRight} label="Next invite" onClick={() => setShown(Math.min(drafted - 1, shown + 1))} />
                </div>
                <div>{current.subject}</div>
                <p className="ea-note__body">{current.body}</p>
                {currentFor ? (
                  <div className="ea-row">
                    <Button size="sm" onClick={() => to.person(currentFor.id)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => toggle(currentFor.id)}>Leave {currentFor.name?.split(" ")[0] || "them"} out</Button>
                  </div>
                ) : null}
              </div>
            ) : chosenList.length ? <p className="ea-sub"><Sparkles size={12} aria-hidden="true" /> Writing the invites in your voice: {drafted} of {chosenList.length}.</p> : null}
          </Stepline>
          <Stepline icon={MessageSquare} title={`Day ${beta.checkin_day}: a check-in, drafted for you to send`} sub="Three questions on the check-in page. Answers land in what they said." />
          <Stepline icon={Clock} title={`Quiet for ${beta.quiet_days} days: one note, drafted`} sub="Never a second. After that they show as quiet until they use it or reply." />
          {unknown ? <p className="ea-warn">{plural(unknown, "person", "people")} in this batch signed up with an address they didn't confirm.</p> : null}
          <div className="ea-press">
            <Button variant="primary" busy={busy === "send"} disabled={!chosenList.length || busy !== "" || (drafted < chosenList.length && !!box && !beta.sample && !DEMO)}
              onClick={() => void letIn(false)}>
              {drafted < chosenList.length && box && !beta.sample && !DEMO ? `Writing invites (${drafted} of ${chosenList.length})` : `Let in ${chosenList.length} and send the invites`}
            </Button>
            <Button busy={busy === "self"} disabled={!chosenList.length || busy !== ""} onClick={() => void letIn(true)}>Let in, I'll write to them myself</Button>
          </div>
          <p className="ea-sub">Nothing is sent and no flag changes until you press. The Lemma says in your Today when the next batch is ready; it never lets anyone in on its own.</p>
        </aside>
      </div>
    </>
  );
}

function Stepline({ icon: Icon, title, sub, children }: { icon: typeof Flag; title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="ea-step">
      <span className="ea-step__icon" aria-hidden="true"><Icon size={15} /></span>
      <div className="ea-grow">
        <div>{title}</div>
        <div className="ea-sub">{sub}</div>
        {children}
      </div>
    </div>
  );
}
