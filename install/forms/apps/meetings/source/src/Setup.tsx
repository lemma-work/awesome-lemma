// Set-up, one person at a time. The `meetings-setup` workflow does the work
// and waits on four forms; this is the screen for them.
//
//   calendar  Google Calendar or Outlook (connected here, with the kit's Connect), or a sample calendar
//   reading   the last month and the next two weeks, then each meeting with
//             outside people sorted with one Decisions call
//   briefs    which kinds of meeting get a brief, with the meetings it would
//             brief, and the ones it was not sure of to settle
//   when      the evening before, or an hour before
//   after     Google Meet transcripts, notes the person writes, or nothing
//
// The run's id is kept on the person's settings, so a reload lands where they were.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, CircleAlert, CircleHelp, FileText, Mic, Moon, NotebookPen, SkipForward, Sparkles, Timer } from "lucide-react";
import {
  Banner, Button, Card, Connect, DEMO, Face, Menu, MenuItem, MenuLabel, Pill, Spinner, Switch, client, demoNote, errorText, orgId, plural, q, runFunction, update,
  useConnection, useToast, whoAmI,
} from "@lemma-plugins/kit";
import { PURPOSE, addressOf, useAccounts, type Account, type CalendarConnector } from "./connection";
import { useMeetings } from "./data";
import { KIND_HINT, KIND_ICON, KIND_LABEL, KIND_PLURAL, Faces, KindPill, peopleLine } from "./marks";
import { at, browserZone, clock, shortDay } from "./time";
import { KINDS, type Kind, type Meeting } from "./types";

type Step = { node_id: string; status?: string; output_data?: Record<string, unknown> | null };
type Run = {
  id: string;
  status?: string;
  active_wait?: { node_id?: string; wait_type?: string } | null;
  step_history?: Step[];
};

const STEPS = ["Calendar", "Read", "Briefs", "When", "After"];
const NAMES: Record<string, string> = { google_calendar: "Google Calendar", outlook: "Outlook" };
const PROVIDER: Record<string, "google" | "outlook"> = { google_calendar: "google", outlook: "outlook" };
const SURE_KIND = 0.5;
const SURE_BRIEF = 0.55;

function stepOf(run: Run | null): number {
  if (!run) return 0;
  const node = run.active_wait?.node_id || run.step_history?.[run.step_history.length - 1]?.node_id || "";
  if (node === "connect") return 0;
  if (["hold", "read", "sort", "sort_pass"].includes(node)) return 1;
  if (["kinds", "kinds_apply"].includes(node)) return 2;
  if (node === "timing") return 3;
  return 4;
}

function output(run: Run | null, node: string): Record<string, unknown> | null {
  const steps = (run?.step_history || []).filter((s) => s.node_id === node && s.output_data);
  return steps.length ? (steps[steps.length - 1].output_data as Record<string, unknown>) : null;
}

