// One card drawn as a 16:9 slide in the deck's look. Every size is in
// container-query units, so the same slide is a filmstrip thumbnail, the
// editor's canvas, present mode and a printed page. Copied from the Decks
// desk app (agentic-presentations-desk, src/features/decks/card-renderer.tsx)
// and moved onto Decks' content model: blocks are a list, every bullet an
// object, and a hero or closing card carries the brand's logo.

import { memo, type CSSProperties } from "react";
import {
  AlertTriangle, BarChart3, Battery, Brain, Calendar, CheckCircle2, Clock, Code2, Coffee, Database, DollarSign, Eye, Flag,
  Globe, Heart, Home, Layers, Lightbulb, Link2, Lock, MapPin, MessageCircle, Moon, Package, PieChart, Repeat, Rocket,
  Search, Send, Settings, Shield, Smile, Sparkles, Star, Sun, Target, ThumbsUp, TrendingDown, TrendingUp, Users, Wrench,
  XCircle, Zap, type LucideIcon,
} from "lucide-react";
import { lookOf, lookVars, useFileUrl } from "./look";
import type { Block, Card, Look } from "./types";

/** The icon names the writer may use (decks-writer's instruction lists the same). */
export const ICONS: Record<string, LucideIcon> = {
  "alert-triangle": AlertTriangle, "bar-chart": BarChart3, battery: Battery, brain: Brain, calendar: Calendar,
  "check-circle": CheckCircle2, clock: Clock, code: Code2, coffee: Coffee, database: Database, "dollar-sign": DollarSign,
  eye: Eye, flag: Flag, globe: Globe, heart: Heart, home: Home, layers: Layers, lightbulb: Lightbulb, link: Link2,
  lock: Lock, "map-pin": MapPin, "message-circle": MessageCircle, moon: Moon, package: Package, "pie-chart": PieChart,
  repeat: Repeat, rocket: Rocket, search: Search, send: Send, settings: Settings, shield: Shield, smile: Smile,
  sparkles: Sparkles, star: Star, sun: Sun, target: Target, "thumbs-up": ThumbsUp, "trending-down": TrendingDown,
  "trending-up": TrendingUp, users: Users, wrench: Wrench, "x-circle": XCircle, zap: Zap,
};

export function iconOf(name: string | null | undefined): LucideIcon | null {
  return name ? ICONS[name.toLowerCase()] ?? null : null;
}

/** **bold** in block text. */
export function strong(text: string) {
  const parts = String(text || "").split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>));
}

export function plain(text: string): string {
  return String(text || "").replace(/\*\*(.+?)\*\*/g, "$1");
}

/** A deterministic decorative panel for a `visual` block, from the look. */
export function visualStyle(look: Look, seed: number): CSSProperties {
  const angle = (seed * 47) % 360;
  return {
    background: `radial-gradient(120% 120% at ${20 + ((seed * 13) % 60)}% 0%, color-mix(in srgb, ${look.accent} 42%, transparent) 0%, transparent 58%),
      radial-gradient(90% 100% at 85% 100%, color-mix(in srgb, ${look.accent} 22%, transparent) 0%, transparent 62%),
      linear-gradient(${angle}deg, ${look.raised}, ${look.surface})`,
  };
}

function BlockView({ block, look, seed }: { block: Block; look: Look; seed: number }) {
  switch (block.type) {
    case "heading":
      return <h3 className="sl-heading">{strong(block.text)}</h3>;
    case "text":
      return <p className="sl-text">{strong(block.text)}</p>;
    case "bullets": {
      const iconed = block.items.every((i) => iconOf(i.icon));
      return (
        <ul className="sl-bullets" data-icons={iconed}>
          {block.items.map((item, i) => {
            const Icon = iconed ? iconOf(item.icon) : null;
            return (
              <li key={i}>
                {Icon ? <span className="sl-bullet-icon"><Icon aria-hidden="true" /></span> : null}
                <span>{strong(item.text)}</span>
              </li>
            );
          })}
        </ul>
      );
    }
    case "quote":
      return (
        <blockquote className="sl-quote">
          <p>“{block.text}”</p>
          {block.attribution ? <cite>{block.attribution}</cite> : null}
        </blockquote>
      );
    case "stats":
      return (
        <div className="sl-stats" data-count={block.items.length}>
          {block.items.map((s, i) => {
            const Icon = iconOf(s.icon);
            return (
              <div key={i} className="sl-stat">
                {Icon ? <span className="sl-stat-icon"><Icon aria-hidden="true" /></span> : null}
                <span className="sl-stat-value">{s.value}</span>
                <span className="sl-stat-label">{s.label}</span>
              </div>
            );
          })}
        </div>
      );
    case "columns":
      return (
        <div className="sl-columns" data-count={block.columns.length}>
          {block.columns.map((c, i) => {
            const Icon = iconOf(c.icon);
            return (
              <div key={i} className="sl-column">
                <h4>{Icon ? <span className="sl-column-icon"><Icon aria-hidden="true" /></span> : null}{c.heading}</h4>
                <p>{strong(c.body)}</p>
              </div>
            );
          })}
        </div>
      );
    case "visual":
      return <div className="sl-visual" style={visualStyle(look, seed)} role="img" aria-label={block.hint} />;
    default:
      return null;
  }
}

