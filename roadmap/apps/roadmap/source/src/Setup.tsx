// Set-up, once for the Lemma, by whoever opens Roadmap first: the product's
// name, who leads the roadmap (their "decide" items go to Today), the currency
// money is shown in first, and after how many quiet days a Now item is
// flagged. Or sample features to look around with. The same screen is
// Settings later, with the outside page's switch.

import { useState } from "react";
import { ArrowLeft, ExternalLink, Globe, Map as MapIcon } from "lucide-react";
import { Button, Card, DEMO, Field, Header, Pill, Spinner, Switch, plural, useToast } from "@lemma-plugins/kit";
import { browserZone, call, ensureLeadSchedule, ensureWidget, refreshToday, useRoadmap, useWho } from "./data";
import { to } from "./route";
import type { Settings } from "./types";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY", "SGD", "CHF", "SEK"];

export function Setup() {
  const data = useRoadmap();
  const { settings, reload } = data;
  const { me, members } = useWho();
  const toast = useToast();
  const done = !!settings?.setup_done_at;
  const ours = data.products.find((p) => p.role === "ours");
  const [product, setProduct] = useState(settings?.product_label || ours?.name || "");
  const [lead, setLead] = useState(settings?.lead_user_id || me?.id || "");
  const [currency, setCurrency] = useState((settings?.currency || "USD").toUpperCase());
  const [stale, setStale] = useState(String(settings?.stale_days || 14));
  const [busy, setBusy] = useState("");
  const leadId = lead || me?.id || "";
  const leadName = members.find((m) => m.user_id === leadId)?.name || (leadId === me?.id ? me?.name : settings?.lead_name) || null;

  const save = async (sample: boolean) => {
    setBusy(sample ? "sample" : "save");
    try {
      const out = await call("roadmap_setup_save", {
        lead_user_id: leadId || null, lead_name: leadName, timezone: browserZone(), currency, stale_days: Number(stale) || 14,
        product_label: product.trim() || null, sample,
      });
      const fresh = { ...(settings || {}), id: (out.settings_id as string) || settings?.id, lead_user_id: leadId, timezone: browserZone() } as Settings;
      const problem = await ensureLeadSchedule(fresh, me);
      if (problem) toast(problem);
      if (sample) {
        try {
          const made = await call("roadmap_sample_data", { mode: "load" });
          toast(String(made.message || "Loaded the sample roadmap."));
        } catch {
          toast("The sample is still loading; it fills in here in a minute.");
        }
        refreshToday();
      } else {
        toast(String(out.message || "Saved."));
      }
      await reload();
      to.ranked();
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  const form = (
    <div className="rm-setup__form">
      <Field label="Your product's name" hint={ours && !done ? `User feedback already named it: ${ours.name}.` : "New features you name hang on it."}>
        <input className="c-input" value={product} maxLength={120} placeholder="What you make" onChange={(e) => setProduct(e.target.value)} />
      </Field>
      <Field label="Who leads the roadmap" hint="They get “No work on it in 16 days: keep it in Now?” and “Every task done: mark it shipped?” in Today, from a check each morning at 07:00.">
        <select className="c-select" value={leadId} onChange={(e) => setLead(e.target.value)}>
          {members.length ? members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}{m.user_id === me?.id ? " (you)" : ""}</option>)
            : me ? <option value={me.id}>{me.name} (you)</option> : null}
        </select>
      </Field>
      <Field label="Show money in" hint="Deal value from Deal tracker, this currency first. Other currencies are added beside it, never converted.">
        <select className="c-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {[...new Set([currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Flag a Now item when its tasks haven't moved in" hint="Days. Progress comes from the item's project in Tasks.">
        <input className="c-input rm-setup__num" type="number" min={3} max={90} value={stale} onChange={(e) => setStale(e.target.value)} />
      </Field>
    </div>
  );

  if (done) {
    return (
      <div className="c-app">
        <Header back={{ label: "Roadmap", icon: ArrowLeft, onClick: () => to.ranked() }} title="Settings" />
        <main className="c-body rm-setup--narrow">
          {form}
          <div className="c-setup__row">
            <Button variant="primary" busy={busy === "save"} onClick={() => void save(false)}>Save</Button>
            <Button variant="ghost" onClick={() => to.ranked()}>Cancel</Button>
          </div>
          <PublicCard />
          <SampleCard />
        </main>
      </div>
    );
  }
  return (
    <div className="c-app">
      <div className="c-setup">
        <span className="rm-setup__icon"><MapIcon size={18} aria-hidden="true" /></span>
        <h1>Set up the roadmap</h1>
        <p className="c-setup__lead">Once for the whole Lemma. Features are ranked by the people who asked for them, with the companies and deals behind them; there's no score to tune.</p>
        {form}
        <div className="c-setup__row">
          <Button variant="primary" busy={busy === "save"} disabled={!!busy} onClick={() => void save(false)}>Open the roadmap</Button>
          <Button busy={busy === "sample"} disabled={!!busy} onClick={() => void save(true)}>Look around with sample features</Button>
        </div>
        {busy === "sample" ? <p className="c-muted c-row rm-small"><Spinner /> Making a made-up product's features and what fourteen companies said…</p> : null}
        <p className="c-setup__note">The sample is a made-up product, made-up companies and roles at .example addresses; clearing it leaves your own features alone. The outside page stays off until you turn it on in Settings.</p>
      </div>
    </div>
  );
}

function PublicCard() {
  const data = useRoadmap();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const on = !!data.settings?.public_on;
  const shown = data.rows.filter((r) => r.item?.public && r.horizon !== "none").length;
  const flip = async (v: boolean) => {
    setBusy(true);
    try {
      let widget: { id: string | null; url: string | null } = { id: data.settings?.widget_id || null, url: data.settings?.page_url || null };
      if (v) {
        widget = await ensureWidget(data.settings?.page_url || null);
        if (!widget.url) toast("The page's address isn't known yet; its rows are written, and anyone can read them once the app has one.");
      }
      const out = await call("roadmap_setup_save", { public_on: v, page_url: widget.url, widget_id: widget.id });
      toast(v ? `The outside page is on: ${plural(Number((out.public as { shown?: number })?.shown || 0), "item")} shown.` : "The outside page is off; it shows nothing.");
      await data.reload();
    } catch (e) {
      toast(`Couldn't change the page: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  const url = data.settings?.page_url || null;
  return (
    <Card title="Outside page" icon={Globe} action={on ? <Pill tone="success" dot>On</Pill> : <Pill dot>Off</Pill>}>
      <div className="rm-kv">
        <span className="c-muted">Shows</span>
        <span>Now, Next, Later and what shipped in the last 90 days: only items marked public ({shown} now), under their public titles. No names, no numbers, no sign-in, no voting.</span>
        <span className="c-muted">Address</span>
        <span>{url ? <a href={url} target="_blank" rel="noreferrer" className="rm-link">{url.replace(/^https?:\/\//, "")} <ExternalLink size={12} aria-hidden="true" /></a> : "Known once the page is on"}</span>
      </div>
      <Switch checked={on} disabled={busy || DEMO} label={on ? "On: anyone with the address can read it" : "Off"} onChange={(v) => void flip(v)} />
    </Card>
  );
}

function SampleCard() {
  const data = useRoadmap();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (mode: "load" | "clear") => {
    setBusy(true);
    try {
      const out = await call("roadmap_sample_data", { mode });
      toast(String(out.message || "Done."));
      await data.reload();
      refreshToday();
    } catch (e) {
      toast(`Couldn't: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Sample">
      <p className="c-muted rm-small">{data.sample ? "The sample roadmap is loaded." : "Sample features from made-up companies, to look around with."}</p>
      <Button size="sm" busy={busy} onClick={() => void run(data.sample ? "clear" : "load")}>{data.sample ? "Clear the sample" : "Load the sample"}</Button>
    </Card>
  );
}
