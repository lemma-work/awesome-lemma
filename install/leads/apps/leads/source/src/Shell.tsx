// The app once set up: a header, the list with its filters, a page per lead,
// settings. People and companies open in People map's apps (the SDK's
// apps.open).

import { useEffect, useState, type ReactNode } from "react";
import { Plus, ScanSearch, Settings as Cog } from "lucide-react";
import {
  AskButton, Avatar, Banner, Button, Header, Logo, SearchField, Sheet, Spinner, nameOf, q, runFunction, useToast,
} from "@lemma-plugins/kit";
import { CANDIDATES_SQL, useLeads, type Candidate } from "./data";
import { LeadPage } from "./LeadPage";
import { LeadList } from "./List";
import { KIND_LABEL } from "./marks";
import { to, useRoute } from "./route";
import { SettingsPage } from "./Settings";

export function Shell() {
  const route = useRoute();
  const { sample, errors, reload } = useLeads();
  const errs = Object.entries(errors).filter(([, v]) => v);

  let page: ReactNode;
  if (route.page === "lead") page = <LeadPage id={route.id} />;
  else if (route.page === "settings") page = <SettingsPage />;
  else page = <ListFrame><LeadList filter={route.filter} /></ListFrame>;

  return (
    <div className="c-app">
      {sample && route.page !== "settings" ? (
        <div className="ld-strip">
          <Banner action={<Button size="sm" onClick={() => to.settings()}>Sample settings</Button>}>
            <b>Sample leads.</b> Made-up people at .example companies, with made-up sources, so you can see a looked-up
            lead. Their fit is real: scored against your team's description.
          </Banner>
        </div>
      ) : null}
      {errs.length ? (
        <div className="ld-strip">
          {errs.map(([name, text]) => (
            <Banner key={name} tone="danger" action={<Button size="sm" onClick={() => void reload(name)}>Try again</Button>}>
              Couldn't load {name}: {text}
            </Banner>
          ))}
        </div>
      ) : null}
      {page}
    </div>
  );
}

function ListFrame({ children }: { children: ReactNode }) {
  const { ready } = useLeads();
  const [looking, setLooking] = useState(false);
  return (
    <>
      <Header icon={ScanSearch} title="Leads" count={ready.length}>
        <AskButton text="Which of my new leads should I talk to first this week, and why? Cite the sources." />
        <Button icon={Plus} onClick={() => setLooking(true)}>Look someone up</Button>
        <Button variant="ghost" icon={Cog} label="Settings" onClick={() => to.settings()} />
      </Header>
      {children}
      <LookSheet open={looking} onClose={() => setLooking(false)} />
    </>
  );
}

/** Anyone People map knows who hasn't been looked up: ask for one. */
export function LookSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { reload } = useLeads();
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [over, setOver] = useState<Candidate | null>(null);
  useEffect(() => {
    if (!open) return;
    setRows(null);
    void q<Candidate>(CANDIDATES_SQL).then(setRows, () => setRows([]));
  }, [open]);
  const needle = text.trim().toLowerCase();
  const shown = (rows || []).filter((r) => !needle || `${r.name} ${r.handle} ${r.company_name}`.toLowerCase().includes(needle));
  const ask = async (r: Candidate, force = false) => {
    setBusy(r.id);
    try {
      const out = await runFunction<{ ok: boolean; message: string; state?: string }>("leads_request", { person_id: r.id, force });
      toast(out.message);
      if (out.ok && !force && /used/.test(out.message)) setOver(r);
      else {
        setOver(null);
        if (out.ok) onClose();
      }
      await reload("leads");
    } catch (e) {
      toast(`Couldn't ask: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };
  return (
    <Sheet open={open} title="Look someone up" onClose={onClose}
      footer={over ? (
        <div className="c-row ld-over">
          <span className="c-grow c-muted">Today's look-ups are used. {nameOf(over.name, over.handle)} waits for tomorrow's.</span>
          <Button busy={busy === over.id} onClick={() => void ask(over, true)}>Look up anyway</Button>
        </div>
      ) : undefined}>
      <p className="c-muted ld-sheet-lead">People you deal with in People map who haven't been looked up. Colleagues, people marked other and personal addresses aren't here.</p>
      <SearchField value={text} onChange={setText} placeholder="Search people" />
      <div className="c-list ld-pick">
        {rows === null ? <div className="c-li"><Spinner /> <span className="c-muted">Finding them…</span></div> : null}
        {rows && shown.length === 0 ? <div className="c-li c-muted">{rows.length ? "No one matches." : "Everyone you deal with has been looked up or is in line."}</div> : null}
        {shown.slice(0, 120).map((r) => (
          <button key={r.id} type="button" className="c-li c-li--link ld-pick__row" disabled={!!busy} onClick={() => void ask(r)}>
            <Avatar name={r.name} email={r.handle} size={26} />
            <div className="c-li__main">
              <div className="c-ellipsis">{nameOf(r.name, r.handle)}</div>
              <div className="c-li__sub c-ellipsis">
                {r.company_name ? <><Logo name={r.company_name} domain={r.company_domain} size={14} /> {r.company_name}</> : r.handle}
                {r.kind ? ` · ${KIND_LABEL[r.kind] || r.kind}` : ""}
              </div>
            </div>
            {busy === r.id ? <Spinner /> : <span className="c-faint ld-pick__go">Look up</span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
