// Set-up, once for the team by whoever opens the app first, and the same
// page as Settings later: the product, its features, rivals, public
// listening, who files; and each member's own choices about their mail and
// meetings. Or look around with a sample first.
//
// Everything is done here, in the app: the schedules that listen and tidy
// each night are made as the person saving (they run as them), and adding the
// team's Bright Data key happens in place.

import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Lock, MessageSquare, Plus, X } from "lucide-react";
import { AskButton, Banner, Button, Card, DEMO, Field, Pill, Switch, client, errorText, items, useToast } from "@lemma-plugins/kit";
import { BD_KEYS_URL, BD_SOURCES, recordsPerRun, saveKey } from "./brightdata";
import { call, useUF, useWho, type Product, type UF, word } from "./data";
import { to } from "./route";
import { Top } from "./Top";

interface FeatureLine { name: string; parent: string | null; description: string | null; aliases: string[] }

/** "Reporting > CSV export: what it is (also: download CSV, data export)", one per line;
 *  an indented line is part of the last unindented one. */
export function parseFeatures(text: string): FeatureLine[] {
  const out: FeatureLine[] = [];
  let area: string | null = null;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const indented = /^\s+|^[-*•]\s/.test(raw) && area !== null;
    let line = raw.trim().replace(/^[-*•]\s*/, "");
    let aliases: string[] = [];
    const also = /\((?:also|aka)[:\s]+([^)]*)\)\s*$/i.exec(line);
    if (also) { aliases = also[1].split(",").map((a) => a.trim()).filter(Boolean); line = line.slice(0, also.index).trim(); }
    let description: string | null = null;
    const colon = line.indexOf(":");
    if (colon > 0) { description = line.slice(colon + 1).trim() || null; line = line.slice(0, colon).trim(); }
    let parent: string | null = null;
    if (line.includes(">")) { const [p, n] = line.split(">").map((x) => x.trim()); parent = p || null; line = n || ""; }
    else if (indented) parent = area;
    if (!line) continue;
    if (!parent && !indented) area = line;
    out.push({ name: line.slice(0, 120), parent, description, aliases });
  }
  return out;
}

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return zone === "Asia/Calcutta" ? "Asia/Kolkata" : zone;
}

/** The Lemma-wide schedules, made as the person saving (they run as them). */
export async function ensureTeamSchedules(uf: UF, brightData: boolean): Promise<string[]> {
  const want: { name: string; workflow: string; cron: string; on: boolean }[] = [
    { name: "user-feedback-hourly", workflow: "user-feedback-hourly", cron: "17 * * * *", on: true },
    { name: "user-feedback-nightly", workflow: "user-feedback-nightly", cron: "25 2 * * *", on: true },
    { name: "user-feedback-poll", workflow: "user-feedback-poll", cron: "*/10 * * * *", on: brightData },
  ];
  const problems: string[] = [];
  const made: Record<string, string> = { ...(uf.settings?.schedules || {}) };
  for (const w of want) {
    try {
      const found = items<{ id: string; name: string; is_active?: boolean }>(await client.schedules.list({ name: w.name, limit: 5 } as never)).find((x) => x.name === w.name);
      if (found) {
        made[w.name] = found.id;
        if (found.is_active !== w.on) await client.schedules.update(found.id, { is_active: w.on } as never);
        continue;
      }
      if (!w.on) continue;
      const row = (await client.schedules.create({ name: w.name, schedule_type: "TIME", workflow_name: w.workflow,
        config: { cron: w.cron, timezone: browserZone() } } as never)) as unknown as { id: string };
      made[w.name] = row.id;
    } catch (e) {
      problems.push(`${w.name.replace("user-feedback-", "")}: ${errorText(e)}`);
    }
  }
  return problems;
}

