// The list. The left side picked what you need to do; the tabs pick one of
// your categories. One dense line per conversation, two on a phone. A
// conversation opens beside the list (in its place on a phone). j and k walk
// it, Enter opens, e marks done, x selects.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, Archive, CheckCheck, CircleHelp, FolderInput, Inbox as InboxIcon, Loader2, Paperclip, PenLine, X } from "lucide-react";
import { Avatar, Button, Empty, Menu, MenuItem, MenuLabel, SearchField, Segmented, Skeleton, cx, nameOf, useToast } from "@lemma-plugins/kit";
import { ACTIVE, useAct, useMail } from "./data";
import { Reader } from "./Reader";
import { to, type View } from "./route";
import { localAt, short, until } from "./time";
import type { Conv } from "./types";

export const TITLES: Record<View, string> = {
  needs: "Needs reply", inbox: "Inbox", waiting: "Waiting on others", unsure: "Not sure", snoozed: "Snoozed",
  aside: "Set aside", done: "Done", sorting: "Being sorted",
};

const stamp = (c: Conv) => (c.last_message_at ? Date.parse(c.last_message_at) : 0);
const byTime = (a: Conv, b: Conv) => stamp(b) - stamp(a);
const snoozed = (c: Conv) => !!c.snoozed_until && Date.parse(c.snoozed_until) > Date.now();

export function snoozeOptions(): [string, string, string][] {
  const day = new Date().getDay();
  return [
    ["Later today", "18:00", localAt(0, 18)],
    ["Tomorrow", "09:00", localAt(1, 9)],
    ["This weekend", "Sat 10:00", localAt((6 - day + 7) % 7 || 7, 10)],
    ["Next week", "Mon 09:00", localAt(((1 - day + 7) % 7) || 7, 9)],
  ];
}

function useView(view: View): Conv[] {
  const { conversations, categories } = useMail();
  return useMemo(() => {
    const hidden = new Set(categories.filter((c) => c.hidden && c.state === "active").map((c) => c.key));
    const live = conversations.filter((c) => !c.muted && !snoozed(c));
    switch (view) {
      case "needs":
        return live.filter((c) => c.state === "needs_reply").sort((a, b) => (b.priority || 0) - (a.priority || 0) || byTime(a, b));
      case "inbox":
        return live.filter((c) => ACTIVE.has(c.state) && !(c.category && hidden.has(c.category))).sort(byTime);
      case "waiting":
        return live.filter((c) => c.state === "waiting").sort((a, b) => Date.parse(a.follow_up_at || "9999") - Date.parse(b.follow_up_at || "9999"));
      case "unsure":
        return live.filter((c) => c.unsure && ACTIVE.has(c.state)).sort(byTime);
      case "aside":
        return live.filter((c) => c.category && hidden.has(c.category) && ACTIVE.has(c.state)).sort(byTime);
      case "snoozed":
        return conversations.filter(snoozed).sort((a, b) => Date.parse(a.snoozed_until || "") - Date.parse(b.snoozed_until || ""));
      case "done":
        return conversations.filter((c) => c.state === "done" && c.kind === "people" && !c.muted).sort(byTime);
      case "sorting":
        return live.filter((c) => c.state === "new").sort(byTime);
    }
  }, [conversations, categories, view]);
}

const EMPTY: Record<View, [string, string]> = {
  needs: ["Nothing needs a reply", "When someone is waiting on you it lands here, sorted, with the reply drafted in your voice."],
  inbox: ["Inbox zero", "Everything open is handled. New mail lands here already sorted."],
  waiting: ["Nobody owes you a reply", "When you write and expect an answer, it waits here with the day a nudge comes back."],
  unsure: ["Nothing it’s unsure about", "When the sort can’t tell where something goes, it waits here. Putting it somewhere teaches the next read."],
  snoozed: ["Nothing snoozed", "Snooze a conversation and it comes back at the time you pick, or sooner if they write."],
  aside: ["Nothing set aside", "Newsletters and cold pitches collect here, out of your way."],
  done: ["Nothing done yet", "Conversations you mark done leave your inbox here and in Gmail or Outlook."],
  sorting: ["All sorted", "Everything has a place."],
};

