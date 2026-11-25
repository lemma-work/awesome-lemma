// The bar on top of every screen: what this is, the switch between the draft,
// published notes, who asked and settings, and search on `/`.

import type { ReactNode } from "react";
import { Tag } from "lucide-react";
import { SearchField, Segmented } from "@lemma-plugins/kit";
import { useRN } from "./data";
import { to } from "./route";

export type Here = "desk" | "published" | "asked" | "settings";

export function Top({ here, search, onSearch, placeholder }: { here: Here; search?: string; onSearch?: (v: string) => void; placeholder?: string }) {
  const rn = useRN();
  const items: { id: Here; label: string; count?: number }[] = [
    { id: "desk", label: "Draft", count: rn.open ? 1 : 0 },
    { id: "published", label: "Published", count: rn.published.length },
    { id: "asked", label: "Who asked", count: whoAsked(rn) },
    { id: "settings", label: "Settings" },
  ];
  return (
    <header className="rn-top">
      <span className="rn-top__mark" aria-hidden="true"><Tag size={15} /></span>
      <h1 className="rn-top__title">Release notes</h1>
      <Segmented label="Views" items={items} value={here}
        onChange={(id) => (id === "desk" ? to.desk() : id === "published" ? to.published() : id === "asked" ? to.asked() : to.settings())} />
      <span className="c-grow" />
      {onSearch ? <SearchField value={search || ""} onChange={onSearch} placeholder={placeholder || "Search"} /> : null}
    </header>
  );
}

/** People who asked for what is in the note Who asked shows. */
export function whoAsked(rn: ReturnType<typeof useRN>): number {
  const note = focusNote(rn);
  if (!note) return 0;
  const lines = rn.lines.filter((l) => l.note_id === note.id && !l.hidden);
  const refs = new Set(lines.flatMap((l) => [...l.issues, ...l.prs.map((n) => `${note.repo}#${n}`)]));
  return new Set(rn.asks.filter((a) => refs.has(a.work_id) && ["open", "shipped", "told"].includes(a.state)).map((a) => `${a.handle_kind}:${a.handle}`)).size;
}

/** The note Who asked is about: the open one while it has asks, else the newest published. */
export function focusNote(rn: ReturnType<typeof useRN>) {
  const recent = rn.published[0] || null;
  if (rn.open) {
    const lines = rn.lines.filter((l) => l.note_id === rn.open!.id);
    const refs = new Set(lines.flatMap((l) => [...l.issues, ...l.prs.map((n) => `${rn.open!.repo}#${n}`)]));
    if (rn.asks.some((a) => refs.has(a.work_id)) || !recent) return rn.open;
  }
  return recent;
}

export function Bar({ children }: { children: ReactNode }) {
  return <div className="rn-bar">{children}</div>;
}
