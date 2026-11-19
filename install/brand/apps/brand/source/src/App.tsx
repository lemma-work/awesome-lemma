// Brand: the team's brand, with the evidence for each part, and the designs
// made in it.
//
// Until there is a brand, the app is its own onboarding: (1) your website, or
// your logo and guide uploaded, then the Lemma reading it, live; (2) check
// what it found, on the brand page itself, and fix anything wrong. Then:
//
//   /                 the brand: colours, contrast, type, logos, voice, assets, evidence
//   /designs          designs made in the brand, with a way to ask for a new one
//   /designs/<id>     one design, its versions and the brand check on each

import { useEffect, useState } from "react";
import { FlaskConical, Palette, Plus } from "lucide-react";
import { Banner, Button, DataProvider, Header, Menu, MenuItem, Segmented, Skeleton, Notice, usePath, useToast } from "@lemma-plugins/kit";
import { LOADERS, run, setUpOnce, useBrandData, useMe } from "./data";
import { Start } from "./Start";
import { BrandPage } from "./BrandPage";
import { Designs, NewDesign } from "./Designs";
import { DesignPage } from "./DesignPage";
import type { Brand } from "./types";

export default function App() {
  return (
    <DataProvider loaders={LOADERS}>
      <Gate />
    </DataProvider>
  );
}

function Gate() {
  const data = useBrandData();
  const [path, go] = usePath();
  const me = useMe();
  const [chosen, setChosen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => setUpOnce(), []);

  if (!data.loaded) {
    return (
      <div className="c-app">
        <Header icon={Palette} title="Brand" />
        <main className="c-body"><Skeleton kind="record" /></main>
      </div>
    );
  }
  if (data.errors.brands) return <Notice>Couldn't read the brand: {data.errors.brands}</Notice>;

  const parts = path.split("/").filter(Boolean);
  const onDesigns = parts[0] === "designs";
  // A design opens in its own brand, whichever is the default.
  const opened = onDesigns && parts[1] ? data.designs.find((d) => d.id === decodeURIComponent(parts[1])) : undefined;
  const brand: Brand | null = data.brands.find((b) => b.id === (opened?.brand_id || chosen)) || data.brands.find((b) => b.is_default) || data.brands[0] || null;
  const usable = !!brand && (brand.colors.length > 0 || brand.state === "check" || brand.state === "ready");
  if (!brand || !usable) return <Start brand={brand} />;

  const designs = data.designs.filter((d) => d.brand_id === brand.id);
  const waiting = designs.filter((d) => d.state === "review" || d.state === "off_brand").length;

  let body;
  if (onDesigns && parts[1]) body = <DesignPage id={decodeURIComponent(parts[1])} version={parts[2] ? Number(parts[2]) : null} brand={brand} me={me} />;
  else if (onDesigns) body = <Designs brand={brand} onNew={() => setAsking(true)} />;
  else body = <BrandPage brand={brand} me={me} />;

  return (
    <div className="c-app">
      <Header icon={Palette} title={data.brands.length > 1 ? <BrandMenu brands={data.brands} brand={brand} onPick={(id) => { setChosen(id); if (opened) go("/designs"); }} /> : brand.name}>
        <span className="br-tabs">
          <Segmented
            label="Brand or designs"
            value={onDesigns ? "designs" : "brand"}
            onChange={(v) => go(v === "designs" ? "/designs" : "/")}
            items={[{ id: "brand", label: "Brand" }, { id: "designs", label: "Designs", count: waiting || undefined }]}
          />
        </span>
        <Button variant="primary" icon={Plus} onClick={() => setAsking(true)}><span className="c-hide-sm">New design</span></Button>
      </Header>
      {data.sampleCount > 0 && brand.source === "sample" ? <SampleBanner /> : null}
      {body}
      <NewDesign open={asking} brand={brand} onClose={() => setAsking(false)} />
    </div>
  );
}

function BrandMenu({ brands, brand, onPick }: { brands: Brand[]; brand: Brand; onPick: (id: string) => void }) {
  return (
    <Menu label={brand.name} variant="ghost">
      {(close) => brands.map((b) => (
        <MenuItem key={b.id} hint={b.is_default ? "Default" : b.source === "sample" ? "Sample" : undefined} onSelect={() => { onPick(b.id); close(); }}>{b.name}</MenuItem>
      ))}
    </Menu>
  );
}

function SampleBanner() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="c-body br-banner-wrap">
      <Banner
        icon={FlaskConical}
        action={<Button size="sm" busy={busy} onClick={() => {
          setBusy(true);
          void run("brand_sample_data", { mode: "clear" })
            .then((r) => toast(String((r as { message?: string }).message || "Cleared the sample.")))
            .catch((e) => toast(`Couldn't clear the sample: ${e instanceof Error ? e.message : e}`))
            .finally(() => setBusy(false));
        }}>Clear the sample</Button>}
      >
        <b>A made-up brand is here to look around with.</b> Clearing it removes only what it made.
      </Banner>
    </div>
  );
}
