// What Sprints' writes do to the in-memory sample in the "Try it" demo
// (_kit/src/demo.ts). Nothing here leaves the page. Starting and closing a
// sprint, and asking the Lemma again, only say what they would do (the notes
// in demo.json); adding, taking out and estimating change the sample, so the
// plan's capacity fills as it would.
(function () {
  const SPRINTS = "from sprints_sprint order by";
  const ITEMS = "from sprints_item limit";
  const TASKS = "from task where parent_id is null";
  const EST = "from sprints_estimate limit";
  const SUGGESTIONS = "from sprints_suggestion where state";
  const LEAD = "Maya Wong";

  const now = () => new Date().toISOString();
  const uid = () => "demo-" + Math.random().toString(36).slice(2, 10);
  const inputOf = (input) => (input && input.data && typeof input.data === "object" ? input.data : input || {});

  function sprintOf(db, which) {
    const all = db.rows(SPRINTS, "sprints_sprint");
    const running = all.find((s) => s.state === "running" || s.state === "closing");
    const planned = all.find((s) => s.state === "planned");
    if (which === "next") return planned;
    if (which === "current" || which == null || which === "") return running || planned;
    return all.find((s) => String(s.number) === String(which).replace("#", ""));
  }

  function taskOf(db, ref) {
    const r = String(ref).replace("#", "");
    return db.rows(TASKS, "task").find((t) => String(t.id) === r || String(t.number) === r) || null;
  }

  function itemsOf(db, sprint) {
    return db.rows(ITEMS, "sprints_item").filter((i) => i.sprint_id === sprint.id && !i.removed_at);
  }

  function points(db, taskId) {
    const e = db.rows(EST, "sprints_estimate").find((r) => String(r.id) === String(taskId));
    return e ? Number(e.points) : null;
  }

  function add(input, db) {
    const data = inputOf(input);
    const sprint = sprintOf(db, data.sprint);
    if (!sprint) return { message: "No sprint to add it to." };
    const running = sprint.state === "running" || sprint.state === "closing";
    const added = [];
    for (const ref of data.tasks || []) {
      const t = taskOf(db, ref);
      if (!t || itemsOf(db, sprint).some((i) => i.task_id === t.id)) continue;
      const at = now();
      db.add("sprints_item", {
        id: uid(), sprint_id: sprint.id, task_id: t.id, in_at_start: false, added_at: at, added_by: LEAD, removed_at: null,
        removed_by: null, outcome: "open", carried_from: null, nth: 1, points_at_add: points(db, t.id), started_at: null, done_at: null,
      });
      if (running) {
        db.add("sprints_event", {
          id: uid(), sprint_id: sprint.id, task_id: t.id, kind: "added", at, actor_kind: "person", actor_name: LEAD,
          detail: { points: points(db, t.id), source: t.source, source_id: t.source_id }, via: "app",
        });
      }
      const who = (data.assign || {})[t.id];
      if (who && who.agent) db.patch(t.id, { assignee_kind: "agent", assignee_agent: who.agent, assignee_user_id: null, assignee_name: null }, "task");
      else if (who && who.name) db.patch(t.id, { assignee_kind: "person", assignee_user_id: who.user_id || null, assignee_name: who.name, assignee_agent: null }, "task");
      for (const s of db.rows(SUGGESTIONS, "sprints_suggestion")) {
        if (s.kind === "pull_in" && s.state === "open" && (s.task_ids || [])[0] === t.id) db.patch(s.id, { state: "taken" }, "sprints_suggestion");
      }
      added.push("#" + t.number);
    }
    ["sprints_item", "sprints_event", "task", "sprints_suggestion"].forEach((table) => db.changed(table));
    return { sprint_number: sprint.number, added, message: added.length ? `Added ${added.join(", ")} to Sprint ${sprint.number}${running ? " after the start" : " to the plan"}.` : "Nothing new to add." };
  }

  function remove(input, db) {
    const data = inputOf(input);
    const sprint = sprintOf(db, data.sprint);
    if (!sprint) return { message: "No sprint." };
    const taken = [];
    for (const ref of data.tasks || []) {
      const t = taskOf(db, ref);
      const item = t && itemsOf(db, sprint).find((i) => i.task_id === t.id);
      if (!item) continue;
      if (sprint.state === "planned") db.remove(item.id, "sprints_item");
      else {
        const at = now();
        db.patch(item.id, { removed_at: at, removed_by: LEAD, outcome: "backlog" }, "sprints_item");
        db.add("sprints_event", { id: uid(), sprint_id: sprint.id, task_id: t.id, kind: "removed", at, actor_kind: "person", actor_name: LEAD, detail: { points: points(db, t.id), to: data.to }, via: "app" });
      }
      taken.push("#" + t.number);
    }
    if (data.to === "next") add({ tasks: data.tasks, sprint: "next" }, db);
    for (const s of db.rows(SUGGESTIONS, "sprints_suggestion")) {
      if (s.kind === "move_out" && s.state === "open" && (s.task_ids || []).every((id) => (data.tasks || []).includes(id))) db.patch(s.id, { state: "taken" }, "sprints_suggestion");
    }
    ["sprints_item", "sprints_event", "sprints_suggestion"].forEach((table) => db.changed(table));
    return { message: `Took ${taken.join(", ")} out of Sprint ${sprint.number}.` };
  }

  function estimate(input, db) {
    const data = inputOf(input);
    const t = taskOf(db, data.task);
    if (!t) return { message: "No such task." };
    const have = db.rows(EST, "sprints_estimate").find((r) => String(r.id) === String(t.id));
    if (data.points == null) { if (have) db.remove(t.id, "sprints_estimate"); }
    else if (have) db.patch(t.id, { points: data.points }, "sprints_estimate");
    else db.add("sprints_estimate", { id: t.id, points: data.points });
    db.changed("sprints_estimate");
    return { task_id: t.id, points: data.points, message: `#${t.number}: ${data.points == null ? "cleared" : data.points + " pts"}.` };
  }

  window.__LEMMA_DEMO_HANDLERS__ = {
    sprints_add: add,
    sprints_remove: remove,
    sprints_estimate: estimate,
    sprints_needs_you: () => ({ decide: 0, counts: {}, message: "" }),
    sprints_tick: () => ({ opened: [], reconciled: 0, risks: 0, message: "" }),
  };
})();
