// Crew 0.21.0 artifacts: frozen pages the owner publishes from notes at
// /a/<token>. Work clients create and edit drafts; publishing, revoking and
// replacing published content are owner-browser-only. The token is a hidden
// field: crew_read, SQL and MCP never return it. Published images are
// references to immutable attachments, so the snapshot never changes when a
// source note does. Like every Crew collection the API rules stay null.
migrate(
  (app) => {
    const text = (name, max = 2000, extra = {}) => ({
      name,
      type: "text",
      max,
      ...extra,
    });
    const number = (name) => ({ name, type: "number", min: 0, onlyInt: true });
    app.save(
      new Collection({
        name: "crew_artifacts",
        type: "base",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          // The draft: what work clients and the owner edit.
          text("title", 300, { required: true }),
          text("body", 200000),
          { name: "sources", type: "json", maxSize: 65536 },
          // The published snapshot the public page shows.
          {
            name: "status",
            type: "select",
            values: ["draft", "published", "revoked"],
            maxSelect: 1,
            required: true,
          },
          text("published_title", 300),
          text("published_body", 200000),
          { name: "published_files", type: "json", maxSize: 65536 },
          text("published_at", 100),
          text("published_by"),
          number("published_revision"),
          text("revoked_at", 100),
          text("revoked_by"),
          text("token", 64, { hidden: true }),
          number("view_count"),
          text("last_viewed_at", 100),
          text("created_by_agent", 200),
          text("actor"),
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
        indexes: [
          "CREATE UNIQUE INDEX crew_artifact_token ON crew_artifacts(token) WHERE token != ''",
        ],
      }),
    );
    const attachments = app.findCollectionByNameOrId("crew_attachments");
    const kind = attachments.fields.getByName("parent_kind");
    kind.values = ["task", "note", "artifact"];
    app.save(attachments);
  },
  () => {
    throw new Error(
      "Restore a verified complete backup; artifacts cannot be rolled back live",
    );
  },
);
