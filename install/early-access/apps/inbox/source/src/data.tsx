// The Inbox's working set: one read per table, kept fresh by the change
// stream (a burst of writes reloads once) and re-read when the tab comes back.
// Every table is per person: all of it is the signed-in person's own mail.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { client, items, runFunction, errorText } from "@lemma-plugins/kit";
import type { Activity, Category, Conv, DraftRow, Mailbox, PromiseRow, Rule, Settings } from "./types";

export interface Counts {
  /** view -> conversations in it, over every conversation (not the loaded page). */
  view: Record<string, number>;
  /** category key -> open conversations; and those needing a reply. */
  category: Record<string, number>;
  categoryNeeds: Record<string, number>;
}

export interface MailData {
  settings: Settings | null;
  mailboxes: Mailbox[];
  categories: Category[];
  rules: Rule[];
  conversations: Conv[];
  drafts: DraftRow[];
  promises: PromiseRow[];
  activity: Activity[];
  counts: Counts;
}
type Name = keyof MailData;

const EMPTY: MailData = {
  settings: null, mailboxes: [], categories: [], rules: [], conversations: [], drafts: [], promises: [], activity: [],
  counts: { view: {}, category: {}, categoryNeeds: {} },
};

const q = <T,>(sql: string) => client.datastore.query(sql).then((r) => items<T>(r));

const FIELDS =
  "c.id, c.source, c.source_account, c.source_id, c.place, c.subject, c.snippet, c.counterpart_handle, c.counterpart_name, " +
  "c.last_message_at, c.last_direction, c.message_count, c.has_attachments, c.kind, c.document_path, c.state, c.priority, " +
  "c.category, c.ask, c.sorted_at, c.updated_at, t.unread, t.in_inbox, t.snoozed_until, t.muted, t.follow_up_at, " +
  "t.waiting_since, t.unsure, t.sorted_by, t.confidence, t.reason, t.draft_state, t.draft_kind, t.draft_hint, t.promise_state, " +
  "t.latest_message_id";

export const ACTIVE = new Set(["new", "needs_reply", "waiting", "fyi"]);

const LOADERS: Record<Name, () => Promise<unknown>> = {
  settings: () => q<Settings>("select * from mail_settings order by created_at limit 1").then((r) => r[0] || null),
  mailboxes: () => q<Mailbox>("select * from mail_mailbox order by created_at limit 20"),
  categories: () => q<Category>("select * from mail_category where state <> 'retired' order by position, name limit 100"),
  rules: () => q<Rule>("select * from mail_rule where state <> 'retired' order by created_at limit 200"),
  conversations: () =>
    q<Conv>(
      `select ${FIELDS} from conversation c join mail_thread t on t.id = c.id where c.source = 'mail' and ` +
        "(c.state <> 'done' or c.last_message_at > now() - interval '21 days') order by c.last_message_at desc nulls last limit 600",
    ),
  drafts: () =>
    q<DraftRow>(
      "select * from draft where source = 'mail' and (state in ('proposed','approved','sending','failed') or " +
        "(state = 'sent' and sent_at > now() - interval '14 days')) order by updated_at desc limit 300",
    ),
  promises: () => q<PromiseRow>("select * from promise where state = 'open' order by due_at nulls last, created_at desc limit 300"),
  activity: () => q<Activity>("select * from mail_activity order by created_at desc limit 60"),
  counts: async () => {
    const rows = await q<{ state: string; category: string | null; unsure: boolean; snoozed: boolean; muted: boolean; hidden: boolean; n: number }>(
      "select c.state, c.category, coalesce(t.unsure, false) as unsure, coalesce(t.snoozed_until > now(), false) as snoozed, " +
        "coalesce(t.muted, false) as muted, coalesce(k.hidden, false) as hidden, count(*) as n from conversation c " +
        "join mail_thread t on t.id = c.id left join mail_category k on k.key = c.category and k.state = 'active' " +
        "where c.source = 'mail' group by 1, 2, 3, 4, 5, 6",
    );
    const c: Counts = { view: {}, category: {}, categoryNeeds: {} };
    const add = (key: string, n: number) => (c.view[key] = (c.view[key] || 0) + n);
    for (const r of rows) {
      const n = Number(r.n) || 0;
      if (r.muted) continue;
      if (r.snoozed) {
        add("snoozed", n);
        continue;
      }
      if (r.state === "new") add("sorting", n);
      if (r.state === "needs_reply") add("needs", n);
      if (r.state === "waiting") add("waiting", n);
      if (r.unsure && ACTIVE.has(r.state)) add("unsure", n);
      if (ACTIVE.has(r.state)) {
        add(r.hidden ? "aside" : "inbox", n);
        if (r.category) {
          c.category[r.category] = (c.category[r.category] || 0) + n;
          if (r.state === "needs_reply") c.categoryNeeds[r.category] = (c.categoryNeeds[r.category] || 0) + n;
        }
      }
    }
    return c;
  },
};

