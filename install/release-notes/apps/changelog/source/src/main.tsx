// The public changelog page. Nobody signs in, and nothing that starts the
// SDK's sign-in client is loaded: the page reads the Lemma's Public
// release_note_page rows through its web widget's key, which the host puts in
// window.__LEMMA_CONFIG__ (webWidgets). A demo build loads the kit for the
// demo's bar, theme and stand-in API.

const DEMO = import.meta.env.VITE_LEMMA_DEMO === "1";

if (DEMO) {
  void import("@lemma-plugins/kit")
    .then((kit) => {
      kit.startTheme();
      return import("./entry");
    })
    .then((m) => m.start());
} else {
  void import("./entry").then((m) => m.start());
}
