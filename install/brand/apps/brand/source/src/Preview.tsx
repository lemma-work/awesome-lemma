// A design as it is: its own index.html, drawn at its own size in a frame
// with no scripts, scaled to fit. Its theme.css is put inline and its images
// (the brand's logo and other files beside it) are read with the person's
// session. The preview image the maker rendered stands in until it loads, and
// for thumbnails.

import { useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import { client } from "@lemma-plugins/kit";
import { fileUrl, useFileUrl } from "./data";

const pages = new Map<string, Promise<string>>();

async function build(artifact: string): Promise<string> {
  const folder = artifact.slice(0, artifact.lastIndexOf("/") + 1);
  let html = await (await client.files.download(artifact)).text();
  const local = (ref: string) => !/^(https?:|data:|blob:|#|\/\/)/i.test(ref);
  const css = [...html.matchAll(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi)];
  for (const m of css) {
    if (!local(m[1])) continue;
    try {
      const text = await (await client.files.download(folder + m[1].replace(/^\.\//, ""))).text();
      html = html.replace(m[0], `<style>${text}</style>`);
    } catch {
      /* left as it is */
    }
  }
  const refs = new Set([...html.matchAll(/\b(?:src|href)=["']([^"']+\.(?:svg|png|jpe?g|webp|gif|avif))["']/gi)].map((m) => m[1]).filter(local));
  for (const ref of refs) {
    try {
      const url = await fileUrl(folder + ref.replace(/^\.\//, ""));
      html = html.split(`"${ref}"`).join(`"${url}"`).split(`'${ref}'`).join(`'${url}'`);
    } catch {
      /* left as it is */
    }
  }
  return html;
}

export function Preview({ artifact, preview, width, height, label }: { artifact?: string | null; preview?: string | null; width: number; height: number; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [html, setHtml] = useState<string | null>(null);
  const image = useFileUrl(preview);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / width));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  useEffect(() => {
    let live = true;
    setHtml(null);
    if (!artifact) return;
    let found = pages.get(artifact);
    if (!found) {
      found = build(artifact);
      found.catch(() => pages.delete(artifact));
      pages.set(artifact, found);
    }
    void found.then((h) => live && setHtml(h)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [artifact]);

  return (
    <div ref={box} className="br-preview" style={{ height: Math.round(height * scale) }}>
      {html ? (
        <iframe
          title={label}
          sandbox="allow-same-origin"
          srcDoc={html}
          style={{ width, height, transform: `scale(${scale})` }}
          tabIndex={-1}
        />
      ) : image ? (
        <img src={image} alt={label} />
      ) : artifact || preview ? (
        <div className="c-skel" style={{ position: "absolute", inset: 0 }} />
      ) : (
        <div className="br-preview__none"><ImageIcon size={18} aria-hidden="true" /></div>
      )}
    </div>
  );
}

/** A small picture of a design: its rendered preview when there is one, else itself. */
export function Thumb({ artifact, preview, width, height, label }: { artifact?: string | null; preview?: string | null; width: number; height: number; label: string }) {
  const image = useFileUrl(preview);
  if (preview) {
    return (
      <div className="br-thumb" style={{ aspectRatio: `${width} / ${height}` }}>
        {image ? <img src={image} alt={label} /> : <div className="c-skel" style={{ position: "absolute", inset: 0 }} />}
      </div>
    );
  }
  return <Preview artifact={artifact} width={width} height={height} label={label} />;
}
