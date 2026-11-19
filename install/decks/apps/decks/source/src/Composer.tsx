// One sentence in: what the deck is for and who it is for. Notes and files
// are optional and go into the outline and every card's brief.

import { useRef, useState } from "react";
import { FileText, Paperclip, Sparkles, X } from "lucide-react";
import { Button, Kbd, Segmented, useToast } from "@lemma-plugins/kit";
import type { Theme } from "./types";

const EXAMPLES = [
  "A pitch to office managers for our coffee plan, with pricing and a free trial",
  "Our quarterly update for the board: what shipped, what slipped, what's next",
  "A 10-minute talk for new joiners on how we run projects",
];

export interface ComposerValue {
  prompt: string;
  notes: string;
  files: File[];
  card_count: number;
  density: string;
  theme: string;
}

export function Composer({
  onSubmit, submitLabel = "Write the outline", full, autoFocus, themes, defaultTheme, brandName,
}: {
  onSubmit: (value: ComposerValue) => Promise<void>;
  submitLabel?: string;
  full?: boolean;
  autoFocus?: boolean;
  themes?: Theme[];
  defaultTheme?: string;
  brandName?: string | null;
}) {
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [more, setMore] = useState(false);
  const [count, setCount] = useState("8");
  const [density, setDensity] = useState("balanced");
  const [theme, setTheme] = useState(defaultTheme || "");
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const go = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onSubmit({ prompt: text, notes, files, card_count: Number(count), density, theme });
      setPrompt("");
      setNotes("");
      setFiles([]);
      setMore(false);
    } catch (e) {
      toast(`Couldn't start the deck: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dk-composer">
      <label className="c-sr" htmlFor="dk-prompt">What's the deck for?</label>
      <textarea
        id="dk-prompt"
        className="dk-composer__input"
        autoFocus={autoFocus}
        rows={full ? 2 : 3}
        placeholder="What's the deck for, and who's it for? One sentence is enough."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void go();
          }
        }}
      />
      {!prompt ? (
        <div className="dk-examples" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="dk-example" onClick={() => setPrompt(ex)}>{ex}</button>
          ))}
        </div>
      ) : null}
      {more ? (
        <div className="dk-composer__more">
          <label className="c-field">
            <span>Notes (optional): figures, names, what to stress</span>
            <textarea className="c-textarea dk-notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Pricing is £6 a person a month. Stress the free trial." />
          </label>
          <div className="dk-files">
            {files.map((f) => (
              <span key={f.name} className="dk-file">
                <FileText size={13} aria-hidden="true" />
                <span className="c-ellipsis">{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}><X size={12} /></button>
              </span>
            ))}
            <input ref={picker} type="file" multiple hidden accept=".pdf,.docx,.doc,.md,.txt,.pptx,.csv,.xlsx"
              onChange={(e) => setFiles([...files, ...Array.from(e.target.files || [])].slice(0, 6))} />
            <Button size="sm" icon={Paperclip} onClick={() => picker.current?.click()}>Add files</Button>
            <span className="c-faint dk-files__hint">A brief, last quarter's numbers, a doc to turn into slides.</span>
          </div>
        </div>
      ) : null}
      <div className="dk-composer__bar">
        {full ? (
          <>
            <Segmented label="Cards" value={count} onChange={setCount}
              items={["6", "8", "10", "12"].map((n) => ({ id: n, label: `${n} cards` }))} />
            <Segmented label="Text" value={density} onChange={setDensity}
              items={[{ id: "concise", label: "Short" }, { id: "balanced", label: "Medium" }, { id: "detailed", label: "Full" }]} />
            {themes?.length ? (
              <select className="c-select dk-theme-select" aria-label="Look" value={theme} onChange={(e) => setTheme(e.target.value)}>
                {brandName ? <option value="">{brandName} (your brand)</option> : <option value="">Your usual look</option>}
                {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : null}
            {!more ? <Button size="sm" variant="ghost" icon={Paperclip} onClick={() => setMore(true)}>Notes or files</Button> : null}
          </>
        ) : null}
        <span className="c-grow" />
        <span className="dk-hint c-hide-sm"><Kbd>⌘</Kbd><Kbd>↵</Kbd></span>
        <Button variant="primary" icon={Sparkles} busy={busy} disabled={!prompt.trim()} onClick={() => void go()}>{submitLabel}</Button>
      </div>
    </div>
  );
}
