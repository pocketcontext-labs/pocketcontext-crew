// Crew 0.16.0 attachments: immutable files on tasks and notes, one-time upload
// links and the instance storage limit. Like every Crew collection, the API
// rules stay null: only the custom operations and the authenticated attachment
// routes read or write these records. File bytes live in the project's storage/
// folder as protected files; nothing here is ever purged.
migrate(
  (app) => {
    const text = (name, max = 2000, extra = {}) => ({
      name,
      type: "text",
      max,
      ...extra,
    });
    const number = (name) => ({ name, type: "number", min: 0, onlyInt: true });
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
            {
              name: "revision",
              type: "number",
              min: 1,
              onlyInt: true,
              required: true,
            },
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
    const parent = [
      {
        name: "parent_kind",
        type: "select",
        values: ["task", "note"],
        maxSelect: 1,
        required: true,
      },
      text("parent", 15, { required: true }),
    ];
    create(
      "attachments",
      [
        ...parent,
        {
          name: "file",
          type: "file",
          maxSelect: 1,
          maxSize: 20971520,
          protected: true,
          hidden: true,
          required: true,
          thumbs: ["1600x0", "320x0"],
        },
        text("name", 255, { required: true }),
        text("media_type", 200),
        { name: "image", type: "bool" },
        number("width"),
        number("height"),
        number("size"),
        text("sha256", 64),
        number("position"),
        text("actor"),
        text("reported_agent", 200),
        text("via_upload_link", 15),
        { name: "archived", type: "bool" },
        text("archived_at"),
        text("archived_by"),
      ],
      [
        "CREATE INDEX crew_attachment_parent ON crew_attachments(parent, position)",
      ],
    );
    create(
      "upload_links",
      [
        ...parent,
        text("token_hash", 64, { hidden: true, required: true }),
        text("created_by"),
        text("expires_at", 100),
        number("max_files"),
        number("files_added"),
        number("failed_uploads"),
        text("used_at", 100),
        text("revoked_at", 100),
        text("revoked_by"),
      ],
      [
        "CREATE UNIQUE INDEX crew_upload_link_token ON crew_upload_links(token_hash)",
        "CREATE INDEX crew_upload_link_parent ON crew_upload_links(parent)",
      ],
    );
    create(
      "settings",
      [text("singleton", 20), number("storage_limit_bytes")],
      [
        "CREATE UNIQUE INDEX crew_settings_singleton ON crew_settings(singleton)",
      ],
    );
    const settings = new Record(app.findCollectionByNameOrId("crew_settings"));
    settings.set("singleton", "settings");
    settings.set("storage_limit_bytes", 5368709120);
    settings.set("revision", 1);
    app.save(settings);
    // A review approves exactly the draft and attachments it saw.
    const reviews = app.findCollectionByNameOrId("crew_reviews");
    reviews.fields.add(new JSONField({ name: "attachments", maxSize: 65536 }));
    app.save(reviews);
  },
  () => {
    throw new Error(
      "Restore a verified complete backup; attachments cannot be rolled back live",
    );
  },
);
