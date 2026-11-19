// Decks' working set and every write it makes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider), so cards appear the moment the writer saves each one.
// decks_deck, decks_card and decks_theme are the team's; decks_job and
// decks_settings are each person's own (RLS). Brand kit's `brand` table is
// read as the person when it is there; Decks holds no grant on it.
//
// A brand deck is drawn in the team's current brand: its `look` is replaced
// here by the brand row's, so a re-read in Brand kit shows at once (the
// functions take it afresh for every piece of work too).
//
// Writes: a person's request is a decks_job row (`wanted`), which starts the
// decks-work run as them; one-row edits go straight to the records API;
// several rows at once (undo, the sample) go through Decks' functions.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { client, create, items, q, runFunction, sql, update, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import { brandLook, themeLook } from "./look";
import type { BrandRow, Card, Deck, Job, Look, Settings, Theme } from "./types";

export const LOADERS: Loaders = {
  settings: { sql: "SELECT * FROM decks_settings ORDER BY created_at LIMIT 1", tables: ["decks_settings"] },
  decks: { sql: "SELECT * FROM decks_deck ORDER BY updated_at DESC LIMIT 500", tables: ["decks_deck"] },
  cards: { sql: "SELECT * FROM decks_card ORDER BY deck_id, position LIMIT 5000", tables: ["decks_card"] },
  jobs: { sql: "SELECT * FROM decks_job ORDER BY created_at DESC LIMIT 1000", tables: ["decks_job"] },
  themes: { sql: "SELECT * FROM decks_theme ORDER BY position, name", tables: ["decks_theme"] },
  sample: { sql: "SELECT member, COUNT(*) AS n FROM decks_sample_row GROUP BY member", tables: ["decks_sample_row"] },
  // Brand kit's table, when Brand kit is in this Lemma; an error here means it isn't.
  brand: {
    sql: "SELECT * FROM brand WHERE state IN ('check', 'ready') ORDER BY is_default DESC, updated_at DESC LIMIT 1",
    tables: ["brand"],
  },
};

function json<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export function asDeck(r: Record<string, unknown>): Deck {
  return { ...(r as unknown as Deck), look: json<Look | null>(r.look, null), files: json(r.files, null) };
}

export function asCard(r: Record<string, unknown>): Card {
  const blocks = json<unknown>(r.blocks, []);
  const list = Array.isArray(blocks) ? blocks : Array.isArray((blocks as { blocks?: unknown[] })?.blocks) ? (blocks as { blocks: unknown[] }).blocks : [];
  const norm = list.map((b) => {
    const block = b as Record<string, unknown>;
    if (block.type === "bullets" && Array.isArray(block.items)) {
      return { ...block, items: (block.items as unknown[]).map((i) => (typeof i === "string" ? { text: i } : i)) };
    }
    return block;
  });
  return { ...(r as unknown as Card), blocks: norm as Card["blocks"], version: Number(r.version || 0), position: Number(r.position || 0) };
}

export function asJob(r: Record<string, unknown>): Job {
  return { ...(r as unknown as Job), cards: json(r.cards, null), chosen: json(r.chosen, null), before: json(r.before, null) };
}

interface World {
  me: { id: string; name: string; email: string | null } | null;
  lemmaName: string;
}
const WorldContext = createContext<World>({ me: null, lemmaName: "This Lemma" });

/** Who is signed in, and the Lemma's name: read once. */
export function WorldProvider({ children }: { children: ReactNode }) {
  const [world, setWorld] = useState<World>({ me: null, lemmaName: "This Lemma" });
  useEffect(() => {
    void (async () => {
      const [me, pod] = await Promise.all([whoAmI(), client.pods.get(client.podId || "").catch(() => null)]);
      setWorld({
        me: me ? { id: me.id, email: me.email, name: me.name || (me.email || "").split("@")[0] || "You" } : null,
        lemmaName: ((pod as { name?: string } | null)?.name || "This Lemma").trim(),
      });
    })();
  }, []);
  return <WorldContext.Provider value={world}>{children}</WorldContext.Provider>;
}

export function useWorld(): World {
  return useContext(WorldContext);
}

/** Everything the screens read, typed and indexed. */
export function useDecks() {
  const { loaded, errors, reload } = useData();
  const { me } = useWorld();
  const settingsRows = useRows<Record<string, unknown>>("settings");
  const deckRows = useRows<Record<string, unknown>>("decks");
  const cardRows = useRows<Record<string, unknown>>("cards");
  const jobRows = useRows<Record<string, unknown>>("jobs");
  const themeRows = useRows<Record<string, unknown>>("themes");
  const sampleRows = useRows<{ member: string; n: number }>("sample");
  const brandRows = useRows<Record<string, unknown>>("brand");
  return useMemo(() => {
    const brandNow = !errors.brand && brandRows[0]
      ? ({ ...(brandRows[0] as unknown as BrandRow), colors: json(brandRows[0].colors, null), fonts: json(brandRows[0].fonts, null),
           tokens: json(brandRows[0].tokens, null), logos: json(brandRows[0].logos, null) } as BrandRow)
      : null;
    const brandLookNow = brandNow ? brandLook(brandNow) : null;
    const decks = deckRows.map(asDeck).map((d) => (d.look?.source === "brand" && brandLookNow ? { ...d, look: brandLookNow } : d));
    const cards = cardRows.map(asCard);
    const byDeck = new Map<string, Card[]>();
    for (const c of cards) {
      const list = byDeck.get(c.deck_id) || [];
      list.push(c);
      byDeck.set(c.deck_id, list);
    }
    for (const list of byDeck.values()) list.sort((a, b) => a.position - b.position);
    const settings = settingsRows[0] ? (settingsRows[0] as unknown as Settings) : null;
    const themes = themeRows.map((t) => ({ ...(t as unknown as Theme), tokens: json(t.tokens, {}) }));
    const brand = brandNow;
    return {
      loaded, errors, reload, settings, decks, cards, byDeck,
      jobs: jobRows.map(asJob),
      themes,
      brand,
      sample: Number(sampleRows.find((r) => r.member === me?.id)?.n || 0) > 0,
    };
  }, [loaded, errors, reload, settingsRows, deckRows, cardRows, jobRows, themeRows, sampleRows, brandRows, me]);
}

