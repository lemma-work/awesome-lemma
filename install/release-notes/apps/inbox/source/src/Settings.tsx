// Yours to change: categories (each one sentence), rules, how you write, your
// mailboxes and what keeps running for you.

import { useEffect, useMemo, useState } from "react";
import { Mail, PenLine, Plus, RotateCcw, Settings as Cog, Sparkles, Trash2 } from "lucide-react";
import {
  Banner, Button, Card, Connections, Field, Header, Pill, Segmented, Sheet, Switch, client, create, items, runFunction, startWorkflow, update, useToast, whoAmI, errorText,
} from "@lemma-plugins/kit";
import { PURPOSE, stoppedText, type Provider } from "./connection";
import { useMail } from "./data";
import { to } from "./route";
import type { Category, Mailbox, Settings } from "./types";

type Tab = "categories" | "rules" | "voice" | "mailboxes";
const TABS: { id: Tab; label: string }[] = [
  { id: "categories", label: "Categories" }, { id: "rules", label: "Rules" }, { id: "voice", label: "Your voice" }, { id: "mailboxes", label: "Mailboxes" },
];

export function SettingsPage({ tab }: { tab?: string }) {
  const current = (TABS.some((t) => t.id === tab) ? tab : "categories") as Tab;
  return (
    <div className="m-page">
      <Header icon={Cog} title="Categories and settings" />
      <div className="c-toolbar">
        <Segmented label="Settings" value={current} onChange={(id) => to.settings(id)} items={TABS} />
      </div>
      <div className="c-body m-settings">
        {current === "categories" ? <Categories /> : current === "rules" ? <Rules /> : current === "voice" ? <Voice /> : <Mailboxes />}
      </div>
    </div>
  );
}

const keyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "category";

