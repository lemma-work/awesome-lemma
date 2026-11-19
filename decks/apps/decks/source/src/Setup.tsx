// Set-up, one person at a time: the `decks-setup` workflow keeps the answers
// and waits on two forms; this is the screen for them.
//
//   1  look   the Lemma's brand (when Brand kit is here) or a theme
//   2  first  a first deck from a sentence, or the sample
//
// The run's id is on the person's settings, so a reload lands where they were.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Palette, Presentation, Sparkles } from "lucide-react";
import { Button, Face, Spinner, client, cx, update, useToast } from "@lemma-plugins/kit";
import { Composer } from "./Composer";
import { useDecks } from "./data";
import { brandLook, themeLook } from "./look";
import { Slide } from "./Slide";
import type { Card, Look } from "./types";

type Run = { id: string; status?: string; active_wait?: { node_id?: string } | null; step_history?: { node_id: string; output_data?: Record<string, unknown> | null }[] };

/** Where Decks opens once set-up is done: the first deck, or the sample. Read once. */
let openAfterSetup: string | null = null;
export function takeOpenAfterSetup(): string | null {
  const id = openAfterSetup;
  openAfterSetup = null;
  return id;
}

export function previewCard(title: string, sub: string): Card {
  return {
    id: "preview", deck_id: "preview", position: 1, title, outline: sub, layout: "hero",
    blocks: [{ type: "text", text: sub }], notes: null, status: "ready", version: 1, edit_id: null, created_at: "", updated_at: "",
  };
}

