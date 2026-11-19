// The pieces every plugin app is built from, in Lemma's own look.
//
// A plugin brings its own marks (a mail client's unread dot, a deal's stage),
// never its own buttons, pills, tables, menus or drawers: those live here, so
// apps installed side by side in one Lemma read as one product.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleCheck, Quote, Search, X, type LucideIcon } from "lucide-react";
import { FACE } from "./face";
import { ago, hue, initials, money } from "./format";

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/* ---------- marks ---------- */

export function Avatar({ name, email, size = 28, you }: { name?: string | null; email?: string | null; size?: number; you?: boolean }) {
  return (
    <span
      className={cx("c-avatar", you && "c-avatar--you")}
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), ["--h" as string]: hue(email || name) }}
    >
      {initials(you ? "You" : name, email)}
    </span>
  );
}

export function Logo({ name, domain, size = 28 }: { name?: string | null; domain?: string | null; size?: number }) {
  const label = (name || domain || "?").trim();
  return (
    <span className="c-logo" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.42), ["--h" as string]: hue(domain || name) }}>
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

/** The Lemma's face, beside what it did itself. */
export function Face({ size = 32 }: { size?: number }) {
  return <img className="c-face" src={FACE} alt="" width={size} height={size} />;
}

/** The Lemma's own line, with its face. */
export function Brief({ children }: { children: ReactNode }) {
  return (
    <div className="c-brief">
      <Face size={36} />
      <p>{children}</p>
    </div>
  );
}

/* ---------- controls ---------- */