function Categories() {
  const { categories, counts, reload } = useMail();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = categories.filter((c) => c.state === "active");

  const save = async () => {
    if (!editing?.name?.trim() || !editing.sentence?.trim()) return toast("A category needs a name and a sentence.");
    if (editing.id) await update("mail_category", editing.id, { name: editing.name.trim(), sentence: editing.sentence.trim() });
    else {
      let key = keyOf(editing.name);
      if (categories.some((c) => c.key === key)) key = `${key}-${Date.now().toString(36).slice(-3)}`;
      await create("mail_category", { key, name: editing.name.trim(), sentence: editing.sentence.trim(), kind: "custom", state: "active", position: 50 + active.length, hidden: false, drafts: true });
    }
    setEditing(null);
    setChanged(true);
    void reload("categories");
  };
  const flip = async (c: Category, field: "drafts" | "hidden" | "brand_voice", value: boolean) => {
    await update("mail_category", c.id, { [field]: value });
    void reload("categories");
    void reload("counts");
  };
  const retire = async (c: Category) => {
    if (active.length <= 1) return toast("Keep at least one category.");
    await update("mail_category", c.id, { state: "retired" });
    setChanged(true);
    void reload("categories");
    toast(`${c.name} removed`, { action: { label: "Undo", run: () => void update("mail_category", c.id, { state: "active" }).then(() => reload("categories")) } });
  };
  const resort = async () => {
    setBusy(true);
    try {
      const out = await runFunction<{ queued: number }>("mail_resort", { days: 14 });
      await startWorkflow("mail-sort");
      toast(`Sorting ${out.queued} recent conversations again into your categories.`);
      setChanged(false);
    } catch (e) {
      toast(`Couldn’t start: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="m-lead">Each category is one sentence the sort reads literally, word for word. Change the words to change where mail goes. Moving a conversation by hand teaches it too. Team voice: drafts there are written in the team’s brand voice (from Brand kit), keeping your sign-off; everywhere else they sound like you.</p>
      {changed ? (
        <Banner icon={RotateCcw} action={<Button size="sm" variant="primary" busy={busy} onClick={() => void resort()}>Sort again</Button>}>
          Your categories changed. Sort the last two weeks again with them? What you moved by hand stays put.
        </Banner>
      ) : null}
      <div className="c-table-wrap">
        <table className="c-table m-cattable">
          <thead>
            <tr><th>Category</th><th className="c-hide-sm">Open</th><th>Drafts replies</th><th title="Write in the team's brand voice">Team voice</th><th className="c-hide-sm">Set aside</th><th aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {active.map((c) => (
              <tr key={c.id}>
                <td className="m-cattable__main">
                  <div className="m-cattable__name">{c.name}{c.kind === "custom" ? <Pill dot={false} tone="ai" icon={Sparkles}>Yours</Pill> : null}</div>
                  <div className="m-cattable__sentence">{c.sentence}</div>
                </td>
                <td className="c-hide-sm num">{counts.category[c.key] || 0}</td>
                <td><Switch checked={!!c.drafts} onChange={(v) => void flip(c, "drafts", v)} label={`Draft replies in ${c.name}`} /></td>
                <td><Switch checked={!!c.brand_voice} onChange={(v) => void flip(c, "brand_voice", v)} label={`Write ${c.name} in the team's brand voice`} /></td>
                <td className="c-hide-sm"><Switch checked={!!c.hidden} onChange={(v) => void flip(c, "hidden", v)} label={`Set ${c.name} aside`} /></td>
                <td className="right">
                  <span className="c-row" style={{ justifyContent: "flex-end", gap: 2 }}>
                    <Button size="sm" variant="ghost" icon={PenLine} label={`Edit ${c.name}`} onClick={() => setEditing(c)} />
                    <Button size="sm" variant="ghost" icon={Trash2} label={`Remove ${c.name}`} onClick={() => void retire(c)} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="c-row" style={{ marginTop: 12 }}>
        <Button icon={Plus} onClick={() => setEditing({ name: "", sentence: "" })}>Add a category</Button>
      </div>
      <Sheet open={!!editing} title={editing?.id ? `Edit ${editing.name}` : "New category"} onClose={() => setEditing(null)}
        footer={<><Button variant="primary" onClick={() => void save()}>Save</Button><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></>}>
        <Field label="Name"><input className="c-input" value={editing?.name || ""} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} /></Field>
        <Field label="What goes here" hint="One sentence, naming the signals: who writes, about what. It must not overlap another category.">
          <textarea className="c-textarea" style={{ minHeight: 110 }} value={editing?.sentence || ""} onChange={(e) => setEditing((x) => ({ ...x, sentence: e.target.value }))} />
        </Field>
      </Sheet>
    </>
  );
}

function Rules() {
  const { rules, reload } = useMail();
  const toast = useToast();
  const [text, setText] = useState("");
  const [scope, setScope] = useState<"sorting" | "writing" | "general">("sorting");
  const add = async () => {
    if (!text.trim()) return;
    await create("mail_rule", { text: text.trim(), scope, state: "active" });
    setText("");
    void reload("rules");
  };
  const retire = async (id: string) => {
    await update("mail_rule", id, { state: "retired" });
    void reload("rules");
    toast("Rule removed", { action: { label: "Undo", run: () => void update("mail_rule", id, { state: "active" }).then(() => reload("rules")) } });
  };
  const active = rules.filter((r) => r.state === "active");
  return (
    <>
      <p className="m-lead">Standing instructions, one sentence each. Sorting rules go with every read; writing rules with every draft.</p>
      <Card title="Rules" count={active.length} flush>
        <div className="c-list">
          {active.length ? active.map((r) => (
            <div key={r.id} className="c-li">
              <Pill dot={false}>{r.scope === "sorting" ? "Sorting" : r.scope === "writing" ? "Writing" : "Both"}</Pill>
              <div className="c-li__main">{r.text}</div>
              <Button size="sm" variant="ghost" icon={Trash2} label="Remove rule" onClick={() => void retire(r.id)} />
            </div>
          )) : <div className="c-li c-muted">No rules yet.</div>}
        </div>
        <div className="c-card__foot m-ruleadd">
          <select className="c-select" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} aria-label="Applies to">
            <option value="sorting">Sorting</option><option value="writing">Writing</option><option value="general">Both</option>
          </select>
          <input className="c-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="“Anything from our lawyers is priority 3”" aria-label="New rule"
            onKeyDown={(e) => e.key === "Enter" && void add()} />
          <Button icon={Plus} onClick={() => void add()} disabled={!text.trim()}>Add</Button>
        </div>
      </Card>
    </>
  );
}

