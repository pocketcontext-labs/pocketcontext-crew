// Versioned discovery stays available through the original two-tool envelope.
function object(properties, required) {
  return {
    type: "object",
    properties,
    required: required || [],
    additionalProperties: false,
  };
}
const str = { type: "string" },
  num = { type: "integer" },
  bool = { type: "boolean" };
const strings = { type: "array", items: str };
const nullable = { type: ["string", "null"] };
const proof = object({ id: str, worker_id: str, fence: num }, [
  "id",
  "worker_id",
  "fence",
]);
const compatibility = object({ idempotency_key: str, execution: proof });
function normalizeEnvelope(b) {
  if (!b || typeof b !== "object" || Array.isArray(b))
    throw new BadRequestError("Expected request object");
  if (
    !b.data ||
    typeof b.data !== "object" ||
    Array.isArray(b.data) ||
    b.data._crew === undefined
  )
    return b;
  const compat = b.data._crew;
  if (
    !compat ||
    typeof compat !== "object" ||
    Array.isArray(compat) ||
    Object.keys(compat).some(
      (k) => !["idempotency_key", "execution"].includes(k),
    )
  )
    throw new ApiError(400, "Invalid compatibility envelope", {
      reason: new ValidationError(
        "invalid_envelope",
        "Invalid compatibility envelope",
      ),
    });
  for (const key of ["idempotency_key", "execution"]) {
    if (compat[key] === undefined) continue;
    if (
      b[key] !== undefined &&
      b[key] !== null &&
      b[key] !== "" &&
      JSON.stringify(b[key]) !== JSON.stringify(compat[key])
    )
      throw new ApiError(400, "Conflicting operation metadata", {
        reason: new ValidationError(
          "conflicting_envelope",
          "Conflicting operation metadata",
        ),
      });
    b[key] = compat[key];
  }
  b.data = Object.assign({}, b.data);
  delete b.data._crew;
  return b;
}
const PROTOCOL_VERSION = 3;
// Operations a wake run needs: routine test/bridge, parent bridge, dispatcher
// and recipient execution, and proof-bearing task writes.
const EXECUTION_OPERATIONS = [
  "webhook.runtime.report",
  "execution.test_ack",
  "webhook.bridge.prepare",
  "webhook.bridge.parent",
  "webhook.bridge.sent",
  "webhook.bridge.ack",
  "execution.begin",
  "execution.renew",
  "execution.dispatched",
  "execution.complete",
  "task.comment",
  "task.update",
  "review.request",
];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k]);
    return out;
  }
  return value;
}
// The digest covers the complete document (including server version), so a
// client may skip rereading capabilities only while it holds the same digest.
function digestOf(doc) {
  return $security.sha256(JSON.stringify(canonical(doc)));
}
function document() {
  const record = {
    type: "object",
    properties: { id: str, revision: num },
    additionalProperties: true,
  };
  const agent = { name: str, brief: str, archived: bool };
  const bucket = {
    name: str,
    purpose: str,
    responsible_agent: nullable,
    archived: bool,
  };
  const note = {
    bucket: str,
    title: str,
    body: str,
    links: strings,
    archived: bool,
  };
  const task = {
    title: str,
    description: str,
    assigned_agent: str,
    labels: strings,
    status: { enum: ["todo", "in_progress", "needs_review", "done"] },
    draft: str,
    links: strings,
    archived: bool,
    readiness: { enum: ["waiting", "ready"] },
    waiting_reason: str,
  };
  const worker = { worker_id: str, fence: num };
  const event = { event_id: str, epoch: str, generation: num };
  const operations = {};
  function op(name, fields, required, options) {
    options = options || {};
    operations[name] = {
      data_schema: object(
        Object.assign({}, fields, { _crew: compatibility }),
        required,
      ),
      result_schema: options.result || record,
      authority: options.owner ? "owner_browser" : "shared_mcp",
      revision: options.revision || "none",
      idempotency: options.key ? "required" : "optional",
      ...options,
    };
  }
  op("agent.create", agent, ["name"]);
  op("agent.update", agent, [], { revision: "record" });
  op("agent.ensure", { name: str, brief: str, agent: str }, [], { key: true });
  op("bucket.create", bucket, ["name"]);
  op("bucket.update", bucket, [], { revision: "record" });
  op("bucket.assign", { agent: nullable }, ["agent"], { revision: "record" });
  op("note.create", note, ["bucket", "title"]);
  op("note.update", note, [], { revision: "record" });
  op("note.restore", { revision_id: str }, ["revision_id"], {
    revision: "record",
  });
  op("task.create", task, ["title"]);
  op("task.update", task, [], {
    revision: "record",
    execution_proof:
      "Required for governed tasks, including before first acquisition. Owner explicit Waiting releases governance.",
  });
  op(
    "task.claim",
    { assigned_agent: str, expected_generation: num },
    ["assigned_agent"],
    { revision: "record" },
  );
  op("task.comment", { body: str }, ["body"], {
    revision: "record",
    execution_proof:
      "Required for governed tasks; proof-bearing comments also require idempotency_key.",
  });
  op("review.request", {}, [], {
    revision: "task",
    execution_proof: "Required for governed tasks",
  });
  op("review.withdraw", {}, [], {
    revision: "review",
    execution_proof: "Required for governed tasks",
  });
  op(
    "review.decide",
    {
      decision: { enum: ["approved", "changes_requested", "rejected"] },
      note: str,
    },
    ["decision"],
    { revision: "review", owner: true },
  );
  op(
    "webhook.integration.update",
    {
      agent: str,
      dispatch_mode: { enum: ["native", "parent_bridge"] },
      instructions: str,
      role_instructions: str,
      reporting_instructions: str,
      subscriptions: strings,
    },
    [],
    { revision: "config" },
  );
  op(
    "webhook.credentials.update",
    { url: str, secret: str, clear_secret: bool },
    [],
    { revision: "config", owner: true },
  );
  op(
    "webhook.mapping.update",
    { agent: str, bot_ref: str, bot_name: str },
    ["agent", "bot_ref"],
    { revision: "mapping; 0 for creation" },
  );
  op(
    "webhook.instructions.sync",
    {
      instruction_revision: num,
      routine_ref: str,
      status: { enum: ["reported", "verified"] },
      instructions: str,
    },
    ["instruction_revision", "routine_ref", "status"],
    { revision: "config" },
  );
  op(
    "webhook.runtime.report",
    {
      event_id: str,
      context: { const: "webhook" },
      native_handoff: bool,
      parent_wake: bool,
      execution_protocol: bool,
    },
    ["event_id", "context", "native_handoff", "execution_protocol"],
    { revision: "config" },
  );
  for (const action of ["enable", "disable"])
    op("webhook." + action, {}, [], { revision: "config" });
  op("webhook.test", { recipient_agent_id: str }, [], {
    revision: "config",
    key: true,
    description:
      "Explicit diagnostic only. In parent_bridge mode an optional mapped recipient authorizes one diagnostic native handoff and acknowledgment while delivery is disabled; never task work.",
  });
  op(
    "webhook.bridge.prepare",
    { event_id: str, epoch: str, worker_id: str },
    ["event_id", "epoch", "worker_id"],
    { key: true },
  );
  op(
    "webhook.bridge.parent",
    { native_handoff: bool, execution_protocol: bool },
    ["native_handoff", "execution_protocol"],
    { revision: "bridge", key: true },
  );
  op(
    "webhook.bridge.sent",
    { sent: { const: true }, message_ref: str },
    ["sent"],
    { revision: "bridge", key: true },
  );
  op(
    "webhook.bridge.ack",
    { recipient_agent_id: str, automatic: { const: true } },
    ["recipient_agent_id", "automatic"],
    { revision: "bridge", key: true },
  );
  op("webhook.retry", { config_revision: num }, ["config_revision"], {
    revision: "delivery",
  });
  op(
    "webhook.catch_up",
    {
      tasks: {
        type: "array",
        maxItems: 100,
        items: object({ id: str, expected_revision: num }, [
          "id",
          "expected_revision",
        ]),
      },
    },
    ["tasks"],
    { revision: "config", key: true },
  );
  op(
    "webhook.routing.update",
    {
      triage_agent: nullable,
      max_bot_handoffs: { type: "integer", minimum: 1, maximum: 20 },
    },
    [],
    {
      revision: "routing",
      owner_only_fields: ["max_bot_handoffs"],
      description:
        "Supply triage_agent, max_bot_handoffs or both. Only the owner browser may change max_bot_handoffs.",
    },
  );
  op("execution.validate", event, ["event_id", "epoch", "generation"], {
    result: {
      type: "object",
      properties: {
        valid: bool,
        task: record,
        recipient_agent_id: str,
        recipient_bot_ref: str,
        dispatcher_agent_id: str,
        epoch: str,
        generation: num,
      },
      additionalProperties: true,
    },
    idempotency: "never cached",
  });
  op(
    "execution.test_ack",
    { event_id: str, epoch: str },
    ["event_id", "epoch"],
    { key: true },
  );
  op(
    "execution.begin",
    {
      ...event,
      worker_id: str,
      role: { enum: ["dispatcher", "recipient"] },
      native_handoff: bool,
      lease_seconds: { type: "integer", minimum: 30, maximum: 900 },
    },
    ["event_id", "epoch", "generation", "worker_id", "role"],
    { key: true },
  );
  op(
    "execution.acquire",
    {
      ...event,
      worker_id: str,
      phase: { enum: ["dispatch", "work"] },
      native_handoff: bool,
      lease_seconds: { type: "integer", minimum: 30, maximum: 900 },
    },
    ["event_id", "epoch", "generation", "worker_id", "phase"],
    { key: true },
  );
  op(
    "execution.dispatched",
    { ...worker, sent: { const: true }, message_ref: str },
    ["worker_id", "fence", "sent"],
    { revision: "execution", key: true },
  );
  for (const action of ["start", "handoff"])
    op("execution." + action, worker, ["worker_id", "fence"], {
      revision: "execution",
      key: true,
    });
  op(
    "execution.renew",
    {
      ...worker,
      lease_seconds: { type: "integer", minimum: 30, maximum: 900 },
    },
    ["worker_id", "fence"],
    { revision: "execution", key: true },
  );
  op(
    "execution.complete",
    {
      ...worker,
      outcome: { enum: ["completed", "failed"] },
      mark_done: bool,
      task_revision: num,
    },
    ["worker_id", "fence", "outcome"],
    { revision: "execution", key: true },
  );
  op(
    "execution.recover",
    { resolution: { enum: ["cancel", "retry"] } },
    ["resolution"],
    { revision: "execution", key: true, owner: true },
  );
  const collections = {};
  for (const name of [
    "agents",
    "buckets",
    "notes",
    "note_revisions",
    "tasks",
    "events",
    "reviews",
    "webhook_configs",
    "webhook_mappings",
    "webhook_routing",
    "webhook_deliveries",
    "webhook_attempts",
    "webhook_executions",
    "webhook_bridges",
  ])
    collections[name] = { result_schema: record };
  for (const [name, parent] of Object.entries({
    notes: "bucket",
    note_revisions: "note",
    events: "record",
    reviews: "task",
    webhook_deliveries: "config",
    webhook_attempts: "delivery",
    webhook_executions: "task",
    webhook_bridges: "config",
  }))
    collections[name].parent = parent;

  const fields = {
    agents: { ...agent },
    buckets: {
      ...bucket,
      responsible_agent_details: { type: ["object", "null"] },
    },
    notes: { ...note },
    tasks: {
      ...task,
      wake_generation: num,
      execution_required_generation: num,
      bot_handoffs: num,
      handoff_limited: bool,
      comment_wake_generation: num,
      comment_wake_event: str,
    },
    note_revisions: {
      note: str,
      title: str,
      body: str,
      links: strings,
      actor: str,
      reported_agent: str,
      reason: str,
    },
    events: {
      parent: str,
      action: str,
      actor: str,
      reported_agent: str,
      reason: str,
      body: str,
      changes: { type: "object" },
    },
    reviews: {
      task: str,
      draft: str,
      status: str,
      requested_by: str,
      reported_agent: str,
      decided_by: str,
      decided_at: str,
      decision_note: str,
    },
    webhook_configs: {
      scope: str,
      agent: str,
      adapter: str,
      dispatch_mode: { enum: ["native", "parent_bridge"] },
      enabled: bool,
      subscriptions: strings,
      destination_version: num,
      instructions: str,
      instruction_revision: num,
      applied_revision: num,
      sync_status: str,
      routine_ref: str,
      managed_hash: str,
      applied_hash: str,
      test_event_id: str,
      runtime_event_id: str,
      runtime_epoch: str,
      runtime_context: str,
      runtime_reported_at: str,
      runtime_destination_version: num,
      runtime_instruction_revision: num,
      runtime_native_handoff: bool,
      runtime_parent_wake: bool,
      runtime_execution_protocol: bool,
      previous_instructions: str,
      role_instructions: str,
      reporting_instructions: str,
      url_configured: bool,
      secret_configured: bool,
      receiver_host: str,
      setup: { type: "object" },
    },
    webhook_mappings: { agent: str, bot_ref: str, bot_name: str },
    webhook_routing: {
      singleton: str,
      instance_id: str,
      epoch: str,
      triage_agent: str,
      paused: bool,
      max_bot_handoffs: num,
    },
    webhook_deliveries: {
      config: str,
      task: str,
      agent: str,
      target_kind: str,
      generation: num,
      epoch: str,
      event_id: str,
      payload: { type: "object" },
      state: str,
      destination_version: num,
      attempts: num,
      retry_cycle: num,
      next_attempt_at: str,
      deadline_at: str,
      lease_until: str,
      last_error: str,
      accepted_at: str,
    },
    webhook_attempts: {
      delivery: str,
      phase: str,
      attempt: num,
      retry_cycle: num,
      status_code: num,
      error_code: str,
      started_at: str,
      finished_at: str,
    },
    webhook_bridges: {
      task_id: str,
      generation: num,
      dispatch_mode: str,
      event_type: str,
      instruction_revision: num,
      destination_version: num,
      overdue: bool,
      event_id: str,
      delivery: str,
      config: str,
      epoch: str,
      state: str,
      wake_worker_id: str,
      parent_native_handoff: bool,
      parent_execution_protocol: bool,
      recipient_agent: str,
      recipient_bot_ref: str,
      mapping_revision: num,
      wake_prepared_at: str,
      parent_received_at: str,
      send_prepared_at: str,
      send_reported_at: str,
      recipient_received_at: str,
      recipient_automatic: bool,
      deadline_at: str,
      message_ref: str,
    },
    webhook_executions: {
      event_id: str,
      delivery: str,
      task: str,
      agent: str,
      config: str,
      epoch: str,
      generation: num,
      destination_version: num,
      mapping_revision: num,
      state: str,
      worker_id: str,
      dispatch_worker_id: str,
      dispatch_fence: num,
      handoff_at: str,
      handoff_message_ref: str,
      handoff_capability_reported: bool,
      handoff_deadline_at: str,
      handoff_prepared_at: str,
      lease_expired: bool,
      waiting_overdue: bool,
      acquired_at: str,
      dispatch_started_at: str,
      fence: num,
      dispatch_attempts: num,
      lease_until: str,
      outcome_code: str,
      completed_at: str,
    },
  };
  const definitions = {};
  for (const [name, props] of Object.entries(fields)) {
    definitions[name] = {
      type: "object",
      properties: {
        id: str,
        revision: num,
        created: str,
        updated: str,
        ...props,
      },
      required: ["id", "revision"],
      additionalProperties: true,
    };
    collections[name].result_schema = { $ref: "#/$defs/" + name };
  }
  for (const [name, operation] of Object.entries(operations)) {
    const prefix = name.split(".")[0];
    let collection = {
      agent: "agents",
      bucket: "buckets",
      note: "notes",
      task: "tasks",
      review: "reviews",
      execution: "webhook_executions",
    }[prefix];
    if (prefix === "webhook")
      collection = name.startsWith("webhook.bridge.")
        ? "webhook_bridges"
        : name.includes("mapping")
          ? "webhook_mappings"
          : name.includes("routing")
            ? "webhook_routing"
            : ["webhook.test", "webhook.retry"].includes(name)
              ? "webhook_deliveries"
              : name === "webhook.catch_up"
                ? null
                : "webhook_configs";
    if (collection && !["execution.validate", "execution.begin"].includes(name))
      operation.result_schema = { $ref: "#/$defs/" + collection };
  }
  for (const action of ["prepare", "parent", "sent", "ack"])
    operations["webhook.bridge." + action].result_schema = {
      type: "object",
      properties: {
        ...definitions.webhook_bridges.properties,
        next_step: {
          enum: [
            "wake_parent",
            "dispatch_task",
            "test_complete",
            "send_test",
            "stop",
            "reconcile",
          ],
        },
        replayed: bool,
      },
      additionalProperties: true,
      description:
        "Durable bridge stage evidence. Only a fresh next_step authorizes a wake or diagnostic send; reconcile never authorizes replaying an external effect. Reported contexts are not authenticated bot identities.",
    };
  operations["execution.begin"].result_schema = {
    type: "object",
    properties: {
      ...definitions.webhook_executions.properties,
      next_step: { enum: ["self_work", "handoff", "work", "reconcile"] },
      replayed: bool,
      execution: proof,
      recipient_agent_id: str,
      recipient_bot_ref: str,
      dispatcher_agent_id: str,
      task_context: definitions.tasks,
    },
    additionalProperties: true,
  };
  operations["webhook.catch_up"].result_schema = {
    type: "object",
    additionalProperties: true,
    description:
      "Catch-up result and delivery identifiers; no execution completion implied.",
  };
  const metadata = $pocketcontext.crewVersion();
  return {
    id: "crew-capabilities",
    protocol_version: PROTOCOL_VERSION,
    server_version: metadata.version,
    server_commit: metadata.commit,
    $defs: definitions,
    collections,
    operations,
    write_envelope: object(
      {
        action: str,
        id: str,
        expected_revision: num,
        reported_agent: str,
        reason: str,
        data: { type: "object" },
        idempotency_key: str,
        execution: proof,
      },
      ["action", "data"],
    ),
    compatibility: {
      path: "data._crew",
      schema: compatibility,
      reason:
        "Use when a cached connector does not expose top-level execution or idempotency_key. Identical authorization and fencing checks apply; never omit coordination.",
    },
    limits: {
      shared_mcp_identity: true,
      worker_ids_are_identity: false,
      native_handoff_is_caller_reported: true,
      bridge_context_is_caller_reported: true,
      external_effects_exactly_once: false,
    },
    wake_reasons: require(`${__hooks}/crew_webhooks.js`).reasons.slice(),
    wake_rules: {
      comment:
        "Opt-in. Only an owner browser comment wakes; shared-MCP comments never wake. During a live execution the wake is deferred until execution.complete; payloads carry comment_event_id, never comment text.",
      bot_handoffs:
        "Consecutive shared-MCP assignment changes; any owner task write resets it. Exceeding webhook_routing.max_bot_handoffs applies the write but sets Waiting without a wake; only the owner can set Ready again.",
    },
    setup_entry:
      "Read webhook_configs; follow the canonical managed routine instructions. Never request credentials through chat or MCP.",
    subsets: {
      execution:
        'crew_read {collection:"capabilities", id:"execution"} returns only the wake-run operations with this document\'s capabilities_digest.',
    },
  };
}
function full() {
  const doc = document();
  doc.capabilities_digest = digestOf(doc);
  return doc;
}
function digest() {
  return full().capabilities_digest;
}
// Compact execution subset. Schemas are inlined without the per-operation
// compatibility property; data._crew is described once.
function execution(doc) {
  const operations = {};
  for (const name of EXECUTION_OPERATIONS) {
    const source = doc.operations[name];
    const properties = Object.assign({}, source.data_schema.properties);
    delete properties._crew;
    const op = {
      data: properties,
      required: source.data_schema.required,
      revision: source.revision,
      idempotency: source.idempotency,
    };
    if (source.execution_proof) op.execution_proof = source.execution_proof;
    operations[name] = op;
  }
  operations["execution.begin"].returns =
    "Execution record with next_step self_work|handoff|work|reconcile, execution proof {id,worker_id,fence}, task_context, recipient_agent_id, recipient_bot_ref, dispatcher_agent_id; replays return reconcile without proof.";
  for (const action of ["prepare", "parent", "sent", "ack"])
    operations["webhook.bridge." + action].returns =
      "Bridge record (id, revision, stages) with next_step wake_parent|dispatch_task|test_complete|send_test|stop|reconcile.";
  return {
    id: "crew-capabilities-execution",
    subset: "execution",
    protocol_version: doc.protocol_version,
    server_version: doc.server_version,
    server_commit: doc.server_commit,
    capabilities_digest: doc.capabilities_digest,
    operations,
    write_envelope: doc.write_envelope.properties,
    compatibility: {
      path: "data._crew",
      fields: ["idempotency_key", "execution"],
      reason: doc.compatibility.reason,
    },
    limits: doc.limits,
    wake_reasons: doc.wake_reasons,
    full: 'crew_read {collection:"capabilities"} lists every operation, collection and result schema.',
  };
}
function describe(selector) {
  const doc = full();
  return {
    items: [selector === "execution" ? execution(doc) : doc],
    has_more: false,
    next_offset: null,
  };
}
module.exports = {
  describe,
  digest,
  normalizeEnvelope,
  PROTOCOL_VERSION,
  EXECUTION_OPERATIONS,
};
