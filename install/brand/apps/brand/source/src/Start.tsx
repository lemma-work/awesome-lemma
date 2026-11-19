// Onboarding, step 1: your website, or your logo and guide uploaded. Then the
// Lemma reading it, live: the job's activity line, the evidence and assets as
// they land. Step 2 (check what it found) is the brand page itself.

import { useEffect, useRef, useState } from "react";
import { Check, FileUp, FlaskConical, Globe, ImageIcon, RotateCcw, ShieldCheck, X } from "lucide-react";
import { Button, Face, Spinner, client, useToast } from "@lemma-plugins/kit";
import { fileName, hostOf, run, useBrandData, useFileUrl, useMe, usePoll } from "./data";
import type { Asset, Brand, EvidenceRow, Job } from "./types";

const STEPS = ["Waiting for the assistant", "Reading the stylesheets", "Looking at the pages", "Collecting assets", "Saving"];

function stepOf(job: Job | undefined, evidence: EvidenceRow[], assets: Asset[]): number {
  const a = (job?.activity || "").toLowerCase();
  if (/sav|measur|writ|guide/.test(a)) return 4;
  if (assets.length || /asset|logo|collect|download|asking what/.test(a)) return 3;
  if (evidence.some((e) => e.kind === "screenshot") || /screenshot|captur|page|look|brows|open/.test(a)) return 2;
  if (evidence.length || /style|css|read/.test(a)) return 1;
  return job?.state === "working" ? 1 : 0;
}

function since(at: string | null | undefined, now: number): string {
  if (!at) return "";
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ""}`.trim();
}

export function Start({ brand }: { brand: Brand | null }) {
  const { jobs, evidence, assets } = useBrandData();
  const job = jobs.find((j) => j.kind === "read" && (!brand || j.brand_id === brand.id));
  const live = !!job && (job.state === "wanted" || job.state === "working");
  const [sampleStarted, setSampleStarted] = useState(false);
  const failed = job?.state === "failed" && !live;
  const showProgress = live || (sampleStarted && !failed);
  usePoll(showProgress, 3000);

  return (
    <div className="c-app">
      <div className="c-setup br-setup">
        <ol className="br-rail" aria-label="Set-up steps">
          {["Your website", "Check what it found"].map((label, i) => (
            <li key={label} className={i === 0 ? "is-here" : ""} aria-current={i === 0 ? "step" : undefined}>
              <span className="br-rail__dot">{i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        {showProgress && job ? (
          <Reading job={job} brand={brand} evidence={evidence.filter((e) => e.brand_id === job.brand_id)} assets={assets.filter((a) => a.brand_id === job.brand_id)} />
        ) : showProgress ? (
          <p className="c-muted c-row br-gap"><Spinner /> Starting…</p>
        ) : (
          <Ask failed={failed ? job : undefined} onSample={() => setSampleStarted(true)} />
        )}
      </div>
    </div>
  );
}

function Ask({ failed, onSample }: { failed?: Job; onSample: () => void }) {
  const toast = useToast();
  const me = useMe();
  const [url, setUrl] = useState(failed?.source === "website" ? failed.source_ref || "" : "");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const read = async () => {
    const site = url.trim();
    if (!site) return;
    setBusy("url");
    try {
      await run("brand_read", { url: site, by_name: me?.name || "" });
    } catch (e) {
      toast(`Couldn't start reading it: ${e instanceof Error ? e.message : e}`);
      setBusy("");
    }
  };

  const upload = async () => {
    if (!files.length) return;
    setBusy("files");
    try {
      const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
      const folder = `/brand/uploads/${stamp}`;
      for (const [name, parent] of [["uploads", "/brand"], [stamp, "/brand/uploads"]]) {
        try {
          await client.files.folder.create(name, { directoryPath: parent });
        } catch {
          /* there already */
        }
      }
      for (const f of files) await client.files.upload(f, { name: f.name, directoryPath: folder, searchEnabled: true });
      await run("brand_read", { folder, by_name: me?.name || "" });
    } catch (e) {
      toast(`Couldn't upload them: ${e instanceof Error ? e.message : e}`);
      setBusy("");
    }
  };

  const sample = () => {
    setBusy("sample");
    onSample();
    // It reads a whole made-up brand the way a website is read (a minute or
    // two); the brand row appears at once and the page follows it.
    void run("brand_sample_data", { mode: "load", by_name: me?.name || "" }).catch((e) => {
      const text = e instanceof Error ? e.message : String(e);
      if (!/timeout|timed out|abort/i.test(text)) toast(`Couldn't load the sample: ${text}`);
    });
  };

  return (
    <>
      <Face size={44} />
      <h1>Everything you make looks and sounds like you</h1>
      <p className="c-setup__lead">
        Paste your website. This Lemma reads your colours, type, logos and voice, keeps the evidence it found, and uses them for everything it makes for your team.
      </p>
      {failed ? (
        <div className="c-banner c-banner--danger br-gap" role="alert">
          <X size={16} aria-hidden="true" />
          <p>The last read stopped: {failed.error || failed.note || "no reason was given"}</p>
        </div>
      ) : null}
      <div className="c-card br-ask">
        <form className="br-ask__row" onSubmit={(e) => { e.preventDefault(); void read(); }}>
          <Globe size={16} aria-hidden="true" className="c-faint" />
          <input className="c-input c-input--bare" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourcompany.com" aria-label="Your website" inputMode="url" autoFocus />
          <Button variant="primary" busy={busy === "url"} disabled={!!busy || !url.trim()} type="submit">Read it</Button>
        </form>
        <div className="br-ask__row br-ask__files">
          <FileUp size={16} aria-hidden="true" className="c-faint" />
          <div className="c-grow">
            <div>Or upload your logo and brand guide</div>
            <div className="c-faint br-small">{files.length ? files.map((f) => f.name).join(", ") : "SVG or PNG logos, a PDF or document guide"}</div>
          </div>
          <input ref={input} type="file" multiple hidden accept="image/*,.svg,.pdf,.doc,.docx,.md,.txt" onChange={(e) => setFiles([...(e.target.files || [])])} />
          {files.length ? (
            <Button busy={busy === "files"} disabled={!!busy} onClick={() => void upload()}>Read {files.length === 1 ? "it" : "them"}</Button>
          ) : (
            <Button disabled={!!busy} onClick={() => input.current?.click()}>Choose files</Button>
          )}
        </div>
      </div>
      <div className="br-or">or</div>
      <button type="button" className="br-sample" disabled={!!busy} onClick={sample}>
        <span className="br-sample__icon">{busy === "sample" ? <Spinner /> : <FlaskConical size={16} aria-hidden="true" />}</span>
        <span>
          <span className="br-choice__title">Look around with a made-up brand</span>
          <span className="br-choice__sub">A bakery's colours, type, logos and two designs, read the same way. Clear it any time.</span>
        </span>
      </button>
      <p className="c-setup__note"><ShieldCheck size={13} aria-hidden="true" /> Reading takes a few minutes and runs on its own. It never redraws a logo or makes up a colour: what it can't find, it says.</p>
    </>
  );
}

