// The demo's "Where people ask" panel: the same Wednesday seen from the four
// places people asked. Drawn only in the "Try it" demo, beside Answers, so a
// visitor sees what an asker sees: the team gets a stale answer with a
// warning, a customer gets only a checked answer, an email about a stale page
// goes to a person, and a Teams user who isn't a member gets nothing yet.

import { Globe, Mail, MessagesSquare, Users } from "lucide-react";
import { Gap } from "./marks";

interface Line { who: string; lemma?: boolean; text: string; source?: string }
interface Chat { icon: typeof Users; place: string; sub: string; lines: Line[]; gap?: string }

const CHATS: Chat[] = [
  { icon: Users, place: "Teams · #sales-desk", sub: "A member of the team", lines: [
    { who: "Marco Bellini", text: "What's the shortest profile you can cut?" },
    { who: "Wren", lemma: true, text: "150 mm, in 1 mm steps; cutting is free on 10 lengths or more.", source: "From Custom profile lengths, checked by Priya Raman on 19 Aug. Past its check date (due 17 Nov). I've asked Priya to look." },
  ] },
  { icon: MessagesSquare, place: "Slack Connect · brightfit-installs", sub: "A customer", lines: [
    { who: "Owen Price", text: "How long is the warranty on drivers?" },
    { who: "Wren", lemma: true, text: "Five years from delivery on drivers and LED strip; ten years on profiles.", source: "From Warranty, checked by Tomás Ortega on 31 Aug." },
  ], gap: "No help-page link until Help center exists; customers get the source line in words." },
  { icon: Mail, place: "Email · support mailbox", sub: "A customer", lines: [
    { who: "Nadia Ortiz", text: "Can you cut a 120 mm length for a shelf?" },
    { who: "Wren", lemma: true, text: "Thanks Nadia. I've passed this to Priya on our team; she'll reply to you here." },
  ], gap: "The page that answers is past its check date, so a customer isn't given it." },
  { icon: Globe, place: "Teams · a colleague who isn't a member", sub: "Not in this Lemma", lines: [
    { who: "Rob (warehouse)", text: "@Wren how do I log a damaged return?" },
  ], gap: "No answer: the Lemma answers Teams users who are members of this Lemma only." },
];

export function WhereTheyAsk() {
  return (
    <section className="kh-where-ask" aria-label="Where people ask">
      <h3 className="kh-h3">Where people ask</h3>
      <p className="c-muted kh-hint">The same Wednesday, as the askers saw it. Pick a question on the left to see how it went.</p>
      {CHATS.map((c) => (
        <div key={c.place} className="kh-chat">
          <div className="kh-chat__head"><c.icon aria-hidden="true" /><b>{c.place}</b><span className="c-faint">{c.sub}</span></div>
          {c.lines.map((l, i) => (
            <div key={i} className={`kh-chat__line${l.lemma ? " is-lemma" : ""}`}>
              <span className="kh-chat__who">{l.who}</span>
              <p>{l.text}</p>
              {l.source ? <p className="kh-chat__source">{l.source}</p> : null}
            </div>
          ))}
          {c.gap ? <Gap>{c.gap}</Gap> : null}
        </div>
      ))}
    </section>
  );
}