/* ---------- writes ---------- */

export function needsYou(): void {
  void runFunction("decks_needs_you").catch(() => undefined);
}

/** The look new decks take for this person: the brand, their theme, or the first theme. */
export function defaultLook(settings: Settings | null, themes: Theme[], brand: BrandRow | null): Look | null {
  if (brand && settings?.look_source !== "theme") return brandLook(brand);
  const theme = themes.find((t) => t.id === settings?.theme_id) || themes[0];
  return theme ? themeLook(theme) : null;
}

export interface NewDeck {
  prompt: string;
  notes?: string;
  files?: File[];
  card_count?: number;
  density?: string;
  theme?: string;
  look?: "brand" | "theme";
}

/** A deck from a sentence: its files go under /decks/<deck id>/ first, then decks_make. */
export async function makeDeck(input: NewDeck): Promise<{ deck_id: string }> {
  let paths: string[] = [];
  if (input.files?.length) {
    const folder = `upload-${Date.now().toString(36)}`;
    try {
      await client.files.folder.create(folder, { directoryPath: "/decks" });
    } catch {
      /* there already */
    }
    for (const file of input.files) {
      const done = (await client.files.upload(file, { name: file.name, directoryPath: `/decks/${folder}` })) as unknown as { path?: string };
      paths.push(done?.path || `/decks/${folder}/${file.name}`);
    }
  }
  const out = await runFunction<{ deck_id?: string; message?: string }>("decks_make", {
    prompt: input.prompt, notes: input.notes || null, files: paths, card_count: input.card_count || null,
    density: input.density || null, theme: input.theme || null, look: input.look || null, source: "app",
  });
  if (!out.deck_id) throw new Error(out.message || "The deck wasn't made.");
  paths = [];
  return { deck_id: out.deck_id };
}

/** Ask for work on a deck: a job row, which starts the decks-work run as you. */
export async function ask(deckId: string, kind: Job["kind"], extra: Record<string, unknown> = {}): Promise<Job> {
  return asJob(await create("decks_job", { deck_id: deckId, kind, state: "wanted", ...extra }));
}

/** Start a job that stalled, or failed, again: the same row, back to wanted. */
export async function again(job: Job): Promise<void> {
  if (job.state === "wanted") await update("decks_job", job.id, { state: "working" });
  await update("decks_job", job.id, { state: "wanted", error: null });
}

export async function approveOutline(deck: Deck, patch: Partial<Deck>): Promise<void> {
  await update("decks_deck", deck.id, { ...patch, status: "writing", approved_at: new Date().toISOString() });
  await ask(deck.id, "cards");
  needsYou();
}

export async function rewriteOutline(deck: Deck): Promise<void> {
  await update("decks_deck", deck.id, { status: "outlining", error: null });
  await ask(deck.id, "outline");
}

/** The person opened a deck that's ready: its "ready" item leaves Today. */
export async function markOpened(deck: Deck, jobs: Job[]): Promise<void> {
  const fresh = jobs.filter((j) => j.deck_id === deck.id && j.kind === "cards" && j.state === "done" && !j.opened_at);
  if (!fresh.length) return;
  const now = new Date().toISOString();
  await Promise.all(fresh.map((j) => update("decks_job", j.id, { opened_at: now })));
  needsYou();
}

export async function undo(job: Job, cards?: string[]): Promise<{ message?: string }> {
  return runFunction("decks_undo", { job_id: job.id, cards: cards ?? null });
}

export async function deleteDeck(deck: Deck, cards: Card[], jobs: Job[]): Promise<void> {
  for (const j of jobs.filter((j) => j.deck_id === deck.id)) await client.records.delete("decks_job", j.id).catch(() => undefined);
  if (cards.length) await client.records.bulk.delete("decks_card", cards.map((c) => c.id));
  await client.records.delete("decks_deck", deck.id);
  needsYou();
}

export async function moveCard(cards: Card[], card: Card, by: -1 | 1): Promise<void> {
  const i = cards.findIndex((c) => c.id === card.id);
  const other = cards[i + by];
  if (!other) return;
  await update("decks_card", card.id, { position: other.position });
  await update("decks_card", other.id, { position: card.position });
}

export async function removeCard(cards: Card[], card: Card): Promise<void> {
  await client.records.delete("decks_card", card.id);
  const rest = cards.filter((c) => c.id !== card.id);
  await Promise.all(rest.map((c, i) => (c.position !== i + 1 ? update("decks_card", c.id, { position: i + 1 }) : null)));
}

export async function addOutlineCard(deck: Deck, cards: Card[]): Promise<void> {
  const last = cards[cards.length - 1];
  const closing = last?.layout === "closing";
  const position = closing ? last.position : (last?.position || 0) + 1;
  if (closing) await update("decks_card", last.id, { position: last.position + 1 });
  await create("decks_card", { deck_id: deck.id, position, title: "New card", outline: "", layout: "bullets", status: "outline", version: 0 });
}

export { items, q, sql };