function Rail({ at: here }: { at: number }) {
  return (
    <ol className="mt-rail" aria-label="Set-up steps">
      {STEPS.map((label, i) => (
        <li key={label} className={i < here ? "is-done" : i === here ? "is-here" : ""} aria-current={i === here ? "step" : undefined}>
          <span className="mt-rail__dot">{i < here ? <Check size={11} aria-hidden="true" /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function Setup() {
  const { settings, reload } = useMeetings();
  const [run, setRun] = useState<Run | null>(null);
  const [lost, setLost] = useState(false);
  const runId = settings?.setup_run_id || null;

  const poll = useCallback(async () => {
    if (!runId) return;
    try {
      const fresh = (await client.workflows.runs.get(runId)) as unknown as Run;
      setRun(fresh);
      setLost(false);
      if (fresh.status === "COMPLETED") void reload();
    } catch {
      setLost(true);
    }
  }, [runId, reload]);

  useEffect(() => {
    if (!runId) return;
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => window.clearInterval(timer);
  }, [runId, poll]);

  const failed = !!run && ["FAILED", "CANCELLED"].includes(String(run.status));
  const waiting = run?.status === "WAITING" ? run.active_wait?.node_id : null;
  const here = stepOf(run);

  const restart = async () => {
    if (!settings) return;
    const fresh = (await client.workflows.runs.create("meetings-setup")) as unknown as Run;
    await update("meetings_settings", settings.id, { setup_run_id: fresh.id, setup_step: "connect" });
    setRun(null);
    await reload("settings");
  };

  let body;
  if (!runId || lost || failed) {
    body = <Restart failed={failed} onRestart={restart} />;
  } else if (!run) {
    body = <Working run={null} />;
  } else if (waiting === "connect") {
    body = <CalendarStep run={run} />;
  } else if (waiting === "kinds") {
    body = <Kinds run={run} onRestart={restart} />;
  } else if (waiting === "timing") {
    body = <Timing run={run} />;
  } else if (waiting === "after") {
    body = <After run={run} />;
  } else {
    body = <Working run={run} />;
  }
  return (
    <div className="c-app mt-setup-page">
      <div className="c-setup mt-setup">
        <Rail at={run && !failed ? here : 0} />
        {body}
      </div>
    </div>
  );
}

function Restart({ failed, onRestart }: { failed: boolean; onRestart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1>{failed ? "The set-up stopped partway" : "Set up Meetings"}</h1>
      <p className="c-setup__lead">
        {failed ? "Start it again; nothing you chose is lost." : "Your set-up wasn't found. Start it again to connect your calendar."}
      </p>
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => { setBusy(true); void onRestart().finally(() => setBusy(false)); }}>
          Start the set-up
        </Button>
      </div>
    </>
  );
}

/* ---------- 1. calendar ---------- */

/** The connectors this organization has added (any member may read which), to start on one it has. Null when that can't be read. */
function useInstalled(): Set<string> | null {
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (DEMO) return;
    void orgId().then((org) =>
      org
        ? client.connectors.authConfigs.list(org, { limit: 100 }).then(
            (r) => setInstalled(new Set((r.items || []).filter((i) => i.status !== "DISABLED").map((i) => i.connector_id))),
            () => setInstalled(null),
          )
        : undefined,
    );
  }, []);
  return installed;
}

function CalendarStep({ run }: { run: Run }) {
  const { settings } = useMeetings();
  const toast = useToast();
  const [connector, setConnector] = useState<CalendarConnector>("google_calendar");
  const [chose, setChose] = useState(false);
  // Connecting, reconnecting, an organization without this calendar, and
  // asking someone who can: all the kit's. The account picker stays, because
  // the set-up reads one account, by its id and address.
  const conn = useConnection({ connector, mode: "per_member", purpose: PURPOSE[connector] });
  const accounts = useAccounts(["google_calendar", "outlook"], conn.state.kind);
  const installed = useInstalled();
  // Start on a calendar this organization has: one the person already
  // connected, else one added here, else Google (an admin's Connect adds it).
  useEffect(() => {
    if (chose || accounts == null) return;
    const order = ["google_calendar", "outlook"] as const;
    const pick = order.find((c) => accounts.some((a) => a.connector_id === c)) || order.find((c) => installed?.has(c));
    if (pick) setConnector(pick);
  }, [accounts, installed, chose]);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState("");
  const mine: Account[] = DEMO
    ? conn.state.kind === "ready" ? [{ id: `sample-${connector}`, connector_id: connector, email: conn.state.as }] : []
    : (accounts || []).filter((a) => a.connector_id === connector);

  useEffect(() => {
    if (mine.length && !mine.some((a) => a.id === picked)) setPicked(mine[0].id);
  }, [mine, picked]);

  const submit = async (inputs: Record<string, unknown>) => {
    const me = await whoAmI();
    if (settings) await update("meetings_settings", settings.id, { setup_step: "reading" });
    await client.workflows.runs.submitForm(run.id, {
      node_id: "connect",
      inputs: { display_name: me?.name || undefined, timezone: browserZone(), ...inputs },
    } as never);
  };

  const useAccount = async () => {
    if (DEMO) return demoNote("In the demo nothing is read. In your Lemma this reads this calendar's last month and next two weeks.");
    const account = mine.find((a) => a.id === picked);
    const email = account ? addressOf(account) : "";
    if (!account || !email) return toast("Pick an account with an address, or connect one.");
    setBusy("start");
    try {
      await submit({ provider: PROVIDER[connector], account_id: account.id, email });
    } catch (e) {
      toast(`Couldn't start: ${errorText(e, connector)}`);
      setBusy("");
    }
  };

  const sample = async () => {
    setBusy("sample");
    try {
      const me = await whoAmI();
      await runFunction("meetings_sample_data", { mode: "load", timezone: browserZone(), display_name: me?.name || undefined });
      await submit({ provider: "sample" });
    } catch (e) {
      toast(`Couldn't load the sample: ${errorText(e)}`);
      setBusy("");
    }
  };

  return (
    <>
      <Face size={44} />
      <h1>Get ready for every meeting with people from outside</h1>
      <p className="c-setup__lead">
        Connect your calendar. Meetings reads the next two weeks and the last month, briefs you before the meetings that
        matter, and writes up what was decided after.
      </p>
      <Card flush>
        <div className="c-choices" style={{ marginTop: 0 }} role="radiogroup" aria-label="Calendar">
          {(["google_calendar", "outlook"] as const).map((c) => (
            <label key={c} className="c-choice">
              <input type="radio" name="calendar" checked={connector === c} onChange={() => { setConnector(c); setChose(true); }} />
              <CalendarDays size={16} aria-hidden="true" className="c-faint" />
              <span className="c-grow">{NAMES[c]}</span>
              <span className="c-faint">
                {accounts == null ? "" : accounts.some((a) => a.connector_id === c) ? "Connected" : "Not connected"}
              </span>
            </label>
          ))}
        </div>
        {mine.length ? (
          <div className="mt-connect">
            <label className="c-field">
              <span>Account</span>
              <select className="c-input" value={picked} onChange={(e) => setPicked(e.target.value)}>
                {mine.map((a) => (
                  <option key={a.id} value={a.id}>{addressOf(a) || a.display_name || a.id}</option>
                ))}
              </select>
            </label>
            <div className="c-setup__row">
              <Button variant="primary" busy={busy === "start"} disabled={!!busy} onClick={() => void useAccount()}>Read this calendar</Button>
              {conn.ready ? (
                <Button variant="ghost" busy={conn.busy === "connect"} disabled={!!busy} onClick={conn.connect}>Connect another</Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>
      <Connect connection={conn} connector={connector} mode="per_member" purpose={PURPOSE[connector]} quiet className="mt-connect-piece" />
      <div className="mt-or">
        <span>or</span>
      </div>
      <button type="button" className="mt-sample" onClick={() => void sample()} disabled={!!busy}>
        <span className="mt-sample__icon" aria-hidden="true">{busy === "sample" ? <Spinner /> : <Sparkles size={16} />}</span>
        <span className="c-grow">
          <span className="mt-sample__title">Look around with a sample calendar</span>
          <span className="mt-sample__sub">A founder's month of made-up meetings at .example addresses, and one transcript. Clear it any time.</span>
        </span>
      </button>
      <p className="c-setup__note">Meetings only reads your calendar. It never adds, changes or answers an event, and sends nothing.</p>
    </>
  );
}

/* ---------- 2. reading ---------- */

function Working({ run }: { run: Run | null }) {
  const read = output(run, "read") as { message?: string; meetings?: number; outside?: number; errors?: string[] } | null;
  const sorts = (run?.step_history || []).filter((s) => s.node_id === "sort_pass" && s.output_data);
  const sorted = sorts.reduce((n, s) => n + Number((s.output_data as { sorted?: number }).sorted || 0), 0);
  const node = run?.active_wait?.node_id || run?.step_history?.[run.step_history.length - 1]?.node_id || "";
  const finishing = ["done", "due", "end", "kinds_apply"].includes(node) || run?.status === "COMPLETED";
  const lines = [
    { done: !!read, busy: !read, text: read ? `${read.message}.` : "Reading the last month and the next two weeks" },
    ...(read
      ? [{
          done: sorts.length > 0 && Number((sorts[sorts.length - 1].output_data as { remaining?: number }).remaining || 0) === 0,
          busy: !finishing,
          text: sorted ? `Sorted ${plural(sorted, "meeting")} with people from outside` : "Sorting the meetings with people from outside",
        }]
      : []),
    ...(finishing ? [{ done: run?.status === "COMPLETED", busy: run?.status !== "COMPLETED", text: "Writing the first briefs" }] : []),
  ];
  const pct = finishing ? 92 : read ? 55 + Math.min(30, sorted) : 18;
  return (
    <>
      <Face size={44} />
      <h1>{finishing ? "Writing your first briefs" : "Reading your calendar"}</h1>
      <p className="c-setup__lead">
        {finishing
          ? "The meetings in the next two days get theirs now; the rest come when you asked for them."
          : "Who is from outside comes from email addresses. What kind of meeting each one is, and whether it needs a brief, is read one meeting at a time."}
      </p>
      <div className="c-meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <div className="c-log" aria-live="polite">
        {lines.map((l) => (
          <div key={l.text}>
            {l.done ? <Check size={14} aria-hidden="true" /> : l.busy ? <Spinner /> : <span style={{ width: 14 }} />}
            {l.text}
          </div>
        ))}
        {(read?.errors || []).map((e) => (
          <div key={e}>
            <CircleAlert size={14} aria-hidden="true" />
            Couldn't read {e}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- 3. which kinds ---------- */

function wouldBrief(m: Meeting, on: Set<Kind>): boolean | null {
  if (m.sorted_by === "person") return m.wants_brief ?? null;
  if (!m.kind) return null;
  if (!on.has(m.kind)) return false;
  if (m.sorted_by === "domains") return true;
  const nb = m.answers?.needs_brief;
  if (typeof nb?.value !== "boolean" || (nb.confidence != null && nb.confidence < SURE_BRIEF)) return null;
  const k = m.answers?.kind;
  if (k?.confidence != null && k.confidence < SURE_KIND) return null;
  return nb.value;
}

function Kinds({ run, onRestart }: { run: Run; onRestart: () => Promise<void> }) {
  const { meetings, settings, reload } = useMeetings();
  const toast = useToast();
  const [on, setOn] = useState<Set<Kind>>(() => new Set((settings?.kinds_on || ["customer", "investor", "candidate", "partner"]) as Kind[]));
  const [busy, setBusy] = useState("");
  // The meetings were written while this person waited: read them now rather
  // than trust the change stream to have said so.
  useEffect(() => {
    void reload("meetings");
  }, [reload]);
  const now = Date.now();
  const ahead = useMemo(
    () => meetings.filter((m) => m.status !== "cancelled" && (at(m.start_at)?.getTime() || 0) > now),
    [meetings, now],
  );
  const behind = meetings.length - ahead.length;
  const unsure = ahead.filter((m) => m.unsure);
  const shown = ahead.filter((m) => m.outside || on.has("internal"));
  const briefed = shown.filter((m) => wouldBrief(m, on) === true);
  const count = (k: Kind) => ahead.filter((m) => m.kind === k).length;
  const read = output(run, "read") as { meetings?: number; outside?: number; errors?: string[] } | null;

  const toggle = (k: Kind, value: boolean) => {
    const next = new Set(on);
    if (value) next.add(k);
    else next.delete(k);
    setOn(next);
  };

  const settle = async (m: Meeting, kind: Kind, wants?: boolean) => {
    setBusy(m.id);
    try {
      await runFunction("meetings_settle", { meeting_id: m.id, kind, wants_brief: wants ?? on.has(kind) });
      await reload("meetings");
      toast(`${m.title}: ${KIND_LABEL[kind].toLowerCase()}. The next read learns from it.`);
    } catch (e) {
      toast(`Couldn't keep that: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };

  const go = async () => {
    setBusy("go");
    try {
      await client.workflows.runs.submitForm(run.id, { node_id: "kinds", inputs: { kinds_on: KINDS.filter((k) => on.has(k)) } } as never);
    } catch (e) {
      toast(`Couldn't go on: ${errorText(e)}`);
      setBusy("");
    }
  };

  return (
    <>
      <h1>Which meetings get a brief?</h1>
      {read?.errors?.length ? (
        <Banner tone="danger" action={<Button size="sm" busy={busy === "restart"} onClick={() => { setBusy("restart"); void onRestart().finally(() => setBusy("")); }}>Start again</Button>}>
          <b>Your calendar couldn't be read{read.meetings ? " in full" : ""}.</b> {read.errors.join(" ")}
        </Banner>
      ) : null}
      <p className="c-setup__lead">
        It read {plural(read?.meetings ?? meetings.length, "meeting")}, {read?.outside ?? meetings.filter((m) => m.outside).length} with
        people from outside. Switch kinds on or off; the list below shows what you'd get in the next two weeks.
      </p>

      <Card flush>
        <div className="c-list">
          {KINDS.map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <div key={k} className="c-li">
                <span className="mt-kind-icon" aria-hidden="true"><Icon size={15} /></span>
                <div className="c-li__main">
                  <div>{KIND_PLURAL[k]}</div>
                  <div className="c-li__sub">{KIND_HINT[k]}</div>
                </div>
                <span className="c-faint num mt-hide-xs">{count(k) ? plural(count(k), "meeting") : ""}</span>
                <Switch checked={on.has(k)} onChange={(v) => toggle(k, v)} label={`Brief me before ${KIND_PLURAL[k].toLowerCase()}`} />
              </div>
            );
          })}
        </div>
      </Card>

      {unsure.length ? (
        <div className="c-section mt-gap">
          <div className="c-section__head">
            <h2><CircleHelp aria-hidden="true" />Not sure about these<span className="c-count">{unsure.length}</span></h2>
          </div>
          <Card flush>
            <div className="c-list">
              {unsure.map((m) => (
                <div key={m.id} className="c-li mt-li-wrap">
                  <Faces m={m} max={2} />
                  <div className="c-li__main">
                    <div className="c-ellipsis">{m.title}</div>
                    <div className="c-li__sub">{when(m)} · {peopleLine(m)}</div>
                  </div>
                  <Menu label={busy === m.id ? "Keeping…" : m.kind ? "Brief it?" : "This is…"} align="right">
                    {(close) => (
                      <>
                        {m.kind ? (
                          <>
                            <MenuLabel>{KIND_LABEL[m.kind]}: does it need a brief?</MenuLabel>
                            <MenuItem icon={FileText} onSelect={() => { close(); void settle(m, m.kind as Kind, true); }}>Brief it</MenuItem>
                            <MenuItem icon={SkipForward} onSelect={() => { close(); void settle(m, m.kind as Kind, false); }}>No brief</MenuItem>
                          </>
                        ) : null}
                        <MenuLabel>What kind of meeting?</MenuLabel>
                        {KINDS.map((k) => (
                          <MenuItem key={k} icon={KIND_ICON[k]} onSelect={() => { close(); void settle(m, k); }}>
                            {KIND_LABEL[k]}
                          </MenuItem>
                        ))}
                      </>
                    )}
                  </Menu>
                </div>
              ))}
            </div>
          </Card>
          <p className="c-setup__note" style={{ marginTop: 8 }}>What you pick here is kept as an example, so the next meetings like it are sorted without asking.</p>
        </div>
      ) : null}

      <div className="c-section mt-gap">
        <div className="c-section__head">
          <h2><FileText aria-hidden="true" />The next two weeks<span className="c-count">{plural(briefed.length, "brief")}</span></h2>
        </div>
        <Card flush>
          <div className="c-list">
            {shown.length ? shown.map((m) => {
              const b = wouldBrief(m, on);
              return (
                <div key={m.id} className={`c-li${b === false ? " mt-dim" : ""}`}>
                  <span className="mt-when num">{whenDay(m)}<br />{whenTime(m)}</span>
                  <div className="c-li__main">
                    <div className="c-ellipsis">{m.title}</div>
                    <div className="c-li__sub c-ellipsis">{peopleLine(m)}</div>
                  </div>
                  <span className="mt-hide-xs"><KindPill m={m} /></span>
                  {b === true ? <Pill tone="success">Brief</Pill> : b === false ? <Pill dot={false}>No brief</Pill> : <Pill tone="warning">Not sure</Pill>}
                </div>
              );
            }) : <div className="c-li c-faint">No meetings with people from outside in the next two weeks.</div>}
          </div>
        </Card>
        {behind > 0 ? <p className="c-setup__note" style={{ marginTop: 8 }}>And {plural(behind, "meeting")} from the last month, kept for what was said and who you met.</p> : null}
      </div>

      <div className="c-setup__row mt-gap">
        <Button variant="primary" busy={busy === "go"} onClick={() => void go()}>Brief me before {plural(briefed.length, "meeting")}</Button>
      </div>
    </>
  );
}

function whenDay(m: Meeting): string {
  const s = at(m.start_at);
  return s ? shortDay(s) : "";
}

function whenTime(m: Meeting): string {
  const s = at(m.start_at);
  return s ? clock(s) : "";
}

function when(m: Meeting): string {
  const s = at(m.start_at);
  return s ? `${shortDay(s)} ${clock(s)}` : "";
}

/* ---------- 4. when ---------- */

function Timing({ run }: { run: Run }) {
  const toast = useToast();
  const [value, setValue] = useState<"evening_before" | "hour_before">("evening_before");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await client.workflows.runs.submitForm(run.id, { node_id: "timing", inputs: { brief_when: value } } as never);
    } catch (e) {
      toast(`Couldn't go on: ${errorText(e)}`);
      setBusy(false);
    }
  };
  const options = [
    { id: "evening_before" as const, icon: Moon, title: "The evening before", sub: "Ready at 18:00 the day before, so you can read it at home." },
    { id: "hour_before" as const, icon: Timer, title: "An hour before", sub: "Written fresh, with anything that came in that morning." },
  ];
  return (
    <>
      <h1>When do you want the brief?</h1>
      <p className="c-setup__lead">Each brief is a page: who they are, where things stand, what's owed either way, and what to get out of it.</p>
      <Choices name="timing" options={options} value={value} onChange={setValue} />
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} onClick={() => void go()}>Continue</Button>
      </div>
    </>
  );
}

function Choices<T extends string>({ name, options, value, onChange }: {
  name: string;
  options: { id: T; icon: typeof Moon; title: string; sub: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <Card flush>
      <div className="c-choices" style={{ marginTop: 0 }} role="radiogroup">
        {options.map((o) => (
          <label key={o.id} className={`c-choice mt-choice${o.disabled ? " mt-dim" : ""}`}>
            <input type="radio" name={name} checked={value === o.id} disabled={o.disabled} onChange={() => onChange(o.id)} />
            <o.icon size={16} aria-hidden="true" className="c-faint" />
            <span className="c-grow">
              <span className="mt-choice__title">{o.title}</span>
              <span className="mt-choice__sub">{o.sub}</span>
            </span>
          </label>
        ))}
      </div>
    </Card>
  );
}

/* ---------- 5. after ---------- */

function After({ run }: { run: Run }) {
  const { sample, calendars, settings, reload } = useMeetings();
  const toast = useToast();
  // Read again once Google Meet is connected below.
  const [again, setAgain] = useState(0);
  const accounts = useAccounts(["googlemeet"], again);
  useEffect(() => {
    void reload("calendars");
    void reload("settings");
  }, [reload]);
  const [value, setValue] = useState<"meet" | "notes" | "skip">("notes");
  const [busy, setBusy] = useState("");
  const google = calendars.some((c) => c.provider === "google");
  const meet = (accounts || [])[0];

  const finish = async () => {
    if (value === "meet" && !sample && !meet) return toast("Connect Google Meet first, or pick another way.");
    setBusy("go");
    try {
      await client.workflows.runs.submitForm(run.id, {
        node_id: "after",
        inputs: { notes_from: value, ...(value === "meet" && meet ? { meet_account_id: meet.id } : {}) },
      } as never);
      // A real calendar is read again every fifteen minutes, as this person.
      // Asked fresh: the calendar was made by the run, after this page loaded.
      const providers = (await q<{ provider: string }>("select provider from meetings_calendar")).map((c) => c.provider);
      if (providers.length && !providers.includes("sample") && settings) {
        await turnOn(settings.id, settings.timezone || browserZone(), settings.schedules || {});
      }
    } catch (e) {
      toast(`Couldn't finish: ${errorText(e)}`);
      setBusy("");
    }
  };

  const options = [
    {
      id: "meet" as const, icon: Mic, title: "Google Meet transcripts",
      sub: sample ? "The sample calendar comes with one transcript to try it on."
        : !google ? "Only for meetings on Google Calendar."
        : meet ? `Read from ${addressOf(meet) || "your Meet account"} when Meet kept a transcript.`
        : "Meetings reads the transcript Meet keeps when transcription is on.",
      disabled: !sample && !google,
    },
    { id: "notes" as const, icon: NotebookPen, title: "Notes I write", sub: "After each meeting it asks you for a few lines, and reads them." },
    { id: "skip" as const, icon: SkipForward, title: "Skip", sub: "Briefs before, nothing after." },
  ];
  return (
    <>
      <h1>After a meeting, where does what was said come from?</h1>
      <p className="c-setup__lead">
        It's read for what was decided and what was promised either way, each kept with the sentence it came from. Promises join the same list as the ones in your mail.
      </p>
      <Choices name="after" options={options} value={value} onChange={setValue} />
      {value === "meet" && !sample && google && !meet ? (
        <Connect connector="googlemeet" mode="per_member" purpose={PURPOSE.googlemeet} quiet onReady={() => setAgain((n) => n + 1)} className="mt-connect-piece" />
      ) : null}
      <div className="c-setup__row">
        <Button variant="primary" busy={busy === "go"} onClick={() => void finish()}>Finish</Button>
      </div>
    </>
  );
}

export async function turnOn(settingsId: string, timezone: string, schedules: Record<string, string>): Promise<void> {
  const me = await whoAmI();
  const name = `meetings-sweep-${(me?.id || "me").slice(0, 8)}`;
  if (schedules[name]) return;
  const row = (await client.schedules.create({
    name, schedule_type: "TIME", workflow_name: "meetings-sweep", config: { cron: "*/15 * * * *", timezone },
  } as never)) as unknown as { id: string };
  await update("meetings_settings", settingsId, { schedules: { ...schedules, [name]: row.id } });
}
