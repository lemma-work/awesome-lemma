// Two faces of one app, loaded apart. /<beta> (and its /status and
// /check-in) is a beta's public page, for visitors: nobody signs in, and the
// members' code (the kit's sign-in client among it) is never loaded there.
// Everything else is the members' side. A visitor's page is opened by its own
// address, never framed, so the window's own path decides.

const MEMBERS = new Set(["", "b", "p", "setup"]);

// A demo build (the plugin page's "Try it") has no address of its own: its
// path is the page's #fragment, or where it starts. It loads the kit for the
// visitor's page too, for the demo's bar and theme. A normal build has none.
const DEMO = import.meta.env.VITE_LEMMA_DEMO === "1";
const path = DEMO
  ? decodeURI(window.location.hash.slice(1)) || (window as unknown as { __LEMMA_DEMO__?: { start?: string } }).__LEMMA_DEMO__?.start || "/"
  : window.location.pathname;
const parts = path.split("?")[0].split("/").filter(Boolean).map((p) => decodeURIComponent(p));
const first = parts[0] || "";

if (MEMBERS.has(first)) {
  void import("./members/entry").then((m) => m.start());
} else if (DEMO) {
  void import("@lemma-plugins/kit")
    .then((kit) => {
      kit.startTheme();
      return import("./visitor/entry");
    })
    .then((m) => m.start(first.toLowerCase(), parts[1] || ""));
} else {
  void import("./visitor/entry").then((m) => m.start(first.toLowerCase(), parts[1] || ""));
}
