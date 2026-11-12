// Crew 0.21.0 editable session instructions: immutable revisions of the
// instructions body that project coder agents (kind external) read with
// crew_read {collection:"session"}. One row per revision; the latest row is the
// current text, and an agent without rows uses the built-in default. A
// restore-default revision stores is_default with empty text, so it follows
// the built-in template of the running release. The agent brief stays on the
// agent and is appended when the instructions are read. Like every Crew
// collection, the API rules stay null: only the custom operations read or
// write these records, and nothing is ever updated or purged.
migrate(
  (app) => {
    const text = (name, max = 2000) => ({ name, type: "text", max });
    app.save(
      new Collection({
        name: "crew_session_revisions",
        type: "base",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          {
            name: "agent",
            type: "relation",
            collectionId: app.findCollectionByNameOrId("crew_agents").id,
            maxSelect: 1,
            required: true,
            cascadeDelete: false,
          },
          text("instructions", 100000),
          { name: "is_default", type: "bool" },
          text("actor"),
          text("reported_agent", 200),
          text("reason"),
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
          "CREATE UNIQUE INDEX crew_session_version ON crew_session_revisions(agent,revision)",
        ],
      }),
    );
  },
  () => {
    throw new Error(
      "Restore a verified complete backup; session instruction revisions cannot be rolled back live",
    );
  },
);
