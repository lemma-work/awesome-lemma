// Set up a beta in one sheet (/setup for a new one, /b/<beta>/settings for
// one that exists): the feature, its page's address, the flag (PostHog's
// flag and the static cohort it targets, by hand, or none), the sign-up
// questions, the pace, and the mailbox notes go from. Then Turn on, each
// step read back. PostHog is connected right here.

import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, FlaskConical } from "lucide-react";
import { Button, DEMO, Field, Header, Segmented, Switch, Spinner, runFunction, useToast } from "@lemma-plugins/kit";
import { useEA, type Beta, type FlagTool, type Question, type Step } from "./data";
import { PostHogConnect } from "./posthog";
import { to } from "./route";
import { turnOn, why } from "./wire";

interface Options {
  features: { id: string; name: string; product_id: string | null; stage: string }[];
  mailboxes: { id: string; provider: string; email: string; account_id: string | null }[];
  posthog: { state?: string; note?: string; url?: string | null; flags?: { key: string; name: string | null }[]; cohorts?: { id: string; name: string; is_static: boolean; count: number | null }[] };
  questions: Question[];
}

const DEFAULT_Q: Question[] = [
  { key: "role", label: "Your role", on: true },
  { key: "use_for", label: "What would you use it for?", on: true },
  { key: "today", label: "How do you do it today?", on: true },
  { key: "company", label: "Company", on: true },
];

