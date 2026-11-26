// A beta's public pages, for people outside the team. Nobody signs in.
//
//   /<beta>                 sign up: the feature, the questions, email
//                           confirmed by a code, then "You're on the list"
//   /<beta>/status?ref=…    where that sign-up stands: Waiting, You're in, or
//                           Not this time, with one general line
//   /<beta>/check-in?ref=…  three questions a few days after being let in
//
// Everything is read through the Lemma's web widget from what it made Public
// (early_access_page, early_access_status); nothing about anyone else is
// readable. The page keeps its random ref, which is the only key to a
// sign-up's status.

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CircleCheck, CircleDot, CircleSlash, FlaskConical, Mail } from "lucide-react";
import { Button, Spinner } from "./marks";
import { explain, loadWidget, widgetKey, type LemmaWidget } from "./widget";

interface Page {
  id: string;
  beta_id: string;
  slug: string;
  name: string;
  intro?: string | null;
  questions?: { key: string; label: string }[] | null;
  pace?: string | null;
  state: "open" | "paused" | "closed";
}

type Kind = "signup" | "status" | "checkin";
type Step = "form" | "code" | "done";
const CONFIRMED = "early-access:confirmed-email";
const LONG = new Set(["use_for", "today"]);

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
    /* blocked: the page still works, it just won't remember */
  }
}

const DEMO = import.meta.env.VITE_LEMMA_DEMO === "1";

function refFor(slug: string): string {
  const hash = window.location.hash.includes("?") ? new URLSearchParams(window.location.hash.split("?")[1]) : null;
  const given = new URL(window.location.href).searchParams.get("ref") || hash?.get("ref") || null;
  if (given && /^[A-Za-z0-9_-]{8,64}$/.test(given)) return given;
  return kept(`early-access:ref:${slug}`);
}

/** In a demo build the page is its #fragment, which a link alone doesn't reload. */
function follow(event: React.MouseEvent<HTMLAnchorElement>): void {
  if (!DEMO) return;
  event.preventDefault();
  window.location.hash = event.currentTarget.getAttribute("href")!.slice(1);
  window.location.reload();
}

/** This beta's own address on this host (in a demo build, its #fragment). */
function base(slug: string): string {
  if (DEMO) return `#/${slug}`;
  return window.location.pathname.split(`/${slug}`)[0] + `/${slug}`;
}

