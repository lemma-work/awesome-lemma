import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// The pieces every plugin app is built from, in Lemma's own look.
//
// A plugin brings its own marks (a mail client's unread dot, a deal's stage),
// never its own buttons, pills, tables, menus or drawers: those live here, so
// apps installed side by side in one Lemma read as one product.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CircleCheck, Quote, Search, X } from "lucide-react";
import { FACE } from "./face";
import { ago, hue, initials, money } from "./format";
export function cx(...names) {
    return names.filter(Boolean).join(" ");
}
/* ---------- marks ---------- */
export function Avatar({ name, email, size = 28, you }) {
    return (_jsx("span", { className: cx("c-avatar", you && "c-avatar--you"), "aria-hidden": "true", style: { width: size, height: size, fontSize: Math.round(size * 0.38), ["--h"]: hue(email || name) }, children: initials(you ? "You" : name, email) }));
}
export function Logo({ name, domain, size = 28 }) {
    const label = (name || domain || "?").trim();
    return (_jsx("span", { className: "c-logo", "aria-hidden": "true", style: { width: size, height: size, fontSize: Math.round(size * 0.42), ["--h"]: hue(domain || name) }, children: label.charAt(0).toUpperCase() }));
}
/** The Lemma's face, beside what it did itself. */
export function Face({ size = 32 }) {
    return _jsx("img", { className: "c-face", src: FACE, alt: "", width: size, height: size });
}
/** The Lemma's own line, with its face. */
export function Brief({ children }) {
    return (_jsxs("div", { className: "c-brief", children: [_jsx(Face, { size: 36 }), _jsx("p", { children: children })] }));
}
export function Button({ children, variant = "default", size = "md", icon: Icon, label, busy, className, ...rest }) {
    const iconOnly = !children && !!Icon;
    return (_jsxs("button", { type: "button", ...rest, "aria-label": iconOnly ? label : rest["aria-label"], title: iconOnly ? label : rest.title, className: cx("c-btn", variant !== "default" && `c-btn--${variant}`, size === "sm" && "c-btn--sm", iconOnly && "c-btn--icon", className), disabled: busy || rest.disabled, children: [busy ? _jsx(Spinner, {}) : Icon ? _jsx(Icon, { "aria-hidden": "true" }) : null, children] }));
}
/** A status with a word. Colour is never the only signal. */
export function Pill({ children, tone = "plain", icon: Icon, dot = true, title }) {
    return (_jsxs("span", { className: cx("c-pill", tone !== "plain" && `c-pill--${tone}`, (!dot || Icon) && "c-pill--plain"), title: title, children: [Icon ? _jsx(Icon, { "aria-hidden": "true" }) : null, children] }));
}
export function Spinner() {
    return _jsx("span", { className: "c-spin", "aria-hidden": "true" });
}
export function Kbd({ children }) {
    return _jsx("kbd", { className: "c-kbd", children: children });
}
/** An on/off setting. A real checkbox underneath, so keyboards and readers work. */
export function Switch({ checked, onChange, label, disabled }) {
    return (_jsxs("span", { className: "c-switch", children: [_jsx("input", { type: "checkbox", role: "switch", checked: checked, disabled: disabled, "aria-label": label, onChange: (e) => onChange(e.target.checked) }), _jsx("span", { "aria-hidden": "true" })] }));
}
export function Field({ label, hint, children }) {
    return (_jsxs("label", { className: "c-field", children: [_jsx("span", { children: label }), children, hint ? _jsx("small", { className: "c-field__hint", children: hint }) : null] }));
}
/** The sentence something came from, and who said it when. */
export function Evidence({ quote, by, at }) {
    if (!quote)
        return null;
    return (_jsxs("div", { className: "c-evidence", children: [_jsx("q", { children: quote }), by || at ? (_jsxs("div", { className: "c-evidence__by", children: [_jsx(Quote, { size: 11, "aria-hidden": "true" }), by, by && at ? " · " : "", at ? ago(at) : ""] })) : null] }));
}
export function Rel({ at }) {
    if (!at)
        return null;
    return (_jsx("time", { className: "num", dateTime: at, title: new Date(at).toLocaleString(), children: ago(at) }));
}
export function Money({ amount, currency }) {
    if (amount == null)
        return null;
    return _jsx("span", { className: "num", children: money(amount, currency) });
}
/* ---------- menus ---------- */
/** A button that opens a short list. Opens on press, never on hover; closes on
 *  a pick, Escape, or a press anywhere else. */
