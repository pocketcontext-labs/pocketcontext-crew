// Crew 0.22.0 artifact lifecycle: a published link may expire (expires_at,
// RFC 3339; empty never expires), a draft may update another artifact's link
// (replaces, that artifact's id), and artifacts are archived instead of
// deleted (archived, archived_at, archived_by): Discard archives a draft, and
// revoked or expired links can be archived. Existing artifacts keep their
// status and get empty values. Like every Crew collection, the API rules stay
// null: only the custom operations read or write these fields.
migrate(
  (app) => {
    const artifacts = app.findCollectionByNameOrId("crew_artifacts");
    artifacts.fields.add(new TextField({ name: "expires_at", max: 100 }));
    artifacts.fields.add(new TextField({ name: "replaces", max: 15 }));
    artifacts.fields.add(new BoolField({ name: "archived" }));
    artifacts.fields.add(new TextField({ name: "archived_at", max: 100 }));
    artifacts.fields.add(new TextField({ name: "archived_by", max: 2000 }));
    app.save(artifacts);
  },
  () => {
    throw new Error(
      "Restore a verified complete backup; artifact expiry, updates and archiving cannot be rolled back live",
    );
  },
);
