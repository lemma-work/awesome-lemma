// Settings: who fits you, who to look up and how many a day, LinkedIn, the
// daily pass, sample leads, and the set-up again.

import { useEffect, useState } from "react";
import { Clock, FlaskConical, Gauge, Linkedin, RefreshCw, ScanSearch, Users } from "lucide-react";
import { Button, Card, Header, Switch, client, create, cx, day, plural, runFunction, update, useToast, whoAmI, errorText } from "@lemma-plugins/kit";
import { startSetup, turnOn } from "./App";
import { PROFILE_ID, useLeads } from "./data";
import { to } from "./route";

const KINDS: [string, string, boolean][] = [
  ["customer", "Customers", false], ["investor", "Investors", false], ["partner", "Partners", false],
  ["candidate", "Candidates", false], ["vendor", "Vendors", false], ["colleague", "Colleagues: never", true], ["other", "Other: never", true],
];

async function fingerprint(sentence: string, examples: string[]): Promise<string> {
  const norm = (s: string) => s.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
  const text = norm(sentence) + "|" + examples.map(norm).sort().join("|");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export function SettingsPage() {
  const { settings, profile, ready, sample, reload } = useLeads();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [sentence, setSentence] = useState(profile?.fit_sentence || settings?.fit_sentence || "");
  const [examples, setExamples] = useState((profile?.fit_examples || settings?.fit_examples || []).join(", "));
  const [limit, setLimit] = useState(String(settings?.daily_limit || 10));
  const [paused, setPaused] = useState<boolean | null>(null);
  const [progress, setProgress] = useState("");
  const kinds = new Set(settings?.kinds || ["customer", "investor", "partner"]);
  const scheduleName = Object.keys(settings?.schedules || {}).find((k) => k.startsWith("leads-daily-"));
  const scheduleId = scheduleName ? settings?.schedules?.[scheduleName] : undefined;

  useEffect(() => {
    if (!scheduleId) return setPaused(null);
    void client.schedules.get(scheduleId).then(
      (s) => setPaused((s as unknown as { is_active?: boolean }).is_active === false),
      () => setPaused(null),
    );
  }, [scheduleId]);

  const run = async (key: string, work: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const said = await work();
      await reload();
      if (said) toast(said);
    } catch (e) {
      toast(`Couldn't do that: ${errorText(e)}`);
    } finally {
      setBusy("");
      setProgress("");
    }
  };

  const saveFit = () => run("fit", async () => {
    const list = examples.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
    if (!sentence.trim()) return "Say who fits your team in a sentence.";
    const me = await whoAmI();
    const row = { fit_sentence: sentence.trim(), fit_examples: list, fit_version: await fingerprint(sentence, list),
      set_by: me?.id || null, set_by_name: me?.name || settings?.display_name || null, set_at: new Date().toISOString() };
    if (profile) await update("leads_profile", profile.id, row);
    else await create("leads_profile", { id: PROFILE_ID, ...row });
    return "Saved for the whole team. New look-ups are scored against it; score the rest again below.";
  });
  const rescore = () => run("rescore", async () => {
    const ids = [...new Set(ready.map((l) => l.company_id).filter(Boolean))] as string[];
    let n = 0;
    for (const id of ids) {
      setProgress(`${++n} of ${ids.length}`);
      await runFunction("leads_fit", { company_id: id, wait_seconds: 0, last: true });
    }
    return `Scored ${plural(ids.length, "company", "companies")} again. Scores someone set stay.`;
  });
  const saveKinds = (key: string, on: boolean) => run(`k-${key}`, async () => {
    if (!settings) return;
    const next = new Set(kinds);
    if (on) next.add(key);
    else next.delete(key);
    await update("leads_settings", settings.id, { kinds: [...next] });
    if (on) {
      const out = await runFunction<{ message: string }>("leads_consider", {});
      return `Saved. ${out.message}.`;
    }
    return "Saved.";
  });
  const saveLimit = () => run("limit", async () => {
    if (!settings) return;
    const n = Math.round(Number(limit));
    if (!Number.isFinite(n) || n < 1 || n > 100) return "A daily limit is between 1 and 100.";
    await update("leads_settings", settings.id, { daily_limit: n });
    return `Up to ${n} look-ups a day.`;
  });
  const toggleSchedule = (on: boolean) => run("schedule", async () => {
    if (!settings) return;
    if (!scheduleId) await turnOn(settings.id, settings.schedules);
    else await client.schedules.update(scheduleId, { is_active: on } as never);
    setPaused(!on);
  });
  const sampleData = (mode: "load" | "clear") => run("sample", async () => {
    const out = await runFunction<{ message: string }>("leads_sample_data", { mode });
    if (mode === "clear") await runFunction("leads_needs_you", {});
    return out.message;
  });
  const again = () => run("again", async () => {
    if (!settings) return;
    await startSetup(settings.id);
    to.list();
  });

  return (
    <>
      <Header back={{ label: "Leads", icon: ScanSearch, onClick: () => to.list() }} title="Settings" />
      <main className="c-body">
        <div className="ld-settings">
          <Card title="Who fits your team" icon={Gauge}>
            <p className="ld-note" style={{ marginBottom: 12 }}>
              One description for everyone in this Lemma; anyone can change it.
              {profile?.set_by_name ? ` Last set by ${profile.set_by_name}${profile.set_at ? ` on ${day(profile.set_at)}` : ""}.` : ""}
            </p>
            <label className="c-field">
              <span>In one sentence</span>
              <textarea className="c-input c-textarea ld-sentence" rows={2} value={sentence} maxLength={400} onChange={(e) => setSentence(e.target.value)} />
            </label>
            <label className="c-field" style={{ marginTop: 12 }}>
              <span>Companies that fit well, separated by commas</span>
              <input className="c-input" value={examples} onChange={(e) => setExamples(e.target.value)} />
            </label>
            <div className="c-setup__row">
              <Button variant="primary" busy={busy === "fit"} onClick={() => void saveFit()}>Save</Button>
              <Button busy={busy === "rescore"} icon={RefreshCw} onClick={() => void rescore()}>
                {busy === "rescore" && progress ? `Scoring ${progress}` : "Score every company again"}
              </Button>
            </div>
          </Card>

          <Card title="Who to look up" icon={Users}>
            <div className="ld-kinds">
              {KINDS.map(([key, label, never]) => (
                <label key={key} className={cx("ld-kind", never && "ld-dim")}>
                  <input type="checkbox" className="c-check" checked={!never && kinds.has(key)} disabled={never || busy === `k-${key}`}
                    onChange={(e) => void saveKinds(key, e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
            <label className="c-field" style={{ marginTop: 14 }}>
              <span>Look-ups a day, at most</span>
              <div className="c-row" style={{ gap: 8 }}>
                <input className="c-input ld-limit num" type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(e.target.value)} />
                <Button busy={busy === "limit"} onClick={() => void saveLimit()}>Save</Button>
              </div>
              <small className="c-field__hint">Past it, the rest wait for the next day, best first. Asking for someone yourself can go past it.</small>
            </label>
          </Card>

          <Card title="Every morning" icon={Clock}>
            <div className="c-row" style={{ gap: 12 }}>
              <div className="c-grow">
                <div>Look up who's in line, and bring your day up to date</div>
                <div className="c-li__sub">At 07:07 your time, as you. {paused === null ? (scheduleId ? "" : "Not made yet.") : paused ? "Paused." : "On."}</div>
              </div>
              <Switch label="Every morning" checked={paused === false} disabled={busy === "schedule"} onChange={(v) => void toggleSchedule(v)} />
            </div>
          </Card>

          <Card title="LinkedIn" icon={Linkedin}>
            <p className="ld-note">Not used: Lemma's LinkedIn connection can't look anyone else up, so Lead research reads public pages, including public LinkedIn ones.</p>
          </Card>

          <Card title="Sample leads" icon={FlaskConical}>
            <p className="ld-note">
              Made-up facts with made-up sources for People map's sample people, so you can see a looked-up lead. Their
              fit is scored for real against your team's description. Clear removes exactly what the sample made.
            </p>
            <div className="c-setup__row">
              <Button busy={busy === "sample"} onClick={() => void sampleData("load")}>Load sample leads</Button>
              {sample ? <Button variant="danger" busy={busy === "sample"} onClick={() => void sampleData("clear")}>Clear sample leads</Button> : null}
            </div>
          </Card>

          <Card title="Set-up">
            <p className="ld-note">Go through the set-up again. What you answered is kept, and nobody already looked up is looked up again.</p>
            <div className="c-setup__row">
              <Button busy={busy === "again"} onClick={() => void again()}>Set up again</Button>
            </div>
          </Card>
        </div>
      </main>
    </>
  );
}
