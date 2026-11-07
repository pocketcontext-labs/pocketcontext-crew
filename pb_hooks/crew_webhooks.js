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
];
const collections = [
  "webhook_configs",
  "webhook_deliveries",
  "webhook_attempts",
  "webhook_routing",
];
function bad(message) {
  throw new BadRequestError(message);
}
function conflict(message) {
  throw new ApiError(409, message, {});
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
function exported(record) {
  const result = record.publicExport();
  delete result.secret_ciphertext;
  if (record.collection().name === "crew_webhook_configs")
    result.secret_configured = !!record.getString("secret_ciphertext");
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
    return json(existing[0], "result", {});
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
function route(app, t) {
  const s = state(app, t),
    rt = routing(app);
  if (!eligible(s) || rt.getBool("paused")) return null;
  const id = s.assigned || rt.getString("triage_agent");
  if (!activeAgent(app, id)) return null;
  const config = rows(app, "webhook_configs", "agent={:agent}", {
    agent: id,
  })[0];
  if (!config || !config.getBool("enabled")) return null;
  return {
    config,
    agent: id,
    kind: s.assigned ? "assignee" : "triage",
    routing: rt,
  };
}
function enqueue(app, config, payload, t, target) {
  const row = new Record(
    app.findCollectionByNameOrId("crew_webhook_deliveries"),
  );
  const now = new Date();
  row.set("config", config.id);
  row.set("task", t ? t.id : "");
  row.set("agent", config.getString("agent"));
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
  return exported(row);
}
function wake(app, t, causes, outcome) {
  const target = route(app, t);
  if (!target) return null;
  const subscriptions = json(target.config, "subscriptions", []);
  if (!causes.some((x) => subscriptions.includes(x))) return null;
  const reason = reasons.find((x) => causes.includes(x));
  const payload = {
    schema_version: 1,
    event_id: $pocketcontext.webhookUUID(),
    event_type: "task.wake",
    instance_id: target.routing.getString("instance_id"),
    epoch: target.routing.getString("epoch"),
    config_id: target.config.id,
    destination_version: target.config.getInt("destination_version"),
    target_agent_id: target.agent,
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
  return enqueue(app, target.config, payload, t, target.kind);
}
function transition(app, t, old, options) {
  options = options || {};
  const current = state(app, t),
    causes = [];
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
      (old.status === "done" && current.status !== "done")
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
    app.save(t);
    cancel(app, "task={:task}", { task: t.id });
  }
  if (notify) wake(app, t, causes, options.outcome);
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
function handle(app, b, actor) {
  const d = b.data || {};
  return idempotent(
    app,
    b,
    () => {
      if (b.action === "agent.ensure") {
        only(d, ["name", "brief", "agent"]);
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
          return exported(agent);
        }
        agent = new Record(app.findCollectionByNameOrId("crew_agents"));
        agent.set("name", d.name);
        agent.set("brief", d.brief || "");
        agent.set("revision", 1);
        app.save(agent);
        audit(app, agent, b, actor, { name: d.name });
        return exported(agent);
      }
      if (b.action === "webhook.routing.update") {
        only(d, ["triage_agent"]);
        const rt = routing(app);
        check(rt, b.expected_revision);
        if (d.triage_agent === undefined)
          bad("triage_agent is required; use null to clear");
        const id = d.triage_agent || "";
        if (id && !activeAgent(app, id)) bad("Active triage agent required");
        if (rt.getString("triage_agent") !== id) {
          invalidateTriage(app, b, actor);
          cancel(app, "target_kind='triage'", {});
        }
        rt.set("triage_agent", id);
        rt.set("revision", rt.getInt("revision") + 1);
        app.save(rt);
        audit(app, rt, b, actor, { triage_agent: id });
        return exported(rt);
      }
      if (b.action === "webhook.create") {
        only(d, ["agent", "url", "adapter", "subscriptions", "secret"]);
        validateConfig(app, d);
        if (!activeAgent(app, d.agent)) bad("Active agent required");
        if (!d.url || !d.adapter || !d.subscriptions)
          bad("url, adapter and subscriptions required");
        if (
          rows(app, "webhook_configs", "agent={:agent}", { agent: d.agent })
            .length
        )
          conflict(
            "Agent already has a webhook configuration; read and reuse or update it",
          );
        const c = new Record(
          app.findCollectionByNameOrId("crew_webhook_configs"),
        );
        for (const k of ["agent", "url", "adapter", "subscriptions"])
          c.set(k, d[k]);
        if (d.secret)
          c.set("secret_ciphertext", $pocketcontext.webhookSeal(app, d.secret));
        c.set("enabled", false);
        c.set("destination_version", 1);
        c.set("revision", 1);
        app.save(c);
        audit(app, c, b, actor, {
          agent: d.agent,
          credential_changed: !!d.secret,
        });
        return exported(c);
      }
      if (b.action === "webhook.retry") {
        only(d, ["config_revision"]);
        const delivery = get(app, "webhook_deliveries", b.id);
        check(delivery, b.expected_revision);
        const c = get(app, "webhook_configs", delivery.getString("config"));
        check(c, d.config_revision);
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
        return exported(delivery);
      }
      const c = get(app, "webhook_configs", b.id);
      check(c, b.expected_revision);
      if (b.action === "webhook.update") {
        only(d, ["url", "adapter", "subscriptions", "secret", "clear_secret"]);
        validateConfig(app, d);
        const destination =
          (d.url !== undefined && d.url !== c.getString("url")) ||
          (d.adapter !== undefined && d.adapter !== c.getString("adapter")) ||
          d.secret !== undefined ||
          d.clear_secret;
        const changedSubs =
          d.subscriptions !== undefined &&
          JSON.stringify(d.subscriptions) !==
            JSON.stringify(json(c, "subscriptions", []));
        for (const k of ["url", "adapter", "subscriptions"])
          if (d[k] !== undefined) c.set(k, d[k]);
        if (d.secret !== undefined)
          c.set("secret_ciphertext", $pocketcontext.webhookSeal(app, d.secret));
        if (d.clear_secret) c.set("secret_ciphertext", "");
        if (destination)
          c.set("destination_version", c.getInt("destination_version") + 1);
        if (destination || changedSubs) {
          invalidateConfig(app, c, b, actor);
          c.set("enabled", false);
          cancel(app, "config={:config}", { config: c.id });
        }
      } else if (
        b.action === "webhook.enable" ||
        b.action === "webhook.disable"
      ) {
        only(d, []);
        const enabled = b.action === "webhook.enable";
        if (enabled) {
          if (!activeAgent(app, c.getString("agent")))
            bad("Active agent required");
          if (!c.getString("secret_ciphertext"))
            bad("Receiver credential required");
          credentialReady(app, c.getString("secret_ciphertext"));
          validateEndpoint(c.getString("url"));
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
        only(d, []);
        if (!c.getString("secret_ciphertext"))
          bad("Receiver credential required");
        credentialReady(app, c.getString("secret_ciphertext"));
        const rt = routing(app);
        if (rt.getBool("paused"))
          bad("Delivery is paused after restore; enable explicitly first");
        const payload = {
          schema_version: 1,
          event_id: $pocketcontext.webhookUUID(),
          event_type: "webhook.test",
          test: true,
          config_id: c.id,
          destination_version: c.getInt("destination_version"),
          instance_id: rt.getString("instance_id"),
          epoch: rt.getString("epoch"),
          occurred_at: new Date().toISOString(),
        };
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
      return exported(c);
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
  const agent = config.getString("agent");
  if (routing(app).getString("triage_agent") === agent)
    invalidateTriage(app, b, actor);
  for (const t of rows(
    app,
    "tasks",
    "assigned_agent={:agent} && readiness='ready' && archived=false && (status='todo' || status='in_progress')",
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
  collections,
  exported,
  handle,
  state,
  eligible,
  transition,
  deactivate,
};