export function Visitor({ slug, page: kind }: { slug: string; page: Kind }) {
  const [widget, setWidget] = useState<LemmaWidget | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [problem, setProblem] = useState<"" | "nokey" | "missing" | "unreachable">("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const key = widgetKey();
    if (!key) return setProblem("nokey");
    try {
      const lemma = await loadWidget(key, { chat: false });
      setWidget(lemma);
      const read = await lemma.readRows("early_access_page");
      const found = (read.rows as unknown as Page[]).find((p) => p.slug === slug);
      if (!found) return setProblem("missing");
      setPage(found);
      document.title = kind === "status" ? `${found.name}: where you stand` : kind === "checkin" ? `${found.name}: check-in` : `${found.name}: early access`;
    } catch (error) {
      setProblem("unreachable");
      setMessage(explain(error));
    }
  }, [slug, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  if (problem) return <Problem kind={problem} message={message} />;
  if (!page || !widget) return <Loading />;
  return (
    <div className="c-app va-app">
      <main className="va">
        <div className="va-head">
          <span className="va-icon" aria-hidden="true"><FlaskConical size={16} /></span>
          <p className="va-eyebrow">{kind === "checkin" ? "Check-in" : "Early access"}</p>
          <h1>{page.name}</h1>
          {page.intro ? <p className="va-intro">{page.intro}</p> : null}
        </div>
        <section className="va-card c-card" aria-live="polite">
          {kind === "status" ? <Status page={page} widget={widget} /> : kind === "checkin" ? <CheckIn page={page} widget={widget} /> : <SignUp page={page} widget={widget} />}
        </section>
      </main>
      <footer className="va-foot">
        <span>Your answers go to the team running this beta.</span>
        <a href="https://lemma.work" target="_blank" rel="noopener noreferrer">Runs on Lemma</a>
      </footer>
    </div>
  );
}

function SignUp({ page, widget }: { page: Page; widget: LemmaWidget }) {
  const questions = page.questions || [];
  const [form, setForm] = useState<Record<string, string>>({ name: "", email: "" });
  const [step, setStep] = useState<Step>(() => (kept(`early-access:ref:${page.slug}`) ? "done" : "form"));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const email = (form.email || "").trim().toLowerCase();

  if (page.state !== "open" && step !== "done") {
    return (
      <div className="va-state">
        <CircleSlash size={20} aria-hidden="true" />
        <h2>{page.state === "paused" ? "Sign-ups are paused" : "This beta isn't taking sign-ups"}</h2>
        <p>{page.state === "paused" ? "The team isn't adding people to the list right now. Try again in a few days." : "It may have ended, or not started yet."}</p>
      </div>
    );
  }

  const add = async () => {
    const ref = token();
    await widget.addRow("early_access_signup", {
      beta_id: page.beta_id, email, name: (form.name || "").trim(), ref,
      ...Object.fromEntries(questions.map((q) => [q.key, (form[q.key] || "").trim()]).filter(([, v]) => v)),
    });
    keep(`early-access:ref:${page.slug}`, ref);
    keep(CONFIRMED, email);
    setStep("done");
  };

  const details = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!(form.name || "").trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return setMessage("Add your name and a working email address.");
    setBusy(true);
    setMessage("");
    try {
      // Confirmed already: by a code for this address in this browser, or by
      // the team's own product (a host token; nothing kept here).
      if (widget.isContact() && (kept(CONFIRMED) === email || !kept(CONFIRMED))) await add();
      else {
        await widget.sendCode(email);
        setStep("code");
      }
    } catch (error) {
      // The session turned out confirmed when it started (the team's product
      // vouched for this visitor): nothing to type.
      if ((error as { code?: string })?.code === "already_a_contact" && !kept(CONFIRMED)) {
        try {
          await add();
          return;
        } catch (again) {
          setMessage(explain(again));
          return;
        }
      }
      setMessage(explain(error));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) return setMessage("The code is 6 digits.");
    setBusy(true);
    setMessage("");
    try {
      await widget.verifyCode(email, digits);
      await add();
    } catch (error) {
      setMessage(explain(error));
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    const ref = kept(`early-access:ref:${page.slug}`);
    return (
      <div className="va-state va-state--done">
        <CircleCheck size={22} aria-hidden="true" />
        <h2>You're on the list</h2>
        <p>{page.pace || "We let people in a few at a time, by fit. We'll write when it's your turn."}</p>
        <p><a className="va-link" href={`${base(page.slug)}/status${ref ? `?ref=${ref}` : ""}`} onClick={follow}>See where you stand <ArrowRight size={13} aria-hidden="true" /></a></p>
      </div>
    );
  }

  return step === "form" ? (
    <form className="va-form" onSubmit={(e) => void details(e)} noValidate method="post">
      <h2>Ask to try it early</h2>
      <label className="c-field"><span>Your name</span>
        <input className="c-input" autoComplete="name" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      </label>
      <label className="c-field"><span>Your email</span>
        <input className="c-input" type="email" autoComplete="email" maxLength={320} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required aria-describedby="va-email-hint" />
        <small id="va-email-hint" className="va-hint">We'll send a code to check it's you. The invite goes here.</small>
      </label>
      {questions.map((q) => (
        <label key={q.key} className="c-field"><span>{q.label}</span>
          {LONG.has(q.key) ? (
            <textarea className="c-textarea" rows={3} maxLength={1500} value={form[q.key] || ""} onChange={(e) => setForm({ ...form, [q.key]: e.target.value })} />
          ) : (
            <input className="c-input" maxLength={200} autoComplete={q.key === "company" ? "organization" : q.key === "role" ? "organization-title" : "off"} value={form[q.key] || ""} onChange={(e) => setForm({ ...form, [q.key]: e.target.value })} />
          )}
        </label>
      ))}
      {message ? <p className="va-msg" role="alert">{message}</p> : null}
      <div className="va-actions"><Button type="submit" variant="primary" busy={busy}>Continue</Button></div>
    </form>
  ) : (
    <form className="va-form" onSubmit={(e) => void verify(e)} noValidate method="post">
      <h2>Check your email</h2>
      <label className="c-field"><span>Enter the 6-digit code we sent to {email}</span>
        <input className="c-input va-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} placeholder="123456" onChange={(e) => setCode(e.target.value)} required autoFocus />
      </label>
      {message ? <p className="va-msg" role="alert">{message}</p> : null}
      <div className="va-actions">
        <Button type="submit" variant="primary" busy={busy}>Join the list</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void widget.sendCode(email).then(() => setMessage("Sent a new code."), (e) => setMessage(explain(e)))}>Send a new code</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => { setStep("form"); setMessage(""); }}>Use another email</Button>
      </div>
    </form>
  );
}

function Status({ page, widget }: { page: Page; widget: LemmaWidget }) {
  const ref = refFor(page.slug);
  const [row, setRow] = useState<{ state: string; line?: string | null } | null | undefined>(undefined);

  useEffect(() => {
    if (!ref) return setRow(null);
    let live = true;
    let tries = 0;
    const look = async () => {
      try {
        const read = await widget.readRows("early_access_status");
        const found = read.rows.find((r) => r.ref === ref) as { state: string; line?: string } | undefined;
        if (!live) return;
        if (found || tries > 8) return setRow(found || null);
      } catch {
        /* tried again below */
      }
      tries += 1;
      window.setTimeout(() => void look(), 2500);
    };
    void look();
    return () => {
      live = false;
    };
  }, [ref, widget]);

  if (row === undefined) return <div className="va-state"><Spinner /><h2>Looking up your sign-up</h2></div>;
  if (!row) {
    return (
      <div className="va-state">
        <CircleDot size={20} aria-hidden="true" />
        <h2>We can't find your sign-up here</h2>
        <p>Open this page from the browser you signed up in, or from the link in the team's email. {page.state === "open" ? <a className="va-link" href={base(page.slug)} onClick={follow}>Sign up</a> : null}</p>
      </div>
    );
  }
  const words = { waiting: ["Waiting", "You're on the list."], in: ["You're in", "You've been let in."], not_now: ["Not this time", "You're not in this round."] }[row.state] || ["Waiting", ""];
  return (
    <div className={`va-state${row.state === "in" ? " va-state--done" : ""}`}>
      {row.state === "in" ? <CircleCheck size={22} aria-hidden="true" /> : row.state === "not_now" ? <CircleSlash size={22} aria-hidden="true" /> : <CircleDot size={22} aria-hidden="true" />}
      <p className="va-label">{words[0]}</p>
      <h2>{words[1]}</h2>
      {row.line ? <p>{row.line}</p> : null}
      {row.state === "in" ? <p className="va-hint"><Mail size={12} aria-hidden="true" /> Look for the invite from the team; reply to it with anything that gets in the way.</p> : null}
    </div>
  );
}

