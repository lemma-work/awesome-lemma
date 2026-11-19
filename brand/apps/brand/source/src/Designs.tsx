// Designs made in the brand: a launch post, a social image, a banner. Each is
// checked against the brand before anyone sees it. Asking for a new one here
// hands it to this Lemma's assistant (a brand job); asking in chat does the
// same work in the conversation.

import { useState } from "react";
import { CircleAlert, ImagePlus, Loader, MessageCircle, Sparkles } from "lucide-react";
import { AskButton, Button, Empty, Field, Pill, Rel, Segmented, Sheet, go, useToast } from "@lemma-plugins/kit";
import { run, useBrandData, useMe, usePoll } from "./data";
import { Thumb } from "./Preview";
import { KINDS, kindOf, type Brand, type Design, type DesignKind } from "./types";

export function stateWord(d: Design): { word: string; tone: "plain" | "info" | "success" | "warning" | "danger" } {
  switch (d.state) {
    case "making": return { word: "Being made", tone: "info" };
    case "review": return { word: "Waiting for review", tone: "warning" };
    case "off_brand": return { word: "Breaks the brand", tone: "danger" };
    case "approved": return { word: "Approved", tone: "success" };
    case "failed": return { word: "Stopped", tone: "danger" };
    default: return { word: "Put away", tone: "plain" };
  }
}

type Filter = "waiting" | "all" | "approved" | "archived";

export function Designs({ brand, onNew }: { brand: Brand; onNew: () => void }) {
  const { designs } = useBrandData();
  const mine = designs.filter((d) => d.brand_id === brand.id);
  const waiting = mine.filter((d) => d.state === "review" || d.state === "off_brand");
  usePoll(mine.some((d) => d.state === "making"), 5000);
  const [filter, setFilter] = useState<Filter>(waiting.length ? "waiting" : "all");
  const shown = mine.filter((d) => filter === "waiting" ? d.state === "review" || d.state === "off_brand"
    : filter === "approved" ? d.state === "approved" : filter === "archived" ? d.state === "archived" : d.state !== "archived");
  return (
    <main className="c-body">
      <div className="br-designs-head">
        <Segmented label="Which designs" value={filter} onChange={setFilter} items={[
          { id: "waiting", label: "Waiting for you", count: waiting.length },
          { id: "all", label: "All", count: mine.filter((d) => d.state !== "archived").length },
          { id: "approved", label: "Approved", count: mine.filter((d) => d.state === "approved").length },
          { id: "archived", label: "Put away", count: mine.filter((d) => d.state === "archived").length },
        ]} />
        <span className="c-grow" />
        <AskButton label="Ask in chat" text={`Make a social post in our brand about `} />
      </div>
      {shown.length ? (
        <div className="br-grid">
          {shown.map((d) => <DesignCard key={d.id} design={d} />)}
        </div>
      ) : (
        <Empty icon={ImagePlus} title={filter === "waiting" ? "Nothing waiting for you" : "No designs yet"} action={<Button variant="primary" icon={Sparkles} onClick={onNew}>New design</Button>}>
          Ask for a launch post, a social image or a banner. It's made in {brand.name}'s colours, type and voice, and checked against the brand before you see it.
        </Empty>
      )}
    </main>
  );
}

function DesignCard({ design }: { design: Design }) {
  const kind = kindOf(design.kind);
  const s = stateWord(design);
  return (
    <button type="button" className="c-card br-card" onClick={() => go(`/designs/${design.id}`)}>
      {design.version ? (
        <Thumb artifact={design.artifact_path} preview={design.preview_path} width={kind.size[0]} height={kind.size[1]} label={design.title} />
      ) : (
        <div className="br-thumb br-thumb--empty" style={{ aspectRatio: `${kind.size[0]} / ${kind.size[1]}` }}>
          {design.state === "making" ? <Loader size={18} className="br-spin" aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
        </div>
      )}
      <div className="br-card__body">
        <div className="c-ellipsis">{design.title}</div>
        <div className="c-row br-card__meta">
          <Pill tone={s.tone}>{s.word}</Pill>
          <span className="c-faint br-small c-ellipsis">{kind.label}{design.version ? ` · v${design.version}` : ""} · <Rel at={design.updated_at} /></span>
        </div>
        {design.state === "making" && design.activity ? <div className="c-faint br-small c-ellipsis">{design.activity}</div> : null}
      </div>
    </button>
  );
}

export function NewDesign({ open, brand, onClose }: { open: boolean; brand: Brand; onClose: () => void }) {
  const toast = useToast();
  const { reload } = useBrandData();
  const me = useMe();
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<DesignKind>("social_post");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const r = await run<{ design_id?: string }>("brand_design_action", { action: "new", prompt: prompt.trim(), kind, title: title.trim(), by_name: me?.name || "" });
      setPrompt("");
      setTitle("");
      onClose();
      toast("Asked for it. It's checked against the brand before you see it.");
      if (r.design_id) go(`/designs/${r.design_id}`);
      void reload();
    } catch (e) {
      toast(`Couldn't ask for it: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title="New design" onClose={onClose} footer={
      <>
        <Button variant="primary" icon={Sparkles} busy={busy} disabled={!prompt.trim()} onClick={() => void make()}>Make it</Button>
        <Button onClick={onClose}>Cancel</Button>
        <span className="c-grow" />
        <AskButton label="Ask in chat" text={prompt.trim() ? `Make a ${kindOf(kind).label.toLowerCase()} in our brand: ${prompt.trim()}` : "Make a social post in our brand about "} />
      </>
    }>
      <Field label="What is it for?" hint="What it announces, who it's for, any words it must say. The look comes from the brand.">
        <textarea className="c-textarea" style={{ minHeight: 120 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A launch post for our new pricing page, for LinkedIn" autoFocus />
      </Field>
      <Field label="Kind">
        <select className="c-select" value={kind} onChange={(e) => setKind(e.target.value as DesignKind)}>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label} · {k.size[0]}×{k.size[1]}</option>)}
        </select>
      </Field>
      <Field label="Title" hint="Optional: its first line, otherwise.">
        <input className="c-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <p className="c-faint br-small"><MessageCircle size={12} aria-hidden="true" /> In {brand.name}: its colours, type, logo and voice. This Lemma's assistant makes it, checks it against the brand, and fixes what breaks it.</p>
    </Sheet>
  );
}