/** A filer's own trigger: new feedback keeps their "new to file" in Today current, as them. */
export async function ensureMine(me: { id: string }, filer: boolean): Promise<string | null> {
  if (!filer || DEMO) return null;
  const name = `user-feedback-today-${me.id.replace(/-/g, "").slice(0, 8)}`;
  try {
    const found = items<{ id: string; name: string }>(await client.schedules.list({ name, limit: 5 } as never)).find((x) => x.name === name);
    if (!found) await client.schedules.create({ name, schedule_type: "DATASTORE", workflow_name: "user-feedback-needs-you",
      config: { table_name: "feedback", operations: ["INSERT", "UPDATE"], when: { state: { changed: true } } } } as never);
    return null;
  } catch (e) {
    return `Couldn't add your Today trigger: ${errorText(e)}`;
  }
}

export function Setup({ first }: { first: boolean }) {
  const uf = useUF();
  const { me, members } = useWho();
  const toast = useToast();
  const ours = uf.products.find((p) => p.role !== "rival") || null;
  const [name, setName] = useState(ours?.name || "");
  const [url, setUrl] = useState(ours?.url || "");
  const [aliases, setAliases] = useState((ours?.aliases || []).join(", "));
  const [keywords, setKeywords] = useState((ours?.keywords || []).join(", "));
  const hasFeatures = uf.features.some((f) => f.state === "active");
  const [featureMode, setFeatureMode] = useState<"type" | "propose">("type");
  const [featuresText, setFeaturesText] = useState("");
  const [rivals, setRivals] = useState<{ id?: string; name: string; url: string; active: boolean; source: string | null }[]>(
    uf.products.filter((p) => p.role === "rival").map((p) => ({ id: p.id, name: p.name, url: p.url || "", active: p.active, source: p.source })));
  const [hn, setHn] = useState(uf.settings?.hn !== false);
  const [sources, setSources] = useState<string[]>(uf.settings?.brightdata_sources || []);
  const [posts, setPosts] = useState(uf.settings?.brightdata_posts || 10);
  const ownAccounts = (ours && uf.settings?.brightdata_accounts?.[ours.id]) || {};
  const [xUrl, setXUrl] = useState(ownAccounts.x || "");
  const [liUrl, setLiUrl] = useState(ownAccounts.linkedin || "");
  const [filers, setFilers] = useState<string[]>((uf.settings?.filers || []).map((f) => f.user_id));
  const [mail, setMail] = useState(uf.member?.read_mail !== false);
  const [meetings, setMeetings] = useState(uf.member?.read_meetings !== false);
  const [auto, setAuto] = useState(!!uf.member?.auto_share);
  const [busy, setBusy] = useState("");
  useEffect(() => { if (me && !filers.length && first) setFilers([me.id]); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => parseFeatures(featuresText), [featuresText]);
  const competitorWatch = rivals.some((r) => r.source === "competitor-watch");
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const estimate = recordsPerRun(1 + rivals.filter((r) => r.active && r.name.trim()).length, sources, posts);

  const save = async () => {
    setBusy("save");
    try {
      const products: Record<string, unknown>[] = [
        { id: ours?.id || null, name, role: "ours", url: url || null, aliases: split(aliases), keywords: split(keywords) },
        ...rivals.filter((r) => r.name.trim()).map((r) => ({ id: r.id || null, name: r.name, role: "rival", url: r.url || null, active: r.active })),
      ];
      const out = await call("user_feedback_setup_save", {
        products, features: featureMode === "type" && parsed.length ? parsed : null, propose_features: featureMode === "propose",
        filers: filers.map((id) => ({ user_id: id, name: members.find((m) => m.user_id === id)?.name || null })),
        hn, brightdata_sources: sources, brightdata_posts: posts, brightdata_accounts: { x: xUrl, linkedin: liUrl }, done: true,
      });
      await call("user_feedback_member_save", { read_mail: mail, read_meetings: meetings, auto_share: auto, done: true });
      const problems = DEMO ? [] : await ensureTeamSchedules(uf, !!uf.settings?.brightdata_account_id && sources.length > 0);
      if (me) { const p = await ensureMine(me, filers.includes(me.id)); if (p) problems.push(p); }
      if (!DEMO) await call("user_feedback_memory", {}).catch(() => undefined);
      toast(problems.length ? `Saved, but: ${problems.join("; ")}` : String(out.message || "Saved."));
      await uf.reload();
      if (first) to.inbox();
    } catch (e) {
      toast(`Couldn't save: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };

  const sample = async (mode: "load" | "clear") => {
    setBusy(mode);
    try {
      const out = await call("user_feedback_sample_data", { mode });
      if (mode === "load" && !DEMO) {
        await call("user_feedback_memory", {}).catch(() => undefined);
        if (me) await ensureMine(me, true);
      }
      toast(String(out.message || "Done."));
      await uf.reload();
      if (mode === "load") to.inbox();
    } catch (e) {
      toast(`Couldn't ${mode === "load" ? "load" : "clear"} the sample: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  };

  const canSave = name.trim().length > 0;
  return (
    <div className="c-app uf-app">
      {first ? (
        <header className="uf-top"><div className="uf-top__row"><span className="uf-top__mark" aria-hidden="true"><MessageSquare size={15} /></span><h1 className="uf-top__title">Feedback</h1><span className="uf-small c-faint">Set up</span></div></header>
      ) : <Top here={null} />}
      <main className="uf-setup">
        {first ? (
          <div className="uf-setup__lead">
            <h2>What people say about your product, filed under the feature it is about</h2>
            <p className="c-muted">Set it up once for the whole Lemma. Each person then chooses what the Lemma may read of their own mail and meetings.</p>
            <div className="uf-row-btns"><Button icon={FlaskConical} busy={busy === "load"} onClick={() => void sample("load")}>Look around with a sample</Button></div>
          </div>
        ) : null}
        {uf.sample && !first ? (
          <Banner icon={FlaskConical} action={<Button size="sm" busy={busy === "clear"} onClick={() => void sample("clear")}>Clear the sample</Button>}>
            You're looking at a sample: a made-up product, two made-up rivals and what people said about them.
          </Banner>
        ) : null}

        <Card title="Your product">
          <div className="uf-form">
            <Field label="Name"><input className="c-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="The name people know it by" /></Field>
            <Field label="Site"><input className="c-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
            <Field label="Other names" hint="Nicknames, old names, how customers spell it. Separated by commas."><input className="c-input" value={aliases} onChange={(e) => setAliases(e.target.value)} /></Field>
            <Field label="Phrases that can only mean it" hint="For listening in public: your domain, or the name with a word around it. Never a common word on its own."><input className="c-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></Field>
          </div>
        </Card>

        <Card title={hasFeatures ? "Add features" : "Its features"} action={hasFeatures ? <Button size="sm" variant="ghost" onClick={() => to.features()}>See the list</Button> : null}>
          {!hasFeatures ? (
            <div className="uf-choices" role="radiogroup" aria-label="Features">
              <label className={`uf-choice${featureMode === "type" ? " is-on" : ""}`}><input type="radio" checked={featureMode === "type"} onChange={() => setFeatureMode("type")} /> Type or paste them</label>
              <label className={`uf-choice${featureMode === "propose" ? " is-on" : ""}`}><input type="radio" checked={featureMode === "propose"} onChange={() => setFeatureMode("propose")} /> Propose them from what people already said</label>
            </div>
          ) : null}
          {featureMode === "type" || hasFeatures ? (
            <Field label="One per line" hint="“Area > Feature”, or a feature indented under its area. Add “: what it is” and “(also: other names)” if you like.">
              <textarea className="c-textarea uf-mono" rows={7} value={featuresText} onChange={(e) => setFeaturesText(e.target.value)}
                placeholder={"Reporting\n  CSV export: downloading a table as a file (also: data export)\n  Scheduled reports\nAccess > Single sign-on"} />
            </Field>
          ) : <p className="uf-small c-muted">Quotes come in unfiled. Each night the Lemma groups them; three or more about one thing become a suggested feature for you to add, merge or drop.</p>}
          {parsed.length ? <p className="uf-small c-faint">{parsed.length} {word(parsed.length, "feature")} read: {parsed.slice(0, 6).map((f) => (f.parent ? `${f.parent} › ${f.name}` : f.name)).join(", ")}{parsed.length > 6 ? "…" : ""}</p> : null}
        </Card>

        <Card title="Rivals" action={!competitorWatch ? <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRivals([...rivals, { name: "", url: "", active: true, source: null }])}>Add a rival</Button> : null}>
          {competitorWatch ? <p className="uf-small c-muted">Competitor watch keeps your rivals. They are listened for here too.</p> : null}
          {rivals.map((r, i) => (
            <div key={r.id || i} className="uf-rival">
              <input className="c-input" aria-label="Rival's name" value={r.name} disabled={r.source === "competitor-watch"} placeholder="Name" onChange={(e) => setRivals(rivals.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="c-input" aria-label="Rival's site" value={r.url} disabled={r.source === "competitor-watch"} placeholder="Site" onChange={(e) => setRivals(rivals.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <label className="uf-switch"><Switch checked={r.active} label={`Listen for ${r.name || "this rival"}`} onChange={(v) => setRivals(rivals.map((x, j) => (j === i ? { ...x, active: v } : x)))} /><span>Listen</span></label>
              {!r.id ? <Button size="sm" variant="ghost" icon={X} label="Remove" onClick={() => setRivals(rivals.filter((_, j) => j !== i))} /> : null}
            </div>
          ))}
          {!rivals.length ? <p className="uf-small c-faint">None yet. What people say about a rival files under your own features, so “their users complain about what we do well” is one page.</p> : null}
        </Card>

        <Card title="Listening in public">
          <div className="uf-lrow"><span><span className="uf-b">Hacker News</span><span className="uf-small c-faint uf-block">Free. Read every hour for your product's phrases and each rival's.</span></span>
            <label className="uf-switch"><Switch checked={hn} label="Hacker News" onChange={setHn} /><span>{hn ? "On" : "Off"}</span></label></div>
          <div className="uf-lrow uf-lrow--last"><span><span className="uf-b">YouTube, X, Reddit, TikTok and LinkedIn</span><span className="uf-small c-faint uf-block">Through your own Bright Data key. Off until you add one.</span></span></div>
          <BrightData uf={uf} />
          <div className="uf-sources">
            {BD_SOURCES.map((s) => (
              <label key={s.id} className="uf-check">
                <input type="checkbox" checked={sources.includes(s.id)} onChange={(e) => setSources(e.target.checked ? [...sources, s.id] : sources.filter((x) => x !== s.id))} />
                <span><span className="uf-b">{s.label}</span> <span className="c-faint uf-small">{s.how}</span>{s.id === "reddit" ? <> <Pill tone="warning">Its public API closes March 2027</Pill></> : null}</span>
              </label>
            ))}
          </div>
          {sources.includes("x") || sources.includes("linkedin") ? (
            <div className="uf-two">
              {sources.includes("x") ? <Field label="Your product's X account"><input className="c-input" value={xUrl} onChange={(e) => setXUrl(e.target.value)} placeholder="https://x.com/…" /></Field> : null}
              {sources.includes("linkedin") ? <Field label="Your company's LinkedIn page"><input className="c-input" value={liUrl} onChange={(e) => setLiUrl(e.target.value)} placeholder="https://www.linkedin.com/company/…" /></Field> : null}
            </div>
          ) : null}
          <div className="uf-two">
            <Field label="Posts per search" hint="Up to 50."><input className="c-input" type="number" min={1} max={50} value={posts} onChange={(e) => setPosts(Math.max(1, Math.min(50, Number(e.target.value) || 10)))} /></Field>
            <div className="uf-cost"><span className="uf-small c-faint">Each day, about</span><span className="uf-b">{estimate.toLocaleString()} {word(estimate, "record")}</span><span className="uf-small c-faint">for {1 + rivals.filter((r) => r.active && r.name.trim()).length} {word(1 + rivals.filter((r) => r.active && r.name.trim()).length, "product")}. Bright Data bills each record against your plan.</span></div>
          </div>
          <div className="uf-lrow uf-lrow--last"><span><span className="uf-b">A Slack channel</span><span className="uf-small c-faint uf-block">Reading one channel the team names needs a change to Lemma that isn't out yet.</span></span><Pill tone="plain">Not available yet</Pill></div>
        </Card>

        <Card title="Who files">
          <p className="uf-small c-muted">They get “N new to file” in Today. Anyone can file from the inbox.</p>
          <div className="uf-sources">
            {(members.length ? members : me ? [{ user_id: me.id, name: me.name, email: me.email || "" }] : []).map((m) => (
              <label key={m.user_id} className="uf-check">
                <input type="checkbox" checked={filers.includes(m.user_id)} onChange={(e) => setFilers(e.target.checked ? [...filers, m.user_id] : filers.filter((x) => x !== m.user_id))} />
                <span>{m.user_id === me?.id ? "You" : m.name}</span>
              </label>
            ))}
          </div>
        </Card>

        <Card title="Your own mail and meetings" icon={Lock}>
          <p className="uf-small c-muted">Only for you. What the Lemma finds stays yours until you share it, and then only the sentence and who said it reach the team, never the thread.</p>
          <div className="uf-lrow"><span>Read my mail</span><Switch checked={mail} label="Read my mail" onChange={setMail} /></div>
          <div className="uf-lrow"><span>Read my meetings<span className="uf-small c-faint uf-block">The transcript when there is one, else your own notes (your words, marked as notes)</span></span><Switch checked={meetings} label="Read my meetings" onChange={setMeetings} /></div>
          <div className="uf-lrow uf-lrow--last"><span>Share what customers say about the product on my own</span><Switch checked={auto} label="Share on my own" onChange={setAuto} /></div>
        </Card>

        <div className="uf-row-btns uf-setup__save">
          <Button variant="primary" busy={busy === "save"} disabled={!canSave} onClick={() => void save()}>{first ? "Start" : "Save"}</Button>
          {!first ? <Button onClick={() => to.inbox()}>Back to the inbox</Button> : null}
          {!canSave ? <span className="uf-small c-faint">Add your product's name first.</span> : null}
        </div>
      </main>
    </div>
  );
}

function BrightData({ uf }: { uf: UF }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [changing, setChanging] = useState(false);
  const have = !!uf.settings?.brightdata_account_id;
  if (have && !changing) {
    return (
      <div className="uf-bd">
        <Pill tone="success">Key added</Pill>
        <span className="uf-small c-faint c-grow">Listening runs through your team's Bright Data account.</span>
        <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>Change key</Button>
      </div>
    );
  }
  const save = async () => {
    setBusy(true);
    setProblem("");
    try {
      const id = DEMO ? "demo" : await saveKey(key);
      await call("user_feedback_setup_save", { done: false, brightdata_account_id: id });
      toast("Bright Data key added. Turn on the sources to listen to.");
      setKey("");
      setChanging(false);
      await uf.reload();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const blocked = /permission|not allowed|admin|forbidden|refus/i.test(problem);
  return (
    <div className="uf-bd uf-bd--form">
      <Field label="Your Bright Data API key" hint={<>From Bright Data's account settings, under <a href={BD_KEYS_URL} target="_blank" rel="noreferrer">API keys</a>. It's kept as your organisation's Bright Data account, never in a table.</>}>
        <input className="c-input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key" />
      </Field>
      <div className="uf-row-btns">
        <Button busy={busy} disabled={key.trim().length < 10} onClick={() => void save()}>Check and save</Button>
        {changing ? <Button variant="ghost" onClick={() => setChanging(false)}>Cancel</Button> : null}
      </div>
      {problem ? (
        <div className="uf-problem">
          <span className="uf-small">{blocked ? "Adding a key for the whole organisation needs someone who may add accounts to it." : problem}</span>
          {blocked ? <AskButton label="Ask someone who can" text="Could you add our Bright Data API key in the Feedback app's Settings, so it can listen on YouTube, Reddit and the rest?" /> : null}
        </div>
      ) : null}
    </div>
  );
}

export type { Product };
