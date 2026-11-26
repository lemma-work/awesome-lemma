// Rules (S1): the rules every pull request is read against, by state, each
// with its record as reviews made it: raised, fixed, dismissed, acted on.
// Counted from prr_finding and the rounds' ledgers, never stored.
//
// Paths: / (Active), /proposed, /paused, /retired, and /r/<id> for one rule.

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, FilePen, ListChecks, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import {
  Button, DEMO, DataProvider, Empty, Evidence, Field, Header, Pill, SearchField, Segmented, Sheet, Skeleton, canOpenApps, client, create, cx,
  errorText, go, items, openApp, plural, runFunction, update, usePath, useData, useRows, useToast, whoAmI, type Loaders, type Tone,
} from "@lemma-plugins/kit";
import type { FindingLite, Repository, RoundLite, Rule, RuleState, Severity } from "./types";

const LOADERS: Loaders = {
  rules: { sql: "SELECT * FROM prr_rule ORDER BY created_at", tables: ["prr_rule"] },
  findings: { sql: "SELECT id, rule_id, state, created_at FROM prr_finding WHERE rule_id IS NOT NULL", tables: ["prr_finding"] },
  rounds: { sql: "SELECT id, pull_request_id, status, ledger, created_at FROM prr_round WHERE status = 'done' ORDER BY created_at DESC LIMIT 1500", tables: ["prr_round"] },
  repos: { sql: "SELECT id, full_name, default_branch FROM repository ORDER BY full_name", tables: ["repository"] },
};

/** Whether this Lemma has the function that writes the rules back as REVIEW.md. */
const WRITE_BACK = "prr_write_review_md";

export default function App() {
  return (
    <DataProvider loaders={LOADERS}>
      <Rules />
    </DataProvider>
  );
}

const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  must_fix: { label: "Must fix", tone: "danger" },
  should_fix: { label: "Should fix", tone: "warning" },
  nit: { label: "Nit", tone: "plain" },
};

const json = <T,>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

type Tab = Exclude<RuleState, never>;
const TABS: Tab[] = ["active", "proposed", "paused", "retired"];
const LABEL: Record<Tab, string> = { active: "Active", proposed: "Proposed", paused: "Paused", retired: "Retired" };

function useRoute(): { tab: Tab; id: string | null } {
  const [path] = usePath();
  const [first, second] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "r" && second) return { tab: "active", id: second };
  return { tab: (TABS as string[]).includes(first) ? (first as Tab) : "active", id: null };
}

interface Record_ {
  raised: number;
  fixed: number;
  dismissed: number;
  notChecked: number;
  notCheckedWhy: string | null;
}

