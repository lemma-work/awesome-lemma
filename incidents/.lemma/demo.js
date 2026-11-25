// What Incidents' functions do to the in-memory sample in the "Try it" demo
// (_kit/src/demo.ts). Nothing here leaves the page, and nothing is posted to
// Slack. Sending an update, changing status or severity, handing over the
// revert and accepting a follow-up change the sample as they would a Lemma;
// resolving INC-14 drafts the write-up the canvas shows (from
// .lemma/shots/fixtures/demo/incidents-resolve.json, made by
// bin/demo-fixtures.py from the sample function's own demo_writeup).
(function () {
  const INC = "from incidents_incident order by";
  const EVENTS = "from incidents_event order by";
  const UPDATES = "from incidents_update order by";
  const TASKS = "from task where source = 'incidents'";
  const ME = "Mara Lind";
  const WORDS = { declared: "Declared", investigating: "Investigating", fixing: "Fixing", monitoring: "Monitoring", resolved: "Resolved" };

  const uid = () => "demo-" + Math.random().toString(36).slice(2, 10);
  const inputOf = (input) => (input && input.data && typeof input.data === "object" ? input.data : input || {});

  function incidentOf(db, ref) {
    const r = String(ref || "").replace(/^inc-?/i, "").replace("#", "");
    return db.rows(INC, "incidents_incident").find((i) => i.id === r || String(i.number) === r) || null;
  }

  /** The sample's "now": its newest event, a few minutes on (as the app counts it). */
  function now(db) {
    const newest = db.rows(EVENTS, "incidents_event").reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), 0);
    return new Date((newest || Date.now()) + 60_000);
  }

  function event(db, inc, kind, actor, text, extra) {
    const at = (extra && extra.at) || now(db).toISOString();
    db.add("incidents_event", Object.assign({ id: uid(), incident_id: inc.id, at, kind, source: "app", source_id: uid(), actor, text,
      url: null, starred: false, detail: null }, extra || {}));
    db.changed("incidents_event");
  }

  window.__LEMMA_DEMO_HANDLERS__ = {
    incidents_set(input, db) {
      const d = inputOf(input);
      const inc = incidentOf(db, d.incident);
      if (!inc) return { message: "No such incident." };
      const patch = {};
      if (d.status && d.status !== inc.status) {
        patch.status = d.status;
        event(db, inc, "status", ME, `${ME.split(" ")[0]} set status to ${WORDS[d.status]}`);
      }
      if (d.severity && d.severity !== inc.severity) {
        patch.severity = d.severity;
        event(db, inc, "severity", ME, `${ME.split(" ")[0]} changed severity to ${d.severity.toUpperCase()}`);
      }
      if (d.writeup_state === "reviewed") Object.assign(patch, { writeup_state: "reviewed", reviewed_by: ME });
      if (d.hypothesis && d.hypothesis_state) {
        db.patch(d.hypothesis, { state: d.hypothesis_state }, "incidents_hypothesis");
        db.changed("incidents_hypothesis");
      }
      if (Object.keys(patch).length) {
        db.patch(inc.id, patch, "incidents_incident");
        db.changed("incidents_incident");
      }
      return { message: d.writeup_state === "reviewed" ? "Marked the write-up reviewed." : `INC-${inc.number} updated. In a Lemma the pinned header in Slack changes too.` };
    },

    incidents_send_update(input, db) {
      const d = inputOf(input);
      const inc = incidentOf(db, d.incident);
      const draft = db.rows(UPDATES, "incidents_update").find((u) => u.incident_id === (inc && inc.id) && u.state === "draft");
      if (!inc || !draft) return { message: "No drafted update to send." };
      const at = now(db);
      db.patch(draft.id, { state: "sent", sent_at: at.toISOString(), sent_by: ME, body: d.body || draft.body,
        delivery: { channel: "sent", announce: "sent", email: "sent" } }, "incidents_update");
      db.patch(inc.id, { update_due_at: new Date(at.getTime() + 30 * 60_000).toISOString() }, "incidents_incident");
      event(db, inc, "update", ME, `Update sent by ${ME.split(" ")[0]} to #${inc.channel_name}, #incidents and 3 people`, { at: at.toISOString() });
      db.changed("incidents_update");
      db.changed("incidents_incident");
      return { message: "Sent to the channel, #incidents and 3 people by email. (In the demo nothing leaves the page.)" };
    },

    incidents_followup(input, db) {
      const d = inputOf(input);
      const inc = incidentOf(db, d.incident);
      if (!inc) return { message: "No such incident." };
      const followups = (typeof inc.followups === "string" ? JSON.parse(inc.followups) : inc.followups) || [];
      const picked = d.proposal ? followups.find((f) => f.key === d.proposal) : null;
      if (picked && d.dismiss) {
        picked.state = "dismissed";
        db.patch(inc.id, { followups: followups.slice() }, "incidents_incident");
        db.changed("incidents_incident");
        return { message: `Set aside: ${picked.title}.` };
      }
      const title = d.revert ? `Revert ${d.change || "the change"} (INC-${inc.number})` : d.title || (picked && picked.title);
      const number = Math.max(0, ...db.rows(TASKS, "task").map((t) => Number(t.number) || 0)) + 1;
      const id = uid();
      db.add("task", { id, number, title, status: "todo", assignee_kind: d.revert ? "agent" : picked && picked.owner_name ? "person" : "none",
        assignee_agent: d.revert ? "pod_default" : null, assignee_name: picked && picked.owner_name ? picked.owner_name : null,
        due_on: null, source_id: inc.id, done_at: null, created_at: now(db).toISOString() });
      db.changed("task");
      if (picked) {
        picked.state = "accepted";
        picked.task_id = id;
        db.patch(inc.id, { followups: followups.slice() }, "incidents_incident");
        db.changed("incidents_incident");
      }
      if (d.revert) event(db, inc, "role", ME, `${ME.split(" ")[0]} handed the revert to the Lemma's assistant`);
      return { message: `Task #${number} ${title}${d.revert ? ", on the Lemma" : ""}.` };
    },

    incidents_resolve(input, db) {
      const d = inputOf(input);
      const inc = incidentOf(db, d.incident);
      if (!inc) return { message: "No such incident." };
      const drafted = db.fixture("demo/incidents-resolve");
      if (!drafted || inc.number !== 14) {
        db.patch(inc.id, { status: "resolved", resolved_at: now(db).toISOString(), writeup_state: "none" }, "incidents_incident");
        db.changed("incidents_incident");
        return { message: `INC-${inc.number} resolved.` };
      }
      db.add("incidents_event", drafted.event);
      for (const f of drafted.flags) db.add("incidents_flag", Object.assign({ created_at: drafted.event.at }, f));
      db.patch(inc.id, { status: "resolved", resolved_at: drafted.event.at, writeup_state: "to_review", writeup: drafted.writeup,
        writeup_at: drafted.writeup.drafted_at, writeup_path: "/incidents/INC-14.md", followups: drafted.followups, update_due_at: null },
      "incidents_incident");
      for (const u of db.rows(UPDATES, "incidents_update")) if (u.incident_id === inc.id && u.state === "draft") db.patch(u.id, { state: "discarded" }, "incidents_update");
      db.changed("incidents_event");
      db.changed("incidents_flag");
      db.changed("incidents_update");
      db.changed("incidents_incident");
      return { message: "INC-14 resolved. The write-up is drafted: in a Lemma, the Lemma writes it from the timeline." };
    },
  };
})();
