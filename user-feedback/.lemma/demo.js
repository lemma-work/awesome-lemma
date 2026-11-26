// What User feedback's writes do to the in-memory sample in the "Try it" demo
// (_kit/src/demo.ts), the way its functions do them in a Lemma. Nothing here
// leaves the page: keeping a quote, sharing one of your own, a note, and the
// feature list's add, merge and drop change only the sample in this tab.
(function () {
  const now = () => new Date().toISOString();
  const inputOf = (input) => (input && input.data && typeof input.data === "object" ? input.data : input || {});
  const feedback = (db) => db.rows("from feedback", "feedback");
  const features = (db) => db.rows("from feature", "feature");
  let n = 0;
  const newId = () => `demo-${Date.now().toString(36)}-${(n++).toString(36)}`;

  function keep(input, db) {
    const d = inputOf(input);
    const ids = [d.id, ...(d.ids || [])].filter(Boolean);
    let feature = d.feature_id ? db.find(d.feature_id, "feature") : null;
    let asks = 0;
    for (const id of ids) {
      const q = db.find(id, "feedback");
      if (!q) continue;
      const patch = {};
      if (d.kind) patch.kind = d.kind;
      if (d.importance) patch.importance = d.importance;
      if (d.action === "set_aside") patch.state = "set_aside";
      else if (d.action === "restore") patch.state = "new";
      else if (d.action === "unfile") Object.assign(patch, { state: "processed", feature_id: null, filed_by: null });
      else {
        patch.state = "processed";
        if (feature && feature.id !== q.feature_id) Object.assign(patch, { feature_id: feature.id, filed_by: "person" });
        else if (!q.filed_by && q.feature_id) patch.filed_by = "lemma";
      }
      db.patch(id, patch, "feedback");
      const kind = patch.kind || q.kind;
      if (patch.state === "processed" && kind === "request" && q.handle && (patch.feature_id || q.feature_id)) {
        const f = db.find(patch.feature_id || q.feature_id, "feature");
        if (f) {
          db.add("ask", { id: newId(), work_source: f.work_source || "feature", work_id: f.work_id || f.id, handle_kind: q.handle_kind, handle: q.handle, state: "open" });
          asks += 1;
        }
      }
    }
    ["feedback", "ask"].forEach((t) => db.changed(t));
    const words = { keep: "Kept", move: "Moved", set_aside: "Set aside", restore: "Back in the inbox", unfile: "Kept, not filed" };
    return { changed: ids.length, asks, message: (words[d.action] || "Kept") + (feature && (d.action === "keep" || d.action === "move") ? ` under ${feature.name}.` : ".")
      + (asks ? " They'll be told where they asked when it ships." : "") };
  }

  function share(input, db) {
    const d = inputOf(input);
    const heard = db.rows("from user_feedback_heard", "user_feedback_heard").filter((h) => (d.all ? h.share_state === "unshared" : (d.ids || []).includes(h.id)));
    if (d.action !== "share") {
      db.patch(heard.map((h) => h.id), { share_state: d.action === "keep_private" ? "dismissed" : "unshared" }, "user_feedback_heard");
      db.changed("user_feedback_heard");
      return { changed: heard.length, message: d.action === "keep_private" ? `Kept ${heard.length} private.` : "Put back to share later." };
    }
    for (const h of heard) {
      db.add("feedback", Object.assign({}, h, { heard_by: "user-sample", state: "new", plugin: "user-feedback", filed_by: h.feature_id ? "lemma" : null, is_public: false }));
      db.add("user_feedback_filing", { id: h.id, options: h.options, confidence: h.confidence, matched: h.matched, picked: h.feature_id });
    }
    db.patch(heard.map((h) => h.id), { share_state: "shared", feedback_id: null, shared_at: now() }, "user_feedback_heard");
    ["feedback", "user_feedback_heard", "user_feedback_filing"].forEach((t) => db.changed(t));
    return { changed: heard.length, message: `Shared ${heard.length} with the team: the sentence and who said it, never the thread.` };
  }

  function note(input, db) {
    const d = inputOf(input);
    const row = {
      id: newId(), quote: d.quote, product_id: (db.rows("from product", "product").find((p) => p.role !== "rival") || {}).id || null,
      feature_id: d.feature_id || null, filed_by: d.feature_id ? "person" : null, kind: d.kind || "other", importance: d.importance || "unknown",
      compared_with: null, handle_kind: d.email ? "email" : null, handle: d.email || null, name: d.name || null, company_name: d.company_name || null,
      source: "note", source_id: newId(), heard_by: "user-sample", is_public: false, said_at: now(), state: d.feature_id ? "processed" : "new",
      plugin: "user-feedback",
    };
    db.add("feedback", row);
    db.changed("feedback");
    return { id: row.id, message: d.feature_id ? "Kept under that feature." : "Added to the inbox. In a Lemma it would be filed in a moment." };
  }

  function feature(input, db) {
    const d = inputOf(input);
    const f = d.id ? db.find(d.id, "feature") : null;
    const s = db.rows("from user_feedback_settings", "user_feedback_settings")[0];
    if (d.action === "create") {
      const ours = db.rows("from product", "product").find((p) => p.role !== "rival");
      const row = { id: newId(), product_id: ours && ours.id, name: d.name, description: d.description || null, parent_id: d.parent_id || null,
        aliases: [], state: "active", origin: "team", stage: "idea", stage_at: now() };
      db.add("feature", row);
      db.changed("feature");
      return { id: row.id, message: `Added ${d.name}.` };
    }
    if (!f) return { message: "No such feature." };
    if (d.action === "update") {
      const patch = {};
      ["name", "description", "parent_id", "work_source", "work_id", "work_url"].forEach((k) => { if (d[k] !== undefined && d[k] !== null) patch[k] = d[k] || null; });
      if (d.aliases) patch.aliases = d.aliases;
      db.patch(f.id, patch, "feature");
      db.changed("feature");
      return { id: f.id, message: "Saved." };
    }
    if (d.action === "accept") {
      db.patch(f.id, { state: "active", origin: "lemma" }, "feature");
      db.changed("feature");
      return { id: f.id, message: `${f.name} is on the list.` };
    }
    if (d.action === "drop") {
      const mine = feedback(db).filter((q) => q.feature_id === f.id);
      if (f.state === "suggested") db.patch(mine.map((q) => q.id), { feature_id: null, filed_by: null }, "feedback");
      db.patch(f.id, { state: "archived" }, "feature");
      ["feature", "feedback"].forEach((t) => db.changed(t));
      return { id: f.id, moved: mine.length, message: `Dropped ${f.name}.` + (f.state === "suggested" && mine.length ? ` Its ${mine.length} quotes are back under Not filed.` : "") };
    }
    if (d.action === "keep_apart") {
      if (s) db.patch(s.id, { duplicates: (s.duplicates || []).filter((x) => x.a !== f.id && x.b !== f.id) }, "user_feedback_settings");
      db.changed("user_feedback_settings");
      return { id: f.id, message: "Kept apart." };
    }
    if (d.action === "merge") {
      const into = db.find(d.into, "feature");
      if (!into) return { message: "Pick the feature to merge into." };
      const mine = feedback(db).filter((q) => q.feature_id === f.id);
      db.patch(mine.map((q) => q.id), { feature_id: into.id }, "feedback");
      const kids = features(db).filter((k) => k.parent_id === f.id);
      db.patch(kids.map((k) => k.id), { parent_id: into.id }, "feature");
      const aliases = [...(into.aliases || [])];
      [f.name, ...(f.aliases || [])].forEach((w) => { if (w && !aliases.some((a) => a.toLowerCase() === w.toLowerCase())) aliases.push(w); });
      db.patch(into.id, { aliases }, "feature");
      db.patch(f.id, { state: "merged", merged_into: into.id }, "feature");
      if (s) db.patch(s.id, { duplicates: (s.duplicates || []).filter((x) => x.a !== f.id && x.b !== f.id) }, "user_feedback_settings");
      ["feature", "feedback", "user_feedback_settings"].forEach((t) => db.changed(t));
      return { id: into.id, moved: mine.length, message: `Merged ${f.name} into ${into.name}: ${mine.length} quotes moved.` };
    }
    return { message: "Done." };
  }

  function member(input, db) {
    const d = inputOf(input);
    const m = db.rows("from user_feedback_member", "user_feedback_member")[0];
    if (m) db.patch(m.id, { read_mail: d.read_mail ?? m.read_mail, read_meetings: d.read_meetings ?? m.read_meetings, auto_share: d.auto_share ?? m.auto_share }, "user_feedback_member");
    db.changed("user_feedback_member");
    let shared = 0;
    if (d.auto_share && m && !m.auto_share) shared = share({ all: true, action: "share" }, db).changed;
    return { shared, message: "Saved." + (shared ? ` Shared the ${shared} waiting with the team.` : "") };
  }

  window.__LEMMA_DEMO_HANDLERS__ = {
    user_feedback_keep: keep,
    user_feedback_share: share,
    user_feedback_note: note,
    user_feedback_feature: feature,
    user_feedback_member_save: member,
    user_feedback_needs_you: () => ({ items: 0, message: "" }),
  };
})();
