// The bar on top of every screen: what this is, the three views, search on
// `/` (behind a button on a phone), Add a note, and settings.

import { useState, type ReactNode } from "react";
import { MessageSquare, Plus, Search, Settings } from "lucide-react";
import { Button, SearchField, Segmented } from "@lemma-plugins/kit";
import { to } from "./route";
import { useNarrow } from "./data";

export type View = "inbox" | "features" | "week";

export function Top({ here, search, onSearch, onNote, extra, placeholder = "Search quotes" }: {
  here: View | null; search?: string; onSearch?: (v: string) => void; onNote?: () => void; extra?: ReactNode; placeholder?: string;
}) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  return (
    <header className="uf-top">
      <div className="uf-top__row">
        <span className="uf-top__mark" aria-hidden="true"><MessageSquare size={15} /></span>
        <h1 className="uf-top__title">Feedback</h1>
        {!narrow ? <Views here={here} /> : null}
        <span className="c-grow" />
        {extra}
        {onSearch && !narrow ? <SearchField value={search || ""} onChange={onSearch} placeholder={placeholder} /> : null}
        {onSearch && narrow ? <Button variant="ghost" icon={Search} label="Search" aria-pressed={open} onClick={() => { setOpen(!open); if (open) onSearch(""); }} /> : null}
        {onNote ? (narrow ? <Button variant="ghost" icon={Plus} label="Add a note" onClick={onNote} /> : <Button icon={Plus} onClick={onNote}>Add a note</Button>) : null}
        <Button variant="ghost" icon={Settings} label="Settings" onClick={() => to.settings()} />
      </div>
      {narrow ? <div className="uf-top__row uf-top__row--views"><Views here={here} /></div> : null}
      {narrow && open && onSearch ? <div className="uf-top__row"><SearchField value={search || ""} onChange={onSearch} placeholder={placeholder} /></div> : null}
    </header>
  );
}

function Views({ here }: { here: View | null }) {
  return (
    <Segmented<View> label="Views" value={here || ("" as View)}
      items={[{ id: "inbox", label: "Inbox" }, { id: "features", label: "Features" }, { id: "week", label: "This week" }]}
      onChange={(id) => (id === "inbox" ? to.inbox() : id === "features" ? to.features() : to.week())} />
  );
}
