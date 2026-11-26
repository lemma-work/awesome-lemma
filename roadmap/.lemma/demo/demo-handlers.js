// What Roadmap's writes do to the in-memory sample in the "Try it" demo
// (_kit/src/demo.ts). Nothing here leaves the page. Moving an item, giving it
// an owner, marking it public or shipped, and editing the spec change the
// sample, so the list, the board and the feature follow; drafting a spec,
// making a project and set-up only say what they would do (demo.json notes).
(function () {
  const ITEMS = "from roadmap_item";
  const FEATURES = "from feature order by";
  const inputOf = (input) => (input && input.data && typeof input.data === "object" ? input.data : input || {});
  const now = () => new Date().toISOString();
  const today = () => now().slice(0, 10);

  function itemOf(db, id) {
    return db.rows(ITEMS, "roadmap_item").find((r) => String(r.id) === String(id)) || null;
  }
  function featureOf(db, id) {
    return db.rows(FEATURES, "feature").find((r) => String(r.id) === String(id)) || null;
  }
  function write(db, id, fields) {
    if (itemOf(db, id)) db.patch(id, fields, "roadmap_item");
    else db.add("roadmap_item", Object.assign({ id, horizon: "none", public: false }, fields));
    db.changed("roadmap_item", id);
  }
  function forward(stage, horizon) {
    if ((horizon === "next" || horizon === "later") && (stage === "idea" || stage === "declined")) return "planned";
    if (horizon === "now" && (stage === "idea" || stage === "planned" || stage === "declined")) return "building";
    return stage;
  }
  const WORD = { none: "off the roadmap", now: "in Now", next: "in Next", later: "in Later" };

  function set(input, db) {
    const data = inputOf(input);
    const f = featureOf(db, data.feature_id);
    if (!f) return { message: "No such feature." };
    const fields = {};
    let stage = f.stage;
    let said = "";
    if (data.decline) {
      fields.horizon = "none";
      stage = "declined";
      said = `Declined ${f.name}. Nobody who asked is told yet: that waits on Triage.`;
    } else if (data.horizon) {
      fields.horizon = data.horizon;
      fields.horizon_at = now();
      stage = forward(f.stage, data.horizon);
      said = `${f.name} is ${WORD[data.horizon]}` + (stage !== f.stage ? `; its stage went from ${f.stage} to ${stage}.` : ".");
    }
    if (data.no_owner) Object.assign(fields, { owner_label: null, owner_user_id: null });
    if (data.owner_label != null) fields.owner_label = data.owner_label || null;
    if (data.public != null) fields.public = !!data.public;
    if (data.public_title != null) fields.public_title = data.public_title || null;
    if (data.public_blurb != null) fields.public_blurb = data.public_blurb || null;
    write(db, f.id, fields);
    if (stage !== f.stage) {
      db.patch(f.id, { stage, stage_at: now() }, "feature");
      db.changed("feature", f.id);
    }
    return { feature_id: f.id, stage, message: said || "Saved." };
  }

  function ship(input, db) {
    const data = inputOf(input);
    const f = featureOf(db, data.feature_id);
    if (!f) return { message: "No such feature." };
    if (data.undo) {
      write(db, f.id, { horizon: "now", shipped_on: null, horizon_at: now() });
      return { message: `${f.name} is back in Now.` };
    }
    write(db, f.id, { horizon: "shipped", shipped_on: today(), horizon_at: now() });
    return { message: `Marked ${f.name} shipped today. Release notes tells the people who asked once it sets the feature live; Roadmap tells nobody itself.` };
  }

  function saveEdit(input, db) {
    const data = inputOf(input);
    const lines = (data.lines || []).map((l, i) => {
      const quotes = l.quotes || [];
      return Object.assign({}, l, { key: l.key || "demo-" + i, edited: true, quotes, unsourced: !quotes.length && l.section !== "not" });
    });
    db.patch(data.feature_id, { lines, unsourced: lines.filter((l) => l.unsourced).length, edited: lines.filter((l) => l.edited).length }, "roadmap_spec");
    db.changed("roadmap_spec", data.feature_id);
    return { message: "Saved. A redraft keeps your lines as they are." };
  }

  window.__LEMMA_DEMO_HANDLERS__ = {
    roadmap_set: set,
    roadmap_ship: ship,
    roadmap_spec_save_edit: saveEdit,
    roadmap_tick: () => ({ decide: 0, counts: {}, message: "" }),
  };
})();