function SlideInner({ card, look: raw, className, logo = true }: { card: Card; look: Partial<Look> | null; className?: string; logo?: boolean }) {
  const look = lookOf(raw);
  const blocks = card.blocks || [];
  const seed = card.position * 7 + (card.title?.length ?? 0);
  const layout = card.layout || "prose";
  const big = layout === "hero" || layout === "closing";
  const visuals = blocks.filter((b) => b.type === "visual");
  const content = blocks.filter((b) => b.type !== "visual");
  const split = (layout === "visual-left" || layout === "visual-right") && visuals.length > 0;
  const logoUrl = useFileUrl(logo && big ? look.logo_path : null);
  const closingHeading = (content.find((b) => b.type === "heading") as { text: string } | undefined)?.text;
  // The closing card states its takeaway as a heading; its title is the label above.
  return (
    <article className={["sl", className].filter(Boolean).join(" ")} data-layout={layout} style={lookVars(look)} aria-label={`Card ${card.position}: ${card.title || ""}`}>
      {big ? (
        <div className="sl-hero">
          <div className="sl-glow" style={{ background: `radial-gradient(80% 110% at ${62 + ((seed * 13) % 30)}% 0%, color-mix(in srgb, ${look.accent} 26%, transparent) 0%, transparent 58%)` }} />
          {logoUrl ? <img className="sl-logo" src={logoUrl} alt="" /> : null}
          {layout === "closing" && closingHeading ? (
            same(closingHeading, card.title) ? null : <p className="sl-kicker">{card.title}</p>
          ) : <h2 className="sl-title">{card.title}</h2>}
          {content.map((b, i) => <BlockView key={i} block={b} look={look} seed={seed + i} />)}
          <span className="sl-rule" />
        </div>
      ) : split ? (
        <div className="sl-split">
          <div className="sl-split-content">
            <h2 className="sl-title">{card.title}</h2>
            {content.map((b, i) => <BlockView key={i} block={b} look={look} seed={seed + i} />)}
          </div>
          <div className="sl-split-visual">
            {visuals.map((b, i) => <BlockView key={i} block={b} look={look} seed={seed + i + 3} />)}
          </div>
        </div>
      ) : (
        <div className="sl-body">
          <h2 className="sl-title">{card.title}</h2>
          {blocks.map((b, i) => <BlockView key={i} block={b} look={look} seed={seed + i} />)}
        </div>
      )}
    </article>
  );
}

/** The same words, whatever the case and punctuation. */
export function same(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (t: string | null | undefined) => plain(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return !!a && norm(a) === norm(b);
}

export const Slide = memo(SlideInner);

/** A card not written yet: its outline, in the slide's geometry. */
export function SlideSkeleton({ card, look, writing }: { card: Card; look: Partial<Look> | null; writing?: boolean }) {
  return (
    <article className="sl sl--pending" style={lookVars(look)} aria-busy={writing ? "true" : undefined} aria-label={`Card ${card.position}: ${card.title || ""}, ${writing ? "being written" : "not written"}`}>
      <div className="sl-body">
        <h2 className="sl-title">{card.title}</h2>
        <p className="sl-text sl-faded">{card.outline}</p>
        <div className="sl-lines" aria-hidden="true"><i /><i /><i /></div>
      </div>
    </article>
  );
}