export function Setup() {
  const { settings, reload, themes, brand } = useDecks();
  const toast = useToast();
  const [run, setRun] = useState<Run | null>(null);
  const [lost, setLost] = useState(false);
  const runId = settings?.setup_run_id || null;

  const poll = useCallback(async () => {
    if (!runId) return;
    try {
      const fresh = (await client.workflows.runs.get(runId)) as unknown as Run;
      setRun(fresh);
      setLost(false);
      if (fresh.status === "COMPLETED") {
        const made = fresh.step_history?.find((s) => s.node_id === "make" || s.node_id === "sample")?.output_data;
        openAfterSetup = (made?.deck_id as string) || null;
        void reload();
      }
    } catch {
      setLost(true);
    }
  }, [runId, reload]);

  useEffect(() => {
    if (!runId) return;
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => window.clearInterval(timer);
  }, [runId, poll]);

  const submit = async (node: string, inputs: Record<string, unknown>) => {
    if (!run) return;
    await client.workflows.runs.submitForm(run.id, { node_id: node, inputs } as never);
    await poll();
  };

  const restart = async () => {
    if (!settings) return;
    const fresh = (await client.workflows.runs.create("decks-setup")) as unknown as Run;
    await update("decks_settings", settings.id, { setup_run_id: fresh.id, setup_step: "start" });
    setRun(null);
    await reload("settings");
  };

  const failed = !!run && ["FAILED", "CANCELLED"].includes(String(run.status));
  const waiting = run?.status === "WAITING" ? run.active_wait?.node_id : null;
  const steps = ["Your decks' look", "Your first deck"];
  const here = waiting === "look" ? 0 : waiting === "first" ? 1 : run && (run.step_history || []).some((s) => s.node_id === "first") ? 2 : 0;

  let body;
  if (!runId || lost || failed) {
    body = (
      <>
        <h1>{failed ? "The set-up stopped partway" : "Set up Decks"}</h1>
        <p className="c-setup__lead">{failed ? "Start it again; nothing you have is lost." : "Your set-up wasn't found. Start it again."}</p>
        <div className="c-setup__row"><Button variant="primary" onClick={() => void restart().catch((e) => toast(String(e)))}>Start the set-up</Button></div>
      </>
    );
  } else if (!run || (waiting !== "look" && waiting !== "first" && here < 2)) {
    body = <p className="c-muted c-row"><Spinner /> One moment…</p>;
  } else if (waiting === "look") {
    body = <LookStep onSubmit={(inputs) => submit("look", inputs)} themes={themes} brand={brand} />;
  } else if (waiting === "first") {
    body = (
      <>
        <Face size={44} />
        <h1>Make your first deck</h1>
        <p className="c-setup__lead">One sentence: what it's for and who it's for. You'll see the outline first and approve it; then the cards are written one by one.</p>
        <div className="dk-setup-composer">
          <Composer
            autoFocus
            submitLabel="Write the outline"
            onSubmit={async ({ prompt }) => submit("first", { prompt, sample: false })}
          />
        </div>
        <div className="dk-or">or</div>
        <SampleButton onLoad={() => submit("first", { sample: true })} />
      </>
    );
  } else {
    body = (
      <>
        <Face size={44} />
        <h1>Getting Decks ready</h1>
        <p className="c-setup__lead">Keeping your choices and starting your deck. A few seconds.</p>
        <p className="c-muted c-row dk-gap"><Spinner /> {run.status === "COMPLETED" ? "Opening…" : "Working…"}</p>
      </>
    );
  }

  return (
    <div className="c-app">
      <div className="c-setup dk-setup">
        <ol className="dk-rail" aria-label="Set-up steps">
          {steps.map((label, i) => (
            <li key={label} className={i < here ? "is-done" : i === here ? "is-here" : ""} aria-current={i === here ? "step" : undefined}>
              <span className="dk-rail__dot">{i < here ? <Check size={11} aria-hidden="true" /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        {body}
      </div>
    </div>
  );
}

function SampleButton({ onLoad }: { onLoad: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button type="button" className="dk-sample" disabled={busy} onClick={() => {
      setBusy(true);
      void onLoad().catch((e) => { toast(`Couldn't load the sample: ${e instanceof Error ? e.message : e}`); setBusy(false); });
    }}>
      <span className="dk-sample__icon">{busy ? <Spinner /> : <Presentation size={16} aria-hidden="true" />}</span>
      <span>
        <span className="dk-choice__title">Look around with a sample deck</span>
        <span className="dk-choice__sub">A made-up coffee roaster's pitch, with one change already asked for, and an outline waiting for approval. Clear it any time.</span>
      </span>
    </button>
  );
}

function LookStep({ onSubmit, themes, brand }: { onSubmit: (inputs: Record<string, unknown>) => Promise<void>; themes: ReturnType<typeof useDecks>["themes"]; brand: ReturnType<typeof useDecks>["brand"] }) {
  const toast = useToast();
  const fromBrand = useMemo(() => (brand ? brandLook(brand) : null), [brand]);
  const [pick, setPick] = useState<string>(fromBrand ? "brand" : themes[0]?.id || "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!pick && themes[0]) setPick(fromBrand ? "brand" : themes[0].id);
  }, [themes, fromBrand, pick]);
  const go = async () => {
    setBusy(true);
    try {
      if (pick === "brand" && brand && fromBrand) {
        await onSubmit({ source: "brand" });
      } else {
        await onSubmit({ source: "theme", theme_id: pick });
      }
    } catch (e) {
      toast(`Couldn't go on: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };
  const option = (id: string, look: Look, title: string, sub: string) => (
    <label key={id} className={cx("dk-look", pick === id && "is-on")}>
      <input type="radio" name="look" className="c-sr" aria-label={title} checked={pick === id} onChange={() => setPick(id)} />
      <Slide card={previewCard(title, sub)} look={look} />
      <span className="dk-look__name">
        {pick === id ? <Check size={13} aria-hidden="true" /> : null}
        {title}
      </span>
    </label>
  );
  return (
    <>
      <Face size={44} />
      <h1>How should your decks look?</h1>
      <p className="c-setup__lead">
        {fromBrand
          ? `This Lemma has a brand: ${brand?.name}. Decks can take its colours, type, logo and the way it talks, or one of four themes.`
          : "Pick a look for your decks. You can change any deck's look later by asking."}
      </p>
      {fromBrand ? (
        <div className="dk-looks dk-looks--brand">{option("brand", fromBrand, brand?.name || "Your brand", "Colours, type, logo and voice from Brand kit")}</div>
      ) : null}
      {fromBrand ? <p className="dk-looks__label"><Palette size={13} aria-hidden="true" /> Or a theme</p> : null}
      <div className="dk-looks">
        {themes.map((t) => option(t.id, themeLook(t), t.name, t.description || ""))}
        {!themes.length ? <p className="c-muted c-row"><Spinner /> Getting the themes…</p> : null}
      </div>
      {!fromBrand ? (
        <p className="c-setup__note"><Sparkles size={13} aria-hidden="true" /> With Brand kit in this Lemma, decks take your own brand: its colours, type, logo and voice.</p>
      ) : null}
      <div className="c-setup__row">
        <Button variant="primary" busy={busy} disabled={!pick} onClick={() => void go()}>Continue</Button>
      </div>
    </>
  );
}
