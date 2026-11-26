// Set-up, one person at a time. The `mail-setup` workflow does the work and
// waits on three forms; this is the screen for them.
//
//   start       Gmail or Outlook (connected here, with the kit's Connect), or a sample mailbox
//   reading     the first read of about a month, and learning the voice
//   categories  the five plus what it found, each one sentence to keep, change
//               or drop; the voice, rules and VIPs beside them
//   drafts      which categories get replies drafted
//   sorting     every conversation read; then the inbox opens on what it found
//
// The run's id is kept on the person's settings, so a reload lands where they were.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Mail, PenLine, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import {
  Button, Card, Connect, DEMO, Face, Pill, Spinner, Switch, client, demoNote, errorText, plural, q, runFunction, update, useConnection, useToast, whoAmI,
} from "@lemma-plugins/kit";
import { PURPOSE, addressOf, useAccounts, type Account, type Provider } from "./connection";
import { useMail } from "./data";
import { browserZone } from "./time";

type Run = {
  id: string;
  status?: string;
  active_wait?: { node_id?: string; wait_type?: string; payload?: { input_schema?: { properties?: Record<string, { default?: unknown; items?: { enum?: string[] } }> } } } | null;
  step_history?: { node_id: string; status?: string }[];
  execution_context?: Record<string, unknown>;
};

const NAMES: Record<string, string> = { gmail: "Gmail", outlook: "Outlook" };
const STEPS = ["Connect", "Read", "Categories", "Drafts", "Sort"];

function stepOf(run: Run | null): number {
  if (!run) return 0;
  const node = run.active_wait?.node_id || run.step_history?.[run.step_history.length - 1]?.node_id || "";
  if (["connect"].includes(node)) return 0;
  if (["hold", "read", "read_pass", "people", "report", "propose", "proposals"].includes(node)) return 1;
  if (["categories", "apply"].includes(node)) return 2;
  if (["drafts"].includes(node)) return 3;
  return 4;
}

