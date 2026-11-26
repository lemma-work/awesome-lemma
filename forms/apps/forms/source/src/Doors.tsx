// Doors (B): every place answers come from, grouped (on your website,
// connected accounts read every 15 minutes, other plugins' forms counted
// here and kept there, and coming soon), each with its seven days, its last
// answer, its median first reply, its rule in words and its state. A broken
// door gets the one banner. A door opens its panel (side panel on a wide
// screen, a page on a phone).

import { useEffect, useState } from "react";
import { ArrowLeft, Copy, ExternalLink, Plus, X } from "lucide-react";
import { Banner, Button, Connect, Field, Kbd, Pill, Segmented, Sheet, Switch, cx, openApp, useConnection, useToast, type Tone } from "@lemma-plugins/kit";
import { call, median, minutes, nameOf, nowMs, replyMinutes, useForms, useWho, type Data } from "./data";
import { Gap, Hook, KIND_WORDS, MODE_WORDS, SOURCE_WORDS, firstOf, whenShort } from "./marks";
import { to } from "./route";
import type { Form, ReplyMode } from "./types";
import { COLUMNS, HOOK_SOURCES, STARTERS, ensurePoll, googleFormId, hooksLive, hostedLink, makeHook, pauseForm, setOpenColumns, turnOnForm, why, type IssuedHook, type Step } from "./wire";

const SOON = [
  { name: "Typeform", note: "Answers posted to your Lemma's webhook address" },
  { name: "Tally", note: "Answers posted to your Lemma's webhook address" },
  { name: "Webflow · Fillout", note: "Form submissions posted to the webhook address" },
  { name: "Google Ads lead forms", note: "Leads posted with your key" },
  { name: "LinkedIn, through Zapier", note: "LinkedIn hands no lead answers to connectors; a Zapier recipe posts them" },
];

type Group = "all" | "on" | "needs" | "soon";

export function stateWords(f: Form, d: Data, members: { user_id: string; name: string }[]): { text: string; tone: Tone } {
  if (f.state === "on") return { text: "Taking answers", tone: "success" };
  if (f.state === "paused") return { text: f.state_why || `Paused by ${firstOf(nameOf(d, members, f.held_by_user_id, "someone"))}`, tone: "plain" };
  if (f.state === "broken") {
    const day = /on (\w+day)/.exec(f.state_why || "")?.[1];
    return { text: day ? `Stopped ${day}` : "Stopped", tone: "danger" };
  }
  if (f.state === "soon") return { text: "Coming soon", tone: "info" };
  return { text: "Not yet", tone: "plain" };
}

export function ruleWords(f: Form, d: Data, members: { user_id: string; name: string }[]): string {
  if (f.owner_plugin !== "forms") return `Kept by ${f.owner_plugin === "triage" ? "Triage" : f.owner_plugin}: its items, its owners`;
  const rule = d.rules.find((r) => r.form_id === f.id);
  if (rule?.reason) return rule.reason;
  const owner = firstOf(nameOf(d, members, f.default_owner_user_id, "the person who set Forms up"));
  return `An open deal's owner first, else ${owner}`;
}

function Bars({ f, now }: { f: Form; now: number }) {
  const days = Array.from({ length: 7 }, (_, i) => new Date(now - (6 - i) * 86_400_000).toISOString().slice(0, 10));
  const counts = days.map((day) => f.week.find((w) => String(w.day).slice(0, 10) === day)?.n || 0);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <span className="fm-bars" aria-label={`${total} in the last 7 days`}>
      <span className="fm-bars__b" aria-hidden="true">{counts.map((c, i) => <span key={i} style={{ height: `${Math.max(c ? 18 : 6, (c / max) * 100)}%` }} className={cx(!c && "fm-bars__zero")} />)}</span>
      <span className="fm-num">{total}</span>
    </span>
  );
}

