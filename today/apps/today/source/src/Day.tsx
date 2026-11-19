// The day, across everything in this Lemma. First "Next up": the three to five
// most pressing things, whatever they are (a meeting about to start, a
// decision waiting, a late to-do, a reply owed). Then the rest by what the
// person does: To decide, Meetings today, To do, To answer, Waiting on others,
// Drifting, three each. One count line on top.
//
// Every item is a needs_you row some plugin wrote (Mail, Meetings, People
// map, Tasks...) plus the platform's own questions waiting on the person.
// Today never knows which plugin: each item says where it opens
// (`client.apps.open(app, path)`), and Today's actions are the person's own
// on the item (Done, Not now). Ranking is time, lateness and weight, computed
// here with no model.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronRight, Clock, FlaskConical, Hourglass, ListChecks,
  MessageCircleQuestion, MoonStar, PenLine, RefreshCw, Reply, Scale, Sparkles, Sun, X, Zap, type LucideIcon,
} from "lucide-react";
import {
  Avatar, Brief, Button, Card, Empty, Evidence, Header, Menu, MenuItem, MenuLabel, Pill, Sheet, Spinner,
  ago, due, firstName, nameOf, openApp, plural, useData, useRows, useToast, whoAmI, type Me,
} from "@lemma-plugins/kit";
import { chatLink, checkNow, dayStart, saveMorning, setItem } from "./data";
import type { Item, PlatformAsk, Settings, Verb } from "./types";
import { MorningQuestion, zoneName } from "./Setup";

const NO_DATE_DAYS = 5;
/** Each section shows this many; the rest open behind "and N more". */
const SHOWN = 3;
const NEXT_MAX = 5;
const APP_NAMES: Record<string, string> = { inbox: "Inbox", meetings: "Meetings", people: "People", tasks: "Tasks", deals: "Deals" };

type Spec = { verb: Verb; title: string; icon: LucideIcon; done: string; dismiss: string; word: string };
const SECTIONS: Spec[] = [
  { verb: "decide", title: "To decide", icon: Scale, done: "Yes, done", dismiss: "Not yet", word: "Decide" },
  { verb: "attend", title: "Meetings today", icon: CalendarDays, done: "Done", dismiss: "Hide", word: "Meeting" },
  { verb: "do", title: "To do", icon: ListChecks, done: "Done", dismiss: "Not a task", word: "To do" },
  { verb: "answer", title: "To answer", icon: Reply, done: "Done", dismiss: "Not for me", word: "Reply" },
  { verb: "waiting", title: "Waiting on others", icon: Hourglass, done: "They did it", dismiss: "Not owed", word: "Waiting" },
  { verb: "drifting", title: "Drifting", icon: MoonStar, done: "Back in touch", dismiss: "Not now", word: "Drifting" },
];
const SPEC = Object.fromEntries(SECTIONS.map((s) => [s.verb, s])) as Record<Verb, Spec>;
const MAIN: Verb[] = ["decide", "do", "answer", "waiting"];
const SIDE: Verb[] = ["attend", "drifting"];

