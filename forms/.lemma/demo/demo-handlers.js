// What Forms' functions do to the in-memory sample in the "Try it" demo
// (_kit/src/demo.ts). Nothing here leaves the page: no reply is sent, no
// form is opened. S and U really set aside and put back, a pick or a
// re-route really moves the answer, and each writes its timeline line, as
// they would in a Lemma.
(function () {
  const ANSWERS = "from form_answer order by";
  const ME = { id: "user-sample", name: "Priya Raman" };
  const NAMES = { "user-sample": "Priya Raman", "user-tomas": "Tomás Ortega", "user-sam": "Sam Whitlock", "user-noor": "Noor Haddad", "user-ellis": "Ellis Grant" };
  const KIND = { lead: "lead", support: "support", bug: "bug", feedback: "feedback", beta: "beta", application: "application", spam: "spam" };
  const before = {};

  const uid = () => "demo-" + Math.random().toString(36).slice(2, 10);
  const inputOf = (input) => (input && input.data && typeof input.data === "object" ? input.data : input || {});
  const first = (n) => String(n || "").split(" ")[0];

  function answerOf(db, id) {
    return db.rows(ANSWERS, "form_answer").find((a) => a.id === id) || null;
  }

  function now(db) {
    const newest = db.rows(ANSWERS, "form_answer").reduce((m, a) => Math.max(m, Date.parse(a.received_at) || 0), 0);
    return new Date((newest || Date.now()) + 3 * 60_000);
  }

  function line(db, a, kind, text) {
    const at = now(db).toISOString();
    db.add("forms_event", { id: uid(), answer_id: a.id, at, kind, actor: ME.id, actor_name: ME.name, text, created_at: at });
    db.changed("forms_event");
  }

  function set(db, a, fields) {
    db.patch(a.id, Object.assign({}, fields, { hand_version: Number(a.hand_version || 0) + 1 }), "form_answer");
    db.changed("form_answer", a.id);
  }

  window.__LEMMA_DEMO_HANDLERS__ = {
    forms_decide(input, db) {
      const d = inputOf(input);
      const a = answerOf(db, d.answer);
      if (!a) return { ok: false, message: "No such answer." };
      const me = first(ME.name);
      if (d.action === "set_aside") {
        if (a.state === "set_aside") return { ok: true, state: "set_aside" };
        before[a.id] = { state: a.state, kind: a.kind, owner_user_id: a.owner_user_id, owner_name: a.owner_name, routed_to: a.routed_to };
        set(db, a, { state: "set_aside", kind: "spam", kind_by: "person", set_aside_why: d.why || "a person set it aside as spam", set_aside_by: ME.id });
        line(db, a, "set_aside", `${me} set it aside: ${d.why || "a person set it aside as spam"}.`);
        return { ok: true, state: "set_aside", message: "Set aside." };
      }
      if (d.action === "put_back") {
        const b = before[a.id] || { state: "unsure", kind: null, owner_user_id: "user-ellis", owner_name: "Ellis Grant", routed_to: "forms" };
        if (!before[a.id]) Object.assign(b, { kind_why: "put back by a person" });
        set(db, a, Object.assign({ set_aside_why: null, set_aside_by: null, kind_by: "person", kind_sure: null }, b, b.state === "set_aside" ? { state: "unsure" } : {},
          !b.owner_user_id ? { owner_user_id: "user-ellis", owner_name: "Ellis Grant", owner_why: "Put back: not sure where it goes, so Ellis is asked to pick" } : {}));
        line(db, a, "back", `${me} put it back.`);
        return { ok: true, state: b.state, message: "Put back." };
      }
      if (d.action === "unsure") {
        set(db, a, { state: "unsure", kind: null, kind_sure: null, kind_by: "person", kind_why: "a person wasn't sure", draft_state: "none" });
        line(db, a, "note", `${me} marked it not sure.`);
        return { ok: true, state: "unsure", message: "Not sure." };
      }
      if (d.action === "pick" || d.action === "reroute") {
        const fields = {};
        if (d.kind && KIND[d.kind]) Object.assign(fields, { kind: d.kind, kind_by: "person", kind_why: "picked by a person" });
        if (d.plugin === "triage") {
          Object.assign(fields, { routed_to: "triage", owner_user_id: null, owner_name: "Triage", owner_rule: "plugin", owner_why: `${me} sent it to Triage`, state: "filed", work_source: "triage_item", work_label: "T-53" });
        } else if (d.owner_user_id) {
          const who = d.owner_name || NAMES[d.owner_user_id] || "a member";
          Object.assign(fields, { routed_to: "forms", owner_user_id: d.owner_user_id, owner_name: who, owner_rule: "person", owner_why: `${me} sent it to ${first(who)}`,
            state: "routed", draft_state: d.owner_user_id === ME.id ? "wanted" : "none", draft_id: null, rules_checked: [{ rule: `${me} sent it to ${first(who)}`, result: "used" }] });
        } else if (d.kind) {
          const owner = a.owner_user_id || "user-ellis";
          Object.assign(fields, { state: "routed", routed_to: "forms", owner_user_id: owner, owner_name: NAMES[owner] || a.owner_name,
            owner_rule: "default", owner_why: `Read as ${d.kind} by a person; no rule answered, so it's with ${first(NAMES[owner] || a.owner_name)}`,
            rules_checked: [{ rule: "An open deal's owner", result: "not_needed", said: "No open deal with them" }, { rule: "The form's default owner", result: "used", said: `It's with ${first(NAMES[owner] || a.owner_name)}` }] });
        } else return { ok: false, message: "Pick a kind or an owner." };
        set(db, a, fields);
        line(db, a, d.owner_user_id || d.plugin ? "rerouted" : "read", d.plugin ? `${me} sent it to Triage; filed as T-53.` : d.owner_user_id ? `${me} sent it to ${fields.owner_name}.` : `${me} picked ${d.kind}.`);
        return { ok: true, state: fields.state, message: `Sent to ${fields.owner_name}.` };
      }
      if (d.action === "replied") {
        const at = now(db).toISOString();
        set(db, a, { state: "replied", first_reply_at: a.first_reply_at || at, replied_by: ME.id, reply_via: d.via || "elsewhere" });
        line(db, a, "sent", `${me} replied ${d.via === "lemma_address" ? "from the Lemma's address" : "elsewhere"}.`);
        return { ok: true, state: "replied", message: "Marked replied." };
      }
      if (d.action === "record") {
        line(db, a, "note", d.text || "");
        return { ok: true, message: "Noted." };
      }
      return { ok: false, message: "Unknown action." };
    },
    mail_send_draft() {
      return { sent: false, message: "In the demo nothing is sent." };
    },
    forms_sample_data() {
      return { ok: true, message: "In the demo the sample stays." };
    },
    forms_needs_you() {
      return { counts: {}, message: "" };
    },
    forms_setup_save() {
      return { ok: true, message: "In the demo the set-up isn't saved." };
    },
    forms_door_save(input, db) {
      const d = inputOf(input);
      const f = db.rows("from form order by", "form").find((x) => x.source === d.source && x.source_id === d.source_id);
      if (f) {
        const patch = {};
        for (const k of ["name", "state", "state_why", "reply_mode", "default_owner_user_id", "fields", "audience", "held_by_user_id"]) if (k in d && d[k] != null) patch[k] = d[k];
        db.patch(f.id, patch, "form");
        db.changed("form", f.id);
        return { form_id: f.id, message: `Saved ${f.name}.` };
      }
      return { form_id: "", message: "In the demo a new door isn't saved." };
    },
    leads_request() {
      return { message: "In the demo nobody is looked up." };
    },
  };
})();
