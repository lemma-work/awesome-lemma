// What User interviews' writes do to the in-memory sample in the "Try it"
// demo (_kit/src/demo.ts). Nothing here leaves the page. Keeping or setting
// aside a finding, sending an invite, drafting one and marking someone change
// the sample, so the study, the call and the findings grid follow; reading
// who fits, reading a call and set-up only say what they would do
// (demo.json notes).
(function () {
  const PEOPLE = "from interviews_person";
  const PROPOSALS = "from interviews_proposal";
  const FEATURES = "from feature where";
  const DAY = 86400000;
  const inputOf = (input) => (input && input.data && typeof input.data === "object" ? input.data : input || {});
  const now = () => new Date().toISOString();
  const first = (p) => String(p.name || p.handle || "them").split(" ")[0];

  function person(db, id) { return db.rows(PEOPLE, "interviews_person").find((r) => String(r.id) === String(id)) || null; }
  function proposal(db, id) { return db.rows(PROPOSALS, "interviews_proposal").find((r) => String(r.id) === String(id)) || null; }
  function feature(db, id) { return db.rows(FEATURES, "feature").find((r) => String(r.id) === String(id)) || null; }

  function counts(db, pid) {
    const all = db.rows(PROPOSALS, "interviews_proposal").filter((r) => r.person_id === pid);
    db.patch(pid, {
      found: all.length, kept: all.filter((r) => r.state === "kept").length, set_aside: all.filter((r) => r.state === "set_aside").length,
    }, "interviews_person");
    db.changed("interviews_person", pid);
  }

  function keep(input, db) {
    const d = inputOf(input);
    const pr = proposal(db, d.proposal_id);
    if (!pr) return { message: "Only the interviewer can keep this call's findings." };
    const p = person(db, pr.person_id);
    if (d.undo) {
      db.patch(pr.id, { state: "open", feedback_id: null }, "interviews_proposal");
      if (pr.feedback_id) { db.remove(pr.feedback_id, "interviews_finding"); db.remove(pr.feedback_id, "feedback"); }
      db.changed("interviews_proposal", pr.id); db.changed("feedback"); db.changed("interviews_finding");
      counts(db, pr.person_id);
      return { state: "open", message: "Back to review." };
    }
    const edits = {};
    for (const k of ["point", "kind", "importance", "feature_id", "feature_new"]) if (d[k] !== undefined && d[k] !== null && d[k] !== "") edits[k] = d[k];
    if (d.feature_id === null && d.feature_new === null) Object.assign(edits, { feature_id: null, feature_new: null });
    const row = Object.assign({}, pr, edits);
    if (!d.keep) {
      db.patch(pr.id, Object.assign(edits, { state: "set_aside" }), "interviews_proposal");
      db.changed("interviews_proposal", pr.id);
      counts(db, pr.person_id);
      return { state: "set_aside", message: "Set aside." };
    }
    let fid = row.feature_id;
    if (!fid && row.feature_new) {
      fid = "demo-feature-" + String(row.feature_new).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (!feature(db, fid)) db.add("feature", { id: fid, name: row.feature_new, state: "suggested", stage: "idea", product_id: "demo", description: null, merged_into: null });
      db.changed("feature", fid);
    }
    const fb = "demo-fb-" + pr.id;
    const source = p && p.doc_kind === "notes" ? "note" : "interview";
    db.add("feedback", { id: fb, quote: row.quote, point: row.point, feature_id: fid, importance: row.importance, kind: row.kind, source,
      at_seconds: source === "interview" ? row.at_seconds : null, said_at: (p && p.call_at) || now(), state: "processed",
      handle: p && p.handle, name: p && p.name, company_name: p && p.company_name });
    db.add("interviews_finding", { id: fb, study_id: pr.study_id, person_id: pr.person_id, meeting_id: null, kept_at: now() });
    db.patch(pr.id, Object.assign(edits, { state: "kept", feedback_id: fb, feature_id: fid }), "interviews_proposal");
    db.changed("interviews_proposal", pr.id); db.changed("feedback", fb); db.changed("interviews_finding", fb);
    counts(db, pr.person_id);
    return { state: "kept", feedback_id: fb, feature_id: fid, message: "Kept, under its feature." };
  }

  function send(input, db) {
    const d = inputOf(input);
    const p = person(db, d.person_id);
    if (!p) return { sent: false, message: "There's no invite to send." };
    db.patch(p.id, { stage: "invited", invited_at: now(), invite_state: "none" }, "interviews_person");
    if (p.draft_id) { db.patch(p.draft_id, { state: "sent", sent_at: now(), body: d.body, subject: d.subject }, "draft"); db.changed("draft", p.draft_id); }
    db.changed("interviews_person", p.id);
    db.note("In the demo nothing is sent: in a Lemma Mail sends it from your own mailbox, and a booking from that address joins the study.");
    return { sent: true, message: `Sent to ${first(p)}.` };
  }

  function invite(input, db) {
    const d = inputOf(input);
    const p = person(db, d.person_id);
    if (!p) return { skip: true, message: "No such person." };
    const draftId = "demo-invite-" + p.id;
    db.add("draft", { id: draftId, to_handles: [p.handle], subject: "A 30-minute chat about your reports", state: "proposed",
      body: `Hi ${first(p)},\n\nYou came up as someone who works with Fernway's reports every week, and I'd like to hear how that goes for you. It's a 30-minute call about how you use the reports and what happens to them after.\n\nIf you're up for it, pick any time that suits you:\nhttps://book.example/your-name\n\nNo worries at all if not.`,
      built_from: { plugin: "user-interviews", study_id: p.study_id, person_id: p.id, used: (p.why || []).slice(0, 2).concat(["the study's line"]) },
      error: null, sent_at: null, source_account: "sample", rationale: null });
    db.patch(p.id, { stage: "drafted", draft_id: draftId, invite_state: "drafted", inviter_user_id: "user-sample" }, "interviews_person");
    db.changed("draft", draftId); db.changed("interviews_person", p.id);
    return { draft_id: draftId, message: `Invite to ${first(p)} drafted.` };
  }

  function mark(input, db) {
    const d = inputOf(input);
    const p = person(db, d.person_id);
    if (!p) return { message: "No such person in this study." };
    const fields = {};
    let said = "Done.";
    switch (d.what) {
      case "no_show": Object.assign(fields, { stage: "no_show", no_show_at: now() }); said = `${first(p)} marked as a no-show: resting for 90 days.`; break;
      case "showed": Object.assign(fields, { stage: "done", no_show_at: null }); said = `${first(p)}'s call is done.`; break;
      case "declined": fields.stage = "declined"; said = `${first(p)} declined this study.`; break;
      case "opted_out": fields.stage = "opted_out"; said = `${first(p)} won't be invited to any study again.`; break;
      case "thanked": fields.thanked_at = now(); said = `Ticked: you thanked ${first(p)}.`; break;
      case "unthanked": fields.thanked_at = null; said = "Tick taken off."; break;
      case "override": Object.assign(fields, { rests_until: null, rest_rule: null, override_at: now(), override_by: "user-sample" }); said = `${first(p)} can be invited despite the contact rules; that's noted.`; break;
      case "skip": fields.stage = "skipped"; said = `${first(p)} left out of this study.`; break;
      case "restore": fields.stage = "fits"; said = `${first(p)} is back in the list.`; break;
    }
    db.patch(p.id, fields, "interviews_person");
    db.changed("interviews_person", p.id);
    return { stage: fields.stage || p.stage, message: said };
  }

  function setup() {
    return {
      settings: { product_id: "demo", product_label: "Fernway", invite_gap_days: 30, no_show_days: 90, nudge_days: 4, setup_done_at: now() },
      products: [{ id: "demo", name: "Fernway" }],
      mail: { ok: true, email: "lead@fernway.example", provider: "gmail" },
      meetings: { ok: true, notes_from: "meet", calendar: true },
      booking: { ok: true, page_url: "https://book.example/your-name", minutes: 30, on: true },
      missing: [], message: "Ready.",
    };
  }

  window.__LEMMA_DEMO_HANDLERS__ = {
    interviews_keep: keep,
    interviews_send: send,
    interviews_invite: invite,
    interviews_mark: mark,
    interviews_setup: setup,
  };
  void DAY;
})();
