// Govern notified tasks before acquisition; history and credentials remain untouched.
migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId("crew_tasks");
    tasks.fields.add(
      new NumberField({
        name: "execution_required_generation",
        min: 0,
        onlyInt: true,
      }),
    );
    app.save(tasks);
    app
      .db()
      .newQuery(
        "UPDATE crew_tasks SET execution_required_generation=COALESCE((SELECT MAX(generation) FROM crew_webhook_deliveries WHERE task=crew_tasks.id),0)",
      )
      .execute();
    const executions = app.findCollectionByNameOrId("crew_webhook_executions");
    for (const name of [
      "dispatch_started_at",
      "acquired_at",
      "handoff_prepared_at",
      "handoff_deadline_at",
      "handoff_message_ref",
    ])
      executions.fields.add(new TextField({ name, max: 1000 }));
    executions.fields.add(
      new BoolField({ name: "handoff_capability_reported" }),
    );
    app.save(executions);
    // Old prepared handoffs have no reliable acknowledgment deadline: require
    // deliberate reconciliation, not a fresh automatic opportunity to execute.
    app
      .db()
      .newQuery(
        "UPDATE crew_webhook_executions SET handoff_deadline_at='1970-01-01T00:00:00.000Z' WHERE state='handed_off'",
      )
      .execute();
  },
  () => {
    throw new Error(
      "Restore a verified complete backup; execution governance cannot be rolled back live",
    );
  },
);
