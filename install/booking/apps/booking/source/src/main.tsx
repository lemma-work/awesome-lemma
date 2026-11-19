// Two faces of one app, loaded apart. /<handle> is a person's booking page,
// for visitors: nobody signs in, and the members' code (the kit's sign-in
// client among it) is never loaded there. Everything else is the members'
// side. A visitor's page is opened by its own address, never framed, so the
// window's own path decides.

const MEMBERS = new Set(["", "settings", "b", "setup"]);

// A demo build (the plugin page's "Try it", see the kit's demo.ts) has no
// address of its own: its path is the page's #fragment, or where it starts.
// It loads the kit for the visitor's page too, for the demo's bar, its theme
// and its stand-in for the web widget. A normal build has none of this.
const DEMO = import.meta.env.VITE_LEMMA_DEMO === "1";
const path = DEMO
  ? decodeURI(window.location.hash.slice(1)) || (window as unknown as { __LEMMA_DEMO__?: { start?: string } }).__LEMMA_DEMO__?.start || "/"
  : window.location.pathname;
const first = decodeURIComponent(path.split("/").filter(Boolean)[0] || "");

if (MEMBERS.has(first)) {
  void import("./members/entry").then((m) => m.start());
} else if (DEMO) {
  void import("@lemma-plugins/kit")
    .then((kit) => {
      kit.startTheme();
      return import("./visitor/entry");
    })
    .then((m) => m.start(first.toLowerCase()));
} else {
  void import("./visitor/entry").then((m) => m.start(first.toLowerCase()));
}