function Rail({ at }: { at: number }) {
  return (
    <ol className="m-rail" aria-label="Set-up steps">
      {STEPS.map((label, i) => (
        <li key={label} className={i < at ? "is-done" : i === at ? "is-here" : ""} aria-current={i === at ? "step" : undefined}>
          <span className="m-rail__dot">{i < at ? <Check size={11} aria-hidden="true" /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function Setup() {
  const { settings, reload } = useMail();
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
    if (!runId) {
      setRun(null);
      return;
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => window.clearInterval(timer);
  }, [runId, poll]);

  const failed = run && ["FAILED", "CANCELLED"].includes(String(run.status));
  const waiting = run?.status === "WAITING" ? run.active_wait?.node_id : null;
  const at = stepOf(run);

  let body;
  if (!runId || lost || failed || !run || waiting === "connect") {
    body = <Start failed={failed ? "The last set-up stopped partway. Start again; nothing you chose is lost." : null} />;
  } else if (waiting === "categories") {
    body = <CategoriesStep run={run} />;
  } else if (waiting === "drafts") {
    body = <DraftsStep run={run} />;
  } else {
    body = <Working run={run} at={at} />;
  }
  return (
    <div className="c-app m-setup-page">
      <div className="c-setup m-setup">
        <Rail at={runId && run && !failed ? at : 0} />
        {body}
      </div>
    </div>
  );
}

/* ---------- 1. connect ---------- */

function Start({ failed }: { failed: string | null }) {
  const { settings, reload } = useMail();
  const toast = useToast();
  const [provider, setProvider] = useState<Provider>("gmail");
  // Connecting, reconnecting, an organization without Gmail or Outlook, and
  // asking someone who can: all the kit's. The account picker stays, because
  // the set-up reads one account, by its id and address.
  const conn = useConnection({ connector: provider, mode: "per_member", purpose: PURPOSE[provider] });
  const listed = useAccounts(provider, conn.state.kind);
  const mine: Account[] = DEMO
    ? conn.state.kind === "ready" ? [{ id: `sample-${provider}`, connector_id: provider, email: conn.state.as }] : []
    : listed || [];
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (mine.length && !mine.some((a) => a.id === picked)) setPicked(mine[0].id);
  }, [mine, picked]);

  const begin = async (inputs: Record<string, unknown>) => {
    const me = await whoAmI();
    const run = (await client.workflows.runs.create("mail-setup")) as unknown as Run;
    if (settings) await update("mail_settings", settings.id, { setup_run_id: run.id, setup_step: "connect" });
    await client.workflows.runs.submitForm(run.id, {
      node_id: "connect",
      inputs: { display_name: me?.name || undefined, timezone: browserZone(), ...inputs },
    } as never);
    await reload("settings");
  };

  const useAccount = async () => {
    if (DEMO) return demoNote("In the demo nothing is read. In your Lemma this reads your last month of mail from this account.");
    const account = mine.find((a) => a.id === picked);
    const email = account ? addressOf(account) : "";
    if (!account || !email) return toast("Pick an account with an address, or connect one.");
    setBusy("start");
    try {
      await begin({ provider, account_id: account.id, email });
    } catch (e) {
      toast(`Couldn't start: ${errorText(e, provider)}`);
    } finally {
      setBusy("");
    }
  };

  const sample = async () => {
    setBusy("sample");
    try {
      await runFunction("mail_sample_data", { mode: "load" });
      await begin({ provider: "sample" });
    } catch (e) {
      toast(`Couldn't load the sample: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <Face size={48} />
      <h1>Your mail, sorted the way you’d sort it</h1>
      <p className="c-setup__lead">
        Connect your mail. It reads the last month, suggests categories in your own words, learns how you write, and drafts the replies you owe. Nothing is ever sent without you.
      </p>
      {failed ? <p className="m-note m-note--warn" role="alert">{failed}</p> : null}

      <div className="c-seg m-provider" role="radiogroup" aria-label="Where your mail is">
        {(["gmail", "outlook"] as const).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={provider === p} aria-selected={provider === p} onClick={() => setProvider(p)}>
            <Mail size={14} aria-hidden="true" /> {NAMES[p]}
          </button>
        ))}
      </div>

      <Connect connection={conn} connector={provider} mode="per_member" purpose={PURPOSE[provider]} quiet className="m-connect" />

      {mine.length ? (
        <>
          <div className="c-card c-choices" role="radiogroup" aria-label={`Your ${NAMES[provider]} accounts`}>
            {mine.map((a) => (
              <label key={a.id} className="c-choice">
                <input type="radio" name="account" checked={picked === a.id} onChange={() => setPicked(a.id)} />
                <Mail size={15} className="c-faint" aria-hidden="true" />
                <span className="c-grow c-ellipsis">{addressOf(a) || a.display_name || NAMES[provider]}</span>
              </label>
            ))}
          </div>
          <div className="c-setup__row">
            <Button variant="primary" icon={Check} onClick={() => void useAccount()} busy={busy === "start"} disabled={!!busy}>
              Read my last month
            </Button>
            {conn.ready ? (
              <Button icon={Plus} onClick={conn.connect} busy={conn.busy === "connect"} disabled={!!busy}>
                Connect another
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      <div className="m-or"><span>or</span></div>
      <Button variant="ghost" icon={Sparkles} onClick={() => void sample()} busy={busy === "sample"} disabled={!!busy}>
        Look around with a sample mailbox
      </Button>
      <p className="c-setup__note">
        The sample is a month of made-up mail at .example addresses, so you can see it sort and draft before connecting anything. Clear it from Settings.
      </p>
    </>
  );
}

/* ---------- 2. reading, and 5. sorting ---------- */

function Working({ run, at }: { run: Run; at: number }) {
  const [counts, setCounts] = useState({ read: 0, people: 0, sorted: 0, total: 0, drafts: 0 });
  useEffect(() => {
    let alive = true;
    const count = async () => {
      const rows = await q<Record<string, number>>(
        "select (select count(*) from conversation where source = 'mail') as read, " +
          "(select count(*) from person) as people, " +
          "(select count(*) from conversation where source = 'mail' and sorted_at is not null) as sorted, " +
          "(select count(*) from mail_thread where draft_state in ('wanted','writing','ready')) as drafts",
      ).catch(() => []);
      const row = rows[0] || {};
      if (alive) setCounts({ read: Number(row.read || 0), people: Number(row.people || 0), sorted: Number(row.sorted || 0), total: Number(row.read || 0), drafts: Number(row.drafts || 0) });
    };
    void count();
    const timer = window.setInterval(() => void count(), 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  const node = run.active_wait?.node_id || run.step_history?.[run.step_history.length - 1]?.node_id || "";
  const learning = ["people", "report", "propose", "proposals"].includes(node);
  const sorting = at >= 4;
  const title = sorting ? "Sorting what came in" : learning ? "Learning how you write" : "Reading your last month";
  const lead = sorting
    ? "Each conversation is read once: which of your categories, what it needs from you, how soon, and whether a promise was made either way."
    : learning
      ? "From the replies you sent: your greeting, your length, your sign-off. Then the kinds of mail you get most."
      : "Conversations with people first; newsletters and notifications are kept to their headers. Nothing is sent.";
  const pct = sorting ? (counts.total ? Math.round((100 * counts.sorted) / counts.total) : 5) : learning ? 70 : Math.min(60, 8 + counts.read);
  return (
    <>
      <Face size={48} />
      <h1>{title}</h1>
      <p className="c-setup__lead">{lead}</p>
      <div className="c-counters">
        <div className="c-counter"><div className="c-counter__n">{counts.read}</div><div className="c-counter__l">conversations read</div></div>
        <div className="c-counter"><div className="c-counter__n">{counts.people}</div><div className="c-counter__l">people you deal with</div></div>
        <div className="c-counter"><div className="c-counter__n">{sorting ? counts.sorted : counts.drafts}</div><div className="c-counter__l">{sorting ? "sorted" : "drafts"}</div></div>
      </div>
      <div className="c-meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={title}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="c-log" aria-live="polite">
        <div><Spinner /> {sorting ? (node === "done" ? "Opening your inbox…" : `Sorted ${counts.sorted} of ${counts.total}`) : learning ? "Reading your own replies for your voice…" : `Read ${plural(counts.read, "conversation")} so far`}</div>
      </div>
    </>
  );
}

/* ---------- 3. categories ---------- */

interface CategoryItem { key?: string; name: string; sentence: string; keep: boolean; found?: boolean; why?: string }
interface RuleItem { text: string; scope?: string; why?: string; keep: boolean }
interface VipItem { email: string; name?: string; reason?: string; keep: boolean }

function defaults<T>(run: Run, field: string): T | undefined {
  return run.active_wait?.payload?.input_schema?.properties?.[field]?.default as T | undefined;
}

function CategoriesStep({ run }: { run: Run }) {
  const toast = useToast();
  // What it found goes first: that is the news. The five starting ones follow.
  const [cats, setCats] = useState<CategoryItem[]>(() => {
    const all = (defaults<CategoryItem[]>(run, "categories") || []).map((c) => ({ ...c }));
    return [...all.filter((c) => c.found), ...all.filter((c) => !c.found)];
  });
  const [voice, setVoice] = useState<string>(() => defaults<string>(run, "voice") || "");
  const [rules, setRules] = useState<RuleItem[]>(() => (defaults<RuleItem[]>(run, "rules") || []).map((r) => ({ ...r })));
  const [vips, setVips] = useState<VipItem[]>(() => (defaults<VipItem[]>(run, "vips") || []).map((v) => ({ ...v })));
  const [showVoice, setShowVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const traits = ((run.execution_context?.proposals as { traits?: string[] } | undefined)?.traits || []).slice(0, 5);
  const found = cats.filter((c) => c.found).length;

  const edit = (i: number, change: Partial<CategoryItem>) => setCats((list) => list.map((c, j) => (j === i ? { ...c, ...change } : c)));
  const submit = async () => {
    const kept = cats.filter((c) => c.keep && c.name.trim() && c.sentence.trim());
    if (!kept.length) return toast("Keep at least one category.");
    setBusy(true);
    try {
      await client.workflows.runs.submitForm(run.id, {
        node_id: "categories",
        inputs: {
          categories: cats.filter((c) => c.key || (c.name.trim() && c.sentence.trim())).map((c) => ({ ...c, name: c.name.trim(), sentence: c.sentence.trim() })),
          voice, rules, vips,
        },
      } as never);
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Sort it your way</h1>
      <p className="c-setup__lead">
        {found ? `It found ${plural(found, "more kind", "more kinds")} of mail in your last month. ` : ""}Each category is one sentence the sorting reads literally. Change the words, drop what you don’t want, or add your own.
      </p>
      <div className="m-cats">
        {cats.map((c, i) => (
          <div key={c.key || `new-${i}`} className={"c-card m-cat" + (c.keep ? "" : " is-off")}>
            <div className="m-cat__head">
              <input className="c-input c-input--bare m-cat__name" value={c.name} onChange={(e) => edit(i, { name: e.target.value })} aria-label="Category name" placeholder="Name" disabled={!c.keep} />
              {c.found ? <Pill tone="ai" icon={Sparkles}>Found in your mail</Pill> : null}
              <span className="c-grow" />
              {c.key ? (
                <Switch checked={c.keep} onChange={(keep) => edit(i, { keep })} label={`Keep ${c.name}`} />
              ) : (
                <Button size="sm" variant="ghost" icon={Trash2} label="Remove" onClick={() => setCats((list) => list.filter((_, j) => j !== i))} />
              )}
            </div>
            <textarea className="c-textarea m-cat__sentence" value={c.sentence} onChange={(e) => edit(i, { sentence: e.target.value })} aria-label={`What goes in ${c.name || "this category"}`} placeholder="One sentence: what mail goes here" rows={2} disabled={!c.keep} />
            {c.why ? <p className="m-cat__why">{c.why}</p> : null}
          </div>
        ))}
      </div>
      <div className="c-setup__row">
        <Button icon={Plus} onClick={() => setCats((list) => [...list, { name: "", sentence: "", keep: true }])}>Add a category</Button>
      </div>

      <Card title="How you write" icon={PenLine} action={<Button size="sm" variant="ghost" onClick={() => setShowVoice((v) => !v)} aria-expanded={showVoice}>{showVoice ? "Done" : "Edit"}</Button>}>
        {traits.length ? <ul className="m-traits">{traits.map((t) => <li key={t}>{t}</li>)}</ul> : null}
        {showVoice ? <textarea className="c-textarea" value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="How you write" rows={12} /> : null}
        <p className="c-faint m-small">Every draft follows this. Learned from the replies you sent.</p>
      </Card>

      {rules.length ? (
        <Card title="Rules" flush>
          <div className="c-list">
            {rules.map((r, i) => (
              <div key={i} className="c-li">
                <div className="c-li__main">
                  <div>{r.text}</div>
                  {r.why ? <div className="c-li__sub">{r.why}</div> : null}
                </div>
                <Switch checked={r.keep} onChange={(keep) => setRules((list) => list.map((x, j) => (j === i ? { ...x, keep } : x)))} label={`Keep rule: ${r.text}`} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {vips.length ? (
        <Card title="VIPs" icon={UserRound} flush>
          <div className="c-list">
            {vips.map((v, i) => (
              <div key={v.email} className="c-li">
                <div className="c-li__main">
                  <div>{v.name || v.email} <span className="c-faint">{v.name ? v.email : ""}</span></div>
                  {v.reason ? <div className="c-li__sub">{v.reason}</div> : null}
                </div>
                <Switch checked={v.keep} onChange={(keep) => setVips((list) => list.map((x, j) => (j === i ? { ...x, keep } : x)))} label={`${v.name || v.email} is a VIP`} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="c-setup__row m-setup__go">
        <Button variant="primary" icon={Check} onClick={() => void submit()} busy={busy}>Keep these</Button>
      </div>
    </>
  );
}

/* ---------- 4. drafts ---------- */

function DraftsStep({ run }: { run: Run }) {
  const toast = useToast();
  const { categories, reload } = useMail();
  const keys = run.active_wait?.payload?.input_schema?.properties?.draft_categories?.items?.enum || [];
  const [chosen, setChosen] = useState<Set<string>>(() => new Set((defaults<string[]>(run, "draft_categories") || [])));
  // Older runs have no brand question; then nothing is sent for it.
  const asksBrand = Boolean(run.active_wait?.payload?.input_schema?.properties?.brand_categories);
  const [team, setTeam] = useState<Set<string>>(() => new Set((defaults<string[]>(run, "brand_categories") || [])));
  const brandName = (run.execution_context?.apply as { brand_name?: string | null } | undefined)?.brand_name;
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void reload("categories");
  }, [reload]);
  const named = useMemo(() => Object.fromEntries(categories.map((c) => [c.key, c])), [categories]);
  const submit = async () => {
    setBusy(true);
    try {
      await client.workflows.runs.submitForm(run.id, {
        node_id: "drafts",
        inputs: {
          draft_categories: keys.filter((k) => chosen.has(k)),
          ...(asksBrand ? { brand_categories: keys.filter((k) => team.has(k)) } : {}),
        },
      } as never);
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Which ones get a reply drafted?</h1>
      <p className="c-setup__lead">When someone in these is waiting on you, a reply is written in your voice before you open it. Everywhere else a draft is one press away.</p>
      <div className="c-card c-choices">
        {keys.map((k) => (
          <label key={k} className="c-choice">
            <input type="checkbox" className="c-check" checked={chosen.has(k)} onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
            <span className="c-grow">
              <span>{named[k]?.name || k}</span>
              {named[k]?.sentence ? <span className="m-choice__sub">{named[k].sentence}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {asksBrand ? (
        <>
          <h2 className="m-setup__h2">Which ones go out on the team’s behalf?</h2>
          <p className="c-setup__lead">
            Drafts here are written in the team’s brand voice{brandName ? ` (${brandName})` : " once the team has one in Brand kit"}, keeping your sign-off. Everywhere else they sound like you.
          </p>
          <div className="c-card c-choices">
            {keys.map((k) => (
              <label key={k} className="c-choice">
                <input type="checkbox" className="c-check" checked={team.has(k)} onChange={(e) => setTeam((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                <span className="c-grow"><span>{named[k]?.name || k}</span></span>
              </label>
            ))}
          </div>
        </>
      ) : null}
      <div className="c-setup__row m-setup__go">
        <Button variant="primary" icon={Check} onClick={() => void submit()} busy={busy}>Sort my mail</Button>
      </div>
    </>
  );
}

