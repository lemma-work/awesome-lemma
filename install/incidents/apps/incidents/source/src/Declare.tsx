// Declare an incident, in a drawer: what is broken, how bad, who leads. The
// rest (the channel, the header, #incidents, a likely cause) is
// incidents_declare's; then the app connects the channel to the Lemma as the
// person (wire.ts). Without Slack connected, Slack's Connect is at the top:
// declaring still works, with the timeline kept here only.

import { useEffect, useState } from "react";
import { Button, Field, Sheet, errorText, useToast } from "@lemma-plugins/kit";
import { call, useIncidents, useWho } from "./data";
import { NeedsConnect, sevOf } from "./marks";
import { to } from "./route";
import { said, wireIncident } from "./wire";
import type { Incident } from "./types";

export function Declare({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = useIncidents();
  const { me, members } = useWho();
  const toast = useToast();
  const sevs = d.settings?.severities || [];
  const [title, setTitle] = useState("");
  const [sev, setSev] = useState("");
  const [service, setService] = useState("");
  const [impact, setImpact] = useState("");
  const [lead, setLead] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setSev(sevs[1]?.key || sevs[0]?.key || "sev2");
      setLead(me?.id || "");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const services = [...new Set((d.settings?.repos || []).map((r) => r.service).filter(Boolean) as string[])];
  const declare = async () => {
    setBusy(true);
    try {
      const person = members.find((m) => m.user_id === lead) || (me && lead === me.id ? { user_id: me.id, name: me.name, email: me.email || "" } : null);
      const out = await call("incidents_declare", {
        title, severity: sev, service: service || null, impact: impact || null, source: "app",
        lead_user_id: person?.user_id || null, lead_name: person?.name || null, lead_email: person?.email || null,
      });
      toast(said(out.message || "Declared.", "slack"));
      await d.reload();
      const number = Number(out.number);
      if (number) {
        const inc = { id: out.incident_id, number, channel_id: out.channel_id, channel_name: out.channel_name, status: "declared",
          channel_connected: Boolean(out.channel_connected), channel_schedule_id: out.schedule_id || null } as unknown as Incident;
        void wireIncident(inc, d.settings).then((p) => p.forEach((x) => toast(x)));
        to.incident(number);
      }
      setTitle(""); setService(""); setImpact("");
      onClose();
    } catch (e) {
      toast(`Couldn't declare: ${errorText(e, "slack")}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title="Declare an incident" onClose={onClose}
      footer={<div className="c-row"><Button variant="primary" busy={busy} disabled={!title.trim()} onClick={() => void declare()}>Declare</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>}>
      <div className="in-form">
        <NeedsConnect connector="slack" settings={d.settings} lead="Each incident gets its own Slack channel, with the people invited and a header the Lemma keeps current. Without Slack, the incident is declared and its timeline is kept here only." />
        <Field label="What is broken">
          <input className="c-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Checkout returns 502 for card payments" autoFocus />
        </Field>
        <Field label="Severity" hint={sev ? `An update is due every ${sevOf(d.settings, sev).update_every_min} min.` : undefined}>
          <select className="c-select" value={sev} onChange={(e) => setSev(e.target.value)}>
            {sevs.map((s) => <option key={s.key} value={s.key}>{sevOf(d.settings, s.key).label}</option>)}
          </select>
        </Field>
        <Field label="Service">
          {services.length ? (
            <select className="c-select" value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">Not sure yet</option>
              {services.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : <input className="c-input" value={service} onChange={(e) => setService(e.target.value)} placeholder="checkout-api" />}
        </Field>
        <Field label="Who is affected" hint="In words. Numbers come from a source, never a guess.">
          <input className="c-input" value={impact} onChange={(e) => setImpact(e.target.value)} placeholder="EU card payments" />
        </Field>
        <Field label="Lead">
          <select className="c-select" value={lead} onChange={(e) => setLead(e.target.value)}>
            {members.length ? members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}{m.user_id === me?.id ? " (you)" : ""}</option>)
              : me ? <option value={me.id}>{me.name} (you)</option> : null}
          </select>
        </Field>
        <p className="c-faint in-small">
          {d.settings?.announce_channel_name ? `Opens #${d.settings.channel_prefix || "inc-"}<number>-…, pins a header the Lemma keeps current, and tells #${d.settings.announce_channel_name}.`
            : "Opens a Slack channel for it and pins a header the Lemma keeps current."}
        </p>
      </div>
    </Sheet>
  );
}