function greet(name: string | null | undefined): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${firstName(name)}` : part;
}

function hhmm(value: string | null | undefined): string {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
}

function time(value: string | null | undefined): number {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? Infinity : t;
}

function daysSince(value: string | null | undefined): number {
  const t = time(value);
  return t === Infinity ? 0 : Math.floor((Date.now() - t) / 86_400_000);
}

/** Late by its due day, or (a waiting item with no date) waiting longer than NO_DATE_DAYS. */
function isLate(item: Item): boolean {
  if (item.due_at) return due(item.due_at).late;
  return item.verb === "waiting" && daysSince(item.since_at || item.created_at) >= NO_DATE_DAYS;
}

function lateDays(item: Item): number {
  if (!item.due_at) return Math.max(0, daysSince(item.since_at || item.created_at) - NO_DATE_DAYS + 1);
  const start = dayStart(0).getTime();
  return Math.max(0, Math.ceil((start - time(item.due_at)) / 86_400_000));
}

/** How pressing an item is right now: time, lateness and weight, never a model.
 *  A meeting about to start leads; then a decision waiting on the person, a
 *  to-do that is late or due today, a reply owed (VIPs and priority first),
 *  something owed to them that is late and not held back, and last the rest. */
function urgency(item: Item, now: number): number {
  const startToday = dayStart(0).getTime();
  const startTomorrow = dayStart(1).getTime();
  const dueAt = time(item.due_at);
  const dueToday = dueAt >= startToday && dueAt < startTomorrow;
  switch (item.verb) {
    case "attend": {
      const minutes = (dueAt - now) / 60_000;
      if (minutes <= 120) return 1000 - Math.max(0, minutes);
      return dueAt < startTomorrow ? 420 - minutes / 60 : 60;
    }
    case "decide":
      return 700 + (isLate(item) ? Math.min(lateDays(item), 14) * 5 : 0);
    case "do":
      if (isLate(item)) return 600 + Math.min(lateDays(item), 14) * 10;
      if (dueToday) return 500;
      return dueAt === Infinity ? 120 : 200 - Math.min((dueAt - now) / 86_400_000, 14) * 5;
    case "answer":
      return 300 + (item.weight || 0) + Math.min(daysSince(item.since_at), 7) * 4;
    case "waiting":
      // Held back by its plugin ("No nudge yet: …"): nothing to do about it today.
      if (/^No nudge/.test(item.prepared || "")) return 50;
      return isLate(item) ? 350 + Math.min(lateDays(item), 14) * 5 : 100;
    case "drifting":
      return 40 + Math.min(item.weight || 0, 60);
  }
  return 0;
}

const VERB_RANK: Record<Verb, number> = { decide: 0, attend: 1, do: 2, answer: 3, waiting: 4, drifting: 5 };

/** One thing, once: when a plugin wrote two items for one source (a promise to
 *  do and "Done? …" about it), the more pressing verb stands for both. */
function dedupe(list: Item[]): Item[] {
  const best = new Map<string, Item>();
  for (const it of list) {
    const key = `${it.source_plugin}/${it.source_table}/${it.source_id}`;
    const have = best.get(key);
    if (!have || VERB_RANK[it.verb] < VERB_RANK[have.verb]) best.set(key, it);
  }
  return list.filter((it) => best.get(`${it.source_plugin}/${it.source_table}/${it.source_id}`) === it);
}

/** Within a section: time and lateness. */
function order(verb: Verb, list: Item[]): Item[] {
  return [...list].sort((a, b) => {
    if (verb === "attend") return time(a.due_at) - time(b.due_at);
    if (verb === "drifting") return (b.weight || 0) - (a.weight || 0);
    if (verb === "answer") return (b.weight || 0) - (a.weight || 0) || time(a.since_at) - time(b.since_at);
    const la = isLate(a) ? 0 : 1;
    const lb = isLate(b) ? 0 : 1;
    return la - lb || time(a.due_at) - time(b.due_at) || (b.weight || 0) - (a.weight || 0) || time(a.since_at) - time(b.since_at);
  });
}

function appName(app: string | null | undefined): string {
  if (!app) return "";
  return APP_NAMES[app] || app.charAt(0).toUpperCase() + app.slice(1);
}

function open(item: Item) {
  if (item.app) void openApp(item.app, item.path || "/");
}

/** What makes it pressing, in a word or two. */
function when(item: Item, now: number): { text: string; tone: "danger" | "warning" | "plain" | "info" } | null {
  if (item.verb === "attend") {
    const minutes = Math.round((time(item.due_at) - now) / 60_000);
    if (minutes <= 0) return { text: "Now", tone: "warning" };
    if (minutes < 60) return { text: `In ${minutes} min`, tone: "warning" };
    return { text: time(item.due_at) < dayStart(1).getTime() ? `Today ${hhmm(item.due_at)}` : `Tomorrow ${hhmm(item.due_at)}`, tone: "plain" };
  }
  if (item.verb === "drifting") return { text: `${daysSince(item.since_at)} days quiet`, tone: "warning" };
  if (item.due_at) {
    const d = due(item.due_at);
    return { text: d.late ? d.text : `due ${d.text}`, tone: d.late ? "danger" : d.text === "today" ? "warning" : "plain" };
  }
  if (isLate(item)) return { text: `no date · ${daysSince(item.since_at || item.created_at)} days`, tone: "warning" };
  if (item.since_at) return { text: ago(item.since_at), tone: "plain" };
  return null;
}

export function Day() {
  const toast = useToast();
  const { reload, errors, data } = useData();
  const settings = useRows<Settings>("settings")[0] || null;
  const items = useRows<Item>("items");
  const platform = (data.platform as PlatformAsk[] | null | undefined) ?? null;
  const [me, setMe] = useState<Me | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [asked, setAsked] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void whoAmI().then(setMe);
  }, []);

  const now = Date.now();
  const tomorrow = dayStart(1).getTime();
  const after = dayStart(2).getTime();
  const live = useMemo(() => dedupe(items.filter((it) => {
    if (it.verb !== "attend") return true;
    const ends = time(it.ends_at) !== Infinity ? time(it.ends_at) : time(it.due_at) + 3_600_000;
    return ends > now && time(it.due_at) < after;
  })), [items, now, after]);
  const asks = platform || [];

  // ---- next up: the most pressing few, mixed, at most two of one kind ---------
  const next = useMemo(() => {
    const ranked = [...live].sort((a, b) => urgency(b, now) - urgency(a, now));
    const out: Item[] = [];
    const per: Record<string, number> = {};
    for (const it of ranked) {
      if (out.length >= NEXT_MAX) break;
      if (urgency(it, now) < 150 && out.length >= 3) break;
      if ((per[it.verb] || 0) >= 2) continue;
      per[it.verb] = (per[it.verb] || 0) + 1;
      out.push(it);
    }
    return out;
  }, [live, now]);
  const inNext = new Set(next.map((i) => i.id));
  const byVerb = useMemo(() => {
    const out = Object.fromEntries(SECTIONS.map((s) => [s.verb, [] as Item[]])) as Record<Verb, Item[]>;
    for (const it of live) if (!inNext.has(it.id)) (out[it.verb] ||= []).push(it);
    for (const s of SECTIONS) out[s.verb] = order(s.verb, out[s.verb]);
    return out;
  }, [live, next]); // eslint-disable-line react-hooks/exhaustive-deps
  const asksAnswer = asks.filter((a) => a.message.question?.kind === "ASK");
  const asksDecide = asks.filter((a) => a.message.question?.kind !== "ASK");
  // The samples use only reserved .example addresses, so made-up people are known by theirs.
  const sample = items.some((i) => (i.person_handle || "").endsWith(".example"));

  // ---- the count line: every verb, in the order of the day ---------------------
  const all = (verb: Verb) => live.filter((i) => i.verb === verb);
  const meetingsToday = all("attend").filter((m) => time(m.due_at) < tomorrow);
  const line: ReactNode[] = [];
  const b = (n: number | string) => <b>{n}</b>;
  const decideN = all("decide").length + asksDecide.length;
  const answerN = all("answer").length + asksAnswer.length;
  const late = live.filter((i) => (i.verb === "do" || i.verb === "waiting") && isLate(i)).length;
  if (decideN) line.push(<>{b(decideN)} to decide</>);
  if (meetingsToday.length) line.push(<>{b(plural(meetingsToday.length, "meeting"))} today</>);
  if (all("do").length) line.push(<>{b(all("do").length)} to do</>);
  if (answerN) line.push(<>{b(answerN)} to answer</>);
  if (all("waiting").length) line.push(<>{b(all("waiting").length)} waiting on others</>);
  if (all("drifting").length) line.push(<>{b(all("drifting").length)} drifting</>);
  if (late) line.push(<>{b(late)} late</>);
  const nothing = items.length === 0 && asks.length === 0;

  // ---- actions ------------------------------------------------------------------
  const act = async (label: string, work: () => Promise<unknown>) => {
    try {
      await work();
      void reload("items");
      if (label) toast(label);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  const done = (it: Item) => act("Done", () => setItem(it.id, { state: "done", closed_by: "person" }));
  const dismiss = (it: Item) => act("Off your day until it changes", () => setItem(it.id, { state: "dismissed", closed_by: "person" }));
  const nudge = (it: Item) =>
    act(`${appName(it.app) || "It"} is drafting the nudge…`, async () => {
      const who = it.person_name || "They";
      const by = it.due_at ? ` by ${new Date(it.due_at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}` : "";
      // Through none first, so the plugin's trigger sees it become a request again.
      if (it.request === "nudge") await setItem(it.id, { request: null });
      await setItem(it.id, { request: "nudge", request_hint: `A nudge about one thing: ${who} said they would ${it.title}${by}, and nothing has come since. Ask about it briefly and kindly.` });
      setAsked((a) => ({ ...a, [it.id]: Date.now() }));
    });
  const checkAgain = async () => {
    setChecking(true);
    try {
      await checkNow(settings);
      toast("Checking your day.");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };
  const rowProps = { asked, onDone: done, onDismiss: dismiss, onNudge: nudge };

  const section = (verb: Verb) => {
    const spec = SPEC[verb];
    const list = byVerb[verb];
    const platformAsks = verb === "answer" ? asksAnswer : verb === "decide" ? asksDecide : [];
    if (!list.length && !platformAsks.length) return null;
    if (verb === "attend") return <Meetings key={verb} list={list} tomorrow={tomorrow} onDismiss={dismiss} />;
    const room = Math.max(0, SHOWN - platformAsks.length);
    const shown = expanded[verb] ? list : list.slice(0, room);
    const more = list.length - shown.length;
    return (
      <Card key={verb} id={verb} title={spec.title} icon={spec.icon} count={list.length + platformAsks.length} flush
        foot={more > 0 || expanded[verb] ? (
          <Button size="sm" variant="ghost" icon={expanded[verb] ? ChevronDown : ChevronRight} onClick={() => setExpanded((e) => ({ ...e, [verb]: !e[verb] }))}>
            {expanded[verb] ? "Fewer" : `and ${more} more`}
          </Button>
        ) : undefined}>
        <div className="c-queue">
          {platformAsks.map((a) => <Ask key={a.message.id} ask={a} />)}
          {shown.map((it) => <Row key={it.id} it={it} spec={spec} {...rowProps} />)}
        </div>
      </Card>
    );
  };

  return (
    <div className="c-app">
      <Header icon={Sun} title="Today" count={<>
        <span className="t-hide-sm">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</span>
        <span className="t-show-sm">{new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
      </>}>
        {settings?.schedule_id ? (
          <>
            <Button variant="ghost" icon={RefreshCw} onClick={() => void checkAgain()} busy={checking} className="t-hide-sm">Check again</Button>
            <Button variant="ghost" icon={RefreshCw} label="Check again" onClick={() => void checkAgain()} busy={checking} className="t-show-sm" />
            <Menu label={settings.morning_at || "08:00"} title="Your morning" icon={Clock} align="right" variant="ghost">
              {(close) => (
                <>
                  <MenuLabel>Your day is checked at {settings.morning_at || "08:00"}, {settings.timezone || "UTC"}</MenuLabel>
                  <MenuItem icon={Clock} onSelect={() => { close(); setTimeOpen(true); }}>Change the time</MenuItem>
                </>
              )}
            </Menu>
          </>
        ) : null}
      </Header>

      <main className="c-body t-body">
        {!settings?.schedule_id ? <div className="t-question"><MorningQuestion settings={settings} /></div> : null}
        {errors.items ? <p className="t-note t-note--danger">Couldn't read your list: {errors.items}</p> : null}

        <Brief>
          {greet(settings?.display_name || me?.name)}.{" "}
          {line.length ? line.map((part, i) => <span key={i}>{part}{i < line.length - 1 ? " · " : "."}</span>) : nothing ? null : "Nothing needs you right now."}
        </Brief>
        {sample ? (
          <p className="t-note"><FlaskConical size={13} aria-hidden="true" /> Some of this is sample data, made up so you can see how the day works. Nothing can be sent from it.</p>
        ) : null}

        {nothing ? (
          <Card>
            <Empty icon={Sun} title="Nothing needs you right now.">
              Today gathers what needs you from everything in this Lemma, by what you do: decisions, meetings, what you said
              you'd do, replies people are waiting on, what you're owed, and people going quiet. Add Mail, Meetings, People map or
              Tasks to this Lemma and their part of your day shows here.{platform === null ? "" : " Questions and approvals waiting on you in Lemma show here too."}
            </Empty>
          </Card>
        ) : (
          <>
            {next.length ? (
              <Card id="next" title="Next up" icon={Zap} flush>
                <ol className="t-next">
                  {next.map((it) => <NextRow key={it.id} it={it} now={now} onDone={done} />)}
                </ol>
              </Card>
            ) : null}
            <div className="t-grid">
              <div className="c-stack t-main">{MAIN.map(section)}</div>
              <div className="c-stack t-side">{SIDE.map(section)}</div>
            </div>
          </>
        )}
      </main>
      {settings ? <TimeSheet open={timeOpen} settings={settings} me={me} onClose={() => setTimeOpen(false)} /> : null}
    </div>
  );
}

/** One line in Next up: what kind, when, what, who, and the one press that moves it. */
function NextRow({ it, now, onDone }: { it: Item; now: number; onDone: (it: Item) => void }) {
  const spec = SPEC[it.verb];
  const w = when(it, now);
  const label = it.verb === "attend" ? (it.prepared ? "Read the brief" : `Open in ${appName(it.app)}`)
    : it.prepared && /draft/i.test(it.prepared) ? "Review" : `Open in ${appName(it.app)}`;
  return (
    <li className="t-next__row">
      <span className="t-next__kind"><spec.icon size={13} aria-hidden="true" />{spec.word}</span>
      <div className="t-next__main">
        <button type="button" className="t-next__title" onClick={() => open(it)}>{it.verb === "drifting" ? `${nameOf(it.title)} has gone quiet` : it.title}</button>
        <div className="c-faint t-small c-ellipsis">
          {[it.person_name && it.verb !== "drifting" ? nameOf(it.person_name, it.person_handle) : null, appName(it.app), it.prepared].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="t-next__acts">
        {w ? <Pill tone={w.tone}>{w.text}</Pill> : null}
        {it.app ? <Button size="sm" icon={ArrowUpRight} onClick={() => open(it)}>{label}</Button> : null}
        {it.verb !== "attend" ? <Button size="sm" variant="ghost" icon={Check} label={spec.done} onClick={() => onDone(it)} /> : null}
      </div>
    </li>
  );
}

function Prepared({ it }: { it: Item }) {
  const [openText, setOpenText] = useState(false);
  if (!it.prepared) return null;
  const drafted = !!it.prepared_text;
  return (
    <div className="t-prepared">
      <button type="button" className="t-prepared__line" aria-expanded={drafted ? openText : undefined} onClick={() => (drafted ? setOpenText((v) => !v) : open(it))}>
        {drafted ? (openText ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />) : <Sparkles size={13} aria-hidden="true" />}
        <span>{it.prepared}</span>
        <Pill tone="ai" icon={Sparkles}>ai</Pill>
      </button>
      {drafted && openText ? (
        <button type="button" className="c-draft t-gap" onClick={() => open(it)}>
          <div className="c-draft__text t-draft-full">{(it.prepared_text || "").trim().replace(/\n{2,}/g, "\n")}</div>
        </button>
      ) : null}
    </div>
  );
}

function Row({ it, spec, asked, onDone, onDismiss, onNudge }: {
  it: Item; spec: Spec; asked: Record<string, number>;
  onDone: (it: Item) => void; onDismiss: (it: Item) => void; onNudge: (it: Item) => void;
}) {
  const late = isLate(it);
  const mine = asked[it.id];
  const pending = !it.prepared && (it.request === "nudge" || (mine && Date.now() - mine < 10 * 60_000));
  const canNudge = it.verb === "waiting" && !!it.conversation_id && late && !pending && !(it.prepared && !/^No nudge/.test(it.prepared));
  const w = when(it, Date.now());
  return (
    <article className="c-item">
      {it.person_name || it.person_handle ? <Avatar name={it.person_name} email={it.person_handle} size={32} /> : <span className="t-icon" aria-hidden="true"><spec.icon size={15} /></span>}
      <div style={{ minWidth: 0 }}>
        <div className="c-item__who">
          {it.person_name || it.person_handle ? <span className="t-name">{nameOf(it.person_name, it.person_handle)}</span> : null}
          {it.app ? <span className="c-faint c-ellipsis">{appName(it.app)}</span> : null}
          <span className="c-item__meta">{w ? (w.tone === "plain" && it.since_at && !it.due_at && it.verb !== "drifting" ? <span className="c-faint t-ago">{w.text}</span> : <Pill tone={w.tone}>{w.text}</Pill>) : null}</span>
        </div>
        <div className="c-item__what">{it.verb === "drifting" ? "Gone quiet" : it.title}</div>
        {it.why ? <div className="c-faint t-small t-why">{it.why}</div> : null}
        {it.quote && !it.prepared_text ? <Evidence quote={it.quote} by={it.person_name && it.verb !== "do" ? firstName(it.person_name) : it.verb === "do" ? "You" : null} /> : null}
        {pending ? <p className="c-writing t-gap"><Spinner /> {appName(it.app) || "It"} is drafting the nudge…</p> : <Prepared it={it} />}
        <div className="c-item__acts">
          {it.app ? <Button size="sm" icon={ArrowUpRight} onClick={() => open(it)}>{`Open in ${appName(it.app)}`}</Button> : null}
          {canNudge ? <Button size="sm" icon={PenLine} onClick={() => onNudge(it)}>Draft a nudge</Button> : null}
          <Button size="sm" variant="ghost" icon={Check} onClick={() => onDone(it)}>{spec.done}</Button>
          <Button size="sm" variant="ghost" icon={X} onClick={() => onDismiss(it)}>{spec.dismiss}</Button>
        </div>
      </div>
    </article>
  );
}

const ASK_KIND: Record<string, string> = { ASK: "Question", APPROVAL: "Approval", FORM: "Form" };

/** A question waiting on the person in Lemma itself: it is answered there. */
function Ask({ ask }: { ask: PlatformAsk }) {
  const link = chatLink(ask);
  const kind = ask.message.question?.kind || "ASK";
  const where = ask.channel.title || ask.channel.person?.name || "your chat";
  return (
    <article className="c-item">
      <span className="t-icon" aria-hidden="true"><MessageCircleQuestion size={15} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="c-item__who">
          <span className="t-name">{ask.message.sender?.display_name || ask.message.sender?.name || "Lemma"}</span>
          <span className="c-faint c-ellipsis">{where}</span>
          <span className="c-item__meta"><Pill tone="info">{ASK_KIND[kind] || "Question"}</Pill></span>
        </div>
        <div className="c-item__what t-clamp">{ask.message.text || "Waiting on your answer"}</div>
        {ask.message.created_at ? <div className="c-faint t-small">{`Asked ${ago(ask.message.created_at)} ago`}</div> : null}
        {link ? (
          <div className="c-item__acts">
            <Button size="sm" icon={ArrowUpRight} onClick={() => window.open(link, "_top")}>Answer in Lemma</Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Meetings({ list, tomorrow, onDismiss }: { list: Item[]; tomorrow: number; onDismiss: (it: Item) => void }) {
  const today = list.filter((m) => time(m.due_at) < tomorrow);
  const next = list.filter((m) => time(m.due_at) >= tomorrow);
  const group = (label: string, rows: Item[]) => (
    <div className="t-meetings">
      <div className="t-meetings__label">{label}</div>
      {rows.length === 0 ? <p className="c-muted t-small t-meetings__empty">No more meetings today.</p> : (
        <ul>
          {rows.map((m) => (
            <li key={m.id}>
              <span className="t-meetings__time">{hhmm(m.due_at)}</span>
              <div className="t-meetings__main">
                <button type="button" className="t-meetings__title" onClick={() => open(m)}>{m.title}</button>
                {m.why ? <div className="c-faint t-small c-ellipsis">{m.why}</div> : null}
                <div className="t-meetings__acts">
                  {m.app ? (
                    <Button size="sm" icon={m.prepared ? FlaskConical : ArrowUpRight} onClick={() => open(m)}>
                      {m.prepared ? "Read the brief" : `Open in ${appName(m.app)}`}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" icon={X} label="Hide from today" onClick={() => onDismiss(m)} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Card id="attend" title="Meetings today" icon={CalendarDays} count={today.length || undefined} flush>
      {group("Today", today)}
      {next.length ? group("Tomorrow", next) : null}
    </Card>
  );
}

function TimeSheet({ open: isOpen, settings, me, onClose }: { open: boolean; settings: Settings; me: Me | null; onClose: () => void }) {
  const toast = useToast();
  const { reload } = useData();
  const [at, setAt] = useState(settings.morning_at || "08:00");
  const [busy, setBusy] = useState(false);
  useEffect(() => setAt(settings.morning_at || "08:00"), [settings.morning_at, isOpen]);
  const zone = zoneName(settings.timezone && settings.timezone !== "UTC" ? settings.timezone : null);
  const save = async () => {
    setBusy(true);
    try {
      await saveMorning(settings, me, at, zone);
      await reload("settings");
      toast(`Your day is checked every morning at ${at}.`);
      onClose();
    } catch (e) {
      toast(`Couldn't change the time: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={isOpen} title="When do you want your day?" onClose={onClose}
      footer={<><span className="c-grow" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} busy={busy}>Save</Button></>}>
      <p className="c-muted">Each morning at this time Today lays out the day, with what each plugin has prepared.</p>
      <div className="t-time">
        <input className="c-input" type="time" value={at} onChange={(e) => setAt(e.target.value || "08:00")} step={900} aria-label="Morning time" />
        <span className="c-faint">{zone}</span>
      </div>
    </Sheet>
  );
}
