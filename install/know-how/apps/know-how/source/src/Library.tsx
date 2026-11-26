// B · Library, the second tab: every page with its owner, who sees it, when
// it was checked and its next check, uses and misses, and its state. Topics
// and where answers come from down the side; "Asked most" and "Going stale"
// on top. A page opens as itself, a procedure as its Playbook.

import { useMemo, useState } from "react";
import { AlertTriangle, BookOpen, CloudDownload, FileWarning, FolderOpen, Globe, Lock, RefreshCw, Upload, Users } from "lucide-react";
import { Button, Card, DEMO, Empty, Pill, Segmented, ago, plural, startWorkflow, useToast } from "@lemma-plugins/kit";
import { AUDIENCE, KIND, firstOf, fmtDay, isLate, nowMs, todayIso, useKnowhow, useWho, type Article } from "./data";
import { AudienceMark, Gap, StatePill } from "./marks";
import { to } from "./route";
import { notify, uploadToInbox } from "./wire";

type Seg = "all" | "due" | "drafts" | "procedures" | "customers";

export function Library({ topic, mine, query }: { topic: string | null; mine: boolean; query: string }) {
  const d = useKnowhow();
  const { me } = useWho();
  const toast = useToast();
  const now = nowMs(d.questions);
  const today = todayIso(now);
  const [seg, setSeg] = useState<Seg>(mine ? "due" : "all");
  const [busy, setBusy] = useState("");
  const onlyMine = mine;
  const t = topic ? d.topics.find((x) => x.slug === topic) || null : null;
  const pages = d.articles.filter((a) => a.state !== "retired" && a.kind !== "sheet");
  const lead = d.settings?.customer_lead_days || 14;
  const stale = useMemo(() => {
    const out: { a: Article; reason: string; tone: "warning" | "info"; pill: string }[] = [];
    for (const a of pages) {
      if (a.state === "may_disagree") {
        const ch = d.changes.find((c) => c.article_id === a.id && c.kind === "may_disagree" && c.state === "proposed");
        out.push({ a, reason: ch?.evidence.why || "Its file changed since it was checked.", tone: "warning", pill: "May disagree" });
      } else if (a.state !== "draft" && isLate(a, now)) {
        out.push({ a, reason: `due ${fmtDay(a.due_on)} · used ${plural(a.uses_30d, "time")} this month · the team sees a warning`, tone: "warning", pill: "Past check date" });
      } else if ((a.audience === "customers" || a.audience === "public") && a.state === "live" && a.due_on && a.due_on > today
        && Date.parse(a.due_on) - now <= lead * 86_400_000) {
        out.push({ a, reason: `leaves the customer answers on ${fmtDay(a.due_on)} unless checked`, tone: "info", pill: "Customers" });
      }
    }
    return out;
  }, [pages, d.changes, now, today, lead]);
  const most = [...pages].filter((a) => a.uses_30d > 0).sort((x, y) => y.uses_30d - x.uses_30d).slice(0, 5);
  const needle = query.trim().toLowerCase();
  const base = pages.filter((a) => (!t || a.topic_id === t.id) && (!onlyMine || (me && a.owner_member_id === me.id))
    && (!needle || a.title.toLowerCase().includes(needle) || a.asks.some((x) => x.toLowerCase().includes(needle))));
  const segs: Record<Seg, (a: Article) => boolean> = {
    all: () => true, due: (a) => a.state !== "draft" && (isLate(a, now) || a.state === "may_disagree"), drafts: (a) => a.state === "draft",
    procedures: (a) => a.kind === "procedure", customers: (a) => a.audience === "customers" || a.audience === "public",
  };
  const rows = base.filter(segs[seg]).sort((x, y) => (x.state === "draft" ? 1 : 0) - (y.state === "draft" ? 1 : 0) || y.uses_30d - x.uses_30d || x.title.localeCompare(y.title));
  const askOwners = async () => {
    setBusy("ask");
    let told = 0;
    const owners = new Map<string, Article[]>();
    for (const s of stale) if (s.a.owner_member_id) owners.set(s.a.owner_member_id, [...(owners.get(s.a.owner_member_id) || []), s.a]);
    for (const [id, list] of owners) {
      if (await notify(id, `${plural(list.length, "page")} of yours ${list.length === 1 ? "needs" : "need"} a check in Know-how: ${list.map((a) => a.title).join(", ")}. Open each and press Keep if it's still right.`)) told += 1;
    }
    toast(owners.size ? `Asked ${plural(told, "owner")}. Each also sees it in Today.` : "None of these pages has an owner who's a member yet.");
    setBusy("");
  };
  const readAgain = async () => {
    setBusy("read");
    try {
      if (!DEMO) await startWorkflow("knowhow-read-sources");
      toast(DEMO ? "In the demo nothing is read." : "Reading the sources again. New drafts show up under Drafts.");
    } catch {
      toast("Couldn't start reading. Try again in a minute.");
    } finally {
      setBusy("");
    }
  };
  const unreadable = d.sources.flatMap((s) => s.unreadable.map((u) => ({ ...u, source: s.name })));

  return (
    <main className="kh-library">
      <aside className="kh-side" aria-label="Topics and sources">
        <h3 className="kh-side__h">Topics</h3>
        <ul className="kh-topics">
          <li><button type="button" aria-current={!t ? "page" : undefined} onClick={() => to.library()}><BookOpen aria-hidden="true" /><span className="c-grow">All pages</span><span className="c-faint num">{pages.length}</span></button></li>
          {d.topics.map((x) => (
            <li key={x.id}>
              <button type="button" aria-current={t?.id === x.id ? "page" : undefined} onClick={() => to.library(x.slug)}>
                {x.audience_default === "restricted" ? <Lock aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}
                <span className="c-grow"><span className="kh-topics__name">{x.name}{x.sensitive ? <Pill>Sensitive</Pill> : null}</span><span className="kh-topics__owner">{x.owner_name || "No owner yet"}</span></span>
                <span className="c-faint num">{pages.filter((a) => a.topic_id === x.id).length}</span>
              </button>
            </li>
          ))}
        </ul>
        <h3 className="kh-side__h">Where answers come from</h3>
        <ul className="kh-sources">
          {d.sources.map((s) => (
            <li key={s.id}>
              {s.kind === "website" ? <Globe aria-hidden="true" /> : s.kind === "drive_folder" ? <CloudDownload aria-hidden="true" /> : s.kind === "teams_file" ? <Users aria-hidden="true" /> : <Upload aria-hidden="true" />}
              <span className="c-grow"><span className="c-ellipsis">{s.name}</span><span className="c-faint kh-sources__sub">{plural(s.files_seen, "file")} · {plural(s.drafted, "draft")}{s.last_read_at ? ` · read ${ago(s.last_read_at, now)} ago` : ""}</span></span>
            </li>
          ))}
          {unreadable.length ? (
            <li className="kh-sources__bad">
              <FileWarning aria-hidden="true" />
              <span className="c-grow"><span>Can't be searched ({unreadable.length})</span>
                {unreadable.map((u) => <span key={u.name} className="c-faint kh-sources__sub">{u.name}: {u.sheet_page ? "made a table page" : u.why.split(":")[0]}</span>)}
              </span>
            </li>
          ) : null}
        </ul>
        <div className="kh-side__acts">
          <label className="c-btn c-btn--sm kh-upload">
            <Upload aria-hidden="true" />Add files
            <input type="file" multiple onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              if (files.length) void uploadToInbox(files, () => undefined).then((n) => toast(`${plural(n, "file")} added. Press Read again to draft pages from them.`));
            }} />
          </label>
          <Button size="sm" icon={RefreshCw} busy={busy === "read"} onClick={() => void readAgain()}>Read again</Button>
        </div>
        <Gap>No SharePoint or OneDrive folder source yet: share a file with the Lemma in Teams, one at a time.</Gap>
      </aside>
      <div className="kh-lib-main">
        <div className="kh-lib-cards">
          <Card title="Asked most" count={most.length}>
            {most.length ? (
              <ul className="kh-mini">
                {most.map((a) => <li key={a.id}><button type="button" onClick={() => to.page(a.id)}><span className="c-grow c-ellipsis">{a.title}</span><span className="c-muted num">{plural(a.uses_30d, "use")}</span></button></li>)}
              </ul>
            ) : <p className="c-faint">No page has been used yet.</p>}
          </Card>
          <Card title="Going stale" count={stale.length} action={stale.length ? <Button size="sm" busy={busy === "ask"} onClick={() => void askOwners()}>Ask owners to check</Button> : null}>
            {stale.length ? (
              <ul className="kh-mini">
                {stale.map((s) => (
                  <li key={s.a.id}><button type="button" onClick={() => to.page(s.a.id)}>
                    <AlertTriangle aria-hidden="true" className="kh-mini__icon" />
                    <span className="c-grow"><span className="c-ellipsis kh-mini__title">{s.a.title}</span><span className="c-muted kh-mini__why">{s.reason}</span></span>
                    <Pill tone={s.tone}>{s.pill}</Pill>
                  </button></li>
                ))}
              </ul>
            ) : <p className="c-faint">Everything is in date.</p>}
          </Card>
        </div>
        <div className="kh-toolbar">
          <Segmented<Seg> label="Pages" value={seg} onChange={setSeg} items={[
            { id: "all", label: "All", count: base.length }, { id: "due", label: "Past check date", count: base.filter(segs.due).length },
            { id: "drafts", label: "Drafts", count: base.filter(segs.drafts).length }, { id: "procedures", label: "Procedures", count: base.filter(segs.procedures).length },
            { id: "customers", label: "For customers", count: base.filter(segs.customers).length }]} />
          {onlyMine ? <Button size="sm" variant="ghost" onClick={() => to.library(topic)}>Everyone's pages</Button> : null}
        </div>
        {rows.length ? (
          <div className="c-table-wrap">
            <table className="c-table kh-table">
              <thead><tr><th>Page</th><th>Owner</th><th>Seen by</th><th>Checked</th><th>Next check</th><th className="right">Uses</th><th className="right">Missed</th><th>State</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} onClick={() => to.page(a.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") to.page(a.id); }}>
                    <td className="kh-table__page">
                      <span className="kh-table__title">{a.title}</span>
                      <span className="kh-table__sub">{a.state === "draft" && a.quote_who ? `Draft from ${firstOf(a.quote_who)}'s ${a.source === "reply" ? "reply" : "notes"}${a.quote_where ? ` in ${a.quote_where}` : ""}` : `${KIND[a.kind]} · ${d.topicBy.get(a.topic_id || "")?.name || "No topic"}`}</span>
                    </td>
                    <td>{a.owner_name || <span className="c-faint">Nobody</span>}</td>
                    <td><AudienceMark audience={a.audience} /></td>
                    <td>{a.checked_at && a.state !== "draft" ? <span>{fmtDay(a.checked_at)}<span className="c-faint"> · {firstOf(a.checked_by_name || a.owner_name)}</span></span> : <span className="c-faint">Not yet</span>}</td>
                    <td className={isLate(a, now) && a.state !== "draft" ? "kh-late" : ""}>{a.due_on && a.state !== "draft" ? fmtDay(a.due_on) : <span className="c-faint">·</span>}</td>
                    <td className="right num">{a.uses_30d || <span className="c-faint">0</span>}</td>
                    <td className="right num">{a.misses_30d || <span className="c-faint">0</span>}</td>
                    <td><StatePill a={a} now={now} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={BookOpen} title={needle ? "No page matches" : seg === "drafts" ? "No drafts waiting" : "No pages here yet"}
            action={<Button icon={Upload} onClick={() => to.setup()}>Add sources</Button>}>
            Pages come from your documents, your website, and owners' replies to questions nobody could answer.
          </Empty>
        )}
        <div className="kh-gaps">
          <Gap>The Docs page can't show “checked by” on the page itself: it's kept here.</Gap>
          <Gap>“Customers” is a second copy, served by a function: audience is set per table, not per page.</Gap>
          <Gap>Changes are checked once a day, with no history of a file.</Gap>
          <span className="c-faint kh-lib-legend">Seen by: <Users aria-hidden="true" />{AUDIENCE.team} · <Lock aria-hidden="true" />{AUDIENCE.restricted} · <Globe aria-hidden="true" />{AUDIENCE.public}</span>
        </div>
      </div>
    </main>
  );
}
