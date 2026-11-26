// What Know-how's functions do to the in-memory sample in the "Try it" demo
// (_kit/src/demo.ts). Nothing here leaves the page: nobody is told in Teams,
// no customer is emailed, no file is written. Saving a draft makes it live,
// Keep checks a page, a proposed step is added, and covered-by moves a
// question onto a page, as they would in a Lemma.
(function () {
  const ARTICLES = "from knowhow_article order by";
  const QUESTIONS = "from knowhow_question order by";
  const CHANGES = "from knowhow_change order by";
  const TOPICS = "from knowhow_topic order by";
  const ME = { id: "user-sample", name: "Priya Raman" };

  const uid = () => "demo-" + Math.random().toString(36).slice(2, 10);
  const inputOf = (input) => (input && input.data && typeof input.data === "object" ? input.data : input || {});
  const list = (v) => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v || "[]") : []);
  const now = () => new Date("2026-11-25T13:39:00Z");
  const day = (d) => d.toISOString().slice(0, 10);
  const plus = (days) => day(new Date(now().getTime() + days * 86400000));
  const fmt = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

  function article(db, id) {
    return db.rows(ARTICLES, "knowhow_article").find((a) => a.id === id) || null;
  }
  function topic(db, id) {
    return db.rows(TOPICS, "knowhow_topic").find((t) => t.id === id) || {};
  }
  function group(db, ids) {
    const qs = db.rows(QUESTIONS, "knowhow_question");
    const firsts = new Set(qs.filter((q) => ids.includes(q.id)).map((q) => q.same_as || q.id));
    return qs.filter((q) => firsts.has(q.id) || firsts.has(q.same_as));
  }
  function line(db, kind, subject, key, text) {
    db.add("knowhow_event", { id: uid(), subject_kind: kind, subject_id: subject, kind: key, actor: ME.id, actor_name: ME.name, text, at: now().toISOString() });
    db.changed("knowhow_event");
  }
  function checked(db, a) {
    const t = topic(db, a.topic_id);
    return { checked_at: now().toISOString(), checked_by_name: ME.name, due_on: plus(Number(t.check_days || 90)), state: "live" };
  }

  window.__LEMMA_DEMO_HANDLERS__ = {
    knowhow_decide(input, db) {
      const d = inputOf(input);
      const a = d.article_id ? article(db, d.article_id) : null;
      const act = d.action;
      if (act === "set_aside" || act === "ask_owner") {
        const g = group(db, d.question_ids || []);
        db.patch(g.map((q) => q.id), { state: act === "set_aside" ? "set_aside" : "asked" }, "knowhow_question");
        db.changed("knowhow_question");
        const t = topic(db, g[0] && g[0].topic_id);
        line(db, "question", g[0].id, act === "set_aside" ? "set_aside" : "routed", act === "set_aside" ? "Set aside." : `Asked ${t.owner_name || "the owner"} for an answer.`);
        return { ok: true, message: act === "set_aside" ? "Set aside." : `Asked ${t.owner_name || "the owner"}. In a Lemma they get it in Teams.` };
      }
      if (act === "covered_by") {
        const target = article(db, d.target_article_id);
        const g = group(db, d.question_ids || []);
        db.patch(g.map((q) => q.id), { state: "saved", article_id: target.id, next_note: "Covered by " + target.title }, "knowhow_question");
        db.patch(target.id, { asks: [...list(target.asks), ...g.map((q) => q.text)] }, "knowhow_article");
        db.changed("knowhow_question"); db.changed("knowhow_article");
        line(db, "question", g[0].id, "covered", `Covered by ${target.title}.`);
        return { ok: true, message: `Covered by ${target.title}; its other ways to ask now include these words.` };
      }
      if (!a) return { ok: false, message: "No such page." };
      if (act === "save" || act === "edit") {
        if (d.body_md) db.file(a.path, d.body_md);
        const t = topic(db, a.topic_id);
        const fields = checked(db, a);
        db.patch(a.id, fields, "knowhow_article");
        const qs = db.rows(QUESTIONS, "knowhow_question").filter((q) => q.draft_article_id === a.id);
        db.patch(qs.map((q) => q.id), { state: "saved", article_id: a.id, next_note: "Saved as an answer" }, "knowhow_question");
        db.changed("knowhow_article"); db.changed("knowhow_question");
        line(db, "article", a.id, "saved", `Saved as an answer by ${ME.name}.`);
        for (const q of qs) line(db, "question", q.id, "saved", `${ME.name} saved ${a.title} as the answer.`);
        return { ok: true, article_id: a.id, tell_members: [], tell_contacts: [], tell_hidden: 0,
          message: act === "save" ? `Saved ${a.title}. In a Lemma, the ${qs.length} people who asked are told where they asked.` : "Saved your edit." };
      }
      if (act === "keep") {
        const fields = checked(db, a);
        db.patch(a.id, fields, "knowhow_article");
        const open = db.rows(CHANGES, "knowhow_change").filter((c) => c.article_id === a.id && c.kind === "may_disagree" && c.state === "proposed");
        db.patch(open.map((c) => c.id), { state: "declined" }, "knowhow_change");
        db.changed("knowhow_article"); db.changed("knowhow_change");
        line(db, "article", a.id, "checked", `Checked by ${ME.name}; next check ${fmt(fields.due_on)}.`);
        return { ok: true, message: `Checked. Next check ${fmt(fields.due_on)}.` };
      }
      if (act === "ask_check") {
        line(db, "article", a.id, "routed", `Asked ${a.owner_name || "the owner"} to check it.`);
        return { ok: true, message: `Asked ${a.owner_name || "the owner"} to check it.` };
      }
      if (act === "retire") {
        db.patch(a.id, { state: "retired" }, "knowhow_article"); db.changed("knowhow_article");
        line(db, "article", a.id, "retired", `Retired by ${ME.name}.`);
        return { ok: true, message: "Retired. The Lemma won't answer from it." };
      }
      if (act === "approve_for_customers" || act === "take_back") {
        const fields = act === "take_back" ? { audience: "team", approved_at: null } : { audience: "customers", approved_at: now().toISOString(), approved_by_name: ME.name };
        db.patch(a.id, fields, "knowhow_article"); db.changed("knowhow_article");
        line(db, "article", a.id, act === "take_back" ? "unpublished" : "published", act === "take_back" ? "Taken back from customers." : `Approved for customers by ${ME.name}.`);
        return { ok: true, message: act === "take_back" ? "Taken back: customers no longer get it." : "Approved for customers." };
      }
      if (act === "add_change" || act === "decline_change") {
        const c = db.rows(CHANGES, "knowhow_change").find((x) => x.id === d.change_id);
        db.patch(c.id, { state: act === "add_change" ? "added" : "declined" }, "knowhow_change");
        if (act === "add_change" && c.step) {
          const steps = list(a.steps).map((s) => (s.n === c.step ? { ...s, body: (s.body || "") + "\n\n" + (d.text || c.text) } : s));
          db.patch(a.id, { steps, ...checked(db, a) }, "knowhow_article");
        }
        db.changed("knowhow_change"); db.changed("knowhow_article");
        line(db, "article", a.id, "edited", act === "add_change" ? `Added to step ${c.step} by ${ME.name}.` : "Not now: the proposed change.");
        return { ok: true, message: act === "add_change" ? `Added to step ${c.step}.` : "Left as it is." };
      }
      return { ok: true, message: "Noted." };
    },
    knowhow_draft(input, db) {
      const d = inputOf(input);
      if (d.body_md && d.title) {
        const id = uid();
        const path = "/know-how/_drafts/" + d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".md";
        db.file(path, d.body_md);
        const t = topic(db, d.topic_id);
        db.add("knowhow_article", { id, kind: d.kind || "answer", title: d.title, asks: [], path, topic_id: d.topic_id || null, owner_member_id: ME.id,
          owner_name: t.owner_name || ME.name, audience: "team", state: "draft", steps: [], source: "manual", uses_30d: 0, misses_30d: 0,
          walks_30d: 0, finished_30d: 0, missing: [], created_at: now().toISOString(), updated_at: now().toISOString() });
        db.changed("knowhow_article");
        return { ok: true, article_id: id, message: `Draft ${d.title} saved for its owner to check.` };
      }
      db.note("In the demo the Lemma doesn't draft: in a Lemma, the writer drafts a page from the passage in a minute or two, and its owner saves it in one step.");
      return { ok: true, message: "Drafting it." };
    },
  };
})();
