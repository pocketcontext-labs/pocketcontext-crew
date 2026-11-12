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
const reviewOptions = {
  type: "array",
  maxItems: 20,
  items: object(
    {
      key: { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" },
      label: { type: "string", minLength: 1, maxLength: 200 },
      body: { type: "string", minLength: 1, maxLength: 100000 },
    },
    ["key", "label", "body"],
  ),
};
const optionDecisions = {
  type: "array",
  maxItems: 20,
  items: object(
    {
      key: str,
      decision: { enum: ["approved", "rejected"] },
      note: { type: "string", maxLength: 20000 },
    },
    ["key", "decision"],
  ),
};
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
  const agent = {
    name: str,
    brief: str,
    archived: bool,
    kind: {
      enum: ["bot", "external", "human"],
      description:
        "bot (a Grok bot woken by webhook; the default), external (a coder session the owner starts by hand; never woken) or human. Only bots have a bot mapping or receive wakes. Changing a bot to another kind cancels its queued wakes and, for the dispatcher, disables the integration.",
    },
  };
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
    status: {
      enum: ["todo", "in_progress", "needs_review", "done", "wont_do"],
      description:
        "Done and wont_do (Won't do) are terminal: they end any claim, never wake a bot and leaving either reopens the task. Enter needs_review only with review.request.",
    },
    draft: str,
    links: strings,
    archived: bool,
    readiness: {
      enum: ["waiting", "on_hold", "ready"],
      description:
        "On hold (stored and read as waiting; on_hold is a write alias) or ready. An on-hold task never wakes a bot. Going on hold cancels any unfinished execution (outcome put_on_hold) and advances the wake generation.",
    },
    waiting_reason: {
      type: "string",
      description:
        "Hold reason. Crew sets it on automatic holds (Draft edited, Review withdrawn, Bot hand-off limit reached); going Ready clears it unless the same write sets one.",
    },
    release: {
      type: "string",
      maxLength: 32,
      description:
        "The release that shipped the task, for example 0.19.0; trimmed, empty for none.",
    },
    review_mode: {
      enum: ["", "crew", "in_session"],
      description:
        "How the work was approved: empty or crew (a Crew review), or in_session (the owner approved it in a coding session). in_session is accepted only when the task is or becomes done; Crew then stamps approved_at (server time, never written by clients) and approved_by defaults to owner. Leaving done clears review_mode, approved_by and approved_at.",
    },
    approved_by: {
      type: "string",
      maxLength: 100,
      description:
        "Who approved in session (the owner's name if known); a reported name, attribution only. Only with review_mode in_session.",
    },
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
  op(
    "agent.ensure",
    { name: str, brief: str, agent: str, kind: agent.kind },
    [],
    {
      key: true,
      description:
        "Returns the agent by ID or exact name, or creates it (kind defaults to bot). An existing agent is returned unchanged.",
    },
  );
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
      "Required only while another execution is live on the task (lease or acknowledgment window not expired); supplied proof is always validated. Exception: an update that only puts the task on hold (readiness on_hold/waiting, optional waiting_reason) needs no proof and cancels the live execution. Setting on hold releases governance.",
  });
  op(
    "task.claim",
    { assigned_agent: str, expected_generation: num },
    ["assigned_agent"],
    {
      revision: "record",
      description:
        "Takes a task with a 2-hour advisory lease and sets In progress; claimed_by records reported_agent (your session name, attribution only). An unassigned task is assigned to assigned_agent. The task's own assignee (assigned_agent = its ID or exact name) may claim it when it is Ready and To do, or In progress with no live claim; reported_agent is then required. A live claim by anyone answers HTTP 409 already_claimed with data.claimed_by and data.claim_until, before the revision check. Never wakes anyone.",
    },
  );
  op("task.claim_renew", {}, [], {
    revision: "record",
    description:
      "Extends your live claim to 2 hours from now. Only while the claim is live and reported_agent equals claimed_by; otherwise HTTP 409 claim_expired or not_claimer. Any task.update, task.comment or attachment write on the task by the live claimer also renews it.",
  });
  op(
    "task.release",
    {
      readiness: { enum: ["ready", "waiting", "on_hold"] },
      waiting_reason: str,
    },
    [],
    {
      revision: "record",
      description:
        "Ends the claim (claimed_by and claim_until cleared), sets an In progress task back to To do and optionally sets readiness and the hold reason. Allowed for the claimer (reported_agent = claimed_by), the owner in the reader, or anyone once the claim expired; otherwise HTTP 409 not_claimer. Setting Done also ends a claim.",
    },
  );
  op("task.comment", { body: str }, ["body"], {
    revision: "record",
    execution_proof:
      "Required only while another execution is live on the task; proof-bearing comments also require idempotency_key. After your own review.request completed your execution, your proof still works for comments while nobody else holds the task.",
    files:
      "Optional data.files (or multipart parts named files) become attachments of the task, all or nothing; attachment:new-N in body names the Nth file. Every attachment:ID in body must name an active attachment of this task. Files on a task with a pending review withdraw it like attachment.add.",
  });
  op("review.request", { options: reviewOptions }, [], {
    description:
      "Attach every image or file first and reference attachment:ID. Local file paths are refused with draft_references_unattached_files. Send alternatives as options with unique keys, labels and bodies (max 20; combined bodies max 200000 characters); they are frozen with the draft.",
    revision: "task",
    execution_proof:
      "Required only while another execution is live on the task. With your proof, review.request completes your execution (outcome review_requested; result execution_completed) instead of invalidating it: make it your last step. Your fenced comment and execution.complete (outcome completed, no mark_done) afterwards are accepted as no-ops for the execution.",
  });
  op("review.withdraw", {}, [], {
    revision: "review",
    execution_proof:
      "Required only while another execution is live on the task",
  });
  op(
    "review.decide",
    {
      decision: { enum: ["approved", "changes_requested", "rejected"] },
      note: str,
      option_decisions: optionDecisions,
    },
    ["decision"],
    {
      revision: "review",
      execution_proof:
        "Required only while another execution is live on the task",
      description:
        "Records the owner's review decision. Work clients use it only when the owner explicitly delegates the decision. Approval never performs an external action. With options, approval requires a decision for every key and at least one approved choice; rejected may omit choices (all rejected), changes_requested may omit them or record partial feedback.",
    },
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
      description:
        "Supply triage_agent, max_bot_handoffs or both. Change max_bot_handoffs only when the owner asks.",
    },
  );
  const fileEntry = object(
    {
      name: str,
      content_base64: {
        type: "string",
        description: "Standard base64 of the file bytes",
      },
    },
    ["name", "content_base64"],
  );
  const files = {
    type: "array",
    maxItems: 20,
    items: fileEntry,
    description:
      "JSON (MCP) transport: at most 5 MiB of decoded bytes per request. Multipart requests send file parts named files instead (see attachments.transport).",
  };
  task.files = files;
  note.files = files;
  operations["task.create"].data_schema = object(
    Object.assign({}, task, { _crew: compatibility }),
    ["title"],
  );
  operations["note.create"].data_schema = object(
    Object.assign({}, note, { _crew: compatibility }),
    ["bucket", "title"],
  );
  delete task.files;
  delete note.files;
  operations["task.create"].files =
    "Optional files created with the task in one step; attachment:new-N in description or draft names the Nth file (1-based). Any refused file refuses the whole create.";
  operations["note.create"].files =
    "Optional files created with the note in one step; attachment:new-N in body names the Nth file (1-based). Any refused file refuses the whole create.";
  op("attachment.add", { task: str, note: str, artifact: str, files }, [], {
    description:
      'Attach files to one active task or note, or to an artifact (name exactly one of task, note or artifact). Each file succeeds or fails on its own; the result lists attachments (saved records), results [{index, name, ok, id | error {code, message}}] and review_withdrawn. HTTP 400 only when every file failed (data["files.N"]). Never wakes; on a task with a pending review it withdraws that review like a draft edit.',
    result: {
      type: "object",
      properties: {
        attachments: { type: "array", items: { $ref: "#/$defs/attachments" } },
        results: { type: "array", items: { type: "object" } },
        review_withdrawn: bool,
      },
      additionalProperties: false,
    },
  });
  for (const action of ["archive", "restore"])
    op("attachment." + action, {}, [], {
      revision: "attachment",
      execution_proof:
        "On tasks: required only while another execution is live on the task",
      description:
        action === "archive"
          ? "Hide an attachment; bytes are kept and it stays restorable. Never wakes; withdraws a pending review on its task."
          : "Restore an archived attachment (at most 20 active per item). Never wakes; withdraws a pending review on its task.",
    });
  operations["attachment.add"].execution_proof =
    "On tasks: required only while another execution is live on the task";
  op(
    "upload_link.create",
    {
      task: str,
      note: str,
      expires_in_minutes: {
        type: "integer",
        minimum: 1,
        maximum: 1440,
        default: 15,
      },
      max_files: { type: "integer", minimum: 1, maximum: 20, default: 10 },
    },
    [],
    {
      owner: true,
      description:
        "Owner browser only (HTTP 403 for work clients). Returns the link record plus token, path #/upload/<token> and url (with a domain), shown once; only the token hash is stored. No idempotency_key.",
    },
  );
  op("upload_link.revoke", {}, [], { revision: "upload_link" });
  // Artifacts (0.21.0): frozen pages published from notes at /a/<token>.
  const artifactDraft = {
    title: { type: "string", maxLength: 300 },
    body: {
      type: "string",
      maxLength: 200000,
      description:
        "Markdown. Images are ![alt](attachment:ID) references to image attachments (the artifact's own files or a note's or task's images); attachment:new-N names the Nth file of artifact.create. Only PNG, JPEG, GIF and WebP images can be shown.",
    },
    sources: {
      type: "array",
      maxItems: 50,
      items: str,
      description:
        "IDs of the notes and tasks the artifact was built from; shown only in Crew, never on the public page.",
    },
  };
  op("artifact.create", Object.assign({ files }, artifactDraft), ["title"], {
    description:
      "Create a draft artifact (status draft). Any client may create and edit drafts; publishing is owner-browser-only. Compose the body from one or several notes; the public page shows only title, body and images. Optional files become the artifact's attachments, all or nothing.",
    files:
      "Optional files created with the artifact; attachment:new-N in body names the Nth file (1-based).",
  });
  op("artifact.update", artifactDraft, [], {
    revision: "artifact",
    description:
      "Edit the draft title, body or sources. On a published artifact the edit is a pending change (pending_changes true): the public page keeps the published snapshot until the owner replaces the content in the browser.",
  });
  for (const [action, text] of Object.entries({
    publish:
      "Turn the link on: snapshot title, body and images and generate a new random token (a revoked link stays dead). Returns the record plus token, link_path /a/<token> and link (with a domain).",
    replace:
      "Replace the published snapshot with the current draft under the same link; bumps published_revision.",
    revoke:
      "Turn the link off immediately (the page and its images answer 404); the draft is kept and can be published again under a new link.",
  }))
    op("artifact." + action, {}, [], {
      owner: true,
      revision: "artifact",
      description:
        "Owner browser only (HTTP 403 for work clients). " +
        text +
        " No idempotency_key.",
    });
  op(
    "storage.update",
    {
      storage_limit_bytes: {
        type: "integer",
        minimum: 1048576,
        maximum: 1099511627776,
      },
    },
    ["storage_limit_bytes"],
    {
      revision: "settings",
      description:
        "Instance storage limit in bytes (default 5 GiB; archived files count). Change it only when the owner asks.",
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
    {
      revision: "execution",
      key: true,
      description:
        "Ends running work. When your own review.request already completed this execution (outcome_code review_requested), the same worker/fence gets the record back with already_completed:true and no revision check; mark_done is refused.",
    },
  );
  op(
    "execution.recover",
    { resolution: { enum: ["cancel", "retry"] } },
    ["resolution"],
    { revision: "execution", key: true },
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
    "attachments",
    "upload_links",
    "settings",
    "artifacts",
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
    attachments: "task, note or artifact",
    upload_links: "task or note",
  }))
    collections[name].parent = parent;
  collections.session = {
    parameters: object({ agent: str }, ["agent"]),
    result_schema: {
      type: "object",
      properties: {
        agent: object({ id: str, name: str, kind: str }, [
          "id",
          "name",
          "kind",
        ]),
        prompt: str,
        instructions: str,
        lease_hours: num,
      },
      required: ["agent", "prompt", "instructions", "lease_hours"],
      additionalProperties: false,
    },
    description:
      'crew_read {collection:"session", agent:<ID or exact name>} returns one object (not items): the agent, the two-line prompt the reader copies to start a coder session, the full session instructions (Crew template plus the agent brief) and the claim lease in hours. Unknown agent: 404.',
  };

  const permanentLink = {
    path: {
      type: "string",
      description:
        "Derived permanent link, #/tasks/<slug>-<id> or #/notes/<slug>-<id>. The id is authoritative; the slug follows the current title.",
    },
    url: {
      type: "string",
      description:
        "Absolute permanent link. Present only when the install has a public base URL.",
    },
  };
  const fields = {
    agents: { ...agent },
    buckets: {
      ...bucket,
      responsible_agent_details: { type: ["object", "null"] },
    },
    notes: { ...note, ...permanentLink },
    tasks: {
      ...task,
      ...permanentLink,
      wake_generation: num,
      execution_required_generation: num,
      bot_handoffs: num,
      handoff_limited: bool,
      comment_wake_generation: num,
      comment_wake_event: str,
      held_since: {
        type: "string",
        description:
          "Server-managed hold start; stable across edits, empty when Ready. Legacy holds use their pre-upgrade updated time.",
      },
      claimed_at: {
        type: "string",
        description:
          "Claim start, stable across renewal; empty without a claim or when unknown for a legacy claim.",
      },
      claimed_by: {
        type: "string",
        description:
          "Reported session name of the current or last claimer; attribution, not identity",
      },
      claim_until: {
        type: "string",
        description: "Claim lease end (ISO UTC); empty without a claim",
      },
      claim_state: {
        enum: ["", "live", "expired"],
        description:
          "Derived: live while claim_until is in the future, expired after it, empty without a claim",
      },
      approved_at: {
        type: "string",
        description:
          "When the owner approved in session (server time; set with review_mode in_session, empty otherwise). Clients never write it.",
      },
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
      options: { ...reviewOptions, type: ["array", "null"] },
      option_decisions: { ...optionDecisions, type: ["array", "null"] },
      task: str,
      draft: str,
      attachments: {
        type: ["array", "null"],
        items: object({ id: str, sha256: str }, ["id", "sha256"]),
        description:
          "Active attachments (id, sha256) when review was requested; approval covers exactly these",
      },
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
    artifacts: {
      title: str,
      body: str,
      sources: strings,
      status: {
        enum: ["draft", "published", "revoked"],
        description:
          "draft (never published), published (the link works) or revoked (the link answers 404). The token and link are never returned to work clients.",
      },
      published_title: str,
      published_body: str,
      published_files: {
        type: "array",
        items: str,
        description:
          "Attachment IDs the published page shows, in order (/a/<token>/files/<n>, n from 1). Attachments are immutable, so the snapshot never changes.",
      },
      published_at: str,
      published_by: str,
      published_revision: num,
      revoked_at: str,
      revoked_by: str,
      view_count: num,
      last_viewed_at: str,
      created_by_agent: str,
      actor: str,
      pending_changes: {
        type: "boolean",
        description:
          "Published, and the draft title or body differs from what the link shows.",
      },
      path: { type: "string", description: "Reader link #/shared/<id>." },
    },
    attachments: {
      parent_kind: { enum: ["task", "note", "artifact"] },
      parent: str,
      name: str,
      media_type: str,
      image: {
        type: "boolean",
        description:
          "PNG, JPEG, GIF or WebP verified by magic bytes; only these are shown inline or thumbnailed",
      },
      width: num,
      height: num,
      size: { type: "integer", description: "Bytes" },
      sha256: str,
      position: num,
      actor: str,
      reported_agent: str,
      via_upload_link: str,
      archived: bool,
      archived_at: str,
      archived_by: str,
    },
    upload_links: {
      parent_kind: { enum: ["task", "note"] },
      parent: str,
      created_by: str,
      expires_at: str,
      max_files: num,
      files_added: num,
      failed_uploads: num,
      used_at: str,
      revoked_at: str,
      revoked_by: str,
      state: { enum: ["active", "used", "revoked", "expired"] },
    },
    settings: {
      singleton: str,
      storage_limit_bytes: num,
      storage_used_bytes: num,
      max_file_bytes: num,
      max_active_attachments: num,
    },
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
      attachment: "attachments",
      upload_link: "upload_links",
      storage: "settings",
      artifact: "artifacts",
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
    if (
      collection &&
      !["execution.validate", "execution.begin", "attachment.add"].includes(
        name,
      )
    )
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
    read: readDiscovery(),
    search: searchDiscovery(),
    sql: sqlDiscovery(),
    attachments: attachmentsDiscovery(),
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
        "Opt-in. Loop prevention: only a reader (owner browser) comment wakes; work-client comments never wake. During a live execution the wake is deferred until execution.complete; payloads carry comment_event_id, never comment text.",
      bot_handoffs:
        "Consecutive work-client assignment changes; any reader task write resets it. Exceeding webhook_routing.max_bot_handoffs applies the write but sets Waiting without a wake. A work client may set Ready again (when the owner asks or the loop is broken), but that keeps the count, so the next work-client reassignment stops it again.",
      attachments:
        "Attachment add, archive and restore (including through an upload link, or files sent with a comment) never wake. When one withdraws a pending review the task goes on hold (waiting_reason Review withdrawn) and its wake generation advances, exactly as a draft edit does (Draft edited).",
      agent_kinds:
        "Only bot agents are woken, mapped or chosen as dispatcher or triage. External (coder sessions) and human agents are never woken, even when assigned a Ready task.",
      claims:
        "Task claims (task.claim, task.claim_renew, task.release) never wake anyone and are advisory: other writes are not blocked by them.",
      on_hold:
        "An on-hold task (readiness waiting) never wakes a bot, whatever changes: creation, assignment, reassignment, reopening, review outcomes and comments are only recorded. Only Ready tasks wake: setting Ready, or a subscribed change or owner comment on a Ready task. Going on hold cancels unfinished executions (outcome put_on_hold, task event execution.cancel) and makes queued wakes stale.",
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
// Compact read and ranked search discovery. Omitted read parameters keep the
// original full-record, 100-per-page behavior.
function readDiscovery() {
  return {
    route: "POST /api/crew/read (MCP crew_read)",
    parameters: object({
      collection: str,
      id: str,
      parent: str,
      query: str,
      archived: bool,
      offset: num,
      limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
      fields: {
        type: "array",
        items: str,
        description:
          "Top-level field projection of the normal export; id and revision always included; unknown or redacted fields are rejected.",
      },
      responsible_agent: nullable,
      assigned_agent: {
        type: ["string", "null"],
        description:
          "Tasks: agent ID or unique exact name; empty string selects unassigned.",
      },
      status: {
        anyOf: [
          {
            enum: ["todo", "in_progress", "needs_review", "done", "wont_do"],
          },
          {
            type: "array",
            items: {
              enum: ["todo", "in_progress", "needs_review", "done", "wont_do"],
            },
          },
        ],
        description: "Tasks only",
      },
      readiness: {
        enum: ["waiting", "on_hold", "ready"],
        description: "Tasks only; on_hold is an alias of waiting",
      },
      overdue: {
        type: "boolean",
        description:
          "webhook_bridges only, true: unresolved parent wakes past their deadline (task.wake, no parent receipt) for the task's current wake generation, on active tasks that are not done or won't do and were not created by their recipient. Rows are history; nothing retries.",
      },
      label: { type: "string", description: "Tasks with this exact label" },
      release: {
        type: "string",
        maxLength: 32,
        description:
          "Tasks shipped in this exact release; empty string selects tasks without a release",
      },
      claim_state: {
        enum: ["", "live", "expired"],
        description: "Tasks only: claim state (empty string: no claim)",
      },
      agent: {
        type: "string",
        description:
          "session only: agent ID or exact name whose session instructions to read",
      },
      changed_since: {
        type: "string",
        format: "date-time",
        description: "RFC3339; records updated at or after it",
      },
    }),
    result: "items, has_more, next_offset (offset + limit)",
    strategy:
      "Filter and project first; read one record by id with fields; request full records only when their bodies are needed.",
  };
}
function searchDiscovery() {
  return {
    route: "POST /api/crew/search (MCP crew_search)",
    parameters: object(
      {
        query: str,
        collections: { type: "array", items: { enum: ["notes", "tasks"] } },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        offset: { type: "integer", minimum: 0, maximum: 10000 },
        archived: bool,
        generation: str,
      },
      ["query"],
    ),
    hit_fields: [
      "collection",
      "id",
      "title",
      "path",
      "url",
      "excerpt",
      "revision",
      "updated",
      "score",
      "bucket",
      "bucket_name",
      "status",
      "readiness",
      "assigned_agent",
      "assigned_agent_name",
    ],
    ranking:
      "SQLite FTS5 BM25 over note title/body, task title/description/draft and the names of each item's active attachments; all terms must match; trailing * is a prefix.",
    freshness:
      "Results reflect edits, restores and archive changes immediately; pass generation when paging, and restart on 409.",
    archived:
      "Same as crew_read: default excludes archived notes, notes in archived buckets and archived tasks; archived:true selects only them.",
    excludes: "Webhook, review, event and revision data are never searched.",
  };
}
function attachmentsDiscovery() {
  return {
    limits: {
      max_file_bytes: 20971520,
      max_active_per_item: 20,
      max_files_per_request: 20,
      max_base64_bytes_per_request: 5242880,
      max_multipart_request_bytes: 94371840,
      storage_limit:
        "settings.storage_limit_bytes (default 5368709120); archived files count; storage.update changes it",
    },
    transport: {
      json: "data.files [{name, content_base64}] on POST /api/crew/agent-write (MCP crew_write) or /api/crew/write; at most 5 MiB decoded per request.",
      multipart:
        "multipart/form-data to the same write routes: field @jsonPayload holds the JSON write envelope, file parts are named files (filename = display name). For attachment.add, task.create, note.create, task.comment and artifact.create only.",
    },
    references:
      "Markdown in note body, task description and task draft may reference ![alt](attachment:ID) or [label](attachment:ID). A new reference must name an active attachment of the same task or note; a reference already saved in that field may stay after archiving (shown as removed). Embedded data: images are refused. attachment:new-N placeholders (N = 1-based file position) work only in task.create/note.create/task.comment with files. Comment bodies follow the same rules; every reference in a comment is new, so it must name an active attachment of the task.",
    images:
      "PNG, JPEG, GIF and WebP verified by magic bytes are images (image:true, width, height). Every other type is metadata from the extension, never sniffed, and is served as a download.",
    read: {
      list: 'crew_read {collection:"attachments", parent:<task or note id>} returns metadata ordered by position; archived:true lists archived ones.',
      bytes:
        "POST /api/crew/attachment-read {id, variant, offset?, max_bytes?}. variant original: base64 bytes from offset (max_bytes default 1048576, at most 4194304), next_offset while more remain. preview (1600 px wide) or card (320 px wide): a downscaled image (never upscaled), whole, at most 4 MiB. text: strict UTF-8 text (max_bytes default 262144, at most 2097152), cut on character boundaries. Results: attachment (metadata), variant, media_type, encoding (base64|utf-8), offset, length, total_size, next_offset, content_base64 or text, and width/height for images. No URLs are returned.",
      reader:
        "The owner browser and CLI read GET /api/crew/attachment?id=ID[&thumb=1600x0|320x0][&download=1] with the auth header or ?token= from POST /api/files/token. Work clients use attachment-read.",
    },
    artifacts:
      "An artifact body may reference image attachments of its own or of any note or task; publishing snapshots the list, and the public page serves those images only through its token.",
    upload_links:
      "One-time links the owner creates in the reader. Upload only, one batch, expiring (default 15 minutes, at most 24 hours), revocable; events attribute the files to actor upload_link:<id>.",
    rules:
      "Attachments are untrusted content like notes. Change the storage limit only when the owner asks. Agents that can only see an image cannot attach it: file the task and ask the owner to add the screenshots in the reader or through an upload link.",
  };
}
function sqlDiscovery() {
  return {
    routes:
      "GET /api/crew/schema (MCP crew_schema), POST /api/crew/query {sql} (MCP crew_query)",
    views: [
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
      "attachments",
    ],
    result: "columns, rows (arrays), truncated",
    limits: { timeout_ms: 2000, max_rows: 1000, max_bytes: 1048576 },
    read_only: true,
    archived:
      "SQL includes archived records; filter archived explicitly (notes are also archived when their bucket is).",
    excludes:
      "Webhook URLs, credentials, execution fencing handles, idempotency records, attachment storage names and bytes, upload links, accounts and internal tables.",
    strategy:
      "Use for counts, joins, aggregates and history; prefer crew_read filters and crew_search for ordinary lookups.",
  };
}
module.exports = {
  describe,
  digest,
  normalizeEnvelope,
  PROTOCOL_VERSION,
  EXECUTION_OPERATIONS,
};
