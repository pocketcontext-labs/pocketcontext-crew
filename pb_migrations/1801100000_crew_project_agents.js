// Crew 0.18.0 project coder agents: an agent kind (bot, external or human) and
// an advisory task claim (claimed_by attribution and a claim_until lease).
// Existing agents are Grok bots. Only Grok bots are ever woken by webhook; the
// claim never wakes anyone. Like every Crew collection, the API rules stay
// null: only the custom operations read or write these fields.
migrate(
  (app) => {
    const agents = app.findCollectionByNameOrId("crew_agents");
    agents.fields.add(new TextField({ name: "kind", max: 20 }));
    app.save(agents);
    app
      .db()
      .newQuery(
        "UPDATE crew_agents SET kind='bot' WHERE kind IS NULL OR kind=''",
      )
      .execute();
    const tasks = app.findCollectionByNameOrId("crew_tasks");
    tasks.fields.add(new TextField({ name: "claimed_by", max: 200 }));
    tasks.fields.add(new TextField({ name: "claim_until", max: 100 }));
    app.save(tasks);
  },
  () => {
    throw new Error(
      "Restore a verified complete backup; agent kinds and task claims cannot be rolled back live",
    );
  },
);
