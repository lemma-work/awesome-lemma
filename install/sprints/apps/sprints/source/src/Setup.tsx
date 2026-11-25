// Set-up, once for the whole Lemma, by whoever opens Sprints first (the
// lead): how long a sprint is, the day it starts, the time zone, points or a
// task count, and who plans and closes. Or a sample sprint to look around in.
// The same screen changes it later.

import { useState } from "react";
import { ArrowLeft, IterationCw } from "lucide-react";
import { Button, Field, Header, Segmented, Spinner, useToast } from "@lemma-plugins/kit";
import { browserZone, call, ensureLeadSchedules, useSprints, useWho } from "./data";
import { WEEKDAYS, addDays, longDay, range, todayKey, weekday } from "./model";
import { to } from "./route";
import type { Settings } from "./types";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") || [];
  } catch {
    return [];
  }
}

export function Setup() {
  const { settings, reload } = useSprints();
  const { me, members } = useWho();
  const toast = useToast();
  const done = !!settings?.setup_done_at;
  const [weeks, setWeeks] = useState(String(settings?.length_weeks || 2));
  const [startDay, setStartDay] = useState(settings?.start_weekday || "mon");
  const [zone, setZone] = useState(settings?.timezone || browserZone());
  const [measure, setMeasure] = useState<Settings["measure"]>(settings?.measure || "points");
  const [lead, setLead] = useState(settings?.lead_user_id || me?.id || "");
  const [busy, setBusy] = useState("");
  const leadId = lead || me?.id || "";
  const leadName = members.find((m) => m.user_id === leadId)?.name || (leadId === me?.id ? me?.name : settings?.lead_name) || null;

  const today = todayKey(zone);
  const first = addDays(today, (WEEKDAYS.indexOf(startDay) - weekday(today) + 7) % 7);
  let last = addDays(first, 7 * Number(weeks) - 1);
  while (weekday(last) >= 5) last = addDays(last, -1);

  const save = async (sample: boolean) => {
    setBusy(sample ? "sample" : "save");
    try {
      const out = await call("sprints_setup_save", {
        length_weeks: Number(weeks), start_weekday: startDay, timezone: zone, measure, lead_user_id: leadId || null, lead_name: leadName, sample,
      });
      const fresh = { ...(settings || {}), lead_user_id: leadId, timezone: zone, id: (out.settings_id as string) || settings?.id } as Settings;
      const problem = await ensureLeadSchedules(fresh, me);
      if (problem) toast(problem);
      if (sample) {
        // About a minute of work: it shows up here as it arrives, so a slow answer is not a failure.
        try {
          const made = await call("sprints_sample_data", { mode: "load", timezone: zone });
          toast(String(made.message || "Loaded the sample sprint."));
        } catch {
          toast("The sample is still loading; it fills in here in a minute.");
        }
      } else {
        toast(String(out.message || "Saved."));
      }
      await reload();
      to.run();
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  const form = (
    <div className="sp-setup__form">
      <Field label="How long is a sprint">
        <Segmented label="Sprint length" value={weeks} onChange={setWeeks}
          items={[{ id: "1", label: "1 week" }, { id: "2", label: "2 weeks" }, { id: "3", label: "3 weeks" }, { id: "4", label: "4 weeks" }]} />
      </Field>
      <Field label="It starts on">
        <select className="c-select" value={startDay} onChange={(e) => setStartDay(e.target.value)}>
          {WEEKDAYS.map((d, k) => <option key={d} value={d}>{DAYS[k]}</option>)}
        </select>
      </Field>
      <Field label="Time zone" hint="Which day it is for the sprint, and when the lead's morning check runs (06:00).">
        <select className="c-select" value={zone} onChange={(e) => setZone(e.target.value)}>
          {[...new Set([zone, ...zones()])].map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </Field>
      <Field label="Measure work in" hint={measure === "points" ? "Estimates on a 1, 2, 3, 5, 8 scale. A task with no estimate counts as 0 and says so." : "Every task counts as one. No estimates."}>
        <Segmented label="Measure" value={measure} onChange={(m) => setMeasure(m as Settings["measure"])}
          items={[{ id: "points", label: "Points" }, { id: "tasks", label: "Tasks" }]} />
      </Field>
      <Field label="Who plans and closes sprints" hint="They get Plan, Close and urgent work that comes in mid-sprint in Today.">
        <select className="c-select" value={leadId} onChange={(e) => setLead(e.target.value)}>
          {members.length ? members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}{m.user_id === me?.id ? " (you)" : ""}</option>)
            : me ? <option value={me.id}>{me.name} (you)</option> : null}
        </select>
      </Field>
    </div>
  );

  if (done) {
    return (
      <div className="c-app">
        <Header back={{ label: "Sprints", icon: ArrowLeft, onClick: () => to.run() }} title="Set-up" />
        <main className="c-body sp-setup--narrow">
          {form}
          <p className="c-faint sp-small">Sprints already here keep their dates; the next one follows what you choose.</p>
          <div className="c-setup__row">
            <Button variant="primary" busy={busy === "save"} onClick={() => void save(false)}>Save</Button>
            <Button variant="ghost" onClick={() => to.run()}>Cancel</Button>
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="c-app">
      <div className="c-setup">
        <span className="sp-setup__icon"><IterationCw size={18} aria-hidden="true" /></span>
        <h1>Set up sprints</h1>
        <p className="c-setup__lead">Once for the whole Lemma. Each person's capacity comes from what they finished in their last three sprints, so there's nothing to fill in about anyone.</p>
        {form}
        <p className="c-setup__note">Sprint 1 runs {longDay(first)} {range(first, last)}. You plan it next.</p>
        <div className="c-setup__row">
          <Button variant="primary" busy={busy === "save"} disabled={!!busy} onClick={() => void save(false)}>Open Sprint 1</Button>
          <Button busy={busy === "sample"} disabled={!!busy} onClick={() => void save(true)}>Look around with a sample sprint</Button>
        </div>
        {busy === "sample" ? <p className="c-muted c-row sp-small"><Spinner /> Making a made-up team's last seven sprints…</p> : null}
        <p className="c-setup__note">The sample is a made-up team (made-up names) and its work; clearing it leaves your own tasks alone.</p>
      </div>
    </div>
  );
}
