// The brand, each part beside the evidence it was read from: colours (with
// what each is for and where it was found), the contrast measured between
// them, type, logos, voice, the other assets it collected, and the evidence
// itself. While the brand waits for a check (onboarding step 2, or after a
// read again), a banner asks for one: fix anything wrong, then Looks right.
// The brand's own colours appear only in swatches, specimens and logo
// grounds; the page around them is the Lemma's.

import { useMemo, useState, type ReactNode } from "react";
import {
  BookOpen, Check, CircleHelp, Download, EyeOff, FileCode2, Image as ImageIcon, MessageSquareQuote, MoreHorizontal,
  Pencil, RotateCcw, Shapes, Sparkles, SwatchBook, Type,
} from "lucide-react";
import {
  Banner, Button, Card, Empty, Evidence, Field, Markdown, Menu, MenuItem, MenuLabel, Pill, Rel, Segmented, Sheet, Spinner, ago, useToast,
} from "@lemma-plugins/kit";
import { isDark, pairs, verdict } from "./contrast";
import { download, fileName, hostOf, run, useBrandData, useBrandFaces, useFileText, useFileUrl, useMostlyLight, usePoll, type Me } from "./data";
import { ROLE_WORDS, type Asset, type Brand, type BrandColour, type EvidenceRow } from "./types";

type SheetState =
  | { kind: "color"; colour: BrandColour }
  | { kind: "font"; role: string }
  | { kind: "voice" }
  | { kind: "evidence"; about: string; title: string }
  | { kind: "guide" }
  | { kind: "file"; path: string; title: string }
  | { kind: "reread" }
  | null;

const ORDER = ["accent", "ink", "surface", "surface_2", "muted", "line", "accent_ink", "ok", "bad", "extra"];
const SOURCE_WORDS: Record<string, string> = { google: "Google Fonts", open: "Open licence", licensed: "Licensed: named, not stored", system: "System face" };
const KIND_WORDS: Record<string, string> = { logo: "Logo", icon: "Icon", photo: "Photo", illustration: "Illustration", other: "Something else" };

