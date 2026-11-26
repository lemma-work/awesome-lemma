// The members' side, signed in: Meetings first (it reads the calendars), then
// this person's own set-up run (the app is the screen for its forms) and
// turning the page on, then their bookings.

import { useEffect, useRef } from "react";
import { Notice, Skeleton, usePath } from "@lemma-plugins/kit";
import { BookingProvider, useBooking } from "./data";
import { Booking } from "./Booking";
import { Home } from "./Home";
import { Settings } from "./Settings";
import { NeedMeetings, Setup, holdTurnOn, startSetup } from "./Setup";

function Gate() {
  const { loaded, settings, page, calendars, meetings, errors, reload } = useBooking();
  const [path] = usePath();
  const started = useRef(false);
  const ready = !!meetings && meetings.setup_step === "done" && calendars.length > 0;

  useEffect(() => {
    if (!loaded || !ready || settings || started.current || errors.settings) return;
    started.current = true;
    void startSetup().then(() => reload("settings"), () => {
      started.current = false;
    });
  }, [loaded, ready, settings, reload, errors.settings]);

  if (!loaded) {
    return (
      <div className="c-app"><div className="c-body"><Skeleton rows={8} kind="list" /></div></div>
    );
  }
  if (errors.settings && !settings) return <Notice>Couldn't open your booking page: {errors.settings}</Notice>;
  if (!ready) return <NeedMeetings />;
  // Home once the page was turned on all the way (its link is kept only then).
  if (holdTurnOn || !settings || settings.setup_step !== "done" || !page || !settings.trigger || !settings.page_url) return <Setup />;
  const [first, second] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "settings") return <Settings />;
  if (first === "b" && second) return <Booking id={second} />;
  return <Home />;
}

export default function App() {
  return (
    <BookingProvider>
      <Gate />
    </BookingProvider>
  );
}
