// Crew 0.19.0 task releases and in-session approval: tasks record the release
// that shipped them (release), how they were approved (review_mode: empty or
// crew for a Crew review, in_session for an owner approval in a coding
// session), who approved in session (approved_by, a reported name used only
// as attribution) and when (approved_at, set by the server only). Status gains
// wont_do, a terminal status like done. Existing tasks keep their status and
// get empty values. Like every Crew collection, the API rules stay null: only
// the custom operations read or write these fields.
migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId("crew_tasks");
    const status = tasks.fields.getByName("status");
    status.values = ["todo", "in_progress", "needs_review", "done", "wont_do"];
    tasks.fields.add(new TextField({ name: "release", max: 32 }));
    tasks.fields.add(
      new SelectField({
        name: "review_mode",
        values: ["crew", "in_session"],
        maxSelect: 1,
      }),
    );
    tasks.fields.add(new TextField({ name: "approved_by", max: 100 }));
    tasks.fields.add(new DateField({ name: "approved_at" }));
    app.save(tasks);
  },
  () => {
    throw new Error(
      "Restore a verified complete backup; task releases, approvals and Won't do cannot be rolled back live",
    );
  },
);
