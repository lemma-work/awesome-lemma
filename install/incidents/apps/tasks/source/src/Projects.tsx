// A new team project, in a drawer. Everyone in the Lemma sees a project and
// its tasks.

import { useState } from "react";
import { Button, Field, Sheet, create, useToast } from "@lemma-plugins/kit";
import { useWorld } from "./data";
import { to } from "./route";
import type { Project } from "./types";

export function ProjectSheet({ onClose }: { onClose: () => void }) {
  const { me } = useWorld();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await create<Project>("project", {
        name: name.trim().slice(0, 200), description: description.trim() || null, state: "active", source: "tasks",
        lead_user_id: me?.id || null, lead_name: me?.name || null, target_on: target || null,
      });
      toast("Project made. Everyone in this Lemma can see it.");
      onClose();
      if (p?.id) to.list("project", false, p.id);
    } catch (e) {
      toast(`Couldn't make it: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open title="New team project" onClose={onClose}
      footer={<><span className="c-grow" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => void save()}>Make the project</Button></>}>
      <Field label="Name">
        <input className="c-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Brightwave renewal, Q1 launch…"
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
      </Field>
      <Field label="What it's for">
        <textarea className="c-textarea" style={{ minHeight: 100 }} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Finish by">
        <input type="date" className="c-input" value={target} onChange={(e) => setTarget(e.target.value)} />
      </Field>
      <p className="c-faint">Everyone in this Lemma sees a team project and its tasks. Your own list stays yours.</p>
    </Sheet>
  );
}
