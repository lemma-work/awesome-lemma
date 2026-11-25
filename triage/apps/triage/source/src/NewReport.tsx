// New report (C): a sheet over the inbox. A member files what they saw or
// what someone told them; they can set the kind, owner and priority straight
// away. It goes the same six steps as every other report.

import { useEffect, useState } from "react";
import { Button, Field, Sheet, runFunction, useToast } from "@lemma-plugins/kit";
import { useTriage, useWho } from "./data";
import { to } from "./route";
import { why } from "./wire";

export function NewReport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = useTriage();
  const { members } = useWho();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("bug");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");
  const [who, setWho] = useState("");
  const [email, setEmail] = useState("");
  const [page, setPage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setTitle(""); setBody(""); setKind("bug"); setOwner(""); setPriority(""); setWho(""); setEmail(""); setPage(""); }
  }, [open]);
  const people = members.length ? members : (d.settings?.people || []).map((p) => ({ user_id: p.user_id, name: p.name, email: p.email || "" }));
  const submit = async () => {
    setBusy(true);
    try {
      const out = await runFunction<{ message?: string; number?: number }>("triage_report_add", {
        door: "app", title: title.trim(), body: body.trim() || title.trim(), kind, page: page.trim() || null,
        owner_user_id: owner || null, owner_name: people.find((p) => p.user_id === owner)?.name || null, priority: priority || null,
        ...(email.trim() ? { handle_kind: "email", handle: email.trim(), reporter_name: who.trim() || null } : {}),
      });
      toast(out?.message || "Filed.");
      await d.reload();
      onClose();
      if (out?.number) to.item(out.number);
    } catch (e) {
      toast(`Couldn't file it: ${why(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title="New report" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!title.trim()} onClick={() => void submit()}>File it</Button></>}>
      <Field label="What's wrong, in a line"><input className="c-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Checkout is blank for some customers" /></Field>
      <Field label="What happened" hint="Steps, what was expected, the version: what you know."><textarea className="c-textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="tr-two">
        <Field label="Kind">
          <select className="c-select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="bug">Bug</option><option value="request">Request</option><option value="security">Security</option><option value="alert">Alert</option>
          </select>
        </Field>
        <Field label="Priority" hint="Left to reach when empty.">
          <select className="c-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">From reach</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
        </Field>
      </div>
      <Field label="Owner" hint="Empty: the Lemma suggests one, with the reason.">
        <select className="c-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Let the Lemma suggest</option>
          {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Page" hint="Where it happens, if you know."><input className="c-input" value={page} onChange={(e) => setPage(e.target.value)} placeholder="/checkout/summary" /></Field>
      <div className="tr-two">
        <Field label="Reported by someone else?" hint="Their name"><input className="c-input" value={who} onChange={(e) => setWho(e.target.value)} /></Field>
        <Field label="Their email" hint="So they can be told when it's fixed."><input className="c-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}
