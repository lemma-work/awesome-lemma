// Settings: which kinds get a brief, when, where notes come from, the
// calendars, the regular read, and the sample.

import { useEffect, useState } from "react";
import { CalendarDays, Clock, NotebookPen, RefreshCw, Sparkles, Trash2, Zap } from "lucide-react";
import {
  Button, Card, Pill, Segmented, Switch, client, runFunction, startWorkflow, update, useToast,
} from "@lemma-plugins/kit";
import { useMeetings } from "./data";
import { KIND_HINT, KIND_ICON, KIND_PLURAL } from "./marks";
import { to } from "./route";
import { turnOn } from "./Setup";
import { at, relDay } from "./time";
import { KINDS, type Kind } from "./types";

export function SettingsPage() {
  const { settings, calendars, sample, reload } = useMeetings();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState(false);
  const on = new Set((settings?.kinds_on || []) as Kind[]);

  const setKind = async (k: Kind, value: boolean) => {
    const next = KINDS.filter((x) => (x === k ? value : on.has(x)));
    setBusy(`kind-${k}`);
    try {
      const out = await runFunction<{ message: string }>("meetings_setup_kinds", { kinds_on: next });
      await runFunction("meetings_due", {});
      toast(out.message);
      await reload();
    } catch (e) {
      toast(`Couldn't change that: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  const set = async (patch: Record<string, unknown>) => {
    if (!settings) return;
    try {
      await update("meetings_settings", settings.id, patch);
      if ("brief_when" in patch) await runFunction("meetings_due", {});
      await reload();
    } catch (e) {
      toast(`Couldn't change that: ${e instanceof Error ? e.message : e}`);
    }
  };

  const readNow = async () => {
    setBusy("read");
    try {
      await startWorkflow("meetings-sweep");
      toast("Reading your calendar again.");
    } catch (e) {
      toast(`Couldn't start the read: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  const clearSample = async () => {
    setBusy("clear");
    try {
      const out = await runFunction<{ message: string }>("meetings_sample_data", { mode: "clear" });
      toast(out.message);
      to.week(0);
      await reload();
    } catch (e) {
      toast(`Couldn't clear the sample: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
      setConfirm(false);
    }
  };

  return (
    <>
      <div className="mt-head"><h1>Briefs and settings</h1></div>
      <div className="c-body mt-settings">
        <Card title="Brief me before" icon={Zap} flush>
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
                  <Switch checked={on.has(k)} disabled={!!busy} onChange={(v) => void setKind(k, v)} label={`Brief me before ${KIND_PLURAL[k].toLowerCase()}`} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="When" icon={Clock}>
          <div className="c-row mt-wrap">
            <Segmented label="When the brief comes" value={settings?.brief_when || "evening_before"}
              onChange={(v) => void set({ brief_when: v })}
              items={[{ id: "evening_before", label: "The evening before" }, { id: "hour_before", label: "An hour before" }]} />
            <span className="c-faint">{settings?.brief_when === "hour_before" ? "Written fresh, an hour before it starts." : "Ready at 18:00 the day before."}</span>
          </div>
        </Card>

        <Card title="After a meeting" icon={NotebookPen}>
          <div className="c-row mt-wrap">
            <Segmented label="Where notes come from" value={settings?.notes_from || "notes"}
              onChange={(v) => void set({ notes_from: v })}
              items={[{ id: "meet", label: "Meet transcripts" }, { id: "notes", label: "My notes" }, { id: "skip", label: "Skip" }]} />
          </div>
          <p className="c-faint" style={{ marginTop: 8 }}>
            {settings?.notes_from === "meet"
              ? settings?.meet_account_id ? "Read from Google Meet's transcript when transcription was on." : "Connect Google Meet in set-up to read its transcripts; until then, write your notes."
              : settings?.notes_from === "skip" ? "Nothing is written up after a meeting." : "After a meeting with people from outside, it asks you for a few lines and reads them."}
          </p>
        </Card>

        <Card title="Calendars" icon={CalendarDays} flush action={<Button size="sm" variant="ghost" icon={RefreshCw} busy={busy === "read"} onClick={() => void readNow()}>Read now</Button>}>
          <div className="c-list">
            {calendars.map((c) => (
              <div key={c.id} className="c-li">
                <div className="c-li__main">
                  <div>{c.provider === "sample" ? "Sample calendar" : c.email}</div>
                  <div className="c-li__sub">
                    {c.provider === "sample" ? "Made-up meetings at .example addresses." : c.provider === "google" ? "Google Calendar" : "Outlook"}
                    {c.last_read_at ? ` · read ${relDay(at(c.last_read_at)!)}` : ""}
                    {c.last_error ? ` · ${c.last_error}` : ""}
                  </div>
                </div>
                <Pill tone={c.last_error ? "danger" : c.state === "live" ? "success" : "plain"}>{c.last_error ? "Stopped" : c.state === "live" ? "Live" : "Reading"}</Pill>
              </div>
            ))}
          </div>
        </Card>

        <Running />

        {sample ? (
          <Card title="Your own calendar" icon={Sparkles}>
            <p className="c-muted">
              {calendars.some((c) => c.provider !== "sample")
                ? "Clear the sample to keep only your own meetings."
                : "Clearing the sample removes everything it made (its meetings, briefs, notes, decisions and promises, and the choices made on it) and starts set-up again for your own calendar."}
            </p>
            <div className="c-row mt-wrap" style={{ marginTop: 12 }}>
              {confirm ? (
                <>
                  <Button variant="danger" icon={Trash2} busy={busy === "clear"} onClick={() => void clearSample()}>Yes, clear the sample</Button>
                  <Button variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button>
                </>
              ) : (
                <Button variant="primary" icon={Trash2} onClick={() => setConfirm(true)}>Clear the sample and connect my calendar</Button>
              )}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Running() {
  const { settings, reload } = useMeetings();
  const toast = useToast();
  const [row, setRow] = useState<{ id: string; is_active: boolean } | null | undefined>(undefined);
  const id = Object.values(settings?.schedules || {})[0];

  // The schedule this person's settings point at, read by its id.
  useEffect(() => {
    if (!id) return setRow(null);
    void client.schedules.get(id).then((r: unknown) => {
      const s = r as { id: string; is_active: boolean };
      setRow({ id: s.id, is_active: !!s.is_active });
    }).catch(() => setRow(null));
  }, [id]);

  const toggle = async (value: boolean) => {
    if (!settings) return;
    try {
      if (row) {
        const s = (await client.schedules.update(row.id, { is_active: value } as never)) as unknown as { is_active?: boolean };
        setRow({ ...row, is_active: s?.is_active ?? value });
      } else if (value) {
        await turnOn(settings.id, settings.timezone || "UTC", settings.schedules || {});
        await reload("settings");
      }
    } catch (e) {
      toast(`Couldn't ${value ? "turn it on" : "pause it"}: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <Card title="Running for you" icon={RefreshCw} flush>
      <div className="c-list">
        <div className="c-li">
          <div className="c-li__main">
            <div>Read the calendar every 15 minutes</div>
            <div className="c-li__sub">New meetings are sorted, briefs are written when they're due, and meetings that are over are written up. Runs as you.</div>
          </div>
          <Switch checked={!!row?.is_active} disabled={row === undefined} onChange={(v) => void toggle(v)} label="Read the calendar every 15 minutes" />
        </div>
      </div>
    </Card>
  );
}