export function BrandPage({ brand, me }: { brand: Brand; me: Me | null }) {
  const { assets, evidence, jobs, reload } = useBrandData();
  useBrandFaces(brand);
  const toast = useToast();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busy, setBusy] = useState("");
  const mine = assets.filter((a) => a.brand_id === brand.id);
  const ev = evidence.filter((e) => e.brand_id === brand.id);
  const read = jobs.find((j) => j.kind === "read" && j.brand_id === brand.id);
  const working = !!read && (read.state === "wanted" || read.state === "working");
  // Being read until brand_save has kept it (the job closes a moment later).
  const live = working && brand.state === "reading";
  const again = read?.brand_state_before === "check" || read?.brand_state_before === "ready";
  usePoll(working, 5000);
  const colors = [...brand.colors].sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role));
  const byRole = Object.fromEntries(colors.filter((c) => c.role !== "extra").map((c) => [c.role, c.value]));
  const measured = pairs(byRole);
  const failing = measured.filter((p) => p.ratio !== null && p.ratio < p.needs);
  const unsure = mine.filter((a) => a.state === "unsure");

  const fix = async (input: Record<string, unknown>, done: string) => {
    try {
      await run("brand_fix", { brand_id: brand.id, by_name: me?.name || "", ...input });
      toast(done);
      void reload();
      return true;
    } catch (e) {
      toast(`Couldn't keep that: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  };

  const evidenceFor = (about: string) => ev.filter((e) => e.about === about || e.about.startsWith(`${about.replace(/s$/, "")}:`) || e.about === `${about}s`);

  return (
    <main className="c-body">
      <div className="c-record-head br-head">
        <div className="c-grow">
          <h1>{brand.name}</h1>
          <div className="c-record-head__sub">
            {brand.site_url ? <a href={brand.site_url} target="_blank" rel="noreferrer">{hostOf(brand.site_url)}</a> : <span>{brand.source === "sample" ? "A made-up brand" : brand.source === "files" ? "From your files" : "Made by hand"}</span>}
            {brand.synced_at ? <span>· read <Rel at={brand.synced_at} /></span> : null}
            {brand.checked_at ? <span>· checked by {brand.checked_by || "someone"} <Rel at={brand.checked_at} /></span> : null}
          </div>
          <div className="c-record-head__facts">
            {brand.state === "ready" ? <Pill tone="success">Checked</Pill> : brand.state === "check" ? <Pill tone="warning">Waiting for a check</Pill> : brand.state === "reading" ? <Pill tone="info">Reading</Pill> : <Pill>{brand.state}</Pill>}
            {brand.is_default ? <Pill dot={false}>Default brand</Pill> : null}
            <Pill dot={false}>{colors.length} colours</Pill>
            <Pill dot={false}>{Object.keys(brand.fonts).length} faces</Pill>
            <Pill dot={false}>{brand.logos.length} logos</Pill>
          </div>
        </div>
        <div className="c-record-head__actions">
          {brand.guide_path ? <Button icon={BookOpen} onClick={() => setSheet({ kind: "guide" })}>Guide</Button> : null}
          {brand.site_url && brand.source !== "sample" ? <Button icon={RotateCcw} disabled={working} onClick={() => setSheet({ kind: "reread" })}>Read again</Button> : null}
        </div>
      </div>

      {live ? (
        <Banner icon={RotateCcw}>
          <b>Reading {hostOf(read?.source_ref) || "it"}{again ? " again" : ""}.</b> {(read?.activity || "Waiting for the assistant").replace(/\.$/, "")}. {again ? "The brand below stands until it's done." : "What it has found so far is below."}
        </Banner>
      ) : brand.state === "check" ? (
        <Banner
          icon={Sparkles}
          action={<Button variant="primary" icon={Check} busy={busy === "ok"} onClick={() => { setBusy("ok"); void fix({ looks_right: true }, "Checked. Everything this Lemma makes follows it.").finally(() => setBusy("")); }}>Looks right</Button>}
        >
          <b>Check what it found.</b> Fix anything wrong: your fixes are kept when it reads again, and teach it.
          {failing.length ? ` ${failing.length} colour pair${failing.length === 1 ? " is" : "s are"} hard to read.` : ""}
          {unsure.length ? ` It isn't sure what ${unsure.length} asset${unsure.length === 1 ? " is" : "s are"}.` : ""}
        </Banner>
      ) : null}
      {read?.state === "failed" && !live ? (
        <Banner tone="danger">The last read stopped: {read.error || "no reason was given"}. The brand below is the one before it.</Banner>
      ) : read?.note && brand.state === "check" ? (
        <div className="br-note br-clamp3" title={read.note}><Evidence quote={read.note} by="This Lemma, after reading" at={read.finished_at} /></div>
      ) : null}

      <Section icon={SwatchBook} title="Colours" count={colors.length} action={evidenceFor("colors").length ? <Button size="sm" variant="ghost" icon={FileCode2} onClick={() => setSheet({ kind: "evidence", about: "colors", title: "Where the colours came from" })}>Evidence</Button> : null}>
        {colors.length ? (
          <div className="br-swatches">
            {colors.map((c) => <Swatch key={`${c.role}-${c.name}-${c.value}`} colour={c} onFix={() => setSheet({ kind: "color", colour: c })} />)}
          </div>
        ) : <Empty icon={SwatchBook} title="No colours yet">They appear once the brand is read.</Empty>}
      </Section>

      {measured.length ? (
        <Section icon={Shapes} title="Contrast" count={measured.length} sub="Measured between the brand's own colours: can text in one be read on the other?">
          <div className="c-card br-pairs">
            {measured.map((p) => {
              const v = verdict(p.ratio, p.needs);
              return (
                <div key={p.label} className="br-pair">
                  <span className="br-pair__chip" style={{ background: p.ground, color: p.ink }} aria-hidden="true">Aa</span>
                  <div className="c-grow">
                    <div>{p.label}</div>
                    <div className="c-faint br-small num">{ROLE_WORDS[p.inkRole]?.label} {p.ink} on {ROLE_WORDS[p.groundRole]?.label.toLowerCase()} {p.ground} · needs {p.needs}:1</div>
                  </div>
                  <span className="br-pair__ratio num">{p.ratio === null ? "–" : `${p.ratio.toFixed(2)}:1`}</span>
                  <Pill tone={v.tone}>{v.word}</Pill>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      <Section icon={Type} title="Type" count={Object.keys(brand.fonts).length} action={evidenceFor("fonts").length ? <Button size="sm" variant="ghost" icon={FileCode2} onClick={() => setSheet({ kind: "evidence", about: "fonts", title: "Where the type came from" })}>Evidence</Button> : null}>
        <div className="br-faces">
          {["display", "body", "mono"].filter((r) => brand.fonts[r]?.family).map((role) => {
            const f = brand.fonts[role];
            return (
              <div key={role} className="c-card br-face">
                <div className="br-face__specimen" style={{ fontFamily: f.stack || f.family, fontWeight: role === "display" ? 500 : 400 }}>
                  {role === "display" ? brand.name : role === "mono" ? "0123 const brand = 'kit';" : "Sphinx of black quartz, judge my vow. 0123456789"}
                </div>
                <div className="br-face__meta">
                  <div className="c-grow">
                    <div><span className="c-muted">{role === "display" ? "Headlines" : role === "body" ? "Body" : "Mono"}</span> · {f.family}{f.weight ? ` ${f.weight}` : ""}</div>
                    <div className="c-faint br-small c-ellipsis" title={f.stack}>{f.stack}</div>
                    {f.note ? <div className="c-faint br-small">{f.note}</div> : null}
                  </div>
                  {f.source ? <Pill tone={f.source === "licensed" ? "warning" : "plain"} dot={f.source === "licensed"}>{SOURCE_WORDS[f.source] || f.source}</Pill> : null}
                  <Button size="sm" variant="ghost" icon={Pencil} label={`Fix the ${role} face`} onClick={() => setSheet({ kind: "font", role })} />
                </div>
              </div>
            );
          })}
          {!Object.keys(brand.fonts).length ? <Empty icon={Type} title="No faces yet" /> : null}
        </div>
      </Section>

      <Section icon={ImageIcon} title="Logos" count={brand.logos.length} action={evidenceFor("logos").length ? <Button size="sm" variant="ghost" icon={FileCode2} onClick={() => setSheet({ kind: "evidence", about: "logos", title: "Where the logos came from" })}>Evidence</Button> : null}>
        {brand.logos.length ? (
          <div className="br-logos">
            {brand.logos.map((l) => (
              <LogoTile key={l.path} path={l.path} variant={l.variant} dark={isDark(byRole.ink || "#111111") ? byRole.ink || "#111111" : "#1c1c1c"} ground={l.on === "dark" || l.variant === "inverse" ? (isDark(byRole.ink || "") ? byRole.ink : "#1c1c1c") : byRole.surface || "#ffffff"} />
            ))}
          </div>
        ) : <Empty icon={ImageIcon} title="No logo file">It found no clean logo file to keep, and never redraws one. Upload one, or say which asset below is the logo.</Empty>}
      </Section>

      <Section icon={MessageSquareQuote} title="Voice" action={<Button size="sm" variant="ghost" icon={Pencil} onClick={() => setSheet({ kind: "voice" })}>Fix</Button>}>
        <div className="c-card c-card__body br-voice">
          <p className="c-story">{brand.voice || "No voice written yet."}</p>
          {evidenceFor("voice").filter((e) => e.excerpt).slice(0, 2).map((e) => (
            <div key={e.id} className="br-quotes">
              {(e.excerpt || "").split("\n").filter(Boolean).slice(0, 5).map((line) => <Evidence key={line} quote={line.replace(/^["“]|["”]$/g, "")} by={e.url ? hostOf(e.url) : e.note} />)}
            </div>
          ))}
          {brand.guide_path ? <div><Button size="sm" icon={BookOpen} onClick={() => setSheet({ kind: "guide" })}>Read the whole guide</Button></div> : null}
        </div>
      </Section>

      <Assets assets={mine} brand={brand} onFix={(input, done) => fix(input, done)} />

      <Section icon={FileCode2} title="Evidence" count={ev.length} sub="What it read the brand from. Each part above links to its own.">
        {ev.length ? (
          <div className="br-evidence">
            {ev.map((e) => <EvidenceTile key={e.id} row={e} onOpen={(path, title) => setSheet({ kind: "file", path, title })} />)}
          </div>
        ) : <Empty icon={FileCode2} title="No evidence kept">A read keeps the CSS and screenshots it used.</Empty>}
      </Section>

      <BrandSheets sheet={sheet} brand={brand} evidence={ev} byRole={byRole} onClose={() => setSheet(null)} fix={fix} me={me} />
    </main>
  );
}

function Section({ icon: Icon, title, count, sub, action, children }: { icon: typeof Type; title: string; count?: number; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="c-section br-section">
      <div className="c-section__head">
        <h2><Icon aria-hidden="true" />{title}{count != null ? <span className="c-count">{count}</span> : null}</h2>
        {action}
      </div>
      {sub ? <p className="c-faint br-small br-sub">{sub}</p> : null}
      {children}
    </section>
  );
}

function Swatch({ colour, onFix }: { colour: BrandColour; onFix: () => void }) {
  const words = ROLE_WORDS[colour.role] || ROLE_WORDS.extra;
  const ink = isDark(colour.value) ? "#ffffff" : "#111111";
  const fixed = /fix/i.test(colour.from || "");
  return (
    <div className="c-card br-swatch">
      <div className="br-swatch__chip" style={{ background: colour.value, color: ink }}>
        <span className="num">{colour.value}</span>
      </div>
      <div className="br-swatch__body">
        <div className="c-row">
          <span className="c-grow c-ellipsis">{colour.name || words.label}</span>
          <Button size="sm" variant="ghost" icon={Pencil} label={`Fix ${words.label.toLowerCase()}`} onClick={onFix} />
        </div>
        <div className="c-muted br-small">{colour.role === "extra" ? "Extra" : words.label}{colour.for || words.for ? ` · ${colour.for || words.for}` : ""}</div>
        {colour.from ? <div className={fixed ? "br-from br-from--fixed" : "br-from"} title={colour.from}>{fixed ? <Check size={12} aria-hidden="true" /> : <FileCode2 size={12} aria-hidden="true" />}<span className="c-ellipsis">{colour.from}</span></div> : null}
      </div>
    </div>
  );
}

function LogoTile({ path, variant, ground, dark }: { path: string; variant: string; ground: string; dark: string }) {
  const url = useFileUrl(path);
  const lightInk = useMostlyLight(url);
  return (
    <div className="c-card br-logo">
      <div className="br-logo__ground" style={{ background: lightInk && !isDark(ground) ? dark : ground }}>
        {url ? <img src={url} alt={`${variant} logo`} /> : <div className="c-skel" style={{ width: 120, height: 32 }} />}
      </div>
      <div className="br-logo__foot">
        <span className="c-grow c-ellipsis"><span className="c-muted">{variant === "primary" ? "Primary" : variant === "inverse" ? "On dark" : variant === "mark" ? "Mark alone" : variant === "mono" ? "One colour" : variant}</span> · {fileName(path)}</span>
        <Button size="sm" variant="ghost" icon={Download} label={`Download ${fileName(path)}`} onClick={() => void download(path)} />
      </div>
    </div>
  );
}

function Assets({ assets, brand, onFix }: { assets: Asset[]; brand: Brand; onFix: (input: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const [filter, setFilter] = useState<"kept" | "unsure" | "hidden">("kept");
  const counts = { kept: assets.filter((a) => a.state === "kept").length, unsure: assets.filter((a) => a.state === "unsure").length, hidden: assets.filter((a) => a.state === "hidden").length };
  const shown = assets.filter((a) => a.state === filter);
  const surface = brand.colors.find((c) => c.role === "surface")?.value || "#ffffff";
  const ink = brand.colors.find((c) => c.role === "ink")?.value || "#111111";
  const dark = isDark(surface) ? surface : isDark(ink) ? ink : "#1c1c1c";
  return (
    <Section icon={Shapes} title="Everything it collected" count={assets.length} sub="What each one is was asked of the Lemma; where you say otherwise, your answer teaches it.">
      {assets.length ? (
        <>
          <div className="br-filter">
            <Segmented label="Which assets" value={filter} onChange={setFilter} items={[
              { id: "kept", label: "In the kit", count: counts.kept },
              { id: "unsure", label: "Not sure", count: counts.unsure },
              { id: "hidden", label: "Put away", count: counts.hidden },
            ]} />
          </div>
          {shown.length ? (
            <div className="br-assets">{shown.map((a) => <AssetCard key={a.id} asset={a} ground={surface} dark={dark} onFix={onFix} />)}</div>
          ) : <Empty icon={Shapes} title={filter === "unsure" ? "Nothing it isn't sure about" : filter === "hidden" ? "Nothing put away" : "Nothing in the kit"} />}
        </>
      ) : <Empty icon={Shapes} title="Nothing collected yet">Logos, icons, photos and illustrations it finds land here.</Empty>}
    </Section>
  );
}

function AssetCard({ asset, ground, dark, onFix }: { asset: Asset; ground: string; dark: string; onFix: (input: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const url = useFileUrl(asset.file_path);
  const lightInk = useMostlyLight(url);
  const [busy, setBusy] = useState(false);
  const set = (patch: Record<string, unknown>, done: string) => {
    setBusy(true);
    void onFix({ asset: { id: asset.id, ...patch } }, done).finally(() => setBusy(false));
  };
  return (
    <div className="c-card br-asset">
      <div className="br-asset__img" style={{ background: lightInk ? dark : ground }}>
        {url ? <img src={url} alt={asset.label || ""} /> : <ImageIcon size={18} className="c-faint" aria-hidden="true" />}
      </div>
      <div className="br-asset__body">
        <div className="c-row">
          <span className="c-grow c-ellipsis" title={asset.label || fileName(asset.file_path)}>{asset.label || fileName(asset.file_path)}</span>
          {busy ? <Spinner /> : (
            <Menu icon={MoreHorizontal} title={`Say what ${asset.label || fileName(asset.file_path)} is`} align="right" variant="ghost">
              {(close) => (
                <>
                  <MenuLabel>What is it?</MenuLabel>
                  {Object.entries(KIND_WORDS).map(([k, w]) => (
                    <MenuItem key={k} hint={asset.kind === k ? <Check size={13} /> : undefined} onSelect={() => { close(); set({ kind: k, own: true }, `Kept as ${w.toLowerCase()}. It learns from that.`); }}>{w}</MenuItem>
                  ))}
                  <MenuLabel>Whose is it?</MenuLabel>
                  {asset.own === false ? (
                    <MenuItem icon={Check} onSelect={() => { close(); set({ own: true, hidden: false }, "Back in the kit."); }}>It's ours</MenuItem>
                  ) : (
                    <MenuItem icon={EyeOff} onSelect={() => { close(); set({ own: false, hidden: true }, "Put away: not the brand's own. It learns from that."); }}>Not ours (a customer's, a badge)</MenuItem>
                  )}
                </>
              )}
            </Menu>
          )}
        </div>
        <div className="c-row br-asset__tags">
          {asset.state === "unsure" ? <Pill tone="warning" icon={CircleHelp}>Not sure</Pill> : asset.kind ? <Pill dot={false}>{KIND_WORDS[asset.kind]}</Pill> : null}
          {asset.variant && asset.kind === "logo" ? <Pill dot={false}>{asset.variant}</Pill> : null}
          <span className="c-faint br-small num">{asset.format?.toUpperCase()}{asset.width ? ` ${asset.width}×${asset.height}` : ""}</span>
        </div>
        <div className="br-why">
          {asset.sorted_by === "person" ? <Check size={12} aria-hidden="true" /> : <Sparkles size={12} aria-hidden="true" />}
          <span>{asset.reason || "Not asked yet"}</span>
        </div>
        {asset.found ? <div className="c-faint br-small br-clamp" title={asset.found}>{asset.found}</div> : null}
      </div>
    </div>
  );
}

function EvidenceTile({ row, onOpen }: { row: EvidenceRow; onOpen: (path: string, title: string) => void }) {
  const isImage = row.kind === "screenshot" && row.path;
  const url = useFileUrl(isImage ? row.path : null);
  const title = row.kind === "screenshot" ? `Screenshot${row.url ? ` of ${hostOf(row.url)}` : ""}` : row.kind === "css" ? "The CSS it read" : row.kind === "copy" ? "Words from the site" : row.kind === "document" ? "A document" : "A file";
  return (
    <div className="c-card br-ev">
      {isImage ? (
        <button type="button" className="br-ev__shot" onClick={() => onOpen(row.path as string, title)} aria-label={`Open ${title}`}>
          {url ? <img src={url} alt="" /> : <div className="c-skel" />}
        </button>
      ) : row.excerpt ? (
        <pre className="br-ev__text">{row.excerpt}</pre>
      ) : null}
      <div className="br-ev__foot">
        <div className="c-grow" style={{ minWidth: 0 }}>
          <div className="c-ellipsis">{title}</div>
          <div className="c-faint br-small c-ellipsis">{[row.about.replace(":", " "), row.note].filter(Boolean).join(" · ")}</div>
        </div>
        {row.path && !isImage ? <Button size="sm" variant="ghost" onClick={() => onOpen(row.path as string, title)}>Open</Button> : null}
        {row.url ? <a className="c-btn c-btn--sm c-btn--ghost" href={row.url} target="_blank" rel="noreferrer">Page</a> : null}
      </div>
    </div>
  );
}

function BrandSheets({ sheet, brand, evidence, byRole, onClose, fix, me }: {
  sheet: SheetState; brand: Brand; evidence: EvidenceRow[]; byRole: Record<string, string>; onClose: () => void;
  fix: (input: Record<string, unknown>, done: string) => Promise<boolean>; me: Me | null;
}) {
  if (!sheet) return null;
  if (sheet.kind === "color") return <ColourSheet colour={sheet.colour} byRole={byRole} onClose={onClose} fix={fix} />;
  if (sheet.kind === "font") return <FontSheet role={sheet.role} brand={brand} onClose={onClose} fix={fix} />;
  if (sheet.kind === "voice") return <VoiceSheet brand={brand} onClose={onClose} fix={fix} />;
  if (sheet.kind === "guide") return <FileSheet path={brand.guide_path || ""} title="The brand guide" markdown onClose={onClose} />;
  if (sheet.kind === "file") return <FileSheet path={sheet.path} title={sheet.title} onClose={onClose} />;
  if (sheet.kind === "reread") return <RereadSheet brand={brand} onClose={onClose} me={me} />;
  const rows = evidence.filter((e) => e.about === sheet.about || e.about.startsWith(sheet.about.replace(/s$/, "") + ":"));
  return (
    <Sheet open title={sheet.title} onClose={onClose}>
      {rows.map((e) => <EvidenceTile key={e.id} row={e} onOpen={() => undefined} />)}
    </Sheet>
  );
}

function ColourSheet({ colour, byRole, onClose, fix }: { colour: BrandColour; byRole: Record<string, string>; onClose: () => void; fix: (i: Record<string, unknown>, d: string) => Promise<boolean> }) {
  const [value, setValue] = useState(colour.value);
  const [busy, setBusy] = useState(false);
  const ok = /^#[0-9a-f]{6}$/i.test(value.trim());
  const words = ROLE_WORDS[colour.role] || ROLE_WORDS.extra;
  const preview = useMemo(() => (ok && colour.role !== "extra" ? pairs({ ...byRole, [colour.role]: value.trim() }).filter((p) => p.inkRole === colour.role || p.groundRole === colour.role) : []), [ok, value, byRole, colour.role]);
  return (
    <Sheet open title={`Fix ${colour.name || words.label}`} onClose={onClose} footer={
      <>
        <Button variant="primary" busy={busy} disabled={!ok || value.trim().toLowerCase() === colour.value.toLowerCase()} onClick={() => {
          setBusy(true);
          void fix({ colors: [{ role: colour.role, value: value.trim(), name: colour.name || "" }] }, "Fixed. It keeps your colour when it reads again.").then((done) => (done ? onClose() : setBusy(false)));
        }}>Keep this colour</Button>
        <Button onClick={onClose}>Cancel</Button>
      </>
    }>
      <p className="c-muted">{words.label}{colour.for ? `: ${colour.for}` : ""}. It read <span className="num">{colour.value}</span>{colour.from ? ` from ${colour.from}` : ""}.</p>
      <Field label="The right colour" hint="A hex value, like #5a3fd4.">
        <span className="c-row">
          <input type="color" className="br-picker" value={ok ? value.trim() : colour.value} onChange={(e) => setValue(e.target.value)} aria-label="Pick the colour" />
          <input className="c-input num" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Hex value" />
        </span>
      </Field>
      {preview.length ? (
        <div className="c-card br-pairs">
          {preview.map((p) => {
            const v = verdict(p.ratio, p.needs);
            return (
              <div key={p.label} className="br-pair">
                <span className="br-pair__chip" style={{ background: p.ground, color: p.ink }} aria-hidden="true">Aa</span>
                <span className="c-grow">{p.label}</span>
                <span className="br-pair__ratio num">{p.ratio === null ? "–" : `${p.ratio.toFixed(2)}:1`}</span>
                <Pill tone={v.tone}>{v.word}</Pill>
              </div>
            );
          })}
        </div>
      ) : null}
    </Sheet>
  );
}

function FontSheet({ role, brand, onClose, fix }: { role: string; brand: Brand; onClose: () => void; fix: (i: Record<string, unknown>, d: string) => Promise<boolean> }) {
  const face = brand.fonts[role] || {};
  const [family, setFamily] = useState(face.family || "");
  const [stack, setStack] = useState(face.stack || "");
  const [source, setSource] = useState(face.source || "google");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open title={`Fix the ${role === "display" ? "headline" : role} face`} onClose={onClose} footer={
      <>
        <Button variant="primary" busy={busy} disabled={!family.trim()} onClick={() => {
          setBusy(true);
          void fix({ fonts: [{ role, family: family.trim(), stack: stack.trim(), source }] }, "Fixed. It keeps your face when it reads again.").then((d) => (d ? onClose() : setBusy(false)));
        }}>Keep this face</Button>
        <Button onClick={onClose}>Cancel</Button>
      </>
    }>
      <Field label="Family"><input className="c-input" value={family} onChange={(e) => setFamily(e.target.value)} /></Field>
      <Field label="Fallback stack" hint="Left empty, the family and a sensible fallback."><input className="c-input" value={stack} onChange={(e) => setStack(e.target.value)} /></Field>
      <Field label="Where it comes from">
        <select className="c-select" value={source} onChange={(e) => setSource(e.target.value)}>
          {Object.entries(SOURCE_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
        </select>
      </Field>
    </Sheet>
  );
}

function VoiceSheet({ brand, onClose, fix }: { brand: Brand; onClose: () => void; fix: (i: Record<string, unknown>, d: string) => Promise<boolean> }) {
  const [voice, setVoice] = useState(brand.voice || "");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open title="How the brand talks" onClose={onClose} footer={
      <>
        <Button variant="primary" busy={busy} disabled={!voice.trim() || voice.trim() === (brand.voice || "").trim()} onClick={() => {
          setBusy(true);
          void fix({ voice: voice.trim() }, "Kept. Everything this Lemma writes for the team follows it.").then((d) => (d ? onClose() : setBusy(false)));
        }}>Keep it</Button>
        <Button onClick={onClose}>Cancel</Button>
      </>
    }>
      <p className="c-muted">Two or three sentences: the tone, the sentence length, the words it uses and avoids. Every draft, post and deck this Lemma writes for the team reads this.</p>
      <textarea className="c-textarea" value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="The brand's voice" style={{ minHeight: 140 }} />
    </Sheet>
  );
}

function FileSheet({ path, title, markdown, onClose }: { path: string; title: string; markdown?: boolean; onClose: () => void }) {
  const isImage = /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(path);
  const text = useFileText(isImage ? null : path);
  const url = useFileUrl(isImage ? path : null);
  return (
    <Sheet open title={title} onClose={onClose} footer={<Button icon={Download} onClick={() => void download(path)}>Download</Button>}>
      {isImage ? (url ? <img className="br-full" src={url} alt={title} /> : <div className="c-skel" style={{ height: 300 }} />)
        : text === null ? <div className="c-skel" style={{ height: 300 }} />
          : markdown ? <div className="br-guide"><Markdown text={text.replace(/^# .*\n/, "")} /></div>
            : <pre className="br-ev__text br-ev__text--full">{text}</pre>}
    </Sheet>
  );
}

function RereadSheet({ brand, onClose, me }: { brand: Brand; onClose: () => void; me: Me | null }) {
  const toast = useToast();
  const { reload } = useBrandData();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open title="Read it again?" onClose={onClose} footer={
      <>
        <Button variant="primary" icon={RotateCcw} busy={busy} onClick={() => {
          setBusy(true);
          void run("brand_read", { brand_id: brand.id, url: brand.site_url || "", by_name: me?.name || "" })
            .then(() => { toast("Reading it again. You'll be asked to check what changed."); void reload(); onClose(); })
            .catch((e) => { toast(`Couldn't start: ${e instanceof Error ? e.message : e}`); setBusy(false); });
        }}>Read {hostOf(brand.site_url)} again</Button>
        <Button onClick={onClose}>Cancel</Button>
      </>
    }>
      <p>It reads {hostOf(brand.site_url)} again and changes the brand for everyone in this Lemma, then asks you to check it.</p>
      <p className="c-muted">Colours and faces someone fixed are kept. Until it's done, the brand stays as it is{brand.synced_at ? ` (read ${ago(brand.synced_at)})` : ""}.</p>
    </Sheet>
  );
}
