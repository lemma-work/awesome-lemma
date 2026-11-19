// One design: the version you're looking at, drawn as it is; the brand check
// on it (does it follow the brand, and the rule it broke, with what was
// measured); every version; and what to do: approve, ask for a change, or say
// the check was wrong (which teaches the next check).

import { useState } from "react";
import { ArchiveRestore, Archive, Check, CircleAlert, Download, MessageSquarePlus, MoreHorizontal, ShieldCheck, ShieldQuestion, ShieldX, Sparkles } from "lucide-react";
import { Button, Card, Empty, Evidence, Field, Menu, MenuItem, MenuLabel, Pill, Rel, Sheet, Spinner, go, useToast } from "@lemma-plugins/kit";
import { download, run, useBrandData, usePoll, type Me } from "./data";
import { Preview } from "./Preview";
import { stateWord } from "./Designs";
import { RULE_WORDS, kindOf, type Brand, type Version } from "./types";

export function DesignPage({ id, version, brand, me }: { id: string; version: number | null; brand: Brand; me: Me | null }) {
  const { designs, versions, jobs, reload } = useBrandData();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState("");
  const design = designs.find((d) => d.id === id);
  const live = jobs.some((j) => j.design_id === id && (j.state === "wanted" || j.state === "working"));
  usePoll(live || design?.state === "making");
  if (!design) {
    return (
      <main className="c-body">
        <Empty icon={CircleAlert} title="This design isn't here" action={<Button onClick={() => go("/designs")}>All designs</Button>}>It may have been cleared with the sample.</Empty>
      </main>
    );
  }
  const kind = kindOf(design.kind);
  const all = versions.filter((v) => v.design_id === design.id).sort((a, b) => b.version - a.version);
  const shown: Version | undefined = all.find((v) => v.version === (version ?? design.version)) || all[0];
  const job = jobs.find((j) => j.design_id === design.id);
  const working = job && (job.state === "wanted" || job.state === "working");
  const s = stateWord(design);

  const act = async (action: string, extra: Record<string, unknown> = {}, done = "") => {
    setBusy(action);
    try {
      const r = await run<{ message?: string }>("brand_design_action", { action, design_id: design.id, by_name: me?.name || "", ...extra });
      toast(done || r.message || "Done.");
      void reload();
      return true;
    } catch (e) {
      toast(`Couldn't: ${e instanceof Error ? e.message : e}`);
      return false;
    } finally {
      setBusy("");
    }
  };
  const judge = async (follows: boolean, broke = "none") => {
    if (!shown) return;
    setBusy("judge");
    try {
      await run("brand_fix", { version: { id: shown.id, follows, broke }, by_name: me?.name || "" });
      void reload();
      toast(follows ? "Marked as following the brand. The next check learns from it." : `Marked as breaking the brand: ${RULE_WORDS[broke].toLowerCase()}. The next check learns from it.`);
    } catch (e) {
      toast(`Couldn't keep that: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="c-body">
      <div className="c-record-head br-head">
        <div className="c-grow">
          <nav className="br-crumb" aria-label="Back"><button type="button" onClick={() => go("/designs")}>Designs</button> /</nav>
          <h1>{design.title}</h1>
          <div className="c-record-head__sub">
            <span>{kind.label} · {kind.size[0]}×{kind.size[1]}</span>
            {design.requested_name ? <span>· asked for by {design.requested_name}{design.made_from === "chat" ? " in chat" : design.made_from === "app" ? " here" : ""}</span> : null}
            {design.updated_at ? <span>· <Rel at={design.updated_at} /></span> : null}
          </div>
          <div className="c-record-head__facts">
            <Pill tone={s.tone}>{s.word}</Pill>
            {design.version ? <Pill dot={false}>Version {design.version}</Pill> : null}
            {design.approved_by ? <Pill dot={false} icon={Check}>Approved by {design.approved_by}</Pill> : null}
          </div>
        </div>
        <div className="c-record-head__actions">
          {design.state === "review" || design.state === "off_brand" ? (
            <Button variant="primary" icon={Check} busy={busy === "approve"} disabled={design.state === "off_brand"} title={design.state === "off_brand" ? "It breaks the brand: ask for a change, or say the check was wrong" : undefined} onClick={() => void act("approve", {}, "Approved.")}>Approve</Button>
          ) : null}
          <Button icon={MessageSquarePlus} disabled={!!working} onClick={() => setAsking(true)}>Ask for a change</Button>
          <Menu icon={MoreHorizontal} title="More" align="right">
            {(close) => (
              <>
                {shown?.artifact_path ? <MenuItem icon={Download} onSelect={() => { close(); void download(shown.artifact_path as string); }}>Download the HTML</MenuItem> : null}
                {shown?.preview_path ? <MenuItem icon={Download} onSelect={() => { close(); void download(shown.preview_path as string); }}>Download the picture</MenuItem> : null}
                {design.state === "archived"
                  ? <MenuItem icon={ArchiveRestore} onSelect={() => { close(); void act("restore"); }}>Bring it back</MenuItem>
                  : <MenuItem icon={Archive} onSelect={() => { close(); void act("archive"); }}>Put it away</MenuItem>}
              </>
            )}
          </Menu>
        </div>
      </div>

      {working ? (
        <div className="c-banner br-working" role="status">
          <Spinner />
          <p><b>{design.version ? `Making version ${design.version + 1}.` : "Making it."}</b> {job?.activity || design.activity || "Waiting for the assistant"}. It's checked against the brand before it shows here.</p>
        </div>
      ) : job?.state === "failed" && job.design_id === design.id && (!shown || (job.finished_at && shown.updated_at && job.finished_at > shown.updated_at)) ? (
        <div className="c-banner c-banner--danger" role="alert"><CircleAlert size={16} aria-hidden="true" /><p>The last try stopped: {job.error || "no reason was given"}</p></div>
      ) : null}

      <div className="c-split br-split">
        <div className="c-stack">
          {shown ? (
            <div className="c-card br-stage">
              <Preview artifact={shown.artifact_path} preview={shown.preview_path} width={kind.size[0]} height={kind.size[1]} label={`${design.title}, version ${shown.version}`} />
            </div>
          ) : (
            <div className="c-card br-stage br-stage--empty" style={{ aspectRatio: `${kind.size[0]} / ${kind.size[1]}` }}>
              {working ? <span className="c-row c-muted"><Spinner /> {job?.activity || "Waiting for the assistant"}</span> : <span className="c-muted">No version yet.</span>}
            </div>
          )}
          {design.prompt ? <Card title="What was asked"><p className="c-story">{design.prompt}</p></Card> : null}
        </div>
        <div className="c-stack">
          {shown ? <Check_ version={shown} busy={busy === "judge"} onJudge={judge} /> : null}
          <Card title="Versions" count={all.length} flush>
            <div className="c-list">
              {all.map((v) => (
                <button key={v.id} type="button" className={`c-li c-li--link br-ver${v.id === shown?.id ? " is-on" : ""}`} onClick={() => go(`/designs/${design.id}/${v.version}`)} aria-current={v.id === shown?.id ? "true" : undefined}>
                  <span className="br-ver__n num">v{v.version}</span>
                  <div className="c-li__main">
                    <div className="c-ellipsis">{v.verdict === "follows" ? "Follows the brand" : v.verdict === "breaks" ? `Breaks it: ${RULE_WORDS[v.broke || "other"].toLowerCase()}` : "Not sure"}</div>
                    <div className="c-li__sub c-ellipsis">{v.note || v.prompt || ""}</div>
                  </div>
                  <VerdictIcon v={v} />
                </button>
              ))}
              {!all.length ? <div className="c-li c-faint">None yet.</div> : null}
            </div>
          </Card>
        </div>
      </div>

      <ChangeSheet open={asking} onClose={() => setAsking(false)} onAsk={async (text) => {
        const ok = await act("change", { prompt: text }, "Asked for the change. The next version is checked against the brand before it shows.");
        if (ok) setAsking(false);
      }} />
    </main>
  );
}

function VerdictIcon({ v }: { v: Version }) {
  if (v.verdict === "follows") return <ShieldCheck size={15} className="br-ok" aria-label="Follows the brand" />;
  if (v.verdict === "breaks") return <ShieldX size={15} className="br-bad" aria-label="Breaks the brand" />;
  return <ShieldQuestion size={15} className="br-warn" aria-label="Not sure" />;
}

/** The brand check on one version: the verdict, the rule, and what was measured. */
function Check_({ version, busy, onJudge }: { version: Version; busy: boolean; onJudge: (follows: boolean, broke?: string) => void }) {
  const m = version.measured || {};
  const off = (m.colours || []).filter((c) => !c.in_brand && !c.translucent_neutral);
  const faces = (m.faces || []).filter((f) => !f.brand);
  const drawn = m.logo?.drawn || [];
  const tone = version.verdict === "follows" ? "success" : version.verdict === "breaks" ? "danger" : "warning";
  return (
    <Card title="Brand check" icon={version.verdict === "follows" ? ShieldCheck : version.verdict === "breaks" ? ShieldX : ShieldQuestion} action={
      busy ? <Spinner /> : (
        <Menu label="Wrong?" align="right" variant="ghost">
          {(close) => (
            <>
              <MenuLabel>It actually…</MenuLabel>
              <MenuItem icon={ShieldCheck} onSelect={() => { close(); onJudge(true); }}>Follows the brand</MenuItem>
              <MenuLabel>Breaks the brand with…</MenuLabel>
              {["colour", "type", "logo", "contrast", "voice", "other"].map((r) => (
                <MenuItem key={r} onSelect={() => { close(); onJudge(false, r); }}>{RULE_WORDS[r]}</MenuItem>
              ))}
            </>
          )}
        </Menu>
      )
    }>
      <div className="c-stack br-check">
        <div className="c-row">
          <Pill tone={tone}>{version.verdict === "follows" ? "Follows the brand" : version.verdict === "breaks" ? `Breaks it: ${RULE_WORDS[version.broke || "other"].toLowerCase()}` : "Not sure"}</Pill>
          {version.judged_by === "person" ? <Pill dot={false} icon={Check}>Said by a person</Pill> : <Pill tone="ai" icon={Sparkles}>Checked</Pill>}
        </div>
        <p>{version.reason}</p>
        {off.length ? (
          <div>
            <div className="c-muted br-small">Colours that aren't the brand's</div>
            <div className="br-chips">
              {off.slice(0, 6).map((c) => (
                <span key={c.value} className="br-chip" title={`Nearest brand colour: ${c.nearest_role} ${c.nearest}`}>
                  <span className="br-chip__dot" style={{ background: c.hex }} aria-hidden="true" />
                  <span className="num">{c.value}</span>
                  <span className="c-faint">×{c.count}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {faces.length ? <div className="br-small"><span className="c-muted">Faces that aren't the brand's: </span>{faces.map((f) => f.family).join(", ")}</div> : null}
        {drawn.length ? <div className="br-small"><span className="c-muted">Drawn instead of the logo file: </span>{drawn.join("; ")}</div> : null}
        {(m.low_contrast || []).length ? <div className="br-small"><span className="c-muted">Hard to read: </span>{(m.low_contrast || []).map((p) => `${p.ink} on ${p.ground} (${p.ratio}:1)`).join(", ")}</div> : null}
        <div className="c-faint br-small">
          {(m.uses_tokens ?? 0) > 0 ? `Uses the brand's tokens ${m.uses_tokens} times. ` : ""}
          {(m.logo?.used || []).filter((u) => u.brand_logo).length ? "Uses the brand's own logo file. " : ""}
        </div>
        {version.note ? <Evidence quote={version.note} by="The maker" at={version.updated_at} /> : null}
      </div>
    </Card>
  );
}

function ChangeSheet({ open, onClose, onAsk }: { open: boolean; onClose: () => void; onAsk: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} title="Ask for a change" onClose={onClose} footer={
      <>
        <Button variant="primary" busy={busy} disabled={!text.trim()} onClick={() => { setBusy(true); void onAsk(text.trim()).finally(() => { setBusy(false); setText(""); }); }}>Ask for it</Button>
        <Button onClick={onClose}>Cancel</Button>
      </>
    }>
      <Field label="What should change?" hint="It becomes the next version; this one is kept.">
        <textarea className="c-textarea" style={{ minHeight: 120 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Make the headline shorter and put the date first" autoFocus />
      </Field>
    </Sheet>
  );
}


