// Set-up until this person has one, then the inbox.

import { useEffect, useRef } from "react";
import { Notice, Skeleton, runFunction, whoAmI } from "@lemma-plugins/kit";
import { MailProvider, useMail } from "./data";
import { Setup } from "./Setup";
import { Shell } from "./Shell";
import { browserZone, setZone } from "./time";

function Gate() {
  const { loaded, settings, reload, errors } = useMail();
  const asked = useRef(false);

  // Mail settings and the five starting categories, the first time anyone opens it.
  useEffect(() => {
    if (!loaded || settings || asked.current) return;
    asked.current = true;
    void whoAmI()
      .then((me) => runFunction("mail_settings_ensure", { timezone: browserZone(), display_name: me?.name || undefined }))
      .then(() => reload())
      .catch(() => {
        asked.current = false;
      });
  }, [loaded, settings, reload]);

  useEffect(() => setZone(settings?.timezone), [settings?.timezone]);

  if (!loaded) {
    return (
      <div className="m-loading">
        <Skeleton rows={10} kind="list" />
      </div>
    );
  }
  if (errors.settings && !settings) return <Notice>Couldn’t open your mail: {errors.settings}</Notice>;
  if (!settings || settings.setup_step !== "done") return <Setup />;
  return <Shell />;
}

export default function App() {
  return (
    <MailProvider>
      <Gate />
    </MailProvider>
  );
}