function Rules() {
  const { loaded, errors, reload } = useData();
  const ruleRows = useRows<Record<string, unknown>>("rules");
  const findings = useRows<FindingLite>("findings");
  const roundRows = useRows<RoundLite>("rounds");
  const repos = useRows<Repository>("repos");
  const route = useRoute();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [me, setMe] = useState<{ id: string; name: string | null } | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [canWriteBack, setCanWriteBack] = useState(false);

  useEffect(() => {
    void whoAmI().then((m) => m && setMe({ id: m.id, name: m.name || (m.email || "").split("@")[0] }));
    void client.podMembers
      .list(client.podId || "", { limit: 200 })
      .then((r) => setNames(new Map(items<{ user_id: string; user_name?: string | null; user_email?: string }>(r).map((m) => [m.user_id, m.user_name || (m.user_email || "").split("@")[0]]))))
      .catch(() => undefined);
    if (!DEMO) void client.functions.get(WRITE_BACK).then(() => setCanWriteBack(true)).catch(() => setCanWriteBack(false));
  }, []);

  const rules: Rule[] = useMemo(() => ruleRows.map((r) => ({ ...(r as unknown as Rule), scope: json(r.scope, []), quotes: json(r.quotes, []) })), [ruleRows]);

  const record = useMemo(() => {
    const out = new Map<string, Record_>();
    const get = (id: string) => out.get(id) || out.set(id, { raised: 0, fixed: 0, dismissed: 0, notChecked: 0, notCheckedWhy: null }).get(id)!;
    for (const f of findings) {
      if (!f.rule_id) continue;
      const r = get(f.rule_id);
      r.raised++;
      if (f.state === "fixed") r.fixed++;
      if (f.state === "dismissed" || f.state === "wrong") r.dismissed++;
    }
    for (const round of roundRows)
      for (const x of json<RoundLite["ledger"]>(round.ledger, []) as { rule_id: string | null; state: string; note?: string | null }[])
        if (x.rule_id && x.state === "not_checked") {
          const r = get(x.rule_id);
          r.notChecked++;
          r.notCheckedWhy ||= x.note || null;
        }
    return out;
  }, [findings, roundRows]);

  const counts = Object.fromEntries(TABS.map((t) => [t, rules.filter((r) => r.state === t).length])) as Record<Tab, number>;
  const match = (r: Rule) => !q.trim() || [r.text, r.source, ...(r.scope || [])].some((s) => (s || "").toLowerCase().includes(q.toLowerCase()));
  const list = rules.filter((r) => r.state === route.tab && match(r));
  const proposed = rules.filter((r) => r.state === "proposed");
  const open = route.id ? rules.find((r) => r.id === route.id) || null : null;

  const files = [...new Set(rules.filter((r) => r.source_kind === "file" && r.source).map((r) => r.source!.split(":")[0]))];
  const fromComments = rules.some((r) => r.source_kind === "comments");

  const set = async (rule: Rule, state: RuleState, done: string) => {
    try {
      await update("prr_rule", rule.id, { state, decided_by: me?.id || null, decided_at: new Date().toISOString() });
      toast(done);
    } catch (e) {
      toast(`Couldn't change it: ${errorText(e)}`);
    }
  };

  const readAgain = async () => {
    setBusy("read");
    try {
      const out = await runFunction<{ message?: string }>("prr_read_rules", {});
      toast(out?.message || "Reading the rule files again. New and changed rules come in as proposed.");
      void reload();
    } catch (e) {
      toast(`Couldn't start: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const writeBack = async () => {
    setBusy("write");
    try {
      const out = await runFunction<{ message?: string; url?: string }>(WRITE_BACK, {});
      toast(out?.message || "Writing REVIEW.md: a pull request with the active rules opens on each repository.");
    } catch (e) {
      toast(`Couldn't start: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const who = (id: string | null | undefined) => (id ? (me && id === me.id ? "you" : names.get(id) || null) : null);

  return (
    <div className="c-app">
      <Header icon={ListChecks} title="Rules">
        <Button icon={RefreshCw} busy={busy === "read"} onClick={() => void readAgain()}><span className="c-hide-sm">Read the repositories again</span></Button>
        <Button icon={FilePen} busy={busy === "write"} disabled={!canWriteBack} title={canWriteBack ? "Opens a pull request with the active rules as REVIEW.md" : "Coming: writing the rules back as REVIEW.md, through a pull request"} onClick={() => void writeBack()}>
          <span className="c-hide-sm">Write back as REVIEW.md</span>
        </Button>
        <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}><span className="c-hide-sm">Add a rule</span></Button>
      </Header>
      <div className="c-toolbar">
        <Segmented label="Rules by state" value={route.tab} onChange={(t) => go(t === "active" ? "/" : `/${t}`)} items={TABS.map((t) => ({ id: t, label: LABEL[t], count: counts[t] }))} />
        <SearchField value={q} onChange={setQ} placeholder="Search rules" />
      </div>

      <main className="rl-wrap">
        {!loaded ? (
          <Skeleton rows={8} />
        ) : errors.rules ? (
          <Empty title="Couldn't read the rules">{errors.rules}</Empty>
        ) : !rules.length ? (
          <Empty icon={BookOpen} title="No rules yet" action={<Button size="sm" icon={RefreshCw} busy={busy === "read"} onClick={() => void readAgain()}>Read the repositories</Button>}>
            Rules are read from each repository's AGENTS.md, CONTRIBUTING.md, REVIEW.md and the like, and proposed from past review comments. Or add one by hand.
          </Empty>
        ) : (
          <>
            {files.length || fromComments ? (
              <div className="rl-src">
                <span className="c-faint">Read from {repos.length ? <span className="rl-mono">{[...new Set(repos.map((r) => r.default_branch || "main"))].join(", ")}</span> : "the default branch"}, which pull requests can't change:</span>
                {files.map((f) => <span key={f} className="rl-chip rl-mono">{f}</span>)}
                {fromComments ? <span className="c-faint">· and merged pull requests' review comments</span> : null}
              </div>
            ) : null}

            {route.tab === "proposed" ? (
              <Proposed list={list} who={who} onSet={set} />
            ) : list.length ? (
              <div className="rl-table" role="table" aria-label={`${LABEL[route.tab]} rules`}>
                <div className="rl-tr rl-th" role="row">
                  <span role="columnheader">Rule</span>
                  <span role="columnheader">Applies to</span>
                  <span role="columnheader">Severity</span>
                  <span role="columnheader">From</span>
                  <span role="columnheader" className="rl-n">Raised</span>
                  <span role="columnheader" className="rl-n">Fixed</span>
                  <span role="columnheader" className="rl-n">Dismissed</span>
                  <span role="columnheader" className="rl-n">Acted on</span>
                </div>
                {list.map((r) => <Row key={r.id} r={r} rec={record.get(r.id)} who={who} onOpen={() => go(`/r/${r.id}`)} onRetire={() => void set(r, "retired", "Retired. It isn't checked any more; its record stays.")} />)}
              </div>
            ) : (
              <Empty title={q ? "No rule matches" : `No ${LABEL[route.tab].toLowerCase()} rules`}>
                {route.tab === "paused" ? "A paused rule isn't checked until someone makes it active again." : route.tab === "retired" ? "A retired rule keeps its record and is never checked again." : null}
              </Empty>
            )}
            {route.tab === "active" ? <div className="c-faint rl-meta">Raised, fixed and dismissed are counted from findings, so a rule's record is what reviews actually did with it.</div> : null}
            {route.tab === "active" && proposed.length ? <Proposed list={proposed.slice(0, 2)} total={proposed.length} who={who} onSet={set} /> : null}
          </>
        )}
      </main>

      <AddRule open={adding} onClose={() => setAdding(false)} repos={repos} me={me} />
      <RuleSheet rule={open} rec={open ? record.get(open.id) : undefined} repos={repos} who={who} onClose={() => go(open?.state === "active" || !open ? "/" : `/${open.state}`)} onSet={set} />
    </div>
  );
}

function scopeText(r: Rule): string {
  return r.scope?.length ? r.scope.join(", ") : "**";
}

function fromText(r: Rule, who: (id?: string | null) => string | null): string {
  if (r.source_kind === "comments") {
    const n = r.quotes?.length || 0;
    const by = who(r.decided_by);
    return `Proposed from ${n ? plural(n, "comment") : "review comments"}${r.state !== "proposed" && by ? `, accepted by ${by}` : ""}`;
  }
  if (r.source_kind === "typed") return r.source || "Added by hand";
  return r.source || "A rule file";
}

function Row({ r, rec, who, onOpen, onRetire }: { r: Rule; rec?: Record_; who: (id?: string | null) => string | null; onOpen: () => void; onRetire: () => void }) {
  const raised = rec?.raised || 0;
  const acted = raised ? Math.round(((rec?.fixed || 0) / raised) * 100) : null;
  const rarely = raised >= 5 && acted != null && acted < 30 && r.state === "active";
  const notChecked = rec?.notChecked || (r.checkable === false ? 1 : 0);
  return (
    <div className="rl-tr" role="row" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen()}>
      <div className="rl-rule" role="cell">
        <div>{r.text}</div>
        {notChecked || rarely ? (
          <div className="rl-notes">
            {notChecked ? <Pill>{rec?.notChecked ? `Not checked ${plural(rec.notChecked, "time")}` : "Can't be checked from a diff"}{rec?.notCheckedWhy || r.not_checkable_why ? `: ${rec?.notCheckedWhy || r.not_checkable_why}` : ""}</Pill> : null}
            {rarely ? (
              <>
                <Pill tone="warning">Rarely acted on: dismissed {rec?.dismissed} of {raised} times</Pill>
                <button type="button" className="rl-link" onClick={(e) => { e.stopPropagation(); onRetire(); }}>Retire it</button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <span className="rl-mono rl-scope" role="cell"><span className="rl-lbl">Applies to </span>{scopeText(r)}{r.repo ? <span className="c-faint"> · {r.repo}</span> : null}</span>
      <span role="cell"><Pill tone={SEVERITY[r.severity]?.tone || "plain"}>{SEVERITY[r.severity]?.label || r.severity}</Pill></span>
      <span className="c-muted rl-meta rl-from" role="cell">{r.source_kind === "file" ? <span className="rl-mono">{fromText(r, who)}</span> : fromText(r, who)}</span>
      <span className="rl-n num" role="cell"><span className="rl-lbl">Raised </span>{raised}</span>
      <span className="rl-n num" role="cell"><span className="rl-lbl">Fixed </span>{rec?.fixed || 0}</span>
      <span className="rl-n num" role="cell"><span className="rl-lbl">Dismissed </span>{rec?.dismissed || 0}</span>
      <span className="rl-n num" role="cell"><span className="rl-lbl">Acted on </span>{acted == null ? "—" : `${acted}%`}</span>
    </div>
  );
}

function Proposed({ list, total, who, onSet }: { list: Rule[]; total?: number; who: (id?: string | null) => string | null; onSet: (r: Rule, s: RuleState, done: string) => Promise<void> }) {
  if (!list.length) return <Empty icon={Sparkles} title="Nothing proposed">New proposals come from the rule files and from review comments each time the repositories are read.</Empty>;
  return (
    <section className="c-card rl-proposed">
      <div className="rl-proposed__head">
        <Sparkles size={15} aria-hidden="true" />
        <span>Proposed</span>
        <span className="c-faint rl-meta">{total ?? list.length} · nothing proposed is used until someone accepts it</span>
        <span className="c-grow" />
        <Pill tone="ai">ai</Pill>
      </div>
      {list.map((r) => {
        const quotes = r.quotes || [];
        const people = [...new Set(quotes.map((x) => x.who).filter(Boolean))] as string[];
        return (
          <div key={r.id} className="rl-prop">
            <div className="rl-prop__main">
              <div>{r.text}</div>
              <div className="c-faint rl-meta">
                Applies to <span className="rl-mono">{r.scope?.length ? r.scope.join(", ") : "all"}</span> · {SEVERITY[r.severity]?.label}
                {r.source_kind === "comments" ? ` · said in ${plural(quotes.length, "review comment")}${people.length ? ` by ${people.slice(0, 3).join(" and ")}` : ""}` : r.source ? <> · from <span className="rl-mono">{r.source}</span></> : null}
              </div>
              {quotes.slice(0, 1).map((x, i) => <Evidence key={i} quote={x.text} by={[x.who, x.where && `on ${x.where}`].filter(Boolean).join(" ")} />)}
            </div>
            <div className="rl-prop__acts">
              <Button size="sm" icon={Check} onClick={() => void onSet(r, "active", "Accepted. It is checked from the next round.")}>Accept</Button>
              <Button size="sm" icon={X} onClick={() => void onSet(r, "retired", "Turned down. It won't be proposed again.")}>Turn down</Button>
            </div>
          </div>
        );
      })}
      {total && total > list.length ? (
        <div className="rl-prop"><button type="button" className="rl-link" onClick={() => go("/proposed")}>See all {total} proposed</button></div>
      ) : null}
    </section>
  );
}

/* ---------- one rule, and a new one ---------- */

function RuleSheet({ rule, rec, repos, who, onClose, onSet }: {
  rule: Rule | null; rec?: Record_; repos: Repository[]; who: (id?: string | null) => string | null; onClose: () => void; onSet: (r: Rule, s: RuleState, done: string) => Promise<void>;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [scope, setScope] = useState("");
  const [severity, setSeverity] = useState<Severity>("should_fix");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!rule) return;
    setText(rule.text);
    setScope((rule.scope || []).join(", "));
    setSeverity(rule.severity);
    setRepo(rule.repo || "");
  }, [rule]);
  if (!rule) return null;
  const save = async () => {
    setBusy(true);
    try {
      await update("prr_rule", rule.id, { text: text.trim(), scope: splitGlobs(scope), severity, repo: repo || null });
      toast("Saved. The next round checks it as written.");
      onClose();
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const raised = rec?.raised || 0;
  return (
    <Sheet
      open
      title="Rule"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" busy={busy} disabled={!text.trim()} onClick={() => void save()}>Save</Button>
          <span className="c-grow" />
          {rule.state !== "active" ? <Button onClick={() => void onSet(rule, "active", "Active: checked from the next round.").then(onClose)}>Make it active</Button> : null}
          {rule.state === "active" ? <Button onClick={() => void onSet(rule, "paused", "Paused. It isn't checked until it's active again.").then(onClose)}>Pause</Button> : null}
          {rule.state !== "retired" ? <Button variant="danger" onClick={() => void onSet(rule, "retired", "Retired.").then(onClose)}>Retire</Button> : null}
        </>
      }
    >
      <Field label="The rule, as one checkable sentence">
        <textarea className="c-textarea" style={{ minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Field label="Applies to" hint="Globs, separated by commas. Empty: every file.">
        <input className="c-input rl-mono" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="billing/**, migrations/**" />
      </Field>
      <div className="rl-two">
        <Field label="Severity">
          <select className="c-select" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            <option value="must_fix">Must fix</option>
            <option value="should_fix">Should fix</option>
            <option value="nit">Nit</option>
          </select>
        </Field>
        <Field label="Repository">
          <select className="c-select" value={repo} onChange={(e) => setRepo(e.target.value)}>
            <option value="">Every repository</option>
            {repos.map((r) => <option key={r.id} value={r.full_name}>{r.full_name}</option>)}
          </select>
        </Field>
      </div>
      <div className="rl-facts">
        <div><span className="c-faint">State</span> {LABEL[rule.state]}{rule.decided_by && who(rule.decided_by) ? ` · by ${who(rule.decided_by)}` : ""}</div>
        <div><span className="c-faint">From</span> {fromText(rule, who)}</div>
        <div><span className="c-faint">Record</span> raised {raised}, fixed {rec?.fixed || 0}, dismissed {rec?.dismissed || 0}{raised ? `, acted on ${Math.round(((rec?.fixed || 0) / raised) * 100)}%` : ""}</div>
        {rec?.notChecked ? <div><span className="c-faint">Not checked</span> {plural(rec.notChecked, "time")}{rec.notCheckedWhy ? `: ${rec.notCheckedWhy}` : ""}</div> : null}
        {rule.checkable === false ? <div><span className="c-faint">Can't be checked from a diff</span>{rule.not_checkable_why ? `: ${rule.not_checkable_why}` : ""}</div> : null}
      </div>
      {(rule.quotes || []).map((x, i) => <Evidence key={i} quote={x.text} by={[x.who, x.where && `on ${x.where}`].filter(Boolean).join(" ")} />)}
      {canOpenApps() ? <div><button type="button" className="rl-link" onClick={() => void openApp("pull-requests", "/")}>Open the pull requests</button></div> : null}
    </Sheet>
  );
}

function splitGlobs(s: string): string[] {
  return s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}

function AddRule({ open, onClose, repos, me }: { open: boolean; onClose: () => void; repos: Repository[]; me: { id: string; name: string | null } | null }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [scope, setScope] = useState("");
  const [severity, setSeverity] = useState<Severity>("should_fix");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await create("prr_rule", {
        text: text.trim(), scope: splitGlobs(scope), severity, repo: repo || null, state: "active", source_kind: "typed",
        source: me?.name ? `Added by ${me.name}` : "Added by hand", checkable: true, decided_by: me?.id || null, decided_at: new Date().toISOString(),
      });
      toast("Added. The next round checks it.");
      setText("");
      setScope("");
      onClose();
    } catch (e) {
      toast(`Couldn't add it: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title="Add a rule" onClose={onClose} footer={<><Button variant="primary" busy={busy} disabled={!text.trim()} onClick={() => void add()}>Add the rule</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <Field label="The rule, as one checkable sentence" hint="Something a reviewer can check from the diff: “A write that charges money saves its idempotency key first.”">
        <textarea className="c-textarea" style={{ minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
      <Field label="Applies to" hint="Globs, separated by commas. Empty: every file.">
        <input className={cx("c-input", "rl-mono")} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="billing/**" />
      </Field>
      <div className="rl-two">
        <Field label="Severity">
          <select className="c-select" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            <option value="must_fix">Must fix</option>
            <option value="should_fix">Should fix</option>
            <option value="nit">Nit</option>
          </select>
        </Field>
        <Field label="Repository">
          <select className="c-select" value={repo} onChange={(e) => setRepo(e.target.value)}>
            <option value="">Every repository</option>
            {repos.map((r) => <option key={r.id} value={r.full_name}>{r.full_name}</option>)}
          </select>
        </Field>
      </div>
      <div className="c-faint rl-meta">It is active at once: added by a person, it needs nobody to accept it.</div>
    </Sheet>
  );
}