const USED = [{ v: "yes", l: "Yes" }, { v: "a_little", l: "A little" }, { v: "not_yet", l: "Not yet" }];
const MISS = [{ v: "very", l: "Very much" }, { v: "somewhat", l: "Somewhat" }, { v: "not_really", l: "Not really" }];

function CheckIn({ page, widget }: { page: Page; widget: LemmaWidget }) {
  const ref = refFor(page.slug);
  const [used, setUsed] = useState("");
  const [worked, setWorked] = useState("");
  const [inWay, setInWay] = useState("");
  const [miss, setMiss] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");

  if (!ref) {
    return <div className="va-state"><CircleDot size={20} aria-hidden="true" /><h2>This link is missing its last part</h2><p>Open the check-in from the link in the team's email.</p></div>;
  }
  if (done) {
    return <div className="va-state va-state--done"><CircleCheck size={22} aria-hidden="true" /><h2>Thank you</h2><p>Your answers went to the team. Reply to their email any time with more.</p></div>;
  }
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!used) return setMessage("Say whether you've used it.");
    setBusy(true);
    setMessage("");
    try {
      await widget.addRow("early_access_checkin", {
        beta_id: page.beta_id, ref, used, ...(worked.trim() ? { worked: worked.trim() } : {}),
        ...(inWay.trim() ? { got_in_way: inWay.trim() } : {}), ...(miss ? { would_miss: miss } : {}),
      });
      setDone(true);
    } catch (error) {
      setMessage(explain(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="va-form" onSubmit={(e) => void send(e)} noValidate method="post">
      <h2>Three questions, a minute at most</h2>
      <Choice legend={`Have you used ${page.name}?`} name="used" value={used} options={USED} onChange={setUsed} />
      <label className="c-field"><span>What worked?</span>
        <textarea className="c-textarea" rows={3} maxLength={2000} value={worked} onChange={(e) => setWorked(e.target.value)} />
      </label>
      <label className="c-field"><span>What got in the way?</span>
        <textarea className="c-textarea" rows={3} maxLength={2000} value={inWay} onChange={(e) => setInWay(e.target.value)} />
      </label>
      <Choice legend="Would you miss it if it went away?" name="miss" value={miss} options={MISS} onChange={setMiss} />
      {message ? <p className="va-msg" role="alert">{message}</p> : null}
      <div className="va-actions"><Button type="submit" variant="primary" busy={busy}>Send</Button></div>
    </form>
  );
}

function Choice({ legend, name, value, options, onChange }: { legend: string; name: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <fieldset className="va-choice">
      <legend>{legend}</legend>
      <div className="va-choice__row">
        {options.map((o) => (
          <label key={o.v} className={`va-opt${value === o.v ? " va-opt--on" : ""}`}>
            <input type="radio" name={name} value={o.v} checked={value === o.v} onChange={() => onChange(o.v)} />
            <span>{o.l}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Loading() {
  return (
    <div className="c-app va-app" aria-busy="true">
      <main className="va">
        <div className="va-head">
          <span className="c-skel va-skel-icon" />
          <span className="c-skel va-skel-line" style={{ width: "30%" }} />
          <span className="c-skel va-skel-title" />
          <span className="c-skel va-skel-line" style={{ width: "70%" }} />
        </div>
        <section className="va-card c-card">
          {[0, 1, 2, 3].map((i) => <span key={i} className="c-skel va-skel-field" />)}
        </section>
      </main>
    </div>
  );
}

function Problem({ kind, message }: { kind: "nokey" | "missing" | "unreachable"; message: string }) {
  const words = {
    nokey: ["This link is missing its last part", "Sign-up links end in ?k= and a code. Open the link from where you found it again."],
    missing: ["There's no beta here", "The address may have changed. Ask the team for the current link."],
    unreachable: ["The page didn't load", message || "Refresh to try again."],
  }[kind];
  return (
    <div className="c-app va-app">
      <main className="va">
        <section className="va-card c-card">
          <div className="va-state">
            <CircleSlash size={22} aria-hidden="true" />
            <h2>{words[0]}</h2>
            <p>{words[1]}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