function Voice() {
  const { settings, reload } = useMail();
  const toast = useToast();
  const [text, setText] = useState(settings?.voice || "");
  useEffect(() => setText(settings?.voice || ""), [settings?.voice]);
  const save = async () => {
    if (!settings) return;
    await update("mail_settings", settings.id, { voice: text.trim() });
    void reload("settings");
    toast("Saved. The next draft follows it.");
  };
  return (
    <>
      <p className="m-lead">Every draft follows this. It was learned from the replies you sent; change anything.</p>
      {settings?.voice_traits?.length ? <ul className="m-traits">{settings.voice_traits.map((t) => <li key={t}>{t}</li>)}</ul> : null}
      <textarea className="c-textarea m-voice" value={text} onChange={(e) => setText(e.target.value)} aria-label="How you write" />
      <div className="c-row" style={{ marginTop: 10 }}>
        <Button variant="primary" onClick={() => void save()} disabled={text === (settings?.voice || "")}>Save</Button>
      </div>
    </>
  );
}

/* ---------- mailboxes, and what keeps running ---------- */

interface PlanItem { name: string; title: string; detail: string; request: Record<string, unknown> }

/** Schedules run as whoever made them, which is the point: made here, by the
 *  person, they read mail with that person's own account. Names are unique
 *  per Lemma, so each carries the person's (and the mailbox's) short id. */
function plan(mailboxes: Mailbox[], settings: Settings | null, userId: string): PlanItem[] {
  const me = (userId || "me").slice(0, 8);
  const zone = settings?.timezone || "UTC";
  const out: PlanItem[] = [];
  for (const m of mailboxes.filter((x) => x.account_id !== "sample")) {
    const tag = m.id.slice(0, 8);
    for (const event of ["received", "sent"] as const) {
      out.push({
        name: `mail-push-${m.provider}-${event}-${tag}`,
        title: `${m.provider === "gmail" ? "Gmail" : "Outlook"} ${event === "received" ? "new mail" : "sent mail"} · ${m.email}`,
        detail: event === "sent" ? "Conversations you answer elsewhere leave Needs reply on their own." : "Sorted within a minute or two of arriving.",
        request: { name: `mail-push-${m.provider}-${event}-${tag}`, schedule_type: "WEBHOOK", workflow_name: `mail-on-${m.provider}-${event}`, account_id: m.account_id, config: { source: "composio" } },
      });
    }
  }
  out.push(
    { name: `mail-catch-up-${me}`, title: "Catch-up every 15 minutes", detail: "Picks up anything a push missed.",
      request: { name: `mail-catch-up-${me}`, schedule_type: "TIME", workflow_name: "mail-catch-up", config: { cron: "*/15 * * * *", timezone: zone } } },
    { name: `mail-sweep-${me}`, title: "Hourly sweep", detail: "Snoozes come back, follow-ups come back with a nudge drafted, scheduled sends go out.",
      request: { name: `mail-sweep-${me}`, schedule_type: "TIME", workflow_name: "mail-sweep", config: { cron: "5 * * * *", timezone: zone } } },
    { name: `mail-nightly-${me}`, title: "Nightly people refresh", detail: "Recounts who you deal with, at 02:30 your time.",
      request: { name: `mail-nightly-${me}`, schedule_type: "TIME", workflow_name: "mail-nightly", config: { cron: "30 2 * * *", timezone: zone } } },
  );
  return out;
}

