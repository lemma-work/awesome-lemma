// Triage: bugs, alerts and security warnings sorted by how far they reach,
// each with an owner.
//
// Until the Lemma has a Triage set-up, the first-run screen (/setup). Then
// the inbox (/ and its segments), an item's case file (/i/<n>), Doors
// (/doors) and Owners (/owners). One bar on top everywhere: the segments,
// search on `/`, New report (C), who's on triage, and the doors' states.

import { useEffect, useRef, useState } from "react";
import { DoorOpen, FlaskConical, Inbox as InboxIcon, Settings2, Users } from "lucide-react";
import { Banner, Button, DEMO, DataProvider, Kbd, Notice, SearchField, Segmented, Skeleton, runFunction, useToast } from "@lemma-plugins/kit";
import { Case } from "./Case";
import { LOADERS, WhoProvider, nameOf, nowMs, onTriage, refreshNeedsYou, useTriage, useWho } from "./data";
import { Doors } from "./Doors";
import { Inbox } from "./Inbox";
import { Gap } from "./marks";
import { NewReport } from "./NewReport";
import { Owners } from "./Owners";
import { to, useRoute, type View } from "./route";
import { typing } from "./keys";
import { Setup } from "./Setup";
import { SourceBar } from "./SourceBar";
import { ensureSchedules, keepSeen } from "./wire";

export default function App() {
  return (
    <DataProvider loaders={LOADERS}>
      <WhoProvider>
        <Gate />
      </WhoProvider>
    </DataProvider>
  );
}

function Gate() {
  const { loaded, errors, settings } = useTriage();
  const route = useRoute();
  if (!loaded) {
    return (
      <div className="c-app">
        <div className="tr-top"><span className="tr-top__name"><InboxIcon aria-hidden="true" />Triage</span></div>
        <main className="c-body c-body--wide"><Skeleton kind="table" rows={8} /></main>
      </div>
    );
  }
  if (errors.settings || errors.items) return <Notice>Couldn't read Triage: {errors.settings || errors.items}</Notice>;
  if (!settings?.setup_done_at || route.page === "setup") return <Setup />;
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const d = useTriage();
  const { me, members } = useWho();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filing, setFiling] = useState(false);
  const [clearing, setClearing] = useState(false);
  const once = useRef(false);

  useEffect(() => {
    if (once.current || !d.settings || !me) return;
    once.current = true;
    refreshNeedsYou();
    void keepSeen(d.settings);
    const inRotation = d.settings.rotation.includes(me.id);
    const made = d.settings.schedules || {};
    const needs = (d.settings.repos.length && !made["triage-github-issues"]) || (d.settings.slack.channels?.length && !made["triage-slack"])
      || (inRotation && !Object.keys(made).some((k) => k.startsWith("triage-needs-you-") && k.endsWith(me.id.replace(/-/g, "").slice(0, 8))));
    if (needs && !d.settings.sample) void ensureSchedules(d.settings, me.id, inRotation);
  }, [d.settings, me]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".c-sheet")) return;
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        setFiling(true);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const view: View | "none" = route.page === "list" ? route.view : "none";
  const now = nowMs(d);
  const duty = onTriage(d.settings, d.away, d.settings?.sprints_away?.days || [], new Date(now));
  const nextWeek = onTriage(d.settings, d.away, d.settings?.sprints_away?.days || [], new Date(now + 7 * 86_400_000));
  const clear = async () => {
    setClearing(true);
    try {
      const out = await runFunction<{ message?: string }>("triage_sample_data", { mode: "clear" });
      toast(out?.message || "Cleared the sample.");
      await d.reload();
      to.list();
    } catch (e) {
      toast(`Couldn't clear the sample: ${e instanceof Error ? e.message : e}`);
    } finally {
      setClearing(false);
    }
  };
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches;
  const selectedAccent = route.page === "item" || (wide && route.page === "list" && view === "inbox" && d.inbox.length > 0);

  return (
    <div className="c-app tr-app">
      <header className="tr-top">
        <button type="button" className="tr-top__name" onClick={() => to.list()}><InboxIcon aria-hidden="true" />Triage</button>
        <Segmented label="Views" value={view as View} onChange={(v) => to.list(v)}
          items={[{ id: "inbox", label: "Inbox", count: d.inbox.length }, { id: "accepted", label: "Accepted", count: d.accepted.length },
            { id: "down", label: "Marked down", count: d.down.length }, { id: "declined", label: "Declined", count: d.declined.length }]} />
        <span className="tr-top__links">
          <Button variant="ghost" size="sm" icon={DoorOpen} onClick={() => to.doors()} aria-current={route.page === "doors" ? "page" : undefined}>Doors</Button>
          <Button variant="ghost" size="sm" icon={Users} onClick={() => to.owners()} aria-current={route.page === "owners" ? "page" : undefined}>Owners</Button>
        </span>
        <span className="tr-top__fill" />
        <div className="tr-top__search">
          <SearchField value={query} onChange={(v) => { setQuery(v); if (route.page !== "list") to.list(); }} placeholder="Search reports" />
        </div>
        <Button variant={selectedAccent ? "default" : "primary"} onClick={() => setFiling(true)}>New report <Kbd>C</Kbd></Button>
        <Button variant="ghost" icon={Settings2} label="Set-up" onClick={() => to.setup()} />
      </header>
      <div className="tr-duty">
        {duty ? (
          <span>On triage this week: <b>{nameOf(d, members, duty)}</b>{nextWeek && nextWeek !== duty ? <> · next {nameOf(d, members, nextWeek)}</> : null}</span>
        ) : <span>Nobody is on triage: set a rotation in Owners.</span>}
        <Gap>Rotation and away are set by hand; no on-call source is connected</Gap>
      </div>
      {d.sample && !DEMO ? (
        <div className="tr-strip">
          <Banner icon={FlaskConical} action={<Button size="sm" busy={clearing} onClick={() => void clear()}>Clear the sample</Button>}>
            You're looking at a <b>sample morning</b>: made-up people and companies. Nothing is posted outside the Lemma. Clear it when you're done.
          </Banner>
        </div>
      ) : null}
      {route.page === "list" ? <SourceBar /> : null}
      {route.page === "item" ? <Case number={route.number} />
        : route.page === "doors" ? <Doors />
          : route.page === "owners" ? <Owners />
            : <Inbox view={route.page === "list" ? route.view : "inbox"} query={query} onNew={() => setFiling(true)} />}
      <NewReport open={filing} onClose={() => setFiling(false)} />
    </div>
  );
}
