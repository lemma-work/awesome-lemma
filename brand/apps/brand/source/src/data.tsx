// The app's working set and its writes.
//
// Reads: one SQL read per table, kept fresh by the change stream (the kit's
// DataProvider). Everything here is the team's (no RLS): the brand, what it
// was read from, the jobs the Lemma's assistant works, and the designs.
// Writes that touch one row go to the records API; anything that changes the
// brand or teaches it goes through Brand kit's functions (brand_fix,
// brand_read, brand_design_action), which keep the person's fixes as the
// examples for the next Decisions call.

import { useEffect, useMemo, useState } from "react";
import { client, runFunction, useData, useRows, whoAmI, type Loaders } from "@lemma-plugins/kit";
import type { Asset, Brand, Design, EvidenceRow, Job, Version } from "./types";

export const LOADERS: Loaders = {
  brands: { sql: "SELECT * FROM brand WHERE state <> 'archived' ORDER BY is_default DESC, created_at", tables: ["brand"] },
  assets: { sql: "SELECT * FROM brand_asset ORDER BY created_at LIMIT 500", tables: ["brand_asset"] },
  evidence: { sql: "SELECT * FROM brand_evidence ORDER BY created_at LIMIT 500", tables: ["brand_evidence"] },
  jobs: { sql: "SELECT * FROM brand_job ORDER BY created_at DESC LIMIT 100", tables: ["brand_job"] },
  designs: { sql: "SELECT * FROM brand_design ORDER BY updated_at DESC LIMIT 300", tables: ["brand_design"] },
  versions: {
    sql: "SELECT id, design_id, version, artifact_path, preview_path, prompt, note, verdict, broke, reason, confidence, measured, judged_by, created_at, updated_at FROM brand_version ORDER BY version DESC LIMIT 1000",
    tables: ["brand_version"],
  },
  sample: { sql: "SELECT COUNT(*) AS n FROM brand_sample_row", tables: ["brand_sample_row"] },
};

export function json<T>(value: unknown, fallback: T): T {
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

function asBrand(r: Record<string, unknown>): Brand {
  return {
    ...(r as unknown as Brand),
    colors: json(r.colors, []),
    fonts: json(r.fonts, {}),
    tokens: json(r.tokens, {}),
    logos: json(r.logos, []),
  };
}

export function useBrandData() {
  const { loaded, errors, reload } = useData();
  const brands = useRows<Record<string, unknown>>("brands").map(asBrand);
  const assets = useRows<Asset>("assets");
  const evidence = useRows<EvidenceRow>("evidence");
  const jobs = useRows<Job>("jobs");
  const designs = useRows<Design>("designs");
  const versions = useRows<Record<string, unknown>>("versions").map((v) => ({ ...(v as unknown as Version), measured: json(v.measured, null) }));
  const sampleCount = Number((useRows<{ n: number }>("sample")[0] || {}).n || 0);
  return { loaded, errors, reload, brands, assets, evidence, jobs, designs, versions, sampleCount };
}

export interface Me {
  id: string;
  name: string;
}

export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    void whoAmI().then((m) => m && setMe({ id: m.id, name: m.name || (m.email || "").split("@")[0] || "You" }));
  }, []);
  return me;
}

/** A pod file as something an <img> can show: downloaded with the person's
 *  session (an <img> cannot send it), kept as an object URL for the page. */
const urls = new Map<string, Promise<string>>();
export function fileUrl(path: string): Promise<string> {
  let found = urls.get(path);
  if (!found) {
    found = client.files.download(path).then((blob) => {
      const type = path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : blob.type;
      return URL.createObjectURL(type && type !== blob.type ? new Blob([blob], { type }) : blob);
    });
    found.catch(() => urls.delete(path));
    urls.set(path, found);
  }
  return found;
}

export function useFileUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path) void fileUrl(path).then((u) => live && setUrl(u)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

export async function fileText(path: string): Promise<string> {
  return (await client.files.download(path)).text();
}

export function useFileText(path: string | null | undefined, version?: string): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setText(null);
    if (path) void fileText(path).then((t) => live && setText(t)).catch(() => live && setText(""));
    return () => {
      live = false;
    };
  }, [path, version]);
  return text;
}

/** Google faces the brand uses, loaded so a specimen shows the real face. */
export function useBrandFaces(brand: Brand | null) {
  const families = useMemo(
    () => Object.values(brand?.fonts || {}).filter((f) => f?.source === "google" && f.family).map((f) => f.family as string),
    [brand],
  );
  useEffect(() => {
    if (!families.length) return;
    const href = "https://fonts.googleapis.com/css2?" + [...new Set(families)].map((f) => `family=${f.trim().replace(/ /g, "+")}:wght@400;500;600;700`).join("&") + "&display=swap";
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, [families]);
}

export const run = runFunction;

/** Set-up once per page: the memory block and the playbooks, and what needs the person. */
let setUp = false;
export function setUpOnce(): void {
  if (setUp) return;
  setUp = true;
  void runFunction("brand_setup", {}).catch((e) => console.debug("[brand] set-up:", e));
  void runFunction("brand_needs_you", {}).catch((e) => console.debug("[brand] needs you:", e));
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function fileName(path: string | null | undefined): string {
  return (path || "").split("/").pop() || "";
}

export async function download(path: string): Promise<void> {
  const blob = await client.files.download(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(path) || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Whether an image is mostly light ink (a white illustration, an inverse
 *  logo), measured from its opaque pixels, so it is shown on a dark ground
 *  instead of disappearing into a light one. */
const light = new Map<string, Promise<boolean>>();
export function useMostlyLight(url: string | null): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    let live = true;
    if (!url) return;
    let found = light.get(url);
    if (!found) {
      found = new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const size = 48;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            if (!ctx) return resolve(false);
            ctx.drawImage(img, 0, 0, size, size);
            const px = ctx.getImageData(0, 0, size, size).data;
            let sum = 0;
            let n = 0;
            for (let i = 0; i < px.length; i += 4) {
              if (px[i + 3] < 128) continue;
              sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
              n += 1;
            }
            resolve(n > 20 && sum / n > 0.86);
          } catch {
            resolve(false);
          }
        };
        img.onerror = () => resolve(false);
        img.src = url;
      });
      light.set(url, found);
    }
    void found.then((v) => live && setValue(v));
    return () => {
      live = false;
    };
  }, [url]);
  return value;
}

/** Re-read while something is being worked on, in case the change stream is
 *  not there (a dev server, a proxy that drops sockets): the job's activity
 *  line still moves. */
export function usePoll(active: boolean, ms = 4000): void {
  const { reload } = useData();
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => void reload(), ms);
    return () => window.clearInterval(t);
  }, [active, ms, reload]);
}