export function Doors({ door }: { door: string | null }) {
  const d = useForms();
  const { members, me } = useWho();
  const now = nowMs(d);
  const [group, setGroup] = useState<Group>("all");
  const [adding, setAdding] = useState(false);
  const web = d.forms.filter((f) => f.source === "web");
  const polled = d.forms.filter((f) => f.source === "google_forms" || f.source === "meta_ads");
  const plugins = d.forms.filter((f) => f.owner_plugin !== "forms" || f.source === "plugin");
  const hooks = d.forms.filter((f) => HOOK_SOURCES.some((h) => h.source === f.source));
  const broken = d.forms.filter((f) => f.state === "broken");
  const show = (f: Form) => group === "all" || (group === "on" && f.state === "on") || (group === "needs" && f.state === "broken");
  const open = door ? d.formsById.get(door) : undefined;
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches;
  const counts = { all: d.forms.length + SOON.length, on: d.forms.filter((f) => f.state === "on").length, needs: broken.length, soon: SOON.length };

  if (open && !wide) return <DoorPanel f={open} page />;

  const table = (title: string, note: string, list: Form[]) => list.filter(show).length ? (
    <section className="fm-dgroup">
      <h2 className="fm-h2">{title}<span className="fm-sub">{note}</span></h2>
      <div className="fm-doortable" role="table">
        <div className="fm-door fm-door--th" role="row">
          <span>Door</span><span>Last 7 days</span><span>Last answer</span><span className="fm-c-first">First reply</span><span className="fm-c-who">Who gets it</span><span>State</span>
        </div>
        {list.filter(show).map((f) => {
          const st = stateWords(f, d, members);
          const replies = (d.answersBy.get(f.id) || []).map(replyMinutes).filter((m): m is number => m != null);
          const med = median(replies);
          return (
            <div key={f.id} role="row" className={cx("fm-door", open?.id === f.id && "fm-door--on")}>
              <button type="button" className="fm-door__hit" aria-label={`Open ${f.name}`} onClick={() => to.doors(f.id)} />
              <span className="fm-door__name"><span>{f.name}</span><span className="fm-faint fm-small">{f.place || SOURCE_WORDS[f.source] || f.source}</span></span>
              <span><Bars f={f} now={now} /></span>
              <span className="fm-small"><span className="fm-phone-label">Last answer </span>{f.last_answer_at ? whenShort(f.last_answer_at, now) : <span className="fm-faint">None yet</span>}</span>
              <span className="fm-small fm-num fm-c-first"><span className="fm-phone-label">First reply </span>{med != null ? minutes(med) : <span className="fm-faint">–</span>}</span>
              <span className="fm-small fm-muted fm-c-who">{ruleWords(f, d, members)}</span>
              <span><Pill tone={st.tone}>{st.text}</Pill></span>
            </div>
          );
        })}
      </div>
    </section>
  ) : null;

  return (
    <div className={cx("fm-doorsplit", open && "fm-doorsplit--open")}>
      <main className="c-body c-body--wide fm-doors">
        <div className="fm-bar fm-bar--flush">
          <Segmented label="Doors" value={group} onChange={setGroup} items={[{ id: "all", label: "All", count: counts.all }, { id: "on", label: "Taking answers", count: counts.on },
            { id: "needs", label: "Needs you", count: counts.needs }, { id: "soon", label: "Coming soon", count: counts.soon }]} />
          <span className="fm-fill" />
          <Button icon={Plus} onClick={() => setAdding(true)}>Add a door</Button>
        </div>
        {broken.map((f) => <Broken key={f.id} f={f} mine={f.held_by_user_id === me?.id} who={firstOf(nameOf(d, members, f.held_by_user_id, "whoever holds it"))} />)}
        {group !== "soon" ? (
          <>
            {table("On your website", "a table of your Lemma, opened to people outside", web)}
            {table("Connected accounts", "read every 15 minutes", polled)}
            {table("Other plugins' forms", "counted here, kept there", plugins.filter((f) => !web.includes(f)))}
            {table("Form tools", "through the webhook address", hooks)}
            {!d.forms.length ? <p className="fm-muted">No doors yet. Add one, or run set-up.</p> : null}
          </>
        ) : null}
        {group === "all" || group === "soon" ? (
          <section className="fm-dgroup">
            <h2 className="fm-h2">Coming soon<span className="fm-sub">once the webhook address is live in this Lemma</span></h2>
            <div className="fm-doortable">
              {SOON.map((s) => (
                <div key={s.name} className="fm-door fm-door--soon">
                  <span className="fm-door__name"><span>{s.name}</span><span className="fm-faint fm-small">{s.note}</span></span>
                  <span className="fm-faint fm-c-x">–</span><span className="fm-faint fm-small fm-c-x">–</span><span className="fm-faint fm-c-first fm-c-x">–</span>
                  <span className="fm-c-who"><Hook /></span>
                  <span><Pill tone="info">Coming soon</Pill></span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
      {open && wide ? <DoorPanel f={open} /> : null}
      <AddDoor open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

/** The one banner a stopped door gets, with the sign-in again for whoever's account it is. */
function Broken({ f, mine, who }: { f: Form; mine: boolean; who: string }) {
  const service = f.source === "meta_ads" ? "Meta" : f.source === "google_forms" ? "Google" : SOURCE_WORDS[f.source] || f.name;
  const c = useConnection({ connector: f.source === "google_forms" ? "googleforms" : "metaads", mode: "per_member" });
  const polled = f.source === "google_forms" || f.source === "meta_ads";
  return (
    <Banner tone="danger" action={polled && mine ? <Button size="sm" busy={!!c.busy} onClick={() => c.connect()}>Sign in to {service} again</Button> : undefined}>
      <b>{service} stopped answering</b>{f.state_why ? `: ${f.state_why.replace(/^The /, "the ")}` : ""}. Answers to “{f.name}” are waiting in {service} until {mine ? "you sign in again" : `${who} signs in again`}.
    </Banner>
  );
}

/* ---------- a door's panel ---------- */

export function DoorPanel({ f, page }: { f: Form; page?: boolean }) {
  const d = useForms();
  const { members, me } = useWho();
  const toast = useToast();
  const now = nowMs(d);
  const [tab, setTab] = useState<"link" | "page" | "product">("link");
  const [busy, setBusy] = useState("");
  const held = nameOf(d, members, f.held_by_user_id, "nobody");
  const isWeb = f.source === "web";
  const polled = f.source === "google_forms" || f.source === "meta_ads";
  const fields = (f.fields.length ? f.fields : (COLUMNS[f.source_id] || []).filter((c) => !c.hidden).map((c, i) => ({ key: c.key, label: c.label, order: i, on: true })));
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => setLabels({}), [f.id]);
  const link = hostedLink(d.settings?.widget_key, f.source_id) || f.share?.url || null;
  const st = stateWords(f, d, members);
  const save = async (patch: Record<string, unknown>, said: string) => {
    setBusy(said);
    try {
      await call("forms_door_save", { source: f.source, source_id: f.source_id, ...patch });
      await d.reload();
      toast(said);
    } catch (e) {
      toast(`Couldn't save it: ${why(e)}`);
    } finally {
      setBusy("");
    }
  };
  const saveFields = async (next: typeof fields) => {
    await save({ fields: next }, "Saved the fields.");
    try {
      await setOpenColumns(f, next.filter((x) => x.on !== false).map((x) => x.key));
    } catch (e) {
      toast(`The fields are saved, but the form didn't change: ${why(e)}`);
    }
  };
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => toast("Copied."), () => toast("Couldn't copy: select it instead.")); };
  const host = link ? link.split("/public/")[0] : "https://api.lemma.work";
  const pageSnippet = `<script src="${host}/public/web/widget.js" data-lemma-key="${d.settings?.widget_key || "pk_…"}" async></script>
<form data-lemma-table="${f.source_id}" data-lemma-title="${f.name}" data-lemma-thanks="Thanks, we'll reply by email.">
${fields.filter((x) => x.on !== false).map((x) => `  <label>${x.label} <input name="${x.key}"></label>`).join("\n")}
  <input type="hidden" name="page" value="">
  <input type="hidden" name="campaign" value="">
  <button>Send</button>
</form>`;
  const productSnippet = `Lemma.addRow("${f.source_id}", { name, email, message }, { hostToken })`;
  const rules = d.rules.filter((r) => !r.form_id || r.form_id === f.id);
  return (
    <aside className={cx("fm-panel", page && "fm-panel--page")} aria-label={f.name}>
      <div className="fm-panel__head">
        {page ? <button type="button" className="fm-link" onClick={() => to.doors()}><ArrowLeft aria-hidden="true" />Doors</button> : null}
        <div className="fm-panel__t">
          <h2 className="fm-title fm-title--s">{f.name}</h2>
          <p className="fm-facts">
            <span>{SOURCE_WORDS[f.source] || f.source}</span>
            {isWeb ? <span>a table of {fields.length} fields · held open by {f.held_by_user_id === me?.id ? "you" : held}</span>
              : polled ? <span>read from {f.held_by_user_id === me?.id ? "your" : `${firstOf(held)}'s`} account</span> : null}
          </p>
          <div className="fm-pills"><Pill tone={st.tone}>{st.text}</Pill>{f.purpose ? <Pill>{KIND_WORDS[f.purpose]}s</Pill> : null}</div>
        </div>
        {!page ? <Button variant="ghost" icon={X} label="Close" onClick={() => to.doors()} /> : null}
      </div>
      {f.owner_plugin !== "forms" ? (
        <section className="fm-psec">
          <p>This is {f.owner_plugin === "triage" ? "Triage's" : `${f.owner_plugin}'s`} own form: its answers are filed there, and Forms only counts them here.</p>
          <Button onClick={() => void openApp(f.owner_plugin, f.owner_plugin === "triage" ? "/doors" : "/")}>Open it in {f.owner_plugin === "triage" ? "Triage" : f.owner_plugin}</Button>
        </section>
      ) : (
        <>
          <section className="fm-psec fm-acts">
            {f.state === "on"
              ? <Button busy={busy === "pause"} onClick={async () => { setBusy("pause"); try { await pauseForm(f, firstOf(me?.name) || "someone"); await d.reload(); toast("Paused: it takes no answers until you turn it on."); } catch (e) { toast(`Couldn't pause it: ${why(e)}`); } finally { setBusy(""); } }}>Pause</Button>
              : isWeb && me ? <Button variant="primary" busy={busy === "on"} onClick={async () => {
                setBusy("on");
                const said: Step[] = [];
                const ok = await turnOnForm(f.source_id, me.id, f.audience || "anyone", f.share?.ways || ["link"], [], (s) => said.push(s));
                toast(ok ? `${f.name} takes answers now.` : `Not on: ${said.find((s) => !s.ok)?.said || "something failed"}`);
                await d.reload();
                setBusy("");
              }}>Turn it on</Button> : null}
            {isWeb && f.held_by_user_id && me && f.held_by_user_id !== me.id ? <Button onClick={async () => {
              setBusy("hold");
              const said: Step[] = [];
              const ok = await turnOnForm(f.source_id, me.id, f.audience || "anyone", f.share?.ways || ["link"], [], (s) => said.push(s));
              toast(ok ? "You hold this form open now." : `Couldn't: ${said.find((s) => !s.ok)?.said || "something failed"}`);
              await d.reload();
              setBusy("");
            }}>Hold it open yourself</Button> : null}
          </section>
          {isWeb ? <Gap>If {f.held_by_user_id === me?.id ? "you leave" : `${firstOf(held)} leaves`}, this form stops taking answers</Gap> : null}
          {isWeb ? (
            <section className="fm-psec">
              <h3 className="fm-h3">Share it</h3>
              <Segmented label="Share it" value={tab} onChange={setTab} items={[{ id: "link", label: "A link" }, { id: "page", label: "On your page" }, { id: "product", label: "In your product" }]} />
              {tab === "link" ? (
                <div className="fm-stack">
                  <div className="fm-copy"><input className="c-input" readOnly value={link || "Turn the form on to get its link"} aria-label="The form's link" />
                    <Button icon={Copy} label="Copy" disabled={!link} onClick={() => link && copy(link)} />
                    <Button icon={ExternalLink} label="Open" disabled={!link} onClick={() => link && window.open(link, "_blank", "noopener")} /></div>
                  <Gap>The link shows the table's name: no title, intro or thank-you yet</Gap>
                </div>
              ) : tab === "page" ? (
                <div className="fm-stack">
                  <p className="fm-small fm-muted">Your own form, in your own design. The title, intro and thank-you work here; fill <code>page</code> and <code>campaign</code> from your page.</p>
                  <pre className="fm-code">{pageSnippet}</pre>
                  <Button size="sm" icon={Copy} onClick={() => copy(pageSnippet)}>Copy</Button>
                </div>
              ) : (
                <div className="fm-stack">
                  <p className="fm-small fm-muted">Inside your product, signed in: the answer arrives as a contact, so the Lemma's address can reply. Sign the host token on your server, never in the page.</p>
                  <pre className="fm-code">{productSnippet}</pre>
                  <Button size="sm" icon={Copy} onClick={() => copy(productSnippet)}>Copy</Button>
                </div>
              )}
            </section>
          ) : null}
          {polled ? (
            <section className="fm-psec">
              <h3 className="fm-h3">The account it's read from</h3>
              <p className="fm-small">{f.place || SOURCE_WORDS[f.source]}. {f.last_read_at ? `Last read ${whenShort(f.last_read_at, now)}.` : "Not read yet."} {f.source === "google_forms" ? "Google Forms is" : "Meta is"} read every 15 minutes.</p>
              {f.source === "meta_ads" ? <Gap>Reading Meta leads isn't checked against a live account yet</Gap> : null}
              <Connect connector={f.source === "google_forms" ? "googleforms" : "metaads"} mode="per_member" primary={false} />
            </section>
          ) : null}
          {fields.length ? (
            <section className="fm-psec">
              <h3 className="fm-h3">Fields<span className="fm-sub">{isWeb ? "the table's open columns; at most 30, 5,000 characters an answer" : "the questions, as labels"}</span></h3>
              <div className="fm-fieldlist">
                {fields.map((x, i) => (
                  <div key={x.key} className="fm-fieldrow">
                    <input className="c-input" aria-label={`Label for ${x.key}`} value={labels[x.key] ?? x.label}
                      onChange={(e) => setLabels({ ...labels, [x.key]: e.target.value })}
                      onBlur={() => { const v = labels[x.key]; if (v != null && v !== x.label && v.trim()) void saveFields(fields.map((y, j) => j === i ? { ...y, label: v.trim() } : y)); }} />
                    <span className="fm-faint fm-small">{x.key}</span>
                    {isWeb ? <Switch label={x.on === false ? "Off" : "On"} checked={x.on !== false} onChange={(on) => void saveFields(fields.map((y, j) => j === i ? { ...y, on } : y))} /> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <section className="fm-psec">
            <h3 className="fm-h3">Where answers go</h3>
            <ol className="fm-rules">
              <li className="fm-rulecheck"><span className="fm-rulecheck__x">An open deal's owner first</span></li>
              {rules.map((r) => <li key={r.id} className="fm-rulecheck"><span className="fm-rulecheck__x">{r.reason || "A rule"}</span></li>)}
              <li className="fm-rulecheck"><span className="fm-rulecheck__x">Else
                <select className="c-input fm-select fm-inline" aria-label="Default owner" value={f.default_owner_user_id || ""} onChange={(e) => void save({ default_owner_user_id: e.target.value }, "Saved who gets it.")}>
                  {!f.default_owner_user_id ? <option value="">Choose someone</option> : null}
                  {[...new Map([...(d.settings?.members || []).map((m) => [m.user_id, m.name] as const), ...members.map((m) => [m.user_id, m.name] as const)]).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select></span></li>
            </ol>
            <Button size="sm" variant="ghost" onClick={() => to.routing()}>Change the rules</Button>
          </section>
          <section className="fm-psec">
            <h3 className="fm-h3">How fast they hear back</h3>
            <div className="fm-modes" role="radiogroup" aria-label="How fast they hear back">
              {(["chat_only", "draft", "lemma_address"] as ReplyMode[]).map((m) => (
                <label key={m} className={cx("fm-mode", f.reply_mode === m && "fm-mode--on")}>
                  <input type="radio" name={`mode-${f.id}`} checked={f.reply_mode === m} onChange={() => void save({ reply_mode: m }, "Saved how they hear back.")} />
                  <span className="fm-stack">
                    <span>{MODE_WORDS[m]}{m === "draft" ? <span className="fm-faint"> (the default)</span> : null}</span>
                    <span className="fm-small fm-muted">{m === "chat_only" ? "They get answers at once from the Lemma beside the form; nobody emails them."
                      : m === "draft" ? "A reply is drafted in the owner's own mailbox; it goes when they press Send."
                        : "Only for people who confirm their email or sign in: 10 lines a day to one person, and the Lemma sends 200 emails a day at most."}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
          {isWeb ? <Preview f={f} fields={fields} /> : null}
        </>
      )}
      <span className="fm-sr"><Kbd>Esc</Kbd></span>
    </aside>
  );
}

function Preview({ f, fields }: { f: Form; fields: { key: string; label: string; on?: boolean }[] }) {
  const files = new Set((COLUMNS[f.source_id] || []).filter((c) => c.file).map((c) => c.key));
  return (
    <section className="fm-psec">
      <h3 className="fm-h3">Preview<span className="fm-sub">the form as a visitor sees it, with the Lemma's chat beside it</span></h3>
      <div className="fm-preview">
        <div className="fm-preview__form">
          <p className="fm-preview__title">{f.source_id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}</p>
          {fields.filter((x) => x.on !== false).map((x) => (
            <label key={x.key} className="fm-preview__field"><span>{x.label}</span>
              {files.has(x.key) ? <span className="fm-preview__input fm-faint">Choose a file</span> : <span className={cx("fm-preview__input", x.key === "message" && "fm-preview__input--tall")} />}
            </label>
          ))}
          <span className="fm-preview__send">Send</span>
        </div>
        <div className="fm-preview__chat">
          <p className="fm-small fm-muted">The Lemma</p>
          <p className="fm-preview__bubble">Hi. Ask me anything while you fill this in.</p>
        </div>
      </div>
      <Gap>The page can't carry hidden values yet (campaign, which page it came from)</Gap>
    </section>
  );
}

/* ---------- adding a door ---------- */

function useHooksLive(open: boolean): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!open) return;
    let on = true;
    void hooksLive().then((v) => on && setLive(v));
    return () => { on = false; };
  }, [open]);
  return live;
}

function AddDoor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = useForms();
  const { me } = useWho();
  const toast = useToast();
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [issued, setIssued] = useState<IssuedHook | null>(null);
  const live = useHooksLive(open);
  const off = STARTERS.filter((s) => d.forms.find((f) => f.source_id === s.table)?.state !== "on");
  const gid = googleFormId(link);
  return (
    <Sheet open={open} title="Add a door" onClose={() => { setIssued(null); onClose(); }}>
      <div className="fm-stack fm-gap16">
        <section className="fm-stack">
          <h3 className="fm-h3">A form on your website</h3>
          {off.length ? off.map((s) => (
            <div key={s.table} className="fm-addrow">
              <span className="fm-stack"><span>{s.name}</span>{s.note ? <span className="fm-small fm-muted">{s.note}</span> : null}</span>
              <Button size="sm" busy={busy === s.table} onClick={async () => {
                if (!me) return;
                setBusy(s.table);
                const said: Step[] = [];
                const ok = await turnOnForm(s.table, me.id, "anyone", ["link"], [], (x) => said.push(x));
                toast(ok ? `${s.name} takes answers now.` : `Not on: ${said.find((x) => !x.ok)?.said || "something failed"}`);
                await d.reload();
                setBusy("");
              }}>Turn on</Button>
            </div>
          )) : <p className="fm-small fm-muted">All four website forms are on.</p>}
        </section>
        <section className="fm-stack">
          <h3 className="fm-h3">A Google Form</h3>
          <Connect connector="googleforms" mode="per_member" purpose="Reads new answers to the Google Forms you add, every 15 minutes." primary={false} />
          <Field label="Its edit link" hint="Open the form in Google Forms and copy the address: it ends in /edit. The link people fill in has a different id.">
            <input className="c-input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/forms/d/…/edit" />
          </Field>
          <Field label="What to call it"><input className="c-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Showroom visit" /></Field>
          <Button disabled={!gid || !me} busy={busy === "google"} onClick={async () => {
            if (!gid || !me) return;
            setBusy("google");
            try {
              await call("forms_door_save", { source: "google_forms", source_id: gid, name: name.trim() || "Google Form", state: "on", held_by_user_id: me.id, place: `Google Forms · ${me.email || me.name}` });
              await ensurePoll(me);
              toast("Added: its answers are read every 15 minutes.");
              setLink(""); setName("");
              await d.reload();
            } catch (e) {
              toast(`Couldn't add it: ${why(e, "googleforms")}`);
            } finally {
              setBusy("");
            }
          }}>Add the Google Form</Button>
          {link && !gid ? <p className="fm-small fm-bad">That isn't an edit link: it should look like docs.google.com/forms/d/…/edit.</p> : null}
        </section>
        <section className="fm-stack">
          <h3 className="fm-h3">Meta lead ads</h3>
          <p className="fm-small fm-muted">Leads from your Facebook and Instagram lead forms, read every 15 minutes.</p>
          <Gap>Reading Meta leads isn't checked against a live account yet</Gap>
        </section>
        <section className="fm-stack">
          <h3 className="fm-h3">Another form tool</h3>
          {issued ? (
            <div className="fm-stack">
              <p className="fm-small">Give this address to the tool. It's shown once: it carries its own key.</p>
              <pre className="fm-code">{issued.url}</pre>
            </div>
          ) : live ? HOOK_SOURCES.map((h) => (
            <div key={h.source} className="fm-addrow"><span>{h.name}</span>
              <Button size="sm" busy={busy === h.source} onClick={async () => {
                if (!me) return;
                setBusy(h.source);
                try { setIssued(await makeHook(h.source, h.name, me.id)); await d.reload(); } catch (e) { toast(`Couldn't make the address: ${why(e)}`); } finally { setBusy(""); }
              }}>Make an address</Button></div>
          )) : (
            <>
              <p className="fm-small fm-muted">Typeform, Tally, Webflow, Fillout, Google Ads lead forms, and LinkedIn through Zapier or Make.</p>
              <Hook>Coming soon: the webhook address isn't live in this Lemma yet</Hook>
            </>
          )}
        </section>
      </div>
    </Sheet>
  );
}
