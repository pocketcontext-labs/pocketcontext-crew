// Existing bot mappings continue to wake their agents by default. Opting out
// of task wakes leaves a dispatcher's shared connection and mapping intact.
migrate(
  (app) => {
    const agents = app.findCollectionByNameOrId("crew_agents");
    agents.fields.add(new BoolField({ name: "startup_disabled" }));
    app.save(agents);
  },
  () => { throw new Error("Restore the complete pre-upgrade backup to roll back agent startup settings"); },
);