export function List({ view, id }: { view: View; id?: string }) {
  const { conversations, categories, drafts, loaded, counts, settings } = useMail();
  const act = useAct();
  const toast = useToast();
  const base = useView(view);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | undefined>(id);
  const [summary, setSummary] = useState(() => {
    try {
      return localStorage.getItem("mail-summary-seen") !== String(settings?.setup_summary?.finished_at || "");
    } catch {
      return true;
    }
  });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab("all");
    setSelected(new Set());
  }, [view]);

  const draftFor = useMemo(() => {
    const map: Record<string, (typeof drafts)[number]> = {};
    for (const d of drafts) if (d.conversation_id && (d.state === "proposed" || d.state === "failed")) map[d.conversation_id] = d;
    return map;
  }, [drafts]);
  const names = useMemo(() => Object.fromEntries(categories.map((c) => [c.key, c.name])), [categories]);

  const tabs = useMemo(() => {
    const n: Record<string, number> = {};
    for (const c of base) if (c.category) n[c.category] = (n[c.category] || 0) + 1;
    return categories.filter((c) => c.state === "active" && n[c.key]).map((c) => ({ id: c.key, label: c.name, count: n[c.key] }));
  }, [base, categories]);

  const list = useMemo(() => {
    let out = tab === "all" || !tabs.some((t) => t.id === tab) ? base : base.filter((c) => c.category === tab);
    const needle = search.trim().toLowerCase();
    if (needle) {
      out = out.filter((c) => [c.subject, c.counterpart_name, c.counterpart_handle, c.snippet, c.ask].some((v) => (v || "").toLowerCase().includes(needle)));
    }
    return out;
  }, [base, tab, tabs, search]);

  const open = id ? conversations.find((c) => c.id === id) : undefined;
  const index = list.findIndex((c) => c.id === (id || cursor));
  const openOne = useCallback((c?: Conv) => c && to.list(view, c.id), [view]);
  const nextAfter = useCallback((ids: string[]) => {
    const rest = list.filter((c) => !ids.includes(c.id));
    return rest[Math.min(Math.max(index, 0), rest.length - 1)];
  }, [list, index]);

  const leave = useCallback((ids: string[]) => {
    setSelected(new Set());
    if (id && ids.includes(id)) {
      const next = nextAfter(ids);
      if (next) openOne(next);
      else to.list(view);
    }
  }, [id, nextAfter, openOne, view]);

  const done = useCallback((ids: string[]) => {
    if (!ids.length) return;
    void act(ids, "done").catch((e: unknown) => toast(`Couldn’t mark done: ${e instanceof Error ? e.message : e}`));
    toast(ids.length === 1 ? "Marked done" : `${ids.length} marked done`, { action: { label: "Undo", run: () => void act(ids, "restore") } });
    leave(ids);
  }, [act, toast, leave]);
  const snooze = useCallback((ids: string[], label: string, iso: string) => {
    void act(ids, "snooze", { until: iso });
    toast(`Snoozed until ${label.toLowerCase()}`, { action: { label: "Undo", run: () => void act(ids, "unsnooze") } });
    leave(ids);
  }, [act, toast, leave]);
  const move = useCallback((ids: string[], key: string) => {
    void act(ids, "move", { category: key }).then((r) => toast(`Moved to ${names[key] || key}${r?.corrections ? ": the sort will learn from it" : ""}`));
    setSelected(new Set());
  }, [act, toast, names]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']") || e.metaKey || e.ctrlKey || e.altKey) return;
      const at = Math.max(0, index);
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const c = list[Math.min(list.length - 1, index + 1)];
        if (id) openOne(c);
        else setCursor(c?.id);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const c = list[Math.max(0, index - 1)];
        if (id) openOne(c);
        else setCursor(c?.id);
      } else if ((e.key === "Enter" || e.key === "o") && !id && list[at]) {
        e.preventDefault();
        openOne(list[at]);
      } else if (e.key === "x" && list[at]) {
        e.preventDefault();
        setSelected((s) => toggle(s, list[at].id));
      } else if (e.key === "e") {
        const ids = selected.size ? [...selected] : id ? [id] : cursor ? [cursor] : [];
        if (ids.length) {
          e.preventDefault();
          done(ids);
        }
      } else if (e.key === "Escape") {
        if (selected.size) setSelected(new Set());
        else if (id) to.list(view);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [list, index, id, cursor, selected, openOne, done, view]);

  useEffect(() => {
    listRef.current?.querySelector(".m-row.is-cursor")?.scrollIntoView({ block: "nearest" });
  }, [id, cursor]);

  const sel = [...selected];
  const found = settings?.setup_summary;
  const dismiss = () => {
    setSummary(false);
    try {
      localStorage.setItem("mail-summary-seen", String(found?.finished_at || ""));
    } catch {
      /* private mode */
    }
  };
  return (
    <div className={cx("m-split", open && "is-open")}>
      <section className="m-listpane" aria-label={TITLES[view]}>
        <header className="m-listhead">
          <h1>{TITLES[view]}</h1>
          <span className="c-header__count">{list.length}</span>
          {counts.view.sorting && view !== "sorting" ? (
            <button type="button" className="m-sorting" onClick={() => to.list("sorting")}>
              <Loader2 size={12} className="m-spin" aria-hidden="true" /> Sorting {counts.view.sorting}
            </button>
          ) : null}
          <span className="c-grow" />
          <SearchField value={search} onChange={setSearch} placeholder="Search these" />
        </header>
        {view === "needs" && summary && found ? (
          <div className="m-found">
            <p>
              <b>Read your last month.</b> {found.needs_reply} need a reply ({found.drafts} drafted in your voice), {found.waiting} waiting on others,
              {" "}{found.promise_conversations} with a promise either way{Number(found.not_sure) ? `, ${found.not_sure} it wasn’t sure about` : ""}.
            </p>
            <div className="c-row">
              {Number(found.not_sure) ? <Button size="sm" icon={CircleHelp} onClick={() => to.list("unsure")}>See what it wasn’t sure about</Button> : null}
              <Button size="sm" onClick={() => to.promises()}>Promises</Button>
              <Button size="sm" variant="ghost" icon={X} label="Dismiss" onClick={dismiss} />
            </div>
          </div>
        ) : null}
        {sel.length ? (
          <div className="m-bulk" role="toolbar" aria-label="Selected conversations">
            <span><b className="num">{sel.length}</b> selected</span>
            <span className="c-grow" />
            <Button size="sm" icon={Archive} onClick={() => done(sel)}>Done</Button>
            <Menu label="Snooze" icon={AlarmClock} align="right">
              {(close) => (
                <>
                  <MenuLabel>Snooze until</MenuLabel>
                  {snoozeOptions().map(([label, when, iso]) => (
                    <MenuItem key={label} hint={when} onSelect={() => { close(); snooze(sel, label, iso); }}>{label}</MenuItem>
                  ))}
                </>
              )}
            </Menu>
            <Menu label="Move" icon={FolderInput} align="right">
              {(close) => (
                <>
                  <MenuLabel>Move to</MenuLabel>
                  {categories.filter((c) => c.state === "active").map((c) => (
                    <MenuItem key={c.key} onSelect={() => { close(); move(sel, c.key); }}>{c.name}</MenuItem>
                  ))}
                </>
              )}
            </Menu>
            <Button size="sm" variant="ghost" icon={X} label="Clear selection" onClick={() => setSelected(new Set())} />
          </div>
        ) : tabs.length > 1 ? (
          <div className="m-tabs">
            <Segmented label="Categories" value={tabs.some((t) => t.id === tab) ? tab : "all"} onChange={setTab}
              items={[{ id: "all", label: "All", count: base.length }, ...tabs]} />
          </div>
        ) : null}
        <div className="m-rows" ref={listRef} role="list">
          {!loaded ? (
            <Skeleton rows={12} kind="list" />
          ) : list.length ? (
            list.map((c) => (
              <Row key={c.id} c={c} view={view} current={c.id === id} cursor={c.id === (id || cursor)} selected={selected.has(c.id)}
                draft={draftFor[c.id]} category={c.category ? names[c.category] : undefined}
                onSelect={() => setSelected((s) => toggle(s, c.id))} onDone={() => done([c.id])}
                onSnooze={() => snooze([c.id], "Tomorrow", localAt(1, 9))} />
            ))
          ) : search ? (
            <Empty icon={InboxIcon} title="Nothing matches" action={<Button size="sm" onClick={() => setSearch("")}>Clear the search</Button>}>
              Search looks at who, the subject and the preview of what is loaded here.
            </Empty>
          ) : (
            <Empty icon={view === "unsure" ? CircleHelp : InboxIcon} title={EMPTY[view][0]}>{EMPTY[view][1]}</Empty>
          )}
        </div>
      </section>
      {open ? (
        <section className="m-readerpane" aria-label="Conversation">
          <Reader key={open.id} c={open} view={view} onDone={() => done([open.id])} onSnooze={(label, iso) => snooze([open.id], label, iso)}
            onPrev={index > 0 ? () => openOne(list[index - 1]) : undefined}
            onNext={index >= 0 && index < list.length - 1 ? () => openOne(list[index + 1]) : undefined} />
        </section>
      ) : null}
    </div>
  );
}

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function Row(props: {
  c: Conv; view: View; current: boolean; cursor: boolean; selected: boolean; draft?: { state: string; kind: string }; category?: string;
  onSelect: () => void; onDone: () => void; onSnooze: () => void;
}) {
  const { c, view, current, cursor, selected, draft, category } = props;
  const who = nameOf(c.counterpart_name, c.counterpart_handle);
  const writing = c.draft_state === "wanted" || c.draft_state === "writing";
  const line = c.state === "needs_reply" && c.ask ? c.ask : c.snippet;
  return (
    <div role="listitem" className={cx("m-row", c.unread && "is-unread", cursor && "is-cursor", selected && "is-selected", current && "is-current")}>
      <input type="checkbox" className="c-check m-row__check" checked={selected} onChange={props.onSelect} aria-label={`Select ${who}`} />
      <button type="button" className="m-row__open" onClick={() => to.list(view, c.id)} aria-current={current ? "true" : undefined}>
        <Avatar name={c.counterpart_name} email={c.counterpart_handle} size={28} />
        <span className="m-row__who">
          {(c.priority || 0) >= 3 && c.state === "needs_reply" ? <span className="m-prio" title="Today" aria-label="Today" /> : null}
          <span className="m-row__name">{c.last_direction === "outbound" && c.state === "waiting" ? `To ${who}` : who}</span>
          {(c.message_count || 0) > 1 ? <span className="m-row__n num">{c.message_count}</span> : null}
        </span>
        <span className="m-row__main">
          <span className="m-row__subject">{c.subject || "(no subject)"}</span>
          {line ? <span className="m-row__line">{line}</span> : null}
        </span>
        <span className="m-row__end">
          <span className="m-row__tags">
            {c.unsure ? <span className="c-pill c-pill--warning m-tag">Not sure</span> : null}
            {draft ? (
              <span className={cx("c-pill m-tag", draft.state === "failed" ? "c-pill--danger" : "c-pill--ai c-pill--plain")}>
                <PenLine size={11} aria-hidden="true" /> {draft.state === "failed" ? "Didn’t send" : draft.kind === "follow_up" ? "Nudge ready" : "Draft"}
              </span>
            ) : writing ? (
              <span className="c-pill c-pill--plain m-tag"><Loader2 size={11} className="m-spin" aria-hidden="true" /> Writing</span>
            ) : null}
            {category && view !== "aside" ? <span className="m-cattag c-hide-sm">{category}</span> : null}
            {c.state === "waiting" && c.follow_up_at ? <span className="m-quiet c-hide-sm">nudge {until(c.follow_up_at)}</span> : null}
            {snoozed(c) ? <span className="m-quiet">{until(c.snoozed_until)}</span> : null}
            {c.has_attachments ? <Paperclip size={12} className="c-faint" aria-label="Has attachments" /> : null}
          </span>
          <span className="m-row__time num">{short(c.last_message_at)}</span>
        </span>
      </button>
      <span className="m-row__acts">
        <Button size="sm" variant="ghost" icon={CheckCheck} label="Done (e)" onClick={props.onDone} />
        <Button size="sm" variant="ghost" icon={AlarmClock} label="Snooze until tomorrow" onClick={props.onSnooze} />
      </span>
    </div>
  );
}
