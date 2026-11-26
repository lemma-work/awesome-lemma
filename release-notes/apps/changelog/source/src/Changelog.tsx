// The public changelog: every published note, newest first (the read returns
// at most 500), in the team's brand as Brand kit had it when the newest note
// was published. A colour or face the brand doesn't have is left to the page's
// own; nothing is made up. Who asked is a count, never a name.

import { useEffect, useState, type CSSProperties } from "react";
import { errorText } from "@lemma-plugins/kit";

interface Line { section: "lead" | "improved" | "fixed" | "need"; title?: string | null; text: string; asked?: number }
interface Page {
  id: string;
  published_on: string;
  version: string;
  title: string;
  lines: Line[] | string;
  need: string | null;
  asked_total: number | null;
  product: string | null;
  brand: { name?: string | null; tokens?: Record<string, string> | null; colors?: { role?: string; value?: string; hex?: string }[] | null; fonts?: Record<string, unknown> | null } | string | null;
}

type Status = { kind: "loading" } | { kind: "ok"; pages: Page[]; truncated: boolean } | { kind: "error"; text: string };

interface Config { apiUrl?: string; authUrl?: string; webWidgets?: { name: string; publicKey: string }[] }

const DEMO_KEY = "pk_sample_demo";

function config(): Config {
  return ((window as unknown as { __LEMMA_CONFIG__?: Config }).__LEMMA_CONFIG__) || {};
}

function apiBase(): string {
  // The "Try it" demo answers this address in the page (the kit's demo.ts).
  if (import.meta.env.VITE_LEMMA_DEMO === "1") return "https://lemma-demo.invalid";
  const cfg = config();
  if (cfg.apiUrl && /^https?:\/\//.test(cfg.apiUrl)) return cfg.apiUrl.replace(/\/$/, "");
  if (cfg.authUrl && /^https?:\/\//.test(cfg.authUrl)) return `https://api.${new URL(cfg.authUrl).hostname.replace(/^www\./, "")}`;
  return `https://api.${window.location.hostname.split(".").slice(-2).join(".")}`;
}

/** The widget the host says this page may use: the Changelog one, else the first. */
function widgetKey(): string | null {
  const list = config().webWidgets || [];
  const w = list.find((x) => x.name === "Changelog") || list[0];
  if (w?.publicKey) return w.publicKey;
  return import.meta.env.VITE_LEMMA_DEMO === "1" ? DEMO_KEY : null;
}

function parse<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

const WORDS = ["No one", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

function credit(n: number): string {
  if (n === 1) return "One of you asked for this. Thank you.";
  return `${n <= 10 ? WORDS[n] : n} of you asked for this. Thank you.`;
}

function longDate(value: string): string {
  const d = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** The brand's own tokens, as --b-* properties, where it has them. */
function brandStyle(page: Page | undefined): CSSProperties {
  const b = parse<Exclude<Page["brand"], string>>(page?.brand, null);
  const t = (b?.tokens || {}) as Record<string, string>;
  const style: Record<string, string> = {};
  if (t["--brand-accent"]) style["--b-accent"] = t["--brand-accent"];
  if (t["--brand-ink"]) style["--b-ink"] = t["--brand-ink"];
  if (t["--brand-accent-ink"]) style["--b-on-accent"] = t["--brand-accent-ink"];
  if (t["--brand-font-display"]) style["--b-display"] = t["--brand-font-display"];
  if (t["--brand-font-body"]) style["--b-body"] = t["--brand-font-body"];
  return style as CSSProperties;
}

export function Changelog() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  useEffect(() => {
    const key = widgetKey();
    if (!key) {
      setStatus({ kind: "error", text: "This page can't read the notes yet. Whoever runs it turns it on in Release notes, Settings." });
      return;
    }
    const url = `${apiBase()}/public/web/${encodeURIComponent(key)}/rows?table=release_note_page&order_by=published_on&desc=true`;
    fetch(url, { credentials: "omit" })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "There's nothing published here yet." : `The notes couldn't be read (${r.status}).`);
        return r.json() as Promise<{ rows: Page[]; truncated?: boolean }>;
      })
      .then((r) => setStatus({ kind: "ok", pages: (r.rows || []).slice().sort((a, b) => String(b.published_on).localeCompare(String(a.published_on))), truncated: !!r.truncated }))
      .catch((e) => setStatus({ kind: "error", text: errorText(e) }));
  }, []);

  const pages = status.kind === "ok" ? status.pages : [];
  const product = pages.find((p) => p.product)?.product || "";
  useEffect(() => { document.title = product ? `${product} changelog` : "Changelog"; }, [product]);
  return (
    <div className="cl" style={brandStyle(pages[0])}>
      <header className="cl-head">
        <span className="cl-logo" aria-hidden="true">{(product || "C").slice(0, 1).toUpperCase()}</span>
        <span className="cl-name">{product || "Changelog"}</span>
        {product ? <span className="cl-sub">Changelog</span> : null}
      </header>
      <section className="cl-hero">
        <h1>What's new{product ? ` in ${product}` : ""}</h1>
        <p>Every change you can notice, written when it reaches you.</p>
      </section>
      {status.kind === "loading" ? (
        <div className="cl-entry" aria-busy="true"><div className="cl-skel cl-skel--date" /><div className="cl-body"><div className="cl-skel" /><div className="cl-skel cl-skel--short" /></div></div>
      ) : null}
      {status.kind === "error" ? <p className="cl-empty">{status.text}</p> : null}
      {status.kind === "ok" && !pages.length ? <p className="cl-empty">Nothing published yet.</p> : null}
      {pages.map((p) => <Entry key={p.id} page={p} />)}
      {status.kind === "ok" && status.truncated ? <p className="cl-empty">The 500 newest releases are shown.</p> : null}
    </div>
  );
}

function Entry({ page }: { page: Page }) {
  const lines = parse<Line[]>(page.lines, []);
  const leads = lines.filter((l) => l.section === "lead");
  const part = (s: Line["section"]) => lines.filter((l) => l.section === s);
  const single = leads.length === 1 && (leads[0].title || "") === page.title;
  return (
    <article className="cl-entry" id={page.version}>
      <div className="cl-date"><b>{longDate(page.published_on)}</b><span className="cl-tag">{page.version}</span></div>
      <div className="cl-body">
        <h2>{page.title}</h2>
        {leads.map((l, i) => (
          <div key={i} className="cl-lead">
            {l.title && !single ? <h3>{l.title}</h3> : null}
            <p>{l.text}</p>
            {l.asked ? <p className="cl-credit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>{credit(l.asked)}</p> : null}
          </div>
        ))}
        {page.need ? <p className="cl-need"><b>You need to:</b> {page.need}</p> : null}
        {(["improved", "fixed"] as const).map((s) => part(s).length ? (
          <div key={s}>
            <div className="cl-small">{s === "improved" ? "Improved" : "Fixed"}</div>
            <ul>{part(s).map((l, i) => <li key={i}>{l.text}</li>)}</ul>
          </div>
        ) : null)}
      </div>
    </article>
  );
}
