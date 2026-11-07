const capabilities = require(`${__hooks}/crew_capabilities.js`);
const webhooks = require(`${__hooks}/crew_webhooks.js`);
const execution = require(`${__hooks}/crew_execution.js`);
const names = [
  ...webhooks.collections,
  ...execution.collections,
  "agents",
  "buckets",
  "notes",
  "note_revisions",
  "tasks",
  "events",
  "reviews",
];
const fields = {
  agents: ["name", "brief", "archived"],
  buckets: ["name", "purpose", "responsible_agent", "archived"],
  notes: ["title", "body", "links", "archived"],
  tasks: [
    "title",
    "description",
    "assigned_agent",
    "labels",
    "status",
    "draft",
    "links",
    "archived",
    "readiness",
    "waiting_reason",
  ],
};
function bad(m) {
  throw new BadRequestError(m);
}
function only(o, allowed) {
  for (const k of Object.keys(o))
    if (!allowed.includes(k)) bad("Unsupported field: " + k);
}
function get(app, col, id) {
  if (!/^[a-z0-9]{15}$/.test(id || ""))
    throw new NotFoundError("Record not found");
  return app.findRecordById("crew_" + col, id);
}
function check(r, b) {
  if (
    !Number.isInteger(b.expected_revision) ||
    b.expected_revision !== r.getInt("revision")
  )
    throw new ApiError(409, "Revision conflict; reread and reassess", {});
}
function event(app, r, action, b, actor, changes) {
  const ev = new Record(app.findCollectionByNameOrId("crew_events"));
  ev.set("parent", r.id);
  ev.set("action", action);
  ev.set("body", (b.data && b.data.body) || "");
  ev.set("actor", actor);
  ev.set("reported_agent", b.reported_agent || "");
  ev.set("reason", b.reason || "");
  ev.set("changes", changes || b.data || {});
  ev.set("revision", 1);
  app.save(ev);
}
function active(app, col, id) {
  if (!id) return;
  const r = get(app, col, id);
  if (r.getBool("archived")) bad("Restore the " + col + " record first");
  return r;
}
// IDs take precedence; exact names must be unique, including inactive records.
function resolveAgent(app, ref) {
  if (ref === null || ref === "") return "";
  if (typeof ref !== "string" || ref.length > 200)
    bad("Agent must be an ID, exact name, null or empty string");
  if (/^[a-z0-9]{15}$/.test(ref)) {
    const ids = app.findRecordsByFilter("crew_agents", "id={:id}", "", 1, 0, {
      id: ref,
    });
    if (ids.length) return ids[0].id;
  }
  const rows = app.findRecordsByFilter(
    "crew_agents",
    "name={:name}",
    "",
    2,
    0,
    { name: ref },
  );
  if (!rows.length) bad("Agent not found");
  if (rows.length > 1) bad("Agent name is ambiguous; use an agent ID");
  return rows[0].id;
}
function bucketExport(app, r) {
  const result = r.publicExport();
  const id = r.getString("responsible_agent");
  const agent = id ? get(app, "agents", id) : null;
  result.responsible_agent_details = agent
    ? { id: agent.id, name: agent.getString("name") }
    : null;
  return result;
}
function validateData(app, col, d, r) {
  if (d.archived !== undefined && typeof d.archived !== "boolean")
    bad("archived must be boolean");
  for (const k of ["labels", "links"])
    if (
      d[k] !== undefined &&
      (!Array.isArray(d[k]) ||
        d[k].length > 100 ||
        d[k].some((x) => typeof x !== "string" || x.length > 500))
    )
      bad(k + " must contain at most 100 short strings");
  if (d.readiness !== undefined && !["waiting", "ready"].includes(d.readiness))
    bad("readiness must be waiting or ready");
  if (
    d.waiting_reason !== undefined &&
    (typeof d.waiting_reason !== "string" || d.waiting_reason.length > 2000)
  )
    bad("Invalid waiting_reason");
  if (d.status === "needs_review")
    bad("Use review.request to enter Needs review");
  if (d.labels && d.labels.some((x) => x.toLowerCase() === "human"))
    bad("Human is derived from pending reviews");
  if (
    d.responsible_agent &&
    d.responsible_agent !== r.getString("responsible_agent")
  )
    active(app, "agents", d.responsible_agent);
  if (d.assigned_agent && d.assigned_agent !== r.getString("assigned_agent"))
    active(app, "agents", d.assigned_agent);
  if (d.links)
    for (const id of d.links) {
      if (!/^[a-z0-9]{15}$/.test(id)) bad("Links must be note IDs");
      get(app, "notes", id);
    }
}
function snapshot(app, n, b, actor) {
  const r = new Record(app.findCollectionByNameOrId("crew_note_revisions"));
  for (const k of ["title", "body", "links", "revision"]) r.set(k, n.get(k));
  r.set("note", n.id);
  r.set("actor", actor);
  r.set("reported_agent", b.reported_agent || "");
  r.set("reason", b.reason || "");
  app.save(r);
}
function pending(app, task) {
  return app.findRecordsByFilter(
    "crew_reviews",
    'task={:task} && status="pending"',
    "",
    100,
    0,
    { task },
  );
}
function withdraw(app, t, b, actor) {
  for (const r of pending(app, t.id)) {
    r.set("status", "withdrawn");
    r.set("revision", r.getInt("revision") + 1);
    app.save(r);
    event(app, r, "review.withdraw", b, actor);
  }
}
function read(e) {
  const b = e.requestInfo().body;
  only(b, [
    "collection",
    "id",
    "parent",
    "query",
    "archived",
    "offset",
    "responsible_agent",
  ]);
  if (b.collection === "capabilities")
    return e.json(200, capabilities.describe());
  if (!names.includes(b.collection)) bad("Unknown collection");
  const col = b.collection,
    params = {},
    clauses = [];
  if (b.responsible_agent !== undefined) {
    if (col !== "buckets")
      bad("Responsible agent filter is only supported for buckets");
    params.agent = resolveAgent(e.app, b.responsible_agent);
    clauses.push("responsible_agent={:agent}");
  }
  if (b.id) {
    clauses.push("id={:id}");
    params.id = b.id;
  }
  if (b.parent) {
    const key =
      col === "notes"
        ? "bucket"
        : col === "note_revisions"
          ? "note"
          : col === "reviews"
            ? "task"
            : col === "webhook_executions"
              ? "task"
              : ["webhook_deliveries", "webhook_bridges"].includes(col)
                ? "config"
                : col === "webhook_attempts"
                  ? "delivery"
                  : "parent";
    if (
      ![
        "notes",
        "note_revisions",
        "reviews",
        "events",
        "webhook_deliveries",
        "webhook_bridges",
        "webhook_attempts",
        "webhook_executions",
      ].includes(col)
    )
      bad("Invalid parent filter");
    clauses.push(key + "={:parent}");
    params.parent = b.parent;
  }
  if (["agents", "buckets", "tasks"].includes(col))
    clauses.push(b.archived ? "archived=true" : "archived=false");
  if (col === "notes")
    clauses.push(
      b.archived
        ? "(archived=true || bucket.archived=true)"
        : "(archived=false && bucket.archived=false)",
    );
  if (b.query) {
    params.q = b.query;
    const searchFields =
      col === "notes"
        ? ["title", "body"]
        : col === "tasks"
          ? ["title", "description", "draft"]
          : ["agents", "buckets"].includes(col)
            ? ["name"]
            : [];
    if (!searchFields.length) bad("Search not supported here");
    clauses.push(
      "(" + searchFields.map((k) => k + " ~ {:q}").join(" || ") + ")",
    );
  }
  const offset = Number.isInteger(b.offset) && b.offset >= 0 ? b.offset : 0;
  const rows = e.app.findRecordsByFilter(
    "crew_" + col,
    clauses.join(" && "),
    col === "note_revisions" ? "-revision" : "-created",
    101,
    offset,
    params,
  );
  return e.json(200, {
    items: rows
      .slice(0, 100)
      .map((r) =>
        col === "buckets"
          ? bucketExport(e.app, r)
          : webhooks.collections.includes(col)
            ? webhooks.exported(r, e.app)
            : execution.collections.includes(col)
              ? execution.exported(r)
              : r,
      ),
    has_more: rows.length > 100,
    next_offset: rows.length > 100 ? offset + 100 : null,
  });
}
function write(e, isAgent) {
  const b = capabilities.normalizeEnvelope(e.requestInfo().body);
  only(b, [
    "action",
    "id",
    "expected_revision",
    "reported_agent",
    "reason",
    "data",
    "idempotency_key",
    "execution",
  ]);
  if (
    typeof b.action !== "string" ||
    typeof (b.reported_agent || "") !== "string" ||
    (b.reported_agent || "").length > 200 ||
    typeof (b.reason || "") !== "string" ||
    (b.reason || "").length > 2000
  )
    bad("Invalid attribution");
  const d = b.data || {};
  if (typeof d !== "object" || Array.isArray(d)) bad("data must be an object");
  const actor = (isAgent ? "mcp:" : "owner:") + e.auth.id;
  let result;
  e.app.runInTransaction((app) => {
    if (b.action.startsWith("execution.")) {
      result = execution.handle(app, b, actor, isAgent);
      return;
    }
    if (b.action === "agent.ensure" || b.action.startsWith("webhook.")) {
      result = webhooks.handle(app, b, actor, isAgent);
      return;
    }
    const parts = b.action.split("."),
      kind = parts[0],
      op = parts[1];
    if (parts.length !== 2) bad("Unknown action");
    const col = {
      agent: "agents",
      bucket: "buckets",
      note: "notes",
      task: "tasks",
    }[kind];
    if (
      col &&
      ["create", "update", "restore", "claim", "comment", "assign"].includes(op)
    ) {
      if (
        (op === "restore" && kind !== "note") ||
        (op === "assign" && kind !== "bucket") ||
        (["claim", "comment"].includes(op) && kind !== "task")
      )
        bad("Unsupported operation");
      let r =
        op === "create"
          ? new Record(app.findCollectionByNameOrId("crew_" + col))
          : get(app, col, b.id);
      if (op !== "create") check(r, b);
      if (kind === "task" && op !== "create")
        execution.guardTaskWrite(app, r, b, isAgent);
      const oldTask =
        kind === "task" && op !== "create" ? webhooks.state(app, r) : null;
      let autoWithdraw = false;
      if (
        isAgent &&
        ((kind === "agent" && d.archived !== undefined) ||
          (kind === "bucket" && d.archived !== undefined))
      )
        throw new ForbiddenError("Owner action required");
      if (
        op !== "create" &&
        r.getBool("archived") &&
        d.archived !== false &&
        op !== "restore"
      )
        bad("Restore the record first");
      if (kind === "note")
        active(
          app,
          "buckets",
          op === "create" ? d.bucket : r.getString("bucket"),
        );
      if (op === "comment") {
        only(d, ["body"]);
        if (
          typeof d.body !== "string" ||
          !d.body.trim() ||
          d.body.length > 20000
        )
          bad("Comment required");
        if (b.execution) {
          result = webhooks.idempotent(
            app,
            b,
            () => {
              event(app, r, b.action, b, actor);
              return r.publicExport();
            },
            true,
          );
        } else {
          event(app, r, b.action, b, actor);
          result = r;
        }
        return;
      }
      let values = d;
      if (op === "assign") {
        only(d, ["agent"]);
        if (d.agent === undefined)
          bad("agent is required; use null or empty string to clear");
        values = { responsible_agent: d.agent };
      } else if (op === "restore") {
        only(d, ["revision_id"]);
        const old = get(app, "note_revisions", d.revision_id);
        if (old.getString("note") !== r.id)
          bad("Revision belongs to another note");
        values = {
          title: old.getString("title"),
          body: old.getString("body"),
          links: JSON.parse(old.getString("links") || "[]") || [],
          archived: false,
        };
      } else if (op === "claim") {
        only(d, ["assigned_agent", "expected_generation"]);
        if (
          d.expected_generation !== undefined &&
          (!Number.isInteger(d.expected_generation) ||
            r.getInt("wake_generation") !== d.expected_generation ||
            !webhooks.eligible(webhooks.state(app, r)))
        )
          throw new ApiError(
            409,
            "Task is no longer ready at the requested generation",
            {},
          );
        if (r.getString("assigned_agent"))
          throw new ApiError(409, "Task is already assigned", {});
        if (!d.assigned_agent) bad("Agent required");
        values = { assigned_agent: d.assigned_agent, status: "in_progress" };
      } else
        only(
          d,
          fields[col].concat(
            op === "create" && kind === "note" ? ["bucket"] : [],
          ),
        );
      const oldAgent = r.getString("responsible_agent");
      if (kind === "bucket" && values.responsible_agent !== undefined)
        values = {
          ...values,
          responsible_agent: resolveAgent(app, values.responsible_agent),
        };
      validateData(app, col, values, r);
      if (op === "create") {
        r.set("revision", 1);
        if (kind === "task") {
          r.set("status", "todo");
          r.set("readiness", "waiting");
          r.set("created_by_agent", b.reported_agent || "");
        }
      } else r.set("revision", r.getInt("revision") + 1);
      if (kind === "task" && op !== "create") {
        if (values.status !== undefined && pending(app, r.id).length)
          bad(
            "Resolve or withdraw the pending review before changing task status",
          );
        if (
          (values.draft !== undefined &&
            values.draft !== r.getString("draft")) ||
          values.archived === true
        ) {
          autoWithdraw =
            pending(app, r.id).length > 0 &&
            values.draft !== undefined &&
            values.draft !== r.getString("draft");
          withdraw(app, r, b, actor);
          if (autoWithdraw) values = { ...values, readiness: "waiting" };
          if (
            r.getString("status") === "needs_review" &&
            values.status === undefined
          )
            r.set("status", "in_progress");
        }
        if (values.status === "done" && pending(app, r.id).length)
          bad("Resolve or withdraw the pending review before completion");
      }
      for (const k of Object.keys(values)) r.set(k, values[k]);
      if (values.archived !== undefined) {
        r.set("archived_at", values.archived ? new Date().toISOString() : "");
        r.set("archived_by", values.archived ? actor : "");
      }
      app.save(r);
      if (kind === "task")
        webhooks.transition(app, r, oldTask, { autoWithdraw });
      if (
        kind === "task" &&
        !isAgent &&
        op === "update" &&
        d.readiness === "waiting"
      ) {
        r.set("execution_required_generation", 0);
        app.save(r);
      }
      if (kind === "task") execution.invalidateStale(app, r, b, actor);
      if (kind === "agent" && values.archived === true)
        webhooks.deactivate(app, r.id, b, actor);
      if (kind === "note") snapshot(app, r, b, actor);
      const changes = { ...d };
      if (kind === "task") {
        changes.readiness = r.getString("readiness");
        changes.wake_generation = r.getInt("wake_generation");
      }
      if (kind === "bucket" && values.responsible_agent !== undefined)
        changes.responsible_agent = {
          old: oldAgent,
          new: r.getString("responsible_agent"),
        };
      event(app, r, b.action, b, actor, changes);
      result = kind === "bucket" ? bucketExport(app, r) : r;
      return;
    }
    if (kind === "review" && op === "request") {
      only(d, []);
      const t = active(app, "tasks", b.id);
      check(t, b);
      execution.guardTaskWrite(app, t, b, isAgent);
      const oldTask = webhooks.state(app, t);
      if (!t.getString("draft").trim()) bad("Add a draft first");
      if (pending(app, t.id).length)
        throw new ApiError(409, "A review is already pending", {});
      const r = new Record(app.findCollectionByNameOrId("crew_reviews"));
      r.set("task", t.id);
      r.set("draft", t.getString("draft"));
      r.set("status", "pending");
      r.set("revision", 1);
      r.set("requested_by", actor);
      r.set("reported_agent", b.reported_agent || "");
      app.save(r);
      t.set("status", "needs_review");
      t.set("revision", t.getInt("revision") + 1);
      app.save(t);
      webhooks.transition(app, t, oldTask, {});
      execution.invalidateStale(app, t, b, actor);
      event(app, t, b.action, b, actor, {
        ...d,
        readiness: t.getString("readiness"),
        wake_generation: t.getInt("wake_generation"),
      });
      result = r;
      return;
    }
    if (kind === "review" && ["decide", "withdraw"].includes(op)) {
      if (isAgent && op === "decide")
        throw new ForbiddenError("Only the owner can decide a review");
      only(d, op === "decide" ? ["decision", "note"] : []);
      const r = get(app, "reviews", b.id);
      check(r, b);
      if (r.getString("status") !== "pending") bad("Review already closed");
      const t = active(app, "tasks", r.getString("task"));
      execution.guardTaskWrite(app, t, b, isAgent);
      const oldTask = webhooks.state(app, t);
      if (op === "decide") {
        if (!["approved", "changes_requested", "rejected"].includes(d.decision))
          bad("Invalid decision");
        if (t.getString("draft") !== r.getString("draft"))
          bad("Draft changed; request a new review");
        r.set("status", d.decision);
        r.set("decision_note", d.note || "");
        r.set("decided_by", actor);
        r.set("decided_at", new Date().toISOString());
      } else r.set("status", "withdrawn");
      r.set("revision", r.getInt("revision") + 1);
      app.save(r);
      t.set("status", "in_progress");
      t.set("revision", t.getInt("revision") + 1);
      app.save(t);
      webhooks.transition(app, t, oldTask, { outcome: r.getString("status") });
      execution.invalidateStale(app, t, b, actor);
      event(app, r, b.action, b, actor);
      event(app, t, b.action, b, actor, {
        ...d,
        readiness: t.getString("readiness"),
        wake_generation: t.getInt("wake_generation"),
      });
      result = r;
      return;
    }
    bad("Unknown action");
  });
  return e.json(200, result);
}
module.exports = { read, write };
