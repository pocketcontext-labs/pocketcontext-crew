// Crew 0.36.0 keeps two more reader preferences of the one owner on the server,
// beside session_guide_off: crew_settings gains `language` (text; empty means
// follow the browser, else en, de or it) and `agent_tap` (JSON; what tapping
// an agent row on Home does: {all, agents: {agentId: action}}; empty means the
// product default, Open agent). Additive only; like every Crew collection, the
// API rules stay null. The down migration drops both fields.
migrate(
  (app) => {
    const settings = app.findCollectionByNameOrId("crew_settings");
    settings.fields.add(new TextField({ name: "language", max: 8 }));
    settings.fields.add(new JSONField({ name: "agent_tap", maxSize: 65536 }));
    app.save(settings);
  },
  (app) => {
    const settings = app.findCollectionByNameOrId("crew_settings");
    settings.fields.removeByName("language");
    settings.fields.removeByName("agent_tap");
    app.save(settings);
  },
);
