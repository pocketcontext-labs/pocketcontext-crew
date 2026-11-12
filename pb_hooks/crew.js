const capabilities = require(`${__hooks}/crew_capabilities.js`);
const webhooks = require(`${__hooks}/crew_webhooks.js`);
const execution = require(`${__hooks}/crew_execution.js`);
const attachments = require(`${__hooks}/crew_attachments.js`);
const session = require(`${__hooks}/crew_session.js`);
const names = [
  ...webhooks.collections,
  ...execution.collections,
  ...attachments.collections,
  "agents",
  "buckets",
  "notes",
  "note_revisions",
  "tasks",
  "events",
  "reviews",
];
const fields = {
  agents: ["name", "brief", "archived", "kind"],
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
// Advisory task claims (0.18.0). A claim records the claiming session's
// reported name (attribution only) and a lease; it never wakes anyone.
function claimUntil() {
  return new Date(Date.now() + session.LEASE_MS).toISOString();
}
function claimer(b) {
  const name = (b.reported_agent || "").trim();
  if (!name) bad("reported_agent (your session name) is required to claim");
  return name;
}
// Claim refusals are answered as HTTP 409 with data.reason.code plus the
// current claim, so the loser can name the winner.
function claimRefusal(t, code, message) {
  return {
    status: 409,
    message,
    data: {
      reason: { code, message },
      claimed_by: t.getString("claimed_by"),
      claim_until: t.getString("claim_until"),
    },
  };
}
// A write by the live claimer renews its lease (the caller saves the record).
function renewByClaimer(t, b) {
  if (
    webhooks.claimState(t) !== "live" ||
    !(b.reported_agent || "").trim() ||
    (b.reported_agent || "").trim() !== t.getString("claimed_by")
  )
    return false;
  t.set("claim_until", claimUntil());
  return true;
}
// Attachment writes on a claimed task renew the claimer's lease.
function renewAfterAttachment(app, b) {
  const d = b.data || {};
  let id = "";
  if (b.action === "attachment.add")
    id = typeof d.task === "string" ? d.task : "";
  else if (["attachment.archive", "attachment.restore"].includes(b.action)) {
    try {
      const a = app.findRecordById("crew_attachments", b.id);
      if (a.getString("parent_kind") === "task") id = a.getString("parent");
    } catch (_) {}
  }
  if (!/^[a-z0-9]{15}$/.test(id)) return;
  let t;
  try {
    t = app.findRecordById("crew_tasks", id);
  } catch (_) {
    return;
  }
  if (renewByClaimer(t, b)) app.save(t);
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
  return ev;
}
// Any reader write to a task ends a run of consecutive work-client handoffs.
function ownerTouch(t) {
  t.set("bot_handoffs", 0);
  t.set("handoff_limited", false);
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
  if (d.kind !== undefined && !webhooks.AGENT_KINDS.includes(d.kind))
    bad("kind must be bot, external or human");
  if (d.readiness !== undefined && !["waiting", "ready"].includes(d.readiness))
    bad("readiness must be ready, or on_hold (stored as waiting)");
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
// Fields that a projection may name, beyond the collection's non-hidden schema
// fields. Projection only subsets the normal export, so redacted values such as
// webhook URLs and secrets can never be selected.
const derivedFields = {
  buckets: ["responsible_agent_details"],
  webhook_configs: [
    "secret_configured",
    "url_configured",
    "receiver_host",
    "setup",
  ],
  webhook_executions: ["waiting_overdue", "lease_expired"],
  webhook_bridges: ["overdue"],
  tasks: ["path", "url", "claim_state"],
  notes: ["path", "url"],
  upload_links: ["state"],
  settings: ["storage_used_bytes", "max_file_bytes", "max_active_attachments"],
};
const redactedFields = ["url", "secret", "secret_ciphertext"];
const taskStatuses = ["todo", "in_progress", "needs_review", "done"];
function projectable(app, col) {
  const out = ["collectionId", "collectionName"];
  const collection = app.findCollectionByNameOrId("crew_" + col);
  for (const f of collection.fields)
    if (!f.getHidden() && !redactedFields.includes(f.getName()))
      out.push(f.getName());
  return out.concat(derivedFields[col] || []);
}
function projection(app, col, requested) {
  if (requested === undefined) return null;
  if (
    !Array.isArray(requested) ||
    !requested.length ||
    requested.length > 50 ||
    requested.some((x) => typeof x !== "string" || !x)
  )
    bad("fields must be a non-empty array of at most 50 field names");
  const allowed = projectable(app, col);
  for (const f of requested)
    if (!allowed.includes(f))
      bad("Unknown or unavailable field for " + col + ": " + f);
  const keep = ["id", "revision"];
  for (const f of requested) if (!keep.includes(f)) keep.push(f);
  return keep;
}
function pick(value, keep) {
  const out = {};
  for (const k of keep) if (value[k] !== undefined) out[k] = value[k];
  return out;
}
function sinceFilter(value) {
  if (typeof value !== "string" || value.length > 64)
    bad("Invalid changed_since");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    bad("changed_since must be an RFC3339 timestamp");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) bad("changed_since must be an RFC3339 timestamp");
  // PocketBase stores UTC autodates as "YYYY-MM-DD HH:MM:SS.mmmZ".
  return new Date(ms).toISOString().replace("T", " ");
}
function actionableOverdue(app, r) {
  if (!require(`${__hooks}/crew_bridge.js`).exported(r).overdue) return false;
  let t;
  try {
    t = get(app, "tasks", r.getString("task_id"));
  } catch (_) {
    return false;
  }
  if (
    t.getBool("archived") ||
    t.getString("status") === "done" ||
    t.getInt("wake_generation") !== r.getInt("generation")
  )
    return false;
  const created = t.getString("created_by_agent"),
    recipient = r.getString("recipient_agent");
  if (created && recipient) {
    try {
      if (get(app, "agents", recipient).getString("name") === created)
        return false;
    } catch (_) {}
  }
  return true;
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
    "limit",
    "fields",
    "assigned_agent",
    "status",
    "readiness",
    "label",
    "changed_since",
    "overdue",
    "agent",
    "claim_state",
  ]);
  if (b.collection === "capabilities")
    return e.json(200, capabilities.describe(b.id));
  if (b.agent !== undefined && b.collection !== "session")
    bad("agent is only supported for the session collection");
  // One object: the agent, the short prompt the reader copies and the full
  // session instructions.
  if (b.collection === "session")
    return e.json(200, session.describe(e.app, b.agent));
  if (!names.includes(b.collection)) bad("Unknown collection");
  const col = b.collection,
    params = {},
    clauses = [],
    // Parallel raw SQL for task reads with a label filter: PocketBase filters
    // cannot match one exact element of a JSON array.
    sql = [];
  if (b.responsible_agent !== undefined) {
    if (col !== "buckets")
      bad("Responsible agent filter is only supported for buckets");
    params.agent = resolveAgent(e.app, b.responsible_agent);
    clauses.push("responsible_agent={:agent}");
  }
  for (const k of [
    "assigned_agent",
    "status",
    "readiness",
    "label",
    "claim_state",
  ])
    if (b[k] !== undefined && col !== "tasks")
      bad(k + " filter is only supported for tasks");
  if (b.assigned_agent !== undefined) {
    params.assigned = resolveAgent(e.app, b.assigned_agent);
    clauses.push("assigned_agent={:assigned}");
    sql.push("COALESCE([[assigned_agent]],'')={:assigned}");
  }
  if (b.status !== undefined) {
    const statuses = Array.isArray(b.status) ? b.status : [b.status];
    if (
      !statuses.length ||
      statuses.length > taskStatuses.length ||
      statuses.some((x) => !taskStatuses.includes(x))
    )
      bad("status must be one or more of " + taskStatuses.join(", "));
    const keys = statuses.map((x, i) => {
      params["status" + i] = x;
      return "{:status" + i + "}";
    });
    clauses.push("(" + keys.map((k) => "status=" + k).join(" || ") + ")");
    sql.push("[[status]] IN (" + keys.join(",") + ")");
  }
  if (b.readiness !== undefined) {
    if (!["waiting", "on_hold", "ready"].includes(b.readiness))
      bad("readiness must be on_hold (waiting) or ready");
    params.readiness = b.readiness === "on_hold" ? "waiting" : b.readiness;
    clauses.push("readiness={:readiness}");
    sql.push("[[readiness]]={:readiness}");
  }
  if (b.label !== undefined) {
    if (typeof b.label !== "string" || !b.label || b.label.length > 500)
      bad("label must be a non-empty string");
    params.label = b.label;
    sql.push(
      "EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid([[labels]]) AND json_type([[labels]])='array' THEN [[labels]] ELSE '[]' END) AS label WHERE label.type='text' AND label.value={:label})",
    );
  }
  if (b.claim_state !== undefined) {
    // claim_until is an ISO UTC timestamp, so text order is time order.
    params.now = new Date().toISOString();
    if (b.claim_state === "live") {
      clauses.push("claim_until>{:now}");
      sql.push("COALESCE([[claim_until]],'')>{:now}");
    } else if (b.claim_state === "expired") {
      clauses.push(
        "((claimed_by!='' || claim_until!='') && claim_until<={:now})",
      );
      sql.push(
        "((COALESCE([[claimed_by]],'')!='' OR COALESCE([[claim_until]],'')!='') AND COALESCE([[claim_until]],'')<={:now})",
      );
    } else if (b.claim_state === "") {
      clauses.push("claimed_by='' && claim_until=''");
      sql.push(
        "COALESCE([[claimed_by]],'')='' AND COALESCE([[claim_until]],'')=''",
      );
    } else bad("claim_state must be live, expired or an empty string");
  }
  if (b.changed_since !== undefined) {
    params.since = sinceFilter(b.changed_since);
    clauses.push("updated>={:since}");
    sql.push("[[updated]]>={:since}");
  }
  let limit = 100;
  if (b.limit !== undefined) {
    if (!Number.isInteger(b.limit) || b.limit < 1 || b.limit > 100)
      bad("limit must be an integer from 1 to 100");
    limit = b.limit;
  }
  const keep = projection(e.app, col, b.fields);
  if (b.id) {
    clauses.push("id={:id}");
    sql.push("[[id]]={:id}");
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
        "attachments",
        "upload_links",
      ].includes(col)
    )
      bad("Invalid parent filter");
    clauses.push(key + "={:parent}");
    params.parent = b.parent;
  }
  if (["agents", "buckets", "tasks", "attachments"].includes(col)) {
    clauses.push(b.archived ? "archived=true" : "archived=false");
    sql.push(b.archived ? "[[archived]]=TRUE" : "[[archived]]=FALSE");
  }
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
          : ["agents", "buckets", "attachments"].includes(col)
            ? ["name"]
            : [];
    if (!searchFields.length) bad("Search not supported here");
    clauses.push(
      "(" + searchFields.map((k) => k + " ~ {:q}").join(" || ") + ")",
    );
    // Same contains semantics as the PocketBase ~ operator.
    const text = String(b.query);
    params.qlike = text.includes("%")
      ? text
      : "%" + text.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    sql.push(
      "(" +
        searchFields
          .map((k) => "[[" + k + "]] LIKE {:qlike} ESCAPE '\\'")
          .join(" OR ") +
        ")",
    );
  }
  const offset = Number.isInteger(b.offset) && b.offset >= 0 ? b.offset : 0;
  if (b.overdue !== undefined) {
    if (col !== "webhook_bridges")
      bad("overdue filter is only supported for webhook_bridges");
    if (b.overdue !== true) bad("overdue must be true");
    // Unresolved task wakes past their deadline, newest first, for tasks the
    // owner can still act on: the bridge is the task's current wake
    // generation, the task is active and not done, and the recipient did not
    // create it for itself. Rows are history; nothing here retries a wake.
    clauses.push(
      "event_type='task.wake' && recipient_received_at='' && parent_received_at='' && (state='wake_prepared' || state='send_prepared')",
    );
  }
  let rows;
  if (b.overdue !== undefined) {
    const all = e.app
      .findRecordsByFilter(
        "crew_webhook_bridges",
        clauses.join(" && "),
        "-created",
        0,
        0,
        params,
      )
      .filter((r) => actionableOverdue(e.app, r));
    rows = all.slice(offset, offset + limit + 1);
  } else if (col === "tasks" && b.label !== undefined) {
    rows = arrayOf(new Record());
    let query = e.app.recordQuery("crew_tasks");
    for (const clause of sql) query = query.andWhere($dbx.exp(clause, params));
    query
      .orderBy("created DESC", "id DESC")
      .limit(limit + 1)
      .offset(offset)
      .all(rows);
  } else
    rows = e.app.findRecordsByFilter(
      "crew_" + col,
      clauses.join(" && "),
      col === "note_revisions"
        ? "-revision"
        : col === "attachments"
          ? "position"
          : "-created",
      limit + 1,
      offset,
      params,
    );
  return e.json(200, {
    items: rows.slice(0, limit).map((r) => {
      const value =
        col === "buckets"
          ? bucketExport(e.app, r)
          : webhooks.collections.includes(col)
            ? webhooks.exported(r, e.app)
            : execution.collections.includes(col)
              ? execution.exported(r)
              : attachments.collections.includes(col)
                ? attachments.exported(r, e.app)
                : col === "tasks" || col === "notes"
                  ? webhooks.linkedExport(e.app, col, r)
                  : keep
                    ? r.publicExport()
                    : r;
      return keep ? pick(value, keep) : value;
    }),
    has_more: rows.length > limit,
    next_offset: rows.length > limit ? offset + limit : null,
  });
}
function write(e, isAgent) {
  // The route allows 90 MiB for multipart files; JSON keeps PocketBase's
  // default 32 MiB so a large JSON body is never decoded in memory.
  const type = String(e.request.header.get("Content-Type") || "").toLowerCase();
  if (
    !type.startsWith("multipart/form-data") &&
    e.request.contentLength > 33554432
  )
    throw new ApiError(
      413,
      "JSON writes are limited to 32 MiB; send files as multipart",
      {},
    );
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
  // Owner-browser-only, like webhook credentials: refused before idempotency.
  if (isAgent && b.action === "upload_link.create")
    throw new ForbiddenError("Create upload links in the owner UI");
  const files = attachments.collect(e, b);
  const actor = (isAgent ? "mcp:" : "owner:") + e.auth.id;
  let result, refusal;
  e.app.runInTransaction((app) => {
    if (attachments.ACTIONS.includes(b.action)) {
      result = attachments.handle(app, e, b, actor, isAgent, files, helpers);
      renewAfterAttachment(app, b);
      return;
    }
    if (b.action.startsWith("execution.")) {
      result = execution.handle(app, b, actor);
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
      [
        "create",
        "update",
        "restore",
        "claim",
        "claim_renew",
        "release",
        "comment",
        "assign",
      ].includes(op)
    ) {
      if (
        (op === "restore" && kind !== "note") ||
        (op === "assign" && kind !== "bucket") ||
        (["claim", "claim_renew", "release", "comment"].includes(op) &&
          kind !== "task")
      )
        bad("Unsupported operation");
      // On hold is the reader's name for waiting; it is stored as waiting.
      if (kind === "task" && d.readiness === "on_hold") d.readiness = "waiting";
      let r =
        op === "create"
          ? new Record(app.findCollectionByNameOrId("crew_" + col))
          : get(app, col, b.id);
      // A live claim answers before the revision check, so the loser of
      // two simultaneous claims learns who won instead of rereading.
      if (
        kind === "task" &&
        op === "claim" &&
        webhooks.claimState(r) === "live"
      ) {
        refusal = claimRefusal(
          r,
          "already_claimed",
          "Task is already claimed by " +
            r.getString("claimed_by") +
            " until " +
            r.getString("claim_until"),
        );
        return;
      }
      if (op !== "create") check(r, b);
      // Any caller may put a task on hold during a live execution, without
      // proof, when the write changes nothing else; the execution is
      // cancelled below in the same transaction.
      const holdOnly =
        kind === "task" &&
        ["update", "release"].includes(op) &&
        d.readiness === "waiting" &&
        Object.keys(d).every((k) =>
          ["readiness", "waiting_reason"].includes(k),
        );
      if (kind === "task" && op !== "create")
        execution.guardTaskWrite(app, r, b, isAgent, { hold: holdOnly });
      const oldTask =
        kind === "task" && op !== "create" ? webhooks.state(app, r) : null;
      let autoWithdraw = false;
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
        // Files become attachments of the task (all or nothing), and
        // attachment:new-N in the body becomes their IDs before it is stored.
        const commentFiles = (app2) => {
          const out = attachments.stageComment(
            app2,
            r,
            d,
            files,
            {
              b,
              actor,
              isAgent,
              ownerTouch: !isAgent,
              link: null,
            },
            helpers,
          );
          const changes = { body: d.body };
          if (out.saved.length)
            changes.attachments = out.saved.map((a) => a.id);
          const ev = event(app2, r, b.action, b, actor, changes);
          // The live claimer's comment renews its lease (no revision change,
          // like every comment).
          if (renewByClaimer(r, b)) app2.save(r);
          return { ev, saved: out.saved, withdrawn: out.withdrawn };
        };
        const withFiles = (value, staged) => {
          if (staged.saved.length) {
            value.attachments = staged.saved.map((a) => a.publicExport());
            value.review_withdrawn = staged.withdrawn;
          }
          return value;
        };
        if (b.execution) {
          // Links are added after the idempotent step so the stored result
          // stays free of them and a replay reflects the current title.
          result = webhooks.withLinks(
            app,
            "tasks",
            webhooks.idempotent(
              app,
              files.length ? attachments.fingerprint(b, files) : b,
              () => {
                const staged = commentFiles(app);
                return withFiles(r.publicExport(), staged);
              },
              true,
            ),
            r.getString("title"),
          );
        } else {
          const staged = commentFiles(app),
            comment = staged.ev;
          // Loop prevention, not a privilege: only reader comments wake.
          // Work-client comments never wake, so bots cannot ping-pong.
          if (!isAgent) {
            ownerTouch(r);
            app.save(r);
            webhooks.ownerComment(app, r, comment.id);
            execution.invalidateStale(app, r, b, actor);
          }
          result = withFiles(webhooks.linkedExport(app, "tasks", r), staged);
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
        if (!d.assigned_agent) bad("Agent required");
        // A live claim by anyone wins; the loser learns who holds it.
        if (webhooks.claimState(r) === "live") {
          refusal = claimRefusal(
            r,
            "already_claimed",
            "Task is already claimed by " +
              r.getString("claimed_by") +
              " until " +
              r.getString("claim_until"),
          );
          return;
        }
        const assignee = r.getString("assigned_agent");
        if (assignee) {
          // The assigned agent claims its own task: Ready and To do, or
          // In progress with an empty or expired claim.
          if (resolveAgent(app, d.assigned_agent) !== assignee)
            throw new ApiError(409, "Task is already assigned", {});
          const status = r.getString("status");
          if (!(
            (r.getString("readiness") === "ready" && status === "todo") ||
            status === "in_progress"
          ))
            throw new ApiError(
              409,
              "Only a Ready To do task, or an In progress task without a live claim, can be claimed",
              {
                reason: new ValidationError(
                  "not_claimable",
                  "Only a Ready To do task, or an In progress task without a live claim, can be claimed",
                ),
              },
            );
          values = {
            status: "in_progress",
            claimed_by: claimer(b),
            claim_until: claimUntil(),
          };
        } else {
          // Unassigned: assign and start, as before; record the claim under
          // the reported name, or the agent's name when none was reported.
          const id = resolveAgent(app, d.assigned_agent);
          values = {
            assigned_agent: d.assigned_agent,
            status: "in_progress",
            claimed_by:
              (b.reported_agent || "").trim() ||
              (id ? get(app, "agents", id).getString("name") : ""),
            claim_until: claimUntil(),
          };
        }
      } else if (op === "claim_renew") {
        only(d, []);
        const name = claimer(b);
        if (webhooks.claimState(r) !== "live") {
          refusal = claimRefusal(
            r,
            "claim_expired",
            "No live claim to renew; claim the task again",
          );
          return;
        }
        if (r.getString("claimed_by") !== name) {
          refusal = claimRefusal(
            r,
            "not_claimer",
            "Task is claimed by " + r.getString("claimed_by"),
          );
          return;
        }
        values = { claim_until: claimUntil() };
      } else if (op === "release") {
        only(d, ["readiness", "waiting_reason"]);
        // The claimer, the owner (reader) or anyone once the claim expired.
        if (
          isAgent &&
          webhooks.claimState(r) === "live" &&
          (b.reported_agent || "").trim() !== r.getString("claimed_by")
        ) {
          refusal = claimRefusal(
            r,
            "not_claimer",
            "Task is claimed by " +
              r.getString("claimed_by") +
              " until " +
              r.getString("claim_until"),
          );
          return;
        }
        values = { claimed_by: "", claim_until: "" };
        if (r.getString("status") === "in_progress") values.status = "todo";
        if (d.readiness !== undefined) values.readiness = d.readiness;
        if (d.waiting_reason !== undefined)
          values.waiting_reason = d.waiting_reason;
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
      if (kind === "task" && values.assigned_agent)
        values = {
          ...values,
          assigned_agent: resolveAgent(app, values.assigned_agent),
        };
      validateData(app, col, values, r);
      let staged = [];
      if (op === "create" && files.length)
        staged = attachments.stageCreate(app, kind, r, values, files, {
          b,
          actor,
          isAgent,
          ownerTouch: !isAgent,
          link: null,
        });
      if (kind === "task" || kind === "note")
        attachments.checkRefs(app, kind, r, values, op);
      if (op === "create") {
        r.set("revision", 1);
        if (kind === "task") {
          r.set("status", "todo");
          r.set("readiness", "waiting");
          r.set("created_by_agent", b.reported_agent || "");
        }
      } else r.set("revision", r.getInt("revision") + 1);
      if (kind === "task" && op === "update") {
        // Done ends the claim; otherwise the live claimer's update renews it.
        if (
          values.status === "done" &&
          (r.getString("claimed_by") || r.getString("claim_until"))
        )
          values = { ...values, claimed_by: "", claim_until: "" };
        else if (values.status !== "done" && renewByClaimer(r, b))
          values = { ...values, claim_until: r.getString("claim_until") };
      }
      if (kind === "agent" && op === "create" && values.kind === undefined)
        values = { ...values, kind: "bot" };
      const oldKind =
        kind === "agent" && op !== "create" ? r.getString("kind") || "bot" : "";
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
          if (autoWithdraw)
            values = {
              ...values,
              readiness: "waiting",
              waiting_reason:
                values.waiting_reason !== undefined
                  ? values.waiting_reason
                  : "Draft edited",
            };
          if (
            r.getString("status") === "needs_review" &&
            values.status === undefined
          )
            r.set("status", "in_progress");
        }
        if (values.status === "done" && pending(app, r.id).length)
          bad("Resolve or withdraw the pending review before completion");
      }
      let hopStop = null;
      // Reader writes end a run of work-client handoffs. A work client may set
      // a hop-limited task Ready, but that does not reset the counter or the
      // marker, so the next work-client reassignment stops it again.
      if (kind === "task" && !isAgent) ownerTouch(r);
      else if (kind === "task") {
        const before = op === "create" ? "" : r.getString("assigned_agent");
        if (
          values.assigned_agent !== undefined &&
          (values.assigned_agent || "") !== before
        ) {
          const count = r.getInt("bot_handoffs") + 1,
            max = webhooks.maxBotHandoffs(app);
          r.set("bot_handoffs", count);
          if (count > max) {
            // The write applies, but the loop stops for owner review: Waiting
            // emits no wake and invalidates any current execution authority.
            values = {
              ...values,
              readiness: "waiting",
              waiting_reason: "Bot hand-off limit reached",
            };
            r.set("handoff_limited", true);
            hopStop = { bot_handoffs: count, max_bot_handoffs: max };
          }
        }
      }
      // A hold reason describes the current hold only: going Ready clears it
      // unless the same write sets one.
      if (
        kind === "task" &&
        values.readiness === "ready" &&
        (op === "create" || r.getString("readiness") !== "ready") &&
        values.waiting_reason === undefined
      )
        values = { ...values, waiting_reason: "" };
      for (const k of Object.keys(values)) r.set(k, values[k]);
      if (values.archived !== undefined) {
        r.set("archived_at", values.archived ? new Date().toISOString() : "");
        r.set("archived_by", values.archived ? actor : "");
      }
      app.save(r);
      const selfStarted =
        kind === "task" &&
        webhooks.transition(app, r, oldTask, {
          autoWithdraw,
          selfStartAgent:
            isAgent && op === "create" ? b.reported_agent || "" : "",
        });
      // Setting Waiting releases execution governance for every caller.
      if (
        kind === "task" &&
        ["update", "release"].includes(op) &&
        d.readiness === "waiting"
      ) {
        r.set("execution_required_generation", 0);
        app.save(r);
      }
      // Going on hold (from Ready, by any route or automatically) cancels
      // every unfinished execution and makes queued wakes stale.
      let holdCancelled = [];
      if (
        kind === "task" &&
        oldTask &&
        oldTask.readiness === "ready" &&
        r.getString("readiness") === "waiting"
      ) {
        if (r.getInt("wake_generation") === oldTask.generation)
          webhooks.advanceGeneration(app, r);
        holdCancelled = execution.cancelForHold(app, r, b, actor);
      }
      if (kind === "task") execution.invalidateStale(app, r, b, actor);
      if (kind === "agent" && values.archived === true)
        webhooks.deactivate(app, r.id, b, actor);
      // An agent that stops being a bot can no longer be woken: its queued
      // wakes are cancelled and, as dispatcher, the integration is disabled.
      else if (
        kind === "agent" &&
        oldKind === "bot" &&
        values.kind !== undefined &&
        values.kind !== "bot" &&
        !r.getBool("archived")
      )
        webhooks.deactivate(app, r.id, b, actor);
      if (kind === "note") snapshot(app, r, b, actor);
      const changes = { ...d };
      // A create with files records the resolved text, never the request's
      // attachment:new-N placeholders (values may be a copy of d).
      if (staged.length)
        for (const f of ["description", "draft", "body"])
          if (typeof d[f] === "string" && typeof values[f] === "string")
            changes[f] = values[f];
      if (kind === "task") {
        changes.readiness = r.getString("readiness");
        changes.wake_generation = r.getInt("wake_generation");
        if (
          r.getString("readiness") === "waiting" &&
          values.waiting_reason !== undefined
        )
          changes.waiting_reason = r.getString("waiting_reason");
        if (holdCancelled.length) changes.cancelled_executions = holdCancelled;
        if (["claim", "claim_renew", "release"].includes(op)) {
          changes.status = r.getString("status");
          changes.claimed_by = r.getString("claimed_by");
          changes.claim_until = r.getString("claim_until");
        } else if (
          values.claim_until !== undefined &&
          values.claim_until !== ""
        )
          changes.claim_until = r.getString("claim_until");
        else if (values.claimed_by === "") changes.claim_cleared = true;
      }
      if (kind === "agent" && values.kind !== undefined)
        changes.kind = r.getString("kind");
      if (kind === "bucket" && values.responsible_agent !== undefined)
        changes.responsible_agent = {
          old: oldAgent,
          new: r.getString("responsible_agent"),
        };
      event(app, r, b.action, b, actor, changes);
      if (staged.length)
        attachments.recordCreated(app, kind, r, staged, { b, actor });
      if (selfStarted)
        event(
          app,
          r,
          "task.self_started",
          { reason: "created", reported_agent: b.reported_agent, data: {} },
          actor,
          { assignee: r.getString("assigned_agent"), reason: "created" },
        );
      if (hopStop)
        event(
          app,
          r,
          "task.hop_limit",
          { reason: "hop_limit", reported_agent: b.reported_agent, data: {} },
          actor,
          { ...hopStop, readiness: "waiting" },
        );
      result =
        kind === "bucket"
          ? bucketExport(app, r)
          : kind === "task" || kind === "note"
            ? webhooks.linkedExport(app, col, r)
            : r;
      if (staged.length)
        result.attachments = staged.map((a) => a.publicExport());
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
      r.set("attachments", attachments.snapshot(app, t.id));
      r.set("status", "pending");
      r.set("revision", 1);
      r.set("requested_by", actor);
      r.set("reported_agent", b.reported_agent || "");
      app.save(r);
      if (!isAgent) ownerTouch(t);
      t.set("status", "needs_review");
      t.set("revision", t.getInt("revision") + 1);
      app.save(t);
      webhooks.transition(app, t, oldTask, {});
      // The holder's own review request completes its execution
      // (outcome review_requested) instead of invalidating it.
      const finished = isAgent
        ? execution.completeForReview(app, t, b, actor)
        : null;
      execution.invalidateStale(app, t, b, actor);
      const changes = {
        ...d,
        readiness: t.getString("readiness"),
        wake_generation: t.getInt("wake_generation"),
      };
      if (finished) changes.execution_completed = finished.id;
      event(app, t, b.action, b, actor, changes);
      result = r.publicExport();
      if (finished)
        result.execution_completed = {
          id: finished.id,
          revision: finished.getInt("revision"),
          state: finished.getString("state"),
          outcome_code: finished.getString("outcome_code"),
        };
      return;
    }
    if (kind === "review" && ["decide", "withdraw"].includes(op)) {
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
        if (!attachments.snapshotMatches(app, r))
          bad("Attachments changed; request a new review");
        r.set("status", d.decision);
        r.set("decision_note", d.note || "");
        r.set("decided_by", actor);
        r.set("decided_at", new Date().toISOString());
      } else r.set("status", "withdrawn");
      r.set("revision", r.getInt("revision") + 1);
      app.save(r);
      if (!isAgent) ownerTouch(t);
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
  if (refusal) return e.json(409, refusal);
  return e.json(200, result);
}
// Shared with attachment operations so a review withdrawal is recorded the
// same way as a draft edit's.
const helpers = { pending, withdraw, ownerTouch };
function uploadInfo(e) {
  return attachments.uploadInfo(e);
}
function uploadFiles(e) {
  return attachments.uploadFiles(e, helpers);
}
module.exports = { read, write, uploadInfo, uploadFiles };
