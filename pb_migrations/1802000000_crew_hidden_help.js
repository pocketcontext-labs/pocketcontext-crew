// Crew 0.37.0 keeps which help panels the one owner hid on the server, beside
// session_guide_off, language and agent_tap: crew_settings gains `hidden_help`
// (JSON array of help ids such as "page.home"; empty means every help shows).
// The reader's "Don't show this again" adds an id and Settings' "Show all help
// again" empties it. Additive only; like every Crew collection, the API rules
// stay null. The down migration drops the field.
migrate(
  (app) => {
    const settings = app.findCollectionByNameOrId("crew_settings");
    settings.fields.add(new JSONField({ name: "hidden_help", maxSize: 16384 }));
    app.save(settings);
  },
  (app) => {
    const settings = app.findCollectionByNameOrId("crew_settings");
    settings.fields.removeByName("hidden_help");
    app.save(settings);
  },
);