function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function Setup({ beta }: { beta: Beta | null }) {
  const { settings, betas, reload } = useEA();
  const toast = useToast();
  const [opts, setOpts] = useState<Options | null>(null);
  const [name, setName] = useState(beta?.name || "");
  const [slug, setSlug] = useState(beta?.slug || "");
  const [slugTouched, setSlugTouched] = useState(!!beta);
  const [intro, setIntro] = useState(beta?.intro || "");
  const [featureId, setFeatureId] = useState(beta?.feature_id || "");
  const [flag, setFlag] = useState<FlagTool>(beta?.flag_tool || "none");
  const [flagKey, setFlagKey] = useState(beta?.flag_key || "");
  const [cohort, setCohort] = useState(beta?.cohort_id || "");
  const [events, setEvents] = useState((beta?.usage_events || []).filter((e): e is string => typeof e === "string").join(", "));
  const [survey, setSurvey] = useState(beta?.survey_id || "");
  const [questions, setQuestions] = useState<Question[]>(beta?.questions?.length ? beta.questions : DEFAULT_Q);
  const [size, setSize] = useState(String(beta?.batch_size || 10));
  const [checkin, setCheckin] = useState(String(beta?.checkin_day || 6));
  const [quiet, setQuiet] = useState(String(beta?.quiet_days || 7));
  const [mailbox, setMailbox] = useState(settings?.mailbox || "");
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);

  const load = useCallback(async (withPosthog = true) => {
    try {
      setOpts(await runFunction<Options>("early_access_setup_options", { with_posthog: withPosthog }));
    } catch (e) {
      setProblem(why(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!mailbox && opts?.mailboxes.length) setMailbox((opts.mailboxes.find((m) => m.account_id !== "sample") || opts.mailboxes[0]).id);
  }, [opts, mailbox]);

  const cohorts = opts?.posthog.cohorts || [];
  const cohortName = cohorts.find((c) => c.id === cohort)?.name || beta?.cohort_name || null;

  const save = async (): Promise<string | null> => {
    setProblem("");
    const out = await runFunction<{ ok: boolean; beta_id?: string; problem?: string }>("early_access_setup_save", {
      ...(beta ? { beta_id: beta.id } : {}), name: name.trim(), slug: (slug || slugOf(name)).trim(), intro: intro.trim(),
      ...(featureId ? { feature_id: featureId } : {}), flag_tool: flag, flag_key: flag === "posthog" ? flagKey || null : null,
      cohort_id: flag === "posthog" ? cohort || null : null, cohort_name: flag === "posthog" ? cohortName : null,
      posthog_url: opts?.posthog.url || beta?.posthog_url || null,
      usage_events: events.split(",").map((e) => e.trim()).filter(Boolean), survey_id: survey.trim() || null,
      questions, batch_size: Number(size), checkin_day: Number(checkin), quiet_days: Number(quiet), mailbox: mailbox || null,
    });
    if (!out.ok) {
      setProblem(out.problem || "Not saved.");
      return null;
    }
    return out.beta_id || null;
  };

  const saveOnly = async () => {
    setBusy("save");
    try {
      const id = await save();
      if (id) {
        toast("Saved.");
        await reload();
        to.roster(id);
      }
    } catch (e) {
      setProblem(why(e));
    } finally {
      setBusy("");
    }
  };

  const saveAndTurnOn = async () => {
    setBusy("on");
    setSteps([]);
    try {
      const id = await save();
      if (!id) return;
      await reload("betas");
      const fresh = { ...(beta || {}), id, slug: slug || slugOf(name), name, state: beta?.state || "draft", widget_key: beta?.widget_key || null } as Beta;
      const ok = await turnOn(fresh, (s) => setSteps((now) => [...now, s]));
      await reload();
      toast(ok ? "The sign-up page is on." : "Not everything turned on; see the steps.");
    } catch (e) {
      setProblem(why(e));
    } finally {
      setBusy("");
    }
  };

  const pause = async (state: "paused" | "open" | "closed") => {
    if (!beta) return;
    setBusy(state);
    try {
      await runFunction("early_access_setup_save", { beta_id: beta.id, state });
      toast(state === "paused" ? "Paused: the page says it isn't taking sign-ups." : state === "closed" ? "Closed." : "Open again.");
      await reload();
    } catch (e) {
      toast(why(e));
    } finally {
      setBusy("");
    }
  };

  const loadSample = async () => {
    setBusy("sample");
    try {
      const out = await runFunction<{ beta_id?: string; message?: string }>("early_access_sample_data", { mode: "load" });
      toast(out.message || "Loaded the sample.");
      await reload();
      if (out.beta_id) to.roster(out.beta_id);
    } catch (e) {
      toast(why(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="c-app">
      <Header icon={FlaskConical} title={beta ? `${beta.name}: settings` : "Set up a beta"}
        back={betas.length ? { label: "Back", onClick: () => (beta ? to.roster(beta.id) : to.roster()) } : undefined} />
      <main className="c-body ea-setup">
        {!beta && !betas.length ? (
          <div className="ea-band">
            <div className="ea-grow">
              <div>Look around first?</div>
              <div className="ea-sub">A sample beta with 40 made-up people in every state. Nothing in it is sent; clear it any time.</div>
            </div>
            <Button busy={busy === "sample"} onClick={() => void loadSample()}>Load a sample</Button>
          </div>
        ) : null}

        <section className="ea-sec">
          <h2 className="ea-h2">The feature</h2>
          {opts?.features.length ? (
            <Field label="Feature" hint="From your feature list. Its stage becomes beta while this runs.">
              <select className="c-select" value={featureId} onChange={(e) => {
                setFeatureId(e.target.value);
                const f = opts.features.find((x) => x.id === e.target.value);
                if (f && !name) { setName(f.name); if (!slugTouched) setSlug(slugOf(f.name)); }
              }}>
                <option value="">A new feature, named below</option>
                {opts.features.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.stage})</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="Name" hint="What the sign-up page calls it.">
            <input className="c-input" value={name} maxLength={120} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugOf(e.target.value)); }} />
          </Field>
          <Field label="One line about it" hint="Under the name on the sign-up page.">
            <input className="c-input" value={intro} maxLength={400} onChange={(e) => setIntro(e.target.value)} />
          </Field>
          <Field label="Page address" hint="The sign-up page is this app's address, then this. Lowercase letters, numbers and dashes.">
            <input className="c-input" value={slug} maxLength={48} onChange={(e) => { setSlug(e.target.value.toLowerCase()); setSlugTouched(true); }} />
          </Field>
        </section>

        <section className="ea-sec">
          <h2 className="ea-h2">Letting someone in</h2>
          <Segmented<FlagTool> label="How the feature turns on" value={flag} onChange={setFlag} items={[
            { id: "posthog", label: "PostHog flag" }, { id: "by_hand", label: "By hand" }, { id: "none", label: "No flag" }]} />
          {flag === "posthog" ? (
            <>
              <PostHogConnect primary={false} onReady={() => void load()} />
              {opts?.posthog.state === "ready" ? (
                <>
                  <Field label="Flag" hint="Usage counts when this flag answered true for them.">
                    <select className="c-select" value={flagKey} onChange={(e) => setFlagKey(e.target.value)}>
                      <option value="">Pick a flag</option>
                      {(opts.posthog.flags || []).map((f) => <option key={f.key} value={f.key}>{f.key}{f.name ? ` (${f.name})` : ""}</option>)}
                    </select>
                  </Field>
                  <Field label="Cohort the flag targets" hint="A static cohort: letting someone in adds them to it.">
                    <select className="c-select" value={cohort} onChange={(e) => setCohort(e.target.value)}>
                      <option value="">Pick a static cohort</option>
                      {cohorts.filter((c) => c.is_static).map((c) => <option key={c.id} value={c.id}>{c.name}{c.count != null ? ` (${c.count})` : ""}</option>)}
                    </select>
                  </Field>
                  {!cohorts.some((c) => c.is_static) ? <p className="ea-sub">No static cohort in this PostHog project yet. Make one in PostHog, point the flag at it, then pick it here.</p> : null}
                </>
              ) : opts?.posthog.state && opts.posthog.state !== "not_connected" ? (
                <p className="ea-warn"><CircleAlert size={13} aria-hidden="true" /> PostHog didn't list its flags. {opts.posthog.state === "no_scope" ? "The key can't read flags." : "Try again in a minute."}</p>
              ) : null}
              <Field label="Events that mean they used it (optional)" hint="Event names, separated by commas. The flag alone counts too.">
                <input className="c-input" value={events} onChange={(e) => setEvents(e.target.value)} placeholder="export_csv" />
              </Field>
              <Field label="PostHog survey for this beta (optional)" hint="Its answers are filed as what testers said.">
                <input className="c-input" value={survey} onChange={(e) => setSurvey(e.target.value)} placeholder="Survey id" />
              </Field>
            </>
          ) : flag === "by_hand" ? (
            <p className="ea-sub">You turn it on for each person in your own tool, then tick it in their drawer. Usage reads "not connected".</p>
          ) : (
            <p className="ea-sub">The invite is the access. Usage reads "not connected", and nobody is called inactive for it.</p>
          )}
        </section>

        <section className="ea-sec">
          <h2 className="ea-h2">The sign-up questions</h2>
          <p className="ea-sub">Name and email are always asked; the email is confirmed with a code.</p>
          {questions.map((qn, i) => (
            <div key={qn.key} className="ea-q">
              <Switch checked={qn.on !== false} label={`Ask ${qn.label}`} onChange={(v) => setQuestions(questions.map((x, j) => (j === i ? { ...x, on: v } : x)))} />
              <input className="c-input" value={qn.label} aria-label="Question" maxLength={120} onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            </div>
          ))}
        </section>

        <section className="ea-sec">
          <h2 className="ea-h2">The pace</h2>
          <div className="ea-grid3">
            <Field label="Batch size" hint="People in each batch."><input className="c-input" inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} /></Field>
            <Field label="Check-in on day" hint="After the invite went."><input className="c-input" inputMode="numeric" value={checkin} onChange={(e) => setCheckin(e.target.value)} /></Field>
            <Field label="Quiet after days" hint="No use and nothing said."><input className="c-input" inputMode="numeric" value={quiet} onChange={(e) => setQuiet(e.target.value)} /></Field>
          </div>
          <Field label="Notes go from" hint="Your own mailbox in Mail. Nothing is sent until you press Send.">
            {opts?.mailboxes.length ? (
              <select className="c-select" value={mailbox} onChange={(e) => setMailbox(e.target.value)}>
                {opts.mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email}{m.account_id === "sample" ? " (sample)" : ""}</option>)}
              </select>
            ) : <p className="ea-sub">Your mailbox isn't set up in Mail yet. Notes still get drafted, and wait until it is.</p>}
          </Field>
        </section>

        {problem ? <p className="ea-warn" role="alert"><CircleAlert size={13} aria-hidden="true" /> {problem}</p> : null}
        {steps.length || beta?.turned_on?.length ? (
          <section className="ea-sec" aria-live="polite">
            <h2 className="ea-h2">Turning it on</h2>
            <ol className="ea-steps">
              {(steps.length ? steps : beta?.turned_on || []).map((s, i) => (
                <li key={i} className={s.ok ? "" : "ea-steps--bad"}>{s.ok ? <Check size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}<span>{s.said}</span></li>
              ))}
              {busy === "on" ? <li><Spinner /><span>Working…</span></li> : null}
            </ol>
          </section>
        ) : null}

        <div className="ea-row">
          <Button variant="primary" busy={busy === "on"} disabled={!name.trim() || busy !== ""} onClick={() => void saveAndTurnOn()}>
            {beta?.state === "open" ? "Save and check it's on" : "Save and turn on"}
          </Button>
          <Button busy={busy === "save"} disabled={!name.trim() || busy !== ""} onClick={() => void saveOnly()}>Save</Button>
          {beta?.state === "open" ? <Button variant="ghost" busy={busy === "paused"} onClick={() => void pause("paused")}>Pause sign-ups</Button> : null}
          {beta?.state === "paused" ? <Button variant="ghost" busy={busy === "open"} onClick={() => void pause("open")}>Take sign-ups again</Button> : null}
          {beta && beta.state !== "closed" ? <Button variant="ghost" busy={busy === "closed"} onClick={() => void pause("closed")}>Close the beta</Button> : null}
        </div>
        {DEMO ? null : <p className="ea-sub">Turning on opens the sign-up table to visitors who confirm their email, makes the Lemma's web widget and the triggers, and starts your hourly read. It needs edit access in this Lemma.</p>}
      </main>
    </div>
  );
}
