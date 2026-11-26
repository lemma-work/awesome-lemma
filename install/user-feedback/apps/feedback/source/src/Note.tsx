// Add a note: something a customer said where the Lemma doesn't read (a
// call with no transcript, a hallway, a chat). Straight to the team's
// feedback, heard by this person, in their words.

import { useEffect, useState } from "react";
import { Button, Field, Sheet, errorText, useToast } from "@lemma-plugins/kit";
import { IMP_WORD, KIND_WORD, call, useUF, type Importance, type Kind } from "./data";

export function NoteSheet({ open, onClose, featureId }: { open: boolean; onClose: () => void; featureId?: string | null }) {
  const uf = useUF();
  const toast = useToast();
  const [quote, setQuote] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [feature, setFeature] = useState(featureId || "");
  const [kind, setKind] = useState<Kind>("request");
  const [imp, setImp] = useState<Importance>("unknown");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setQuote(""); setName(""); setEmail(""); setCompany(""); setFeature(featureId || ""); setKind("request"); setImp("unknown"); } }, [open, featureId]);
  const live = uf.features.filter((f) => f.state === "active");
  const tops = live.filter((f) => !f.parent_id);
  const save = async () => {
    setBusy(true);
    try {
      const out = await call("user_feedback_note", { quote, name: name || null, email: email || null, company_name: company || null,
        feature_id: feature || null, kind, importance: imp });
      toast(String(out.message || "Added."));
      await uf.reload();
      onClose();
    } catch (e) {
      toast(`Couldn't add the note: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title="Add a note" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={quote.trim().length < 3} onClick={() => void save()}>Add</Button></>}>
      <Field label="What they said" hint="As close to their words as you can. The team sees it as your note.">
        <textarea className="c-textarea" rows={4} value={quote} onChange={(e) => setQuote(e.target.value)} />
      </Field>
      <div className="uf-two">
        <Field label="Who said it"><input className="c-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Their role" /></Field>
        <Field label="Company"><input className="c-input" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
      </div>
      <Field label="Their email" hint="So they can be told where they asked when it ships."><input className="c-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Feature" hint="Leave it to the Lemma, and it proposes one in the inbox.">
        <select className="c-input" value={feature} onChange={(e) => setFeature(e.target.value)}>
          <option value="">Let the Lemma file it</option>
          {tops.map((t) => [
            <option key={t.id} value={t.id}>{t.name}</option>,
            ...live.filter((k) => k.parent_id === t.id).map((k) => <option key={k.id} value={k.id}>{`  ${t.name} › ${k.name}`}</option>),
          ])}
        </select>
      </Field>
      <div className="uf-two">
        <Field label="What they're doing">
          <select className="c-input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(["request", "problem", "praise", "question", "comparison", "other"] as Kind[]).map((k) => <option key={k} value={k}>{KIND_WORD[k]}</option>)}
          </select>
        </Field>
        <Field label="How much it matters">
          <select className="c-input" value={imp} onChange={(e) => setImp(e.target.value as Importance)}>
            {(["unknown", "nice", "important", "blocker"] as Importance[]).map((k) => <option key={k} value={k}>{IMP_WORD[k]}</option>)}
          </select>
        </Field>
      </div>
    </Sheet>
  );
}
