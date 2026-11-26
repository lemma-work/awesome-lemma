// New page: an answer, procedure or policy written by hand. It's saved as a
// draft under its topic, for its owner to save as an answer.

import { useState } from "react";
import { Button, Field, Sheet, useToast } from "@lemma-plugins/kit";
import { call, refreshMine, useKnowhow } from "./data";
import { to } from "./route";

const STARTERS: Record<string, string> = {
  answer: "The short answer first.\n\n- Any conditions, as a list.",
  procedure: "### 1. First step\nWho: Customer service\nWhat to do.\n\n### 2. Second step\nWhat to do.",
  policy: "The rule, in one sentence.\n\n- Who it applies to.\n- What happens if it's broken.",
};

export function NewPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = useKnowhow();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("answer");
  const [topic, setTopic] = useState("");
  const [body, setBody] = useState(STARTERS.answer);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const out = await call<{ article_id?: string; message?: string }>("knowhow_draft", { title, kind, body_md: body, topic_id: topic || null, source: "manual" });
      toast(out.message || "Saved as a draft.");
      refreshMine();
      await d.reload();
      onClose();
      setTitle("");
      if (out.article_id) to.page(out.article_id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title="New page" onClose={onClose}
      footer={<><Button variant="primary" busy={busy} disabled={!title.trim() || !body.trim()} onClick={() => void save()}>Save as a draft</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <Field label="Title"><input className="c-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lead times" autoFocus /></Field>
      <div className="kh-two">
        <Field label="Kind">
          <select className="c-select" value={kind} onChange={(e) => { setKind(e.target.value); if (Object.values(STARTERS).includes(body)) setBody(STARTERS[e.target.value]); }}>
            <option value="answer">Answer</option><option value="procedure">Procedure</option><option value="policy">Policy</option>
          </select>
        </Field>
        <Field label="Topic">
          <select className="c-select" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">Pick a topic</option>{d.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Page" hint="Markdown. A procedure's steps are ### 1. Title headings.">
        <textarea className="c-textarea kh-editor" value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
    </Sheet>
  );
}
