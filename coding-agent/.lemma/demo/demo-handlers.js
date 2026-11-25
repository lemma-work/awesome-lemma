// What the Coding agent's functions do to the in-memory sample in the "Try it"
// demo (_kit/src/demo.ts). No agent runs and nothing reaches GitHub: starting
// a task puts it in Working, asking a question puts it on the list, and a
// message to an agent is kept on the page. Each says what a Lemma would do.
(function () {
  const SESSIONS = "from coding_session order by";
  const TASKS = "from task order by";
  const ME = { id: "user-sample", name: "R. P." };
  const uid = () => "demo-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
  const inputOf = (input) => (input && input.data && typeof input.data === "object" ? input.data : input || {});
  const LABELS = { "system:lemma": "Lemma", "harness:claude-code": "Claude Code", "harness:codex": "Codex", "harness:cursor": "Cursor" };

  /** The sample's "now": its newest session, a minute on (as the app counts it). */
  function now(db) {
    const newest = db.rows(SESSIONS, "coding_session").reduce((m, s) => Math.max(m, Date.parse(s.last_event_at) || 0), 0);
    return new Date((newest || Date.now()) + 90_000);
  }

  window.__LEMMA_DEMO_HANDLERS__ = {
    coding_start(input, db) {
      const d = inputOf(input);
      const at = now(db).toISOString();
      const profile = d.profile_id || "system:lemma";
      const mac = profile.startsWith("harness:");
      const label = d.agent_label || LABELS[profile] || "Lemma";
      const offline = mac && d.availability && d.availability !== "READY";
      let task = d.task_id ? db.find(d.task_id, "task") : null;
      if (!task) {
        task = db.add("task", { id: uid(), title: d.title || "New task", description: d.brief || null, status: "in_progress", priority: "none",
          assignee_kind: "agent", assignee_agent: "coding_builder", assignee_name: label, source: d.source || "coding-agent",
          source_url: d.source_url || null, created_at: at });
      } else {
        db.patch(task.id, { status: "in_progress", assignee_kind: "agent", assignee_agent: "coding_builder", assignee_name: label }, "task");
      }
      for (const s of db.rows(SESSIONS, "coding_session")) {
        if (s.task_id === task.id && ["starting", "working", "needs_you"].includes(s.status)) db.patch(s.id, { status: "stopped", needs: "none", finished_at: at }, "coding_session");
      }
      const id = uid();
      db.add("coding_session", { id, task_id: task.id, scope: "team", title: task.title, source: task.source, source_url: task.source_url, repo: d.repo,
        ref: d.ref || null, push_to: d.push_to || null, profile_id: profile, model: d.model || null, place: mac ? "mac" : "cloud", agent_label: label,
        conversation_id: null, branch: offline ? null : "lemma/demo" + id.slice(5, 9), pr_number: null, pr_url: null, pr_state: "none", checks: "none",
        checks_text: null, mergeable: "unknown", head_sha: null, keep_green: d.keep_green !== false, tries: 0, max_tries: 3,
        status: offline ? "needs_you" : "working", needs: offline ? "waiting_mac" : "none",
        needs_text: offline ? `Assigned to ${label} on your Mac, which is offline.` : null, started_by: ME.id, started_by_name: ME.name,
        started_at: at, last_event_at: at, created_at: at, additions: null, deletions: null });
      db.add("coding_event", { id: uid(), task_id: task.id, session_id: id, at, kind: "assigned", actor: ME.name,
        text: `${ME.name} assigned it to ${label}${mac ? " on their Mac" : " in the cloud"}` });
      if (!offline) db.add("coding_event", { id: uid(), task_id: task.id, session_id: id, at, kind: "started", actor: label, text: `${label} started` });
      db.changed("task"); db.changed("coding_session"); db.changed("coding_event");
      db.note(`In the demo no agent starts: in a Lemma, ${label} gets its own branch of ${d.repo}, works the task and opens the pull request.`);
      return { ok: true, task_id: task.id, session_id: id, message: offline ? "Saved: it starts when your Mac is back." : `Handed to ${label}.` };
    },

    coding_ask_start(input, db) {
      const d = inputOf(input);
      const id = uid();
      db.add("coding_question", { id, question: d.question, repo: d.repo, ref: d.ref || "main", sha: null, state: "asking", answer: null, read: [],
        task_id: null, asked_by: ME.id, asked_by_name: ME.name, created_at: now(db).toISOString() });
      db.changed("coding_question");
      db.note("In the demo no agent reads the code: in a Lemma it checks out the repository and answers with the lines it comes from.");
      return { ok: true, question_id: id, message: "Asked." };
    },

    "POST pods/pod/conversations/[^/]+/messages/append"(input, db) {
      db.note("In the demo the agent doesn't hear you: in a Lemma your message goes into its conversation and it carries on.");
      return { id: uid(), status: "RUNNING" };
    },

    "POST pods/pod/conversations/[^/]+/stop"(input, db) {
      db.note("In the demo nothing was running: in a Lemma this stops the agent where it is.");
      return { status: "STOPPED" };
    },
  };
})();
