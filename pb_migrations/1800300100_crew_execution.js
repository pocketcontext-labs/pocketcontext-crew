// Durable dispatch and work coordination; records remain as execution history.
migrate(
  (app) => {
    const text = (name, max = 200) => ({ name, type: "text", max });
    const number = (name) => ({ name, type: "number", min: 0, onlyInt: true });
    app.save(
      new Collection({
        name: "crew_webhook_executions",
        type: "base",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          text("event_id"),
          text("delivery", 15),
          text("task", 15),
          text("agent", 15),
          text("config", 15),
          text("epoch"),
          number("generation"),
          number("destination_version"),
          number("mapping_revision"),
          text("state", 30),
          text("worker_id"),
          text("dispatch_worker_id"),
          number("dispatch_fence"),
          text("handoff_at"),
          number("fence"),
          number("dispatch_attempts"),
          text("lease_until"),
          text("outcome_code"),
          text("completed_at"),
          number("revision"),
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
        indexes: [
          "CREATE UNIQUE INDEX crew_execution_event ON crew_webhook_executions(event_id)",
          "CREATE INDEX crew_execution_task ON crew_webhook_executions(task,state)",
        ],
      }),
    );
  },
  () => {
    throw new Error(
      "Restore a verified complete backup; execution history cannot be removed live",
    );
  },
);
