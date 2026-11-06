const names = [
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
function event(app, r, action, b, actor) {
  const ev = new Record(app.findCollectionByNameOrId("crew_events"));
  ev.set("parent", r.id);
  ev.set("action", action);
  ev.set("body", (b.data && b.data.body) || "");
  ev.set("actor", actor);
  ev.set("reported_agent", b.reported_agent || "");
  ev.set("reason", b.reason || "");
  ev.set("changes", b.data || {});
  ev.set("revision", 1);
  app.save(ev);
}
function active(app, col, id) {
  if (!id) return;
  const r = get(app, col, id);
  if (r.getBool("archived")) bad("Restore the " + col + " record first");
  return r;
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
  only(b, ["collection", "id", "parent", "query", "archived", "offset"]);
  if (!names.includes(b.collection)) bad("Unknown collection");
  const col = b.collection,
    params = {},
    clauses = [];
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
            : "parent";
    if (!["notes", "note_revisions", "reviews", "events"].includes(col))
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
    items: rows.slice(0, 100),
    has_more: rows.length > 100,
    next_offset: rows.length > 100 ? offset + 100 : null,
  });
}
function write(e, isAgent) {
  const b = e.requestInfo().body;
  only(b, [
    "action",
    "id",
    "expected_revision",
    "reported_agent",
    "reason",
    "data",
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
    const parts = b.action.split("."),
      kind = parts[0],
      op = parts[1];
    const col = {
      agent: "agents",
      bucket: "buckets",
      note: "notes",
      task: "tasks",
    }[kind];
    if (
      col &&
      ["create", "update", "restore", "claim", "comment"].includes(op)
    ) {
      if (
        (op === "restore" && kind !== "note") ||
        (["claim", "comment"].includes(op) && kind !== "task")
      )
        bad("Unsupported operation");
      let r =
        op === "create"
          ? new Record(app.findCollectionByNameOrId("crew_" + col))
          : get(app, col, b.id);
      if (op !== "create") check(r, b);
      if (
        isAgent &&
        ((kind === "agent" && d.archived !== undefined) ||
          (kind === "bucket" &&
            (d.archived !== undefined ||
              (op !== "create" && d.responsible_agent !== undefined))))
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
        event(app, r, b.action, b, actor);
        result = r;
        return;
      }
      let values = d;
      if (op === "restore") {
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
        only(d, ["assigned_agent"]);
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
      validateData(app, col, values, r);
      if (op === "create") {
        r.set("revision", 1);
        if (kind === "task") {
          r.set("status", "todo");
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
          withdraw(app, r, b, actor);
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
      if (kind === "note") snapshot(app, r, b, actor);
      event(app, r, b.action, b, actor);
      result = r;
      return;
    }
    if (kind === "review" && op === "request") {
      only(d, []);
      const t = active(app, "tasks", b.id);
      check(t, b);
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
      event(app, t, b.action, b, actor);
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
      event(app, r, b.action, b, actor);
      event(app, t, b.action, b, actor);
      result = r;
      return;
    }
    bad("Unknown action");
  });
  return e.json(200, result);
}
module.exports = { read, write };