function Mailboxes() {
  const { mailboxes, settings, reload } = useMail();
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [running, setRunning] = useState<Record<string, { id: string; is_active: boolean }>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState("");
  const real = mailboxes.filter((m) => m.account_id !== "sample");
  const sample = mailboxes.filter((m) => m.account_id === "sample");
  const items_ = useMemo(() => plan(mailboxes, settings, userId), [mailboxes, settings, userId]);
  // Each provider a mailbox reads through: nothing while it's signed in, the
  // next step (reconnect, ask an admin) when it isn't.
  const providers = [...new Set(real.map((m) => m.provider))].filter((p): p is Provider => p === "gmail" || p === "outlook");

  useEffect(() => {
    void whoAmI().then((me) => setUserId(me?.id || ""));
  }, []);
  useEffect(() => {
    if (!real.length) return;
    void client.schedules.list({ limit: 200 } as never).then((r: unknown) => {
      const rows = items<{ id: string; name: string; is_active: boolean }>(r);
      setRunning(Object.fromEntries(rows.map((s) => [s.name, { id: s.id, is_active: s.is_active }])));
    }).catch(() => undefined);
  }, [real.length]);

  const toggle = async (item: PlanItem, on: boolean) => {
    setBusy(item.name);
    try {
      const found = running[item.name];
      const row = found
        ? ((await client.schedules.update(found.id, { is_active: on } as never)) as unknown as { id: string; is_active: boolean })
        : on ? ((await client.schedules.create(item.request as never)) as unknown as { id: string; is_active: boolean }) : null;
      if (row) setRunning((r) => ({ ...r, [item.name]: { id: row.id, is_active: on } }));
      if (settings && row && on) {
        await update("mail_settings", settings.id, { schedules: { ...(settings.schedules || {}), [item.name]: row.id }, turned_on_at: settings.turned_on_at || new Date().toISOString() });
      }
    } catch (e) {
      toast(`Couldn’t ${on ? "turn on" : "pause"}: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };

  const clearSample = async () => {
    setBusy("clear");
    try {
      const out = await runFunction<{ message: string }>("mail_sample_data", { mode: "clear" });
      toast(out.message);
      await reload();
      to.list("needs");
    } catch (e) {
      toast(`Couldn’t clear the sample: ${errorText(e)}`);
    } finally {
      setBusy("");
      setConfirm(false);
    }
  };

  return (
    <>
      {providers.length ? (
        <Connections quiet items={providers.map((p) => ({ connector: p, mode: "per_member" as const, purpose: PURPOSE[p] }))} />
      ) : null}
      <Card title="Mailboxes" icon={Mail} flush>
        <div className="c-list">
          {mailboxes.map((m) => (
            <div key={m.id} className="c-li">
              <div className="c-li__main">
                <div>{m.account_id === "sample" ? "Sample mailbox" : m.email}</div>
                <div className="c-li__sub">{m.account_id === "sample" ? "Made-up mail at .example addresses. Nothing can be sent from it." : `${m.provider === "gmail" ? "Gmail" : "Outlook"} · ${m.state === "live" ? "reading new mail" : m.state}${m.last_error ? ` · ${stoppedText(m.last_error, m.provider)}` : ""}`}</div>
              </div>
              <Pill tone={m.last_error ? "danger" : m.state === "live" ? "success" : "plain"}>{m.last_error ? "Stopped" : m.state === "live" ? "Live" : m.state === "backfilling" ? "Reading" : m.state}</Pill>
            </div>
          ))}
        </div>
      </Card>

      {sample.length ? (
        <Card title="Connect your mail">
          <p className="m-lead" style={{ margin: 0 }}>
            {real.length ? "Clear the sample to keep only your own mail." : "Clearing the sample removes everything it made (its conversations, drafts, promises, the categories and voice learned from it) and starts set-up again for your own mail."}
          </p>
          <div className="c-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
            {confirm ? (
              <>
                <Button variant="danger" icon={Trash2} busy={busy === "clear"} onClick={() => void clearSample()}>Yes, clear the sample</Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button>
              </>
            ) : (
              <Button variant="primary" icon={Trash2} onClick={() => setConfirm(true)}>{real.length ? "Clear the sample" : "Clear the sample and connect my mail"}</Button>
            )}
          </div>
        </Card>
      ) : null}

      {real.length ? (
        <Card title="Running for you" flush>
          <div className="c-list">
            {items_.map((item) => (
              <div key={item.name} className="c-li">
                <div className="c-li__main"><div>{item.title}</div><div className="c-li__sub">{item.detail}</div></div>
                <Switch checked={!!running[item.name]?.is_active} disabled={busy === item.name} onChange={(on) => void toggle(item, on)} label={item.title} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}
