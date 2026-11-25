// A short list that opens on press from any trigger (a status circle, an
// avatar), drawn with the kit's menu classes so it is the kit's menu. Closes on
// a pick, Escape, or a press anywhere else.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@lemma-plugins/kit";

export function Pop({
  trigger, label, children, align = "left", className,
}: {
  trigger: ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return (
    <div className={cx("c-menu-wrap", className)} ref={box} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="tk-pop" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        {trigger}
      </button>
      {open ? (
        <div className={cx("c-menu", align === "right" && "c-menu--right")} role="menu">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
