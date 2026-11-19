// The rows Decks reads, as the app uses them. The tables are in
// ../../../../tables; blocks are the content model decks_save_card keeps.

export type Layout = "hero" | "prose" | "bullets" | "two-column" | "quote" | "stats" | "visual-left" | "visual-right" | "closing";
export const LAYOUTS: { id: Layout; label: string }[] = [
  { id: "hero", label: "Title" },
  { id: "prose", label: "Paragraph" },
  { id: "bullets", label: "Points" },
  { id: "two-column", label: "Two columns" },
  { id: "quote", label: "Quote" },
  { id: "stats", label: "Figures" },
  { id: "visual-left", label: "Picture left" },
  { id: "visual-right", label: "Picture right" },
  { id: "closing", label: "Closing" },
];
export const layoutLabel = (l: string | null | undefined) => LAYOUTS.find((x) => x.id === l)?.label || "Card";

/** Where a figure that stays current will come from (a Numbers plugin); null today. */
export interface FigureSource {
  plugin: string;
  metric: string;
  as_of?: string;
}

export type Block =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "bullets"; items: { text: string; icon?: string | null }[] }
  | { type: "quote"; text: string; attribution?: string | null }
  | { type: "stats"; items: { value: string; label: string; icon?: string | null; source?: FigureSource | null }[] }
  | { type: "columns"; columns: { heading: string; body: string; icon?: string | null }[] }
  | { type: "visual"; hint: string };

export interface Look {
  source: "brand" | "theme";
  theme_id?: string | null;
  brand_id?: string | null;
  name?: string | null;
  surface: string;
  raised: string;
  ink: string;
  muted: string;
  accent: string;
  accent_ink?: string | null;
  heading_font: string;
  body_font: string;
  /** A CSS stack, when the brand gave one. */
  heading_stack?: string | null;
  body_stack?: string | null;
  /** Load from Google Fonts. */
  heading_google?: boolean;
  /** The display face's weight (a brand's may have only 400); 600 when unsaid. */
  heading_weight?: number | null;
  body_google?: boolean;
  /** The font written into a .pptx (an office-safe one for a theme; the brand's own for a brand). */
  heading_office?: string | null;
  body_office?: string | null;
  radius?: string | null;
  logo_path?: string | null;
  logo_inverse_path?: string | null;
  dark?: boolean;
}

export type DeckStatus = "outlining" | "outline_ready" | "writing" | "ready" | "failed";

export interface Deck {
  id: string;
  title: string | null;
  prompt: string;
  notes: string | null;
  files: { path: string; name: string }[] | null;
  status: DeckStatus;
  card_count: number | null;
  density: "concise" | "balanced" | "detailed" | null;
  look: Look | null;
  voice: string | null;
  source: "app" | "chat" | "sample";
  made_by: string | null;
  made_by_name: string | null;
  approved_at: string | null;
  ready_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type CardStatus = "outline" | "writing" | "ready" | "failed";

export interface Card {
  id: string;
  deck_id: string;
  position: number;
  title: string | null;
  outline: string | null;
  layout: Layout;
  blocks: Block[];
  notes: string | null;
  status: CardStatus;
  version: number;
  edit_id: string | null;
  created_at: string;
  updated_at: string;
}

export type JobState = "wanted" | "working" | "ask" | "done" | "failed" | "undone";
export type Action = "rewrite" | "add" | "remove" | "look" | "none";

export interface Job {
  id: string;
  deck_id: string;
  kind: "outline" | "cards" | "edit";
  state: JobState;
  request: string | null;
  action: Action | null;
  cards: string[] | null;
  chosen: string[] | null;
  confidence: number | null;
  reason: string | null;
  theme: string | null;
  summary: string | null;
  error: string | null;
  decide_seconds: number | null;
  before: { cards?: Card[]; added?: string[]; look?: Look } | null;
  started_at: string | null;
  finished_at: string | null;
  opened_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Theme {
  id: string;
  name: string;
  description: string | null;
  tokens: Partial<Look>;
  position: number | null;
}

export interface Settings {
  id: string;
  display_name: string | null;
  setup_run_id: string | null;
  setup_step: "start" | "look" | "first" | "done";
  look_source: "brand" | "theme";
  theme_id: string | null;
  card_count: number | null;
  density: "concise" | "balanced" | "detailed" | null;
}

/** Brand kit's `brand` row, read as the person (Decks holds no grant on it). */
export interface BrandRow {
  id: string;
  name: string;
  is_default: boolean;
  state: string;
  colors: { role: string; value: string; name?: string }[] | null;
  fonts: Record<string, { family?: string; stack?: string; weight?: number; source?: string }> | null;
  tokens: Record<string, string> | null;
  logo_path: string | null;
  logos: { variant: string; path: string; on?: string }[] | null;
  guide_path: string | null;
  voice: string | null;
  updated_at: string;
}