type ButtonProps = {
  children?: ReactNode;
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "md" | "sm";
  icon?: LucideIcon;
  label?: string;
  busy?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export function Button({ children, variant = "default", size = "md", icon: Icon, label, busy, className, ...rest }: ButtonProps) {
  const iconOnly = !children && !!Icon;
  return (
    <button
      type="button"
      {...rest}
      aria-label={iconOnly ? label : rest["aria-label"]}
      title={iconOnly ? label : rest.title}
      className={cx("c-btn", variant !== "default" && `c-btn--${variant}`, size === "sm" && "c-btn--sm", iconOnly && "c-btn--icon", className)}
      disabled={busy || rest.disabled}
    >
      {busy ? <Spinner /> : Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export type Tone = "plain" | "info" | "success" | "warning" | "danger" | "ai";

/** A status with a word. Colour is never the only signal. */
export function Pill({ children, tone = "plain", icon: Icon, dot = true, title }: { children: ReactNode; tone?: Tone; icon?: LucideIcon; dot?: boolean; title?: string }) {
  return (
    <span className={cx("c-pill", tone !== "plain" && `c-pill--${tone}`, (!dot || Icon) && "c-pill--plain")} title={title}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function Spinner() {
  return <span className="c-spin" aria-hidden="true" />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="c-kbd">{children}</kbd>;
}

/** An on/off setting. A real checkbox underneath, so keyboards and readers work. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className="c-switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" />
    </span>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="c-field">
      <span>{label}</span>
      {children}
      {hint ? <small className="c-field__hint">{hint}</small> : null}
    </label>
  );
}

/** The sentence something came from, and who said it when. */
export function Evidence({ quote, by, at }: { quote: string | null | undefined; by?: string | null; at?: string | null }) {
  if (!quote) return null;
  return (
    <div className="c-evidence">
      <q>{quote}</q>
      {by || at ? (
        <div className="c-evidence__by">
          <Quote size={11} aria-hidden="true" />
          {by}
          {by && at ? " · " : ""}
          {at ? ago(at) : ""}
        </div>
      ) : null}
    </div>
  );
}

export function Rel({ at }: { at?: string | null }) {
  if (!at) return null;
  return (
    <time className="num" dateTime={at} title={new Date(at).toLocaleString()}>
      {ago(at)}
    </time>
  );
}

export function Money({ amount, currency }: { amount?: number | null; currency?: string | null }) {
  if (amount == null) return null;
  return <span className="num">{money(amount, currency)}</span>;
}

/* ---------- menus ---------- */

/** A button that opens a short list. Opens on press, never on hover; closes on
 *  a pick, Escape, or a press anywhere else. */
export function Menu({
  label,
  icon,
  title,
  children,
  align = "left",
  up,
  size = "sm",
  variant = "default",
}: {
  label?: ReactNode;
  icon?: LucideIcon;
  title?: string;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  up?: boolean;
  size?: "md" | "sm";
  variant?: "default" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="c-menu-wrap" ref={box}>
      <Button size={size} variant={variant} icon={icon} label={title} title={title} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        {label}
      </Button>
      {open ? (
        <div className={cx("c-menu", align === "right" && "c-menu--right", up && "c-menu--up")} role="menu">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({ children, hint, onSelect, icon: Icon }: { children: ReactNode; hint?: ReactNode; onSelect: () => void; icon?: LucideIcon }) {
  return (
    <button type="button" role="menuitem" className="c-menu__item" onClick={onSelect}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span className="c-grow">{children}</span>
      {hint ? <span className="c-faint">{hint}</span> : null}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="c-menu__label">{children}</p>;
}

/* ---------- frame ---------- */

export function Header({ icon: Icon, title, count, back, children }: { icon?: LucideIcon; title?: ReactNode; count?: ReactNode; back?: { label: string; icon?: LucideIcon; onClick: () => void }; children?: ReactNode }) {
  const BackIcon = back?.icon;
  return (
    <header className="c-header">
      {back ? (
        <nav className="c-header__crumb" aria-label="Back">
          <button type="button" onClick={back.onClick}>
            {BackIcon ? <BackIcon size={15} aria-hidden="true" /> : null}
            {back.label}
          </button>
          {title ? <span aria-hidden="true">/</span> : null}
          {title ? <span className="c-ellipsis" style={{ color: "var(--c-text)" }}>{title}</span> : null}
        </nav>
      ) : (
        <>
          {Icon ? (
            <span className="c-header__icon" aria-hidden="true">
              <Icon size={15} />
            </span>
          ) : null}
          <h1 className="c-header__title">{title}</h1>
          {count != null ? <span className="c-header__count">{count}</span> : null}
        </>
      )}
      <div className="c-header__actions">{children}</div>
    </header>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="c-toolbar">{children}</div>;
}

export function Segmented<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="c-seg" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button key={item.id} type="button" role="tab" aria-selected={item.id === value} onClick={() => onChange(item.id)}>
          {item.label}
          {item.count != null ? <span className="c-seg__n">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Search, focused from anywhere with `/`. */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']");
      if (!typing && e.key === "/") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return (
    <label className="c-search">
      <Search size={14} aria-hidden="true" />
      <input ref={input} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value ? (
        <button type="button" className="c-search__clear" onClick={() => onChange("")} aria-label="Clear">
          <X size={13} />
        </button>
      ) : (
        <kbd className="c-kbd">/</kbd>
      )}
    </label>
  );
}

export function Card({ title, icon: Icon, count, action, children, foot, flush, id }: { title?: ReactNode; icon?: LucideIcon; count?: number; action?: ReactNode; children: ReactNode; foot?: ReactNode; flush?: boolean; id?: string }) {
  return (
    <section className="c-card" id={id}>
      {title ? (
        <div className="c-card__head">
          <h2>
            {Icon ? <Icon aria-hidden="true" /> : null}
            {title}
            {count != null ? <span className="c-count">{count}</span> : null}
          </h2>
          <span className="c-grow" />
          {action}
        </div>
      ) : null}
      {flush ? children : <div className="c-card__body">{children}</div>}
      {foot ? <div className="c-card__foot">{foot}</div> : null}
    </section>
  );
}

/** What is absent, why, and the next thing to do. */
export function Empty({ icon: Icon = CircleCheck, title, children, action }: { icon?: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="c-empty">
      <span className="c-empty__icon" aria-hidden="true"><Icon size={18} /></span>
      <p className="c-empty__title">{title}</p>
      {children ? <div className="c-empty__body">{children}</div> : null}
      {action}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="c-notice" role="status">{children}</div>;
}

/** A line across the top of a page: a sample, an error, a state to know about. */
export function Banner({ icon: Icon, children, action, tone = "plain" }: { icon?: LucideIcon; children: ReactNode; action?: ReactNode; tone?: "plain" | "danger" }) {
  return (
    <div className={cx("c-banner", tone === "danger" && "c-banner--danger")} role={tone === "danger" ? "alert" : "status"}>
      {Icon ? <Icon size={16} aria-hidden="true" /> : null}
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Placeholder rows in the shape of what is coming. */
export function Skeleton({ rows = 6, kind = "table" }: { rows?: number; kind?: "table" | "list" | "record" }) {
  if (kind === "record") {
    return (
      <div className="c-body" aria-busy="true">
        <div className="c-row" style={{ gap: 16, padding: "22px 0 18px" }}>
          <div className="c-skel" style={{ width: 56, height: 56, borderRadius: "50%" }} />
          <div className="c-stack" style={{ gap: 8, flex: 1 }}>
            <div className="c-skel" style={{ height: 18, width: 220 }} />
            <div className="c-skel" style={{ height: 12, width: 320, maxWidth: "80%" }} />
          </div>
        </div>
        <div className="c-split c-split--record">
          <div className="c-stack"><div className="c-skel" style={{ height: 140, borderRadius: 12 }} /><div className="c-skel" style={{ height: 220, borderRadius: 12 }} /></div>
          <div className="c-skel" style={{ height: 260, borderRadius: 12 }} />
        </div>
      </div>
    );
  }
  return (
    <div className={kind === "table" ? "c-table-wrap" : "c-list"} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="c-row" style={{ height: 48, padding: "0 14px", borderBottom: "1px solid var(--c-border)", gap: 12 }}>
          <div className="c-skel" style={{ width: 28, height: 28, borderRadius: "50%" }} />
          <div className="c-skel" style={{ height: 12, width: `${30 + ((i * 17) % 30)}%` }} />
          <span className="c-grow" />
          <div className="c-skel c-hide-sm" style={{ height: 12, width: 90 }} />
        </div>
      ))}
    </div>
  );
}

/** A drawer from the right edge: editing, detail, settings. */
export function Sheet({ open, title, onClose, children, footer }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="c-sheet" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
      <button type="button" className="c-sheet__scrim" aria-label="Close" onClick={onClose} />
      <div className="c-sheet__panel">
        <div className="c-sheet__head">
          <h2>{title}</h2>
          <Button variant="ghost" icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="c-sheet__body">{children}</div>
        {footer ? <div className="c-sheet__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Light markdown: paragraphs, bullets, headings, **strong**, links. */
export function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  const inline = (s: string, key: number) => {
    const parts: ReactNode[] = [];
    const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:[^)\s]+)\)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      if (m[1]) parts.push(<strong key={`${key}-${i++}`}>{m[1]}</strong>);
      else parts.push(<a key={`${key}-${i++}`} href={m[3]} target="_blank" rel="noreferrer">{m[2]}</a>);
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  };
  return (
    <div className="c-md">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""), j)}</li>)}</ul>;
        }
        if (/^#{1,4}\s/.test(lines[0])) {
          return (
            <div key={i}>
              <h3>{lines[0].replace(/^#{1,4}\s/, "")}</h3>
              {lines.length > 1 ? <p>{inline(lines.slice(1).join(" "), i)}</p> : null}
            </div>
          );
        }
        return <p key={i}>{inline(lines.join(" "), i)}</p>;
      })}
    </div>
  );
}

/* ---------- toasts ---------- */

export interface ToastOptions {
  /** One action beside the words, e.g. Undo. */
  action?: { label: string; run: () => void };
  ms?: number;
}
type Toast = { id: number; text: string; action?: ToastOptions["action"] };
type Push = (text: string, options?: ToastOptions) => void;
const ToastContext = createContext<Push>(() => undefined);

export function Toasts({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback<Push>((text, options) => {
    if (!text) return;
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { id, text, action: options?.action }]);
    window.setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), options?.ms ?? 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="c-toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className="c-toast">
            <span>{t.text}</span>
            {t.action ? (
              <button
                type="button"
                className="c-toast__action"
                onClick={() => {
                  t.action?.run();
                  setList((l) => l.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Push {
  return useContext(ToastContext);
}
