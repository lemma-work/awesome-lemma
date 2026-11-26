// A feature named by hand: User feedback names most of them from what people
// say, but a team can add one (and Roadmap installed alone needs it).

import { useState } from "react";
import { Button, Field, Sheet, useToast } from "@lemma-plugins/kit";
import { newFeature, useRoadmap } from "./data";

export function NewFeature({ open, onClose, onMade }: { open: boolean; onClose: () => void; onMade: (id: string) => void }) {
  const data = useRoadmap();
  const toast = useToast();
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const areas = [...data.byId.values()].filter((f) => f.state === "active" && !f.parent_id).sort((a, b) => a.name.localeCompare(b.name));
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const made = await newFeature(name, data.settings, data.products, parent || null);
      toast(`Added ${name.trim()}.`);
      setName("");
      await data.reload("features");
      onMade(made.id);
    } catch (e) {
      toast(`Couldn't add it: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title="New feature" onClose={onClose}
      footer={<><Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => void save()}>Add feature</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <Field label="Name" hint="The team's word for it, not a customer's phrasing: “CSV export keeps filters”.">
        <input className="c-input" value={name} autoFocus maxLength={120} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
      </Field>
      <Field label="Part of" hint="Optional: the area it belongs to.">
        <select className="c-select" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">Nothing</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
    </Sheet>
  );
}
