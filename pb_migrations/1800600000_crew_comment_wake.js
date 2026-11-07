// Owner-comment wakes and the bot handoff limit. Subscriptions are never changed:
// the "comment" wake reason stays opt-in for every existing configuration.
migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId("crew_tasks");
    for (const name of ["bot_handoffs", "comment_wake_generation"])
      tasks.fields.add(new NumberField({ name, min: 0, onlyInt: true }));
    tasks.fields.add(new TextField({ name: "comment_wake_event", max: 15 }));
    tasks.fields.add(new BoolField({ name: "handoff_limited" }));
    app.save(tasks);
    const routing = app.findCollectionByNameOrId("crew_webhook_routing");
    routing.fields.add(
      new NumberField({
        name: "max_bot_handoffs",
        min: 0,
        max: 20,
        onlyInt: true,
      }),
    );
    app.save(routing);
    app
      .db()
      .newQuery(
        "UPDATE crew_webhook_routing SET max_bot_handoffs=4 WHERE max_bot_handoffs IS NULL OR max_bot_handoffs=0",
      )
      .execute();
  },
  () => {
    throw new Error(
      "Restore a verified complete backup; comment wake history cannot be rolled back live",
    );
  },
);