export function Menu({ label, icon, title, children, align = "left", up, size = "sm", variant = "default", }) {
    const [open, setOpen] = useState(false);
    const box = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        const away = (e) => {
            if (box.current && !box.current.contains(e.target))
                setOpen(false);
        };
        const key = (e) => e.key === "Escape" && setOpen(false);
        document.addEventListener("mousedown", away);
        window.addEventListener("keydown", key);
        return () => {
            document.removeEventListener("mousedown", away);
            window.removeEventListener("keydown", key);
        };
    }, [open]);
    return (_jsxs("div", { className: "c-menu-wrap", ref: box, children: [_jsx(Button, { size: size, variant: variant, icon: icon, label: title, title: title, "aria-expanded": open, "aria-haspopup": "menu", onClick: () => setOpen((v) => !v), children: label }), open ? (_jsx("div", { className: cx("c-menu", align === "right" && "c-menu--right", up && "c-menu--up"), role: "menu", children: children(() => setOpen(false)) })) : null] }));
}
export function MenuItem({ children, hint, onSelect, icon: Icon }) {
    return (_jsxs("button", { type: "button", role: "menuitem", className: "c-menu__item", onClick: onSelect, children: [Icon ? _jsx(Icon, { "aria-hidden": "true" }) : null, _jsx("span", { className: "c-grow", children: children }), hint ? _jsx("span", { className: "c-faint", children: hint }) : null] }));
}
export function MenuLabel({ children }) {
    return _jsx("p", { className: "c-menu__label", children: children });
}
/* ---------- frame ---------- */
export function Header({ icon: Icon, title, count, back, children }) {
    const BackIcon = back?.icon;
    return (_jsxs("header", { className: "c-header", children: [back ? (_jsxs("nav", { className: "c-header__crumb", "aria-label": "Back", children: [_jsxs("button", { type: "button", onClick: back.onClick, children: [BackIcon ? _jsx(BackIcon, { size: 15, "aria-hidden": "true" }) : null, back.label] }), title ? _jsx("span", { "aria-hidden": "true", children: "/" }) : null, title ? _jsx("span", { className: "c-ellipsis", style: { color: "var(--c-text)" }, children: title }) : null] })) : (_jsxs(_Fragment, { children: [Icon ? (_jsx("span", { className: "c-header__icon", "aria-hidden": "true", children: _jsx(Icon, { size: 15 }) })) : null, _jsx("h1", { className: "c-header__title", children: title }), count != null ? _jsx("span", { className: "c-header__count", children: count }) : null] })), _jsx("div", { className: "c-header__actions", children: children })] }));
}
export function Toolbar({ children }) {
    return _jsx("div", { className: "c-toolbar", children: children });
}
export function Segmented({ items, value, onChange, label }) {
    return (_jsx("div", { className: "c-seg", role: "tablist", "aria-label": label, children: items.map((item) => (_jsxs("button", { type: "button", role: "tab", "aria-selected": item.id === value, onClick: () => onChange(item.id), children: [item.label, item.count != null ? _jsx("span", { className: "c-seg__n", children: item.count }) : null] }, item.id))) }));
}
/** Search, focused from anywhere with `/`. */
export function SearchField({ value, onChange, placeholder }) {
    const input = useRef(null);
    useEffect(() => {
        const on = (e) => {
            const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']");
            if (!typing && e.key === "/") {
                e.preventDefault();
                input.current?.focus();
            }
        };
        window.addEventListener("keydown", on);
        return () => window.removeEventListener("keydown", on);
    }, []);
    return (_jsxs("label", { className: "c-search", children: [_jsx(Search, { size: 14, "aria-hidden": "true" }), _jsx("input", { ref: input, value: value, onChange: (e) => onChange(e.target.value), placeholder: placeholder, "aria-label": placeholder }), value ? (_jsx("button", { type: "button", className: "c-search__clear", onClick: () => onChange(""), "aria-label": "Clear", children: _jsx(X, { size: 13 }) })) : (_jsx("kbd", { className: "c-kbd", children: "/" }))] }));
}
export function Card({ title, icon: Icon, count, action, children, foot, flush, id }) {
    return (_jsxs("section", { className: "c-card", id: id, children: [title ? (_jsxs("div", { className: "c-card__head", children: [_jsxs("h2", { children: [Icon ? _jsx(Icon, { "aria-hidden": "true" }) : null, title, count != null ? _jsx("span", { className: "c-count", children: count }) : null] }), _jsx("span", { className: "c-grow" }), action] })) : null, flush ? children : _jsx("div", { className: "c-card__body", children: children }), foot ? _jsx("div", { className: "c-card__foot", children: foot }) : null] }));
}
/** What is absent, why, and the next thing to do. */
export function Empty({ icon: Icon = CircleCheck, title, children, action }) {
    return (_jsxs("div", { className: "c-empty", children: [_jsx("span", { className: "c-empty__icon", "aria-hidden": "true", children: _jsx(Icon, { size: 18 }) }), _jsx("p", { className: "c-empty__title", children: title }), children ? _jsx("div", { className: "c-empty__body", children: children }) : null, action] }));
}
export function Notice({ children }) {
    return _jsx("div", { className: "c-notice", role: "status", children: children });
}
/** A line across the top of a page: a sample, an error, a state to know about. */
export function Banner({ icon: Icon, children, action, tone = "plain" }) {
    return (_jsxs("div", { className: cx("c-banner", tone === "danger" && "c-banner--danger"), role: tone === "danger" ? "alert" : "status", children: [Icon ? _jsx(Icon, { size: 16, "aria-hidden": "true" }) : null, _jsx("p", { children: children }), action] }));
}
/** Placeholder rows in the shape of what is coming. */
export function Skeleton({ rows = 6, kind = "table" }) {
    if (kind === "record") {
        return (_jsxs("div", { className: "c-body", "aria-busy": "true", children: [_jsxs("div", { className: "c-row", style: { gap: 16, padding: "22px 0 18px" }, children: [_jsx("div", { className: "c-skel", style: { width: 56, height: 56, borderRadius: "50%" } }), _jsxs("div", { className: "c-stack", style: { gap: 8, flex: 1 }, children: [_jsx("div", { className: "c-skel", style: { height: 18, width: 220 } }), _jsx("div", { className: "c-skel", style: { height: 12, width: 320, maxWidth: "80%" } })] })] }), _jsxs("div", { className: "c-split c-split--record", children: [_jsxs("div", { className: "c-stack", children: [_jsx("div", { className: "c-skel", style: { height: 140, borderRadius: 12 } }), _jsx("div", { className: "c-skel", style: { height: 220, borderRadius: 12 } })] }), _jsx("div", { className: "c-skel", style: { height: 260, borderRadius: 12 } })] })] }));
    }
    return (_jsx("div", { className: kind === "table" ? "c-table-wrap" : "c-list", "aria-busy": "true", children: Array.from({ length: rows }).map((_, i) => (_jsxs("div", { className: "c-row", style: { height: 48, padding: "0 14px", borderBottom: "1px solid var(--c-border)", gap: 12 }, children: [_jsx("div", { className: "c-skel", style: { width: 28, height: 28, borderRadius: "50%" } }), _jsx("div", { className: "c-skel", style: { height: 12, width: `${30 + ((i * 17) % 30)}%` } }), _jsx("span", { className: "c-grow" }), _jsx("div", { className: "c-skel c-hide-sm", style: { height: 12, width: 90 } })] }, i))) }));
}
/** A drawer from the right edge: editing, detail, settings. */
export function Sheet({ open, title, onClose, children, footer }) {
    useEffect(() => {
        if (!open)
            return;
        const on = (e) => e.key === "Escape" && onClose();
        window.addEventListener("keydown", on);
        return () => window.removeEventListener("keydown", on);
    }, [open, onClose]);
    if (!open)
        return null;
    return (_jsxs("div", { className: "c-sheet", role: "dialog", "aria-modal": "true", "aria-label": typeof title === "string" ? title : undefined, children: [_jsx("button", { type: "button", className: "c-sheet__scrim", "aria-label": "Close", onClick: onClose }), _jsxs("div", { className: "c-sheet__panel", children: [_jsxs("div", { className: "c-sheet__head", children: [_jsx("h2", { children: title }), _jsx(Button, { variant: "ghost", icon: X, label: "Close", onClick: onClose })] }), _jsx("div", { className: "c-sheet__body", children: children }), footer ? _jsx("div", { className: "c-sheet__foot", children: footer }) : null] })] }));
}
/** Light markdown: paragraphs, bullets, headings, **strong**, links. */
export function Markdown({ text }) {
    const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
    const inline = (s, key) => {
        const parts = [];
        const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:[^)\s]+)\)/g;
        let last = 0;
        let m;
        let i = 0;
        while ((m = re.exec(s))) {
            if (m.index > last)
                parts.push(s.slice(last, m.index));
            if (m[1])
                parts.push(_jsx("strong", { children: m[1] }, `${key}-${i++}`));
            else
                parts.push(_jsx("a", { href: m[3], target: "_blank", rel: "noreferrer", children: m[2] }, `${key}-${i++}`));
            last = m.index + m[0].length;
        }
        if (last < s.length)
            parts.push(s.slice(last));
        return parts;
    };
    return (_jsx("div", { className: "c-md", children: blocks.map((block, i) => {
            const lines = block.split("\n");
            if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
                return _jsx("ul", { children: lines.map((l, j) => _jsx("li", { children: inline(l.replace(/^\s*[-*•]\s+/, ""), j) }, j)) }, i);
            }
            if (/^#{1,4}\s/.test(lines[0])) {
                return (_jsxs("div", { children: [_jsx("h3", { children: lines[0].replace(/^#{1,4}\s/, "") }), lines.length > 1 ? _jsx("p", { children: inline(lines.slice(1).join(" "), i) }) : null] }, i));
            }
            return _jsx("p", { children: inline(lines.join(" "), i) }, i);
        }) }));
}
const ToastContext = createContext(() => undefined);
export function Toasts({ children }) {
    const [list, setList] = useState([]);
    const push = useCallback((text, options) => {
        if (!text)
            return;
        const id = Date.now() + Math.random();
        setList((l) => [...l.slice(-2), { id, text, action: options?.action }]);
        window.setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), options?.ms ?? 4200);
    }, []);
    return (_jsxs(ToastContext.Provider, { value: push, children: [children, _jsx("div", { className: "c-toasts", role: "status", "aria-live": "polite", children: list.map((t) => (_jsxs("div", { className: "c-toast", children: [_jsx("span", { children: t.text }), t.action ? (_jsx("button", { type: "button", className: "c-toast__action", onClick: () => {
                                t.action?.run();
                                setList((l) => l.filter((x) => x.id !== t.id));
                            }, children: t.action.label })) : null] }, t.id))) })] }));
}
export function useToast() {
    return useContext(ToastContext);
}
