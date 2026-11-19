// What was promised either way, with the sentence that made each one. A
// relationship is a ledger: what you owe and what you are owed side by side.

import { ArrowUpRight, Check, Handshake } from "lucide-react";
import { Button, Card, Empty, Evidence, Header, Pill, due, nameOf, update, useToast } from "@lemma-plugins/kit";
import { useMail } from "./data";
import { to } from "./route";
import type { PromiseRow } from "./types";

function Item({ p, subject }: { p: PromiseRow; subject?: string | null }) {
  const { reload } = useMail();
  const toast = useToast();
  const d = due(p.due_at);
  const kept = async () => {
    await update("promise", p.id, { state: "done" });
    void reload("promises");
    toast("Marked kept", { action: { label: "Undo", run: () => void update("promise", p.id, { state: "open" }).then(() => reload("promises")) } });
  };
  return (
    <div className="m-ledger__item">
      <div className="m-ledger__top">
        <span className="m-ledger__who">{nameOf(p.person_name, p.person_handle)}</span>
        {d.text ? <Pill tone={d.late ? "danger" : "plain"} dot={d.late}>{d.text}</Pill> : null}
      </div>
      <div className="m-ledger__text">{p.text}</div>
      <Evidence quote={p.quote} />
      <div className="m-ledger__acts">
        <Button size="sm" icon={Check} onClick={() => void kept()}>Kept</Button>
        {p.conversation_id ? (
          <Button size="sm" variant="ghost" icon={ArrowUpRight} onClick={() => to.list("inbox", p.conversation_id!)}>{subject || "Open the conversation"}</Button>
        ) : null}
      </div>
    </div>
  );
}

export function Promises() {
  const { promises, conversations } = useMail();
  const subjects = Object.fromEntries(conversations.map((c) => [c.id, c.subject]));
  const mine = promises.filter((p) => p.direction === "i_owe");
  const theirs = promises.filter((p) => p.direction === "owed_to_me");
  const late = promises.filter((p) => due(p.due_at).late).length;
  return (
    <div className="m-page">
      <Header icon={Handshake} title="Promises" count={promises.length} />
      <div className="c-body">
        <p className="m-lead">Every promise made in your mail, either way, with the sentence that made it.{late ? ` ${late} past due.` : ""}</p>
        {promises.length ? (
          <div className="m-ledger">
            <Card title="You promised" count={mine.length} flush>
              {mine.length ? mine.map((p) => <Item key={p.id} p={p} subject={p.conversation_id ? subjects[p.conversation_id] : null} />) : <p className="m-ledger__none">Nothing you owe anyone.</p>}
            </Card>
            <Card title="Promised to you" count={theirs.length} flush>
              {theirs.length ? theirs.map((p) => <Item key={p.id} p={p} subject={p.conversation_id ? subjects[p.conversation_id] : null} />) : <p className="m-ledger__none">Nobody owes you anything right now.</p>}
            </Card>
          </div>
        ) : (
          <Empty icon={Handshake} title="No open promises">When you or someone else promises something in a conversation (“I’ll send it Friday”), it’s written down here with the sentence and the date.</Empty>
        )}
      </div>
    </div>
  );
}
