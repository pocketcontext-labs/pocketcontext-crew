migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId("crew_tasks");
    tasks.fields.add(new TextField({name: "delegation_parent", max: 15}));
    tasks.addIndex("idx_crew_delegation_parent", false, "delegation_parent", "delegation_parent != ''");
    app.save(tasks);
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId("crew_tasks");
    tasks.removeIndex("idx_crew_delegation_parent");
    tasks.fields.removeByName("delegation_parent");
    app.save(tasks);
  },
);
