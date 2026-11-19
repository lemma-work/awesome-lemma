// Yours: the look your new decks take, how long they are, and the sample.

import { useState } from "react";
import { Brain, Check, FlaskConical, Palette, Settings as Cog, SlidersHorizontal } from "lucide-react";
import { Button, Card as KitCard, Segmented, runFunction, update, useToast } from "@lemma-plugins/kit";
import { useDecks } from "./data";
import { brandLook, themeLook } from "./look";
import { Slide } from "./Slide";
import { previewCard } from "./Setup";

export function SettingsPage() {
  const { settings, themes, brand, sample } = useDecks();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  if (!settings) return null;
  const current = settings.look_source === "brand" && brand ? "brand" : settings.theme_id || themes[0]?.id;
  const pickBrand = async () => {
    if (!brand) return;
    setBusy("brand");
    await update("decks_settings", settings.id, { look_source: "brand" });
    setBusy("");
    toast(`New decks take ${brand.name}'s brand.`);
  };
  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try {
      await fn();
      toast(done);
    } catch (e) {
      toast(`That didn't work: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <header className="dk-head"><Cog size={15} className="c-faint" aria-hidden="true" /><h1>Settings</h1></header>
      <div className="dk-pad dk-settings">
        <KitCard title="The look of your new decks" icon={Palette}>
          <p className="c-muted dk-lead">A deck keeps the look it was made with. Change one deck's look from its menu, or by asking.</p>
          <div className="dk-looks dk-looks--settings">
            {brand ? (
              <button type="button" className="dk-minilook" aria-pressed={current === "brand"} disabled={!!busy} onClick={() => void pickBrand()}>
                <Slide card={previewCard(brand.name, "Your brand, from Brand kit")} look={brandLook(brand)} />
                <span>{current === "brand" ? <Check size={12} aria-hidden="true" /> : null}{brand.name} (brand)</span>
              </button>
            ) : null}
            {themes.map((t) => (
              <button key={t.id} type="button" className="dk-minilook" aria-pressed={current === t.id} disabled={!!busy}
                onClick={() => void update("decks_settings", settings.id, { look_source: "theme", theme_id: t.id }).then(() => toast(`New decks take ${t.name}.`))}>
                <Slide card={previewCard(t.name, t.description || "")} look={themeLook(t)} logo={false} />
                <span>{current === t.id ? <Check size={12} aria-hidden="true" /> : null}{t.name}</span>
              </button>
            ))}
          </div>
          {!brand ? <p className="c-faint dk-small">Add Brand kit to this Lemma and your decks can take your own brand: its colours, type, logo and voice.</p> : null}
        </KitCard>

        <KitCard title="Length" icon={SlidersHorizontal}>
          <div className="dk-setrow">
            <span>Cards in a new deck</span>
            <Segmented label="Cards" value={String(settings.card_count || 8)}
              onChange={(v) => void update("decks_settings", settings.id, { card_count: Number(v) })}
              items={["6", "8", "10", "12"].map((n) => ({ id: n, label: n }))} />
          </div>
          <div className="dk-setrow">
            <span>Text on each card</span>
            <Segmented label="Text" value={settings.density || "balanced"}
              onChange={(v) => void update("decks_settings", settings.id, { density: v })}
              items={[{ id: "concise", label: "Short" }, { id: "balanced", label: "Medium" }, { id: "detailed", label: "Full" }]} />
          </div>
        </KitCard>

        <KitCard title="Asking in chat" icon={Brain}>
          <p className="c-muted dk-lead">This Lemma's assistant can start a deck when you ask it in chat (“make a deck about our Q3 results”). It writes the outline; you approve it here.</p>
          <Button size="sm" busy={busy === "memory"} onClick={() => void run("memory", () => runFunction("decks_memory"), "Told this Lemma's agents about Decks.")}>Tell the assistant again</Button>
        </KitCard>

        <KitCard title="Sample" icon={FlaskConical}>
          <p className="c-muted dk-lead">A made-up coffee roaster's pitch deck, with one change already asked for, and an outline waiting for approval.</p>
          {sample ? (
            <Button size="sm" busy={busy === "clear"} onClick={() => void run("clear", () => runFunction("decks_sample_data", { mode: "clear" }), "Removed the sample.")}>Clear the sample</Button>
          ) : (
            <Button size="sm" busy={busy === "load"} onClick={() => void run("load", () => runFunction("decks_sample_data", { mode: "load" }), "Loaded the sample.")}>Load the sample</Button>
          )}
        </KitCard>
      </div>
    </>
  );
}
