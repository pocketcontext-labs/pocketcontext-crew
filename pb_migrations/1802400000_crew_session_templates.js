// Old rows used the project template exclusively. Leave immutable history
// untouched: the server interprets the empty value as that template.
migrate(
  (app) => {
    const revisions = app.findCollectionByNameOrId("crew_session_revisions");
    revisions.fields.add(new SelectField({
      name: "template_kind", values: ["external", "bot"], maxSelect: 1, hidden: true,
    }));
    app.save(revisions);
  },
  () => { throw new Error("Restore the complete pre-upgrade backup to roll back session templates"); },
);
