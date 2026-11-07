// Coordination is transactional. Reported worker IDs are fencing handles, not identities.
const wh = require(`${__hooks}/crew_webhooks.js`);
const collections = ["webhook_executions"];
function fail(message) {
  throw new ApiError(409, message, {});
}
function bad(message) {
  throw new BadRequestError(message);
}
function only(d, keys) {
  for (const key of Object.keys(d))
    if (!keys.includes(key)) bad("Unsupported field: " + key);
}
function exported(r) {
  return r.publicExport();
}
function rows(app, filter, params) {
  return wh.rows(app, "webhook_executions", filter, params);
}
function current(app, delivery, expected) {
  const payload = wh.json(delivery, "payload", {}),
    rt = wh.routing(app);
  if (payload.event_type !== "task.wake")
    fail("Only task wake events can execute work");
  if (
    delivery.getString("epoch") !== rt.getString("epoch") ||
    rt.getBool("paused")
  )
    fail("Obsolete or paused execution epoch");
  if (
    expected &&
    (expected.epoch !== delivery.getString("epoch") ||
      expected.generation !== delivery.getInt("generation"))
  )
    fail("Event epoch or generation mismatch");
  const task = wh.get(app, "tasks", delivery.getString("task")),
    target = wh.route(app, task);
  if (
    !target ||
    target.config.id !== delivery.getString("config") ||
    target.agent !== delivery.getString("agent") ||
    target.kind !== delivery.getString("target_kind") ||
    task.getInt("wake_generation") !== delivery.getInt("generation") ||
    target.config.getInt("destination_version") !==
      delivery.getInt("destination_version")
  )
    fail("Execution is no longer eligible");
  const mapping = wh.rows(app, "webhook_mappings", "agent={:agent}", {
    agent: target.agent,
  })[0];
  if (
    !mapping ||
    mapping.getInt("revision") !== payload.mapping_revision ||
    mapping.getString("bot_ref") !== payload.recipient_bot_ref
  )
    fail("Recipient mapping changed");
  return { task, target, payload };
}
function leaseSeconds(d) {
  const n = d.lease_seconds === undefined ? 300 : d.lease_seconds;
  if (!Number.isInteger(n) || n < 30 || n > 900)
    bad("lease_seconds must be between 30 and 900");
  return n;
}
function worker(d) {
  if (
    typeof d.worker_id !== "string" ||
    !d.worker_id.trim() ||
    d.worker_id.length > 200
  )
    bad("worker_id required");
}
function deliveryFor(app, r) {
  return wh.get(app, "webhook_deliveries", r.getString("delivery"));
}
function proof(app, r, d) {
  worker(d);
  if (
    r.getString("worker_id") !== d.worker_id ||
    r.getInt("fence") !== d.fence ||
    Date.parse(r.getString("lease_until")) <= Date.now()
  )
    fail("Execution lease expired or fenced");
  return current(app, deliveryFor(app, r));
}
function save(app, r, b, actor, changes) {
  r.set("revision", r.getInt("revision") + 1);
  app.save(r);
  wh.audit(
    app,
    r,
    b,
    actor,
    changes || { state: r.getString("state"), fence: r.getInt("fence") },
  );
  return exported(r);
}
function invalidateStale(app, task, b, actor) {
  for (const r of rows(
    app,
    "task={:task} && (state='dispatching' || state='handed_off' || state='running')",
    { task: task.id },
  )) {
    try {
      current(app, deliveryFor(app, r));
    } catch (_) {
      r.set("state", "invalidated");
      r.set("outcome_code", "work_no_longer_eligible");
      r.set("fence", r.getInt("fence") + 1);
      r.set("lease_until", "");
      r.set("worker_id", "");
      r.set("dispatch_worker_id", "");
      save(app, r, b, actor, { invalidated: true });
    }
  }
}
function handle(app, b, actor, isAgent) {
  const d = b.data || {};
  if (b.action === "execution.recover" && isAgent)
    throw new ForbiddenError("Execution recovery requires the owner");
  // Validation is a fresh read, never a cached idempotency result.
  if (b.action === "execution.validate") {
    only(d, ["event_id", "epoch", "generation"]);
    const delivery = wh.rows(app, "webhook_deliveries", "event_id={:event}", {
      event: d.event_id,
    })[0];
    if (!delivery) fail("Event not found");
    const info = current(app, delivery, d);
    return {
      valid: true,
      task: info.task.publicExport(),
      recipient_agent_id: info.target.agent,
      recipient_bot_ref: info.payload.recipient_bot_ref,
      dispatcher_agent_id: info.target.config.getString("agent"),
      epoch: delivery.getString("epoch"),
      generation: delivery.getInt("generation"),
    };
  }
  // Replay is a historical result, not renewed authority: every subsequent action rechecks lease.
  return wh.idempotent(
    app,
    b,
    () => {
      if (b.action === "execution.test_ack") {
        only(d, ["event_id", "epoch"]);
        const delivery = wh.rows(
          app,
          "webhook_deliveries",
          "event_id={:event}",
          { event: d.event_id },
        )[0];
        if (!delivery) fail("Event not found");
        const payload = wh.json(delivery, "payload", {}),
          rt = wh.routing(app),
          config = wh.get(app, "webhook_configs", delivery.getString("config"));
        if (
          payload.event_type !== "webhook.test" ||
          d.epoch !== rt.getString("epoch") ||
          delivery.getString("epoch") !== d.epoch ||
          config.getInt("destination_version") !==
            delivery.getInt("destination_version") ||
          rt.getBool("paused")
        )
          fail("Test event is stale or invalid");
        let ack = rows(app, "event_id={:event}", { event: d.event_id })[0];
        if (ack) return exported(ack);
        ack = new Record(
          app.findCollectionByNameOrId("crew_webhook_executions"),
        );
        ack.set("event_id", d.event_id);
        ack.set("delivery", delivery.id);
        ack.set("config", config.id);
        ack.set("epoch", d.epoch);
        ack.set("agent", config.getString("agent"));
        ack.set("state", "test_acknowledged");
        ack.set("outcome_code", "test_no_task_action");
        ack.set("completed_at", new Date().toISOString());
        return save(app, ack, b, actor);
      }
      if (b.action === "execution.acquire") {
        only(d, [
          "event_id",
          "epoch",
          "generation",
          "phase",
          "worker_id",
          "lease_seconds",
        ]);
        worker(d);
        const seconds = leaseSeconds(d);
        if (!["dispatch", "work"].includes(d.phase))
          bad("phase must be dispatch or work");
        const ds = wh.rows(app, "webhook_deliveries", "event_id={:event}", {
          event: d.event_id,
        });
        if (ds.length !== 1) fail("Event not found");
        const delivery = ds[0],
          info = current(app, delivery, d);
        invalidateStale(app, info.task, b, actor);
        let r = rows(app, "event_id={:event}", { event: d.event_id })[0];
        if (r) {
          const state = r.getString("state");
          if (state === "completed") fail("Execution already completed");
          // Work handoff is a one-way transition. Expiry never silently grants another worker.
          if (d.phase !== "work" || state !== "handed_off")
            fail(
              "Execution already acquired; reconcile or explicitly recover it",
            );
        }
        for (const other of rows(
          app,
          "task={:task} && (state='dispatching' || state='handed_off' || state='running')",
          { task: delivery.getString("task") },
        )) {
          if (!r || other.id !== r.id)
            fail("Task has another unresolved execution; reconcile it first");
        }
        if (!r) {
          r = new Record(
            app.findCollectionByNameOrId("crew_webhook_executions"),
          );
          for (const k of ["event_id", "task", "agent", "config", "epoch"])
            r.set(k, delivery.getString(k));
          r.set("delivery", delivery.id);
          r.set("generation", delivery.getInt("generation"));
          r.set("destination_version", delivery.getInt("destination_version"));
          r.set("mapping_revision", info.payload.mapping_revision);
          r.set("revision", 0);
        }
        r.set("state", d.phase === "dispatch" ? "dispatching" : "running");
        r.set("worker_id", d.worker_id);
        r.set("fence", r.getInt("fence") + 1);
        r.set(
          "lease_until",
          new Date(Date.now() + seconds * 1000).toISOString(),
        );
        if (d.phase === "dispatch") {
          r.set("dispatch_attempts", r.getInt("dispatch_attempts") + 1);
          r.set("dispatch_worker_id", d.worker_id);
          r.set("dispatch_fence", r.getInt("fence"));
        }
        return save(app, r, b, actor);
      }
      const r = wh.get(app, "webhook_executions", b.id);
      wh.check(r, b.expected_revision);
      if (b.action === "execution.dispatched") {
        only(d, ["worker_id", "fence"]);
        worker(d);
        if (
          r.getString("dispatch_worker_id") !== d.worker_id ||
          r.getInt("dispatch_fence") !== d.fence ||
          !["handed_off", "running", "completed"].includes(r.getString("state"))
        )
          fail("Handoff report does not match dispatcher");
        if (!r.getString("handoff_at"))
          r.set("handoff_at", new Date().toISOString());
        return save(app, r, b, actor, { handoff_reported: true });
      }
      if (b.action === "execution.recover") {
        only(d, ["resolution"]);
        if (isAgent)
          throw new ForbiddenError("Execution recovery requires the owner");
        if (!["cancel", "retry"].includes(d.resolution))
          bad("resolution must be cancel or retry");
        if (
          ["completed", "test_acknowledged", "invalidated"].includes(
            r.getString("state"),
          )
        )
          fail("Terminal execution cannot be recovered");
        if (
          ["dispatching", "running"].includes(r.getString("state")) &&
          Date.parse(r.getString("lease_until")) > Date.now()
        )
          fail("Wait for the active lease to expire before recovery");
        r.set("fence", r.getInt("fence") + 1);
        r.set("lease_until", "");
        r.set("worker_id", "");
        r.set("dispatch_worker_id", "");
        r.set("dispatch_fence", 0);
        r.set("state", "failed");
        r.set(
          "outcome_code",
          d.resolution === "cancel"
            ? "owner_cancelled"
            : "owner_retry_authorized",
        );
        // Retry is explicit on this record, preserving event identity and history; acquisition below uses handed_off.
        if (d.resolution === "retry") {
          current(app, deliveryFor(app, r));
          r.set("state", "handed_off");
        }
        return save(app, r, b, actor);
      }
      only(
        d,
        b.action === "execution.renew"
          ? ["worker_id", "fence", "lease_seconds"]
          : b.action === "execution.complete"
            ? ["worker_id", "fence", "outcome", "mark_done", "task_revision"]
            : ["worker_id", "fence"],
      );
      const info = proof(app, r, d),
        state = r.getString("state");
      if (b.action === "execution.renew") {
        if (!["dispatching", "running"].includes(state))
          fail("No renewable execution");
        r.set(
          "lease_until",
          new Date(Date.now() + leaseSeconds(d) * 1000).toISOString(),
        );
      } else if (b.action === "execution.handoff") {
        if (state !== "dispatching") fail("Not a dispatcher lease");
        r.set("state", "handed_off");
        r.set("lease_until", "");
        r.set("worker_id", "");
      } else if (b.action === "execution.start") {
        if (
          state !== "dispatching" ||
          info.target.config.getString("agent") !== r.getString("agent")
        )
          fail("Only self-directed dispatch can start locally");
        r.set("state", "running");
      } else if (b.action === "execution.complete") {
        if (!["dispatching", "running"].includes(state))
          fail("No active execution");
        if (!["completed", "failed"].includes(d.outcome))
          bad("outcome must be completed or failed");
        if (state === "dispatching" && d.outcome === "completed")
          fail("Dispatch alone does not complete work");
        if (d.mark_done !== undefined && typeof d.mark_done !== "boolean")
          bad("mark_done must be boolean");
        if (d.mark_done) {
          if (d.outcome !== "completed" || state !== "running")
            bad("Only completed work may finish its task");
          wh.check(info.task, d.task_revision);
          const before = wh.state(app, info.task);
          info.task.set("status", "done");
          info.task.set("revision", info.task.getInt("revision") + 1);
          app.save(info.task);
          wh.transition(app, info.task, before, {});
          wh.audit(app, info.task, b, actor, { status: "done" });
        }
        r.set("state", d.outcome);
        r.set(
          "outcome_code",
          d.outcome === "completed" ? "worker_completed" : "worker_failed",
        );
        r.set("completed_at", new Date().toISOString());
        r.set("lease_until", "");
      } else bad("Unknown execution action");
      return save(app, r, b, actor);
    },
    true,
  );
}
// Called in the same transaction as task writes. Owner edits remain authoritative.
function guardTaskWrite(app, task, b, isAgent) {
  if (!isAgent) return;
  invalidateStale(app, task, b, "system:execution-reconcile");
  const active = rows(
    app,
    "task={:task} && (state='dispatching' || state='handed_off' || state='running')",
    { task: task.id },
  );
  if (!active.length && !b.execution) return;
  const p = b.execution;
  if (!p || typeof p !== "object")
    fail("Task execution requires its current fencing proof");
  only(p, ["id", "worker_id", "fence"]);
  const r = wh.get(app, "webhook_executions", p.id);
  if (r.getString("task") !== task.id || r.getString("state") !== "running")
    fail("Task execution proof does not match active work");
  proof(app, r, p);
}
module.exports = {
  collections,
  exported,
  handle,
  guardTaskWrite,
  invalidateStale,
};
