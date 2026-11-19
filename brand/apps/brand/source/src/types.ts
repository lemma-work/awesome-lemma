// The rows the Brand app reads. `brand` is the contract's shared table;
// the rest are Brand kit's own. JSON columns arrive parsed or as text
// (data.tsx parses them).

export const ROLES = ["accent", "ink", "surface", "surface_2", "muted", "line", "accent_ink", "ok", "bad"] as const;

export interface BrandColour {
  role: string;
  value: string;
  name?: string;
  for?: string;
  from?: string;
}

export interface BrandFace {
  family?: string;
  stack?: string;
  weight?: number | null;
  source?: string;
  note?: string;
}

export interface BrandLogo {
  variant: string;
  path: string;
  on?: string;
  asset_id?: string | null;
}

export interface Brand {
  id: string;
  name: string;
  is_default: boolean;
  state: "new" | "reading" | "check" | "ready" | "archived";
  source: string;
  source_id?: string | null;
  site_url?: string | null;
  colors: BrandColour[];
  fonts: Record<string, BrandFace>;
  tokens: Record<string, string>;
  theme_css_path?: string | null;
  logo_path?: string | null;
  logos: BrandLogo[];
  guide_path?: string | null;
  voice?: string | null;
  root_path?: string | null;
  synced_at?: string | null;
  checked_at?: string | null;
  checked_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Asset {
  id: string;
  brand_id: string;
  kind?: "logo" | "icon" | "photo" | "illustration" | "other" | null;
  own?: boolean | null;
  variant?: string | null;
  label?: string | null;
  file_path?: string | null;
  source_url?: string | null;
  found?: string | null;
  format?: string | null;
  width?: number | null;
  height?: number | null;
  sorted_by?: "lemma" | "person" | "sample" | null;
  confidence?: number | null;
  reason?: string | null;
  state: "kept" | "unsure" | "hidden";
  created_at?: string;
}

export interface EvidenceRow {
  id: string;
  brand_id: string;
  job_id?: string | null;
  kind: "screenshot" | "css" | "copy" | "document" | "file";
  about: string;
  path?: string | null;
  url?: string | null;
  excerpt?: string | null;
  note?: string | null;
  created_at?: string;
}

export interface Job {
  id: string;
  kind: "read" | "make" | "revise";
  state: "wanted" | "working" | "done" | "failed";
  brand_id?: string | null;
  design_id?: string | null;
  source?: string | null;
  source_ref?: string | null;
  prompt?: string | null;
  activity?: string | null;
  error?: string | null;
  note?: string | null;
  brand_state_before?: string | null;
  requested_by?: string | null;
  requested_name?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type DesignKind = "social_post" | "social_card" | "story" | "banner" | "poster" | "one_pager" | "other";

export interface Design {
  id: string;
  brand_id: string;
  title: string;
  kind: DesignKind;
  state: "making" | "review" | "off_brand" | "approved" | "failed" | "archived";
  prompt?: string | null;
  version: number;
  artifact_path?: string | null;
  preview_path?: string | null;
  folder?: string | null;
  activity?: string | null;
  requested_by?: string | null;
  requested_name?: string | null;
  made_from?: "chat" | "app" | "sample" | null;
  approved_at?: string | null;
  approved_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Measured {
  colours?: { value: string; hex: string; count: number; nearest_role?: string; nearest?: string; distance?: number; in_brand: boolean; translucent_neutral: boolean }[];
  faces?: { family: string; brand: boolean }[];
  logo?: { used: { file: string; brand_logo: boolean; variant?: string; brand_kind?: string }[]; drawn: string[] };
  low_contrast?: { where: string; ink: string; ground: string; ratio: number; needs: number }[];
  uses_tokens?: number;
}

export interface Version {
  id: string;
  design_id: string;
  version: number;
  artifact_path?: string | null;
  preview_path?: string | null;
  prompt?: string | null;
  note?: string | null;
  verdict?: "follows" | "breaks" | "unsure" | null;
  broke?: string | null;
  reason?: string | null;
  confidence?: number | null;
  measured?: Measured | null;
  judged_by?: "lemma" | "person" | null;
  created_at?: string;
  updated_at?: string;
}

export const KINDS: { id: DesignKind; label: string; size: [number, number] }[] = [
  { id: "social_post", label: "Social post", size: [1080, 1080] },
  { id: "social_card", label: "Link card", size: [1200, 630] },
  { id: "story", label: "Story", size: [1080, 1920] },
  { id: "banner", label: "Banner", size: [1500, 500] },
  { id: "poster", label: "Poster", size: [1080, 1350] },
  { id: "one_pager", label: "One-pager", size: [816, 1056] },
  { id: "other", label: "Other", size: [1200, 1200] },
];

export const kindOf = (id: string | null | undefined) => KINDS.find((k) => k.id === id) || KINDS[KINDS.length - 1];

export const ROLE_WORDS: Record<string, { label: string; for: string }> = {
  accent: { label: "Accent", for: "The one colour people name as yours" },
  ink: { label: "Ink", for: "Body text" },
  surface: { label: "Surface", for: "The page" },
  surface_2: { label: "Surface 2", for: "Cards and panels" },
  muted: { label: "Muted", for: "Secondary text" },
  line: { label: "Line", for: "Borders and hairlines" },
  accent_ink: { label: "On accent", for: "Text on the accent" },
  ok: { label: "Success", for: "Things that went right" },
  bad: { label: "Error", for: "Things that went wrong" },
  extra: { label: "Extra", for: "" },
};

export const RULE_WORDS: Record<string, string> = {
  none: "Follows the brand",
  colour: "A colour that isn't the brand's",
  type: "A face that isn't the brand's",
  logo: "The logo",
  contrast: "Text too faint to read",
  voice: "Words that don't sound like the brand",
  other: "Something else in the guide",
};
