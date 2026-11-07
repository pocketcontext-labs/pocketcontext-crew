// Durable parent-wake coordination. Shared MCP claims are not authenticated bot identities.
const wh = require(`${__hooks}/crew_webhooks.js`);
function fail(message, code = "bridge_conflict") {
  throw new ApiError(409, message, {
    reason: new ValidationError(code, message),
  });
}
function only(d, keys) {
  for (const k of Object.keys(d))
    if (!keys.includes(k)) throw new BadRequestError("Unsupported field: " + k);
}
function exported(r) {
  const out = r.publicExport();
  out.overdue =
    !r.getString("recipient_received_at") &&
    (r.getString("state") === "wake_prepared" ||
      r.getString("state") === "send_prepared") &&
    (!Number.isFinite(Date.parse(r.getString("deadline_at"))) ||
      Date.parse(r.getString("deadline_at")) <= Date.now());
  return out;
}
function current(app, delivery) {
  const p = wh.json(delivery, "payload", {}),
    c = wh.get(app, "webhook_configs", delivery.getString("config")),
    rt = wh.routing(app);
  if (
    c.getString("dispatch_mode") !== "parent_bridge" ||
    rt.getBool("paused") ||
    p.epoch !== rt.getString("epoch") ||
    delivery.getString("epoch") !== p.epoch ||
    c.getInt("destination_version") !==
      delivery.getInt("destination_version") ||
    c.getInt("instruction_revision") !== p.instruction_revision
  )
    fail("Parent bridge event is stale", "stale_bridge");
  if (p.event_type === "webhook.test") {
    if (c.getString("test_event_id") !== p.event_id)
      fail("Connection test has been superseded", "stale_test");
  } else if (p.event_type === "task.wake") {
    require(`${__hooks}/crew_execution.js`).current(app, delivery);
  } else fail("Unsupported bridge event");
  const m = wh.mappingFor(app, p.recipient_agent_id);
  if (
    !m ||
    m.getInt("revision") !== p.mapping_revision ||
    m.getString("bot_ref") !== p.recipient_bot_ref
  )
    fail("Recipient mapping changed", "stale_bridge");
  const a = wh.get(app, "agents", p.recipient_agent_id);
  if (a.getBool("archived")) fail("Recipient is inactive", "stale_bridge");
  return { p, c };
}
function forEvent(app, event) {
  return wh.rows(app, "webhook_bridges", "event_id={:event}", { event })[0];
}
function save(app, r, b, actor) {
  r.set("revision", r.getInt("revision") + 1);
  app.save(r);
  wh.audit(app, r, b, actor, { state: r.getString("state") });
  return exported(r);
}
function handle(app, b, actor) {
  const d = b.data || {};
  let applied = false;
  const result = wh.idempotent(
    app,
    b,
    () => {
      applied = true;
      if (b.action === "webhook.bridge.prepare") {
        only(d, ["event_id", "epoch", "worker_id"]);
        if (
          typeof d.worker_id !== "string" ||
          !d.worker_id.trim() ||
          d.worker_id.length > 200
        )
          throw new BadRequestError("worker_id required");
        const delivery = wh.rows(
          app,
          "webhook_deliveries",
          "event_id={:event}",
          { event: d.event_id },
        )[0];
        if (!delivery || delivery.getString("epoch") !== d.epoch)
          fail("Bridge event not found or epoch mismatch");
        const { p, c } = current(app, delivery);
        const existing = forEvent(app, d.event_id);
        if (existing) return { ...exported(existing), next_step: "reconcile" };
        const r = new Record(
          app.findCollectionByNameOrId("crew_webhook_bridges"),
        );
        for (const key of ["event_id", "epoch", "config"])
          r.set(key, delivery.getString(key));
        r.set("delivery", delivery.id);
        r.set("task_id", delivery.getString("task"));
        r.set("generation", delivery.getInt("generation"));
        r.set("event_type", p.event_type);
        r.set("dispatch_mode", "parent_bridge");
        r.set("instruction_revision", p.instruction_revision);
        r.set("destination_version", c.getInt("destination_version"));
        r.set("recipient_agent", p.recipient_agent_id);
        r.set("recipient_bot_ref", p.recipient_bot_ref);
        r.set("mapping_revision", p.mapping_revision);
        r.set("wake_worker_id", d.worker_id);
        r.set("state", "wake_prepared");
        r.set("wake_prepared_at", new Date().toISOString());
        r.set("deadline_at", new Date(Date.now() + 300000).toISOString());
        return { ...save(app, r, b, actor), next_step: "wake_parent" };
      }
      const r = wh.get(app, "webhook_bridges", b.id);
      wh.check(r, b.expected_revision);
      const { p, c } = current(
        app,
        wh.get(app, "webhook_deliveries", r.getString("delivery")),
      );
      if (b.action === "webhook.bridge.parent") {
        only(d, ["native_handoff", "execution_protocol"]);
        if (
          typeof d.native_handoff !== "boolean" ||
          typeof d.execution_protocol !== "boolean"
        )
          throw new BadRequestError("Report actual parent-turn capabilities");
        if (r.getString("parent_received_at"))
          return { ...exported(r), next_step: "reconcile" };
        if (exported(r).overdue)
          fail(
            "Parent wake deadline expired; reconcile without retrying",
            "bridge_overdue",
          );
        r.set("parent_received_at", new Date().toISOString());
        r.set("parent_native_handoff", d.native_handoff);
        r.set("parent_execution_protocol", d.execution_protocol);
        r.set("state", "parent_received");
        let next = "stop";
        if (d.execution_protocol && d.native_handoff) {
          next =
            p.event_type === "task.wake" ? "dispatch_task" : "test_complete";
          if (
            p.event_type === "webhook.test" &&
            p.recipient_agent_id !== c.getString("agent")
          ) {
            next = "send_test";
            r.set("state", "send_prepared");
            r.set("send_prepared_at", new Date().toISOString());
            r.set("deadline_at", new Date(Date.now() + 300000).toISOString());
          }
        }
        return { ...save(app, r, b, actor), next_step: next };
      }
      if (b.action === "webhook.bridge.sent") {
        only(d, ["sent", "message_ref"]);
        if (
          d.sent !== true ||
          (d.message_ref !== undefined &&
            (typeof d.message_ref !== "string" || d.message_ref.length > 1000))
        )
          throw new BadRequestError(
            "Record a real send result without inventing a receipt",
          );
        if (p.event_type !== "webhook.test" || !r.getString("send_prepared_at"))
          fail("No diagnostic send was prepared");
        if (!r.getString("send_reported_at")) {
          r.set("send_reported_at", new Date().toISOString());
          r.set("message_ref", d.message_ref || "");
          return save(app, r, b, actor);
        }
        if ((d.message_ref || "") !== r.getString("message_ref"))
          fail("Conflicting send result");
        return exported(r);
      }
      if (b.action === "webhook.bridge.ack") {
        only(d, ["recipient_agent_id", "automatic"]);
        if (d.automatic !== true)
          throw new BadRequestError(
            "Acknowledge only from the automatically activated recipient turn",
          );
        if (
          p.event_type !== "webhook.test" ||
          !r.getString("send_prepared_at") ||
          d.recipient_agent_id !== r.getString("recipient_agent")
        )
          fail(
            "Recipient acknowledgment does not match the prepared diagnostic",
          );
        if (r.getString("recipient_received_at")) return exported(r);
        if (exported(r).overdue)
          fail(
            "Recipient acknowledgment deadline expired; reconcile without retrying",
            "bridge_overdue",
          );
        r.set("recipient_received_at", new Date().toISOString());
        r.set("recipient_automatic", true);
        r.set("state", "recipient_received");
        return save(app, r, b, actor);
      }
      throw new BadRequestError("Unknown bridge operation");
    },
    true,
  );
  if (
    !applied &&
    ["webhook.bridge.prepare", "webhook.bridge.parent"].includes(b.action)
  ) {
    const r = wh.get(app, "webhook_bridges", result.id);
    return { ...exported(r), next_step: "reconcile" };
  }
  return result;
}
module.exports = { handle, current, forEvent, exported };
