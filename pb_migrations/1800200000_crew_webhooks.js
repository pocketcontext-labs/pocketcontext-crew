// Webhook state shares the task transaction and normal snapshot lifecycle.
migrate(
  (app) => {
    const text = (name, max = 2000, hidden = false) => ({
      name,
      type: "text",
      max,
      hidden,
    });
    const number = (name) => ({ name, type: "number", min: 0, onlyInt: true });
    const json = (name) => ({ name, type: "json", maxSize: 1048576 });
    function create(name, fields, indexes = []) {
      app.save(
        new Collection({
          name: "crew_" + name,
          type: "base",
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          fields: [
            ...fields,
            number("revision"),
            { name: "created", type: "autodate", onCreate: true },
            {
              name: "updated",
              type: "autodate",
              onCreate: true,
              onUpdate: true,
            },
          ],
          indexes,
        }),
      );
    }
    const tasks = app.findCollectionByNameOrId("crew_tasks");
    tasks.fields.add(
      new SelectField({
        name: "readiness",
        values: ["waiting", "ready"],
        maxSelect: 1,
      }),
    );
    tasks.fields.add(new TextField({ name: "waiting_reason", max: 2000 }));
    tasks.fields.add(
      new NumberField({ name: "wake_generation", min: 0, onlyInt: true }),
    );
    app.save(tasks);
    app.db().newQuery("UPDATE crew_tasks SET readiness='waiting'").execute();
    create(
      "webhook_configs",
      [
        text("agent", 15),
        text("url", 4096),
        text("adapter", 100),
        json("subscriptions"),
        text("secret_ciphertext", 20000, true),
        { name: "enabled", type: "bool" },
        number("destination_version"),
      ],
      ["CREATE UNIQUE INDEX crew_webhook_agent ON crew_webhook_configs(agent)"],
    );
    create(
      "webhook_routing",
      [
        text("singleton", 20),
        text("instance_id", 100),
        text("epoch", 100),
        text("triage_agent", 15),
        { name: "paused", type: "bool" },
      ],
      [
        "CREATE UNIQUE INDEX crew_webhook_singleton ON crew_webhook_routing(singleton)",
      ],
    );
    const routing = new Record(
      app.findCollectionByNameOrId("crew_webhook_routing"),
    );
    routing.set("singleton", "routing");
    routing.set("instance_id", $security.randomString(32));
    routing.set("epoch", $security.randomString(32));
    routing.set("revision", 1);
    app.save(routing);
    create(
      "webhook_deliveries",
      [
        text("config", 15),
        text("task", 15),
        text("agent", 15),
        text("target_kind", 20),
        number("generation"),
        text("epoch", 100),
        text("event_id", 100),
        json("payload"),
        text("state", 30),
        number("destination_version"),
        number("attempts"),
        number("retry_cycle"),
        text("next_attempt_at", 100),
        text("deadline_at", 100),
        text("lease_until", 100),
        text("last_error", 200),
        text("accepted_at", 100),
      ],
      [
        "CREATE UNIQUE INDEX crew_webhook_event ON crew_webhook_deliveries(event_id)",
        "CREATE UNIQUE INDEX crew_webhook_generation ON crew_webhook_deliveries(epoch,task,generation,agent,target_kind) WHERE task != ''",
        "CREATE INDEX crew_webhook_due ON crew_webhook_deliveries(state,next_attempt_at)",
      ],
    );
    create("webhook_attempts", [
      text("delivery", 15),
      text("phase", 20),
      number("attempt"),
      number("retry_cycle"),
      number("status_code"),
      text("error_code", 200),
      text("started_at", 100),
      text("finished_at", 100),
    ]);
    create(
      "webhook_idempotency",
      [
        text("operation", 100),
        text("key", 200),
        text("fingerprint", 200, true),
        json("result"),
      ],
      [
        "CREATE UNIQUE INDEX crew_webhook_idempotent ON crew_webhook_idempotency(operation,key)",
      ],
    );
  },
  () => {
    throw new Error(
      "Restore a complete verified backup; webhook history cannot be rolled back live",
    );
  },
);
