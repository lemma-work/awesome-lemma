import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
export declare function cx(...names: (string | false | null | undefined)[]): string;
export declare function Avatar({ name, email, size, you }: {
    name?: string | null;
    email?: string | null;
    size?: number;
    you?: boolean;
}): import("react").JSX.Element;
export declare function Logo({ name, domain, size }: {
    name?: string | null;
    domain?: string | null;
    size?: number;
}): import("react").JSX.Element;
/** The Lemma's face, beside what it did itself. */
export declare function Face({ size }: {
    size?: number;
}): import("react").JSX.Element;
/** The Lemma's own line, with its face. */
export declare function Brief({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
type ButtonProps = {
    children?: ReactNode;
    variant?: "default" | "primary" | "ghost" | "danger";
    size?: "md" | "sm";
    icon?: LucideIcon;
    label?: string;
    busy?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">;
export declare function Button({ children, variant, size, icon: Icon, label, busy, className, ...rest }: ButtonProps): import("react").JSX.Element;
export type Tone = "plain" | "info" | "success" | "warning" | "danger" | "ai";
/** A status with a word. Colour is never the only signal. */
export declare function Pill({ children, tone, icon: Icon, dot, title }: {
    children: ReactNode;
    tone?: Tone;
    icon?: LucideIcon;
    dot?: boolean;
    title?: string;
}): import("react").JSX.Element;
export declare function Spinner(): import("react").JSX.Element;
export declare function Kbd({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
/** An on/off setting. A real checkbox underneath, so keyboards and readers work. */
export declare function Switch({ checked, onChange, label, disabled }: {
    checked: boolean;
    onChange: (value: boolean) => void;
    label: string;
    disabled?: boolean;
}): import("react").JSX.Element;
export declare function Field({ label, hint, children }: {
    label: ReactNode;
    hint?: ReactNode;
    children: ReactNode;
}): import("react").JSX.Element;
/** The sentence something came from, and who said it when. */
export declare function Evidence({ quote, by, at }: {
    quote: string | null | undefined;
    by?: string | null;
    at?: string | null;
}): import("react").JSX.Element | null;
export declare function Rel({ at }: {
    at?: string | null;
}): import("react").JSX.Element | null;
export declare function Money({ amount, currency }: {
    amount?: number | null;
    currency?: string | null;
}): import("react").JSX.Element | null;
/** A button that opens a short list. Opens on press, never on hover; closes on
 *  a pick, Escape, or a press anywhere else. */
export declare function Menu({ label, icon, title, children, align, up, size, variant, }: {
    label?: ReactNode;
    icon?: LucideIcon;
    title?: string;
    children: (close: () => void) => ReactNode;
    align?: "left" | "right";
    up?: boolean;
    size?: "md" | "sm";
    variant?: "default" | "ghost";
}): import("react").JSX.Element;
export declare function MenuItem({ children, hint, onSelect, icon: Icon }: {
    children: ReactNode;
    hint?: ReactNode;
    onSelect: () => void;
    icon?: LucideIcon;
}): import("react").JSX.Element;
export declare function MenuLabel({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
export declare function Header({ icon: Icon, title, count, back, children }: {
    icon?: LucideIcon;
    title?: ReactNode;
    count?: ReactNode;
    back?: {
        label: string;
        icon?: LucideIcon;
        onClick: () => void;
    };
    children?: ReactNode;
}): import("react").JSX.Element;
export declare function Toolbar({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
export declare function Segmented<T extends string>({ items, value, onChange, label }: {
    items: {
        id: T;
        label: string;
        count?: number;
    }[];
    value: T;
    onChange: (id: T) => void;
    label: string;
}): import("react").JSX.Element;
/** Search, focused from anywhere with `/`. */
export declare function SearchField({ value, onChange, placeholder }: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
}): import("react").JSX.Element;
export declare function Card({ title, icon: Icon, count, action, children, foot, flush, id }: {
    title?: ReactNode;
    icon?: LucideIcon;
    count?: number;
    action?: ReactNode;
    children: ReactNode;
    foot?: ReactNode;
    flush?: boolean;
    id?: string;
}): import("react").JSX.Element;
/** What is absent, why, and the next thing to do. */
export declare function Empty({ icon: Icon, title, children, action }: {
    icon?: LucideIcon;
    title: ReactNode;
    children?: ReactNode;
    action?: ReactNode;
}): import("react").JSX.Element;
export declare function Notice({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
/** A line across the top of a page: a sample, an error, a state to know about. */
export declare function Banner({ icon: Icon, children, action, tone }: {
    icon?: LucideIcon;
    children: ReactNode;
    action?: ReactNode;
    tone?: "plain" | "danger";
}): import("react").JSX.Element;
/** Placeholder rows in the shape of what is coming. */
export declare function Skeleton({ rows, kind }: {
    rows?: number;
    kind?: "table" | "list" | "record";
}): import("react").JSX.Element;
/** A drawer from the right edge: editing, detail, settings. */
export declare function Sheet({ open, title, onClose, children, footer }: {
    open: boolean;
    title: ReactNode;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
}): import("react").JSX.Element | null;
/** Light markdown: paragraphs, bullets, headings, **strong**, links. */
export declare function Markdown({ text }: {
    text: string;
}): import("react").JSX.Element;
export interface ToastOptions {
    /** One action beside the words, e.g. Undo. */
    action?: {
        label: string;
        run: () => void;
    };
    ms?: number;
}
type Push = (text: string, options?: ToastOptions) => void;
export declare function Toasts({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
export declare function useToast(): Push;
export {};