function Reading({ job, brand, evidence, assets }: { job: Job; brand: Brand | null; evidence: EvidenceRow[]; assets: Asset[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const step = stepOf(job, evidence, assets);
  const shots = evidence.filter((e) => e.kind === "screenshot" && e.path);
  const css = evidence.filter((e) => e.kind === "css");
  const where = job.source === "files" ? "your files" : job.source === "sample" ? "a made-up brand" : hostOf(job.source_ref) || "your website";
  return (
    <>
      <Face size={44} />
      <h1>Reading {where}</h1>
      <p className="c-setup__lead">The colours you use, the faces you set, your logos and how you talk, with the evidence for each. You can leave; it keeps going and asks you to check what it found.</p>
      <ol className="br-steps" aria-live="polite">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? "is-done" : i === step ? "is-here" : ""}>
            <span className="br-steps__dot">{i < step ? <Check size={11} aria-hidden="true" /> : i === step ? <Spinner /> : null}</span>
            {i === step && job.activity ? job.activity : label}
          </li>
        ))}
      </ol>
      <p className="c-faint br-small br-gap">{since(job.started_at || job.created_at, now)}{brand?.name ? ` · ${brand.name}` : ""}</p>
      {shots.length || assets.length || css.length ? (
        <div className="br-landing">
          {shots.map((e) => <Shot key={e.id} path={e.path as string} label={e.note || fileName(e.path)} />)}
          {assets.filter((a) => a.file_path).slice(0, 12).map((a) => <AssetTile key={a.id} asset={a} />)}
          {css.length ? <div className="br-landing__css c-faint br-small">{css.length} stylesheet read{css.length === 1 ? "" : "s"} kept as evidence</div> : null}
        </div>
      ) : null}
      {job.state === "failed" ? (
        <div className="c-setup__row"><Button icon={RotateCcw} onClick={() => window.location.reload()}>Start again</Button></div>
      ) : null}
    </>
  );
}

function Shot({ path, label }: { path: string; label: string }) {
  const url = useFileUrl(path);
  return (
    <figure className="br-landing__shot">
      {url ? <img src={url} alt={label} /> : <div className="c-skel" />}
    </figure>
  );
}

function AssetTile({ asset }: { asset: Asset }) {
  const url = useFileUrl(asset.file_path);
  return (
    <figure className="br-landing__asset" title={asset.label || ""}>
      {url ? <img src={url} alt={asset.label || ""} /> : <ImageIcon size={16} className="c-faint" aria-hidden="true" />}
    </figure>
  );
}