const TABLES: Record<string, Name[]> = {
  mail_settings: ["settings"], mail_mailbox: ["mailboxes"], mail_category: ["categories", "counts"], mail_rule: ["rules"],
  conversation: ["conversations", "counts"], mail_thread: ["conversations", "counts"], draft: ["drafts"], promise: ["promises"],
  mail_activity: ["activity"],
};

interface Ctx extends MailData {
  loaded: boolean;
  errors: Partial<Record<Name, string>>;
  reload: (name?: Name) => Promise<void>;
  patch: (ids: string[], change: Partial<Conv>) => void;
  patchDraft: (id: string, change: Partial<DraftRow>) => void;
}
const MailContext = createContext<Ctx | null>(null);

export function MailProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<MailData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Name, string>>>({});
  const timers = useRef<Partial<Record<Name, number>>>({});

  const reloadOne = useCallback(async (name: Name) => {
    try {
      const value = await LOADERS[name]();
      setData((d) => ({ ...d, [name]: value }));
      setErrors((e) => ({ ...e, [name]: undefined }));
    } catch (err) {
      setErrors((e) => ({ ...e, [name]: errorText(err) }));
    }
  }, []);
  const reload = useCallback(
    async (name?: Name) => {
      await Promise.all((name ? [name] : (Object.keys(LOADERS) as Name[])).map(reloadOne));
    },
    [reloadOne],
  );

  useEffect(() => {
    let alive = true;
    void reload().then(() => alive && setLoaded(true));
    const handle = client.datastore.watchChanges({
      onChange: (frame: { table_name: string }) => {
        for (const name of TABLES[frame.table_name] || []) {
          window.clearTimeout(timers.current[name]);
          // The sort writes a batch at a time: one reload per burst, not per row.
          timers.current[name] = window.setTimeout(() => void reloadOne(name), name === "conversations" ? 700 : 350);
        }
      },
      onError: (err: unknown) => console.debug("[mail] change stream:", err),
    } as never) as unknown as { close?: () => void } | undefined;
    let last = Date.now();
    const back = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 15_000) {
        last = Date.now();
        void reload();
      }
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      alive = false;
      handle?.close?.();
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
      for (const t of Object.values(timers.current)) window.clearTimeout(t);
    };
  }, [reload, reloadOne]);

  const patch = useCallback((ids: string[], change: Partial<Conv>) => {
    const set = new Set(ids);
    setData((d) => ({ ...d, conversations: d.conversations.map((c) => (set.has(c.id) ? { ...c, ...change } : c)) }));
  }, []);
  const patchDraft = useCallback((id: string, change: Partial<DraftRow>) => {
    setData((d) => ({ ...d, drafts: d.drafts.map((x) => (x.id === id ? { ...x, ...change } : x)) }));
  }, []);

  const value = useMemo<Ctx>(() => ({ ...data, loaded, errors, reload, patch, patchDraft }), [data, loaded, errors, reload, patch, patchDraft]);
  return <MailContext.Provider value={value}>{children}</MailContext.Provider>;
}

export function useMail(): Ctx {
  const ctx = useContext(MailContext);
  if (!ctx) throw new Error("useMail needs a MailProvider around it.");
  return ctx;
}

/** Actions go through mail_thread_action, so Gmail or Outlook follow and a
 *  move is kept as a correction. The list changes first; the person never
 *  waits on the provider. */
export function useAct() {
  const { patch, reload } = useMail();
  return useCallback(
    async (ids: string[], action: string, extra: Record<string, unknown> = {}) => {
      const local: Partial<Conv> | null =
        action === "done" ? { state: "done", in_inbox: false }
        : action === "mute" ? { state: "done", muted: true, in_inbox: false }
        : action === "snooze" ? { snoozed_until: String(extra.until) }
        : action === "unsnooze" ? { snoozed_until: null }
        : action === "read" ? { unread: false }
        : action === "unread" ? { unread: true }
        : action === "restore" ? { state: "fyi", in_inbox: true, muted: false }
        : action === "move" ? { ...(extra.category ? { category: String(extra.category) } : {}), ...(extra.state ? { state: extra.state as Conv["state"] } : {}), unsure: false, sorted_by: "person" }
        : action === "state" ? { state: extra.state as Conv["state"], unsure: false, sorted_by: "person" }
        : action === "draft" ? { draft_state: "wanted", draft_hint: (extra.hint as string) || null }
        : null;
      if (local) patch(ids, local);
      try {
        return await runFunction<{ updated: number; corrections: number; provider_errors: string[] }>("mail_thread_action", { conversation_ids: ids, action, ...extra });
      } catch (err) {
        void reload("conversations");
        throw err;
      }
    },
    [patch, reload],
  );
}

export function isSample(mailboxes: Mailbox[], account?: string | null): boolean {
  const box = mailboxes.find((m) => m.id === account);
  return box ? box.account_id === "sample" : mailboxes.length > 0 && mailboxes.every((m) => m.account_id === "sample");
}
