// Published notes: the list, and one note as it went out, with what was sent where.

import { useState } from "react";
import { ArrowLeft, BookOpen, CircleCheck, CircleX, ExternalLink } from "lucide-react";
import { Button, Card, Connect, Empty, Pill, day, plural } from "@lemma-plugins/kit";
import { asksFor, connectionFailure, sentText, useRN, useWho } from "./data";
import { PagePreview } from "./Desk";
import { to } from "./route";
import { Top } from "./Top";

export function PublishedList() {
  const rn = useRN();
  const [search, setSearch] = useState("");
  const list = rn.published.filter((n) => !search || `${n.name} ${n.title}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <Top here="published" search={search} onSearch={setSearch} placeholder="Search published notes" />
      <main className="c-body">
        {!list.length ? (
          <Empty icon={BookOpen} title={search ? "Nothing matches" : "Nothing published yet"}>
            {search ? null : "A note shows here once a publisher presses Publish on the draft."}
          </Empty>
        ) : (
          <div className="c-table-wrap">
            <table className="c-table rn-table">
              <thead><tr><th>Version</th><th>Headline</th><th className="rn-hide-sm">Published</th><th className="rn-hide-sm">Asked</th></tr></thead>
              <tbody>
                {list.map((n) => {
                  const asked = rn.lines.filter((l) => l.note_id === n.id && !l.hidden).reduce((s, l) => s + (l.asked || 0), 0);
                  return (
                    <tr key={n.id} className="rn-tr" onClick={() => to.note(n.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && to.note(n.id)}>
                      <td><span className="rn-ver-sm">{n.name}</span></td>
                      <td><span className="c-ellipsis rn-block">{n.title || "Untitled"}</span><span className="rn-meta rn-show-sm">{day(n.published_at)}</span></td>
                      <td className="rn-hide-sm">{day(n.published_at)}</td>
                      <td className="rn-hide-sm">{asked ? <Pill tone="info" dot={false}>{asked} asked</Pill> : <span className="c-faint">Nobody</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

export function PublishedNote({ id }: { id: string }) {
  const rn = useRN();
  const { members } = useWho();
  const note = rn.notes.find((n) => n.id === id);
  if (!note) {
    return (
      <>
        <Top here="published" />
        <main className="c-body"><Empty icon={BookOpen} title="No such note" action={<Button onClick={() => to.published()}>All published notes</Button>} /></main>
      </>
    );
  }
  const lines = rn.lines.filter((l) => l.note_id === note.id && !l.hidden);
  const people = new Set(lines.flatMap((l) => asksFor(l, note.repo, rn.asks)).map((a) => a.id));
  const told = rn.asks.filter((a) => people.has(a.id) && a.state === "told").length;
  const by = members.find((m) => m.user_id === note.published_by)?.name;
  return (
    <>
      <Top here="published" />
      <div className="rn-bar">
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => to.published()}>Published</Button>
        <span className="rn-ver">{note.name}</span>
        <Pill tone={note.state === "published" ? "success" : "warning"}>{note.state === "published" ? "Published" : "Not published yet"}</Pill>
        <span className="rn-meta">{note.published_at ? `${day(note.published_at)}${by ? ` by ${by}` : ""}` : ""}</span>
      </div>
      <main className="c-body">
        <div className="c-split">
          <div className="c-card rn-doc rn-doc--read"><PagePreview note={note} lines={lines} /></div>
          <div className="c-stack">
            <Card title="Sent" flush>
              {note.sent.length ? note.sent.map((s) => (
                <div key={s.to} className="rn-dest">
                  {s.ok ? <CircleCheck size={14} aria-hidden="true" className="rn-ok" /> : <CircleX size={14} aria-hidden="true" className="rn-bad" />}
                  <span className="c-grow"><span className="rn-dest__t">{sentText(s)}</span><span className="rn-meta">{s.ok ? "Done" : "Didn't go"}{s.at ? `, ${day(s.at)}` : ""}</span></span>
                  {s.url ? <a className="c-btn c-btn--sm c-btn--ghost" href={s.url} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden="true" />Open</a> : null}
                </div>
              )) : <p className="rn-pad rn-meta">Nothing recorded.</p>}
              {note.sent.filter((s) => !s.ok && (s.to === "github" || s.to === "slack") && connectionFailure(s.text)).map((s) => (
                <div key={`connect-${s.to}`} className="rn-pad">
                  <Connect quiet connector={s.to} slug={s.to} mode="shared" error={connectionFailure(s.text)}
                    purpose={s.to === "github" ? "Connect GitHub, then publish the note again from the desk to put it on the release." : "Connect Slack, then publish the note again from the desk to post it."} />
                </div>
              ))}
            </Card>
            <Card title="Who asked">
              <p className="c-muted">{plural(people.size, "person", "people")} asked for what's in it; {told} told so far.</p>
              <Button size="sm" onClick={() => to.asked()}>Open Who asked</Button>
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}
