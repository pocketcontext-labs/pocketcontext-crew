// The empty color on an existing or fresh instance uses the reader's amber default.
migrate(
  (app) => {
    const settings = app.findCollectionByNameOrId("crew_settings");
    settings.fields.add(new BoolField({ name: "instance_line_visible" }));
    settings.fields.add(new TextField({ name: "instance_line_color", max: 7 }));
    app.save(settings);
  },
  (app) => {
    const settings = app.findCollectionByNameOrId("crew_settings");
    settings.fields.removeByName("instance_line_visible");
    settings.fields.removeByName("instance_line_color");
    app.save(settings);
  },
);
