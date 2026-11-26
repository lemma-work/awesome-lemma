// One proposed change, with the sentence it came from, and what the person
// can do with it: keep it, change it first, or dismiss it. Nothing changes a
// deal until they do. A dismissal is kept with what the read saw, and the
// next read learns from it.

import { useState } from "react";
import { ArrowUpRight, Check, ChevronDown, PencilLine, Sparkles, X } from "lucide-react";
import {
  Button, Evidence, Logo, Menu, MenuItem, MenuLabel, Sheet, nameOf, openApp, runFunction, useToast, errorText,
} from "@lemma-plugins/kit";
import { save, useDeals } from "./data";
import { changeLine, kindWord } from "./marks";
import { to } from "./route";
import type { Change } from "./types";

export function sureText(c: Change): string | null {
  return c.confidence != null ? `${Math.round(Number(c.confidence) * 100)}% sure` : null;
}

export function ProposalCard({ change, showDeal = true }: { change: Change; showDeal?: boolean }) {
  const { reload, me, currency, byId } = useDeals();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [gone, setGone] = useState(false);
  const deal = change.deal_id ? byId.get(change.deal_id) : undefined;
  const who = (change.people || [])[0];
  const company = change.company_name || change.company_domain;

  // Out of the list at once; the write takes a few seconds, and says so when it lands.
  const act = async (action: "keep" | "dismiss", extra: Record<string, unknown> = {}) => {
    setBusy(action === "keep" ? "keep" : String(extra.reason || "dismiss"));
    setGone(true);
    toast(action === "keep" ? (change.kind === "new_deal" ? "Adding the deal…" : "Keeping it…") : "Dismissed. The next read learns from it.");
    try {
      const out = await save<{ deal_id?: string | null; message?: string }>(action, { change_id: change.id, ...extra }, me);
      await Promise.all([reload("changes"), reload("deals")]);
      if (action === "keep") {
        toast(out.message || "Kept.", out.deal_id && change.kind === "new_deal"
          ? { action: { label: "Open", run: () => to.deal(String(out.deal_id)) } } : undefined);
      }
      void runFunction("deals_needs_you", {}).catch(() => undefined);
    } catch (e) {
      setGone(false);
      toast(`Couldn't ${action} it: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  if (gone) return null;
  const openSource = () => {
    if (!change.source_row) return;
    if (change.source === "meeting") void openApp("meetings", `/${encodeURIComponent(change.source_row)}`);
    else void openApp("inbox", `/inbox/${encodeURIComponent(change.source_row)}`);
  };

  return (
    <article className="dt-prop" aria-label={`${kindWord(change.kind)}: ${change.deal_name || company || ""}`}>
      <div className="dt-prop__head">
        <Logo name={company} domain={change.company_domain} size={22} />
        <div className="c-grow">
          <div className="dt-prop__title">
            <Sparkles size={13} aria-hidden="true" className="dt-prop__ai" />
            <span>{kindWord(change.kind)}</span>
            {showDeal ? (
              deal ? (
                <button type="button" className="dt-link c-ellipsis" onClick={() => to.deal(deal.id)}>{deal.name}</button>
              ) : (
                <span className="c-ellipsis c-muted">{change.kind === "new_deal" ? String(change.value?.name || change.deal_name || "") : change.deal_name}</span>
              )
            ) : null}
          </div>
          <div className="dt-prop__sub c-ellipsis">
            {company}
            {sureText(change) ? <span className="c-faint"> · {sureText(change)}</span> : null}
          </div>
        </div>
      </div>
      <div className="dt-prop__what">{changeLine(change, currency) || (change.kind === "new_deal" ? "" : "—")}</div>
      {change.kind === "new_deal" && change.value?.next_step ? (
        <div className="dt-prop__step">Next: {String(change.value.next_step)}</div>
      ) : null}
      <div className="dt-prop__quote">
        <Evidence quote={change.quote} by={change.speaker || nameOf(who?.name, who?.handle)} at={change.said_at} />
        {change.source_row ? (
          <button type="button" className="dt-prop__src" onClick={openSource} title={change.source === "meeting" ? "Open in Meetings" : "Open in Mail"}>
            in {change.source === "meeting" ? "the meeting" : "the conversation"} “{change.source_label || "untitled"}”
            <ArrowUpRight size={12} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="dt-prop__acts">
        <Button size="sm" variant="primary" icon={Check} busy={busy === "keep"} disabled={!!busy} onClick={() => void act("keep")}>
          {change.kind === "new_deal" ? "Add deal" : "Keep"}
        </Button>
        <Button size="sm" icon={PencilLine} disabled={!!busy} onClick={() => setEditing(true)}>Change first</Button>
        <Menu label={<>Dismiss <ChevronDown size={13} aria-hidden="true" /></>} icon={X} size="sm" variant="ghost">
          {(close) => (
            <>
              <MenuLabel>Why not?</MenuLabel>
              <MenuItem onSelect={() => { close(); void act("dismiss", { reason: "not_a_deal" }); }}>
                It isn't about a deal
              </MenuItem>
              <MenuItem onSelect={() => { close(); void act("dismiss", { reason: "wrong" }); }}>
                A deal, but not this change
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
      {editing ? <EditSheet change={change} onClose={() => setEditing(false)} onKeep={(fields) => act("keep", { fields })} /> : null}
    </article>
  );
}

function EditSheet({ change, onClose, onKeep }: { change: Change; onClose: () => void; onKeep: (fields: Record<string, unknown>) => Promise<void> }) {
  const { stages, currency } = useDeals();
  const v = change.value || {};
  const s = (k: string) => (v[k] == null ? "" : String(v[k]));
  const [form, setForm] = useState<Record<string, string>>({
    name: s("name"), stage: s("stage"), amount: s("amount"), currency: s("currency") || currency, close_date: s("close_date"),
    next_step: s("next_step"), lost_reason: s("lost_reason"),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fields: string[] = change.kind === "new_deal" ? ["name", "stage", "amount", "close_date", "next_step"]
    : change.kind === "amount" ? ["amount"] : change.kind === "lost" ? ["lost_reason"] : [change.kind];
  const keep = async () => {
    setBusy(true);
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (f === "amount") {
        out.amount = form.amount.trim() ? Number(form.amount.replace(/[^0-9.]/g, "")) : null;
        out.currency = form.currency.trim().toUpperCase() || currency;
      } else out[f] = form[f].trim() || null;
    }
    await onKeep(out);
    setBusy(false);
    onClose();
  };
  return (
    <Sheet open title={change.kind === "new_deal" ? "Add this deal" : `Keep: ${kindWord(change.kind).toLowerCase()}`} onClose={onClose}
      footer={<><span className="c-grow" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Check} busy={busy} onClick={() => void keep()}>{change.kind === "new_deal" ? "Add deal" : "Keep"}</Button></>}>
      <Evidence quote={change.quote} by={change.speaker} at={change.said_at} />
      {fields.includes("name") ? <label className="c-field"><span>What they're buying</span><input className="c-input" value={form.name} onChange={set("name")} autoFocus /></label> : null}
      {fields.includes("stage") ? (
        <label className="c-field"><span>Stage</span>
          <select className="c-select" value={form.stage} onChange={set("stage")}>
            {stages.filter((x) => change.kind === "new_deal" || x.kind !== "lost").map((x) => <option key={x.id}>{x.name}</option>)}
          </select>
        </label>
      ) : null}
      {fields.includes("amount") ? (
        <div className="dt-amount">
          <label className="c-field"><span>Amount</span><input className="c-input" inputMode="decimal" value={form.amount} onChange={set("amount")} /></label>
          <label className="c-field"><span>Currency</span><input className="c-input" value={form.currency} onChange={set("currency")} maxLength={3} /></label>
        </div>
      ) : null}
      {fields.includes("close_date") ? <label className="c-field"><span>Expected to close</span><input className="c-input" type="date" value={form.close_date} onChange={set("close_date")} /></label> : null}
      {fields.includes("next_step") ? <label className="c-field"><span>Next step</span><input className="c-input" value={form.next_step} onChange={set("next_step")} /></label> : null}
      {fields.includes("lost_reason") ? <label className="c-field"><span>Why lost</span><input className="c-input" value={form.lost_reason} onChange={set("lost_reason")} /></label> : null}
      <p className="c-field__hint">What you change is kept with the sentence, so the next read gets closer.</p>
    </Sheet>
  );
}
