const setup = require(`${__hooks}/crew_setup.js`);
// Shared-MCP webhook operations. All callers supply the enclosing transaction.
const reasons = [
  "reassigned",
  "assigned",
  "unassigned",
  "review_outcome",
  "reopened",
  "ready",
  "created",
  "catch_up",
  "comment",
];
const DEFAULT_MAX_BOT_HANDOFFS = 4;
const collections = [
  "webhook_configs",
  "webhook_mappings",
  "webhook_deliveries",
  "webhook_attempts",
  "webhook_routing",
  "webhook_bridges",
];
function bad(message) {
  throw new BadRequestError(message);
}
function conflict(message, code = "revision_conflict") {
  throw new ApiError(409, message, {
    reason: new ValidationError(code, message),
  });
}
function only(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    bad("Expected an object");
  for (const k of Object.keys(value))
    if (!fields.includes(k)) bad("Unsupported field: " + k);
}
function get(app, collection, id) {
  if (typeof id !== "string" || !/^[a-z0-9]{15}$/.test(id))
    throw new NotFoundError("Record not found");
  return app.findRecordById("crew_" + collection, id);
}
function rows(app, collection, filter, params) {
  return app.findRecordsByFilter(
    "crew_" + collection,
    filter,
    "",
    0,
    0,
    params || {},
  );
}
function check(record, revision) {
  if (!Number.isInteger(revision) || record.getInt("revision") !== revision)
    conflict("Revision conflict; reread and reassess");
}
function json(record, key, fallback) {
  const value = record.getString(key);
  return value ? JSON.parse(value) : fallback;
}
function routing(app) {
  return rows(app, "webhook_routing", "singleton='routing'")[0];
}
function exported(record, app) {
  if (record.collection().name === "crew_webhook_bridges")
    return require(`${__hooks}/crew_bridge.js`).exported(record);
  const result = record.publicExport();
  delete result.secret_ciphertext;
  if (record.collection().name === "crew_webhook_configs") {
    result.secret_configured = !!record.getString("secret_ciphertext");
    result.url_configured = !!record.getString("url");
    const match = record.getString("url").match(/^https:\/\/([^/:?#]+)/);
    result.receiver_host = match ? match[1] : "";
    delete result.url;
    if (app && record.getString("scope") === "global")
      result.setup = setupStatus(app, record);
  }
  return result;
}
// Permanent links are derived on the way out of an API response. They never go
// into webhook payloads, events or stored idempotency results; the slug itself
// lives in Go behind the binding.
function withLinks(app, collection, out, title) {
  const link = $pocketcontext.crewRecordLink(app, collection, out.id, title);
  out.path = link.path;
  if (link.url) out.url = link.url;
  return out;
}
function linkedExport(app, collection, record) {
  const out = record.publicExport();
  if (collection === "tasks") out.claim_state = claimState(record);
  return withLinks(app, collection, out, record.getString("title"));
}
// Advisory task claims: "" (none), "live" (claim_until in the future) or
// "expired". claim_until is an ISO UTC timestamp written by Crew.
function claimState(t) {
  const until = t.getString("claim_until");
  if (!t.getString("claimed_by") && !until) return "";
  const ms = Date.parse(until);
  return Number.isFinite(ms) && ms > Date.now() ? "live" : "expired";
}
// Old release idempotency results may contain receiver URLs. Redact on replay,
// including nested results, without rewriting historical operation records.
function redactReplay(value) {
  if (Array.isArray(value)) return value.map(redactReplay);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const k of Object.keys(value)) {
    if (["url", "secret", "secret_ciphertext"].includes(k)) continue;
    result[k] = redactReplay(value[k]);
  }
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k]);
    return out;
  }
  return value;
}
function idempotent(app, b, fn, required) {
  if (!b.idempotency_key) {
    if (required) bad("idempotency_key is required");
    return fn();
  }
  if (typeof b.idempotency_key !== "string" || b.idempotency_key.length > 200)
    bad("Invalid idempotency_key");
  const fingerprint = $pocketcontext.webhookFingerprint(
    app,
    JSON.stringify(
      canonical({
        id: b.id || "",
        expected_revision: b.expected_revision || 0,
        data: b.data || {},
        ...(b.execution ? { execution: b.execution } : {}),
      }),
    ),
  );
  const existing = rows(
    app,
    "webhook_idempotency",
    "operation={:op} && key={:key}",
    { op: b.action, key: b.idempotency_key },
  );
  if (existing.length) {
    if (existing[0].getString("fingerprint") !== fingerprint)
      conflict("Idempotency key already used for different input");
    return redactReplay(json(existing[0], "result", {}));
  }
  const result = fn();
  const entry = new Record(
    app.findCollectionByNameOrId("crew_webhook_idempotency"),
  );
  entry.set("operation", b.action);
  entry.set("key", b.idempotency_key);
  entry.set("fingerprint", fingerprint);
  entry.set("result", result);
  entry.set("revision", 1);
  app.save(entry);
  return result;
}
function audit(app, r, b, actor, changes) {
  const e = new Record(app.findCollectionByNameOrId("crew_events"));
  e.set("parent", r.id);
  e.set("action", b.action);
  e.set("actor", actor);
  e.set("reported_agent", b.reported_agent || "");
  e.set("reason", b.reason || "");
  e.set("changes", changes || {});
  e.set("revision", 1);
  app.save(e);
}
function cancel(app, filter, params) {
  for (const row of rows(
    app,
    "webhook_deliveries",
    "(" + filter + ") && (state='pending' || state='in_flight')",
    params,
  )) {
    row.set("state", "cancelled");
    row.set("last_error", "obsolete");
    row.set("revision", row.getInt("revision") + 1);
    app.save(row);
  }
}
function state(app, t) {
  return {
    assigned: t.getString("assigned_agent"),
    readiness: t.getString("readiness"),
    status: t.getString("status"),
    archived: t.getBool("archived"),
    review:
      rows(app, "reviews", "task={:task} && status='pending'", { task: t.id })
        .length > 0,
    generation: t.getInt("wake_generation"),
  };
}
// Done and Won't do (0.19.0) are terminal: they end claims, never wake and
// leaving either one reopens the task.
const TERMINAL_STATUSES = ["done", "wont_do"];
function terminal(status) {
  return TERMINAL_STATUSES.includes(status);
}
function eligible(s) {
  return (
    !s.archived &&
    s.readiness === "ready" &&
    ["todo", "in_progress"].includes(s.status) &&
    !s.review
  );
}
function activeAgent(app, id) {
  if (!id) return false;
  try {
    return !get(app, "agents", id).getBool("archived");
  } catch (_) {
    return false;
  }
}
// Agent kinds: bot (a Grok bot woken by webhook; the default and every agent
// before 0.18.0), external (a coder session started manually, never woken) and
// human. Only bots are ever routed, mapped or woken.
const AGENT_KINDS = ["bot", "external", "human"];
function agentKind(agent) {
  return agent.getString("kind") || "bot";
}
function botAgent(app, id) {
  if (!id) return false;
  try {
    const agent = get(app, "agents", id);
    return !agent.getBool("archived") && agentKind(agent) === "bot";
  } catch (_) {
    return false;
  }
}
function route(app, t) {
  const s = state(app, t),
    rt = routing(app);
  if (!eligible(s) || rt.getBool("paused")) return null;
  const id = s.assigned || rt.getString("triage_agent");
  // An external or human assignee is never woken, even with a mapping.
  if (!botAgent(app, id)) return null;
  const config = globalConfig(app),
    mapping = mappingFor(app, id);
  if (
    !config ||
    !config.getBool("enabled") ||
    !botAgent(app, config.getString("agent")) ||
    !mapping ||
    !mapping.getString("bot_ref")
  )
    return null;
  return {
    config,
    agent: id,
    kind: s.assigned ? "assignee" : "triage",
    routing: rt,
    mapping,
  };
}
function enqueue(app, config, payload, t, target) {
  const row = new Record(
    app.findCollectionByNameOrId("crew_webhook_deliveries"),
  );
  const now = new Date();
  if (t) {
    t.set("execution_required_generation", t.getInt("wake_generation"));
    // Any emitted wake satisfies a deferred owner-comment wake.
    t.set("comment_wake_generation", 0);
    t.set("comment_wake_event", "");
    app.save(t);
  }
  row.set("config", config.id);
  row.set("task", t ? t.id : "");
  row.set("agent", payload.recipient_agent_id || config.getString("agent"));
  row.set("target_kind", target || "test");
  row.set("generation", t ? t.getInt("wake_generation") : 0);
  row.set("epoch", payload.epoch);
  row.set("event_id", payload.event_id);
  row.set("payload", payload);
  row.set("destination_version", config.getInt("destination_version"));
  row.set("state", "pending");
  row.set("retry_cycle", 1);
  row.set("next_attempt_at", now.toISOString());
  row.set("deadline_at", new Date(now.getTime() + 86400000).toISOString());
  row.set("revision", 1);
  app.save(row);
  return exported(row, app);
}
function wake(app, t, causes, outcome, extra) {
  const target = route(app, t);
  if (!target) return null;
  const subscriptions = json(target.config, "subscriptions", []);
  if (!causes.some((x) => subscriptions.includes(x))) return null;
  const reason = reasons.find((x) => causes.includes(x));
  const capabilities = require(`${__hooks}/crew_capabilities.js`);
  const payload = {
    schema_version: 1,
    protocol_version: capabilities.PROTOCOL_VERSION,
    capabilities_digest: capabilities.digest(),
    event_id: $pocketcontext.webhookUUID(),
    event_type: "task.wake",
    instance_id: target.routing.getString("instance_id"),
    epoch: target.routing.getString("epoch"),
    config_id: target.config.id,
    destination_version: target.config.getInt("destination_version"),
    instruction_revision: target.config.getInt("instruction_revision"),
    dispatch_mode: target.config.getString("dispatch_mode") || "native",
    target_agent_id: target.agent,
    recipient_agent_id: target.agent,
    dispatcher_agent_id: target.config.getString("agent"),
    recipient_bot_ref: target.mapping.getString("bot_ref"),
    mapping_revision: target.mapping.getInt("revision"),
    target_kind: target.kind,
    task_id: t.id,
    task_revision: t.getInt("revision"),
    wake_generation: t.getInt("wake_generation"),
    occurred_at: new Date().toISOString(),
    reason,
    causes,
    task_url: $pocketcontext.webhookBaseURL(app) + "/#/tasks/" + t.id,
  };
  if (outcome) payload.review_outcome = outcome;
  if (extra) Object.assign(payload, extra);
  return enqueue(app, target.config, payload, t, target.kind);
}
// An agent that creates a task for itself already at work needs no dispatcher
// wake or execution governance. selfStartAgent is the reported name, supplied
// only for agent task.create, so owner writes and claims can never match.
function selfStarted(app, current, name) {
  if (
    !name ||
    !current.assigned ||
    !eligible(current) ||
    current.status !== "in_progress"
  )
    return false;
  return get(app, "agents", current.assigned).getString("name") === name;
}
// Returns true when a new task was recorded as self-started instead of waking.
function transition(app, t, old, options) {
  const held =
    t.getString("readiness") === "waiting" && !terminal(t.getString("status"));
  const since = held
    ? !old || old.readiness !== "waiting" || terminal(old.status)
      ? new Date().toISOString()
      : t.getString("held_since") || t.getString("updated")
    : "";
  if (since !== t.getString("held_since")) {
    t.set("held_since", since);
    app.save(t);
  }
  options = options || {};
  const current = state(app, t),
    causes = [];
  if (!old && selfStarted(app, current, options.selfStartAgent)) return true;
  if (!old) {
    if (eligible(current)) causes.push("created");
  } else {
    if (old.assigned !== current.assigned)
      causes.push(
        current.assigned
          ? old.assigned
            ? "reassigned"
            : "assigned"
          : "unassigned",
      );
    if (old.readiness !== "ready" && current.readiness === "ready")
      causes.push("ready");
    if (
      (old.archived && !current.archived) ||
      (terminal(old.status) && !terminal(current.status))
    )
      causes.push("reopened");
  }
  if (options.outcome) causes.push("review_outcome");
  const invalidate =
    old &&
    (old.assigned !== current.assigned ||
      (eligible(old) && !eligible(current)) ||
      (!old.review && current.review) ||
      options.autoWithdraw);
  const notify =
    eligible(current) && causes.length > 0 && !options.autoWithdraw;
  if (invalidate || notify) {
    t.set("wake_generation", t.getInt("wake_generation") + 1);
    // A generation change ends the execution a deferred comment was waiting for.
    t.set("comment_wake_generation", 0);
    t.set("comment_wake_event", "");
    app.save(t);
    cancel(app, "task={:task}", { task: t.id });
  }
  if (notify) wake(app, t, causes, options.outcome);
}
// Advances the wake generation without a wake: queued deliveries for the old
// generation are cancelled and any deferred comment wake is dropped.
function advanceGeneration(app, t) {
  t.set("wake_generation", t.getInt("wake_generation") + 1);
  t.set("comment_wake_generation", 0);
  t.set("comment_wake_event", "");
  app.save(t);
  cancel(app, "task={:task}", { task: t.id });
}
// A live execution is current-generation work that may still be running or
// about to start: an unexpired lease, or a prepared handoff before its deadline.
function liveExecution(app, t) {
  const now = Date.now(),
    future = (value) =>
      Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
  return rows(
    app,
    "webhook_executions",
    "task={:task} && generation={:generation} && (state='dispatching' || state='handed_off' || state='running')",
    { task: t.id, generation: t.getInt("wake_generation") },
  ).some((r) =>
    r.getString("state") === "handed_off"
      ? future(r.getString("handoff_deadline_at"))
      : future(r.getString("lease_until")),
  );
}
function commentRoutable(app, t) {
  const target = route(app, t);
  return (
    !!target && json(target.config, "subscriptions", []).includes("comment")
  );
}
function commentWakeNow(app, t, eventId) {
  t.set("wake_generation", t.getInt("wake_generation") + 1);
  app.save(t);
  cancel(app, "task={:task}", { task: t.id });
  return wake(app, t, ["comment"], null, { comment_event_id: eventId });
}
// Owner browser comments only; shared-MCP comments never call this. Returns
// "woken", "deferred" or "" so callers and tests can observe the decision.
function ownerComment(app, t, eventId) {
  if (!commentRoutable(app, t)) return "";
  if (liveExecution(app, t)) {
    t.set("comment_wake_generation", t.getInt("wake_generation"));
    t.set("comment_wake_event", eventId);
    app.save(t);
    return "deferred";
  }
  return commentWakeNow(app, t, eventId) ? "woken" : "";
}
function commentWakePending(t) {
  return (
    t.getInt("comment_wake_generation") > 0 &&
    t.getInt("comment_wake_generation") === t.getInt("wake_generation")
  );
}
// Called by execution.complete after the execution reaches a terminal outcome.
function deferredCommentWake(app, t) {
  if (!commentWakePending(t)) return null;
  const eventId = t.getString("comment_wake_event");
  t.set("comment_wake_generation", 0);
  t.set("comment_wake_event", "");
  app.save(t);
  if (!commentRoutable(app, t)) return null;
  return commentWakeNow(app, t, eventId);
}
function clearCommentWake(app, t) {
  if (
    !t.getInt("comment_wake_generation") &&
    !t.getString("comment_wake_event")
  )
    return;
  t.set("comment_wake_generation", 0);
  t.set("comment_wake_event", "");
  app.save(t);
}
function maxBotHandoffs(app) {
  return routing(app).getInt("max_bot_handoffs") || DEFAULT_MAX_BOT_HANDOFFS;
}
function validateEndpoint(url) {
  try {
    $pocketcontext.webhookValidateEndpoint(url);
  } catch (_) {
    bad(
      "Receiver must be a reachable public HTTPS URL without credentials or fragments",
    );
  }
}
function credentialReady(app, cipher) {
  try {
    $pocketcontext.webhookCredentialReady(app, cipher);
  } catch (_) {
    bad("Receiver credential unavailable");
  }
}
function validateConfig(app, d) {
  if (d.url !== undefined) {
    if (typeof d.url !== "string" || d.url.length > 4096)
      bad("Invalid receiver URL");
    validateEndpoint(d.url);
  }
  if (d.adapter !== undefined && d.adapter !== "crew-v1")
    bad("Unsupported adapter; only crew-v1 conforming receivers are supported");
  if (
    d.subscriptions !== undefined &&
    (!Array.isArray(d.subscriptions) ||
      !d.subscriptions.length ||
      d.subscriptions.some((x) => !reasons.includes(x)))
  )
    bad("Invalid subscriptions");
  if (
    d.secret !== undefined &&
    (typeof d.secret !== "string" ||
      !d.secret.length ||
      d.secret.length > 8192 ||
      /[\r\n]/.test(d.secret))
  )
    bad("Invalid write-only secret");
  if (d.clear_secret !== undefined && d.clear_secret !== true)
    bad("clear_secret must be true");
  if (d.secret !== undefined && d.clear_secret)
    bad("Cannot replace and clear credential together");
}
function globalConfig(app) {
  return rows(app, "webhook_configs", "scope='global'")[0];
}
function mappingFor(app, agent) {
  return rows(app, "webhook_mappings", "agent={:agent}", { agent })[0];
}
function instructionsReady(c) {
  return (
    c.getInt("applied_revision") === c.getInt("instruction_revision") &&
    ["reported", "verified"].includes(c.getString("sync_status"))
  );
}
function setupStatus(app, c) {
  const test = [];
  const add = (code, message) => test.push({ code, message });
  if (!botAgent(app, c.getString("agent")))
    add("dispatcher_missing", "Choose an active dispatcher bot.");
  const mapping = mappingFor(app, c.getString("agent"));
  if (!mapping || !mapping.getString("bot_ref"))
    add(
      "dispatcher_mapping_missing",
      "Connect the selected dispatcher to its Grok Bot.",
    );
  if (!c.getString("url") || !c.getString("secret_ciphertext"))
    add(
      "credentials_missing",
      "Paste the webhook URL and key directly into Crew.",
    );
  if (!instructionsReady(c))
    add(
      "instructions_not_applied",
      "Apply instruction revision " +
        c.getInt("instruction_revision") +
        " in Grok before testing.",
    );
  const rt = routing(app);
  const runtime =
    c.getString("runtime_event_id") === c.getString("test_event_id") &&
    c.getString("runtime_context") === "webhook" &&
    c.getString("runtime_epoch") === rt.getString("epoch") &&
    c.getInt("runtime_destination_version") ===
      c.getInt("destination_version") &&
    c.getInt("runtime_instruction_revision") ===
      c.getInt("instruction_revision");
  const ack =
    runtime &&
    rows(
      app,
      "webhook_executions",
      "event_id={:event} && state='test_acknowledged'",
      { event: c.getString("runtime_event_id") },
    ).length > 0;
  const mode = c.getString("dispatch_mode") || "native";
  const bridgeModule = require(`${__hooks}/crew_bridge.js`);
  let bridge = c.getString("test_event_id")
    ? bridgeModule.forEvent(app, c.getString("test_event_id"))
    : null;
  if (bridge) {
    try {
      bridgeModule.current(
        app,
        get(app, "webhook_deliveries", bridge.getString("delivery")),
      );
    } catch (_) {
      bridge = null;
    }
  }
  const parent = !!bridge && !!bridge.getString("parent_received_at");
  const crossRequired = rows(app, "webhook_mappings", "agent!={:agent}", {
    agent: c.getString("agent"),
  }).some(
    (m) => !!m.getString("bot_ref") && botAgent(app, m.getString("agent")),
  );
  const recipientAck =
    !!bridge &&
    !!bridge.getString("recipient_received_at") &&
    bridge.getBool("recipient_automatic");
  const blockers = test.slice();
  if (!runtime)
    blockers.push({
      code: "runtime_unverified",
      message:
        "Run the connection test so the webhook routine can report its available tools.",
    });
  else {
    if (!c.getBool("runtime_execution_protocol"))
      blockers.push({
        code: "execution_protocol_missing",
        message:
          "The webhook routine cannot use the required Crew execution protocol. Refresh its tools and test again.",
      });
    if (mode === "native" && !c.getBool("runtime_native_handoff"))
      blockers.push({
        code: "native_handoff_missing",
        message:
          "Native bot messaging is unavailable in the webhook routine. Select and test the parent bridge if supported.",
      });
  }
  if (mode === "parent_bridge") {
    const block = (code, message) => blockers.push({ code, message });
    if (!runtime || !c.getBool("runtime_parent_wake"))
      block(
        "parent_wake_missing",
        "The routine must report an available parent-wake tool.",
      );
    if (!parent)
      block(
        "parent_receipt_missing",
        "Wait for the automatically activated parent to acknowledge the test.",
      );
    if (parent && !bridge.getBool("parent_native_handoff"))
      block(
        "parent_native_handoff_missing",
        "Native bot messaging is unavailable in the parent turn.",
      );
    if (parent && !bridge.getBool("parent_execution_protocol"))
      block(
        "parent_execution_protocol_missing",
        "The parent cannot use Crew's execution protocol.",
      );
    if (
      crossRequired &&
      (!bridge || bridge.getString("recipient_agent") === c.getString("agent"))
    )
      block(
        "recipient_test_required",
        "Select another mapped bot and run an end-to-end test.",
      );
    else if (crossRequired && !recipientAck)
      block(
        "recipient_ack_missing",
        "Wait for the recipient's automatic acknowledgment; authorize development access in its chat if needed.",
      );
    if (bridge && bridgeModule.exported(bridge).overdue)
      block(
        "bridge_overdue",
        "The bridge acknowledgment deadline expired. Inspect the conversations before starting a new test.",
      );
  }
  if (!ack)
    blockers.push({
      code: "test_ack_missing",
      message:
        "Wait for the harmless connection test acknowledgment before enabling.",
    });
  return {
    dispatch_mode: mode,
    test_event_id: c.getString("test_event_id"),
    parent_wake_reported: runtime && c.getBool("runtime_parent_wake"),
    parent_received: parent,
    bridge_send_reported: !!bridge && !!bridge.getString("send_reported_at"),
    recipient_acknowledged: recipientAck,
    bridge_test_recipient_agent_id: bridge
      ? bridge.getString("recipient_agent")
      : "",
    bridge_test_state: bridge ? bridge.getString("state") : "",
    bridge_test_overdue: !!bridge && bridgeModule.exported(bridge).overdue,
    can_test: test.length === 0,
    can_enable: blockers.length === 0,
    test_blockers: test,
    blockers,
    test_acknowledged: !!ack,
    runtime_reported: !!runtime,
    native_handoff_reported: runtime && c.getBool("runtime_native_handoff"),
  };
}
function requireReady(app, c) {
  if (!botAgent(app, c.getString("agent")))
    bad("Active dispatcher bot required");
  const mapping = mappingFor(app, c.getString("agent"));
  if (!mapping || !mapping.getString("bot_ref"))
    bad("Dispatcher bot mapping required");
  if (!instructionsReady(c))
    bad("Apply the current dispatcher instructions first");
  if (!c.getString("url") || !c.getString("secret_ciphertext"))
    bad("Enter receiver URL and credential in the owner UI");
  credentialReady(app, c.getString("secret_ciphertext"));
  validateEndpoint(c.getString("url"));
}
function invalidateAgent(app, agent, b, actor) {
  for (const t of rows(
    app,
    "tasks",
    "assigned_agent={:agent} && readiness='ready'",
    { agent },
  )) {
    t.set("wake_generation", t.getInt("wake_generation") + 1);
    t.set("revision", t.getInt("revision") + 1);
    app.save(t);
    cancel(app, "task={:task}", { task: t.id });
    audit(app, t, b, actor, { mapping_invalidated: agent });
  }
  if (routing(app).getString("triage_agent") === agent)
    invalidateTriage(app, b, actor);
}
function handle(app, b, actor, isAgent) {
  const d = b.data || {};
  if (b.action.startsWith("webhook.bridge."))
    return require(`${__hooks}/crew_bridge.js`).handle(app, b, actor);
  // The sole work-client exception. Check it before idempotency replay, so a
  // reader result cannot be replayed through MCP and credentials can never
  // enter the work-client API.
  if (b.action === "webhook.credentials.update" && isAgent)
    throw new ForbiddenError("Enter webhook credentials in the owner UI");
  if (["webhook.create", "webhook.update"].includes(b.action))
    bad(
      "Use the global integration; legacy per-agent configuration is retired",
    );
  return idempotent(
    app,
    b,
    () => {
      if (b.action === "agent.ensure") {
        only(d, ["name", "brief", "agent", "kind"]);
        if (d.kind !== undefined && !AGENT_KINDS.includes(d.kind))
          bad("kind must be bot, external or human");
        let agent;
        if (d.agent) agent = get(app, "agents", d.agent);
        else {
          if (
            typeof d.name !== "string" ||
            !d.name.trim() ||
            d.name.length > 200
          )
            bad("Agent name required");
          const found = rows(app, "agents", "name={:name}", { name: d.name });
          if (found.length > 1)
            conflict("Agent name is ambiguous; use agent ID");
          agent = found[0];
        }
        if (agent) {
          if (agent.getBool("archived")) bad("Restore the agent first");
          if (d.name && agent.getString("name") !== d.name)
            conflict("Agent ID and name do not match");
          return exported(agent, app);
        }
        agent = new Record(app.findCollectionByNameOrId("crew_agents"));
        agent.set("name", d.name);
        agent.set("brief", d.brief || "");
        agent.set("kind", d.kind || "bot");
        agent.set("revision", 1);
        app.save(agent);
        audit(app, agent, b, actor, {
          name: d.name,
          kind: agent.getString("kind"),
        });
        return exported(agent, app);
      }
      if (b.action === "webhook.routing.update") {
        only(d, ["triage_agent", "max_bot_handoffs"]);
        const rt = routing(app);
        check(rt, b.expected_revision);
        if (d.triage_agent === undefined && d.max_bot_handoffs === undefined)
          bad("triage_agent is required; use null to clear");
        const changes = {};
        if (d.max_bot_handoffs !== undefined) {
          if (
            !Number.isInteger(d.max_bot_handoffs) ||
            d.max_bot_handoffs < 1 ||
            d.max_bot_handoffs > 20
          )
            bad("max_bot_handoffs must be an integer from 1 to 20");
          rt.set("max_bot_handoffs", d.max_bot_handoffs);
          changes.max_bot_handoffs = d.max_bot_handoffs;
        }
        if (d.triage_agent !== undefined) {
          const id = d.triage_agent || "";
          if (id && !botAgent(app, id)) bad("Active triage bot required");
          if (rt.getString("triage_agent") !== id) {
            invalidateTriage(app, b, actor);
            cancel(app, "target_kind='triage'", {});
          }
          rt.set("triage_agent", id);
          changes.triage_agent = id;
        }
        rt.set("revision", rt.getInt("revision") + 1);
        app.save(rt);
        audit(app, rt, b, actor, changes);
        return exported(rt, app);
      }
      if (b.action === "webhook.mapping.update") {
        only(d, ["agent", "bot_ref", "bot_name"]);
        if (
          d.bot_name !== undefined &&
          (typeof d.bot_name !== "string" || d.bot_name.length > 200)
        )
          bad("Invalid bot display name");
        if (!activeAgent(app, d.agent)) bad("Active agent required");
        // Only bots are woken by webhook. Clearing a mapping left from when
        // the agent was a bot stays possible.
        if (
          !botAgent(app, d.agent) &&
          !(typeof d.bot_ref === "string" && !d.bot_ref.trim())
        )
          bad("Only bot agents have a bot mapping; this agent is not a bot");
        if (
          typeof d.bot_ref !== "string" ||
          d.bot_ref.length > 500 ||
          /[\r\n]/.test(d.bot_ref)
        )
          bad("Invalid bot reference");
        const ref = d.bot_ref.trim();
        let m = mappingFor(app, d.agent);
        if (m) {
          check(m, b.expected_revision);
          if (b.id && b.id !== m.id)
            conflict("Mapping ID does not match agent");
        } else {
          if (b.expected_revision !== 0)
            conflict("Use revision 0 to create mapping");
          m = new Record(app.findCollectionByNameOrId("crew_webhook_mappings"));
          m.set("agent", d.agent);
        }
        if (
          ref &&
          rows(app, "webhook_mappings", "bot_ref={:ref} && agent!={:agent}", {
            ref,
            agent: d.agent,
          }).length
        )
          conflict("Bot reference already maps to another agent");
        if (
          m.getInt("revision") > 0 &&
          m.getString("bot_ref") === ref &&
          (d.bot_name === undefined || d.bot_name === m.getString("bot_name"))
        )
          return exported(m, app);
        if (m.getString("bot_ref") !== ref) {
          invalidateAgent(app, d.agent, b, actor);
          const global = globalConfig(app);
          if (global.getString("agent") === d.agent && m.getString("bot_ref")) {
            invalidateConfig(app, global, b, actor);
            global.set("url", "");
            global.set("secret_ciphertext", "");
            global.set("routine_ref", "");
            global.set("sync_status", "unverified");
            global.set("applied_revision", 0);
            global.set(
              "destination_version",
              global.getInt("destination_version") + 1,
            );
            global.set("enabled", false);
            global.set("revision", global.getInt("revision") + 1);
            app.save(global);
          }
        }
        if (
          m.getString("bot_ref") === ref &&
          d.bot_name !== undefined &&
          d.bot_name !== m.getString("bot_name")
        )
          invalidateAgent(app, d.agent, b, actor);
        m.set("bot_ref", ref);
        if (d.bot_name !== undefined) m.set("bot_name", d.bot_name);
        m.set("revision", m.getInt("revision") + 1);
        app.save(m);
        audit(app, m, b, actor, { agent: d.agent, mapping_changed: true });
        return exported(m, app);
      }
      if (b.action === "webhook.retry") {
        only(d, ["config_revision"]);
        const delivery = get(app, "webhook_deliveries", b.id);
        check(delivery, b.expected_revision);
        const c = get(app, "webhook_configs", delivery.getString("config"));
        check(c, d.config_revision);
        if (c.getString("scope") !== "global")
          bad("Legacy receiver is retired");
        if (
          delivery.getString("state") !== "failed" ||
          delivery.getInt("destination_version") !==
            c.getInt("destination_version")
        )
          conflict("Delivery is not retryable");
        const rt = routing(app);
        if (
          rt.getBool("paused") ||
          delivery.getString("epoch") !== rt.getString("epoch")
        )
          conflict("Delivery epoch is obsolete or paused");
        if (delivery.getString("task")) {
          const t = get(app, "tasks", delivery.getString("task")),
            target = route(app, t),
            payload = json(delivery, "payload", {});
          if (
            !target ||
            target.config.id !== c.id ||
            target.kind !== delivery.getString("target_kind") ||
            t.getInt("wake_generation") !== delivery.getInt("generation") ||
            !(payload.causes || [payload.reason]).some((x) =>
              json(c, "subscriptions", []).includes(x),
            )
          )
            conflict("Delivery is stale");
        }
        delivery.set("state", "pending");
        delivery.set("attempts", 0);
        delivery.set("retry_cycle", delivery.getInt("retry_cycle") + 1);
        delivery.set("next_attempt_at", new Date().toISOString());
        delivery.set(
          "deadline_at",
          new Date(Date.now() + 86400000).toISOString(),
        );
        delivery.set("lease_until", "");
        delivery.set("last_error", "");
        delivery.set("revision", delivery.getInt("revision") + 1);
        app.save(delivery);
        audit(app, delivery, b, actor, {});
        return exported(delivery, app);
      }
      const c = get(app, "webhook_configs", b.id);
      check(c, b.expected_revision);
      if (c.getString("scope") !== "global") bad("Legacy receiver is retired");
      if (b.action === "webhook.credentials.update") {
        only(d, ["url", "secret", "clear_secret"]);
        validateConfig(app, d);
        const destination =
          (d.url !== undefined && d.url !== c.getString("url")) ||
          d.secret !== undefined ||
          d.clear_secret;
        if (d.url !== undefined && d.url !== c.getString("url"))
          c.set("secret_ciphertext", "");
        if (d.url !== undefined) c.set("url", d.url);
        if (d.secret !== undefined)
          c.set("secret_ciphertext", $pocketcontext.webhookSeal(app, d.secret));
        if (d.clear_secret) c.set("secret_ciphertext", "");
        if (destination)
          c.set("destination_version", c.getInt("destination_version") + 1);
        if (destination) {
          invalidateConfig(app, c, b, actor);
          c.set("enabled", false);
          cancel(app, "config={:config}", { config: c.id });
        }
      } else if (b.action === "webhook.integration.update") {
        only(d, [
          "agent",
          "instructions",
          "subscriptions",
          "role_instructions",
          "reporting_instructions",
          "dispatch_mode",
        ]);
        validateConfig(app, d);
        let changed = false;
        if (d.dispatch_mode !== undefined) {
          if (!["native", "parent_bridge"].includes(d.dispatch_mode))
            bad("Unsupported dispatch mode");
          if (d.dispatch_mode !== c.getString("dispatch_mode")) {
            c.set("dispatch_mode", d.dispatch_mode);
            c.set("destination_version", c.getInt("destination_version") + 1);
            c.set("sync_status", "unverified");
            changed = true;
          }
        }
        if (d.agent !== undefined && d.agent !== c.getString("agent")) {
          if (d.agent && !botAgent(app, d.agent))
            bad("Active dispatcher bot required");
          c.set("agent", d.agent || "");
          c.set("url", "");
          c.set("secret_ciphertext", "");
          c.set("routine_ref", "");
          c.set("sync_status", "unverified");
          c.set("applied_revision", 0);
          c.set("destination_version", c.getInt("destination_version") + 1);
          changed = true;
        }
        if (d.instructions !== undefined) {
          if (
            typeof d.instructions !== "string" ||
            !d.instructions.trim() ||
            d.instructions.length > 40000
          )
            bad("Dispatcher instructions required (at most 40000 characters)");
          if (d.instructions !== c.getString("instructions")) {
            if (setup.managed(d.instructions) !== d.instructions)
              setup.error(
                "instructions_mismatch",
                "Edit only the managed block here; keep role/report settings separately",
              );
            c.set("instructions", d.instructions);
            c.set("managed_hash", setup.hash(d.instructions));
            c.set("instruction_revision", c.getInt("instruction_revision") + 1);
            c.set("sync_status", "unverified");
            changed = true;
          }
        }
        if (
          d.subscriptions !== undefined &&
          JSON.stringify(d.subscriptions) !==
            JSON.stringify(json(c, "subscriptions", []))
        ) {
          c.set("subscriptions", d.subscriptions);
          changed = true;
        }
        for (const field of ["role_instructions", "reporting_instructions"]) {
          if (d[field] !== undefined) {
            if (typeof d[field] !== "string" || d[field].length > 40000)
              bad("Invalid role or reporting instructions");
            if (d[field] !== c.getString(field)) {
              c.set(field, d[field]);
              c.set("test_event_id", "");
              c.set("sync_status", "unverified");
              changed = true;
            }
          }
        }
        if (changed) {
          invalidateConfig(app, c, b, actor);
          c.set("enabled", false);
          cancel(app, "config={:config}", { config: c.id });
        }
      } else if (b.action === "webhook.instructions.sync") {
        only(d, [
          "instruction_revision",
          "routine_ref",
          "status",
          "instructions",
        ]);
        if (d.instruction_revision !== c.getInt("instruction_revision"))
          conflict(
            "Instruction revision changed; reread and apply current instructions",
          );
        if (!["reported", "verified"].includes(d.status))
          bad("Sync status must be reported or verified");
        if (
          typeof d.routine_ref !== "string" ||
          !d.routine_ref.trim() ||
          d.routine_ref.length > 1000
        )
          bad("Routine reference required");
        if (
          d.status === "verified" &&
          setup.hash(d.instructions) !== c.getString("managed_hash")
        )
          setup.error(
            "instructions_mismatch",
            "The Crew managed instruction block differs; preserve surrounding role/report text and apply the current block",
          );
        c.set(
          "applied_hash",
          d.status === "verified" ? c.getString("managed_hash") : "",
        );
        c.set("applied_revision", d.instruction_revision);
        c.set("sync_status", d.status);
        c.set("routine_ref", d.routine_ref);
      } else if (b.action === "webhook.runtime.report") {
        only(d, [
          "event_id",
          "context",
          "native_handoff",
          "execution_protocol",
          "parent_wake",
        ]);
        if (
          d.context !== "webhook" ||
          typeof d.native_handoff !== "boolean" ||
          typeof d.execution_protocol !== "boolean" ||
          (d.parent_wake !== undefined && typeof d.parent_wake !== "boolean")
        )
          bad("Report actual webhook-run capabilities");
        const delivery = rows(app, "webhook_deliveries", "event_id={:event}", {
          event: d.event_id,
        })[0];
        const rt = routing(app),
          p = delivery ? json(delivery, "payload", {}) : {};
        if (
          !delivery ||
          p.event_type !== "webhook.test" ||
          c.getString("test_event_id") !== d.event_id ||
          delivery.getString("config") !== c.id ||
          delivery.getString("epoch") !== rt.getString("epoch") ||
          delivery.getInt("destination_version") !==
            c.getInt("destination_version") ||
          p.instruction_revision !== c.getInt("instruction_revision")
        )
          setup.error(
            "stale_test",
            "Runtime report must reference a current connection test",
          );
        c.set("runtime_event_id", d.event_id);
        c.set("runtime_epoch", rt.getString("epoch"));
        c.set("runtime_context", "webhook");
        c.set("runtime_destination_version", c.getInt("destination_version"));
        c.set("runtime_instruction_revision", c.getInt("instruction_revision"));
        c.set("runtime_native_handoff", d.native_handoff);
        c.set("runtime_parent_wake", d.parent_wake === true);
        c.set("runtime_execution_protocol", d.execution_protocol);
        c.set("runtime_reported_at", new Date().toISOString());
      } else if (
        b.action === "webhook.enable" ||
        b.action === "webhook.disable"
      ) {
        only(d, []);
        const enabled = b.action === "webhook.enable";
        if (enabled) {
          requireReady(app, c);
          const status = setupStatus(app, c);
          if (!status.can_enable)
            setup.error(
              status.blockers[0].code,
              status.blockers[0].message,
              400,
            );
          const rt = routing(app);
          if (rt.getBool("paused")) {
            rt.set("paused", false);
            rt.set("revision", rt.getInt("revision") + 1);
            app.save(rt);
          }
        } else {
          if (c.getBool("enabled")) invalidateConfig(app, c, b, actor);
          cancel(app, "config={:config}", { config: c.id });
        }
        c.set("enabled", enabled);
      } else if (b.action === "webhook.test") {
        only(d, ["recipient_agent_id"]);
        requireReady(app, c);
        const rt = routing(app);
        // Explicit test resumes transport only; restored integrations remain disabled.
        if (rt.getBool("paused")) {
          rt.set("paused", false);
          rt.set("revision", rt.getInt("revision") + 1);
          app.save(rt);
        }
        const recipient =
          d.recipient_agent_id === undefined
            ? c.getString("agent")
            : d.recipient_agent_id;
        if (
          recipient !== c.getString("agent") &&
          c.getString("dispatch_mode") !== "parent_bridge"
        )
          bad("Cross-bot connection tests require parent bridge mode");
        const mapping = mappingFor(app, recipient);
        if (
          !botAgent(app, recipient) ||
          !mapping ||
          !mapping.getString("bot_ref")
        )
          bad("Choose an active mapped test recipient");
        const capabilities = require(`${__hooks}/crew_capabilities.js`);
        const payload = {
          schema_version: 1,
          protocol_version: capabilities.PROTOCOL_VERSION,
          capabilities_digest: capabilities.digest(),
          event_id: $pocketcontext.webhookUUID(),
          event_type: "webhook.test",
          instruction_revision: c.getInt("instruction_revision"),
          test: true,
          dispatcher_agent_id: c.getString("agent"),
          recipient_agent_id: recipient,
          recipient_bot_ref: mapping.getString("bot_ref"),
          mapping_revision: mapping.getInt("revision"),
          dispatch_mode: c.getString("dispatch_mode") || "native",
          config_id: c.id,
          destination_version: c.getInt("destination_version"),
          instance_id: rt.getString("instance_id"),
          epoch: rt.getString("epoch"),
          occurred_at: new Date().toISOString(),
        };
        c.set("test_event_id", payload.event_id);
        c.set("revision", c.getInt("revision") + 1);
        app.save(c);
        const result = enqueue(app, c, payload, null, "test");
        audit(app, c, b, actor, { delivery: result.id });
        return result;
      } else if (b.action === "webhook.catch_up") {
        only(d, ["tasks"]);
        if (!Array.isArray(d.tasks) || !d.tasks.length || d.tasks.length > 100)
          bad("Supply 1–100 task IDs and expected revisions");
        const seen = {};
        const tasks = d.tasks.map((entry) => {
          only(entry, ["id", "expected_revision"]);
          if (seen[entry.id]) bad("Duplicate task");
          seen[entry.id] = true;
          const t = get(app, "tasks", entry.id);
          check(t, entry.expected_revision);
          const target = route(app, t);
          if (
            !target ||
            target.config.id !== c.id ||
            !json(c, "subscriptions", []).includes("catch_up")
          )
            conflict(
              "Task is not eligible for this receiver's catch-up subscription",
            );
          return t;
        });
        const deliveries = [];
        for (const t of tasks) {
          t.set("wake_generation", t.getInt("wake_generation") + 1);
          t.set("revision", t.getInt("revision") + 1);
          app.save(t);
          cancel(app, "task={:task}", { task: t.id });
          deliveries.push(wake(app, t, ["catch_up"]));
          audit(app, t, b, actor, {
            wake_generation: t.getInt("wake_generation"),
          });
        }
        return { deliveries };
      } else bad("Unknown webhook action");
      c.set("revision", c.getInt("revision") + 1);
      app.save(c);
      audit(app, c, b, actor, {
        enabled: c.getBool("enabled"),
        destination_version: c.getInt("destination_version"),
        credential_changed: d.secret !== undefined || !!d.clear_secret,
      });
      return exported(c, app);
    },
    [
      "agent.ensure",
      "webhook.create",
      "webhook.test",
      "webhook.catch_up",
    ].includes(b.action),
  );
}
function invalidateTriage(app, b, actor) {
  for (const t of rows(
    app,
    "tasks",
    "assigned_agent='' && readiness='ready' && archived=false && (status='todo' || status='in_progress')",
  )) {
    t.set("wake_generation", t.getInt("wake_generation") + 1);
    t.set("revision", t.getInt("revision") + 1);
    app.save(t);
    cancel(app, "task={:task}", { task: t.id });
    audit(app, t, b, actor, {
      wake_generation: t.getInt("wake_generation"),
      triage_invalidated: true,
    });
  }
}
function invalidateConfig(app, config, b, actor) {
  const agent = config.getString("agent"),
    global = config.getString("scope") === "global";
  if (global || routing(app).getString("triage_agent") === agent)
    invalidateTriage(app, b, actor);
  for (const t of rows(
    app,
    "tasks",
    (global ? "assigned_agent!=''" : "assigned_agent={:agent}") +
      " && readiness='ready' && archived=false && (status='todo' || status='in_progress')",
    { agent },
  )) {
    t.set("wake_generation", t.getInt("wake_generation") + 1);
    t.set("revision", t.getInt("revision") + 1);
    app.save(t);
    cancel(app, "task={:task}", { task: t.id });
    audit(app, t, b, actor, {
      wake_generation: t.getInt("wake_generation"),
      config_invalidated: config.id,
    });
  }
}
function deactivate(app, agent, b, actor) {
  const c = globalConfig(app);
  if (c && c.getString("agent") === agent) {
    invalidateConfig(app, c, b, actor);
    c.set("enabled", false);
    c.set("revision", c.getInt("revision") + 1);
    app.save(c);
    cancel(app, "config={:config}", { config: c.id });
  }
  if (routing(app).getString("triage_agent") === agent)
    invalidateTriage(app, b, actor);
  for (const t of rows(app, "tasks", "assigned_agent={:agent}", { agent })) {
    t.set("wake_generation", t.getInt("wake_generation") + 1);
    t.set("revision", t.getInt("revision") + 1);
    app.save(t);
    cancel(app, "task={:task}", { task: t.id });
    audit(app, t, b, actor, {
      wake_generation: t.getInt("wake_generation"),
      invalidated_by_agent: agent,
    });
  }
  cancel(app, "agent={:agent}", { agent });
}
module.exports = {
  AGENT_KINDS,
  TERMINAL_STATUSES,
  terminal,
  agentKind,
  claimState,
  route,
  routing,
  get,
  json,
  check,
  rows,
  idempotent,
  audit,
  mappingFor,
  globalConfig,
  collections,
  exported,
  withLinks,
  linkedExport,
  handle,
  state,
  eligible,
  transition,
  advanceGeneration,
  deactivate,
  ownerComment,
  deferredCommentWake,
  clearCommentWake,
  commentWakePending,
  maxBotHandoffs,
  reasons,
};
