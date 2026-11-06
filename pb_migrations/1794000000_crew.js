// Crew v1: a fresh work/memory domain on the inherited single-owner runtime.
migrate(
  (app) => {
    const text = (name, required = false, max = 2000) => ({
      name,
      type: "text",
      required,
      max,
    });
    const json = (name) => ({ name, type: "json", maxSize: 1048576 });
    const rel = (name, target, required = false) => ({
      name,
      type: "relation",
      collectionId: app.findCollectionByNameOrId("crew_" + target).id,
      maxSelect: 1,
      required,
      cascadeDelete: false,
    });
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
    const archive = [
      { name: "archived", type: "bool" },
      text("archived_at"),
      text("archived_by"),
    ];
    create("agents", [
      text("name", true, 200),
      text("brief", false, 20000),
      ...archive,
    ]);
    create("buckets", [
      text("name", true, 200),
      text("purpose", false, 10000),
      rel("responsible_agent", "agents"),
      ...archive,
    ]);
    create("notes", [
      rel("bucket", "buckets", true),
      text("title", true, 500),
      text("body", false, 100000),
      json("links"),
      ...archive,
    ]);
    create(
      "note_revisions",
      [
        rel("note", "notes", true),
        text("title", true, 500),
        text("body", false, 100000),
        json("links"),
        text("actor"),
        text("reported_agent"),
        text("reason"),
      ],
      [
        "CREATE UNIQUE INDEX crew_note_version ON crew_note_revisions(note,revision)",
      ],
    );
    create("tasks", [
      text("title", true, 500),
      text("description", false, 20000),
      rel("assigned_agent", "agents"),
      text("created_by_agent"),
      json("labels"),
      {
        name: "status",
        type: "select",
        values: ["todo", "in_progress", "needs_review", "done"],
        required: true,
        maxSelect: 1,
      },
      text("draft", false, 100000),
      json("links"),
      ...archive,
    ]);
    create("events", [
      text("parent", true, 15),
      text("action", true, 100),
      text("body", false, 100000),
      text("actor", true),
      text("reported_agent"),
      text("reason"),
      json("changes"),
    ]);
    create("reviews", [
      rel("task", "tasks", true),
      text("draft", true, 100000),
      {
        name: "status",
        type: "select",
        values: [
          "pending",
          "approved",
          "changes_requested",
          "rejected",
          "withdrawn",
        ],
        required: true,
        maxSelect: 1,
      },
      text("decision_note", false, 10000),
      text("decided_by"),
      text("decided_at"),
      text("requested_by"),
      text("reported_agent"),
    ]);
  },
  () => {
    throw new Error("Restore a complete verified backup");
  },
);
