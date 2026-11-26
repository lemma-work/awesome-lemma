// The outside roadmap page: Now, Next, Later and what shipped in the last 90
// days, read from the Lemma's Public `roadmap_public` table through the web
// widget key the host puts in __LEMMA_CONFIG__.webWidgets. The table holds
// only what the team chose to show (a title, a line, which part of the page,
// a shipped date), so there are no names, no numbers and no voting here.

import { useEffect, useState } from "react";

interface Line { id: string; lane: "now" | "next" | "later" | "shipped"; title: string; blurb: string | null; shipped_on: string | null; position: number | null }
type Status = { kind: "loading" } | { kind: "ok"; lines: Line[] } | { kind: "error"; text: string };
interface Config { apiUrl?: string; authUrl?: string; webWidgets?: { name: string; publicKey: string }[] }

const DEMO_KEY = "pk_sample_demo";
const WIDGET = "Roadmap";
const LANES: { id: Line["lane"]; title: string; hint: string }[] = [
  { id: "now", title: "Now", hint: "Being built" },
  { id: "next", title: "Next", hint: "Decided, not started" },
  { id: "later", title: "Later", hint: "Likely, not decided" },
  { id: "shipped", title: "Shipped", hint: "In the last 90 days" },
];

function config(): Config {
  return ((window as unknown as { __LEMMA_CONFIG__?: Config }).__LEMMA_CONFIG__) || {};
}

function apiBase(): string {
  if (import.meta.env.VITE_LEMMA_DEMO === "1") return "https://lemma-demo.invalid";
  const cfg = config();
  if (cfg.apiUrl && /^https?:\/\//.test(cfg.apiUrl)) return cfg.apiUrl.replace(/\/$/, "");
  if (cfg.authUrl && /^https?:\/\//.test(cfg.authUrl)) return `https://api.${new URL(cfg.authUrl).hostname.replace(/^www\./, "")}`;
  return `https://api.${window.location.hostname.split(".").slice(-2).join(".")}`;
}

/** The widget the host says this page may use: the Roadmap one, else the first. */
function widgetKey(): string | null {
  const list = config().webWidgets || [];
  const w = list.find((x) => x.name === WIDGET) || list[0];
  if (w?.publicKey) return w.publicKey;
  return import.meta.env.VITE_LEMMA_DEMO === "1" ? DEMO_KEY : null;
}

function shortDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function PublicRoadmap() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  useEffect(() => {
    const key = widgetKey();
    if (!key) {
      setStatus({ kind: "error", text: "This roadmap isn't public yet." });
      return;
    }
    fetch(`${apiBase()}/public/web/${encodeURIComponent(key)}/rows?table=roadmap_public&order_by=position`, { credentials: "omit" })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "This roadmap isn't public yet." : `The roadmap couldn't be read (${r.status}).`);
        return r.json() as Promise<{ rows: Line[] }>;
      })
      .then((r) => setStatus({ kind: "ok", lines: r.rows || [] }))
      .catch((e) => setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) }));
  }, []);
  useEffect(() => { document.title = "Roadmap"; }, []);
  const lines = status.kind === "ok" ? status.lines : [];
  const newest = lines.filter((l) => l.lane === "shipped" && l.shipped_on).map((l) => String(l.shipped_on)).sort().pop();
  return (
    <div className="pr">
      <header className="pr-head">
        <span className="pr-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" /><path d="M15 5.764v15" /><path d="M9 3.236v15" /></svg>
        </span>
        <h1>Roadmap</h1>
        <p>What we're building, and what's next.{newest ? ` Last shipped ${shortDate(newest)}.` : ""}</p>
      </header>
      {status.kind === "loading" ? (
        <div className="pr-lane" aria-busy="true"><div className="pr-skel pr-skel--pill" /><div className="pr-skel" /><div className="pr-skel pr-skel--short" /></div>
      ) : null}
      {status.kind === "error" ? <p className="pr-empty">{status.text}</p> : null}
      {status.kind === "ok" && !lines.length ? <p className="pr-empty">Nothing is on the public roadmap yet.</p> : null}
      {status.kind === "ok" && lines.length ? LANES.map((lane) => {
        const group = lines.filter((l) => l.lane === lane.id).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
        if (!group.length) return null;
        return (
          <section className="pr-lane" key={lane.id} aria-label={lane.title}>
            <div className="pr-lane__head"><span className={`pr-pill pr-pill--${lane.id}`}>{lane.title}</span><span className="pr-hint">{lane.hint}</span></div>
            {group.map((l) => (
              <div className="pr-item" key={l.id}>
                <b>{l.title}</b>
                {l.lane === "shipped" ? <span>{[l.blurb, shortDate(l.shipped_on)].filter(Boolean).join(" · ")}</span> : l.blurb ? <span>{l.blurb}</span> : null}
              </div>
            ))}
          </section>
        );
      }) : null}
    </div>
  );
}
