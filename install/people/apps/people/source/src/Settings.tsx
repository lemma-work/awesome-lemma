// Settings: which conversations count, your domains, what the team sees, the
// hourly count, and the made-up colleague for trying the team view.

import { useEffect, useState } from "react";
import { Clock, Inbox, Plus, RefreshCw, Share2, Trash2, Users, X } from "lucide-react";
import { Button, Card, Header, Switch, client, runFunction, startWorkflow, update, useToast, whoAmI, errorText } from "@lemma-plugins/kit";
import { turnOn } from "./App";
import { usePeople } from "./data";
import { to } from "./route";

const NEVER = new Set(["updates", "newsletters", "cold"]);

export function SettingsPage() {
  const { settings, categories, sample, reload } = usePeople();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [domain, setDomain] = useState("");
  const [paused, setPaused] = useState<boolean | null>(null);
  const counted = new Set(settings?.categories || []);
  const domains = settings?.own_domains || [];
  const scheduleName = Object.keys(settings?.schedules || {}).find((k) => k.startsWith("people-refresh-"));
  const scheduleId = scheduleName ? settings?.schedules?.[scheduleName] : undefined;

  useEffect(() => {
    if (!scheduleId) return setPaused(null);
    void client.schedules.get(scheduleId).then(
      (s) => setPaused((s as unknown as { is_active?: boolean }).is_active === false),
      () => setPaused(null),
    );
  }, [scheduleId]);

  const save = async (patch: Record<string, unknown>, recount = true) => {
    if (!settings) return;
    setBusy(Object.keys(patch)[0]);
    try {
      await update("people_settings", settings.id, patch);
      if (recount) await startWorkflow("people-refresh");
      await reload();
      toast(recount ? "Saved. Counting again with it." : "Saved.");
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const toggleSchedule = async (on: boolean) => {
    if (!settings) return;
    setBusy("schedule");
    try {
      if (!scheduleId) await turnOn(settings.id, settings.schedules);
      else await client.schedules.update(scheduleId, { is_active: on } as never);
      setPaused(!on);
      await reload("settings");
    } catch (e) {
      toast(`Couldn't change that: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const teamSample = async (mode: "load" | "clear") => {
    setBusy("sample");
    try {
      const out = await runFunction<{ message: string }>("people_sample_data", { mode });
      toast(out.message);
      if (mode === "load") await startWorkflow("people-refresh");
      await reload();
    } catch (e) {
      toast(`Couldn't do that: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const again = async () => {
    if (!settings) return;
    setBusy("again");
    try {
      const me = await whoAmI();
      const run = (await client.workflows.runs.create("people-setup")) as unknown as { id: string };
      await update("people_settings", settings.id, { setup_step: "categories", setup_run_id: run.id, display_name: settings.display_name || me?.name || null });
      await reload("settings");
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <Header back={{ label: "People", icon: Users, onClick: () => to.list() }} title="Settings" />
      <main className="c-body pm-settings">
        <Card title="Conversations that count" icon={Inbox} flush>
          <div className="c-list">
            {categories.map((c) => (
              <div key={c.key} className="c-li">
                <div className="c-li__main">
                  <div>{c.name}</div>
                  <div className="c-li__sub">{NEVER.has(c.key) ? "Never people: services, lists and pitches." : c.sentence}</div>
                </div>
                <Switch checked={!NEVER.has(c.key) && counted.has(c.key)} disabled={NEVER.has(c.key) || !!busy}
                  label={`Count ${c.name}`}
                  onChange={(v) => void save({ categories: v ? [...counted, c.key] : [...counted].filter((k) => k !== c.key) })} />
              </div>
            ))}
            {categories.length === 0 ? <div className="c-li c-muted">Mail isn't set up for you; your meetings still count.</div> : null}
          </div>
        </Card>

        <Card title="Your own domains" icon={Users} flush>
          <div className="c-list">
            {domains.map((d) => (
              <div key={d} className="c-li">
                <div className="c-li__main num">{d}</div>
                <Button size="sm" variant="ghost" icon={X} label={`Remove ${d}`} onClick={() => void save({ own_domains: domains.filter((x) => x !== d) })} />
              </div>
            ))}
            <form className="c-li" onSubmit={(e) => {
              e.preventDefault();
              const d = domain.trim().toLowerCase().replace(/^@/, "");
              if (d.includes(".")) void save({ own_domains: [...new Set([...domains, d])] }).then(() => setDomain(""));
            }}>
              <input className="c-input c-grow" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Add a domain" aria-label="Add a domain" />
              <Button size="sm" icon={Plus} type="submit">Add</Button>
            </form>
          </div>
          <div className="c-card__foot c-faint">People at these are colleagues, not contacts.</div>
        </Card>

        <Card title="Your team" icon={Share2} flush>
          <div className="c-list">
            <div className="c-li">
              <div className="c-li__main">
                <div>Share who you deal with</div>
                <div className="c-li__sub">The team sees the person, their company, your last contact and how warm. Never what was said.</div>
              </div>
              <Switch checked={settings?.share_with_team !== false} disabled={!!busy} label="Share who you deal with"
                onChange={(v) => void save({ share_with_team: v })} />
            </div>
            <div className="c-li">
              <div className="c-li__main">
                <div>Sample history and a sample colleague</div>
                <div className="c-li__sub">A few made-up people with months of contact (some gone quiet), and a made-up colleague's people in the team view. Clear removes exactly these.</div>
              </div>
              {sample.team || sample.people
                ? <Button size="sm" icon={Trash2} busy={busy === "sample"} onClick={() => void teamSample("clear")}>Clear</Button>
                : <Button size="sm" busy={busy === "sample"} onClick={() => void teamSample("load")}>Add</Button>}
            </div>
          </div>
        </Card>

        <Card title="Running for you" icon={Clock} flush>
          <div className="c-list">
            <div className="c-li">
              <div className="c-li__main">
                <div>Count every hour</div>
                <div className="c-li__sub">Warmth, last contact and the next meeting stay current, and anyone new is read once.</div>
              </div>
              <Switch checked={!!scheduleId && paused === false} disabled={busy === "schedule"} label="Count every hour" onChange={(v) => void toggleSchedule(v)} />
            </div>
            <div className="c-li">
              <div className="c-li__main"><div>Count now</div></div>
              <Button size="sm" icon={RefreshCw} onClick={() => void startWorkflow("people-refresh").then(() => toast("Counting again."))}>Count now</Button>
            </div>
            <div className="c-li">
              <div className="c-li__main">
                <div>Set up again</div>
                <div className="c-li__sub">The same three questions. Anything you said about someone stays.</div>
              </div>
              <Button size="sm" busy={busy === "again"} onClick={() => void again()}>Set up again</Button>
            </div>
          </div>
        </Card>
      </main>
    </>
  );
}
