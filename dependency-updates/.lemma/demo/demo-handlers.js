// What Dependency updates' decisions do to the in-memory sample in the "Try it"
// demo (_kit/src/demo.ts). Nothing here leaves the page. A decision changes
// the update's state as deps_decide would; the runs it starts (its own pull
// request, Drop, Put back, Ask, Open now) only say what they would do.
(function () {
  const UPDATES = "from deps_update where state";
  const BATCHES = "from deps_batch order by";
  const IGNORES = "from deps_ignore order by";
  const WHO = "Priya Shah";
  const OPEN = ["waiting", "ready", "needs_you", "risky", "dropped", "by_hand"];

  const now = () => new Date().toISOString();
  const uid = () => "demo-" + Math.random().toString(36).slice(2, 10);
  const inputOf = (input) => (input && input.data && typeof input.data === "object" ? input.data : input || {});
  const clean = (v) => String(v || "").replace(/^[=v^~<>! ]+/, "");
  const parts = (v) => clean(v).split(".").map((p) => parseInt(p, 10)).filter((n) => !Number.isNaN(n));

  function covers(range, u) {
    const r = String(range || "").toLowerCase();
    if (!r || r === "all") return true;
    if (r === "patches" || r === "patch") return u.bump === "patch";
    if (r.endsWith(".x")) {
      const want = parts(r.slice(0, -2));
      return want.every((n, i) => parts(u.to_version)[i] === n);
    }
    return clean(r) === clean(u.to_version);
  }

  function step(db, batchId, text) {
    const b = db.find(batchId, "deps_batch");
    if (!b) return;
    const steps = (b.steps || []).concat([{ at: now(), kind: "comment", text, ok: true }]);
    db.patch(batchId, { steps }, "deps_batch");
  }

  function deps_decide(input, db) {
    const d = inputOf(input);
    const action = d.action;
    if (action === "stop_ignoring") {
      const ig = db.find(d.id, "deps_ignore");
      if (!ig) return { ok: false, message: "That ignore is gone already." };
      db.remove(d.id, "deps_ignore");
      for (const u of db.rows(UPDATES, "deps_update")) {
        if (u.state === "ignored" && u.package === ig.package) db.patch(u.id, { state: "waiting", why: "No longer ignored, by " + WHO }, "deps_update");
      }
      ["deps_ignore", "deps_update"].forEach((t) => db.changed(t));
      return { ok: true, message: `Stopped ignoring ${ig.package} ${ig.version_range}.` };
    }
    if (action === "ask") {
      const b = db.find(d.id, "deps_batch");
      if (!b) return { ok: false, message: "No such pull request." };
      step(db, b.id, `${WHO} asked from the app: ${d.text}`);
      db.changed("deps_batch");
      return { ok: true, start: { kind: "comment", repo: b.repo, text: d.text, pr_number: b.pr_number, batch_id: b.id }, message: "Asked the Lemma." };
    }
    const u = db.find(d.id, "deps_update");
    if (!u) return { ok: false, message: "That update is gone." };
    const label = `${u.package} ${u.to_version}`;
    const decided = { choice: action, decided_by: WHO, decided_at: now() };
    let out = { ok: true, message: "Done." };
    if (action === "monday" || action === "take_now") {
      db.patch(u.id, Object.assign({ state: "ready", why: action === "monday" ? `Added to the next batch by ${WHO}` : `Taken before the wait ends, by ${WHO}` }, decided), "deps_update");
      out.message = `${label} joins the next batch.`;
    } else if (action === "own") {
      db.patch(u.id, Object.assign({ state: "ready", why: `Its own pull request, asked by ${WHO}` }, decided), "deps_update");
      out = { ok: true, message: `Opening ${label} as its own pull request.`, start: { kind: "own", repo: u.repo, text: `Open its own pull request for ${label}.` } };
    } else if (action === "let_through") {
      db.patch(u.id, Object.assign({ state: "waiting", why: `Let through by ${WHO}` }, decided), "deps_update");
      out.message = `${label} is let through, after the wait.`;
    } else if (action === "not_yet" || action === "ignore") {
      const range = action === "not_yet" ? u.to_version : d.version_range || u.to_version;
      const reason = action === "not_yet" ? "Not yet" : d.reason || null;
      db.add("deps_ignore", { id: uid(), created_at: now(), updated_at: now(), repo: d.all_repos ? null : u.repo, package: u.package, version_range: range, reason, by_kind: "person", by_name: WHO });
      for (const o of db.rows(UPDATES, "deps_update")) {
        if (o.package === u.package && OPEN.includes(o.state) && !o.security && covers(range, o)) {
          db.patch(o.id, Object.assign({ state: "ignored", why: `${action === "not_yet" ? "Not yet" : "Ignored"}: ${range}, by ${WHO}` }, o.id === u.id ? decided : {}), "deps_update");
        }
      }
      db.changed("deps_ignore");
      out.message = action === "not_yet" ? `${label}: not this version.` : `Ignoring ${u.package} ${range}.`;
    } else if (action === "drop") {
      step(db, u.batch_id, `${WHO} asked from the app: drop ${u.package}`);
      db.patch(u.id, decided, "deps_update");
      db.changed("deps_batch");
      out = { ok: true, message: `Asked the Lemma to drop ${u.package}.`, start: { kind: "comment", repo: u.repo, text: `drop ${u.package}`, pr_number: u.pr_number, batch_id: u.batch_id } };
    } else if (action === "put_back") {
      step(db, u.batch_id, `${WHO} asked from the app: put ${u.package} back`);
      db.changed("deps_batch");
      out = { ok: true, message: `Asked the Lemma to put ${u.package} back.`, start: { kind: "comment", repo: u.repo, text: `put ${u.package} back`, pr_number: u.pr_number, batch_id: u.batch_id } };
    }
    db.changed("deps_update");
    return out;
  }

  window.__LEMMA_DEMO_HANDLERS__ = Object.assign(window.__LEMMA_DEMO_HANDLERS__ || {}, {
    deps_decide,
    deps_needs_you: () => ({ decide: 0, message: "" }),
  });
})();
