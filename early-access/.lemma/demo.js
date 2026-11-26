// What Early access's functions do to the in-memory sample in the "Try it"
// demo (_kit/src/demo.ts), and a stand-in for the Lemma's web widget on the
// public pages. Nothing here leaves the page: nobody is let in anywhere, no
// flag changes, no mail is sent.
(function () {
  const db = () => window.__LEMMA_DEMO_DB__;
  const TESTERS = "from early_access_tester order by";
  const DRAFTS = "from draft where kind = 'new'";
  const inputOf = (input) => (input && input.data && typeof input.data === "object" ? input.data : input || {});
  const uid = () => "demo-" + Math.random().toString(36).slice(2, 10);
  const first = (n) => String(n || "").split(" ")[0] || "there";
  const beta = (d) => d.rows("from early_access_beta order by", "early_access_beta")[0] || null;
  const tester = (d, id) => d.rows(TESTERS, "early_access_tester").find((t) => t.id === id) || null;
  const line = (t, what, extra) => (t.timeline || []).concat([Object.assign({ at: new Date().toISOString(), what }, extra || {})]);

  // Each note as the writer agent would draft it, from what the person said at sign-up.
  function body(kind, t, b) {
    const said = (t.answers && (t.answers.use_for || t.answers.today)) || "";
    if (kind === "invite") {
      return `Hi ${first(t.name)},\n\nYou said "${said.replace(/\.$/, "")}". ${b.name} is now on for your account: pick your filters, export, and the filters stay. The API takes the same filter field.\n\nIf anything gets in the way, reply here. I read every answer.`;
    }
    if (kind === "not_now") {
      return `Hi ${first(t.name)},\n\nThank you for signing up for ${b.name}. We're letting in teams who export on a schedule first, so you're not in this round. If that changes for you, reply and tell me; I'll look again.`;
    }
    return `Hi ${first(t.name)},\n\nHow is ${b.name} going? Three questions, a minute at most:\n\nhttps://early-access.sample.example/sample-csv-export/check-in`;
  }

  window.__LEMMA_DEMO_HANDLERS__ = {
    early_access_setup_options() {
      const b = beta(db());
      return {
        features: [{ id: b.feature_id, name: b.name, product_id: b.product_id, stage: "beta" }],
        mailboxes: [{ id: "mailbox-sample", provider: "gmail", email: "jordan@ledgerline.example", account_id: "account-sample" }],
        posthog: { state: "ready", url: b.posthog_url, flags: [{ key: "csv-export-filters", name: "CSV export with filters" }],
          cohorts: [{ id: "4521", name: "CSV export beta", is_static: true, count: 15 }] },
        questions: b.questions,
      };
    },
    early_access_setup_save(input, d) {
      const x = inputOf(input);
      const b = beta(d);
      if (b) {
        const keep = {};
        for (const k of ["name", "intro", "batch_size", "checkin_day", "quiet_days", "questions", "state", "turned_on"]) if (k in x) keep[k] = x[k];
        d.patch(b.id, keep, "early_access_beta");
        d.changed("early_access_beta");
      }
      return { ok: true, beta_id: b && b.id, slug: b && b.slug, message: "Saved." };
    },
    early_access_draft(input, d) {
      const x = inputOf(input);
      const b = beta(d);
      let n = 0;
      for (const id of x.tester_ids || []) {
        const t = tester(d, id);
        if (!t) continue;
        const subject = x.kind === "invite" ? `You're in: ${b.name}` : x.kind === "not_now" ? `About the ${b.name} beta` : `How is ${b.name} going?`;
        const did = uid();
        d.add("draft", { id: did, state: "proposed", subject, body: body(x.kind, t, b), to_handles: [t.handle], source_account: "mailbox-sample",
          built_from: { plugin: "early-access", tester_id: t.id, beta_id: b.id, kind: x.kind }, sent_at: null, error: null });
        n += 1;
      }
      d.changed("draft");
      return { started: n, message: `Writing ${n} notes.` };
    },
    early_access_let_in(input, d) {
      const x = inputOf(input);
      const b = beta(d);
      const at = new Date().toISOString();
      const batch = uid();
      for (const id of x.tester_ids || []) {
        const t = tester(d, id);
        if (!t) continue;
        d.patch(t.id, { status: "invited", invited_at: at, batch_id: batch, flag_state: "on", invited_by: "user-sample",
          timeline: line(t, "Let in (flag on in PostHog), invite sent from your mailbox") }, "early_access_tester");
      }
      for (const dr of d.rows(DRAFTS, "draft")) {
        if (dr.built_from && dr.built_from.kind === "invite" && (x.tester_ids || []).includes(dr.built_from.tester_id)) d.patch(dr.id, { state: "sent", sent_at: at }, "draft");
      }
      d.add("early_access_batch", { id: batch, beta_id: b.id, picked_by: "user-sample", picked_at: at, size: (x.tester_ids || []).length, sent: !x.write_myself });
      d.changed("early_access_tester");
      d.changed("draft");
      d.changed("early_access_batch");
      d.note("In the demo nobody is let in anywhere: in a Lemma they join the PostHog cohort, and Mail sends each invite from your mailbox.");
      return { ok: true, let_in: (x.tester_ids || []).length, message: `Let in ${(x.tester_ids || []).length} people.`, problems: [] };
    },
    early_access_take_out(input, d) {
      const x = inputOf(input);
      const t = tester(d, x.tester_id);
      if (!t) return { ok: false, message: "No such tester." };
      if (x.fit) {
        d.patch(t.id, { fit: x.fit, fit_by: "person", timeline: line(t, `Fit set to ${x.fit.replace("_", " ")} by hand`) }, "early_access_tester");
      } else if (x.flag_on != null) {
        d.patch(t.id, { flag_state: x.flag_on ? "on" : "by_hand" }, "early_access_tester");
      } else {
        d.patch(t.id, { status: "left", left_reason: x.reason || null, timeline: line(t, "Taken out of the beta" + (x.reason ? `: ${x.reason}` : "")) }, "early_access_tester");
      }
      d.changed("early_access_tester");
      return { ok: true, message: x.fit ? "Fit set." : "Saved." };
    },
    early_access_needs_you: () => ({ items: 0 }),
    early_access_memory: () => ({ ok: true }),
  };

  // The public pages talk to the Lemma through its web widget (widget.js).
  // This stands in for it, in the page.
  let confirmed = false;
  const note = (text) => db() && db().note(text);
  window.Lemma = {
    async readRows(table) {
      const d = db();
      if (table === "early_access_page") return { rows: d.rows("from early_access_page ", "early_access_page") };
      if (table === "early_access_status") return { rows: d.rows("from early_access_status ", "early_access_status") };
      return { rows: [] };
    },
    async addRow(table, values) {
      const d = db();
      if (table === "early_access_signup") {
        d.add("early_access_status", { id: uid(), ref: values.ref, state: "waiting", line: "We let in about 10 a week, by fit. We'll write when it's your turn." });
        setTimeout(() => note("In a Lemma, they join the waiting list now, and the Lemma reads how well they fit, with a reason."), 1500);
      } else if (table === "early_access_checkin") {
        setTimeout(() => note("In a Lemma, each answer becomes feedback about the feature, in their words."), 800);
      }
      return { id: uid() };
    },
    async sendCode() {
      note("In the demo no code is emailed: any six digits work.");
      return { ok: true };
    },
    async verifyCode(_email, code) {
      if (!/^\d{6}$/.test(String(code))) throw { code: "bad_code", message: "The code is 6 digits." };
      confirmed = true;
      return { isContact: true };
    },
    isContact: () => confirmed,
  };
})();
