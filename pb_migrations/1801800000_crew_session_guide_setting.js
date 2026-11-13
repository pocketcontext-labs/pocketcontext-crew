// Crew 0.26.0 keeps the Start a session guide's "Don't show this again" on the
// server: crew_settings gains session_guide_off (false by default, so the guide
// shows once more in every browser until the owner ticks it again). Additive
// only; like every Crew collection, the API rules stay null. The down
// migration drops the field.
migrate(
  (app) => {
    const settings = app.findCollectionByNameOrId("crew_settings");
    settings.fields.add(new BoolField({ name: "session_guide_off" }));
    app.save(settings);
  },
  (app) => {
    const settings = app.findCollectionByNameOrId("crew_settings");
    settings.fields.removeByName("session_guide_off");
    app.save(settings);
  },
);
