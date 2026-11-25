// What Triage's functions do to the in-memory sample in the "Try it" demo
// (_kit/src/demo.ts). Nothing here leaves the page: nothing is posted to
// GitHub or Slack, no task reaches a real Tasks. Accepting makes a task in
// the sample, declining tells the askers in Activity, a duplicate moves
// them, and New report files a new item, as they would in a Lemma.
(function () {
  const ITEMS = "from triage_item order by";
  const REPORTS = "from triage_report order by";
  const EVENTS = "from triage_event order by";
  const ASKS = "from ask where work_source = 'triage'";
  const TASKS = "from task where source = 'triage'";
  const KNOWN = "from triage_known order by";
  const ME = { id: "user-sample", name: "Tom Okafor" };

  const uid = () => "demo-" + Math.random().toString(36).slice(2, 10);
  const inputOf = (input) => (input && input.data && typeof input.data === "object" ? input.data : input || {});
  const list = (v) => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v || "[]") : []);

  function itemOf(db, ref) {
    const r = String(ref || "").replace(/^t-?/i, "").replace("#", "");
    return db.rows(ITEMS, "triage_item").find((i) => i.id === r || String(i.number) === r) || null;
  }

  function now(db) {
    const newest = db.rows(REPORTS, "triage_report").reduce((m, r) => Math.max(m, Date.parse(r.received_at) || 0), 0);
    return new Date((newest || Date.now()) + 6 * 60_000);
  }

  function line(db, it, kind, text) {
    db.add("triage_event", { id: uid(), item_id: it.id, at: now(db).toISOString(), kind, actor: ME.id, actor_name: ME.name, text,
      created_at: now(db).toISOString() });
    db.changed("triage_event");
  }

  function asksOf(db, it) {
    return db.rows(ASKS, "ask").filter((a) => a.work_id === it.id && a.state !== "dropped");
  }

  function where(a) {
    return { web: "the form's email", slack: "Slack", github: "GitHub", mail: "email", teams: "Teams" }[a.source] || a.source;
  }

  function makeTask(db, it, agent) {
    const number = Math.max(120, ...db.rows(TASKS, "task").map((t) => Number(t.number) || 0)) + 1;
    const id = uid();
    db.add("task", { id, number, title: `T-${it.number} ${it.title}`, status: agent ? "in_progress" : "todo",
      assignee_kind: agent ? "agent" : it.owner_name ? "person" : "none", assignee_agent: agent || null,
      assignee_name: agent ? null : it.owner_name || null, source_id: it.id, created_at: now(db).toISOString() });
    db.changed("task");
    for (const a of asksOf(db, it)) db.patch(a.id, { task_id: id }, "ask");
    db.changed("ask");
    return { id, number };
  }

  window.__LEMMA_DEMO_HANDLERS__ = {
    triage_decide(input, db) {
      const d = inputOf(input);
      const it = itemOf(db, d.item);
      if (!it) return { ok: false, message: "No such item." };
      const first = ME.name.split(" ")[0];
      const set = (patch) => { db.patch(it.id, patch, "triage_item"); db.changed("triage_item"); };
      if (d.action === "accept" || d.action === "agent") {
        const agent = d.action === "agent" ? d.agent || "pod_default" : null;
        const existing = db.rows(TASKS, "task").find((t) => t.source_id === it.id);
        const task = existing || makeTask(db, it, agent);
        if (existing && agent) { db.patch(existing.id, { assignee_kind: "agent", assignee_agent: agent, status: "in_progress" }, "task"); db.changed("task"); }
        set({ state: "accepted", task_id: task.id, decided_by: ME.id, decided_at: now(db).toISOString() });
        line(db, it, "accepted", `Accepted by ${first}: ${it.priority === "urgent" ? "an urgent" : "a " + it.priority} task in Tasks${agent ? "" : it.owner_name ? `, assigned to ${it.owner_name}` : ""}.`);
        if (agent) line(db, it, "agent", "Given to the Lemma: Tasks hands it over with the task as the brief.");
        return { ok: true, number: it.number, state: "accepted", task_id: task.id,
          message: `T-${it.number} is task #${task.number} in Tasks${agent ? ", handed to the Lemma" : ""}. (In the demo it stays on this page.)` };
      }
      if (d.action === "decline") {
        const asks = asksOf(db, it);
        for (const a of asks) db.patch(a.id, { state: "declined", told_at: now(db).toISOString() }, "ask");
        db.changed("ask");
        set({ state: "declined", decline_reason: d.reason, decided_by: ME.id, decided_at: now(db).toISOString() });
        line(db, it, "declined", `Declined by ${first}: ${d.reason}`);
        if (asks.length) line(db, it, "told", `Told ${asks.length} ${asks.length === 1 ? "person" : "people"} why: ${[...new Set(asks.map(where))].join(", ")}.`);
        return { ok: true, state: "declined", told: asks.length, message: `Declined T-${it.number}.${asks.length ? ` Told ${asks.length} why, where they asked. (In the demo nothing is sent.)` : ""}` };
      }
      if (d.action === "duplicate") {
        const orig = itemOf(db, d.of || it.looks_like);
        if (!orig) return { ok: false, message: "Say which item it duplicates." };
        const asks = asksOf(db, it);
        for (const a of asks) db.patch(a.id, { work_id: orig.id }, "ask");
        for (const r of db.rows(REPORTS, "triage_report").filter((r) => r.item_id === it.id)) db.patch(r.id, { item_id: orig.id, state: "merged" }, "triage_report");
        db.changed("ask");
        db.changed("triage_report");
        db.patch(orig.id, { reach_asks: (Number(orig.reach_asks) || 0) + asks.length, doors: [...new Set([...list(orig.doors), ...list(it.doors)])] }, "triage_item");
        set({ state: "duplicate", duplicate_of: orig.id, decided_by: ME.id, decided_at: now(db).toISOString() });
        line(db, it, "duplicate", `Marked a duplicate of T-${orig.number} by ${first}.`);
        line(db, orig, "merged", `T-${it.number} merged in as a duplicate: ${asks.length} who asked moved here.`);
        return { ok: true, state: "duplicate", message: `T-${it.number} is a duplicate of T-${orig.number}; who asked moved there.` };
      }
      if (d.action === "refuse_duplicate") {
        set({ looks_like: null, looks_like_note: null });
        line(db, it, "note", `Not the same, said ${first}.`);
        return { ok: true, message: "Kept apart. The Lemma learns from it." };
      }
      if (d.action === "snooze") {
        set({ state: "snoozed", snoozed_until: d.until || new Date(now(db).getTime() + 86_400_000).toISOString() });
        line(db, it, "snoozed", "Snoozed.");
        return { ok: true, state: "snoozed", message: `Snoozed T-${it.number}.` };
      }
      if (d.action === "mark_down") {
        set({ state: "marked_down", marked_down_reason: d.reason || "marked down by hand", marked_down_by: ME.id, priority: "low" });
        line(db, it, "marked_down", `Marked down by ${first}.`);
        return { ok: true, state: "marked_down", message: `Marked down T-${it.number}.` };
      }
      if (d.action === "bring_back") {
        set({ state: "inbox", marked_down_reason: null, marked_down_by: null, snoozed_until: null, priority: it.priority === "low" ? "medium" : it.priority });
        line(db, it, "back", `Brought back by ${first}.`);
        return { ok: true, state: "inbox", message: `T-${it.number} is back in the inbox.` };
      }
      if (d.action === "owner") {
        set({ owner_user_id: d.user_id, owner_name: d.name, owner_rule: "person", owner_reason: `chosen by ${first}` });
        line(db, it, "owner", `Owner changed to ${d.name} by ${first}.`);
        return { ok: true, message: `${d.name} owns T-${it.number}.` };
      }
      if (d.action === "split") return { ok: false, message: "In the demo reports stay where they are." };
      if (d.action === "record") {
        line(db, it, d.event_kind || "note", d.text || "Noted.");
        return { ok: true, message: "Noted." };
      }
      return { ok: false, message: "Unknown decision." };
    },

    triage_report_add(input, db) {
      const d = inputOf(input);
      const number = Math.max(0, ...db.rows(ITEMS, "triage_item").map((i) => Number(i.number) || 0)) + 1;
      const at = now(db).toISOString();
      const id = uid();
      db.add("triage_item", { id, number, title: d.title, kind: d.kind || "bug", state: "inbox", priority: d.priority || "medium",
        reach_people: null, reach_asks: 1, reach_companies: 0, reach_unit: "asked", first_seen: at, last_report_at: at,
        paths: [], doors: ["app"], owner_user_id: d.owner_user_id || "user-sample", owner_name: d.owner_name || "Tom Okafor",
        owner_rule: d.owner_user_id ? "person" : "rotation", owner_reason: d.owner_user_id ? "set by Tom when it was filed" : "on triage this week",
        alternatives: [], evidence: [], related: [], trend: [], read_state: "none", created_at: at });
      db.add("triage_report", { id: uid(), item_id: id, door: "app", via: "app", source_id: uid(), title: d.title, body: d.body, quote: d.body || d.title,
        reporter_kind: "member", handle_kind: "member", handle: "user-sample", reporter_name: ME.name, page: d.page || null, files: [],
        state: "filed", received_at: at, created_at: at, match_note: "Read: bug; no open item matched" });
      db.add("ask", { id: uid(), work_id: id, handle_kind: "member", handle: "user-sample", name: ME.name, source: "lemma", source_id: id,
        state: "open", asked_at: at });
      line(db, { id }, "report", "Filed from New report: Tom Okafor.");
      db.changed("triage_item");
      db.changed("triage_report");
      db.changed("ask");
      return { ok: true, number, item_id: id, created: true, message: `Filed as T-${number}; the first report of it. (In the demo the Lemma doesn't read or match it.)` };
    },

    triage_publish_known(input, db) {
      const d = inputOf(input);
      const it = itemOf(db, d.item);
      if (!it) return { ok: false, message: "No such item." };
      const existing = db.rows(KNOWN, "triage_known").find((k) => k.id === it.id);
      if (existing) db.patch(it.id, { title: d.title, state: d.state, page: d.page, updated_at: now(db).toISOString() }, "triage_known");
      else db.add("triage_known", { id: it.id, item_id: it.id, title: d.title, state: d.state || "investigating", page: d.page || null, updated_at: now(db).toISOString() });
      db.changed("triage_known");
      line(db, it, "known", `Published as a known issue: “${d.title}”.`);
      return { ok: true, message: `T-${it.number} is published as known.` };
    },

    triage_unpublish_known(input, db) {
      const d = inputOf(input);
      const it = itemOf(db, d.item);
      db.remove(it ? it.id : d.item, "triage_known");
      db.changed("triage_known");
      return { ok: true, message: "Taken off the known issues list." };
    },

    incidents_declare(input, db) {
      const d = inputOf(input);
      return { number: 15, message: `Declared INC-15 “${d.title}” with T-${String(d.source_label || "").split(" ")[0].replace("T-", "")}'s evidence. (In the demo no incident is opened.)` };
    },

    coding_start() {
      return { ok: true, message: "Coding agent took the task: in a Lemma it opens a branch and a draft pull request. (In the demo nothing runs.)" };
    },
  };
})();
