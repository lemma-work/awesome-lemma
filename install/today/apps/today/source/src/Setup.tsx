// Today's one question, asked on the page until it is answered: when do you
// want your day? Each plugin keeps its own set-up in its own app.

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Button, Card, useData, useToast, whoAmI, type Me } from "@lemma-plugins/kit";
import { checkNow, saveMorning, type Settings } from "./data";

// Browsers still report some zones by their old names (Chrome says
// Asia/Calcutta); the platform's zone database knows only the current ones.
const ZONE_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon", "Europe/Kiev": "Europe/Kyiv", "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "Atlantic/Faeroe": "Atlantic/Faroe", "US/Eastern": "America/New_York", "US/Central": "America/Chicago",
  "US/Mountain": "America/Denver", "US/Pacific": "America/Los_Angeles", GMT: "UTC", "Etc/UTC": "UTC",
};

export function zoneName(name?: string | null): string {
  const zone = name || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return ZONE_ALIASES[zone] || zone;
}

export function MorningQuestion({ settings }: { settings: Settings | null }) {
  const toast = useToast();
  const { reload } = useData();
  const [me, setMe] = useState<Me | null>(null);
  const [at, setAt] = useState(settings?.morning_at || "08:00");
  const [busy, setBusy] = useState(false);
  const zone = zoneName(settings?.timezone && settings.timezone !== "UTC" ? settings.timezone : null);
  useEffect(() => {
    void whoAmI().then(setMe);
  }, []);
  const start = async () => {
    setBusy(true);
    try {
      const saved = await saveMorning(settings, me, at, zone);
      await checkNow(saved).catch(() => undefined);
      await reload();
      toast(`Your day is checked every morning at ${at}.`);
    } catch (e) {
      toast(`Couldn't save the time: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <div className="t-step">
        <span className="t-step__icon" aria-hidden="true"><Clock size={15} /></span>
        <div className="t-step__main">
          <label className="t-step__title" htmlFor="t-morning">When do you want your day?</label>
          <p className="c-muted">Each morning at this time Today asks which late things owed to you are worth a nudge, has them drafted, and lays out the day.</p>
          <div className="t-time">
            <input id="t-morning" className="c-input" type="time" value={at} onChange={(e) => setAt(e.target.value || "08:00")} step={900} />
            <span className="c-faint">{zone}</span>
            <Button variant="primary" onClick={() => void start()} busy={busy}>Start my day</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
